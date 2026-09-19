import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { ControlError } from "./errors.js";
import { amountSchema } from "./schema.js";
import { executionSnapshotSchema, type ExecutionSnapshotV1, type ProfileBindingV1 } from "./webProtocol.js";
import type { Amount } from "./types.js";
import { taskContractSchema } from "../scheduler/planFile.js";

export interface ConfirmedProposal {
  groupId: string;
  planHash: string;
  graphVersion: number;
  proposalVersion: number;
  groupLimit: Amount;
  budgetMode: "strict" | "soft";
  contextPolicy: { handoffAtContextTokens: number | null };
  profiles: { estimator: ProfileBindingV1; worker: ProfileBindingV1; handoff: ProfileBindingV1; goalReview: ProfileBindingV1 };
  allocations: ExecutionSnapshotV1["allocations"];
  tasks: Array<{
    taskId: string;
    originalContractHash: string;
    originalContractCanonicalJson: string;
    work: Amount;
    handoff: Amount;
  }>;
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
  const taskIds = new Set<string>();
  const derivedContracts = input.tasks.map(task => {
    if (taskIds.has(task.taskId)) throw new ControlError("duplicate-task-id");
    taskIds.add(task.taskId);
    const derived = deriveContract(task, input.proposalVersion);
    return { taskId: task.taskId, ...derived };
  }).sort((left, right) => compare(left.taskId, right.taskId));

  const allocations = structuredClone(input.allocations).sort((left, right) => compare(
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
  const snapshot = executionSnapshotSchema.parse({
    schema: "orca-execution-snapshot-v1",
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
  });
  const canonicalJson = canonicalBytes(snapshot).toString("utf8");
  return { snapshot, canonicalJson, snapshotHash: sha256Canonical(snapshot), derivedContracts };
}

export function buildExecutionSnapshot(input: ConfirmedProposal): ExecutionSnapshotV1 {
  return prepareExecutionSnapshot(input).snapshot;
}
