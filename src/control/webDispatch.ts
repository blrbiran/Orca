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
import type { AgentSelection } from "./agentSelection.js";
import { frozenWorkAgent } from "./agentFreeze.js";
import { claimableContinuations, continuationAlreadyClaimed, continuationWakeBody, type RegisteredContinuation } from "./continuation.js";
import { singleCallClaimRowOf } from "./singleCall.js";
import { claimRequirementCall } from "./requirementCalls.js";
import { hasRequirementBlock, readRequirementGroup } from "./requirementRecords.js";
import { claimCapBlocking, gateClaim } from "./spendCaps.js";
import { noteRunWrite, recordActivity } from "./activity.js";

export type Phase = "estimate" | "work" | "handoff" | "single-call";
export type StartCommand = Extract<RawAuthorityCommandV1, { verb: "start" }>;
/** `now` dates the spend caps' periods at a claim (accounts spec §6.3.1); the service's clock type, the wall clock unless given. */
export interface WebDispatchDeps { store: ControlStore; profileRouter: ExecutionProfileRouter; admissionGate?: AdmissionGate; now?: () => Date }
export interface AttemptTuple { runId: string; generation: number; phase: Phase; providerAttemptOrdinal: number }
export interface DispatchRun {
  runId: string; groupId: string; workItemId: string; taskId: string | null; generation: number;
  graphVersion: number; targetVersion: number; commandId: string; configHash: string; agent: AgentSelection;
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
  // Issue-fixes spec §5.2: a state change writes its activity row (and endedAt) in this same transaction.
  noteRunWrite(store, run);
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

/**
 * Agent selection spec §6.4 last paragraph (W5-M12): the start gates run before a task is chosen, so they probe each
 * distinct selection the group's tasks were frozen with -- never the operator's current default. Any degraded one
 * blocks the group, as one degraded profile did.
 */
function frozenTaskSelections(store: ControlStore, groupId: string): AgentSelection[] {
  const seen = new Map<string, AgentSelection>();
  for (const row of store.db.prepare("SELECT body FROM work_items WHERE group_id=? ORDER BY id").all(groupId)) {
    const work = JSON.parse(String(row.body)) as { kind: string };
    if (work.kind !== "task") continue;
    const { agent } = frozenWorkAgent(work);
    seen.set(canonicalBytes(agent).toString("utf8"), agent);
  }
  return [...seen.values()];
}

function probeFrozen(router: ExecutionProfileRouter, bindings: { worker: FrozenProfile; handoff: FrozenProfile }, selections: AgentSelection[]): Promise<ObservedProfile[]> {
  return Promise.all(selections.flatMap((selection) => [router.probe(bindings.worker, selection), router.probe(bindings.handoff, selection)]));
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
      const observations = await probeFrozen(profileRouter, bindings, frozenTaskSelections(store, groupTarget(command)));
      degraded = observations.some((observation) => probeBlocksDispatch(observation, snapshot.budgetMode));
    } catch (error) {
      // profile-changed and the remaining precedence codes are decided by the synchronous walk below; so is
      // requirement-not-split (N1 spec §4.1, survey S7), so that a clarifying group's refusal is ledgered.
      if (!(error instanceof ControlError) || (error.code !== "profile-changed" && error.code !== "requirement-not-split")) throw error;
    }
    const outcome = applyWebCommand<CommandResult>(store, {
      rawCommand: command,
      expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      apply: (context) => {
        const groupId = groupTarget(command);
        const group = readGroup(store, groupId);
        if ((group as { status: string }).status === "clarifying") throw new ControlError("requirement-not-split");
        if (group.status !== "ready") throw new ControlError("group-state-invalid");
        // N1 spec §9.3: a requirement's group starts only on top of its exported document.
        if (hasRequirementBlock(group as { requirement?: unknown }) && readRequirementGroup(store, groupId).requirement.export.state !== "done") throw new ControlError("requirement-export-pending");
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
    const at = (deps.now?.() ?? new Date()).getTime();
    // A capped claim is not probed (the agent is asked nothing while the group only waits on a cap). Read-only: the gate
    // in the transaction below decides; with no probe there is no await in between, so it reads what this read did.
    const precapped = claimCapBlocking(store, groupId, claimGrantTokens(store, groupId, wake), at) !== null;
    let blocked = false;
    if (!precapped) try {
      const bindings = resolveBindings(profileRouter, snapshot);
      const observations = await probeFrozen(profileRouter, bindings, frozenTaskSelections(store, groupId));
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
      // Accounts spec §6.3.1, D9: in this transaction, so no other claim lands between the headroom read and this one.
      // A capped claim answers `blocked`: the handler leaves the wake pending, and the next wake re-checks.
      if (!gateClaim(store, groupId, claimGrantTokens(store, groupId, still), at, "start")) return { kind: "blocked" as const, reason: "spend-cap-reached" };
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

/**
 * The tokens this delivery would promise (D4: work + handoff grant): the actionable continuations of a resume wake when
 * there are any (deliverContinuationWake claims them all), otherwise the next claimable task; 0 when nothing is claimed
 * (gateClaim then clears a block nothing waits on any more).
 */
function claimGrantTokens(store: ControlStore, groupId: string, wake: ClaimedWake | { continuations: RegisteredContinuation[] }): number {
  const grantTokens = (workItemId: string): number => {
    const { grant } = readWork(store, groupId, workItemId) as unknown as { grant: { work: { tokens: number }; handoff: { tokens: number } } };
    return grant.work.tokens + grant.handoff.tokens;
  };
  if ("continuations" in wake && wake.continuations.length > 0) {
    const actionable = claimableContinuations(store, groupId, wake.continuations);
    if (actionable.length > 0) return actionable.reduce((sum, registered) => sum + grantTokens(registered.taskId), 0);
    // An exhausted batch whose runs were claimed answers that claim and claims nothing more.
    if (wake.continuations.some((registered) => continuationAlreadyClaimed(store, registered))) return 0;
  }
  const work = nextClaimableTask(store, groupId);
  return work === null ? 0 : grantTokens(work.workItemId);
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

export function nextClaimableTask(store: ControlStore, groupId: string): ClaimableTask | null {
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
  const frozen = frozenWorkAgent(work);
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
    // Agent selection spec §6.4 / §3 I1: a run (and a continuation of it) carries its work item's frozen selection unchanged.
    configHash: frozen.configHash, agent: frozen.agent, agentProvenance: frozen.agentProvenance, timeoutMs: frozen.timeoutMs,
    killGraceMs: frozen.killGraceMs, agentCapabilities: frozen.agentCapabilities,
    grant, ownerToken, executionId: null, state: "starting", checkpointId: null, recoverable: false,
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
  // Issue-fixes spec §5.2: a claim that creates a run.
  recordActivity(store, { groupId, taskId: work.taskId, runId, kind: "run-claimed", body: { claimOrdinal } });
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

export function readWorkClaimEnvelope(store: ControlStore, groupId: string, runId: string): DispatchEnvelopeV1 {
  const row = store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='work-claim'").get(`work:${groupId}:${runId}`);
  if (!row) throw new ControlError("start-intent-missing");
  const { envelopeHash } = JSON.parse(String(row.body)) as { envelopeHash: string };
  return dispatchEnvelopeSchema.parse(JSON.parse(readCanonicalRecord(store, envelopeHash)));
}

/**
 * Single-call estimate spec §6.1: the dispatch envelope claimEstimate froze for this estimate run (webService.ts claimEstimate).
 * DR2: kept by name; an estimate run only, read through the single-call reader (N1 spec §5.1).
 */
export function readEstimateClaimEnvelope(store: ControlStore, groupId: string, runId: string): DispatchEnvelopeV1 {
  if (readDispatchRun(store, runId).phase !== "estimate") throw new ControlError("start-intent-missing");
  return readSingleCallClaimEnvelope(store, groupId, runId);
}

/** N1 spec §5.1: the dispatch envelope the claim froze for this single-call run, whatever its purpose (DR4). */
export function readSingleCallClaimEnvelope(store: ControlStore, groupId: string, runId: string): DispatchEnvelopeV1 {
  const run = readDispatchRun(store, runId);
  if (run.phase !== "estimate" && run.phase !== "single-call") throw new ControlError("start-intent-missing");
  const claimRow = singleCallClaimRowOf(run.phase, groupId, run.workItemId, runId);
  const row = store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind=?").get(claimRow.id, claimRow.kind);
  if (!row) throw new ControlError("start-intent-missing");
  const { runId: claimed, envelopeHash } = JSON.parse(String(row.body)) as { runId: string; envelopeHash: string };
  if (claimed !== runId) throw new ControlError("start-intent-missing");
  return dispatchEnvelopeSchema.parse(JSON.parse(readCanonicalRecord(store, envelopeHash)));
}

/**
 * N1 spec §5.1: a run a single-call claim made, whatever its purpose -- its claim row (singleCallClaimRowOf) names this
 * very run. The purpose is not validated here, only the claim row: a `phase: "single-call"` run is listed exactly when a
 * `single-call:<group>:<item>:<run>` row of kind `single-call-claim` names it (one row per attempt, so every attempt of
 * a round or draft stays a single call -- final review finding 1). A listed run whose purpose is unknown is refused by
 * name in `advance` (DR3).
 */
export function isSingleCallRun(store: ControlStore, runId: string): boolean {
  const row = store.db.prepare("SELECT group_id,work_item_id,body FROM runs WHERE id=?").get(runId);
  if (!row) return false;
  const phase = (JSON.parse(String(row.body)) as { phase?: string }).phase;
  if (phase !== "estimate" && phase !== "single-call") return false;
  const claimRow = singleCallClaimRowOf(phase, String(row.group_id), String(row.work_item_id), runId);
  const claim = store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind=?").get(claimRow.id, claimRow.kind);
  return claim !== undefined && (JSON.parse(String(claim.body)) as { runId?: string }).runId === runId;
}

export type AttemptReservation =
  | { kind: "reserved"; providerAttemptOrdinal: number; envelope: DispatchEnvelopeV1 }
  | { kind: "suppressed"; requestId: string | null };

/**
 * The transaction body of `beginProviderAttempt`, for a caller that must reserve the attempt in the
 * same transaction as its own writes (execution driver step A1). It moves no amount: the read model
 * requires `remaining == max(grant - cumulative, 0)` on every run.
 */
export function reserveProviderAttemptInTransaction(store: ControlStore, runId: string, phase: Phase): AttemptReservation {
  const run = readDispatchRun(store, runId);
  if (phase === "work") {
    const latch = store.db.prepare("SELECT request_id FROM context_latches WHERE run_id=? AND generation=?").get(runId, run.generation);
    if (latch) return { kind: "suppressed", requestId: latch.request_id == null ? null : String(latch.request_id) };
    const held = store.db.prepare("SELECT id FROM handoff_requests WHERE run_id=? AND state IN ('latched','collecting') ORDER BY rowid")
      .get(runId);
    if (held) return { kind: "suppressed", requestId: String(held.id) };
  }
  run.providerAttemptOrdinal += 1;
  // Issue-fixes spec §5.2: the run started when its first provider attempt was reserved; later attempts keep that time.
  if (run.startedAt === undefined) run.startedAt = store.now();
  saveDispatchRun(store, run);
  recordActivity(store, { groupId: run.groupId, taskId: run.taskId, runId, kind: "run-started", body: { providerAttemptOrdinal: run.providerAttemptOrdinal } });
  return { kind: "reserved", providerAttemptOrdinal: run.providerAttemptOrdinal, envelope: phase === "estimate" || phase === "single-call" ? readSingleCallClaimEnvelope(store, run.groupId, runId) : readWorkClaimEnvelope(store, run.groupId, runId) };
}

/**
 * Reserve exactly one provider attempt for one invocation. A run whose context
 * watermark is latched, or whose handoff stop is being collected, can no longer
 * reserve a work-phase attempt at all.
 */
export function beginProviderAttempt(deps: WebDispatchDeps, runId: string, phase: Phase): AttemptReservation {
  const { store, admissionGate } = deps;
  const release = admissionGate?.enter();
  try {
    return store.transaction(() => reserveProviderAttemptInTransaction(store, runId, phase));
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
  // A `blocked` answer (a capability blocker, unknown usage, a spend cap) leaves the wake pending.
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
    // N1 DR14: a requirement's call is claimed here; a held (stopped) group keeps its wake pending.
    "requirement-call": async (wake) => claimRequirementCall({ store, admissionGate: deps.admissionGate }, wake.groupId),
  };
}

/** N1 DR17: a clarify or split run -- a single call stored as phase "single-call" that its claim row names. */
export function isRequirementCallRun(store: ControlStore, runId: string): boolean {
  const row = store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId);
  return row !== undefined && (JSON.parse(String(row.body)) as { phase?: string }).phase === "single-call" && isSingleCallRun(store, runId);
}

/**
 * Execution driver spec §4: a run the Web ledger claimed for work carries the `work:<group>:<run>`
 * claim row. Legacy runs carry a `start:<run>` row instead and are never this.
 */
export function isWebWorkRun(store: ControlStore, runId: string): boolean {
  const row = store.db.prepare("SELECT group_id FROM runs WHERE id=?").get(runId);
  if (!row) return false;
  return store.db.prepare("SELECT id FROM outbox WHERE id=? AND kind='work-claim'").get(`work:${String(row.group_id)}:${runId}`) !== undefined;
}

/**
 * Single-call estimate spec §6.1: a run claimEstimate made for an estimate -- phase `estimate`, and the
 * `estimate:<group>:<estimate>` claim row names this very run (a re-claim after a failure names another).
 */
export function isEstimateRun(store: ControlStore, runId: string): boolean {
  // DR2: kept by name; the single-call check restricted to phase `estimate` (N1 spec §5.1).
  return isSingleCallRun(store, runId) && readDispatchRun(store, runId).phase === "estimate";
}
