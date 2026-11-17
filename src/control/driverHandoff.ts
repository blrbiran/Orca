import {savedDispatchSchema,savedRecoverySchema,savedNoDispatchSchema} from "./savedResultProtocol.js";
import {persistRecoveryArtifact} from "./savedResultRecoveryPackage.js";
import {sha256Canonical} from "./canonicalJson.js";
import {createHash} from "node:crypto";
import { join } from "node:path";
import { archiveRun } from "./archive.js";
import { hasObservedUsage, readRun, saveRun } from "./budget.js";
import { persistCanonicalCheckpoint, verifyCandidateArtifacts } from "./checkpoints.js";
import { hashPayload } from "./commands.js";
import { ControlError } from "./errors.js";
import { peerFailureLogLine } from "./ccloopPort.js";
import {
  ADOPTABLE_STATES, handoffRequestFromOutbox, latestRequestForRun, readHandoffRequest, readStopIntent, saveHandoffRequest,
  settleAbandonedRunInTransaction, settleCompletedRunRequestInTransaction, settleHandoffRequestInTransaction, settleNeverStartedRunInTransaction, type HandoffRequestBody,
} from "./stopIntent.js";
import { abandonOf, abandonSettlementOf } from "./abandonRun.js";
import { readWorkspaceSetting } from "./workspaceSettings.js";
import { isSingleCallRun, isWebWorkRun } from "./webDispatch.js";
import { singleCallPurposeOf } from "./singleCall.js";
import { cleanupExtraWorkspace, cleanupRunWorkspace, revParse, workBranchRef } from "./workspace.js";
import { isMultiGroup, multiPrimaryRepoId } from "./multiGroup.js";
import { findLanding } from "./driverLanding.js";
import { landedAnywhere } from "./driveRecord.js";
import {
  DriverCrash, INSPECT_UNKNOWN_LIMIT, advance, archiveAdmission, blockRun, collectInto, describeError, laterError, driverRunIds, groupRepoId, newDrive, persistStatus, portFor, readDriverRun,
  readStartEnvelope,savedRecoveryInspectionInput, saveDriverRun, savedReport, settleLostWorker, stepC, write, type DriverContext, type DriverRun, type ExecutionDriverDeps,
} from "./executionDriver.js";
import type { ExecutionPort, ExecutionReport, ExecutionStatus, StartEnvelope } from "./executionPort.js";
import type { PartialSelection } from "./agentSelection.js";
import type { ControlStore } from "./store.js";
import type { Candidate } from "./types.js";

/**
 * Handoff delivery spec §3 (with §11, §12, §13): the driver's step H. A run with an open handoff request is
 * closed by the step it is at -- restarted if it provably never started, collected into a checkpoint if it
 * was running, left to finish if it was already landing -- and its request always reaches a settled state or
 * `outcome-unknown`. A run without an open request never comes here: its rounds are byte-for-byte as before.
 */

/** spec §3 (controller decision): how long past a request's deadline nothing at all may arrive before outcome-unknown. */
export const HANDOFF_EXTRA_GRACE_MS = 60_000;

/** ccloop consolidation step 1 (ccloop src/runtime/claude/claudeAgentAdapter.ts, PARTIAL_FLUSH_MARGIN_MS): ccloop waits this past the recovery window before it kills an execute. */
export const PARTIAL_FLUSH_MARGIN_MS = 5_000;
/**
 * ccloop consolidation step 1, final review I1 (controller ruling, Orca session be653b22): an unusable recovery window
 * (an invalid value, or a start envelope that cannot be read) counts as Orca's own default window, the 60_000 every
 * loop plan freezes (loopPlans.ts EXECUTION_POLICY.partialOutcomeRecoveryWindowMs). That makes the fallback grace no
 * shorter than any default run's; it is not a true ceiling, since a plan may freeze a window up to handoff.activeMs.
 */
export const UNUSABLE_RECOVERY_WINDOW_MS = 60_000;
const usableMs = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

const stopDeps = (deps: ExecutionDriverDeps) => ({ store: deps.store, profileRouter: deps.router });
const nowMs = (deps: ExecutionDriverDeps): number => (deps.now ?? (() => new Date()))().getTime();

/** spec §11 I3: the run's newest request, when it is still open -- `outcome-unknown` included. */
export function openRequestOf(store: ControlStore, run: Pick<DriverRun, "groupId" | "runId">): HandoffRequestBody | null {
  const request = latestRequestForRun(store, run.groupId, run.runId);
  return request !== null && ADOPTABLE_STATES.includes(request.state) ? request : null;
}

