import { readGroupIntegration, readIntegrationDefault } from "../integrationScheme.js";
import { isGroupArchived } from "../archivedMark.js";
import { landedGroups, type LandedGroup } from "../integrationCheck.js";
import { runningGroupIds } from "../orchestration.js";
import { readArchivedPlan } from "../queries.js";
import type { ControlStore } from "../store.js";
import { latestSlot, parseCron } from "./cron.js";
import { overlapGroups, rangeOf, type CheckRange, type Git, type RangeGroup } from "./range.js";
import type { CheckKind, ScheduledCheck } from "./settingsSchema.js";
import { EMPTY_CHECK_STATE, readCheckState, writeCheckState, type CheckLast, type CheckState } from "./state.js";
import type { RangeFacts } from "./trigger.js";

/**
 * Checks spec 2026-10-22 §2–§5: what the pump does for one (project, kind, target) on each tick, by code (Rule 5). The
 * implied conditions of every trigger live here: a range with at least one landed group, and no run of the same
 * (project, kind, target) in flight. A tick on a target whose head is the watermark costs one `rev-parse` (Review Focus 3).
 */

/** The targets a project's checks watch: every local-delivery target its groups or its default name. */
export function projectTargets(store: ControlStore, repoId: string): string[] {
  const targets = new Set<string>();
  const fallback = readIntegrationDefault(store, repoId).scheme;
  if (fallback.delivery === "local") targets.add(fallback.target);
  for (const row of store.db.prepare("SELECT id, body FROM groups ORDER BY rowid").all()) {
    let body: Record<string, unknown>;
    try { body = JSON.parse(String(row.body)) as Record<string, unknown>; } catch { continue; }
    if ((body.plan as { repoId?: unknown } | undefined)?.repoId !== repoId || isGroupArchived(store, String(row.id))) continue;
    try { const scheme = readGroupIntegration(body)?.scheme; if (scheme?.delivery === "local") targets.add(scheme.target); } catch { /* its own reads name it */ }
  }
  return [...targets].sort();
}

export type Prepared =
  | { kind: "idle" }
  | { kind: "initialised"; head: string }
  | { kind: "errored"; detail: string }
  | { kind: "range"; state: CheckState; range: CheckRange };

const update = (store: ControlStore, repoId: string, kind: CheckKind, target: string, change: (state: CheckState) => CheckState): CheckState => {
  let next = EMPTY_CHECK_STATE;
  store.transaction(() => { next = change(readCheckState(store, repoId, kind, target) ?? EMPTY_CHECK_STATE); writeCheckState(store, repoId, kind, target, next); });
  return next;
};
const record = (state: Partial<CheckLast> & Pick<CheckLast, "state" | "at">): CheckLast =>
  ({ from: null, to: null, groups: [], detail: null, reviewGroupId: null, debugGroupIds: [], recordHash: null, ...state });

/**
 * §5.3: read the target's head; no watermark ⇒ W := H, `initialised`, no run; H = W ⇒ nothing (one git call); an
 * unreadable target ⇒ `errored: target unreadable`, recorded once per change of reason; else the range with its landed
 * groups (system groups excluded, §2.3).
 */
