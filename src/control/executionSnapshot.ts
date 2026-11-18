import { budgetAmountSchema, type BudgetAmount } from "./tokenPolicy.js";
import { hasTokenPolicy } from "./fundedAllowance.js";
import { validateRetryGrantSource } from "./retryGrant.js";
import { frozenWorkAgent, type FrozenWorkAgent } from "./agentFreeze.js";
import type { FrozenSlot } from "./agentSelection.js";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { ControlError } from "./errors.js";
import { MAX_TIMER_MS, amountSchema, idSchema } from "./schema.js";
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
import type { z } from "zod";
import { buildGraph } from "../scheduler/graph.js";
import { taskContractSchema } from "../scheduler/planFile.js";
import { directoryQualifiedWriteSetOf, parallelClaimsOf, type SiblingClaims } from "./parallelClaims.js";
import { readArchivedPlan, readBudgetProposal, readEstimateRecord, readWork } from "./queries.js";
import type { ControlStore } from "./store.js";
import { readCanonicalRecord } from "./snapshot.js";
import { effectivePlanTask, workBodyOf } from "./taskAmendments.js";

type ExecutionAllocation = ExecutionSnapshotV1["allocations"][number];
type TaskContract = z.infer<typeof taskContractSchema>;
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
  groupLimit: BudgetAmount;
  budgetMode: "strict" | "soft";
  contextPolicy: { handoffAtContextTokens: number | null };
  profiles: { estimator: ProfileBindingV1 | null; worker: ProfileBindingV1; handoff: ProfileBindingV1; goalReview: ProfileBindingV1 };
  allocations: Array<ExecutionAllocation | EstimateAllocation>;
  tasks: Array<{
    taskId: string;
    originalContractHash: string;
    originalContractCanonicalJson: string;
    work: BudgetAmount;
    handoff: Amount;
  }>;
  /** Agent selection spec §6.4 step 4: each task's frozen selection and the group's reconcile slot. */
  agents: ExecutionSnapshotV1["agents"];
  /** Syncskill integration spec §10.5: each task's frozen skill set; absent or empty when no task declares skills. */
  skills?: NonNullable<ExecutionSnapshotV1["skills"]>;
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
  for (const archived of plan.tasks) {
    // Loop plans spec §5.1 (C5): the confirmation freezes a task's contract as amended, when it was.
    const authority = effectivePlanTask(input.store, input.groupId, archived, workBodyOf(input.store, input.groupId, archived.taskId));
    const task = supplied.get(authority.taskId);
    if (!task || task.originalContractHash !== authority.originalContractHash
      || task.originalContractCanonicalJson !== authority.originalContractCanonicalJson) {
      throw new ControlError("plan-version-conflict");
    }
  }
}

function verifyConservation(input: ConfirmedProposal): ExecutionAllocation[] {
  budgetAmountSchema.parse(input.groupLimit);
  const total = { tokens: 0n, activeMs: 0n, attempts: 0n, sessions: 0n };
  const seen = new Set<string>();
  const suppliedEstimates = new Map<string, EstimateAllocation>();
  for (const allocation of input.allocations) {
    budgetAmountSchema.parse(allocation.amount);
    if(allocation.bucket!=="work"&&allocation.bucket!=="reserve")amountSchema.parse(allocation.amount);
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
      if(dimension==="tokens"&&(allocation.amount.tokens===null||(hasTokenPolicy(input.store,input.groupId)&&allocation.ownerKind==="task")))continue;
      total[dimension] += BigInt(allocation.amount[dimension]!);
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
    if (dimension==="tokens"&&input.groupLimit.tokens===null)continue;
    if (total[dimension] > BigInt(input.groupLimit[dimension]!)) throw new ControlError("group-budget-unavailable");
  }
  return input.allocations
    .filter((allocation): allocation is ExecutionAllocation => allocation.ownerKind !== "estimate")
    .map(allocation => structuredClone(allocation));
}