/**
 * The commit a single call's Ce runs first inside its settlement's transaction (executionDriver.ts stepCSingleCall), shared
 * with a person's usage settlement (spec 2026-10-27 single-call unknown usage §9 R2, singleCallSettlement.ts): a run with
 * an open handoff request yields to the handoff, a run that moved off `accepted` is left alone, otherwise it becomes
 * `settled-restartable`.
 */
export function singleCallCommitTerminal(store: ControlStore, run: { groupId: string; runId: string }): () => void {
  return () => {
    if (openRequestOf(store, run) !== null) throw new ControlError("handoff-request-conflict", "estimate-yields-to-handoff");
    const current = readRun(store, run.runId) as unknown as { state: string };
    // As stepC: the run may have moved while this step awaited ccloop; only an `accepted` run is settled here.
    if (current.state !== "accepted") throw new ControlError("start-state-conflict", "estimate-run-moved");
    current.state = "settled-restartable";
    saveRun(store, current as never);
  };
}

/** spec §13.2 I-2: every Web work run (and estimate run) with an open request, whatever its state (blocked and settled included). */
export function handoffRunIds(store: ControlStore): string[] {
  const ids: string[] = [];
  for (const row of store.db.prepare("SELECT DISTINCT run_id FROM handoff_requests ORDER BY run_id").all()) {
    const runId = String(row.run_id);
    const body = store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId);
    if (!body) continue;
    const run = JSON.parse(String(body.body)) as DriverRun;
    // Single-call estimate spec §6.5: an estimate run's request is the driver's to close too.
    const ours = (run.phase === "work" && isWebWorkRun(store, runId)) || isSingleCallRun(store, runId);
    if (ours && openRequestOf(store, run) !== null) ids.push(runId);
  }
  return ids;
}

/** One round's runs: the driver's own (spec §2.1 of the execution driver) and every run a stop still owns. */
export function visitOrder(store: ControlStore): string[] {
  return [...new Set([...driverRunIds(store), ...handoffRunIds(store)])].sort();
}

/** spec §3 table: the one entry point for a run with an open request. */
export async function stepH(deps: ExecutionDriverDeps, runId: string, context: DriverContext): Promise<boolean> {
  const run = readDriverRun(deps.store, runId);
  const request = openRequestOf(deps.store, run);
  if (request === null) return advance(deps, runId, context);
  switch (run.state) {
    case "settled": return settleCompletedRun(deps, run, request);
    case "starting": return restartRun(deps, runId, request.requestId);
    // spec §11 C4: no executionId is not "never accepted"; a prepared envelope may have reached ccloop.
    case "start-pending": return run.drive?.prepared ? inspectUnderStop(deps, run, request) : restartRun(deps, runId, request.requestId);
    case "unknown": return inspectUnderStop(deps, run, request);
    // Debug task plan Task 8 (fix round 1, R1): a run in its reproduce-first check already ended in ccloop; C applies the check.
    case "accepted": return run.drive?.debugRepro?.state === "checking" ? advance(deps, runId, context) : deliverAndCollect(deps, run, request, context);
    // spec §3: a landing is a short local operation and a reconciliation run cannot be reached by the control
    // protocol, so neither is interrupted; the request settles once the run does (spec §11 C1).
    case "collected": case "landed": case "reconciling": return advance(deps, runId, context);
    case "blocked": return closeBlocked(deps, run, request);
    default: return false;
  }
}

/** spec §11 C1, §13.2 I-1: the run settled through E; its request settles on its own, in a second transaction. */
function settleCompletedRun(deps: ExecutionDriverDeps, run: DriverRun, request: HandoffRequestBody): boolean {
  deps.crash?.("H-between-commit-and-settle");
  write(deps, () => settleCompletedRunRequestInTransaction(deps.store, run.groupId, request.requestId));
  return true;
}

/**
 * spec §11 I9, §13.2 C-6: a run proved never to have started. Its workspace (if A2 made one) is removed first --
 * after the settle the run leaves the driver's scope and nothing would come back for it; a failed removal is
 * recorded on the run, never a reason to keep the task stuck.
 */
