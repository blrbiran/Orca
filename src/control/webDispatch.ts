import { createHash, randomUUID } from "node:crypto";
import { applyWebCommand, preflightWebCommand, type WebCommandContext } from "./commandLedger.js";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { readBudgetProposal, readGroup, readWork, saveWork } from "./queries.js";
import { readCanonicalRecord, writeCanonicalRecord } from "./snapshot.js";
import { ControlError } from "./errors.js";
import { zero } from "./commands.js";
import { dispatchEnvelopeSchema, executionSnapshotSchema, type CapabilityViewV1, type CommandErrorBodyV1, type CommandSuccessV1, type DispatchEnvelopeV1, type ExecutionSnapshotV1, type NoProviderStartProofV1, type ProfileBindingV1, type ProviderStartMarkerV1, type ProofAcceptedRecordV1, type RawAuthorityCommandV1 } from "./webProtocol.js";
import type { ExecutionProfileRouter, FrozenProfile, ObservedProfile } from "./profiles.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { WakeHandler, WakeHandlers } from "./dispatch.js";
import type { ControlStore } from "./store.js";
import { claimableContinuations, continuationAlreadyClaimed, continuationWakeBody, type RegisteredContinuation } from "./continuation.js";

export type Phase = "estimate" | "work" | "handoff";
export type StartCommand = Extract<RawAuthorityCommandV1, { verb: "start" }>;
export interface WebDispatchDeps { store: ControlStore; profileRouter: ExecutionProfileRouter; admissionGate?: AdmissionGate }
export interface AttemptTuple { runId: string; generation: number; phase: Phase; providerAttemptOrdinal: number }
export interface DispatchRun {
  runId: string; groupId: string; workItemId: string; taskId: string | null; generation: number;
  graphVersion: number; targetVersion: number; commandId: string; configHash: string;
  grant: { work: unknown; handoff: unknown }; ownerToken: string; state: string; phase: Phase;
  claimOrdinal: number | null; providerAttemptOrdinal: number; remaining: { work: unknown; handoff: unknown };
  cumulative: unknown; unknown: { work: boolean; handoff: boolean }; highWater: number; breaches: unknown[];
  executionProfile: unknown; handoffProfile: unknown;
  failureCode: string | null; [key: string]: unknown;
}
type CommandResult = CommandSuccessV1 | CommandErrorBodyV1;

function groupTarget(command: RawAuthorityCommandV1): string {
  if (command.target.kind !== "group") throw new ControlError("control-target-not-allowed");
  return command.target.groupId;
}

function readDispatchRun(store: ControlStore, runId: string): DispatchRun {
  const row = store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId);
  if (!row) throw new ControlError("run-not-found");
  return JSON.parse(String(row.body)) as DispatchRun;
}

function saveDispatchRun(store: ControlStore, run: DispatchRun): void {
  store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(run), run.runId);
}

function readFrozenSnapshot(store: ControlStore, groupId: string): ExecutionSnapshotV1 {
  const proposal = readBudgetProposal(store, groupId);
  if (proposal.state !== "confirmed" || proposal.executionSnapshotHash === null) throw new ControlError("group-state-invalid");
  return executionSnapshotSchema.parse(JSON.parse(readCanonicalRecord(store, proposal.executionSnapshotHash)));
}

/** A degraded required probe blocks dispatch; it is never silently downgraded. */
function probeBlocksDispatch(observation: ObservedProfile, mode: "strict" | "soft"): boolean {
  if (observation.probeFailureCode !== null) return true;
  const cap = observation.observed as CapabilityViewV1;
  return cap.usageObservation === "unavailable"
    || cap.budgetEnforcement === "unavailable"
    || cap.handoffControl !== "durable"
    || cap.handoffExecution === null
    || (mode === "strict" && (cap.budgetEnforcement !== "bounded" || cap.requestBoundProof === null || !cap.requestBoundProof.workDimensions.includes("tokens")));
}

