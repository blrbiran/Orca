import { globalFlowsLayerSchema } from "../flow/settingsSchema.js";
import { z } from "zod";
import { flowRoleSql } from "../flow/groups.js";
import { isGroupArchived } from "./archivedMark.js";
import { ControlError } from "./errors.js";
import { amountSchema } from "./schema.js";
import { globalChecksLayerSchema } from "./checks/settingsSchema.js";
import { BUSY_WORK, EXECUTION_WAKE_KINDS, groupExecutionPendingInStore } from "./executionPending.js";
import type { ControlStore } from "./store.js";

/**
 * Kanban and group orchestration spec 2026-10-20 §3.1-§3.2 (goal.md §1.4): confirming a group authorizes it to start; the
 * driver starts it as soon as its prerequisites are done and a slot under the running-group cap is free. Every rule here
 * is code (CLAUDE.md Rule 5). The start itself is an ordinary `start` command the driver sends as `orca-auto` (spec §9a),
 * so it is ledgered, refused and replayed exactly like a person's.
 *
 * A group confirmed before this existed has no row and is never started automatically (no surprise starts on upgrade).
 */
export const ORCHESTRATION_ACTOR = "orca-auto";
export const DEFAULT_MAX_RUNNING_GROUPS = 3;
/** A refusal this many times in a row makes the group needs-you (it keeps being retried at the longest backoff). */
export const PERSISTENT_REFUSALS = 5;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 600_000;

const refusalSchema = z.object({ code: z.string().min(1), detail: z.string().nullable(), count: z.number().int().positive(), at: z.number().int(), nextAt: z.number().int() }).strict();
const groupOrchestrationSchema = z.object({
  mode: z.enum(["run", "hold"]),
  confirmRevision: z.number().int().positive(),
  confirmedAt: z.number().int(),
  /** The command revision of the start that took it (a person's or orca-auto's); null until then. */
  startedRevision: z.number().int().positive().nullable(),
  refusal: refusalSchema.nullable(),
  /**
   * Review-exit spec 2026-11-05 §3.4 (D4): the explicit start queued at the cap (a person's, or a resume of a group never
   * started), named by the activity row of the start that later takes the slot. Absent when none waits.
   */
  queued: z.object({ commandId: z.string().min(1), actorId: z.string().min(1) }).strict().optional(),
  /** How many of orca-auto's own starts found the cap full (a lost race); it keys the pass's next command id. */
  slotRaces: z.number().int().positive().optional(),
}).strict();
export type GroupOrchestration = z.infer<typeof groupOrchestrationSchema>;

// Protect-acceptance-criteria spec §5: `criteriaReview` is the automatic reviewer's global default; absent is on.
// Failure-cause spec 2026-10-21 §5: `quotaWait` names the agent installations whose quota failures wait and are retried
// instead of going to the person; absent or empty is the default (off for every installation).
// Checks spec 2026-10-22 §4.1: `checks` is the global layer of the check settings (with the optional admin locks).
const settingsSchema = z.object({ maxRunningGroups: z.number().int().min(1).max(64), criteriaReview: z.boolean().optional(), quotaWait: z.array(z.string().min(1).max(200)).max(64).optional(),
  // Quota failover spec 2026-11-03 §8 (D1, D6): the installations a quota failure switches to, in order; absent is the agents
  // table's order (on whenever there is more than one), empty turns failover off.
  failoverOrder: z.array(z.string().min(1).max(200)).max(64).optional(), checks: globalChecksLayerSchema.optional(),
  // Flow engine spec §11.2: the global layer of the flow settings, with the locks.
  flows: globalFlowsLayerSchema.optional(),
  // Retry work top-up spec 2026-11-06 §2 "The cap": the most an agent may add to one group's tasks (summed per group);
  // absent or null: agents may not top up. workTopUp.ts readAgentTopUpCap reads it inside retry-task's transaction.
  agentTopUpCap: amountSchema.nullable().optional() }).strict();
export type OrchestrationSettings = z.infer<typeof settingsSchema>;

export function readGroupOrchestration(store: ControlStore, groupId: string): GroupOrchestration | null {
  const row = store.db.prepare("SELECT body FROM group_orchestration WHERE group_id=?").get(groupId);
  if (row === undefined) return null;
  const parsed = groupOrchestrationSchema.safeParse(JSON.parse(String(row.body)));
  if (!parsed.success) throw new ControlError("recovery-blocked", `group-orchestration-invalid:${groupId}`);
  return parsed.data;
}

