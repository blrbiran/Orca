import { recordActivity } from "./activity.js";
import { expectationModelApplies, hardCapOf, taskExpectation } from "./expectationModel.js";
import { readWork, saveWork, type GroupRecord } from "./queries.js";
import type { ControlStore } from "./store.js";

/**
 * Tester follow-up G spec §2.4 (plan Part B, O6): the first time a task's work tokens pass its expectation, one
 * `usage-over-expectation` row and a mark on the work item (`overExpectation`, the Board's amber hint). Nothing stops.
 * Only known usage counts: a run of the task with unknown or approximate usage writes nothing (it is not known to be over).
 * A hard-capped task has no expectation, so no hint. Call inside recordUsage's transaction, with the run being booked.
 */
export function noteOverExpectation(store: ControlStore, group: GroupRecord, current: { runId: string; workItemId: string; taskId: string | null; unknown: { work: boolean }; cumulative: { work: { tokens: number } } }, at: number): boolean {
  if (current.taskId === null || !expectationModelApplies(group)) return false;
  if ((current as { phase?: string }).phase !== undefined && (current as { phase?: string }).phase !== "work") return false;
  const work = readWork(store, group.groupId, current.workItemId) as unknown as Record<string, unknown> & { kind: string; taskId: string | null };
  if (work.kind !== "task" || work.overExpectation !== undefined || hardCapOf(work) !== null) return false;
  const expectation = taskExpectation(store, group.groupId, work);
  if (expectation === null) return false;
  let used = 0;
  for (const row of store.db.prepare("SELECT id,body FROM runs WHERE group_id=? AND work_item_id=?").all(group.groupId, current.workItemId)) {
    const run = String(row.id) === current.runId ? current : JSON.parse(String(row.body)) as typeof current;
    if (run.unknown.work || (run as { usageApproximate?: unknown }).usageApproximate !== undefined) return false;
    used += run.cumulative.work.tokens;
  }
  if (used <= expectation.tokens) return false;
  work.overExpectation = { at, usedTokens: used, expectationTokens: expectation.tokens };
  saveWork(store, group.groupId, work as never);
  recordActivity(store, { groupId: group.groupId, taskId: current.taskId, runId: current.runId, kind: "usage-over-expectation",
    body: { usedTokens: used, expectationTokens: expectation.tokens, ratio: Math.round((used / expectation.tokens) * 10) / 10 } });
  return true;
}