function resolveBindings(router: ExecutionProfileRouter, snapshot: ExecutionSnapshotV1): { worker: FrozenProfile; handoff: FrozenProfile } {
  return { worker: router.resolve("task", snapshot.profiles.worker.profileId, snapshot.profiles.worker.profileHash), handoff: router.resolve("handoff", snapshot.profiles.handoff.profileId, snapshot.profiles.handoff.profileHash) };
}

function success(context: WebCommandContext, result: CommandSuccessV1["result"], status = 200): { status: number; body: CommandSuccessV1 } {
  return { status, body: {
    schema: "orca-command-success-v1", commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId, verb: context.rawCommand.verb,
    target: context.rawCommand.target, commandRevision: context.nextCommandRevision, projectionSeq: context.nextProjectionSeq,
    effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash, result,
  } };
}

/** Commit the durable start wake only after the frozen profiles still probe clean. */
export async function scheduleStart(deps: WebDispatchDeps, command: StartCommand): Promise<CommandResult> {
  const { store, profileRouter, admissionGate } = deps;
  const replay = preflightWebCommand<CommandResult>(store, command);
  if (replay) return replay.body;
  const release = admissionGate?.enter();
  try {
    let degraded = false;
    try {
      const snapshot = readFrozenSnapshot(store, groupTarget(command));
      const bindings = resolveBindings(profileRouter, snapshot);
      const observations = await Promise.all([profileRouter.probe(bindings.worker), profileRouter.probe(bindings.handoff)]);
      degraded = observations.some((observation) => probeBlocksDispatch(observation, snapshot.budgetMode));
    } catch (error) {
      // profile-changed and the remaining precedence codes are decided by the synchronous walk below.
      if (!(error instanceof ControlError) || error.code !== "profile-changed") throw error;
    }
    const outcome = applyWebCommand<CommandResult>(store, {
      rawCommand: command,
      expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      apply: (context) => {
        const groupId = groupTarget(command);
        const group = readGroup(store, groupId);
        if (group.status !== "ready") throw new ControlError("group-state-invalid");
        const snapshot = readFrozenSnapshot(store, groupId);
        if (group.graphVersion !== snapshot.graphVersion) throw new ControlError("plan-version-conflict");
        if (store.dispatchBlocked || (group as unknown as { ledger?: { usageUnknown?: boolean } }).ledger?.usageUnknown) throw new ControlError("recovery-blocked");
        if (store.db.prepare("SELECT group_id FROM stop_intents WHERE group_id=?").get(groupId)) throw new ControlError("stop-mode-conflict");
        for (const row of store.db.prepare("SELECT state FROM estimates WHERE group_id=?").all(groupId)) {
          if (["running", "start-unknown"].includes(String(row.state))) throw new ControlError("estimate-in-flight");
        }
        resolveBindings(profileRouter, snapshot);
        if (degraded) throw new ControlError("control-capability-unsupported");
        const wakeId = `scheduler-wake:${groupId}:${context.nextCommandRevision}`;
        store.db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES (?,?,'start',?,0)")
          .run(wakeId, groupId, canonicalBytes({ groupId, startRevision: context.nextCommandRevision, executionSnapshotHash: sha256Canonical(snapshot) }).toString("utf8"));
        return success(context, { kind: "scheduled", operation: "start", wakeId }, 202);
      },
    });
    return outcome.body;
  } finally { release?.(); }
}

interface ClaimedWake { id: string; body: { groupId: string; startRevision: number; executionSnapshotHash?: string } }

/** Both start wakes open a claim: the original start command and a no-start re-arm of it. */
function pendingStartWake(store: ControlStore, groupId: string): ClaimedWake | null {
  const row = store.db.prepare("SELECT id,body FROM scheduler_wakes WHERE group_id=? AND kind IN ('start','no-start') AND delivered=0 ORDER BY rowid").get(groupId);
  if (!row) return null;
  const body = JSON.parse(String(row.body)) as ClaimedWake["body"];
  return { id: String(row.id), body };
}