function writeGroupOrchestration(store: ControlStore, groupId: string, body: GroupOrchestration): void {
  store.db.prepare("INSERT INTO group_orchestration(group_id,body) VALUES (?,?) ON CONFLICT(group_id) DO UPDATE SET body=excluded.body")
    .run(groupId, JSON.stringify(groupOrchestrationSchema.parse(body)));
}

/** Confirm's transaction: `hold` is "Confirm only, don't run yet" (spec §3.1); otherwise the group may start on its own. */
export function recordConfirmed(store: ControlStore, groupId: string, mode: "run" | "hold", confirmRevision: number): void {
  writeGroupOrchestration(store, groupId, { mode, confirmRevision, confirmedAt: store.now(), startedRevision: null, refusal: null });
}

/** A start command took the group (in its transaction): nothing starts it again. No row ⇒ nothing to record. */
export function recordStarted(store: ControlStore, groupId: string, startRevision: number): void {
  const current = readGroupOrchestration(store, groupId);
  if (current === null) return;
  const { queued: _queued, slotRaces: _slotRaces, ...rest } = current;
  writeGroupOrchestration(store, groupId, { ...rest, mode: "run", startedRevision: startRevision, refusal: null });
}

/** A refused automatic start: backoff 30 s, 60 s, … up to 10 min; the count says how many in a row. */
export function recordAutoStartRefused(store: ControlStore, groupId: string, code: string, detail: string | null, at: number): void {
  const current = readGroupOrchestration(store, groupId);
  if (current === null) return;
  const count = (current.refusal?.count ?? 0) + 1;
  const delay = Math.min(BACKOFF_BASE_MS * 2 ** Math.min(count - 1, 10), BACKOFF_MAX_MS);
  writeGroupOrchestration(store, groupId, { ...current, refusal: { code, detail, count, at, nextAt: at + delay } });
}

export function orchestrationRevision(store: ControlStore): number {
  const row = store.db.prepare("SELECT revision FROM orchestration_settings WHERE singleton=1").get();
  return row === undefined ? 0 : Number(row.revision);
}

export function readOrchestrationSettings(store: ControlStore): OrchestrationSettings {
  const row = store.db.prepare("SELECT body FROM orchestration_settings WHERE singleton=1").get();
  if (row === undefined) return { maxRunningGroups: DEFAULT_MAX_RUNNING_GROUPS };
  const parsed = settingsSchema.safeParse(JSON.parse(String(row.body)));
  if (!parsed.success) throw new ControlError("recovery-blocked", "orchestration-settings-invalid");
  return parsed.data;
}

/** Inside the command's transaction; the revision is the command's next revision. */
export function writeOrchestrationSettings(store: ControlStore, settings: OrchestrationSettings, revision: number): void {
  store.db.prepare("INSERT INTO orchestration_settings(singleton,revision,body) VALUES (1,?,?) ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision, body=excluded.body")
    .run(revision, JSON.stringify(settingsSchema.parse(settings)));
}

type GroupFacts = { id: string; status: string; debug: boolean; review: boolean; flowChild: boolean };
function groupFacts(store: ControlStore): GroupFacts[] {
  return store.db.prepare("SELECT id, body FROM groups ORDER BY rowid").all().flatMap((row) => {
    let body: unknown;
    try { body = JSON.parse(String(row.body)); } catch { return []; } // its own reads name a bad body
    return [factsOf(String(row.id), body)];
  });
}
function factsOf(id: string, parsed: unknown): GroupFacts {
  const body = (parsed ?? {}) as { status?: unknown; debug?: unknown };
  // System debug task spec 2026-10-21 §2: Orca's own debug groups are admitted first too.
  const debug = [body.debug, (body as { systemDebug?: unknown }).systemDebug].some((mark) => typeof mark === "object" && mark !== null);
  // Checks spec 2026-10-22 §6.1: a model review fixes nothing, so it is admitted after every person-confirmed group.
  const review = (body as { systemDebug?: { source?: { kind?: unknown } } }).systemDebug?.source?.kind === "model-review";
  // Flow engine spec §6.2: a flow run's child runs under the slot its parent holds.
  const flowChild = (body as { flow?: { role?: unknown } }).flow?.role === "child";
  return { id, status: String(body.status), debug: debug && !review, review, flowChild };
}

