import { frozenWorkAgent, type FrozenWorkAgent } from "./agentFreeze.js";
import type { FrozenSlot } from "./agentSelection.js";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { ControlError } from "./errors.js";
import { amountSchema, idSchema } from "./schema.js";
import {
  controlPlanSchema,
  executionSnapshotSchema,
  amountProvenanceSchema,
  type AmountProvenanceV1,
  type ControlPlanV1,
  type ExecutionSnapshotV1,
  type ProfileBindingV1,
} from "./webProtocol.js";
import type { Amount } from "./types.js";
import { taskContractSchema } from "../scheduler/planFile.js";
import { readArchivedPlan, readBudgetProposal, readEstimateRecord, readWork } from "./queries.js";
import type { ControlStore } from "./store.js";
import { readCanonicalRecord } from "./snapshot.js";

type ExecutionAllocation = ExecutionSnapshotV1["allocations"][number];
export interface EstimateAllocation {
  ownerKind: "estimate";
  ownerId: string;
  bucket: "work";
  amount: Amount;
  fieldProvenance: AmountProvenanceV1;
}

export interface ConfirmedProposal {
  store: ControlStore;
  groupId: string;
  planHash: string;
  graphVersion: number;
  proposalVersion: number;
  proposalIdentity: { groupId: string; planHash: string; proposalVersion: number };
  groupLimit: Amount;
  budgetMode: "strict" | "soft";
  contextPolicy: { handoffAtContextTokens: number | null };
  profiles: { estimator: ProfileBindingV1; worker: ProfileBindingV1; handoff: ProfileBindingV1; goalReview: ProfileBindingV1 };
  allocations: Array<ExecutionAllocation | EstimateAllocation>;
  tasks: Array<{
    taskId: string;
    originalContractHash: string;
    originalContractCanonicalJson: string;
    work: Amount;
    handoff: Amount;
  }>;
  /** Agent selection spec §6.4 step 4: each task's frozen selection and the group's reconcile slot. */
  agents: ExecutionSnapshotV1["agents"];
}