/**
 * A registered continuation batch outranks ordinary dispatch: it must be retried on the
 * same claim identity it was registered under, not replaced by a fresh ready-work claim.
 */
function pendingResumeWake(store: ControlStore, groupId: string): { id: string; resumeRevision: number; continuations: RegisteredContinuation[] } | null {
  const body = continuationWakeBody(store, groupId);
  if (!body) return null;
  const row = store.db.prepare("SELECT id FROM scheduler_wakes WHERE group_id=? AND kind='resume' AND delivered=0 ORDER BY rowid").get(groupId);
  if (!row) return null;
  return { id: String(row.id), resumeRevision: body.resumeRevision, continuations: body.continuations };
}

function stopIsPending(store: ControlStore, groupId: string): boolean {
  return store.db.prepare("SELECT group_id FROM stop_intents WHERE group_id=?").get(groupId) !== undefined;
}

function activeWorkRun(store: ControlStore, groupId: string): { kind: "claimed"; runId: string } | null {
  for (const row of store.db.prepare("SELECT id,body FROM runs WHERE group_id=? AND active=1").all(groupId)) {
    if (JSON.parse(String(row.body)).phase === "work") return { kind: "claimed", runId: String(row.id) };
  }
  return null;
}

/**
 * The scheduler delivers the wake: it re-probes, then in one transaction either
 * creates exactly one `starting` run or records a group-local blocker.
 */
export async function deliverScheduledStart(deps: WebDispatchDeps, groupId: string): Promise<{ kind: "claimed"; runId: string } | { kind: "blocked"; reason: string } | { kind: "idle" }> {
  const { store, profileRouter, admissionGate } = deps;
  const release = admissionGate?.enter();
  try {
    const wake = pendingResumeWake(store, groupId) ?? pendingStartWake(store, groupId);
    if (!wake) return activeWorkRun(store, groupId) ?? { kind: "idle" };
    if (stopIsPending(store, groupId)) return { kind: "blocked", reason: "group-stopped" };
    const snapshot = readFrozenSnapshot(store, groupId);
    let blocked = false;
    try {
      const bindings = resolveBindings(profileRouter, snapshot);
      const observations = await Promise.all([profileRouter.probe(bindings.worker), profileRouter.probe(bindings.handoff)]);
      blocked = observations.some((observation) => probeBlocksDispatch(observation, snapshot.budgetMode));
    } catch (error) {
      if (!(error instanceof ControlError) || error.code !== "profile-changed") throw error;
      blocked = true;
    }
    return store.transaction(() => {
      const still = pendingResumeWake(store, groupId) ?? pendingStartWake(store, groupId);
      if (!still) return activeWorkRun(store, groupId) ?? { kind: "idle" as const };
      // `scheduleStart` refuses to arm a wake while usage is unknown; the wake outlives that
      // check, so delivery re-reads the ledger rather than claiming on an unknowable budget.
      const ledgerGroup = readGroup(store, groupId) as unknown as { ledger?: { usageUnknown?: boolean } };
      if (ledgerGroup.ledger?.usageUnknown) return { kind: "blocked" as const, reason: "usage-unknown" };
      if (blocked) {
        store.db.prepare("INSERT INTO recovery_blockers(id,group_id,run_id,scope,code,body) VALUES (?,?,NULL,'group','claim-capability-unavailable',?) ON CONFLICT(id) DO NOTHING")
          .run(`claim-blocked:${groupId}:${still.id}`, groupId, canonicalBytes({ evidenceIds: [] }).toString("utf8"));
        return { kind: "blocked" as const, reason: "claim-capability-unavailable" };
      }
      const startRevision = "resumeRevision" in still ? still.resumeRevision : still.body.startRevision;
      if ("resumeRevision" in still) {
        const continuation = deliverContinuationWake(store, groupId, still, snapshot);
        if (continuation !== null) return continuation;
      }
      const work = nextClaimableTask(store, groupId);
      if (!work) {
        store.db.prepare("UPDATE scheduler_wakes SET delivered=1 WHERE id=?").run(still.id);
        return { kind: "idle" as const };
      }
      const run = createStartingRun(store, groupId, work, snapshot, startRevision);
      store.db.prepare("UPDATE scheduler_wakes SET delivered=1 WHERE id=?").run(still.id);
      return { kind: "claimed" as const, runId: run.runId };
    });
  } finally { release?.(); }
}