export async function restartRun(deps: ExecutionDriverDeps, runId: string, requestId: string): Promise<boolean> {
  const { store } = deps;
  let run = readDriverRun(store, runId);
  if(run.mode==="verify-saved-result"||run.recoveryOf!==undefined){
    const request=readHandoffRequest(store,run.groupId,requestId).request;let input:StartEnvelope;
    try{input=await savedRecoveryInspectionInput(deps,run);}catch{return countUnknownUnderStop(deps,run,request);}
    const observed=await portFor(deps,run).inspect(input);
    if(observed.kind!=="absent")return countUnknownUnderStop(deps,run,request);
    run=readDriverRun(store,runId);
  }
  const cleanupError = await removeNeverStartedWorkspace(deps, run);
  return write(deps, () => {
    const request = readHandoffRequest(store, run.groupId, requestId).request;
    if (!ADOPTABLE_STATES.includes(request.state)) return false;
    const current = readDriverRun(store, runId);
    if (current.drive !== undefined) {
      current.drive = { ...current.drive, cleanedUp: cleanupError === null, cleanupError };
      saveDriverRun(store, current);
    }
    settleHandoffRequestInTransaction(stopDeps(deps), run.groupId, requestId, "settled-restartable", null);
    if(current.mode==="verify-saved-result"||current.recoveryOf!==undefined){
      const settled=readDriverRun(store,runId),marker=savedDispatchSchema.parse(settled.savedDispatch),recovery=savedRecoverySchema.parse(settled.savedRecovery);
      if(marker.state!=="never-submitted"||marker.envelopeHash!==settled.drive?.envelopeHash||settled.executionId!==null||settled.highWater!==0||(settled.unknown as {work:boolean;handoff:boolean}).work||(settled.unknown as {work:boolean;handoff:boolean}).handoff||store.db.prepare("SELECT seq FROM usage_events WHERE run_id=?").get(runId))throw new ControlError("recovery-blocked","saved-result-accept-unknown");
      settled.savedNoDispatch=persistRecoveryArtifact(store,savedNoDispatchSchema.parse({schema:"orca-saved-result-no-dispatch-v1",groupId:settled.groupId,workItemId:settled.workItemId,taskId:settled.taskId,runId,generation:settled.generation,commandId:settled.commandId,ownerTokenHash:createHash("sha256").update(String(settled.ownerToken)).digest("hex"),admission:recovery.admission,fundingHash:sha256Canonical(recovery.funding),revision:recovery.revision,envelopeHash:settled.drive!.envelopeHash,handoffRequestId:requestId,inspection:"absent",controllerState:"never-submitted",observedAt:store.now()}));saveDriverRun(store,settled);
    }
    return true;
  });
}

/**
 * The workspace A2 made for a run that never started, removed; answers the failure to record (null when it went or
 * there was none). Single-call estimate spec §6.5 (review I3): an estimate run has no workspace; nothing in the target
 * repository is touched. Multi-directory projects spec §7.1: a multi group has no single repository, so its primary is
 * resolved from the frozen list, and every extra workspace A2 made (recorded as it was made) goes too.
 */
async function removeNeverStartedWorkspace(deps: ExecutionDriverDeps, run: DriverRun): Promise<string | null> {
  const { store } = deps;
  if (run.drive === undefined || run.drive.workspacePath === null) return null;
  try {
    const repoId = isMultiGroup(store, run.groupId) ? multiPrimaryRepoId(store, run.groupId) : groupRepoId(store, run.groupId);
    await cleanupRunWorkspace(deps.resolveRepository(repoId), deps.roots, run.runId, run.drive.workspacePath);
    for (const dir of run.drive.dirs?.slice(1) ?? []) await cleanupExtraWorkspace(dir.targetRepo, deps.roots, run.runId, dir.key);
    return null;
  }
  catch (error) { return describeError(error); }
}

/**
 * Stuck-runs spec 2026-11-17 S1 (#343, #344): a paused group holds A1 and B (executionDriver.ts groupHeld), so a run
 * there waited at active=1 for ever and kept groupComplete false. Pause now settles a task run that never reached the
 * provider the way restartRun does: its workspace removed, `settled-restartable`, inactive, its task claimable again, so
 * resume claims a new run. A prepared envelope may have reached ccloop (spec §11 C4), so it is inspected first: `absent`
 * is settled; an execution that exists is recorded and runs on (pause lets running work finish); an answer in doubt
 * leaves the run where it is. A saved-result recovery run keeps its own no-dispatch proof chain and is not touched.
 * Answers true when the run moved.
 */
export async function settlePausedUnstarted(deps: ExecutionDriverDeps, runId: string): Promise<boolean> {
  const { store } = deps;
  const run = readDriverRun(store, runId);
  if (run.state !== "starting" && run.state !== "start-pending") return false;
  if (singleCallPurposeOf(run) !== null || run.taskId === null || run.mode !== undefined || run.recoveryOf !== undefined) return false;
  if (readStopIntent(store, run.groupId)?.mode !== "pause" || openRequestOf(store, run) !== null) return false;
  // B moves a run whose execution is already recorded to `accepted` before its hold check; that run is ccloop's.
  if (run.executionId !== null) return false;
  const inspected = await inspectNeverStarted(deps, run);
  if (inspected !== null) return inspected;
  const cleanupError = await removeNeverStartedWorkspace(deps, run);
  return write(deps, () => {
    // Re-read after the awaits: only a run still where it was, with no execution, is settled. A resume in between does not
    // stop it -- its workspace may already be gone -- and the task it gives back is claimed as any ready task is.
    const current = readDriverRun(store, runId);
    if (current.state !== run.state || current.executionId !== null || openRequestOf(store, current) !== null) return false;
    if (current.drive !== undefined) {
      current.drive = { ...current.drive, cleanedUp: cleanupError === null, cleanupError };
      saveDriverRun(store, current);
    }
    settleNeverStartedRunInTransaction(store, run.groupId, runId);
    return true;
  });
}