export interface PreparedExecutionSnapshot {
  snapshot: ExecutionSnapshotV1;
  canonicalJson: string;
  snapshotHash: string;
  derivedContracts: Array<{ taskId: string; canonicalJson: string; contractCanonicalJson: string; derivedContractHash: string }>;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function verifyPlanAuthority(input: ConfirmedProposal): ControlPlanV1 {
  if (input.proposalIdentity.groupId !== input.groupId) throw new ControlError("execution-identity-conflict");
  const archivedPlan = readArchivedPlan(input.store, input.groupId);
  const proposal = readBudgetProposal(input.store, input.groupId);
  if (archivedPlan.graphVersion !== input.graphVersion) throw new ControlError("graph-version-conflict");
  if (archivedPlan.planHash !== input.planHash || input.proposalIdentity.planHash !== input.planHash || proposal.planHash !== input.planHash) {
    throw new ControlError("plan-version-conflict");
  }
  if (input.proposalIdentity.proposalVersion !== input.proposalVersion || proposal.proposalVersion !== input.proposalVersion
    || canonicalBytes(proposal.groupLimit).compare(canonicalBytes(input.groupLimit)) !== 0) {
    throw new ControlError("proposal-version-conflict");
  }
  const suppliedProposalAllocations = input.allocations.filter(allocation => allocation.ownerKind !== "estimate")
    .map(allocation => ({ ownerKind: allocation.ownerKind, ownerId: allocation.ownerId, bucket: allocation.bucket,
      amount: allocation.amount, fieldProvenance: allocation.fieldProvenance }))
    .sort((left, right) => compare(`${left.ownerKind}\0${left.ownerId}\0${left.bucket}`, `${right.ownerKind}\0${right.ownerId}\0${right.bucket}`));
  const archivedProposalAllocations = proposal.allocations.map(({ state: _state, ...allocation }) => allocation);
  if (canonicalBytes(suppliedProposalAllocations).compare(canonicalBytes(archivedProposalAllocations)) !== 0) {
    throw new ControlError("proposal-version-conflict");
  }
  try {
    const plan = controlPlanSchema.parse(JSON.parse(archivedPlan.canonicalJson));
    if (canonicalBytes(plan).toString("utf8") !== archivedPlan.canonicalJson
      || sha256Canonical(plan) !== archivedPlan.planHash
      || canonicalBytes(plan).compare(canonicalBytes(archivedPlan.plan)) !== 0) {
      throw new ControlError("recovery-blocked");
    }
    return plan;
  } catch (error) {
    if (error instanceof ControlError) throw error;
    throw new ControlError("recovery-blocked");
  }
}

function verifyTaskSet(input: ConfirmedProposal, plan: ControlPlanV1): void {
  const supplied = new Map<string, ConfirmedProposal["tasks"][number]>();
  for (const task of input.tasks) {
    if (supplied.has(task.taskId)) throw new ControlError("plan-version-conflict");
    supplied.set(task.taskId, task);
  }
  if (supplied.size !== plan.tasks.length) throw new ControlError("plan-version-conflict");
  for (const authority of plan.tasks) {
    const task = supplied.get(authority.taskId);
    if (!task || task.originalContractHash !== authority.originalContractHash
      || task.originalContractCanonicalJson !== authority.originalContractCanonicalJson) {
      throw new ControlError("plan-version-conflict");
    }
  }
}

function verifyConservation(input: ConfirmedProposal): ExecutionAllocation[] {
  amountSchema.parse(input.groupLimit);
  const total = { tokens: 0n, activeMs: 0n, attempts: 0n, sessions: 0n };
  const seen = new Set<string>();
  const suppliedEstimates = new Map<string, EstimateAllocation>();
  for (const allocation of input.allocations) {
    amountSchema.parse(allocation.amount);
    const key = `${allocation.ownerKind}\0${allocation.ownerId}\0${allocation.bucket}`;
    if (seen.has(key)) throw new ControlError("execution-policy-unrepresentable");
    seen.add(key);
    if (allocation.ownerKind === "estimate") {
      const provenance = amountProvenanceSchema.safeParse(allocation.fieldProvenance);
      if (!idSchema.safeParse(allocation.ownerId).success || allocation.bucket !== "work" || !provenance.success
        || Object.values(allocation.fieldProvenance).some(field => field.provenance !== "system" || field.estimateId !== null)) {
        throw new ControlError("execution-policy-unrepresentable");
      }
      suppliedEstimates.set(allocation.ownerId, allocation);
    }
    for (const dimension of ["tokens", "activeMs", "attempts", "sessions"] as const) {
      total[dimension] += BigInt(allocation.amount[dimension]);
      if (total[dimension] > BigInt(Number.MAX_SAFE_INTEGER)) throw new ControlError("numeric-overflow");
    }
  }
  const estimateRows = input.store.db.prepare("SELECT id FROM estimates WHERE group_id=? ORDER BY id").all(input.groupId);
  const committedEstimates = new Map<string, ReturnType<typeof readEstimateRecord>>();
  for (const row of estimateRows) {
    const estimateId = String(row.id);
    const persisted = readEstimateRecord(input.store, input.groupId, estimateId);
    if (["queued", "running", "start-unknown"].includes(persisted.state)) committedEstimates.set(estimateId, persisted);
  }
  if (committedEstimates.size !== suppliedEstimates.size) throw new ControlError("execution-policy-unrepresentable");
  for (const [estimateId, persisted] of committedEstimates) {
    const supplied = suppliedEstimates.get(estimateId);
    let remaining = persisted.grant;
    if (persisted.state !== "queued") {
      const runs = input.store.db.prepare("SELECT body FROM runs WHERE group_id=? AND work_item_id=? AND active=1").all(input.groupId, estimateId);
      if (runs.length !== 1) throw new ControlError("recovery-blocked");
      remaining = amountSchema.parse(JSON.parse(String(runs[0].body)).remaining.work);
    }
    if (!supplied || canonicalBytes(supplied.amount).compare(canonicalBytes(remaining)) !== 0) {
      throw new ControlError("execution-policy-unrepresentable");
    }
  }
  for (const dimension of ["tokens", "activeMs", "attempts", "sessions"] as const) {
    if (total[dimension] > BigInt(input.groupLimit[dimension])) throw new ControlError("group-budget-unavailable");
  }
  return input.allocations
    .filter((allocation): allocation is ExecutionAllocation => allocation.ownerKind !== "estimate")
    .map(allocation => structuredClone(allocation));
}

function deriveContract(task: ConfirmedProposal["tasks"][number], proposalVersion: number): {
  canonicalJson: string; contractCanonicalJson: string; derivedContractHash: string;
} {
  amountSchema.parse(task.work);
  amountSchema.parse(task.handoff);
  if (task.work.tokens <= 0 || task.work.activeMs <= 0 || task.work.attempts <= 0 || task.work.sessions <= 0) {
    throw new ControlError("execution-policy-unrepresentable");
  }
  let original: Record<string, unknown>;
  try {
    const value = taskContractSchema.parse(JSON.parse(task.originalContractCanonicalJson));
    if (canonicalBytes(value).toString("utf8") !== task.originalContractCanonicalJson || sha256Canonical(value) !== task.originalContractHash) {
      throw new ControlError("recovery-blocked");
    }
    if (value.objective.taskId !== task.taskId) throw new ControlError("execution-policy-unrepresentable");
    original = structuredClone(value) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ControlError) throw error;
    throw new ControlError("execution-policy-unrepresentable");
  }
  const policy = original.executionPolicy;
  if (policy === null || typeof policy !== "object" || Array.isArray(policy) || Object.getPrototypeOf(policy) !== Object.prototype) {
    throw new ControlError("execution-policy-unrepresentable");
  }
  const existing = policy as Record<string, unknown>;
  if (!positiveInteger(existing.perAttemptTimeoutMs) || !Number.isSafeInteger(existing.partialOutcomeRecoveryWindowMs) || Number(existing.partialOutcomeRecoveryWindowMs) < 0) {
    throw new ControlError("execution-policy-unrepresentable");
  }
  original.executionPolicy = {
    ...existing,
    tokenBudget: task.work.tokens,
    totalRuntimeBudgetMs: task.work.activeMs,
    maxAttempts: task.work.attempts,
    perAttemptTimeoutMs: Math.min(existing.perAttemptTimeoutMs, task.work.activeMs),
    partialOutcomeRecoveryWindowMs: Math.min(Number(existing.partialOutcomeRecoveryWindowMs), task.handoff.activeMs),
  };
  if (!taskContractSchema.safeParse(original).success) throw new ControlError("execution-policy-unrepresentable");
  const contractCanonicalJson = canonicalBytes(original).toString("utf8");
  const record = {
    schema: "orca-derived-contract-record-v1",
    originalContractHash: task.originalContractHash,
    proposalVersion,
    confirmedGrant: { work: task.work, handoff: task.handoff },
    derivationVersion: "orca-derived-contract-v1",
    contractCanonicalJson,
  };
  const canonicalJson = canonicalBytes(record).toString("utf8");
  return { canonicalJson, contractCanonicalJson, derivedContractHash: sha256Canonical(record) };
}

