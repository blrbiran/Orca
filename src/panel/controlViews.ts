import { frozenAllocationShape } from "../control/executionSnapshot.js";
import { z } from "zod";
import { readArtifact } from "../control/archive.js";
import { canonicalBytes, sha256Canonical } from "../control/canonicalJson.js";
import { dimensions } from "../control/commands.js";
import { driveRecordSchema } from "../control/driveRecord.js";
import { ControlError } from "../control/errors.js";
import { readProjectionChanges, readProjectionState } from "../control/projectionJournal.js";
import { readArchivedPlan, readBudgetProposal, readEstimateRecord } from "../control/queries.js";
import { readCanonicalRecord } from "../control/snapshot.js";
import type { ControlStore } from "../control/store.js";
import { agentSelectionSchema, amountSchema, artifactSchema, canonicalTimestampSchema, grantSchema, idSchema, safeInteger } from "../control/schema.js";
import { taskContractSchema } from "../scheduler/planFile.js";
import {
  allocationViewSchema,
  controlSummarySchema,
  evidenceManifestSchema,
  executionSnapshotSchema,
  groupSummarySchema,
  groupViewSchema,
  profileBindingSchema,
  recoveryViewSchema,
  type AllocationViewV1,
  type CheckpointViewV1,
  type ControlSummaryV1,
  type EvidenceManifestV1,
  type EstimateViewV1,
  type ExecutionSnapshotV1,
  type GroupSummaryV1,
  type GroupViewV1,
  type HandoffRequestViewV1,
  type RecoveryViewV1,
  type RunViewV1,
  type WorkItemViewV1,
} from "../control/webProtocol.js";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const groupStateSchema = z.enum(["draft", "ready", "running", "review", "done", "blocked"]);
const workStatusSchema = z.enum(["draft", "ready", "running", "done", "blocked", "starting", "start-unknown", "active", "held", "continuing", "completed"]);
const groupBodySchema = z.object({
  groupId: idSchema,
  graphVersion: safeInteger.positive(),
  status: groupStateSchema,
  stopped: z.boolean(),
  planHash: hashSchema,
  ledger: z.object({
    groupLimit: amountSchema,
    used: amountSchema,
    committedRemaining: amountSchema,
    explicitUnallocatedReserve: amountSchema,
    budgetDeficit: amountSchema,
    usageUnknown: z.boolean(),
  }).strict(),
}).passthrough();

const workBodySchema = z.object({
  workItemId: idSchema,
  taskId: idSchema.nullable(),
  kind: z.string().min(1),
  dependsOn: z.array(idSchema),
  contract: z.unknown(),
  configHash: hashSchema,
  grant: grantSchema,
  targetVersion: safeInteger.positive(),
  status: workStatusSchema,
  originalContractHash: hashSchema,
  derivedContractHash: hashSchema.nullable(),
  currentRunId: idSchema.nullable().optional(),
  pendingRunId: idSchema.nullable().optional(),
  lineageRunIds: z.array(idSchema).optional(),
}).passthrough();

const stopBodySchema = z.object({
  mode: z.enum(["pause", "shutdown", "handoff"]),
  state: z.enum(["paused", "handoff-pending", "handoff-partial", "handoff-unresolved", "handoff-complete"]),
  frozenRunIds: z.array(idSchema),
  acceptedAt: canonicalTimestampSchema.nullable(),
  deadlineAt: canonicalTimestampSchema.nullable(),
}).strict();

const blockerBodySchema = z.object({ evidenceIds: z.array(idSchema) }).strict();
const handoffBodySchema = z.object({
  requestId: idSchema,
  runId: idSchema,
  state: z.enum(["request-pending", "latched", "collecting", "settled-recoverable", "settled-restartable", "settled-unrecoverable", "outcome-unknown"]),
  deadlineAt: canonicalTimestampSchema,
  phaseAttemptOrdinal: safeInteger.positive(),
  failureCode: z.string().min(1).nullable(),
  evidenceIds: z.array(idSchema),
}).strict();

const derivedContractRecordSchema = z.object({
  schema: z.literal("orca-derived-contract-record-v1"),
  originalContractHash: hashSchema,
  proposalVersion: safeInteger.positive(),
  confirmedGrant: grantSchema,
  derivationVersion: z.literal("orca-derived-contract-v1"),
  contractCanonicalJson: z.string().min(1),
}).strict();

const executionProfileAuthoritySchema = z.object({
  workKind: z.enum(["budget-estimate", "task", "handoff", "goal-review"]),
  profileId: idSchema,
  profileHash: hashSchema,
}).strict();

