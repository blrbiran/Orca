import { readGroupIntegration, readIntegrationDefault } from "../integrationScheme.js";
import { isGroupArchived } from "../archivedMark.js";
import { landedGroups, type LandedGroup } from "../integrationCheck.js";
import { runningGroupIds } from "../orchestration.js";
import { readArchivedPlan } from "../queries.js";
import type { ControlStore } from "../store.js";
import { overlapGroups, rangeOf, type CheckRange, type Git, type RangeGroup } from "./range.js";
import type { CheckKind } from "./settingsSchema.js";
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

/** A run starts: the start time and a new runSeq are recorded; the watermark does not move (§5.2). */
export function recordCheckStarted(store: ControlStore, repoId: string, kind: CheckKind, target: string, at: number, range: { from: string; to: string; groups: readonly LandedGroup[] }, extra: Partial<CheckLast> = {}): CheckState {
  return update(store, repoId, kind, target, (s) => ({
    ...s, lastStartAt: at, runSeq: s.runSeq + 1,
    last: record({ state: "running", at, from: range.from, to: range.to, groups: range.groups.map((group) => group.groupId), ...extra }),
  }));
}

/**
 * §5.2: how a run ended, and the watermark with it in one transaction. Completed (`passed`, `failed`, `completed`) ⇒ the
 * watermark moves to `moveTo` and the failure streak resets; `errored` ⇒ the watermark stays and the streak grows;
 * an interruption (Orca stopped) ⇒ the watermark stays and the streak does not count it (§5.4).
 */
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
    return {
      ...s, last,
      watermark: completed && end.moveTo !== undefined ? end.moveTo : s.watermark,
      failureStreak: completed ? 0 : end.interrupted === true ? s.failureStreak : s.failureStreak + 1,
    };
  };
  const next = change(readCheckState(store, repoId, kind, target) ?? EMPTY_CHECK_STATE);
  writeCheckState(store, repoId, kind, target, next);
  return next;
}