export function prepareExecutionSnapshot(input: ConfirmedProposal): PreparedExecutionSnapshot {
  const plan = verifyPlanAuthority(input);
  verifyTaskSet(input, plan);
  const taskIds = new Set<string>();
  const derivedContracts = input.tasks.map(task => {
    if (taskIds.has(task.taskId)) throw new ControlError("duplicate-task-id");
    taskIds.add(task.taskId);
    const derived = deriveContract(task, input.proposalVersion);
    return { taskId: task.taskId, ...derived };
  }).sort((left, right) => compare(left.taskId, right.taskId));

  const allocations = verifyConservation(input).sort((left, right) => compare(
    `${left.ownerKind}\0${left.ownerId}\0${left.bucket}`,
    `${right.ownerKind}\0${right.ownerId}\0${right.bucket}`,
  ));
  for (const task of input.tasks) {
    const work = allocations.find(row => row.ownerKind === "task" && row.ownerId === task.taskId && row.bucket === "work");
    const handoff = allocations.find(row => row.ownerKind === "task" && row.ownerId === task.taskId && row.bucket === "handoff");
    if (!work || !handoff || sha256Canonical(work.amount) !== sha256Canonical(task.work) || sha256Canonical(handoff.amount) !== sha256Canonical(task.handoff)) {
      throw new ControlError("execution-policy-unrepresentable");
    }
  }
  const agentTasks = [...input.agents.tasks].sort((left, right) => compare(left.taskId, right.taskId));
  if (agentTasks.map(task => task.taskId).join("\0") !== derivedContracts.map(contract => contract.taskId).join("\0")) throw new ControlError("plan-version-conflict");
  const snapshot = executionSnapshotSchema.parse({
    schema: "orca-execution-snapshot-v2",
    groupId: input.groupId,
    planHash: input.planHash,
    graphVersion: input.graphVersion,
    proposalVersion: input.proposalVersion,
    groupLimit: input.groupLimit,
    budgetMode: input.budgetMode,
    contextPolicy: input.contextPolicy,
    profiles: input.profiles,
    allocations,
    derivedContracts: derivedContracts.map(({ taskId, derivedContractHash }) => ({ taskId, derivedContractHash })),
    agents: { tasks: agentTasks, reconcile: input.agents.reconcile },
  });
  const canonicalJson = canonicalBytes(snapshot).toString("utf8");
  return { snapshot, canonicalJson, snapshotHash: sha256Canonical(snapshot), derivedContracts };
}