type WakeOutcome = { kind: "claimed"; runId: string } | { kind: "idle" };

/**
 * Claim the registered continuations of a resume wake in request order. Returns null once the
 * batch is exhausted so the same delivery can fall through to ordinary ready work.
 */
function deliverContinuationWake(
  store: ControlStore,
  groupId: string,
  wake: { id: string; resumeRevision: number; continuations: RegisteredContinuation[] },
  snapshot: ExecutionSnapshotV1,
): WakeOutcome | null {
  if (wake.continuations.length === 0) {
    store.db.prepare("UPDATE scheduler_wakes SET delivered=1 WHERE id=?").run(wake.id);
    return null;
  }
  const actionable = claimableContinuations(store, groupId, wake.continuations);
  const consumed = wake.continuations.filter(registered => continuationAlreadyClaimed(store, registered));
  if (actionable.length === 0) {
    store.db.prepare("UPDATE scheduler_wakes SET delivered=1 WHERE id=?").run(wake.id);
    const last = consumed.at(-1);
    return last ? { kind: "claimed", runId: last.pendingRunId } : null;
  }
  // One delivery finishes the batch: the scheduler acks any wake whose handler reported a
  // claim, so claiming only the first would leave the rest `continuing` with no wake to run them.
  let first: DispatchRun | null = null;
  for (const registered of actionable) {
    const run = createStartingRun(store, groupId, { workItemId: registered.taskId }, snapshot, wake.resumeRevision, registered);
    first ??= run;
  }
  store.db.prepare("UPDATE scheduler_wakes SET delivered=1 WHERE id=?").run(wake.id);
  return { kind: "claimed", runId: first!.runId };
}

interface ClaimableTask { workItemId: string }

function nextClaimableTask(store: ControlStore, groupId: string): ClaimableTask | null {
  const rows = store.db.prepare("SELECT id,body FROM work_items WHERE group_id=? ORDER BY id").all(groupId);
  for (const row of rows) {
    const work = JSON.parse(String(row.body)) as { workItemId: string; kind: string; status: string; dependsOn?: string[] };
    if (work.kind !== "task" || work.status !== "ready") continue;
    if (store.db.prepare("SELECT id FROM runs WHERE group_id=? AND work_item_id=? AND active=1").get(groupId, work.workItemId)) continue;
    const ready = (work.dependsOn ?? []).every((id) => {
      const dependency = store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(groupId, id);
      return dependency !== undefined && JSON.parse(String(dependency.body)).status === "done";
    });
    if (!ready) continue;
    return { workItemId: work.workItemId };
  }
  return null;
}

