import { z } from "zod";
import { readArtifact } from "../control/archive.js";
import { canonicalBytes, sha256Canonical } from "../control/canonicalJson.js";
import { ControlError } from "../control/errors.js";
import { readProjectionChanges, readProjectionState } from "../control/projectionJournal.js";
import { readArchivedPlan, readBudgetProposal, readEstimateRecord } from "../control/queries.js";
import { readCanonicalRecord } from "../control/snapshot.js";
import type { ControlStore } from "../control/store.js";
import { amountSchema, artifactSchema, canonicalTimestampSchema, idSchema, safeInteger } from "../control/schema.js";
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
  targetVersion: z.union([z.string().min(1), safeInteger]),
  status: workStatusSchema,
  originalContractHash: hashSchema.optional(),
  derivedContractHash: hashSchema.nullable().optional(),
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
}).passthrough();

const blockerBodySchema = z.object({ evidenceIds: z.array(idSchema) }).passthrough();
const handoffBodySchema = z.object({
  requestId: idSchema,
  runId: idSchema,
  state: z.enum(["request-pending", "latched", "collecting", "settled-recoverable", "settled-restartable", "settled-unrecoverable", "outcome-unknown"]),
  deadlineAt: canonicalTimestampSchema,
  phaseAttemptOrdinal: safeInteger.positive(),
  failureCode: z.string().min(1).nullable(),
  evidenceIds: z.array(idSchema),
}).passthrough();

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
    const body = parseStored(blockerBodySchema, row.body, "recovery-blocker-invalid");
    if (!["global", "group", "run"].includes(scope) || !idSchema.safeParse(owner).success
      || (runId !== null && !idSchema.safeParse(runId).success) || code.length === 0) return blocked("recovery-blocker-identity");
    return { scope: scope as "global" | "group" | "run", groupId: owner, runId, code, evidenceIds: sortedUnique(body.evidenceIds) };
  }).sort((left, right) => `${left.scope}\0${left.groupId}\0${left.runId ?? ""}\0${left.code}`.localeCompare(`${right.scope}\0${right.groupId}\0${right.runId ?? ""}\0${right.code}`));
}

function stopView(store: ControlStore, groupId: string, legacyStopped: boolean): GroupViewV1["stop"] {
  const row = store.db.prepare("SELECT mode,body FROM stop_intents WHERE group_id=?").get(groupId);
  if (!row) return legacyStopped ? { mode: "pause", state: "paused", frozenRunIds: [], acceptedAt: null, deadlineAt: null } : null;
  const stop = parseStored(stopBodySchema, row.body, "stop-intent-invalid");
  if (String(row.mode) !== stop.mode) return blocked("stop-intent-identity");
  return { ...stop, frozenRunIds: sortedUnique(stop.frozenRunIds) };
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
): ExecutionSnapshotV1 | null {
  if (proposal.state !== "confirmed") return null;
  if (!proposal.executionSnapshotHash || !proposal.profiles || !proposal.budgetMode) return blocked("confirmed-proposal-incomplete");
  const canonicalJson = readCanonicalRecord(store, proposal.executionSnapshotHash);
  const parsed = executionSnapshotSchema.safeParse(parseJson(canonicalJson, "execution-snapshot-invalid"));
  if (!parsed.success || canonicalBytes(parsed.data).toString("utf8") !== canonicalJson
    || sha256Canonical(parsed.data) !== proposal.executionSnapshotHash
    || parsed.data.groupId !== groupId || parsed.data.planHash !== proposal.planHash
    || parsed.data.graphVersion !== graphVersion || parsed.data.proposalVersion !== proposal.proposalVersion
    || parsed.data.budgetMode !== proposal.budgetMode
    || canonicalBytes(parsed.data.groupLimit).compare(canonicalBytes(proposal.groupLimit)) !== 0
    || canonicalBytes(parsed.data.contextPolicy).compare(canonicalBytes(proposal.contextPolicy)) !== 0
    || canonicalBytes(parsed.data.profiles).compare(canonicalBytes(proposal.profiles)) !== 0) {
    return blocked("execution-snapshot-identity");
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
  const runs = store.db.prepare("SELECT id,work_item_id,body FROM runs WHERE group_id=? ORDER BY rowid").all(groupId);
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
      || body.configHash !== task.configHash || String(body.targetVersion) !== task.targetVersion
      || body.originalContractHash !== task.originalContractHash
      || contract?.contentAddressedHash !== task.originalContractHash
      || (snapshot !== null && body.derivedContractHash !== derivedByTask.get(task.taskId))
      || sortedUnique(body.dependsOn).join("\0") !== task.dependencyTaskIds.join("\0")) return blocked(`work-item-authority:${task.taskId}`);
    const lineage = body.lineageRunIds ?? runs.filter(run => String(run.work_item_id) === task.taskId).map(run => String(run.id));
    const latest = lineage.at(-1) ?? null;
    const status: WorkItemViewV1["status"] = body.status === "running" ? "active" : body.status === "done" ? "completed" : body.status;
    return {
      taskId: task.taskId, status, dependencyTaskIds: [...task.dependencyTaskIds], targetVersion: task.targetVersion,
      configHash: task.configHash, originalContractHash: task.originalContractHash,
      derivedContractHash: body.derivedContractHash ?? null,
      currentRunId: body.currentRunId ?? latest, pendingRunId: body.pendingRunId ?? null,
      lineageRunIds: sortedUnique(lineage),
    };
  });
}