export function buildExecutionSnapshot(input: ConfirmedProposal): ExecutionSnapshotV1 {
  return prepareExecutionSnapshot(input).snapshot;
}

/**
 * Handoff delivery plan deviation D-SNAP (2026-09-25): the shape a live allocation is compared to its frozen
 * counterpart in. Web spec §5.1.1 re-amounts a parked task allocation (held, then continuing) to its remaining
 * grant, and it keeps that amount once terminal; those amounts are the ledger's settlement, not a drift from the
 * confirmation, so only their `amount` is left out. Every other field of theirs, and every field of every other
 * allocation, is still compared. Shared by the driver's contract read and the panel's read model.
 */
export function frozenAllocationShape(allocations: ReadonlyArray<{ ownerKind: string; ownerId: string; bucket: string; state: string }>) {
  const settled = new Set(allocations.filter(a => a.ownerKind === "task" && ["held", "continuing", "terminal"].includes(a.state)).map(a => `${a.ownerId}\0${a.bucket}`));
  return <A extends { ownerKind: string; ownerId: string; bucket: string }>(allocation: A): A | Omit<A, "amount"> => {
    if (allocation.ownerKind !== "task" || !settled.has(`${allocation.ownerId}\0${allocation.bucket}`)) return allocation;
    const { amount: _amount, ...rest } = allocation as A & { amount: unknown };
    return rest;
  };
}