/**
 * S1's proof that a prepared envelope never reached ccloop (spec §11 C4): null when the run may be settled as never
 * started (not prepared, or ccloop answers `absent`); otherwise what the caller answers -- an execution that exists is
 * recorded (true), an answer in doubt leaves the run where it is (false).
 */
async function inspectNeverStarted(deps: ExecutionDriverDeps, run: DriverRun): Promise<boolean | null> {
  if (run.state !== "start-pending" || run.drive?.prepared !== true) return null;
  let status: ExecutionStatus;
  try { status = await portFor(deps, run).inspect(readStartEnvelope(deps.store, run)); }
  catch (error) { const line = peerFailureLogLine(run.runId, error); if (line !== null) process.stderr.write(line); return false; }
  if (status.kind === "unknown") return false;
  if (status.kind !== "absent") return persistStatus(deps, run.runId, status, "B");
  return null;
}

/**
 * Stuck-runs spec 2026-11-17 S2: a run a person abandoned before it reached the provider (`starting`, `start-pending`) --
 * a live ceiling cannot reach it -- is settled now, proved never started as S1 proves it, paused group or not. It is
 * settled as every abandoned run is (stopIntent.ts settleAbandonedRunInTransaction: `settled-failed`, the task `blocked`),
 * not restartable as S1 settles a paused one: an S1 settle gives the task back as `ready`, and a ready task is claimed
 * again at once, while an abandoned attempt waits for a person. Its drive says `not-started` (no ccloop outcome exists).
 */
export async function settleAbandonedUnstarted(deps: ExecutionDriverDeps, runId: string): Promise<boolean> {
  const { store } = deps;
  const run = readDriverRun(store, runId);
  if (run.state !== "starting" && run.state !== "start-pending") return false;
  if (singleCallPurposeOf(run) !== null || run.taskId === null || run.mode !== undefined || run.recoveryOf !== undefined) return false;
  if (abandonOf(run) === null || openRequestOf(store, run) !== null || run.executionId !== null) return false;
  const inspected = await inspectNeverStarted(deps, run);
  if (inspected !== null) return inspected;
  const cleanupError = await removeNeverStartedWorkspace(deps, run);
  return write(deps, () => {
    const current = readDriverRun(store, runId);
    const request = abandonOf(current);
    if (current.state !== run.state || current.executionId !== null || request === null || openRequestOf(store, current) !== null) return false;
    const settingRepoId = isMultiGroup(store, current.groupId) ? multiPrimaryRepoId(store, current.groupId) : groupRepoId(store, current.groupId);
    const drive = current.drive ?? newDrive(deps.roots, runId, readWorkspaceSetting(store, settingRepoId).workspaceMode, true);
    // Nothing is left for stepCleanupFailed: no report exists to archive, and the workspace went above (or never was).
    current.drive = { ...drive, outcome: "not-started", cleanedUp: true, cleanupError };
    saveDriverRun(store, current);
    settleAbandonedRunInTransaction(store, current.groupId, runId, abandonSettlementOf(request));
    return true;
  });
}

/**
 * Stuck-runs spec S2: an abandoned run ccloop still runs past the handoff grace after the request (its ceiling write) is
 * marked `unresolvedAt`, so recovery list names it `abandon-unresolved` with its run id: Orca does not pretend it stopped.
 * The run stays collected; its terminal still settles it abandoned. Answers true when it marked the run.
 */
export function noteAbandonUnresolved(deps: ExecutionDriverDeps, run: DriverRun): boolean {
  if (run.state !== "accepted") return false;
  const request = abandonOf(run);
  if (request === null || request.unresolvedAt !== undefined) return false;
  const now = nowMs(deps);
  if (now <= request.at + (deps.handoffGraceMs ?? handoffGraceMsOf({ killGraceMs: run.killGraceMs }, frozenRecoveryWindowOf(deps, run), deps.handoffExtraGraceMs))) return false;
  return write(deps, () => {
    const current = readDriverRun(deps.store, run.runId);
    const live = abandonOf(current);
    if (current.state !== "accepted" || live === null || live.unresolvedAt !== undefined) return false;
    (current as { abandon?: unknown }).abandon = { ...live, unresolvedAt: now };
    saveDriverRun(deps.store, current);
    return true;
  });
}