const persistedRunSchema = z.object({
  groupId: idSchema,
  workItemId: idSchema,
  taskId: idSchema.nullable(),
  estimateId: idSchema.nullable(),
  runId: idSchema,
  generation: safeInteger.positive(),
  graphVersion: safeInteger.positive(),
  targetVersion: safeInteger.positive(),
  commandId: idSchema,
  configHash: hashSchema,
  // Agent selection spec I1: a work run carries its frozen selection; an estimate run has none (plan T10 gives it one).
  agent: agentSelectionSchema.optional(),
  grant: grantSchema,
  ownerToken: idSchema,
  executionProfile: executionProfileAuthoritySchema,
  handoffProfile: executionProfileAuthoritySchema.nullable(),
  executionId: z.string().min(1).nullable(),
  state: z.enum([
    "claimed", "starting", "accepted", "unknown", "settled",
    "attempt-unknown", "attempt-proof-invalid", "failed-before-provider",
    "settled-recoverable", "settled-restartable", "settled-unrecoverable",
    "start-pending", "collected", "landed", "reconciling", "blocked",
  ]),
  checkpointId: idSchema.nullable(),
  recoverable: z.boolean(),
  remaining: grantSchema,
  cumulative: grantSchema,
  unknown: z.object({ work: z.boolean(), handoff: z.boolean() }).strict(),
  highWater: safeInteger,
  breaches: z.array(safeInteger.positive()),
  handoffWorkItemId: idSchema.nullable(),
  predecessorRunId: idSchema.optional(),
  phase: z.enum(["estimate", "work", "handoff"]),
  claimOrdinal: safeInteger.positive().nullable(),
  continuationIntentId: idSchema.nullable().optional(),
  providerAttemptOrdinal: safeInteger,
  failureCode: z.string().min(1).nullable(),
  drive: driveRecordSchema.optional(),
}).strict();

function blocked(detail: string): never {
  throw new ControlError("recovery-blocked", detail);
}

function parseJson(value: unknown, detail: string): unknown {
  try { return JSON.parse(String(value)); }
  catch { return blocked(detail); }
}