function artifactIdsForRun(store: ControlStore, runId: string): string[] {
  const ids: string[] = [];
  const add = (value: unknown): void => {
    const parsed = artifactSchema.safeParse(value);
    if (parsed.success) ids.push(parsed.data.artifactId);
  };
  for (const row of store.db.prepare("SELECT body FROM usage_events WHERE run_id=? ORDER BY seq").all(runId)) add((parseJson(row.body, "usage-event-invalid") as { source?: unknown }).source);
  for (const row of store.db.prepare("SELECT body FROM checkpoints WHERE run_id=? ORDER BY id").all(runId)) {
    const body = parseJson(row.body, "checkpoint-invalid") as { artifacts?: unknown[]; snapshot?: unknown; handoff?: unknown; stopProof?: { source?: unknown } };
    for (const ref of body.artifacts ?? []) add(ref);
    add(body.snapshot); add(body.handoff); add(body.stopProof?.source);
  }
  return sortedUnique(ids);
}

function runViews(store: ControlStore, groupId: string, proposal: ReturnType<typeof readBudgetProposal>, estimates: EstimateViewV1[]): RunViewV1[] {
  return store.db.prepare("SELECT id,work_item_id,generation,active,body FROM runs WHERE group_id=? ORDER BY id").all(groupId).map(row => {
    const raw = parseJson(row.body, `run-invalid:${String(row.id)}`) as Record<string, unknown>;
    const runId = String(row.id);
    if (raw.runId !== runId || !idSchema.safeParse(runId).success) return blocked(`run-identity:${runId}`);
    const taskId = typeof raw.taskId === "string" ? raw.taskId : null;
    const estimateId = typeof raw.estimateId === "string" ? raw.estimateId : null;
    const phase = raw.phase === "estimate" || raw.phase === "handoff" ? raw.phase : "work";
    const profileCandidate = raw.profile ?? raw.executionProfile;
    let profile = profileBindingSchema.safeParse(profileCandidate).success ? profileBindingSchema.parse(profileCandidate) : null;
    if (!profile && estimateId) profile = estimates.find(estimate => estimate.estimateId === estimateId)?.profile ?? null;
    if (!profile && proposal.profiles) profile = phase === "handoff" ? proposal.profiles.handoff : phase === "estimate" ? proposal.profiles.estimator : proposal.profiles.worker;
    if (!profile) return blocked(`run-profile:${runId}`);
    const cumulative = raw.cumulative as { work?: unknown; handoff?: unknown } | undefined;
    const remainingGrant = raw.remaining as { work?: unknown; handoff?: unknown } | undefined;
    const usedValue = raw.used ?? (phase === "handoff" ? cumulative?.handoff : cumulative?.work);
    const remainingValue = phase === "handoff" ? remainingGrant?.handoff : remainingGrant?.work;
    const used = amountSchema.safeParse(usedValue).success ? amountSchema.parse(usedValue) : { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 };
    const remaining = amountSchema.safeParse(remainingValue).success ? amountSchema.parse(remainingValue) : { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 };
    const rawState = String(raw.state ?? "unknown");
    const state: RunViewV1["state"] = rawState === "accepted" || rawState === "running" ? "running"
      : rawState === "claimed" || rawState === "starting" ? "starting"
      : rawState === "settled" ? (raw.recoverable === true ? "settled-recoverable" : "settled-unrecoverable")
      : (["unknown", "attempt-unknown", "attempt-proof-invalid", "failed-before-provider", "settled-recoverable", "settled-restartable", "settled-unrecoverable"].includes(rawState)
        ? rawState as RunViewV1["state"] : "unknown");
    return {
      runId, taskId, estimateId, generation: Number(row.generation), state, phase,
      claimOrdinal: Number.isSafeInteger(raw.claimOrdinal) && Number(raw.claimOrdinal) > 0 ? Number(raw.claimOrdinal) : null,
      providerAttemptOrdinal: Number.isSafeInteger(raw.providerAttemptOrdinal) ? Number(raw.providerAttemptOrdinal) : 0,
      profile, used, remaining, failureCode: typeof raw.failureCode === "string" ? raw.failureCode : null,
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
    const body = parseStored(handoffBodySchema, row.body, `handoff-request-invalid:${String(row.id)}`);
    if (body.requestId !== String(row.id) || body.runId !== String(row.run_id) || body.state !== String(row.state)) return blocked("handoff-request-identity");
    return { ...body, evidenceIds: sortedUnique(body.evidenceIds) };
  });
}

export function readControlGroup(store: ControlStore, epoch: string, groupId: string): GroupViewV1 {
  const body = groupBody(store, groupId);
  const archived = readArchivedPlan(store, groupId);
  const proposal = readBudgetProposal(store, groupId);
  const snapshot = validateExecutionSnapshot(store, groupId, archived.graphVersion, proposal);
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
    runs: runViews(store, groupId, proposal, estimates.views),
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

function evidenceRefs(store: ControlStore, runId: string): EvidenceRef[] {
  const refs = new Map<string, EvidenceRef>();
  const add = (value: unknown, kind: string): void => {
    if (value === null || value === undefined) return;
    const parsed = artifactSchema.safeParse(value);
    if (!parsed.success) return blocked("evidence-reference-invalid");
    const prior = refs.get(parsed.data.artifactId);
    if (prior && prior.sha256 !== parsed.data.hash) return blocked("evidence-reference-conflict");
    if (!prior) refs.set(parsed.data.artifactId, { evidenceId: parsed.data.artifactId, kind, sha256: parsed.data.hash });
  };
  for (const row of store.db.prepare("SELECT body FROM usage_events WHERE run_id=? ORDER BY seq").all(runId)) add((parseJson(row.body, "usage-event-invalid") as { source?: unknown }).source, "usage");
  for (const row of store.db.prepare("SELECT body FROM checkpoints WHERE run_id=? ORDER BY id").all(runId)) {
    const body = parseJson(row.body, "checkpoint-invalid") as { artifacts?: unknown[]; snapshot?: unknown; handoff?: unknown; stopProof?: { source?: unknown } };
    for (const ref of body.artifacts ?? []) add(ref, "artifact");
    add(body.snapshot, "snapshot"); add(body.handoff, "handoff"); add(body.stopProof?.source, "stop-proof");
  }
  for (const row of store.db.prepare("SELECT kind,body FROM outbox ORDER BY id").all()) {
    const body = parseJson(row.body, "outbox-evidence-invalid") as Record<string, unknown>;
    if (body.runId !== runId) continue;
    for (const ref of Array.isArray(body.artifacts) ? body.artifacts : []) add(ref, String(row.kind));
    add(body.snapshot, String(row.kind)); add(body.source, String(row.kind));
  }
  return [...refs.values()].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
}

export async function readRunEvidence(store: ControlStore, runId: string): Promise<EvidenceManifestV1> {
  if (!idSchema.safeParse(runId).success || !store.db.prepare("SELECT id FROM runs WHERE id=?").get(runId)) throw new ControlError("run-not-found");
  const entries = await Promise.all(evidenceRefs(store, runId).map(async ref => {
    const bytes = await readArtifact(store, { artifactId: ref.evidenceId, hash: ref.sha256 });
    return { ...ref, byteLength: bytes.byteLength, downloadUrl: `/api/control/runs/${encodeURIComponent(runId)}/evidence/${encodeURIComponent(ref.evidenceId)}` };
  }));
  const parsed = evidenceManifestSchema.safeParse({ schema: "orca-run-evidence-v1", runId, entries });
  if (!parsed.success) return blocked(`evidence-manifest:${parsed.error.issues[0]?.message ?? "invalid"}`);
  return parsed.data;
}