/**
 * The groups holding a slot. One query whatever the number of groups, tasks or runs, so a summary that asks costs the same
 * for every group (controlPollPerformance's bound). Never an archived, paused (issue #129) or flow-child group.
 * Review-exit spec 2026-11-05 §3.1 (D1) -- a group holds a slot while it has something to run, not by its status:
 * (a) a started group (any status but clarifying/draft) with an active run of any phase or a busy task; or
 * (b) a ready/running/review group with no group-scope recovery blocker, no recorded spend-cap block and known usage
 *     (a delivery that keeps pending for one of those waits for a person), that has an undelivered start/no-start/resume
 *     wake, or -- once started (it has a start wake) -- a ready task whose dependsOn are all done and that has no active run.
 * A review group whose tasks are all blocked, held or done holds none; it stays where the person sees it.
 */
export function runningGroupIds(store: ControlStore): string[] {
  // Dogfood run 3 F20 (session 86352010): a `held` task (a handoff stop settled, recoverable) runs nothing and waits for a
  // person's continue or resume-from-handoff, which §3.1 "regained work" then makes wait for a slot; so it holds none here.
  // BUSY_WORK keeps `held` for the start gate (a held group is continued, not started).
  const wakeKinds = [...EXECUTION_WAKE_KINDS].map((kind) => `'${kind}'`).join(","), busy = [...BUSY_WORK].filter((status) => status !== "held").map((status) => `'${status}'`).join(",");
  // CASE json_valid: a body that does not parse holds no slot here (its own reads name it); json_extract would throw.
  const at = (column: string, path: string) => `CASE WHEN json_valid(${column}) THEN json_extract(${column},'${path}') END`;
  const status = at("g.body", "$.status");
  // Flow engine spec §6.2: a flow run holds one slot, through its parent, while the run is running; its children hold none.
  return store.db.prepare(`SELECT g.id AS id FROM groups g WHERE ${at("g.body", "$.archived")} IS NULL AND ${flowRoleSql("g")} IS NOT 'child'
    AND NOT EXISTS (SELECT 1 FROM stop_intents s WHERE s.group_id=g.id AND s.mode='pause') AND (
    (${flowRoleSql("g")} = 'parent' AND EXISTS (SELECT 1 FROM flow_runs f WHERE f.group_id=g.id AND f.state='running')) OR
    (${status} NOT IN ('clarifying','draft') AND (
      EXISTS (SELECT 1 FROM runs r WHERE r.group_id=g.id AND r.active=1)
      OR EXISTS (SELECT 1 FROM work_items i WHERE i.group_id=g.id AND ${at("i.body", "$.kind")}='task' AND ${at("i.body", "$.status")} IN (${busy})))) OR
    (${status} IN ('ready','running','review')
      AND NOT EXISTS (SELECT 1 FROM recovery_blockers b WHERE b.group_id=g.id AND b.scope='group')
      AND NOT EXISTS (SELECT 1 FROM spend_cap_blocks c WHERE c.group_id=g.id)
      AND ${at("g.body", "$.ledger.usageUnknown")} IS NOT 1 AND (
      EXISTS (SELECT 1 FROM scheduler_wakes w WHERE w.group_id=g.id AND w.delivered=0 AND w.kind IN (${wakeKinds}))
      OR (EXISTS (SELECT 1 FROM scheduler_wakes w WHERE w.group_id=g.id AND w.kind='start')
        AND EXISTS (SELECT 1 FROM work_items i WHERE i.group_id=g.id AND ${at("i.body", "$.kind")}='task' AND ${at("i.body", "$.status")}='ready'
          AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.group_id=g.id AND r.work_item_id=i.id AND r.active=1)
          AND NOT EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(i.body) AND json_type(i.body,'$.dependsOn')='array' THEN json_extract(i.body,'$.dependsOn') ELSE '[]' END) d
            WHERE NOT EXISTS (SELECT 1 FROM work_items p WHERE p.group_id=g.id AND p.id=d.value AND ${at("p.body", "$.status")}='done'))))))) ORDER BY g.rowid`)
    .all().map((row) => String(row.id));
}

/**
 * The prerequisites a group still waits on (spec §3.3/§3.4); S3 fills this in. Empty ⇒ none.
 * Exported as a seam so the board and the orchestrator read one answer.
 */
export type PrerequisiteReader = (store: ControlStore, groupId: string) => string[];
const noPrerequisites: PrerequisiteReader = () => [];

