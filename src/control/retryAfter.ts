import { detectCycle } from "../scheduler/graph.js";
import { ControlError } from "./errors.js";
import { readWebGroup, saveWebAuthority } from "./estimateSettlement.js";
import { deriveContract, offPlanEntryOf, replaceTaskInSnapshot } from "./executionSnapshot.js";
import { recordProjectionChange } from "./projectionJournal.js";
import { readArchivedPlan, readBudgetProposal } from "./queries.js";
import { amountSchema } from "./schema.js";
import { readCanonicalRecord, writeCanonicalRecord } from "./snapshot.js";
import type { ControlStore } from "./store.js";
import { effectivePlanTask, workBodyOf } from "./taskAmendments.js";
import { executionSnapshotSchema } from "./webProtocol.js";

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const sortedUnique = (values: readonly string[]): string[] => [...new Set(values)].sort(compare);

/**
 * Off-plan writes W4 (#346, plan Task 6; human ruling on W4, 2026-11-17): what `retry-task --after <sibling>` refuses before
 * it changes anything. `allowObservedPaths` widens the allowlist of a v<=3 task and `after` orders a v4 task, so the two
 * are never combined; `after` must be one of the task's frozen siblings; and the sibling appended to the work item's
 * `dependsOn` must leave the group's work graph acyclic (two siblings each retried after the other: the second is refused
 * and stays with a person).
 * Controller ruling (2026-11-18): refused while the task's current run is live and not stopped (`blocked`) -- a frozen
 * entry rewritten under a running attempt would diverge from that run's envelope. A blocked run is the one this retry
 * settles in the same transaction.
 */
export function refuseRetryAfter(store: ControlStore, groupId: string, taskId: string, after: string, run: { state?: unknown }, live: boolean, allowObservedPaths: boolean): void {
  if (allowObservedPaths) throw new ControlError("after-with-observed-paths");
  if (live && run.state !== "blocked") throw new ControlError("after-task-has-live-run", String(run.state));
  const proposal = readBudgetProposal(store, groupId);
  if (!proposal.executionSnapshotHash) throw new ControlError("group-state-invalid");
  const snapshot = executionSnapshotSchema.parse(JSON.parse(readCanonicalRecord(store, proposal.executionSnapshotHash)));
  if (!offPlanEntryOf(snapshot, taskId).some(sibling => sibling.siblingId === after)) throw new ControlError("after-not-a-sibling", after);
  const work = store.db.prepare("SELECT id,body FROM work_items WHERE group_id=?").all(groupId)
    .map(row => { const body = JSON.parse(String(row.body)) as { dependsOn?: string[] }; return { taskId: String(row.id), dependsOn: [...(body.dependsOn ?? [])] }; });
  for (const item of work) if (item.taskId === taskId) item.dependsOn = sortedUnique([...item.dependsOn, after]);
  if (detectCycle(work)) throw new ControlError("after-cycle", after);
}

/**
 * The amendment itself, in the retry's transaction (after refuseRetryAfter): the work item's `dependsOn` gains `after`
 * (sorted, unique; `afterDependsOn` records what `--after` added beyond the archived plan's edges, which stay as they
 * are), the task's frozen entry loses `after`'s claims, and its contract is re-derived from them -- the same derivation
 * readConfirmedTaskExecution checks -- with the snapshot rewritten through replaceTaskInSnapshot. Every other task's
 * entry, contract and allocation is copied as it is.
 */
export function applyRetryAfter(store: ControlStore, groupId: string, taskId: string, after: string): void {
  const proposal = readBudgetProposal(store, groupId);
  const snapshot = executionSnapshotSchema.parse(JSON.parse(readCanonicalRecord(store, proposal.executionSnapshotHash!)));
  const archived = readArchivedPlan(store, groupId).plan.tasks.find(task => task.taskId === taskId);
  const body = workBodyOf(store, groupId, taskId) as Record<string, unknown> & { dependsOn: string[]; afterDependsOn?: string[] };
  const workAllocation = snapshot.allocations.find(a => a.ownerKind === "task" && a.ownerId === taskId && a.bucket === "work");
  const handoffAllocation = snapshot.allocations.find(a => a.ownerKind === "task" && a.ownerId === taskId && a.bucket === "handoff");
  if (archived === undefined || body === null || workAllocation === undefined || handoffAllocation === undefined) throw new ControlError("recovery-blocked", "retry-after-task");
  const task = effectivePlanTask(store, groupId, archived, body);
  const siblings = offPlanEntryOf(snapshot, taskId).filter(sibling => sibling.siblingId !== after);
  const derived = deriveContract({ ...task, work: workAllocation.amount, handoff: amountSchema.parse(handoffAllocation.amount) }, proposal.proposalVersion, siblings);
  const frozenSkill = snapshot.skills?.find(entry => entry.taskId === taskId);
  const rebuilt = replaceTaskInSnapshot(snapshot, taskId, derived.derivedContractHash, { work: workAllocation, handoff: handoffAllocation },
    frozenSkill === undefined ? null : { profile: frozenSkill.profile, names: [...frozenSkill.names] }, siblings);
  writeCanonicalRecord(store, groupId, derived.derivedContractHash, derived.canonicalJson);
  writeCanonicalRecord(store, groupId, rebuilt.snapshotHash, rebuilt.canonicalJson);
  const next = { ...body, dependsOn: sortedUnique([...body.dependsOn, after]), afterDependsOn: sortedUnique([...(body.afterDependsOn ?? []), after]), derivedContractHash: derived.derivedContractHash };
  store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id=?").run(JSON.stringify(next), groupId, taskId);
  proposal.executionSnapshotHash = rebuilt.snapshotHash;
  saveWebAuthority(store, readWebGroup(store, groupId), proposal);
  recordProjectionChange(store, [groupId]);
}
