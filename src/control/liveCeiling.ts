import { z } from "zod";
import { ControlError } from "./errors.js";
import { expectationModelApplies, hardCapOf, pauseLineFor, taskExpectation } from "./expectationModel.js";
import type { GroupRecord } from "./queries.js";
import { readGroup, saveGroup } from "./queries.js";
import { syncWebBudget } from "./budget.js";
import { safeInteger } from "./schema.js";
import type { ControlStore } from "./store.js";

/**
 * Tester follow-up G spec §2.1 / §2.5 (plan Part B, D1-D3): each running task run of an expectation-model group carries a
 * live token ceiling ccloop stops it at (mid-call for claude and omp, between turns for codex). The ceiling is the
 * smallest of the run's slice of the group's remainder, the task's pause line and a person's hard cap, each less what the
 * task's earlier runs used. Its outstanding part -- the ceiling less what the run has used -- is held in the group's
 * reserve while the run is active, so the sum of the ceilings never passes what the group has left (D2).
 *
 * Where it lives (builder's call, reversible): on the run body as `liveCeiling`, and the group's total of outstanding
 * ceilings as `liveCeilingReserved` on the group body, a part of `group.reserved`. Re-derived from the active runs by
 * syncCeilingReserve, so a run that ends is released on the next sync without each settle path knowing about ceilings.
 */
export type LiveCeilingCause = "group" | "pause-line" | "task-cap";
export const liveCeilingRecordSchema = z.object({
  revision: safeInteger.positive(),
  tokens: safeInteger,
  cause: z.enum(["group", "pause-line", "task-cap"]),
  /** The revision ccloop is known to hold: the one frozen into the start envelope, then each one `live-ceiling` answered. */
  deliveredRevision: safeInteger,
}).strict();
export type LiveCeilingRecord = z.infer<typeof liveCeilingRecordSchema>;

/** The binding bound (plan O2): min over the non-null bounds, each clamped at 0; ties go task-cap, pause-line, group. */
export function runCeiling(input: { groupSliceTokens: number | null; pauseLineTokens: number | null; hardCapTokens: number | null; inheritedTaskTokens: number }): { tokens: number; cause: LiveCeilingCause } | null {
  const candidates: Array<{ tokens: number; cause: LiveCeilingCause }> = [];
  if (input.hardCapTokens !== null) candidates.push({ tokens: Math.max(0, input.hardCapTokens - input.inheritedTaskTokens), cause: "task-cap" });
  if (input.pauseLineTokens !== null) candidates.push({ tokens: Math.max(0, input.pauseLineTokens - input.inheritedTaskTokens), cause: "pause-line" });
  if (input.groupSliceTokens !== null) candidates.push({ tokens: Math.max(0, input.groupSliceTokens), cause: "group" });
  let best: { tokens: number; cause: LiveCeilingCause } | null = null;
  for (const candidate of candidates) if (best === null || candidate.tokens < best.tokens) best = candidate;
  return best;
}

export function liveCeilingOf(run: unknown): LiveCeilingRecord | null {
  const raw = (run as { liveCeiling?: unknown } | null)?.liveCeiling;
  if (raw === undefined) return null;
  const parsed = liveCeilingRecordSchema.safeParse(raw);
  if (!parsed.success) throw new ControlError("recovery-blocked", "live-ceiling-invalid");
  return parsed.data;
}

/**
 * Tester follow-up H (Part B gap): the states of a run whose execution has ended -- collected from ccloop's terminal report,
 * so its work usage is booked in full -- and that may still need a run Orca dispatches for the group (a reconciliation
 * of its landing, the goal judge of its empty result).
 */
const EXECUTION_ENDED = new Set(["collected", "reconciling", "landed", "settled"]);
export function executionEnded(run: { state?: unknown }): boolean {
  return typeof run.state === "string" && EXECUTION_ENDED.has(run.state);
}

/**
 * The part of an active run's ceiling it has not used yet; 0 for a run without one, and 0 once its execution ended
 * (follow-up H): nothing is left for the ceiling to bound, so its unused share returns to the group for the runs Orca
 * dispatches for that landing.
 */
export function ceilingOutstanding(run: { state?: unknown; liveCeiling?: unknown; cumulative: { work: { tokens: number } } }): number {
  const ceiling = liveCeilingOf(run);
  return ceiling === null || executionEnded(run) ? 0 : Math.max(0, ceiling.tokens - run.cumulative.work.tokens);
}