function createStartingRun(
  store: ControlStore,
  groupId: string,
  target: { workItemId: string },
  snapshot: ExecutionSnapshotV1,
  startRevision: number,
  continuation?: RegisteredContinuation,
): DispatchRun {
  const work = readWork(store, groupId, target.workItemId);
  const claimOrdinal = continuation ? continuation.claimOrdinal : ((work as unknown as { claimOrdinal?: number }).claimOrdinal ?? 0) + 1;
  const claimIdentity = continuation
    ? `${continuation.desiredIntentId}:attempt:${claimOrdinal}`
    : `task:${groupId}:${startRevision}:${work.taskId}:attempt:${claimOrdinal}`;
  const grant = structuredClone((work as unknown as { grant: { work: unknown; handoff: unknown } }).grant);
  const runId = continuation ? continuation.pendingRunId : `run-${randomUUID()}`;
  const ownerToken = randomUUID();
  const binding = (slot: ProfileBindingV1): { profileId: string; profileHash: string } => ({ profileId: slot.profileId, profileHash: slot.profileHash });
  const envelope = dispatchEnvelopeSchema.parse({
    schema: "orca-dispatch-envelope-v1", phase: "work", groupId, workItemId: work.workItemId, runId, generation: 1,
    claimIdentity,
    ownerTokenHash: createHash("sha256").update(ownerToken).digest("hex"),
    continuationIntentId: continuation?.continuationIntentId ?? null, claimOrdinal,
    derivedContractHash: (work as unknown as { derivedContractHash: string }).derivedContractHash, grants: grant,
    profiles: { estimator: null, worker: binding(snapshot.profiles.worker), handoff: binding(snapshot.profiles.handoff) },
  });
  const envelopeHash = sha256Canonical(envelope);
  writeCanonicalRecord(store, groupId, envelopeHash, canonicalBytes(envelope).toString("utf8"));
  const run: DispatchRun = {
    runId, groupId, workItemId: work.workItemId, taskId: work.taskId, estimateId: null, generation: 1,
    graphVersion: snapshot.graphVersion, targetVersion: work.targetVersion,
    commandId: continuation ? `continue-${groupId}-${continuation.resumeRevision}-${work.workItemId}` : `start-${groupId}-${startRevision}-${work.workItemId}`,
    configHash: work.configHash, grant, ownerToken, executionId: null, state: "starting", checkpointId: null, recoverable: false,
    remaining: structuredClone(grant), cumulative: { work: zero(), handoff: zero() }, unknown: { work: false, handoff: false },
    highWater: 0, breaches: [], handoffWorkItemId: null, phase: "work", claimOrdinal, providerAttemptOrdinal: 0, failureCode: null,
    continuationIntentId: continuation?.continuationIntentId ?? null,
    executionProfile: { workKind: "task", ...binding(snapshot.profiles.worker) }, handoffProfile: { workKind: "handoff", ...binding(snapshot.profiles.handoff) },
  };
  store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?,?,?,1,1,?)").run(runId, groupId, work.workItemId, JSON.stringify(run));
  store.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?,'work-claim',?,0)")
    .run(`work:${groupId}:${runId}`, canonicalBytes({ groupId, workItemId: work.workItemId, runId, envelopeHash, sessionReservation: 1, attemptReservation: 0 }).toString("utf8"));
  const record = readWork(store, groupId, target.workItemId) as unknown as { status: string; currentRunId: string | null; pendingRunId: string | null; claimOrdinal: number; lineageRunIds?: string[] };
  record.status = "running"; record.currentRunId = runId; record.pendingRunId = null; record.claimOrdinal = claimOrdinal;
  record.lineageRunIds = [...new Set([...(record.lineageRunIds ?? []), runId])].sort();
  saveWork(store, groupId, record as never);
  return run;
}

/**
 * A synchronously invalid first-attempt proof is proved not to have started: the run
 * settles `failed-before-provider` with zero provider calls and re-arms the task.
 */
