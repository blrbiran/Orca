import { syncWebBudget } from "./budget.js";
import { expectationModelApplies, hardCapOf } from "./expectationModel.js";
import { groupHeadroom, liveCeilingOf, pauseLineOf, runCeiling, syncCeilingReserve, type LiveCeilingCause } from "./liveCeiling.js";
import { readGroup, readWork, saveGroup } from "./queries.js";
import { recordProjectionChange } from "./projectionJournal.js";
import { capStatuses } from "./spendCaps.js";
import type { ControlStore } from "./store.js";
import { groupRepoIdOf } from "./usageLedger.js";
import { nextClaimableTask } from "./webDispatch.js";

/**
 * Tester follow-up G spec §2.1 (plan Part B, O3, D2): while a finite expectation-model group has free headroom and no task
 * waiting to be claimed, its running group-bound runs share that headroom equally -- each ceiling grows by
 * floor(H / runs), capped again by the run's pause line or hard cap. While a claimable task exists the headroom is left
 * for its claim, so later tasks are never starved. A group under a spend cap gets no raises (plan D7, gap). The raise is
 * written -- and so reserved -- before ccloop is told (the driver's deliverLiveCeilings), so a crash in between holds the
 * reservation and the next pass delivers it.
 */
export interface CeilingRaise { runId: string; revision: number; tokens: number; cause: LiveCeilingCause }

export function planCeilingRaises(store: ControlStore, groupId: string, at: number): CeilingRaise[] {
  const group = readGroup(store, groupId);
  if (!expectationModelApplies(group) || group.stopped) return [];
  const headroom = groupHeadroom(group);
  if (headroom === null || headroom <= 0) return [];
  if (capStatuses(store, groupRepoIdOf(group as unknown as Record<string, unknown>), at).length > 0) return [];
  if (nextClaimableTask(store, groupId) !== null) return [];
  const running: Array<{ runId: string; workItemId: string; revision: number; tokens: number }> = [];
  for (const row of store.db.prepare("SELECT id,work_item_id,body FROM runs WHERE group_id=? AND active=1 ORDER BY id").all(groupId)) {
    const ceiling = liveCeilingOf(JSON.parse(String(row.body)));
    if (ceiling === null || ceiling.cause !== "group") continue;
    running.push({ runId: String(row.id), workItemId: String(row.work_item_id), revision: ceiling.revision, tokens: ceiling.tokens });
  }
  if (running.length === 0) return [];
  const delta = Math.floor(headroom / running.length);
  if (delta <= 0) return [];
  const raises: CeilingRaise[] = [];
  for (const run of running) {
    const work = readWork(store, groupId, run.workItemId);
    const inherited = inheritedWorkUsageBefore(store, groupId, run.workItemId);
    const hard = hardCapOf(work);
    const pause = hard === null ? pauseLineOf(store, group, work)?.line ?? null : null;
    const next = runCeiling({ groupSliceTokens: run.tokens + delta, pauseLineTokens: pause, hardCapTokens: hard, inheritedTaskTokens: inherited });
    if (next === null || next.tokens <= run.tokens) continue;
    raises.push({ runId: run.runId, revision: run.revision + 1, tokens: next.tokens, cause: next.cause });
  }
  return raises;
}

/** The task's work tokens in its earlier runs (the running one excluded), as the claim's inherited usage counts them. */
function inheritedWorkUsageBefore(store: ControlStore, groupId: string, workItemId: string): number {
  let tokens = 0;
  for (const row of store.db.prepare("SELECT body,active FROM runs WHERE group_id=? AND work_item_id=? ORDER BY rowid").all(groupId, workItemId)) {
    if (row.active === 1) continue;
    const run = JSON.parse(String(row.body)) as { cumulative?: { work?: { tokens?: number } } };
    tokens += run.cumulative?.work?.tokens ?? 0;
  }
  return tokens;
}

/** Write the raises (call inside a transaction): each run's ceiling and revision, then the group's reserve with them. */
export function applyCeilingRaises(store: ControlStore, groupId: string, raises: readonly CeilingRaise[]): void {
  if (raises.length === 0) return;
  for (const raise of raises) {
    const row = store.db.prepare("SELECT body FROM runs WHERE id=?").get(raise.runId);
    if (!row) continue;
    const run = JSON.parse(String(row.body)) as Record<string, unknown>;
    const ceiling = liveCeilingOf(run)!;
    run.liveCeiling = { ...ceiling, revision: raise.revision, tokens: raise.tokens, cause: raise.cause };
    store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(run), raise.runId);
  }
  const group = readGroup(store, groupId);
  syncCeilingReserve(store, group);
  syncWebBudget(store, group, null);
  saveGroup(store, group);
  recordProjectionChange(store, [groupId]);
}

/** Every expectation-model group that holds a ceiling: plan and write its raises. Answers the runs raised. */
export function raiseCeilings(store: ControlStore, at: number): string[] {
  const raised: string[] = [];
  for (const row of store.db.prepare("SELECT id FROM groups WHERE json_extract(body,'$.liveCeilingReserved') IS NOT NULL ORDER BY id").all()) {
    const groupId = String(row.id);
    const raises = planCeilingRaises(store, groupId, at);
    applyCeilingRaises(store, groupId, raises);
    raised.push(...raises.map(raise => raise.runId));
  }
  return raised;
}