/** spec §3 `unknown` row and §11 C4: ask ccloop whether the execution exists before deciding anything. */
async function inspectUnderStop(deps: ExecutionDriverDeps, run: DriverRun, request: HandoffRequestBody): Promise<boolean> {
  let status: ExecutionStatus;
  try { status = await portFor(deps, run).inspect(readStartEnvelope(deps.store, run)); }
  catch (error) { const line = peerFailureLogLine(run.runId, error); if (line !== null) process.stderr.write(line); status = { kind: "unknown" }; }
  if (status.kind === "absent") return restartRun(deps, run.runId, request.requestId);
  if (status.kind === "unknown") return countUnknownUnderStop(deps, run, request);
  const executionId = status.kind === "accepted" ? status.executionId : status.proof.executionId;
  // The execution exists: record it and deliver the stop next round, as for any accepted run. A stop only
  // needs the execution's identity, so a config mismatch here is not re-judged (it was B's question).
  return write(deps, () => {
    const current = readDriverRun(deps.store, run.runId);
    current.executionId = executionId;
    current.state = "accepted";
    current.drive = { ...current.drive!, inspectUnknown: 0, blockedAt: null, blockedReason: null };
    saveDriverRun(deps.store, current);
    return true;
  });
}

/** spec §3: unknown answers are counted as B' counts them; at the limit the request is outcome-unknown, the run left alone. */
function countUnknownUnderStop(deps: ExecutionDriverDeps, run: DriverRun, request: HandoffRequestBody): boolean {
  return write(deps, () => {
    const current = readDriverRun(deps.store, run.runId);
    const inspectUnknown = (current.drive?.inspectUnknown ?? 0) + 1;
    current.drive = { ...current.drive!, inspectUnknown };
    saveDriverRun(deps.store, current);
    if (inspectUnknown < INSPECT_UNKNOWN_LIMIT || request.state === "outcome-unknown") return false;
    settleHandoffRequestInTransaction(stopDeps(deps), run.groupId, request.requestId, "outcome-unknown", "inspect-unknown");
    return true;
  });
}

/**
 * spec §3 "accepted, no terminal" row: deliver once (request-pending), then collect every round. A terminal
 * means the run finished before the stop took effect and goes on through C; a candidate with a stop proof
 * and no terminal is H-settled; nothing at all past the grace is outcome-unknown -- which keeps collecting
 * and never kills ccloop (spec §11 I3).
 */
async function deliverAndCollect(deps: ExecutionDriverDeps, run: DriverRun, request: HandoffRequestBody, context?: DriverContext): Promise<boolean> {
  const { store } = deps;
  if (request.state === "request-pending") {
    if (deps.admissionGate?.draining) return false;
    let delivered = false;
    try {
      const ack = await portFor(deps, run).requestHandoff(readStartEnvelope(store, run), handoffRequestFromOutbox(store, request.requestId));
      // spec Minor f: a replayed request is answered `complete` once the candidate exists; both mean ccloop holds it.
      delivered = ack.requestId === request.requestId && (ack.kind === "latched" || ack.kind === "complete");
    } catch (error) { const line = peerFailureLogLine(run.runId, error); if (line !== null) process.stderr.write(line); delivered = false; }
    deps.crash?.("H-after-deliver");
    if (!delivered) return await settleIfPastGrace(deps, run, request);
    return write(deps, () => {
      const current = readHandoffRequest(store, run.groupId, request.requestId).request;
      if (current.state !== "request-pending") return false;
      saveHandoffRequest(store, run.groupId, { ...current, state: "collecting" });
      return true;
    });
  }
  let report: Awaited<ReturnType<typeof collectInto>>;
  try { report = await collectInto(deps, run); }
  catch (error) {
    // Tester #289 path B (follow-up J): a blocked run's collect that keeps failing (a peer whose workspace is gone) went
    // to recordStepFailure every round, so the grace below was never checked and the request never ended. Under a stop a
    // blocked run's collect failure is caught as the delivery's is: named once per message, then the grace decides.
    // An accepted run's failure still blocks it at C first (recordStepFailure), as before.
    if (run.state !== "blocked" || error instanceof DriverCrash || (error instanceof ControlError && error.code === "panel-draining")) throw error;
    const message = describeError(error);
    // The later error is still recorded after the original reason, as recordStepFailure did (FR-C2), written only when
    // it changes the reason, so a failure that repeats every round writes it once.
    const reason = laterError(run.drive?.blockedReason ?? null, message);
    if (run.drive?.blockedAt != null && reason !== run.drive.blockedReason) blockRun(deps, run.runId, run.drive.blockedAt, reason);
    if (lastCollectFailure.get(run.runId) !== message) {
      lastCollectFailure.set(run.runId, message);
      process.stderr.write(`orca-driver: ${run.runId}: handoff collect under stop: ${message}\n`);
    }
    return await settleIfPastGrace(deps, run, request);
  }
  lastCollectFailure.delete(run.runId);
  // Single-call estimate spec §6.5: an estimate run's stop always settles restartable -- its estimate is interrupted and
  // its unused commitment returned (terminaliseRun) -- even when the call had already finished; the output stays as
  // evidence and a person can re-estimate. Never a checkpoint: there is no work to continue.
  if (singleCallPurposeOf(run) !== null && report.candidate?.stopProof) return settleSingleCallUnderStop(deps, run, request);
  if (report.terminal !== null && report.candidate?.stopProof && run.state === "accepted") return stepC(deps, run.runId, context);
  if (report.candidate?.stopProof) {
    deps.crash?.("H-after-candidate");
    return settleHandoffCheckpoint(deps, run.runId, request.requestId, report);
  }
  // Worker-lost recovery spec, as-built Orca half item 9: a stop whose run lost its worker cannot be answered by that worker.
  // ccloop settles the run as worker-lost (a failed terminal with a stop proof); the next round takes it through C, and
  // the blocked run's request closes from that terminal (closeBlocked). An undetermined worker stays on the grace below.
  if (report.terminal === null && report.candidate === null && report.worker?.state === "lost" && run.mode === undefined && run.recoveryOf === undefined
    && await settleLostWorker(deps, run, report.worker.reason, true)) return true;
  return (await settleIfPastGrace(deps, run, request)) || report.events.length > 0;
}