/** The reconcile record fields the funding reads (driveRecord.ts ReconcileRecord). */
type ReconcileFunding = { tokenBudget?: unknown; spawning?: unknown; spawnSeq?: unknown; fundingWait?: unknown };
const reconcileOf = (run: unknown): ReconcileFunding | null =>
  (run as { state?: unknown }).state === "reconciling" ? ((run as { drive?: { reconcile?: ReconcileFunding | null } }).drive?.reconcile ?? null) : null;

/**
 * Tester follow-up H: a reconciliation spawned and not yet booked is held in the group's reserve at its whole token budget,
 * so no claim or raise hands that share to a task run while it spends (the group cap stays hard). Its booking
 * (driverLanding.ts recordReconcileUsage) writes the `reconcile-usage:<run>:spawn-<n>` row; the next re-derivation drops
 * the hold (until then the spend is held twice -- the safe direction).
 */
export function reconcileInFlight(store: ControlStore, runId: string, run: unknown): number {
  const record = reconcileOf(run);
  if (record === null || record.spawning !== true || typeof record.tokenBudget !== "number") return 0;
  const booked = store.db.prepare("SELECT 1 FROM outbox WHERE id=?").get(`reconcile-usage:${runId}:spawn-${typeof record.spawnSeq === "number" ? record.spawnSeq : 0}`);
  return booked === undefined ? record.tokenBudget : 0;
}

/**
 * Tester follow-up H: the token budgets of the group's reconciliations that wait for funds the running ceilings hold
 * (driverLanding.ts reconcileFunding "wait"). A claim leaves them aside, so the tokens those runs give back on ending go
 * to the reconciliation first; the hold ends with the wait (spawned, blocked, or reset).
 */
export function reconcileWaitTokens(store: ControlStore, groupId: string): number {
  let tokens = 0;
  for (const row of store.db.prepare("SELECT body FROM runs WHERE group_id=? AND active=1").all(groupId)) {
    const record = reconcileOf(JSON.parse(String(row.body)));
    if (record !== null && record.spawning !== true && typeof record.fundingWait === "number") tokens += record.fundingWait;
  }
  return tokens;
}

/** Tester follow-up H: the unused ceilings of the group's runs still executing -- what their ending can give back. */
export function workingCeilingOutstanding(store: ControlStore, groupId: string): number {
  let tokens = 0;
  for (const row of store.db.prepare("SELECT body FROM runs WHERE group_id=? AND active=1").all(groupId)) tokens += ceilingOutstanding(JSON.parse(String(row.body)));
  return tokens;
}

/** Tester follow-up H: true while an active run of the group has ended its execution and not yet left (see executionEnded). */
export function endedRunActive(store: ControlStore, groupId: string): boolean {
  for (const row of store.db.prepare("SELECT body FROM runs WHERE group_id=? AND active=1").all(groupId)) if (executionEnded(JSON.parse(String(row.body)))) return true;
  return false;
}

/** The task's pause line as a whole-lineage token total (spec §2.5), or null when it has none. */
export interface PauseState { multiple: number; taskUsedAtDecision: number; groupUsedAtDecision: number }
export function pauseStateOf(work: unknown): PauseState {
  const raw = (work as { pauseLine?: Partial<PauseState> } | null)?.pauseLine;
  return { multiple: raw?.multiple ?? 1, taskUsedAtDecision: raw?.taskUsedAtDecision ?? 0, groupUsedAtDecision: raw?.groupUsedAtDecision ?? 0 };
}
export function pauseLineOf(store: ControlStore, group: GroupRecord, work: { taskId: string | null }): { line: number; expectationTokens: number; multiple: number } | null {
  const expectation = taskExpectation(store, group.groupId, work);
  if (expectation === null) return null;
  const state = pauseStateOf(work);
  const limit = (group.limit as { tokens: number | null }).tokens;
  return { line: pauseLineFor({ expectationTokens: expectation.tokens, multiple: state.multiple, groupLimitTokens: limit, taskUsedAtDecision: state.taskUsedAtDecision, groupUsedAtDecision: state.groupUsedAtDecision }), expectationTokens: expectation.tokens, multiple: state.multiple };
}