/** A derived contract's phase timeout: the original's, at most the task's active time, and never past a Node timer's reach. */
export function derivedPhaseTimeoutMs(originalMs: number, activeMs: number): number {
  return Math.min(originalMs, activeMs, MAX_TIMER_MS);
}

/** Off-plan writes spec W2: the constraint line naming the siblings' claims, before the claims and the closing period. */
const OFF_PLAN_SIBLINGS_CONSTRAINT = "Other tasks of this group change these paths at the same time; do not modify them: ";

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compare);
}

/**
 * Off-plan writes spec W2 (plan Task 3): the frozen siblings' claims denied in the contract -- the primary repository's
 * (`repoKey: null`) in safetyPolicy.denylistPaths, an extra repository's in that entry's own denylistPaths -- and named
 * in one constraint line, an extra repository's as `<key>:<path>`. A repository with no claim is left as it is, and a
 * contract with no claim at all is returned unchanged, so its derivation keeps the bytes it had before siblings existed.
 * Shared with the panel's snapshot check (controlViews.ts validateExecutionSnapshot), which re-derives every contract.
 */
export function denySiblingClaims(contract: TaskContract, siblings: readonly SiblingClaims[]): TaskContract {
  const claims = siblings.flatMap(sibling => sibling.claims);
  if (claims.length === 0) return contract;
  const next = structuredClone(contract);
  const extraKeys = new Set((next.context.additionalRepos ?? []).map(repo => repo.key));
  if (claims.some(claim => claim.repoKey !== null && !extraKeys.has(claim.repoKey))) throw new ControlError("execution-policy-unrepresentable");
  const primary = claims.filter(claim => claim.repoKey === null).map(claim => claim.path);
  if (primary.length > 0) next.safetyPolicy.denylistPaths = sortedUnique([...next.safetyPolicy.denylistPaths, ...primary]);
  for (const repo of next.context.additionalRepos ?? []) {
    const own = claims.filter(claim => claim.repoKey === repo.key).map(claim => claim.path);
    if (own.length > 0) repo.denylistPaths = sortedUnique([...(repo.denylistPaths ?? []), ...own]);
  }
  const named = sortedUnique(claims.map(claim => claim.repoKey === null ? claim.path : `${claim.repoKey}:${claim.path}`));
  next.context.constraints = [...next.context.constraints, `${OFF_PLAN_SIBLINGS_CONSTRAINT}${named.join(", ")}.`];
  return next;
}

