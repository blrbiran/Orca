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

/** The part of an active run's ceiling it has not used yet; 0 for a run without one. */
export function ceilingOutstanding(run: { liveCeiling?: unknown; cumulative: { work: { tokens: number } } }): number {
  const ceiling = liveCeilingOf(run);
  return ceiling === null ? 0 : Math.max(0, ceiling.tokens - run.cumulative.work.tokens);
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
 * `liveCeilingReserved` is set to the new total. `current` is a run whose newest body is not stored yet (a usage booking).
 * Mutates `group`; the caller saves it (and its Web ledger mirror).
 */
export function syncCeilingReserve(store: ControlStore, group: GroupRecord, current?: { runId: string; liveCeiling?: unknown; cumulative: { work: { tokens: number } } }): boolean {
  let target = 0;
  for (const row of store.db.prepare("SELECT id,body FROM runs WHERE group_id=? AND active=1").all(group.groupId)) {
    const run = current !== undefined && String(row.id) === current.runId ? current : JSON.parse(String(row.body));
    target += ceilingOutstanding(run);
  }
  const held = (group as { liveCeilingReserved?: number }).liveCeilingReserved ?? 0;
  if (target === held) return false;
  const tokens = group.reserved.tokens + target - held;
  if (tokens < 0) throw new ControlError("recovery-blocked", "live-ceiling-reserve");
  group.reserved = { ...group.reserved, tokens };
  (group as { liveCeilingReserved?: number }).liveCeilingReserved = target;
  return true;
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
export function refreshCeilingReserves(store: ControlStore): string[] {
  const moved: string[] = [];
  for (const row of store.db.prepare("SELECT id FROM groups WHERE json_extract(body,'$.liveCeilingReserved') IS NOT NULL ORDER BY id").all()) {
    const group = readGroup(store, String(row.id));
    if (!syncCeilingReserve(store, group)) continue;
    syncWebBudget(store, group, null);
    saveGroup(store, group);
    moved.push(group.groupId);
  }
  return moved;
}