function parseStored<T>(schema: z.ZodType<T>, value: unknown, detail: string): T {
  const parsed = schema.safeParse(parseJson(value, detail));
  if (!parsed.success) return blocked(`${detail}:${parsed.error.issues[0]?.message ?? "invalid"}`);
  return parsed.data;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function groupBody(store: ControlStore, groupId: string): z.infer<typeof groupBodySchema> {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  if (!row) throw new ControlError("group-not-found");
  const body = parseStored(groupBodySchema, row.body, "group-body-invalid");
  if (body.groupId !== groupId) return blocked("group-identity");
  return body;
}

function blockerRows(store: ControlStore, groupId?: string): Array<{
  scope: "global" | "group" | "run";
  groupId: string;
  runId: string | null;
  code: string;
  evidenceIds: string[];
}> {
  const rows = groupId === undefined
    ? store.db.prepare("SELECT group_id,run_id,scope,code,body FROM recovery_blockers").all()
    : store.db.prepare("SELECT group_id,run_id,scope,code,body FROM recovery_blockers WHERE group_id=?").all(groupId);
  return rows.map(row => {
    const scope = String(row.scope);
    const owner = row.group_id === null ? "" : String(row.group_id);
    const runId = row.run_id === null ? null : String(row.run_id);
    const code = String(row.code);
    const bodyJson = String(row.body);
    const body = parseStored(blockerBodySchema, bodyJson, "recovery-blocker-invalid");
    if (!["global", "group", "run"].includes(scope) || !idSchema.safeParse(owner).success
      || (runId !== null && !idSchema.safeParse(runId).success) || code.length === 0
      || canonicalBytes(body).toString("utf8") !== bodyJson
      || sortedUnique(body.evidenceIds).join("\0") !== body.evidenceIds.join("\0")
      || (scope === "run" && runId === null) || (scope === "group" && runId !== null)) return blocked("recovery-blocker-identity");
    if (runId !== null) {
      const run = store.db.prepare("SELECT group_id FROM runs WHERE id=?").get(runId);
      if (!run || String(run.group_id) !== owner) return blocked("recovery-blocker-run-owner");
    }
    return { scope: scope as "global" | "group" | "run", groupId: owner, runId, code, evidenceIds: sortedUnique(body.evidenceIds) };
  }).sort((left, right) => `${left.scope}\0${left.groupId}\0${left.runId ?? ""}\0${left.code}`.localeCompare(`${right.scope}\0${right.groupId}\0${right.runId ?? ""}\0${right.code}`));
}

function stopView(store: ControlStore, groupId: string, legacyStopped: boolean): GroupViewV1["stop"] {
  const row = store.db.prepare("SELECT mode,revision,body FROM stop_intents WHERE group_id=?").get(groupId);
  if (!row) {
    if (legacyStopped) return blocked("stop-intent-missing");
    return null;
  }
  if (!legacyStopped) return blocked("stop-intent-without-stop");
  const body = String(row.body);
  const stop = parseStored(stopBodySchema, body, "stop-intent-invalid");
  const groupRevision = Number(store.db.prepare("SELECT revision FROM groups WHERE id=?").get(groupId)?.revision);
  if (canonicalBytes(stop).toString("utf8") !== body
    || String(row.mode) !== stop.mode
    || !Number.isSafeInteger(Number(row.revision)) || Number(row.revision) <= 0 || Number(row.revision) > groupRevision
    || sortedUnique(stop.frozenRunIds).join("\0") !== stop.frozenRunIds.join("\0")) {
    return blocked("stop-intent-identity");
  }
  if (stop.mode === "pause") {
    if (stop.state !== "paused" || stop.acceptedAt !== null || stop.deadlineAt !== null) return blocked("stop-intent-pause");
  } else if (stop.state === "paused" || stop.acceptedAt === null || stop.deadlineAt === null) {
    return blocked("stop-intent-deadline");
  }
  for (const runId of stop.frozenRunIds) {
    const run = store.db.prepare("SELECT group_id FROM runs WHERE id=?").get(runId);
    if (!run || String(run.group_id) !== groupId) return blocked("stop-intent-frozen-run");
  }
  return stop;
}

export function readGroupSummary(store: ControlStore, groupId: string): GroupSummaryV1 {
  const body = groupBody(store, groupId);
  readArchivedPlan(store, groupId);
  readBudgetProposal(store, groupId);
  const versions = store.db.prepare("SELECT revision,projection_seq FROM groups WHERE id=?").get(groupId);
  if (!versions) throw new ControlError("group-not-found");
  const stop = stopView(store, groupId, body.stopped);
  const blockers = blockerRows(store, groupId);
  const summary = {
    groupId,
    state: body.status,
    commandRevision: Number(versions.revision),
    projectionSeq: Number(versions.projection_seq),
    stopMode: stop?.mode ?? null,
    stopState: stop?.state ?? null,
    claimBlocked: blockers.length > 0,
    recoveryBlockerCount: blockers.length,
  };
  const parsed = groupSummarySchema.safeParse(summary);
  if (!parsed.success) return blocked(`group-summary:${parsed.error.issues[0]?.message ?? "invalid"}`);
  return parsed.data;
}

function allGroupIds(store: ControlStore): string[] {
  return store.db.prepare("SELECT id FROM groups ORDER BY id").all().map(row => String(row.id));
}

function readGroupOwnedCanonicalRecord(store: ControlStore, groupId: string, hash: string): string {
  const row = store.db.prepare("SELECT group_id FROM execution_snapshots WHERE hash=?").get(hash);
  if (!row || String(row.group_id) !== groupId) return blocked("canonical-record-owner");
  return readCanonicalRecord(store, hash);
}

export function readControlSummary(
  store: ControlStore,
  epoch: string,
  sinceChangeSeq: number | null,
  forceComplete = false,
): ControlSummaryV1 {
  const state = readProjectionState(store);
  const changes = forceComplete || sinceChangeSeq === null
    ? { changeSeq: state.changeSeq, resetRequired: true, groups: allGroupIds(store).map(groupId => ({ groupId })) }
    : readProjectionChanges(store, sinceChangeSeq);
  const groupIds = changes.resetRequired || forceComplete ? allGroupIds(store) : changes.groups.map(group => group.groupId);
  const view = {
    schema: "orca-control-summary-v1" as const,
    epoch,
    changeSeq: changes.changeSeq,
    resetRequired: forceComplete || changes.resetRequired,
    dispatchBlocked: store.dispatchBlocked,
    groups: sortedUnique(groupIds).map(groupId => readGroupSummary(store, groupId)),
  };
  const parsed = controlSummarySchema.safeParse(view);
  if (!parsed.success) return blocked(`control-summary:${parsed.error.issues[0]?.message ?? "invalid"}`);
  return parsed.data;
}

function validateExecutionSnapshot(
  store: ControlStore,
  groupId: string,
  graphVersion: number,
  proposal: ReturnType<typeof readBudgetProposal>,
  plan: ReturnType<typeof readArchivedPlan>["plan"],
): ExecutionSnapshotV1 | null {
  if (proposal.state !== "confirmed") return null;
  if (!proposal.executionSnapshotHash || !proposal.profiles || !proposal.budgetMode) return blocked("confirmed-proposal-incomplete");
  const canonicalJson = readGroupOwnedCanonicalRecord(store, groupId, proposal.executionSnapshotHash);
  const parsed = executionSnapshotSchema.safeParse(parseJson(canonicalJson, "execution-snapshot-invalid"));
  // Handoff delivery plan deviation D-SNAP: a settled task allocation's amount is the ledger's, not a drift.
  const settledShape = frozenAllocationShape(proposal.allocations);
  const proposalAllocations = proposal.allocations.map(({ state: _state, ...allocation }) => settledShape(allocation));
  if (!parsed.success || canonicalBytes(parsed.data).toString("utf8") !== canonicalJson
    || sha256Canonical(parsed.data) !== proposal.executionSnapshotHash
    || parsed.data.groupId !== groupId || parsed.data.planHash !== proposal.planHash
    || parsed.data.graphVersion !== graphVersion || parsed.data.proposalVersion !== proposal.proposalVersion
    || parsed.data.budgetMode !== proposal.budgetMode
    || canonicalBytes(parsed.data.contextPolicy).compare(canonicalBytes(proposal.contextPolicy)) !== 0
    || canonicalBytes(parsed.data.profiles).compare(canonicalBytes(proposal.profiles)) !== 0
    || canonicalBytes(parsed.data.allocations.filter(a => a.ownerKind !== "reserve").map(settledShape)).compare(canonicalBytes(proposalAllocations.filter(a => a.ownerKind !== "reserve"))) !== 0) {
    return blocked("execution-snapshot-identity");
  }
  // Limits and residual reserve may change after confirmation. Frozen grants
  // remain exact above; mutable accounting must independently conserve capacity.
  const live = groupBody(store, groupId).ledger;
  if (canonicalBytes(live.explicitUnallocatedReserve).compare(canonicalBytes(proposal.explicitUnallocatedReserve)) !== 0) return blocked("live-reserve-identity");
  if (!live.usageUnknown) for (const dimension of ["tokens", "activeMs", "attempts", "sessions"] as const) {
    const occupied = BigInt(live.used[dimension]) + BigInt(live.committedRemaining[dimension]);
    const ceiling = BigInt(live.groupLimit[dimension]);
    const reserve = occupied < ceiling ? ceiling - occupied : 0n;
    const deficit = occupied > ceiling ? occupied - ceiling : 0n;
    if (BigInt(live.explicitUnallocatedReserve[dimension]) !== reserve || BigInt(live.budgetDeficit[dimension]) !== deficit) return blocked("live-ledger-conservation");
  }
  const tasks = new Map(plan.tasks.map(task => [task.taskId, task]));
  for (const ref of parsed.data.derivedContracts) {
    const task = tasks.get(ref.taskId);
    if (!task) return blocked("derived-contract-task");
    const recordJson = readCanonicalRecord(store, ref.derivedContractHash);
    const record = derivedContractRecordSchema.safeParse(parseJson(recordJson, "derived-contract-invalid"));
    if (!record.success || canonicalBytes(record.data).toString("utf8") !== recordJson
      || record.data.originalContractHash !== task.originalContractHash
      || record.data.proposalVersion !== proposal.proposalVersion) return blocked("derived-contract-identity");
    const contract = taskContractSchema.safeParse(parseJson(record.data.contractCanonicalJson, "derived-contract-payload-invalid"));
    const original = taskContractSchema.safeParse(parseJson(task.originalContractCanonicalJson, "original-contract-invalid"));
    const work = parsed.data.allocations.find(row => row.ownerKind === "task" && row.ownerId === ref.taskId && row.bucket === "work");
    const handoff = parsed.data.allocations.find(row => row.ownerKind === "task" && row.ownerId === ref.taskId && row.bucket === "handoff");
    if (!contract.success || !original.success || canonicalBytes(contract.data).toString("utf8") !== record.data.contractCanonicalJson
      || contract.data.objective.taskId !== ref.taskId || !work || !handoff
      || canonicalBytes(record.data.confirmedGrant.work).compare(canonicalBytes(work.amount)) !== 0
      || canonicalBytes(record.data.confirmedGrant.handoff).compare(canonicalBytes(handoff.amount)) !== 0) {
      return blocked("derived-contract-cross-record");
    }
    const expectedContract = structuredClone(original.data);
    expectedContract.executionPolicy = {
      ...expectedContract.executionPolicy,
      tokenBudget: work.amount.tokens,
      totalRuntimeBudgetMs: work.amount.activeMs,
      maxAttempts: work.amount.attempts,
      perAttemptTimeoutMs: Math.min(expectedContract.executionPolicy.perAttemptTimeoutMs, work.amount.activeMs),
      partialOutcomeRecoveryWindowMs: Math.min(expectedContract.executionPolicy.partialOutcomeRecoveryWindowMs, handoff.amount.activeMs),
    };
    if (canonicalBytes(contract.data).compare(canonicalBytes(expectedContract)) !== 0) return blocked("derived-contract-forged");
  }
  return parsed.data;
}

function estimateViews(store: ControlStore, groupId: string): { views: EstimateViewV1[]; allocations: AllocationViewV1[] } {
  const rows = store.db.prepare("SELECT id FROM estimates WHERE group_id=? ORDER BY id").all(groupId);
  const views: EstimateViewV1[] = [];
  const allocations: AllocationViewV1[] = [];
  const field = { provenance: "system" as const, estimateId: null };
  for (const row of rows) {
    const estimate = readEstimateRecord(store, groupId, String(row.id));
    views.push({
      estimateId: estimate.estimateId, estimateVersion: estimate.estimateVersion, state: estimate.state,
      profile: estimate.profile, mode: estimate.mode, requestHash: estimate.requestHash,
      outputHash: estimate.outputHash, output: estimate.output, reasonCode: estimate.reasonCode,
    });
    allocations.push(allocationViewSchema.parse({
      ownerKind: "estimate", ownerId: estimate.estimateId, bucket: "work",
      state: estimate.state === "queued" ? "draft-encumbered" : estimate.state === "running" || estimate.state === "start-unknown" ? "active" : "terminal",
      amount: estimate.grant,
      fieldProvenance: { tokens: field, activeMs: field, attempts: field, sessions: field },
    }));
  }
  return { views, allocations };
}

function workViews(
  store: ControlStore,
  groupId: string,
  plan: ReturnType<typeof readArchivedPlan>["plan"],
  snapshot: ExecutionSnapshotV1 | null,
): WorkItemViewV1[] {
  const runs = store.db.prepare("SELECT id,work_item_id,active,body FROM runs WHERE group_id=? ORDER BY rowid").all(groupId);
  const derivedByTask = new Map(snapshot?.derivedContracts.map(contract => [contract.taskId, contract.derivedContractHash]) ?? []);
  if (snapshot && (derivedByTask.size !== plan.tasks.length || plan.tasks.some(task => !derivedByTask.has(task.taskId)))) {
    return blocked("execution-snapshot-task-set");
  }
  return plan.tasks.map(task => {
    const row = store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(groupId, task.taskId);
    if (!row) return blocked(`work-item-missing:${task.taskId}`);
    const body = parseStored(workBodySchema, row.body, `work-item-invalid:${task.taskId}`);
    const contract = body.contract as { contentAddressedHash?: unknown };
    if (body.workItemId !== task.taskId || body.taskId !== task.taskId
      || body.configHash !== task.configHash || body.targetVersion !== task.targetVersion
      || body.originalContractHash !== task.originalContractHash
      || contract?.contentAddressedHash !== task.originalContractHash
      || (snapshot !== null && body.derivedContractHash !== derivedByTask.get(task.taskId))
      || sortedUnique(body.dependsOn).join("\0") !== task.dependencyTaskIds.join("\0")) return blocked(`work-item-authority:${task.taskId}`);
    const taskRuns = runs.filter(run => String(run.work_item_id) === task.taskId);
    const persistedRunIds = taskRuns.map(run => String(run.id));
    if (taskRuns.length > 0) {
      if (!body.lineageRunIds || body.currentRunId === undefined || body.currentRunId === null
        || new Set(body.lineageRunIds).size !== body.lineageRunIds.length
        || sortedUnique(body.lineageRunIds).join("\0") !== sortedUnique(persistedRunIds).join("\0")
        || body.currentRunId !== persistedRunIds.at(-1)) return blocked(`work-item-run-lineage:${task.taskId}`);
      const activeRunIds = taskRuns.filter(run => Number(run.active) === 1).map(run => String(run.id));
      if (activeRunIds.length > 1 || (activeRunIds.length === 1 && body.currentRunId !== activeRunIds[0])) {
        return blocked(`work-item-active-run:${task.taskId}`);
      }
    } else if (body.currentRunId !== undefined && body.currentRunId !== null || (body.lineageRunIds?.length ?? 0) > 0) {
      return blocked(`work-item-run-without-row:${task.taskId}`);
    }
    if (body.pendingRunId && persistedRunIds.includes(body.pendingRunId)) return blocked(`work-item-pending-run:${task.taskId}`);
    const lineage = body.lineageRunIds ?? [];
    const status: WorkItemViewV1["status"] = body.status === "running" ? "active" : body.status === "done" ? "completed" : body.status;
    return {
      taskId: task.taskId, status, dependencyTaskIds: [...task.dependencyTaskIds], targetVersion: task.targetVersion,
      configHash: task.configHash, originalContractHash: task.originalContractHash,
      derivedContractHash: body.derivedContractHash,
      currentRunId: body.currentRunId ?? null, pendingRunId: body.pendingRunId ?? null,
      lineageRunIds: sortedUnique(lineage),
    };
  });
}

function artifactIdsForRun(store: ControlStore, runId: string): string[] {
  const row = store.db.prepare("SELECT group_id FROM runs WHERE id=?").get(runId);
  if (!row) return blocked("run-row-missing");
  return evidenceRefs(store, runId, String(row.group_id)).map(ref => ref.evidenceId);
}

function profileView(binding: z.infer<typeof executionProfileAuthoritySchema>): RunViewV1["profile"] {
  return { profileId: binding.profileId, profileHash: binding.profileHash };
}

function sameBinding(binding: z.infer<typeof executionProfileAuthoritySchema>, expected: RunViewV1["profile"], workKind: z.infer<typeof executionProfileAuthoritySchema>["workKind"]): boolean {
  return binding.workKind === workKind && binding.profileId === expected.profileId && binding.profileHash === expected.profileHash;
}

function validAccounting(run: z.infer<typeof persistedRunSchema>): boolean {
  for (const bucket of ["work", "handoff"] as const) {
    for (const dimension of ["tokens", "activeMs", "attempts", "sessions"] as const) {
      if (run.remaining[bucket][dimension] !== Math.max(run.grant[bucket][dimension] - run.cumulative[bucket][dimension], 0)) return false;
    }
  }
  return true;
}

function displayRunState(run: z.infer<typeof persistedRunSchema>): RunViewV1["state"] {
  switch (run.state) {
    case "claimed": case "starting": return "starting";
    case "accepted": return "running";
    case "unknown": case "attempt-unknown": case "attempt-proof-invalid": case "failed-before-provider":
    case "settled-recoverable": case "settled-restartable": case "settled-unrecoverable": return run.state;
    case "settled": return run.recoverable ? "settled-recoverable" : "settled-unrecoverable";
    case "start-pending": return "starting";
    case "collected": case "landed": case "reconciling": case "blocked": return run.state;
  }
}

/**
 * Handoff delivery spec §13.1 C-4, §13.2 I-5 (controller ruling 2026-09-25): a run the person may
 * continue from is one a handoff stopped -- persisted `settled-recoverable` with a committed
 * checkpoint whose result is `partial` -- and whose remaining work grant still has something left
 * in every dimension. `registerContinuation` (continuation.ts:169) refuses the whole batch with
 * `budget-overrun` the moment one selected predecessor has an exhausted dimension, so offering it
 * here would be a dead end. A run the driver settled normally (persisted `settled`, recoverable,
 * checkpoint `complete`) displays as `settled-recoverable` too, but its task is done and must
 * never be offered for continuation.
 *
 * Final fix wave (FR-C1, controller ruling 2026-09-25): and it must still be the task's parked run -- the
 * work item's `currentRunId` and `status: "held"`, the two conditions `assertPredecessor`
 * (continuation.ts) requires. A predecessor that was already continued keeps its persisted
 * `settled-recoverable` and `partial` checkpoint forever, so without these it would be offered again
 * after any later handoff-stop, and the panel's batch would be refused whole.
 */
function continuableRun(store: ControlStore, run: z.infer<typeof persistedRunSchema>): boolean {
  if (run.state !== "settled-recoverable") return false;
  const workRow = store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(run.groupId, run.workItemId);
  if (workRow === undefined) return false;
  const work = parseStored(workBodySchema, workRow.body, `run-work-invalid:${run.runId}`);
  if (work.currentRunId !== run.runId || work.status !== "held") return false;
  if (dimensions.some((dimension) => run.remaining.work[dimension] <= 0)) return false;
  const row = store.db.prepare("SELECT body FROM checkpoints WHERE id=? AND run_id=?").get(run.checkpointId, run.runId);
  return row !== undefined && (parseJson(row.body, `checkpoint-invalid:${run.checkpointId}`) as { result?: unknown }).result === "partial";
}

function runViews(store: ControlStore, groupId: string, graphVersion: number, proposal: ReturnType<typeof readBudgetProposal>): RunViewV1[] {
  return store.db.prepare("SELECT id,group_id,work_item_id,generation,active,body FROM runs WHERE group_id=? ORDER BY id").all(groupId).map(row => {
    const runId = String(row.id);
    const parsed = persistedRunSchema.safeParse(parseJson(row.body, `run-invalid:${runId}`));
    if (!parsed.success) return blocked(`run-invalid:${runId}:${parsed.error.issues[0]?.message ?? "invalid"}`);
    const run = parsed.data;
    if (run.runId !== runId || run.groupId !== groupId || String(row.group_id) !== groupId
      || run.workItemId !== String(row.work_item_id) || run.generation !== Number(row.generation)
      || !validAccounting(run)) return blocked(`run-identity:${runId}`);

    const state = displayRunState(run);
    const terminal = ["failed-before-provider", "settled-recoverable", "settled-restartable", "settled-unrecoverable"].includes(state);
    if ((Number(row.active) === 1) === terminal
      || (Number(row.active) === 1 && run.graphVersion !== graphVersion)
      || ((run.state === "accepted" || run.state === "settled") && run.providerAttemptOrdinal === 0)) {
      return blocked(`run-state:${runId}`);
    }

    let profile: RunViewV1["profile"];
    if (run.phase === "estimate") {
      if (run.taskId !== null || run.estimateId === null || run.claimOrdinal !== null || run.handoffProfile !== null
        || run.workItemId !== run.estimateId || run.executionProfile.workKind !== "budget-estimate") return blocked(`run-estimate-identity:${runId}`);
      const estimate = readEstimateRecord(store, groupId, run.estimateId);
      const zero = { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 };
      if (!sameBinding(run.executionProfile, estimate.profile, "budget-estimate")
        || canonicalBytes(run.grant.work).compare(canonicalBytes(estimate.grant)) !== 0
        || canonicalBytes(run.grant.handoff).compare(canonicalBytes(zero)) !== 0) return blocked(`run-estimate-profile:${runId}`);
      profile = profileView(run.executionProfile);
    } else {
      if (!proposal.profiles) return blocked(`run-profile-missing:${runId}`);
      if (run.taskId === null || run.estimateId !== null || run.claimOrdinal === null || run.handoffProfile === null) return blocked(`run-task-identity:${runId}`);
      const workRow = store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(groupId, run.workItemId);
      if (!workRow) return blocked(`run-work-missing:${runId}`);
      const work = parseStored(workBodySchema, workRow.body, `run-work-invalid:${runId}`);
      // Handoff delivery plan deviation D-VIEW (2026-09-25): Web spec §5.1.1 parks a recoverable predecessor's
      // remainder as the task's grant, the grant its continuation is claimed with. So the task's grant is its
      // current run's claim grant -- or, while that run is the parked predecessor, its remaining -- and an older
      // run of the task's lineage keeps the grant it was claimed with.
      const current = work.currentRunId === runId;
      const claimed = current && run.state === "settled-recoverable" ? run.remaining : run.grant;
      if (work.workItemId !== run.workItemId || work.taskId !== run.taskId || work.configHash !== run.configHash
        || work.targetVersion !== run.targetVersion
        || (current && canonicalBytes(work.grant).compare(canonicalBytes(claimed)) !== 0)
        || !sameBinding(run.executionProfile, proposal.profiles.worker, "task")
        || !sameBinding(run.handoffProfile, proposal.profiles.handoff, "handoff")) return blocked(`run-work-identity:${runId}`);
      if (run.phase === "handoff") {
        const requests = store.db.prepare("SELECT body FROM handoff_requests WHERE group_id=? AND run_id=?").all(groupId, runId);
        if (!requests.some(request => {
          const body = handoffBodySchema.safeParse(parseJson(request.body, `run-handoff-invalid:${runId}`));
          return body.success && body.data.phaseAttemptOrdinal === run.providerAttemptOrdinal;
        })) return blocked(`run-handoff-request:${runId}`);
        profile = profileView(run.handoffProfile);
      } else {
        profile = profileView(run.executionProfile);
      }
    }
    const bucket = run.phase === "handoff" ? "handoff" : "work";
    return {
      runId, taskId: run.taskId, estimateId: run.estimateId, generation: run.generation, state, phase: run.phase,
      claimOrdinal: run.claimOrdinal, providerAttemptOrdinal: run.providerAttemptOrdinal, profile,
      used: run.cumulative[bucket], remaining: run.remaining[bucket], failureCode: run.failureCode,
      blockedReason: run.drive?.blockedReason ?? null,
      continuable: continuableRun(store, run),
      evidenceIds: artifactIdsForRun(store, runId),
    };
  });
}

function checkpointViews(store: ControlStore, groupId: string): CheckpointViewV1[] {
  return store.db.prepare("SELECT checkpoints.id,checkpoints.run_id,checkpoints.body FROM checkpoints JOIN runs ON runs.id=checkpoints.run_id WHERE runs.group_id=? ORDER BY checkpoints.id").all(groupId).map(row => {
    const raw = parseJson(row.body, `checkpoint-invalid:${String(row.id)}`) as Record<string, unknown>;
    if (raw.checkpointId !== String(row.id) || raw.runId !== String(row.run_id) || typeof raw.taskId !== "string") return blocked("checkpoint-identity");
    const snapshot = artifactSchema.safeParse(raw.snapshot).success ? artifactSchema.parse(raw.snapshot) : null;
    const missing = Array.isArray(raw.missing) ? raw.missing : [];
    const state: CheckpointViewV1["state"] = raw.result === "complete" && snapshot && missing.length === 0 ? "complete" : raw.result === "partial" || raw.result === "failed" ? "partial" : "unknown";
    return { checkpointId: String(row.id), taskId: raw.taskId, runId: String(row.run_id), state, snapshotHash: snapshot?.hash ?? null, evidenceIds: artifactIdsForRun(store, String(row.run_id)) };
  });
}

function handoffViews(store: ControlStore, groupId: string): HandoffRequestViewV1[] {
  return store.db.prepare("SELECT id,run_id,state,body FROM handoff_requests WHERE group_id=? ORDER BY id").all(groupId).map(row => {
    const bodyJson = String(row.body);
    const body = parseStored(handoffBodySchema, bodyJson, `handoff-request-invalid:${String(row.id)}`);
    const run = store.db.prepare("SELECT group_id FROM runs WHERE id=?").get(String(row.run_id));
    if (body.requestId !== String(row.id) || body.runId !== String(row.run_id) || body.state !== String(row.state)
      || canonicalBytes(body).toString("utf8") !== bodyJson || !run || String(run.group_id) !== groupId
      || sortedUnique(body.evidenceIds).join("\0") !== body.evidenceIds.join("\0")) return blocked("handoff-request-identity");
    return body;
  });
}

export function readControlGroup(store: ControlStore, epoch: string, groupId: string): GroupViewV1 {
  const body = groupBody(store, groupId);
  const archived = readArchivedPlan(store, groupId);
  const proposal = readBudgetProposal(store, groupId);
  const snapshot = validateExecutionSnapshot(store, groupId, archived.graphVersion, proposal, archived.plan);
  const estimates = estimateViews(store, groupId);
  const summary = readGroupSummary(store, groupId);
  const blockers = blockerRows(store, groupId).map(({ groupId: _groupId, ...blocker }) => blocker);
  const commandIds = store.db.prepare("SELECT id FROM commands WHERE group_id=? AND original_status IS NOT NULL ORDER BY rowid DESC LIMIT 20").all(groupId).map(row => String(row.id));
  const allocations = [...proposal.allocations, ...estimates.allocations]
    .sort((left, right) => `${left.ownerKind}\0${left.ownerId}\0${left.bucket}`.localeCompare(`${right.ownerKind}\0${right.ownerId}\0${right.bucket}`));
  const view = {
    schema: "orca-control-group-v1" as const,
    epoch,
    changeSeq: readProjectionState(store).changeSeq,
    summary,
    graphVersion: archived.graphVersion,
    plan: { repoId: archived.plan.repoId, planId: archived.plan.planId, planHash: archived.planHash, goal: archived.plan.goal, successConditions: [...archived.plan.successConditions] },
    proposal: {
      state: proposal.state, proposalVersion: proposal.proposalVersion, planHash: proposal.planHash,
      budgetMode: proposal.budgetMode, contextPolicy: proposal.contextPolicy, profiles: proposal.profiles,
      executionSnapshotHash: proposal.executionSnapshotHash,
    },
    ledger: body.ledger,
    allocations,
    workItems: workViews(store, groupId, archived.plan, snapshot),
    estimates: estimates.views,
    runs: runViews(store, groupId, archived.graphVersion, proposal),
    checkpoints: checkpointViews(store, groupId),
    handoffRequests: handoffViews(store, groupId),
    stop: stopView(store, groupId, body.stopped),
    recoveryBlockers: blockers,
    recentCommandIds: sortedUnique(commandIds),
  };
  const parsed = groupViewSchema.safeParse(view);
  if (!parsed.success) return blocked(`group-view:${parsed.error.issues[0]?.path.join(".")}:${parsed.error.issues[0]?.message}`);
  return parsed.data;
}

export function readControlRecovery(store: ControlStore, epoch: string): RecoveryViewV1 {
  const view = { schema: "orca-control-recovery-v1" as const, epoch, dispatchBlocked: store.dispatchBlocked, blockers: blockerRows(store) };
  const parsed = recoveryViewSchema.safeParse(view);
  if (!parsed.success) return blocked(`recovery-view:${parsed.error.issues[0]?.message ?? "invalid"}`);
  return parsed.data;
}

type EvidenceRef = { evidenceId: string; kind: string; sha256: string };

function artifactById(store: ControlStore, evidenceId: string, kind: string): EvidenceRef {
  if (!idSchema.safeParse(evidenceId).success) return blocked("evidence-id-invalid");
  const row = store.db.prepare("SELECT hash FROM artifacts WHERE id=?").get(evidenceId);
  if (!row || !hashSchema.safeParse(row.hash).success) return blocked("evidence-reference-dangling");
  return { evidenceId, kind, sha256: String(row.hash) };
}

function evidenceRefs(store: ControlStore, runId: string, groupId: string): EvidenceRef[] {
  const refs = new Map<string, EvidenceRef>();
  const remember = (ref: EvidenceRef): void => {
    const prior = refs.get(ref.evidenceId);
    if (prior && prior.sha256 !== ref.sha256) return blocked("evidence-reference-conflict");
    if (!prior) refs.set(ref.evidenceId, ref);
  };
  const add = (value: unknown, kind: string, required = false): void => {
    if (value === null || value === undefined) {
      if (required) return blocked("evidence-reference-missing");
      return;
    }
    const parsed = artifactSchema.safeParse(value);
    if (!parsed.success) return blocked("evidence-reference-invalid");
    remember({ evidenceId: parsed.data.artifactId, kind, sha256: parsed.data.hash });
  };
  for (const row of store.db.prepare("SELECT body FROM usage_events WHERE run_id=? ORDER BY seq").all(runId)) {
    add((parseJson(row.body, "usage-event-invalid") as { source?: unknown }).source, "usage", true);
  }
  for (const row of store.db.prepare("SELECT body FROM checkpoints WHERE run_id=? ORDER BY id").all(runId)) {
    const body = parseJson(row.body, "checkpoint-invalid") as { artifacts?: unknown[]; snapshot?: unknown; handoff?: unknown; stopProof?: unknown };
    if (!Array.isArray(body.artifacts)) return blocked("checkpoint-artifacts-invalid");
    for (const ref of body.artifacts ?? []) add(ref, "artifact", true);
    add(body.snapshot, "snapshot"); add(body.handoff, "handoff", true);
    if (body.stopProof !== null && body.stopProof !== undefined) {
      if (typeof body.stopProof !== "object" || !("source" in body.stopProof)) return blocked("checkpoint-stop-proof-invalid");
      add((body.stopProof as { source: unknown }).source, "stop-proof", true);
    }
  }
  for (const row of store.db.prepare("SELECT kind,body FROM outbox ORDER BY id").all()) {
    const body = parseJson(row.body, "outbox-evidence-invalid") as Record<string, unknown>;
    if (body.runId !== runId) continue;
    if (body.artifacts !== undefined && !Array.isArray(body.artifacts)) return blocked("outbox-artifacts-invalid");
    for (const ref of body.artifacts ?? [] as unknown[]) add(ref, String(row.kind), true);
    add(body.snapshot, String(row.kind)); add(body.source, String(row.kind));
  }
  for (const row of store.db.prepare("SELECT id,group_id,state,body FROM handoff_requests WHERE run_id=? ORDER BY id").all(runId)) {
    if (String(row.group_id) !== groupId) return blocked("handoff-evidence-owner");
    const bodyJson = String(row.body);
    const body = parseStored(handoffBodySchema, bodyJson, "handoff-evidence-invalid");
    if (body.requestId !== String(row.id) || body.runId !== runId || body.state !== String(row.state)
      || canonicalBytes(body).toString("utf8") !== bodyJson
      || sortedUnique(body.evidenceIds).join("\0") !== body.evidenceIds.join("\0")) return blocked("handoff-evidence-identity");
    for (const evidenceId of body.evidenceIds) remember(artifactById(store, evidenceId, "handoff-request"));
  }
  for (const row of store.db.prepare("SELECT group_id,scope,body FROM recovery_blockers WHERE run_id=? ORDER BY id").all(runId)) {
    if (String(row.group_id) !== groupId || !["run", "global"].includes(String(row.scope))) return blocked("recovery-evidence-owner");
    const bodyJson = String(row.body);
    const body = parseStored(blockerBodySchema, bodyJson, "recovery-evidence-invalid");
    if (canonicalBytes(body).toString("utf8") !== bodyJson
      || sortedUnique(body.evidenceIds).join("\0") !== body.evidenceIds.join("\0")) return blocked("recovery-evidence-identity");
    for (const evidenceId of body.evidenceIds) remember(artifactById(store, evidenceId, "recovery-blocker"));
  }
  return [...refs.values()].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
}

export async function readRunEvidence(store: ControlStore, runId: string): Promise<EvidenceManifestV1> {
  const row = idSchema.safeParse(runId).success
    ? store.db.prepare("SELECT group_id FROM runs WHERE id=?").get(runId)
    : undefined;
  if (!row) throw new ControlError("run-not-found");
  const groupId = String(row.group_id);
  const proposal = readBudgetProposal(store, groupId);
  const archived = readArchivedPlan(store, groupId);
  runViews(store, groupId, archived.graphVersion, proposal);
  const entries = await Promise.all(evidenceRefs(store, runId, groupId).map(async ref => {
    let bytes: Buffer;
    try { bytes = await readArtifact(store, { artifactId: ref.evidenceId, hash: ref.sha256 }); }
    catch (error) {
      if (error instanceof ControlError && ["artifact-not-found", "artifact-hash-mismatch"].includes(error.code)) return blocked("evidence-artifact-invalid");
      throw error;
    }
    return { ...ref, byteLength: bytes.byteLength, downloadUrl: `/api/control/runs/${encodeURIComponent(runId)}/evidence/${encodeURIComponent(ref.evidenceId)}` };
  }));
  const parsed = evidenceManifestSchema.safeParse({ schema: "orca-run-evidence-v1", runId, entries });
  if (!parsed.success) return blocked(`evidence-manifest:${parsed.error.issues[0]?.message ?? "invalid"}`);
  return parsed.data;
}