/** The last collect failure named for each blocked run under a stop, so a failure that repeats every round is named once. */
const lastCollectFailure = new Map<string, string>();

/** N1 spec §5.1: the stop proof of a single call closes its request restartable, nothing else. */
function settleSingleCallUnderStop(deps: ExecutionDriverDeps, run: DriverRun, request: HandoffRequestBody): boolean {
  return write(deps, () => {
    const current = readHandoffRequest(deps.store, run.groupId, request.requestId).request;
    if (!ADOPTABLE_STATES.includes(current.state)) return false;
    settleHandoffRequestInTransaction(stopDeps(deps), run.groupId, request.requestId, "settled-restartable", null);
    return true;
  });
}

/**
 * spec §3 (controller decision): a delivered request that yields nothing turns outcome-unknown only past its deadline
 * plus the agent's own killGraceMs plus HANDOFF_EXTRA_GRACE_MS. ccloop waits killGraceMs before it kills a phase, so
 * a shorter grace would call a stop unknown while ccloop is still finishing it. Agent selection spec §6.6 (§12 I5):
 * the killGraceMs is the run's frozen one -- ccloop's capabilities-v3 answer at confirmation -- and Orca never reads
 * the installation table; a value that is not a non-negative safe integer counts 0, never shorter than the fixed part.
 *
 * *** ERRATUM (2026-09-29, run orca-dev-1d7d9aa0, Orca backlog #13(b), human authorization in session 2f65a729) ***
 * "counts 0" above is no longer true: an unusable value now counts 60_000, the ceiling the frozen slot allows
 * (webProtocol.ts frozenSlotSchema, killGraceMs max 60_000). Falling back to the floor was not fail closed -- too
 * short a grace calls a stop unknown while ccloop may still be finishing it; too long a grace only delays that call.
 *
 * *** ERRATUM (ccloop consolidation step 1, 2026-10-01, Orca session be653b22, ruling R5) ***
 * "ccloop waits killGraceMs before it kills a phase" above is no longer true for execute: ccloop now waits
 * max(killGraceMs, partialOutcomeRecoveryWindowMs + PARTIAL_FLUSH_MARGIN_MS) before it kills one. The grace is that
 * bound plus HANDOFF_EXTRA_GRACE_MS, the window read from the run's frozen contract (recoveryWindowOf; 0 before a
 * start envelope exists). An unusable window counts as UNUSABLE_RECOVERY_WINDOW_MS (60_000, Orca's default window), so
 * that grace is max(killGraceMs, 65_000) + 60_000: no shorter than any default run's grace, though not a true ceiling
 * (ccloop docs/superpowers/specs/2026-10-01-claude-adapter-consolidation-step1-design.md §6, §11, §13).
 */
export function handoffGraceMsOf(run: { killGraceMs?: unknown }, recoveryWindowMs: unknown, extraGraceMs: number = HANDOFF_EXTRA_GRACE_MS): number {
  const windowMs = usableMs(recoveryWindowMs) ? recoveryWindowMs : UNUSABLE_RECOVERY_WINDOW_MS;
  const killGraceMs = usableMs(run.killGraceMs) ? run.killGraceMs : 60_000;
  return Math.max(killGraceMs, windowMs + PARTIAL_FLUSH_MARGIN_MS) + extraGraceMs;
}