export type AutoStartState =
  | { kind: "none" } // no orchestration row: confirmed before this existed, or not confirmed
  | { kind: "held" }
  | { kind: "started" }
  | { kind: "stopped" } // a stop intent or the archive mark keeps it off (pause/stop keep their meaning)
  | { kind: "waiting-prerequisite"; waitingFor: string[] }
  | { kind: "backoff"; refusal: NonNullable<GroupOrchestration["refusal"]> }
  | { kind: "waiting-slot" }
  | { kind: "eligible" };

function hasStopIntent(store: ControlStore, groupId: string): boolean {
  return store.db.prepare("SELECT 1 FROM stop_intents WHERE group_id=?").get(groupId) !== undefined;
}

/**
 * One group's place in the queue, by code. `slotFree` is decided by the caller over all groups; `executing` is the
 * group's own executionPending when the caller already holds it (a summary reads it over its snapshot).
 */
export function autoStartState(store: ControlStore, group: { id: string; status: string }, now: number, slotFree: boolean, prerequisites: PrerequisiteReader = noPrerequisites, executing?: boolean): AutoStartState {
  const row = readGroupOrchestration(store, group.id);
  if (row === null) return { kind: "none" };
  if (row.startedRevision !== null || group.status !== "ready" || (executing ?? groupExecutionPendingInStore(store, group.id))) return { kind: "started" };
  if (row.mode === "hold") return { kind: "held" };
  if (hasStopIntent(store, group.id) || isGroupArchived(store, group.id)) return { kind: "stopped" };
  const waitingFor = prerequisites(store, group.id);
  if (waitingFor.length > 0) return { kind: "waiting-prerequisite", waitingFor };
  if (row.refusal !== null && row.refusal.nextAt > now) return { kind: "backoff", refusal: row.refusal };
  return slotFree ? { kind: "eligible" } : { kind: "waiting-slot" };
}

/** How many groups hold a slot now, and the cap. */
export function slotUse(store: ControlStore): { running: number; cap: number } {
  return { running: runningGroupIds(store).length, cap: readOrchestrationSettings(store).maxRunningGroups };
}

export interface AutoStartDeps {
  store: ControlStore;
  now: () => number;
  /** Sends a synthesized `start` (the service's start path); answers the command body. */
  start: (command: { schema: "orca-raw-command-v1"; commandId: string; actorId: string; expectedRevision: number; verb: "start"; target: { kind: "group"; groupId: string }; payload: Record<string, never> }) => Promise<unknown>;
  prerequisites?: PrerequisiteReader;
}

/** The pass's candidates in its order: model reviews last, debug groups first, then by confirm time (spec §3.2). */
function passCandidates(store: ControlStore): Array<{ group: GroupFacts; row: GroupOrchestration }> {
  return groupFacts(store)
    .map((group) => ({ group, row: readGroupOrchestration(store, group.id) }))
    .filter((entry): entry is { group: GroupFacts; row: GroupOrchestration } => entry.row !== null && entry.row.mode === "run" && entry.row.startedRevision === null)
    .sort((a, b) => Number(a.group.review) - Number(b.group.review) || Number(b.group.debug) - Number(a.group.debug) || a.row.confirmedAt - b.row.confirmedAt || a.group.id.localeCompare(b.group.id));
}

/**
 * The pass's admission facts for one parsed group body: `rank` 0 a debug group, 1 an ordinary one, 2 a model review;
 * `flowChild` runs under its parent's slot. Review-exit spec §3.1: regained work is admitted in the same order
 * (replenishStartWakes, which hands in the body it already parsed).
 */
export function admissionOf(body: unknown): { rank: number; flowChild: boolean } {
  const facts = factsOf("", body);
  return { rank: facts.review ? 2 : facts.debug ? 0 : 1, flowChild: facts.flowChild };
}

/**
 * Review-exit spec 2026-11-05 §3.4 (D4): inside an explicit start's transaction, after every refusal. The cap counts every
 * other group holding a slot; a flow child is exempt (its parent holds the slot). A free slot (or a flow child) answers
 * null and the caller starts. A full cap records the group as wanting to run -- `mode = run`, `hold` cleared, no start
 * recorded; no row yet ⇒ one at this command's revision -- keeps any refusal (the pass counts its attempts from it), and
 * answers `ahead`: the groups before it in the pass's order that would start now if a slot were free (backoff not counted).
 */
