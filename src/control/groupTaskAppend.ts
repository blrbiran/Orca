import { add } from "./budget.js";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { ControlError } from "./errors.js";
import { deriveContract } from "./executionSnapshot.js";
import { hasTokenPolicy, saveTokenPolicy } from "./fundedAllowance.js";
import { recordProjectionChange } from "./projectionJournal.js";
import { readArchivedPlan, readBudgetProposal } from "./queries.js";
import { readCanonicalRecord, writeCanonicalRecord } from "./snapshot.js";
import { reserveCommitment } from "./stopIntent.js";
import { taskContractSchema } from "../scheduler/planFile.js";
import type { z } from "zod";
type TaskContract = z.infer<typeof taskContractSchema>;
import { executionSnapshotSchema } from "./webProtocol.js";
import type { ControlStore } from "./store.js";
import type { Amount } from "./types.js";
import { finiteCommitment, type BudgetAmount } from "./tokenPolicy.js";

/**
 * Tester follow-up G spec §3.4 (human: 「自动在同一组里开一个修复任务」): a task appended to a confirmed group -- the
 * requirement review's fix task. The archived plan's bytes are never rewritten (every estimate and hash made from it still
 * reads): the task is recorded on the group body (`appendedTasks`, read back by readArchivedPlan) with its contract as a
 * canonical record, and the confirmed snapshot gains its derived contract, allocations and frozen agent (copied from an
 * existing task), every other entry byte for byte. Its allocations come out of the group's unallocated reserve.
 */
export interface AppendTaskInput { taskId: string; contract: TaskContract; agentFrom: string; work: BudgetAmount; handoff: Amount; dependsOn: string[] }

const compare = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);
const keyOf = (a: { ownerKind: string; ownerId: string; bucket: string }) => `${a.ownerKind}\0${a.ownerId}\0${a.bucket}`;