/** The frozen contract's partialOutcomeRecoveryWindowMs; 0 for a single call (it has no execute to stop). */
export function recoveryWindowOf(envelope: StartEnvelope): unknown {
  if (envelope.work.kind !== "loop") return 0;
  const contract = envelope.work.contract as { executionPolicy?: { partialOutcomeRecoveryWindowMs?: unknown } } | null;
  return contract?.executionPolicy?.partialOutcomeRecoveryWindowMs;
}

/**
 * ccloop consolidation step 1 (spec §6, §11): the run's frozen recovery window. No start envelope yet means ccloop never
 * started, so there is no window to wait (0). An envelope that cannot be read is a corrupt state: its window is
 * unusable (undefined), so it counts as UNUSABLE_RECOVERY_WINDOW_MS, never a throw that would keep the request from
 * outcome-unknown.
 */
function frozenRecoveryWindowOf(deps: ExecutionDriverDeps, run: DriverRun): unknown {
  if (run.drive?.envelopeHash == null) return 0;
  try { return recoveryWindowOf(readStartEnvelope(deps.store, run)); } catch { return undefined; }
}

/** spec §3 grace (controller decision): past deadline + killGraceMs + 60 s with nothing collected. *** ERRATUM (ccloop consolidation step 1, 2026-10-01, Orca session be653b22, ruling R5) *** the bound is handoffGraceMsOf with the frozen recovery window. */
async function settleIfPastGrace(deps: ExecutionDriverDeps, run: DriverRun, request: HandoffRequestBody): Promise<boolean> {
  if (request.state === "outcome-unknown") return false;
  if (nowMs(deps) <= Date.parse(request.deadlineAt) + (deps.handoffGraceMs ?? handoffGraceMsOf({ killGraceMs: run.killGraceMs }, frozenRecoveryWindowOf(deps, run), deps.handoffExtraGraceMs))) return false;
  return write(deps, () => {
    const current = readHandoffRequest(deps.store, run.groupId, request.requestId).request;
    if (current.state === "outcome-unknown" || !ADOPTABLE_STATES.includes(current.state)) return false;
    settleHandoffRequestInTransaction(stopDeps(deps), run.groupId, request.requestId, "outcome-unknown", "handoff-grace-elapsed");
    return true;
  });
}

/**
 * spec §13.2 I-3: a blocked run is split by whether ccloop may still be running. Done executing (an outcome, or
 * blocked at D/R/E) ⇒ closed from the result it already collected (§13.1 C-5); provably never started ⇒
 * restartable; otherwise delivered to or inspected like a live run. A run that already landed is not a
 * checkpoint to continue -- its request waits for a person's recovery-retry to settle it through E and C1.
 */
async function closeBlocked(deps: ExecutionDriverDeps, run: DriverRun, request: HandoffRequestBody): Promise<boolean> {
  const drive = run.drive!;
  const at = drive.blockedAt;
  if (landedAnywhere(drive)) return false;
  // Controller ruling T4-I1, 2026-09-25: D and R land through `landOnTip`, whose worktree removal runs after the
  // swap; if it throws, the change is on orca/<g> but the run is blocked with no `landedCommit`. Ask the branch.
  if ((at === "D" || at === "R") && await landedUnrecorded(deps, run)) return false;
  if (drive.outcome !== null || at === "D" || at === "R" || at === "E") {
    return settleHandoffCheckpoint(deps, run.runId, request.requestId, await savedReport(deps.store, run.runId));
  }
  if (at === "A1" || at === "A2" || (at === "B" && (drive.blockedReason ?? "").startsWith("accept-refused"))) return restartRun(deps, run.runId, request.requestId);
  if (run.executionId === null) return inspectUnderStop(deps, run, request);
  return deliverAndCollect(deps, run, request);
}

/**
 * Controller ruling T4-I1, 2026-09-25: D-LANDED for a landing the run never recorded -- the same probe stepD
 * makes (`findLanding` from the run's base to the current tip). A probe that cannot answer (no repository, a
 * landing git cannot name) cannot prove the change is absent, so the run is left to a person as landed.
 */