export function settleProviderAttempt(deps: WebDispatchDeps, input: { runId: string; phase: Phase; firstAttemptProof: "invalid" }): { run: DispatchRun; providerCalls: number; wakeId: string | null } {
  const { store } = deps;
  return store.transaction(() => {
    const run = readDispatchRun(store, input.runId);
    const ordinal = run.providerAttemptOrdinal + 1;
    run.providerAttemptOrdinal = ordinal;
    run.state = "failed-before-provider";
    run.failureCode = "request-bound-proof-invalid";
    run.unknown = { work: false, handoff: false };
    // `remaining` stays at the unspent grant: with no provider call the ledger invariant
    // `remaining == max(grant - cumulative, 0)` keeps the whole grant booked to the work item.
    saveDispatchRun(store, run);
    store.db.prepare("UPDATE runs SET active=0 WHERE id=?").run(run.runId);
    const work = readWork(store, run.groupId, run.workItemId) as unknown as { status: string };
    // `currentRunId` names the most recent run for the work item, not an active one,
    // so the failed run keeps it until a re-armed claim replaces it.
    work.status = run.continuationIntentId ? "continuing" : "ready";
    saveWork(store, run.groupId, work as never);
    if (run.continuationIntentId) {
      // A registered continuation is retried only through `recovery-retry`, which re-arms
      // the same intent with a fresh claim ordinal.
      return { run, providerCalls: 0, wakeId: null };
    }
    const wakeId = `scheduler-wake:${run.groupId}:no-start:${run.runId}:${ordinal}`;
    const startRevision = claimStartRevision(readWorkClaimEnvelope(store, run.groupId, run.runId).claimIdentity, run.groupId);
    store.db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES (?,?,'no-start',?,0) ON CONFLICT(id) DO NOTHING")
      .run(wakeId, run.groupId, canonicalBytes({ groupId: run.groupId, runId: run.runId, phase: input.phase, providerAttemptOrdinal: ordinal, startRevision }).toString("utf8"));
    return { run, providerCalls: 0, wakeId };
  });
}

/** The start command revision a claim was made under, read back from its durable identity. */
function claimStartRevision(claimIdentity: string, groupId: string): number {
  const parts = claimIdentity.split(":");
  const revision = Number(parts[2]);
  if (parts.length !== 6 || parts[0] !== "task" || parts[1] !== groupId || !Number.isSafeInteger(revision) || revision <= 0) throw new ControlError("recovery-blocked");
  return revision;
}

function readWorkClaimEnvelope(store: ControlStore, groupId: string, runId: string): DispatchEnvelopeV1 {
  const row = store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='work-claim'").get(`work:${groupId}:${runId}`);
  if (!row) throw new ControlError("start-intent-missing");
  const { envelopeHash } = JSON.parse(String(row.body)) as { envelopeHash: string };
  return dispatchEnvelopeSchema.parse(JSON.parse(readCanonicalRecord(store, envelopeHash)));
}

export type AttemptReservation =
  | { kind: "reserved"; providerAttemptOrdinal: number; envelope: DispatchEnvelopeV1 }
  | { kind: "suppressed"; requestId: string | null };

/**
 * Reserve exactly one provider attempt for one invocation. A run whose context
 * watermark is latched, or whose handoff stop is being collected, can no longer
 * reserve a work-phase attempt at all.
 */
export function beginProviderAttempt(deps: WebDispatchDeps, runId: string, phase: Phase): AttemptReservation {
  const { store, admissionGate } = deps;
  const release = admissionGate?.enter();
  try {
    return store.transaction(() => {
      const run = readDispatchRun(store, runId);
      if (phase === "work") {
        const latch = store.db.prepare("SELECT request_id FROM context_latches WHERE run_id=? AND generation=?").get(runId, run.generation);
        if (latch) return { kind: "suppressed" as const, requestId: latch.request_id == null ? null : String(latch.request_id) };
        const held = store.db.prepare("SELECT id FROM handoff_requests WHERE run_id=? AND state IN ('latched','collecting') ORDER BY rowid")
          .get(runId);
        if (held) return { kind: "suppressed" as const, requestId: String(held.id) };
      }
      run.providerAttemptOrdinal += 1;
      saveDispatchRun(store, run);
      return { kind: "reserved" as const, providerAttemptOrdinal: run.providerAttemptOrdinal, envelope: readWorkClaimEnvelope(store, run.groupId, runId) };
    });
  } finally { release?.(); }
}