export async function prepareRange(store: ControlStore, git: Git, repo: string, repoId: string, kind: CheckKind, target: string, now: number): Promise<Prepared> {
  const head = await git(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${target}^{commit}`]);
  const state = readCheckState(store, repoId, kind, target) ?? EMPTY_CHECK_STATE;
  if (head.code !== 0) {
    const detail = `target unreadable: ${target}`;
    if (!(state.last?.state === "errored" && state.last.detail === detail)) update(store, repoId, kind, target, (s) => ({ ...s, last: record({ state: "errored", at: now, detail }) }));
    return { kind: "errored", detail };
  }
  const H = head.stdout.trim();
  if (state.watermark === null) {
    update(store, repoId, kind, target, (s) => ({ ...s, watermark: H, last: record({ state: "initialised", at: now, to: H }) }));
    return { kind: "initialised", head: H };
  }
  if (state.watermark === H) return { kind: "idle" };
  const landed = landedGroups(store, repoId).filter((group) => group.target === target);
  const boundaries = new Set(landedGroups(store, repoId, { includeSystem: true }).filter((group) => group.target === target).map((group) => group.integratedCommit));
  const range = await rangeOf(git, repo, state.watermark, H, landed, boundaries);
  if (range.rebased !== state.rebased) update(store, repoId, kind, target, (s) => ({ ...s, rebased: range.rebased }));
  return { kind: "range", state: { ...state, rebased: range.rebased }, range };
}

/** §2.2's facts about a range, by code. `conflict-reconciled` counts only inter-group conflict flags, never `reconcile`. */
export function rangeFacts(store: ControlStore, repoId: string, groups: readonly RangeGroup[], state: CheckState, now: number, scheduleDue: (cron: string) => boolean = () => false): RangeFacts {
  const ids = groups.map((group) => group.groupId);
  const conflictReconciled = ids.length > 0 && store.db.prepare(`SELECT 1 FROM flagged_decisions WHERE source='integration-conflict' AND group_id IN (${ids.map(() => "?").join(",")}) LIMIT 1`).get(...ids) !== undefined;
  const repoOf = (groupId: string): unknown => { try { return readArchivedPlan(store, groupId).plan.repoId; } catch { return null; } };
  // §2.3: a system group (any systemDebug mark) never counts, so its running slot does not make the queue busy either.
  const isSystem = (groupId: string): boolean => {
    try { return Object.hasOwn(JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)?.body ?? "{}")) as object, "systemDebug"); } catch { return false; }
  };
  return {
    landed: groups.length,
    conflictReconciled,
    overlapGroups: overlapGroups(groups),
    queueIdle: runningGroupIds(store).every((groupId) => isSystem(groupId) || repoOf(groupId) !== repoId),
    msSinceLastStart: state.lastStartAt === null ? null : now - state.lastStartAt,
    scheduleDue,
  };
}

/**
 * §2.4: what asks a (project, kind, target) to run besides its event trigger -- each enabled scheduled check of the kind
 * with a slot after its own lastSlot (missed slots collapse to the latest), and a person's pending "run now".
 */
export interface Starters { slots: Record<string, number>; pendingRun: CheckState["pendingRun"] }
export const NO_STARTERS: Starters = { slots: {}, pendingRun: null };
export const asked = (starters: Starters): boolean => starters.pendingRun !== null || Object.keys(starters.slots).length > 0;

/**
 * §2.4: a schedule the state has no lastSlot for counts from now -- its lastSlot becomes the latest slot <= now (or now
 * when the cron had none), and no run is started for it. Returns the state with every schedule initialised.
 */
export function initialiseSlots(store: ControlStore, repoId: string, kind: CheckKind, target: string, schedules: readonly ScheduledCheck[], timeZone: string, now: number): CheckState {
  const state = readCheckState(store, repoId, kind, target) ?? EMPTY_CHECK_STATE;
  const fresh = schedules.filter((schedule) => state.lastSlot[schedule.id] === undefined);
  if (fresh.length === 0) return state;
  const slots = Object.fromEntries(fresh.map((schedule) => [schedule.id, latestSlot(parseCron(schedule.cron), timeZone, Number.NEGATIVE_INFINITY, now) ?? now]));
  return update(store, repoId, kind, target, (s) => ({ ...s, lastSlot: { ...s.lastSlot, ...slots } }));
}

/** The due starters: none while paused but a pending run (§5.4: no trigger or schedule starts a paused check). */
export function dueStarters(state: CheckState, schedules: readonly ScheduledCheck[], timeZone: string, now: number): Starters {
  const slots: Record<string, number> = {};
  if (!state.paused) for (const schedule of schedules) {
    const slot = latestSlot(parseCron(schedule.cron), timeZone, state.lastSlot[schedule.id] ?? now, now);
    if (slot !== null) slots[schedule.id] = slot;
  }
  return { slots, pendingRun: state.pendingRun };
}

/** Consumes the starters: each schedule's lastSlot moves to its due slot; the pending run read is cleared (a newer one stays). */
const consume = (s: CheckState, starters: Starters): CheckState => ({
  ...s, lastSlot: { ...s.lastSlot, ...starters.slots },
  pendingRun: starters.pendingRun !== null && s.pendingRun?.commandId === starters.pendingRun.commandId ? null : s.pendingRun,
});

/** §2.4: a slot or a run now over an empty range is consumed and recorded `skipped: nothing new` (no run, no spend). */
export function recordCheckSkipped(store: ControlStore, repoId: string, kind: CheckKind, target: string, at: number, starters: Starters): CheckState {
  return update(store, repoId, kind, target, (s) => ({ ...consume(s, starters), last: record({ state: "skipped", at, detail: "nothing new" }) }));
}

/** The first evaluation initialised the watermark: the starters that asked for it are consumed with it (§5.3). */
export function consumeStarters(store: ControlStore, repoId: string, kind: CheckKind, target: string, starters: Starters): CheckState {
  return update(store, repoId, kind, target, (s) => consume(s, starters));
}

/** A run starts: the start time and a new runSeq are recorded, its starters consumed; the watermark does not move (§5.2). */
export function recordCheckStarted(store: ControlStore, repoId: string, kind: CheckKind, target: string, at: number, range: { from: string; to: string; groups: readonly LandedGroup[] }, extra: Partial<CheckLast> = {}, starters: Starters = NO_STARTERS): CheckState {
  return update(store, repoId, kind, target, (s) => ({
    ...consume(s, starters), lastStartAt: at, runSeq: s.runSeq + 1,
    last: record({ state: "running", at, from: range.from, to: range.to, groups: range.groups.map((group) => group.groupId), ...extra }),
  }));
}

/**
 * §5.2: how a run ended, and the watermark with it in one transaction. Completed (`passed`, `failed`, `completed`) ⇒ the
 * watermark moves to `moveTo` and the failure streak resets; `errored` ⇒ the watermark stays and the streak grows;
 * an interruption (Orca stopped) ⇒ the watermark stays and the streak does not count it (§5.4).
 */
export const PAUSE_AFTER = 3;
export type CheckEnd = { state: "passed" | "failed" | "completed" | "errored"; at: number; detail?: string | null; moveTo?: string; debugGroupIds?: string[]; reviewGroupId?: string | null; recordHash?: string | null; interrupted?: boolean };
export function recordCheckEnded(store: ControlStore, repoId: string, kind: CheckKind, target: string, end: CheckEnd): CheckState {
  let next = EMPTY_CHECK_STATE;
  store.transaction(() => { next = applyCheckEnded(store, repoId, kind, target, end); });
  return next;
}
/** The same inside the caller's transaction (a review's end is written with its settled mark, spec §5.2). */
export function applyCheckEnded(store: ControlStore, repoId: string, kind: CheckKind, target: string, end: CheckEnd): CheckState {
  const change = (s: CheckState): CheckState => {
    const completed = end.state !== "errored";
    const last = record({
      ...(s.last ?? {}), state: end.state, at: end.at, detail: end.detail ?? null,
      debugGroupIds: end.debugGroupIds ?? s.last?.debugGroupIds ?? [], reviewGroupId: end.reviewGroupId ?? s.last?.reviewGroupId ?? null, recordHash: end.recordHash ?? s.last?.recordHash ?? null,
    });
    const failureStreak = completed ? 0 : end.interrupted === true ? s.failureStreak : s.failureStreak + 1;
    return {
      ...s, last,
      watermark: completed && end.moveTo !== undefined ? end.moveTo : s.watermark,
      failureStreak,
      // §5.4: at PAUSE_AFTER errored ends in a row the kind pauses for the project; only resume-check clears it.
      paused: s.paused || failureStreak >= PAUSE_AFTER,
    };
  };
  const next = change(readCheckState(store, repoId, kind, target) ?? EMPTY_CHECK_STATE);
  writeCheckState(store, repoId, kind, target, next);
  return next;
}