export async function landedUnrecorded(deps: ExecutionDriverDeps, run: DriverRun): Promise<boolean> {
  const drive = run.drive!;
  if (drive.attemptSha === null || drive.base === null) return false;
  try {
    // Multi-dir spec §8.1: a multi run lands one merge per written directory, each found the way its own step 1 replay
    // finds it (`groupRepoId` throws for a multi group, which used to answer "landed" for every multi run).
    if (drive.dirs !== undefined && drive.dirs.length > 0) {
      for (const dir of drive.dirs) {
        if (dir.attemptSha == null) continue;
        const tip = await revParse(dir.targetRepo, workBranchRef(run.groupId));
        if (await findLanding(dir.targetRepo, dir.base, tip, dir.attemptSha) !== null) return true;
      }
      return false;
    }
    const targetRepo = deps.resolveRepository(groupRepoId(deps.store, run.groupId));
    const tip = await revParse(targetRepo, workBranchRef(run.groupId));
    return await findLanding(targetRepo, drive.base, tip, drive.attemptSha) !== null;
  } catch { return true; }
}

/**
 * H-settle (spec §11 C2 as corrected by §13.2 C-1, I-1): an external segment -- the snapshot archive and the
 * canonical checkpoint file, both idempotent -- then ONE transaction: the checkpoint row, `checkpointId` and
 * `recoverable`, the recoverable (or unrecoverable) accounting of `terminaliseRun`, the request's settlement
 * and the group's stop state. Never `commitCandidate`, whose `releaseRunReserve` would give the held
 * commitment back.
 */
export async function settleHandoffCheckpoint(deps: ExecutionDriverDeps, runId: string, requestId: string, report: ExecutionReport): Promise<boolean> {
  const { store } = deps;
  const run = readDriverRun(store, runId);
  const raw = report.candidate;
  if (run.drive === undefined || raw === null || raw.stopProof === null) throw new ControlError("recovery-blocked", `handoff-candidate-missing:${runId}`);
  const archive = await archiveRun(store, { runId, sourceDir: run.drive.sourceDir, repoDir: join(run.drive.sourceDir, "repo"), stopProof: raw.stopProof }, archiveAdmission(deps));
  const record = readRun(store, runId);
  const candidate: Candidate = {
    groupId: record.groupId, workItemId: record.workItemId, taskId: record.taskId, runId, generation: record.generation,
    graphVersion: record.graphVersion, targetVersion: record.targetVersion, checkpointId: `settle-${runId}`, usageHighWater: raw.usageHighWater,
    // spec §11 C3: a request and no landing is an Orca `partial` checkpoint whatever ccloop's own `result` says;
    // ccloop's word on how clean the handoff was stays in the handoff packet it points at.
    result: "partial",
    artifacts: [...archive.artifacts, ...raw.artifacts, raw.handoff], snapshot: archive.snapshot, missing: [...archive.missing, ...raw.missing],
    // spec Minor e: there is no terminal at this instant; ccloop's own (non-terminal) status is what is recorded.
    unresolvedRequestIds: raw.unresolvedRequestIds, stopProof: raw.stopProof, terminalOutcome: raw.terminalOutcome, handoff: raw.handoff,
  };
  candidate.checkpointId = `settle-${runId}-${hashPayload(candidate).slice(0, 16)}`;
  await verifyCandidateArtifacts(store, candidate);
  const persisted = await persistCanonicalCheckpoint(store, candidate);
  return write(deps, () => {
    const request = readHandoffRequest(store, run.groupId, requestId).request;
    if (!ADOPTABLE_STATES.includes(request.state)) return false;
    const previous = store.db.prepare("SELECT hash FROM checkpoints WHERE id=?").get(persisted.checkpointId);
    if (previous !== undefined && String(previous.hash) !== persisted.hash) throw new ControlError("checkpoint-id-conflict");
    if (previous === undefined) store.db.prepare("INSERT INTO checkpoints VALUES (?,?,?,?)").run(persisted.checkpointId, runId, persisted.hash, persisted.body);
    const current = readRun(store, runId);
    if (candidate.usageHighWater !== current.highWater) throw new ControlError("checkpoint-usage-high-water");
    const pending = store.db.prepare("SELECT seq FROM usage_events WHERE run_id=? AND seq>?").get(runId, current.highWater);
    // Web spec §6.2's hard conditions, each named when it fails so the panel shows why.
    const reasons = [
      ...(candidate.unresolvedRequestIds.length > 0 ? ["unresolved-requests"] : []),
      ...(pending !== undefined || current.unknown.work || current.unknown.handoff || !hasObservedUsage(store, current) ? ["usage-unsettled"] : []),
      ...(candidate.missing.length > 0 ? [`missing:${candidate.missing.join(",")}`] : []),
      ...(candidate.snapshot === null ? ["snapshot-missing"] : []),
    ];
    current.checkpointId = persisted.checkpointId;
    current.recoverable = reasons.length === 0;
    saveRun(store, current);
    settleHandoffRequestInTransaction(stopDeps(deps), run.groupId, requestId,
      reasons.length === 0 ? "settled-recoverable" : "settled-unrecoverable", reasons.length === 0 ? null : reasons.join(";"));
    return true;
  });
}