function evidenceKind(schema: string): "proof-accepted" | "provider-start" | "no-start" | "adapter-terminal-observation" | "adapter-stop-proof" {  switch (schema) {
    case "orca-proof-accepted-v1": return "proof-accepted";
    case "orca-provider-start-v1": return "provider-start";
    case "orca-no-provider-start-v1": return "no-start";
    case "orca-adapter-terminal-observation-v1": return "adapter-terminal-observation";
    case "orca-adapter-stop-proof-v1": return "adapter-stop-proof";
    default: throw new ControlError("control-evidence-unavailable");
  }
}

type ProofRecord = ProofAcceptedRecordV1 | ProviderStartMarkerV1 | NoProviderStartProofV1;

/** Durably record one proof; a byte-identical repeat is idempotent and never re-charges. */
export function recordProofAck(deps: { store: ControlStore }, input: { runId: string; phase: Phase; providerAttemptOrdinal: number; record: ProofRecord }): { consumed: boolean } {
  const { store } = deps;
  const kind = evidenceKind(input.record.schema);
  const body = canonicalBytes(input.record).toString("utf8");
  return store.transaction(() => {
    const existing = store.db.prepare("SELECT body FROM attempt_evidence WHERE run_id=? AND generation=? AND phase=? AND provider_attempt_ordinal=? AND kind=?")
      .get(input.runId, input.record.generation, input.phase, input.providerAttemptOrdinal, kind);
    if (existing && String(existing.body) !== body) throw new ControlError("recovery-blocked");
    if (!existing) store.db.prepare("INSERT INTO attempt_evidence VALUES (?,?,?,?,?,?)").run(input.runId, input.record.generation, input.phase, input.providerAttemptOrdinal, kind, body);
    return { consumed: false };
  });
}

/**
 * Evaluate one attempt tuple against the durable evidence precedence. Contradictory
 * records leave the run unknown and globally dispatch-blocked; nothing is inferred.
 */
export function recoverAttempt(deps: { store: ControlStore }, tuple: AttemptTuple): { result: "unknown" | "started" | "no-start" | "start-unknown" } {
  const { store } = deps;
  const rows = store.db.prepare("SELECT kind FROM attempt_evidence WHERE run_id=? AND generation=? AND phase=? AND provider_attempt_ordinal=?")
    .all(tuple.runId, tuple.generation, tuple.phase, tuple.providerAttemptOrdinal);
  const kinds = new Set(rows.map((row) => String(row.kind)));
  const startMarker = kinds.has("provider-start");
  const noStart = kinds.has("no-start");
  if ((startMarker && noStart) || (!startMarker && !noStart && !kinds.has("proof-accepted"))) {
    store.dispatchBlocked = true;
    return { result: "unknown" };
  }
  if (startMarker) return { result: "started" };
  if (noStart) return { result: "no-start" };
  return { result: "start-unknown" };
}

export interface EstimateClaimAuthority { claimEstimate(groupId: string, estimateId: string): Promise<unknown> }
export interface WebWakeDeps extends WebDispatchDeps { service: EstimateClaimAuthority }

/** Bind each durable wake kind to the control authority that can settle it. */
export function createWebWakeHandlers(deps: WebWakeDeps): WakeHandlers {
  const { store } = deps;
  const start: WakeHandler = async (wake) => (await deliverScheduledStart(deps, wake.groupId)).kind !== "blocked";
  return {
    start,
    "no-start": start,
    resume: start,
    "budget-estimate": async (wake) => {
      const estimateId = wake.body.estimateId;
      if (typeof estimateId !== "string") throw new ControlError("recovery-blocked");
      await deps.service.claimEstimate(wake.groupId, estimateId);
      return store.db.prepare("SELECT state FROM estimates WHERE group_id=? AND id=?").get(wake.groupId, estimateId)?.state !== "queued";
    },
  };
}