export function deriveContract(task: ConfirmedProposal["tasks"][number], proposalVersion: number, siblings: readonly SiblingClaims[] = []): {
  canonicalJson: string; contractCanonicalJson: string; derivedContractHash: string;
} {
  budgetAmountSchema.parse(task.work);
  amountSchema.parse(task.handoff);
  if (task.work.tokens === 0 || task.work.activeMs <= 0 || task.work.attempts <= 0 || task.work.sessions <= 0) {
    throw new ControlError("execution-policy-unrepresentable");
  }
  let original: Record<string, unknown>;
  try {
    const value = taskContractSchema.parse(JSON.parse(task.originalContractCanonicalJson));
    if (canonicalBytes(value).toString("utf8") !== task.originalContractCanonicalJson || sha256Canonical(value) !== task.originalContractHash) {
      throw new ControlError("recovery-blocked");
    }
    if (value.objective.taskId !== task.taskId) throw new ControlError("execution-policy-unrepresentable");
    original = structuredClone(denySiblingClaims(value, siblings)) as Record<string, unknown>;
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
    perAttemptTimeoutMs: derivedPhaseTimeoutMs(existing.perAttemptTimeoutMs, task.work.activeMs),
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

/**
 * Off-plan writes spec W1/W2 (plan Task 3): each v4 task's parallel siblings, with the claims of theirs that lie in its
 * own directories, from the confirmed plan and each task's contract as confirmed. The order is dependsOn together with
 * the implicit write-set edges buildGraph derives (the graph `layers` is built from), so a pair ordered only through an
 * implicit edge is not parallel. A sibling with no such claim is not frozen, and a task left with none has no entry.
 */
function frozenOffPlan(plan: ControlPlanV1, tasks: ConfirmedProposal["tasks"]): Map<string, SiblingClaims[]> {
  // Each contract is readable: verifyTaskSet matched it to the archived plan, whose reader (readArchivedPlan) refuses an
  // unreadable one. No fallback answer here (fix round 1): a plan read without its contracts would freeze no sibling.
  const contracts = new Map(tasks.map(task => [task.taskId, taskContractSchema.parse(JSON.parse(task.originalContractCanonicalJson))]));
  const graph = buildGraph({ targetRepo: "", ccloopBin: "", runsDir: "", workBranch: "", policy: "local-merge", ledgerMode: "in-repo",
    tasks: plan.tasks.map(task => ({ taskId: task.taskId, contract: task.taskId, dependsOn: [...task.dependencyTaskIds] })) },
  new Map(), new Map(plan.tasks.map(task => [task.taskId, directoryQualifiedWriteSetOf(contracts.get(task.taskId)!)])));
  const dependencies = new Map(plan.tasks.map(task => [task.taskId, [...task.dependencyTaskIds]]));
  for (const edge of graph.implicit) dependencies.get(edge.to)!.push(edge.from);
  const out = new Map<string, SiblingClaims[]>();
  const claims = parallelClaimsOf(plan.tasks.map(task => ({ taskId: task.taskId, dependencyTaskIds: dependencies.get(task.taskId)!, contract: contracts.get(task.taskId)! })));
  for (const [taskId, siblings] of claims) {
    const kept = siblings.filter(sibling => sibling.claims.length > 0);
    if (kept.length > 0) out.set(taskId, kept);
  }
  return out;
}

/** A task's frozen siblings (off-plan writes spec W2), `[]` when the snapshot has no entry for it. */
export function offPlanEntryOf(snapshot: ExecutionSnapshotV1, taskId: string): SiblingClaims[] {
  return structuredClone(snapshot.offPlan?.find(entry => entry.taskId === taskId)?.siblings ?? []);
}

export function prepareExecutionSnapshot(input: ConfirmedProposal): PreparedExecutionSnapshot {
  const plan = verifyPlanAuthority(input);
  verifyTaskSet(input, plan);
  const offPlan = frozenOffPlan(plan, input.tasks);
  const taskIds = new Set<string>();
  const derivedContracts = input.tasks.map(task => {
    if (taskIds.has(task.taskId)) throw new ControlError("duplicate-task-id");
    taskIds.add(task.taskId);
    const derived = deriveContract(task, input.proposalVersion, offPlan.get(task.taskId) ?? []);
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
    // Omitted rather than empty (spec §10.5), so a group without skills keeps its snapshot bytes.
    ...(input.skills === undefined || input.skills.length === 0 ? {} : { skills: [...input.skills].sort((left, right) => compare(left.taskId, right.taskId)) }),
    // Off-plan writes spec W2: omitted rather than empty, so a group with no v4 task keeps its snapshot bytes.
    ...(offPlan.size === 0 ? {} : { offPlan: [...offPlan].map(([taskId, siblings]) => ({ taskId, siblings })).sort((left, right) => compare(left.taskId, right.taskId)) }),
  });
  const canonicalJson = canonicalBytes(snapshot).toString("utf8");
  return { snapshot, canonicalJson, snapshotHash: sha256Canonical(snapshot), derivedContracts };
}

export function buildExecutionSnapshot(input: ConfirmedProposal): ExecutionSnapshotV1 {
  return prepareExecutionSnapshot(input).snapshot;
}

/**
 * Loop plans spec §5.2 step 7 (independent review R2): a confirmed task's change rewrites only that task's derived
 * contract entry and its two allocations. Every other entry, the agents and the rest are copied byte for byte: a full
 * rebuild would re-derive held, continuing and terminal tasks from their re-amounted allocations and change their
 * hashes, and would rewrite the reserve row.
 */
export function replaceTaskInSnapshot(
  snapshot: ExecutionSnapshotV1, taskId: string, derivedContractHash: string,
  allocations: { work: ExecutionAllocation; handoff: ExecutionAllocation },
  skills: { profile: string | null; names: string[] } | null,
  siblings?: readonly SiblingClaims[],
): { snapshot: ExecutionSnapshotV1; canonicalJson: string; snapshotHash: string } {
  const next = structuredClone(snapshot);
  const ref = next.derivedContracts.find(entry => entry.taskId === taskId);
  if (!ref) throw new ControlError("recovery-blocked");
  ref.derivedContractHash = derivedContractHash;
  for (const bucket of ["work", "handoff"] as const) {
    const index = next.allocations.findIndex(row => row.ownerKind === "task" && row.ownerId === taskId && row.bucket === bucket);
    if (index < 0) throw new ControlError("recovery-blocked");
    next.allocations[index] = structuredClone(allocations[bucket]);
  }
  // Syncskill integration spec §10.5: this task's entry is added, replaced or removed, kept sorted by taskId; the key is
  // dropped when no task has skills, so the snapshot is byte-identical to one confirmed without them.
  const entries = [...(next.skills ?? []).filter(entry => entry.taskId !== taskId), ...(skills === null ? [] : [{ taskId, profile: skills.profile, names: [...skills.names] }])]
    .sort((left, right) => compare(left.taskId, right.taskId));
  if (entries.length === 0) delete next.skills; else next.skills = entries;
  // Off-plan writes spec W2: given, this task's frozen siblings are replaced (a sibling with no claim is not frozen), or
  // its entry removed when none is left; omitted, every entry is copied as it is.
  if (siblings !== undefined) {
    const kept = siblings.filter(sibling => sibling.claims.length > 0).map(sibling => structuredClone(sibling));
    const offPlan = [...(next.offPlan ?? []).filter(entry => entry.taskId !== taskId), ...(kept.length === 0 ? [] : [{ taskId, siblings: kept }])]
      .sort((left, right) => compare(left.taskId, right.taskId));
    if (offPlan.length === 0) delete next.offPlan; else next.offPlan = offPlan;
  }
  const parsed = executionSnapshotSchema.parse(next);
  return { snapshot: parsed, canonicalJson: canonicalBytes(parsed).toString("utf8"), snapshotHash: sha256Canonical(parsed) };
}

/**
 * Handoff delivery plan deviation D-SNAP (2026-09-25): the shape a live allocation is compared to its frozen
 * counterpart in. Web spec §5.1.1 re-amounts a parked task allocation (held, then continuing) to its remaining
 * grant, and it keeps that amount once terminal; those amounts are the ledger's settlement, not a drift from the
 * confirmation, so only their `amount` is left out. Every other field of theirs, and every field of every other
 * allocation, is still compared. Shared by the driver's contract read and the panel's read model.
 */
export function frozenAllocationShape(allocations: ReadonlyArray<{ ownerKind: string; ownerId: string; bucket: string; state: string }>) {
  const settled = new Set(allocations.filter(a => a.ownerKind === "task" && ["held", "continuing", "retrying", "terminal"].includes(a.state)).map(a => `${a.ownerId}\0${a.bucket}`));
  return <A extends { ownerKind: string; ownerId: string; bucket: string }>(allocation: A): A | Omit<A, "amount"> => {
    if (allocation.ownerKind !== "task" || !settled.has(`${allocation.ownerId}\0${allocation.bucket}`)) return allocation;
    const { amount: _amount, ...rest } = allocation as A & { amount: unknown };
    return rest;
  };
}

/** Scheduler consumption verifies the archived wrapper, then returns its exact contract bytes. */
export function readConfirmedTaskExecution(store: ControlStore, groupId: string, taskId: string) {
  const proposal = readBudgetProposal(store, groupId), plan = readArchivedPlan(store, groupId);
  for (const row of store.db.prepare("SELECT body FROM work_items WHERE group_id=?").all(groupId)) validateRetryGrantSource(store, groupId, JSON.parse(String(row.body)));
  if (proposal.state !== "confirmed" || !proposal.executionSnapshotHash) throw new ControlError("group-state-invalid");
  const settledShape = frozenAllocationShape(proposal.allocations);
  try {
    const snapshot = executionSnapshotSchema.parse(JSON.parse(readCanonicalRecord(store, proposal.executionSnapshotHash)));
    if (snapshot.groupId !== groupId || snapshot.planHash !== plan.planHash || snapshot.graphVersion !== plan.graphVersion
      || snapshot.proposalVersion !== proposal.proposalVersion || snapshot.budgetMode !== proposal.budgetMode
      || sha256Canonical(snapshot.profiles) !== sha256Canonical(proposal.profiles)
      || sha256Canonical(snapshot.contextPolicy) !== sha256Canonical(proposal.contextPolicy)
      || sha256Canonical(snapshot.allocations.filter(a => a.ownerKind !== "reserve").map(settledShape)) !== sha256Canonical(proposal.allocations.filter(a => a.ownerKind !== "reserve").map(({ state: _state, ...a }) => settledShape(a)))) throw new ControlError("recovery-blocked");
    const archived = plan.plan.tasks.find(t => t.taskId === taskId), ref = snapshot.derivedContracts.find(t => t.taskId === taskId);
    // Loop plans spec §5.1 (C5): A2 derives from the task's effective contract, never the archived entry alone.
    const task = archived === undefined ? undefined : effectivePlanTask(store, groupId, archived, workBodyOf(store, groupId, taskId));
    const work = snapshot.allocations.find(a => a.ownerKind === "task" && a.ownerId === taskId && a.bucket === "work");
    const handoff = snapshot.allocations.find(a => a.ownerKind === "task" && a.ownerId === taskId && a.bucket === "handoff");
    if (!task || !ref || !work || !handoff) throw new ControlError("recovery-blocked");
    // Off-plan writes spec W2: the task's frozen siblings are part of its derivation.
    const expected = deriveContract({ ...task, work: work.amount, handoff: amountSchema.parse(handoff.amount) }, proposal.proposalVersion, offPlanEntryOf(snapshot, taskId));
    const canonicalJson = readCanonicalRecord(store, ref.derivedContractHash);
    if (canonicalJson !== expected.canonicalJson || ref.derivedContractHash !== expected.derivedContractHash) throw new ControlError("recovery-blocked");
    // Agent selection spec §6.4 step 4 (§12 I3): the snapshot is the authority for the frozen selection; the work item must agree.
    const entry = snapshot.agents.tasks.find(t => t.taskId === taskId);
    if (!entry) throw new ControlError("recovery-blocked");
    const { taskId: _taskId, ...agent } = entry;
    if (sha256Canonical(frozenWorkAgent(readWork(store, groupId, taskId))) !== sha256Canonical(agent)) throw new ControlError("recovery-blocked");
    const frozen: FrozenWorkAgent = agent;
    // Syncskill integration spec §10.5: an entry exists exactly when the effective recipe declares skills, and it agrees with it.
    const skillEntry = snapshot.skills?.find(t => t.taskId === taskId), declared = task.loop?.skills;
    if ((skillEntry === undefined) !== (declared === undefined)) throw new ControlError("recovery-blocked");
    if (skillEntry !== undefined && declared !== undefined
      && ("names" in declared ? skillEntry.profile !== null || sha256Canonical(skillEntry.names) !== sha256Canonical(declared.names) : skillEntry.profile !== declared.profile)) throw new ControlError("recovery-blocked");
    const skills = skillEntry === undefined ? null : { profile: skillEntry.profile, names: [...skillEntry.names] };
    return { derivedContractHash: ref.derivedContractHash, contractCanonicalJson: expected.contractCanonicalJson,
      contract: taskContractSchema.parse(JSON.parse(expected.contractCanonicalJson)), grant: { work: work.amount, handoff: amountSchema.parse(handoff.amount) }, agent: frozen, skills,
      // Off-plan writes W4 (plan Task 5): the frozen siblings the contract denies, so a stop on one can name it.
      siblings: offPlanEntryOf(snapshot, taskId) };
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