/** Scheduler consumption verifies the archived wrapper, then returns its exact contract bytes. */
export function readConfirmedTaskExecution(store: ControlStore, groupId: string, taskId: string) {
  const proposal = readBudgetProposal(store, groupId), plan = readArchivedPlan(store, groupId);
  if (proposal.state !== "confirmed" || !proposal.executionSnapshotHash) throw new ControlError("group-state-invalid");
  const settledShape = frozenAllocationShape(proposal.allocations);
  try {
    const snapshot = executionSnapshotSchema.parse(JSON.parse(readCanonicalRecord(store, proposal.executionSnapshotHash)));
    if (snapshot.groupId !== groupId || snapshot.planHash !== plan.planHash || snapshot.graphVersion !== plan.graphVersion
      || snapshot.proposalVersion !== proposal.proposalVersion || snapshot.budgetMode !== proposal.budgetMode
      || sha256Canonical(snapshot.profiles) !== sha256Canonical(proposal.profiles)
      || sha256Canonical(snapshot.contextPolicy) !== sha256Canonical(proposal.contextPolicy)
      || sha256Canonical(snapshot.allocations.filter(a => a.ownerKind !== "reserve").map(settledShape)) !== sha256Canonical(proposal.allocations.filter(a => a.ownerKind !== "reserve").map(({ state: _state, ...a }) => settledShape(a)))) throw new ControlError("recovery-blocked");
    const task = plan.plan.tasks.find(t => t.taskId === taskId), ref = snapshot.derivedContracts.find(t => t.taskId === taskId);
    const work = snapshot.allocations.find(a => a.ownerKind === "task" && a.ownerId === taskId && a.bucket === "work");
    const handoff = snapshot.allocations.find(a => a.ownerKind === "task" && a.ownerId === taskId && a.bucket === "handoff");
    if (!task || !ref || !work || !handoff) throw new ControlError("recovery-blocked");
    const expected = deriveContract({ ...task, work: work.amount, handoff: handoff.amount }, proposal.proposalVersion);
    const canonicalJson = readCanonicalRecord(store, ref.derivedContractHash);
    if (canonicalJson !== expected.canonicalJson || ref.derivedContractHash !== expected.derivedContractHash) throw new ControlError("recovery-blocked");
    // Agent selection spec §6.4 step 4 (§12 I3): the snapshot is the authority for the frozen selection; the work item must agree.
    const entry = snapshot.agents.tasks.find(t => t.taskId === taskId);
    if (!entry) throw new ControlError("recovery-blocked");
    const { taskId: _taskId, ...agent } = entry;
    if (sha256Canonical(frozenWorkAgent(readWork(store, groupId, taskId))) !== sha256Canonical(agent)) throw new ControlError("recovery-blocked");
    const frozen: FrozenWorkAgent = agent;
    return { derivedContractHash: ref.derivedContractHash, contractCanonicalJson: expected.contractCanonicalJson,
      contract: taskContractSchema.parse(JSON.parse(expected.contractCanonicalJson)), grant: { work: work.amount, handoff: handoff.amount }, agent: frozen };
  } catch (error) {
    if (error instanceof ControlError) throw error;
    throw new ControlError("recovery-blocked");
  }
}

/** Spec §6.1 / §6.4 step 4: the group's frozen reconcile slot, as the confirmed snapshot records it (plan T12's reconciliation run uses it). */
export function readConfirmedReconcileSlot(store: ControlStore, groupId: string): FrozenSlot {
  const proposal = readBudgetProposal(store, groupId);
  if (proposal.state !== "confirmed" || !proposal.executionSnapshotHash) throw new ControlError("group-state-invalid");
  try {
    const snapshot = executionSnapshotSchema.parse(JSON.parse(readCanonicalRecord(store, proposal.executionSnapshotHash)));
    const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
    const stored = row ? (JSON.parse(String(row.body)) as { reconcileSlot?: unknown }).reconcileSlot : undefined;
    if (sha256Canonical(stored ?? null) !== sha256Canonical(snapshot.agents.reconcile)) throw new ControlError("recovery-blocked");
    return snapshot.agents.reconcile as FrozenSlot;
  } catch (error) {
    if (error instanceof ControlError) throw error;
    throw new ControlError("recovery-blocked");
  }
}