/**
 * The ceiling a claim gives a task run of an expectation-model group (plan O2), or null: the group's slice (null in an
 * unlimited group), the task's pause line and a person's hard cap -- the last two less the task's earlier runs' tokens.
 * A hard cap has no pause line (spec §10.3).
 */
export function claimCeiling(store: ControlStore, groupId: string, work: { taskId: string | null }, groupSliceTokens: number | null, inheritedTaskTokens: number): { tokens: number; cause: LiveCeilingCause } | null {
  const group = readGroup(store, groupId);
  if (!expectationModelApplies(group)) return null;
  const hard = hardCapOf(work);
  const pause = hard === null ? pauseLineOf(store, group, work)?.line ?? null : null;
  return runCeiling({ groupSliceTokens, pauseLineTokens: pause, hardCapTokens: hard, inheritedTaskTokens });
}

/**
 * Re-derive the group's reserve for live ceilings from its active runs: `group.reserved.tokens` moves by the difference and
 * `liveCeilingReserved` is set to the new total -- the unused ceilings of the runs still executing plus, follow-up H, the
 * budgets of the reconciliations in flight (reconcileInFlight). `current` is a run whose newest body is not stored yet (a usage booking).
 * Mutates `group`; the caller saves it (and its Web ledger mirror).
 */
export function syncCeilingReserve(store: ControlStore, group: GroupRecord, current?: { runId: string; liveCeiling?: unknown; cumulative: { work: { tokens: number } } }): boolean {
  let target = 0;
  for (const row of store.db.prepare("SELECT id,body FROM runs WHERE group_id=? AND active=1").all(group.groupId)) {
    const run = current !== undefined && String(row.id) === current.runId ? current : JSON.parse(String(row.body));
    target += ceilingOutstanding(run) + reconcileInFlight(store, String(row.id), run);
  }
  const held = (group as { liveCeilingReserved?: number }).liveCeilingReserved ?? 0;
  if (target === held) return false;
  const tokens = group.reserved.tokens + target - held;
  if (tokens < 0) throw new ControlError("recovery-blocked", "live-ceiling-reserve");
  group.reserved = { ...group.reserved, tokens };
  (group as { liveCeilingReserved?: number }).liveCeilingReserved = target;
  return true;
}

/**
 * Tester follow-up H: re-derive an expectation-model group's ceiling reserve now and store it when it moved -- before a
 * funding check of a run Orca dispatches for the group, so a share an ended run gave back is seen without waiting for the
 * driver's next pass. Call inside a transaction.
 */
export function freshCeilingReserve(store: ControlStore, groupId: string): void {
  const group = readGroup(store, groupId);
  if (!expectationModelApplies(group) || !syncCeilingReserve(store, group)) return;
  syncWebBudget(store, group, null);
  saveGroup(store, group);
}

/** Free headroom of a finite group: what neither its booked usage nor any reservation (ceilings included) holds. */
export function groupHeadroom(group: GroupRecord): number | null {
  const limit = (group.limit as { tokens: number | null }).tokens;
  return limit === null ? null : Math.max(0, limit - group.used.tokens - group.reserved.tokens);
}

/**
 * Every group that has held a ceiling: re-derive its reserve from its active runs (a run that ended since gives its
 * outstanding part back here). Answers the groups whose reserve moved. Call inside a transaction.
 */
export function ceilingGroupIds(store: ControlStore): string[] {
  // Backlog #3: a group row that does not read is skipped here; it is named by the step that owns it, never by this sweep.
  const ids: string[] = [];
  for (const row of store.db.prepare("SELECT id,body FROM groups WHERE body LIKE '%\"liveCeilingReserved\"%' ORDER BY id").all()) {
    try { if ((JSON.parse(String(row.body)) as { liveCeilingReserved?: unknown }).liveCeilingReserved !== undefined) ids.push(String(row.id)); } catch { continue; }
  }
  return ids;
}

export function refreshCeilingReserves(store: ControlStore): string[] {
  const moved: string[] = [];
  for (const groupId of ceilingGroupIds(store)) {
    // Reads only, before any write: a row that does not read skips its group, never the round (backlog #3).
    let group: GroupRecord;
    try { group = readGroup(store, groupId); if (!syncCeilingReserve(store, group)) continue; } catch { continue; }
    syncWebBudget(store, group, null);
    saveGroup(store, group);
    moved.push(group.groupId);
  }
  return moved;
}