export function appendConfirmedTaskInTransaction(store: ControlStore, groupId: string, input: AppendTaskInput): { derivedContractHash: string; executionSnapshotHash: string } {
  if (store.db.prepare("SELECT 1 FROM runs WHERE group_id=? AND active=1").get(groupId) !== undefined) throw new ControlError("recovery-blocked", "append-while-active");
  if (store.db.prepare("SELECT 1 FROM work_items WHERE group_id=? AND id=?").get(groupId, input.taskId) !== undefined) throw new ControlError("duplicate-task-id", input.taskId);
  const plan = readArchivedPlan(store, groupId);
  const proposal = readBudgetProposal(store, groupId);
  if (proposal.state !== "confirmed" || proposal.executionSnapshotHash === null) throw new ControlError("group-state-invalid");
  const contract = taskContractSchema.parse(input.contract);
  if (contract.objective.taskId !== input.taskId) throw new ControlError("recovery-blocked", "append-task-id");
  const missing = input.dependsOn.find((id) => !plan.plan.tasks.some((task) => task.taskId === id));
  if (missing !== undefined) throw new ControlError("recovery-blocked", `append-dependency:${missing}`);
  // The reserve must fund both allocations in every finite dimension, or nothing is written.
  // A work grant with no token number (expectation model) commits no tokens, as confirm commits it (finiteCommitment).
  const total = add(finiteCommitment(input.work), input.handoff);
  for (const d of ["tokens", "activeMs", "attempts", "sessions"] as const) {
    const left = proposal.explicitUnallocatedReserve[d];
    if (left !== null && left < total[d]) throw new ControlError("group-budget-unavailable", d);
  }
  const source = readWorkBody(store, groupId, input.agentFrom);
  const originalContractCanonicalJson = canonicalBytes(contract).toString("utf8"), originalContractHash = sha256Canonical(contract);
  writeCanonicalRecord(store, groupId, originalContractHash, originalContractCanonicalJson);
  const entry = { taskId: input.taskId, dependencyTaskIds: [...new Set(input.dependsOn)].sort(compare), targetVersion: 1, originalContractHash, originalContractCanonicalJson };
  const derived = deriveContract({ ...entry, work: input.work, handoff: input.handoff } as never, proposal.proposalVersion);
  writeCanonicalRecord(store, groupId, derived.derivedContractHash, derived.canonicalJson);
  // The snapshot: this task's entries added, every other entry byte for byte.
  const snapshot = executionSnapshotSchema.parse(JSON.parse(readCanonicalRecord(store, proposal.executionSnapshotHash)));
  const fromAgent = snapshot.agents.tasks.find((task) => task.taskId === input.agentFrom);
  const sourceAllocation = proposal.allocations.find((a) => a.ownerKind === "task" && a.ownerId === input.agentFrom && a.bucket === "work");
  if (fromAgent === undefined || sourceAllocation === undefined) throw new ControlError("recovery-blocked", "append-agent-source");
  const allocations = (["work", "handoff"] as const).map((bucket) => ({ ownerKind: "task" as const, ownerId: input.taskId, bucket, amount: { ...input[bucket] }, fieldProvenance: structuredClone(sourceAllocation.fieldProvenance) }));
  const next = structuredClone(snapshot);
  next.derivedContracts = [...next.derivedContracts, { taskId: input.taskId, derivedContractHash: derived.derivedContractHash }].sort((l, r) => compare(l.taskId, r.taskId));
  next.allocations = [...next.allocations, ...allocations as never[]].sort((l, r) => compare(keyOf(l), keyOf(r)));
  next.agents = { ...next.agents, tasks: [...next.agents.tasks, { ...fromAgent, taskId: input.taskId }].sort((l, r) => compare(l.taskId, r.taskId)) };
  const parsed = executionSnapshotSchema.parse(next);
  const executionSnapshotHash = sha256Canonical(parsed);
  writeCanonicalRecord(store, groupId, executionSnapshotHash, canonicalBytes(parsed).toString("utf8"));
  // The group body names the task and the new snapshot; the proposal its two confirmed allocations.
  const groupRow = JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body)) as Record<string, unknown> & { proposal: Record<string, unknown> };
  groupRow.appendedTasks = [...((groupRow.appendedTasks as unknown[] | undefined) ?? []), entry];
  groupRow.proposal = { ...groupRow.proposal, executionSnapshotHash };
  groupRow.status = "running";
  store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(groupRow), groupId);
  const nextProposal = { ...proposal, executionSnapshotHash, allocations: [...proposal.allocations, ...allocations.map((a) => ({ ...a, state: "confirmed" as const }))].sort((l, r) => compare(keyOf(l), keyOf(r))) };
  store.db.prepare("UPDATE budget_proposals SET body=? WHERE group_id=?").run(canonicalBytes(nextProposal).toString("utf8"), groupId);
  // Confirmed allocations are committed: the group's reserved amount rises and the reserve row is recomputed from it.
  reserveCommitment(store, groupId, total);
  const work = {
    workItemId: input.taskId, taskId: input.taskId, kind: "task", dependsOn: entry.dependencyTaskIds, contract: { contentAddressedHash: originalContractHash },
    configHash: source.configHash, grant: { work: { ...input.work }, handoff: { ...input.handoff } }, targetVersion: 1, status: "ready",
    originalContractHash, derivedContractHash: derived.derivedContractHash, agentOverride: null,
    agent: source.agent, agentProvenance: source.agentProvenance, timeoutMs: source.timeoutMs, killGraceMs: source.killGraceMs, agentCapabilities: source.agentCapabilities,
    lineageRunIds: [],
  };
  store.db.prepare("INSERT INTO work_items(group_id,id,target_version,body) VALUES (?,?,?,?)").run(groupId, input.taskId, 1, JSON.stringify(work));
  saveTokenPolicy(store, groupId, input.taskId, input.work.tokens, hasTokenPolicy(store, groupId) ? "optional-v1" : "finite-legacy");
  recordProjectionChange(store, [groupId]);
  return { derivedContractHash: derived.derivedContractHash, executionSnapshotHash };
}

function readWorkBody(store: ControlStore, groupId: string, taskId: string): Record<string, unknown> {
  const row = store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(groupId, taskId);
  if (!row) throw new ControlError("recovery-blocked", "append-agent-source");
  return JSON.parse(String(row.body));
}