export function queueStartForSlot(store: ControlStore, input: { groupId: string; revision: number; actorId: string; commandId: string; now: number; prerequisites: PrerequisiteReader }): number | null {
  const { groupId } = input;
  const facts = groupFacts(store).find((group) => group.id === groupId);
  if (facts?.flowChild === true) return null;
  const others = runningGroupIds(store).filter((id) => id !== groupId).length;
  if (others < readOrchestrationSettings(store).maxRunningGroups) return null;
  const current = readGroupOrchestration(store, groupId);
  const auto = input.actorId === ORCHESTRATION_ACTOR;
  const queued = auto ? current?.queued : { commandId: input.commandId, actorId: input.actorId };
  const slotRaces = auto ? (current?.slotRaces ?? 0) + 1 : current?.slotRaces;
  writeGroupOrchestration(store, groupId, {
    mode: "run", confirmRevision: current?.confirmRevision ?? input.revision, confirmedAt: current?.confirmedAt ?? input.now,
    startedRevision: null, refusal: current?.refusal ?? null,
    ...(queued === undefined ? {} : { queued }), ...(slotRaces === undefined ? {} : { slotRaces }),
  });
  let ahead = 0;
  for (const { group } of passCandidates(store)) {
    if (group.id === groupId) break;
    if (autoStartState(store, group, input.now, false, input.prerequisites).kind === "waiting-slot") ahead += 1;
  }
  return ahead;
}

/**
 * One pass: start every eligible group while slots are free. Debug groups (a correction's fix) go first so a fix is not
 * starved by ordinary groups (spec §3.2, builder's call: admitted first); then by confirm time. A refusal is recorded
 * with its backoff and the pass moves on to the next group.
 */
export async function autoStartPass(deps: AutoStartDeps): Promise<{ started: string[]; refused: Array<{ groupId: string; code: string }> }> {
  const { store } = deps;
  const prerequisites = deps.prerequisites ?? noPrerequisites;
  const started: string[] = [], refused: Array<{ groupId: string; code: string }> = [];
  for (const { group } of passCandidates(store)) {
    const { running, cap } = slotUse(store);
    const state = autoStartState(store, group, deps.now(), running < cap || group.flowChild, prerequisites);
    if (state.kind !== "eligible") continue;
    const row = readGroupOrchestration(store, group.id)!;
    const revision = store.db.prepare("SELECT revision FROM groups WHERE id=?").get(group.id);
    if (revision === undefined) continue;
    const attempt = (row.refusal?.count ?? 0) + 1;
    // Review-exit spec §3.4: a start that lost the slot to another was booked queued under its id, so the next one is new.
    const raced = row.slotRaces === undefined ? "" : `-q${row.slotRaces}`;
    const body = await deps.start({
      schema: "orca-raw-command-v1", commandId: `orca-auto-start-${row.confirmRevision}-${attempt}${raced}`, actorId: ORCHESTRATION_ACTOR,
      expectedRevision: Number(revision.revision), verb: "start", target: { kind: "group", groupId: group.id }, payload: {},
    });
    const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    // Review-exit spec §3.4: the cap filled between this pass's check and the start's transaction -- not started, and no
    // refusal (nothing is wrong with the group; it waits for the next free slot).
    if (error === undefined && (body as { result?: { kind?: unknown } } | null)?.result?.kind === "queued-for-slot") continue;
    if (error === undefined) { started.push(group.id); continue; }
    const code = typeof error.code === "string" ? error.code : "unknown";
    store.transaction(() => recordAutoStartRefused(store, group.id, code, typeof error.message === "string" ? error.message.slice(0, 500) : null, deps.now()));
    refused.push({ groupId: group.id, code });
  }
  return { started, refused };
}

/** The summary's view of it (board card, needs-you): null when the group has no orchestration row. */
export function orchestrationSummary(store: ControlStore, group: { id: string; status: string }, now: number, prerequisites: PrerequisiteReader = noPrerequisites, executing?: boolean):
  { mode: "run" | "hold"; state: Exclude<AutoStartState["kind"], "none" | "eligible"> | "queued"; waitingFor: string[]; refusal: { code: string; count: number; persistent: boolean } | null } | null {
  const row = readGroupOrchestration(store, group.id);
  if (row === null) return null;
  const { running, cap } = slotUse(store);
  const state = autoStartState(store, group, now, running < cap, prerequisites, executing);
  const refusal = row.refusal === null ? null : { code: row.refusal.code, count: row.refusal.count, persistent: row.refusal.count >= PERSISTENT_REFUSALS };
  return {
    mode: row.mode,
    state: state.kind === "none" ? "started" : state.kind === "eligible" ? "queued" : state.kind,
    waitingFor: state.kind === "waiting-prerequisite" ? state.waitingFor : [],
    refusal: state.kind === "started" ? null : refusal,
  };
}
