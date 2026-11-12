import {hasValidUsageSettlement,settlementArtifact as settlementArtifactBytes,singleCallUsageLowerBoundSchema} from "./usageSettlement.js";
import { stackBaseOf } from "./groupEdges.js";
import { flowChildSkills, isFlowChildGroup } from "../flow/groups.js";
import { groupRepoId, isDirGroup } from "./dirGroup.js";
import type { MultiDirProjectOf } from "./multiGroup.js";
import { dirTargetRepoId, isMultiGroup, multiDirOf, multiPrimaryRepoId, type FrozenMultiDir } from "./multiGroup.js";
import { withSkillDirs } from "../flow/template/vars.js";
import {assertCurrentSavedRecovery,savedRecoveryAccounting} from "./savedResultRecovery.js";
import {materializeRecoveryPackage,publishRecoveryFence,persistRecoveryArtifact,recoveryClosure} from "./savedResultRecoveryPackage.js";
import {savedDispatchSchema,savedRecoverySchema,savedResultAdmissionSchema,recoveryOfSchema,executionFormatFailureSchema,exhaustedCompletionSchema,ompWithoutFinalCompletionSchema,savedExecutionSnapshotSchema,savedResultCollectionSchema,savedResultSettlementSchema,interruptedSavedResultSchema} from "./savedResultProtocol.js";
import { readWork as allowanceWork, saveWork as saveAllowanceWork, readGroup as allowanceGroup, saveGroup as saveAllowanceGroup } from "./queries.js";
import { hasOptionalTaskPolicy, validateAllowanceCheckpoint } from "./fundedAllowance.js";
import { topUpSum } from "./workTopUp.js";
import { verifySnapshot } from "./snapshot.js";
import { minTokenCeiling } from "./tokenPolicy.js";
import { createTaskResultCollector,type TaskResultCollector } from './taskResultCollector.js';
import { createHash } from "node:crypto";
import { mkdir, realpath, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { join } from "node:path";
import { archiveRun, readArtifact, writeArtifact } from "./archive.js";
import { readRun, saveRun } from "./budget.js";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { commitCandidate } from "./checkpoints.js";
import { hashPayload } from "./commands.js";
import { peerExitText, peerFailure, peerFailureLogLine } from "./ccloopPort.js";
import { ControlError } from "./errors.js";
import { readConfirmedTaskExecution } from "./executionSnapshot.js";
import { allDirsUnchanged, noChangeExplanationOf, noChangeRouteOf, recordNoChangeCompletionInTransaction } from "./noChange.js";
import { routeNoChangeJudgeInTransaction } from "./noChangeJudge.js";
import { privateDirectory } from "./paths.js";
import { publishPending } from "./projection.js";
import { readBudgetProposal, readGroup, readWork } from "./queries.js";
import { readCanonicalRecord, writeCanonicalRecord } from "./snapshot.js";
import { toSingleCallEnvelope, toStartEnvelope } from "./startEnvelope.js";
import { priorFailuresAtPrepare } from "./priorFailures.js";
import { exportResumeBundle, readExistingResumeBundle, type InputCheckpointV1 } from "./resumeBundle.js";
import { recordActivity } from "./activity.js";
import {artifactSchema,operatorNoteSchema,type OperatorNote,type RunProgress} from "./schema.js";
import { recordUsage } from "./usage.js";
import { exportPendingRequirements } from "./requirementExport.js";
import { runTask } from "../scheduler/ccloopRunner.js";
import { placeDirGroups, type DirPlacementCrashPoint } from "./dirPlacement.js";
import { admissionOf, readOrchestrationSettings, runningGroupIds } from "./orchestration.js";
import { groupExecutionPendingInStore } from "./executionPending.js";
import { integratePendingGroups, type IntegrationCrashPoint, type IntegrationDeps } from "./integrationPass.js";
import { landMultiDirGroups, type MultiLandingCrashPoint, type MultiPrecheck } from "./multiLanding.js";
import { DISPATCHED_PERSON_DIRNAME } from "./commandClient.js";
import { isSingleCallRun, isWebWorkRun, nextClaimableTask, readSingleCallClaimEnvelope, readWorkClaimEnvelope, reserveProviderAttemptInTransaction } from "./webDispatch.js";
import { singleCallPurposeOf } from "./singleCall.js";
import { approximateUsageApplies, bookApproximateFloorInTransaction } from "./approximateUsage.js";
import { noteTranscriptListing } from "../agentTranscript/listing.js";
import { singleCallHandler } from "./singleCallPurposes.js";
import { readWorkspaceSetting, type WorkspaceMode } from "./workspaceSettings.js";
import { cleanupExtraWorkspace, cleanupRunWorkspace, commitAttempt, ensureWorkBranch, ensureWorkspace, extraWorkspacePathOf, makeReadOnly, removeSkillsSnapshot, revParse, skillsPathOf, sourceDirOf, workBranchRef, workspacePathOf, QUIET_GIT, type WorkspaceRoots } from "./workspace.js";
import { git } from "../scheduler/gitExec.js";
import { injectSkills, SyncskillError, type SyncskillOptions } from "../skills/syncskill.js";
import { abortPostMergeChecks, recordEmptyResultDecisions, stepD, stepR, type PostMergeCheck } from "./driverLanding.js";
import { acceptPending, stepAcceptAttempt, type AcceptCheck } from "./acceptAttemptDriver.js";
import type { GroupAcceptanceCheck } from "./groupAcceptance.js";
import { readDebugMark } from "./debugChecks.js";
import type { DebugInputV1 } from "./debugInput.js";
import { correctionTargetOf } from "../corrections/target.js";
import { classifyCriteriaChange, runChecksAtBase, type CriteriaBaseVerdict } from "./criteriaProtection.js";
import { checkReproduction, restoreWorkspace, snapshotWorkspace, type ReproVerdict, type WorkspaceSnapshot } from "./debugRepro.js";
import { reportedDebugOf } from "./reportedDecisions.js";
import { openRequestOf, singleCallCommitTerminal, stepH, visitOrder } from "./driverHandoff.js";
import { harvest, type Reconciliation } from "../scheduler/harvest.js";
import { normalizeClaim, writeSetOf, type ClaimedPath } from "../scheduler/writeSet.js";
import { taskWrites } from "./requirementRecords.js";
import type { AdmissionGate } from "./admissionGate.js";
import { bookRejectedZeroInTransaction } from "./quotaProbeCall.js";
import { FAILURE_DETAIL_MAX, landedAnywhere, type DriveRecord, type DriveStep } from "./driveRecord.js";
import { catalogMissReason, selectorMissOf } from "./estimatorCompatibility.js";
import type { ExecutionPort, ExecutionStatus, StartEnvelope } from "./executionPort.js";
import type { ExecutionReport } from "./executionPort.js";
import type { ExecutionProfileRouter } from "./profiles.js";
import type { ControlStore } from "./store.js";
import type { Candidate } from "./types.js";
import type { AgentSelection } from "./agentSelection.js";

/**
 * Execution driver spec §2. Owned by the panel's control assembly next to the wake pump, and only
 * when an execution port is configured. It is the only place a provider is invoked for a Web run:
 * recovery and the pump never do (spec §2.1).
 */

export type CrashPoint = "A2-after-workspace" | "B-after-accept" | "C-after-terminal" | "D-after-cas" | "E-after-acceptance"
  // Control run decisions plan Task 7: after an empty result's ledger-only commit swapped, before it is recorded.
  | "E-after-ledger-cas"
  // Reviewed acceptance (spec 2026-11-11 §7): an accepted attempt's landing swapped, before it is recorded.
  | "accept-after-cas"
  // Handoff delivery spec §9.2 R-H, §11 I5, §13.2 I-1.
  | "H-after-deliver" | "H-after-candidate" | "H-between-commit-and-settle" | "A2-after-bundle"
  // Integration spec §6.1: the integration pass's outward actions (integrationPass.ts).
  | IntegrationCrashPoint
  // Dir-requirements spec §8.5 (D7): the placement pass's journal, folder writes and swap (dirPlacement.ts).
  | DirPlacementCrashPoint
  // Multi-directory projects spec §9.6: the multi landing's journal, publish and record (multiLanding.ts).
  | MultiLandingCrashPoint;

/** Test-only fault injection (spec §7.2 R1): thrown from `crash`, it ends the driver as a process death would. */
export class DriverCrash extends Error {
  constructor(readonly point: CrashPoint) { super(`driver-crash:${point}`); this.name = "DriverCrash"; }
}

/** spec §2.2 B': consecutive unknown inspections before the run is blocked. A controller choice (spec §9). */
export const INSPECT_UNKNOWN_LIMIT = 10;

export interface ExecutionDriverDeps {
  taskResults?:TaskResultCollector;
  store: ControlStore;
  router: ExecutionProfileRouter;
  admissionGate?: AdmissionGate;
  roots: WorkspaceRoots;
  /** spec §3.1: the trusted path for a repoId, its witness re-validated on every call. */
  resolveRepository(repoId: string): string;
  /** spec §5.3(6): the binary and agents table a reconciliation `ccloop run` is spawned with (agent selection spec §4.9). */
  ccloopBin: string;
  agentsTablePath: string;
  /** CLI v2 spec §15.3: the ORCA_PERSON_DIR of a reconciliation or resolution `ccloop run` (runTask's option), and of the debug and criteria checks (review I1). */
  dispatchedPersonDir?: string;
  /** N1 spec §6: the ast-grep binary the overview's structure part runs; null = unavailable. */
  astGrepBin?: string | null;
  kickPump?: () => void;
  crash?: (point: CrashPoint) => void;
  /** Test seam (spec §5.1): runs between a landing's merge and its compare-and-swap. */
  beforeCas?: () => Promise<void>;
  /** Handoff delivery spec §3: the clock a request's grace is judged by (tests move it). */
  now?: () => Date;
  /** Issue #192 test seam: the settle wall time at or above which stepE writes its timing line (default 5 s). */
  settleSlowMs?: number;
  /** Tester follow-up G §6.1 (#192) test seam: awaited on the settle lane right before a landed run's step E. */
  beforeSettle?: (runId: string) => Promise<void>;
  /**
   * Test seam only: overrides handoffGraceMsOf(run) (agent selection spec §6.6: the run's frozen killGraceMs + 60 s).
   * *** ERRATUM (ccloop consolidation step 1, 2026-10-01, Orca session be653b22, ruling R5) *** it overrides handoffGraceMsOf(run, window): max(killGraceMs, frozen recovery window + 5 s) + 60 s.
   */
  handoffGraceMs?: number;
  /** Syncskill integration spec §10.6: the syncskill A2 injects a run's skills with (ORCA_SYNCSKILL_BIN); absent = unconfigured. */
  syncskill?: SyncskillOptions;
  /** Test seam only (debug task plan Task 8): replaces checkReproduction, so a criterion can see it is never called. */
  checkReproduction?: typeof checkReproduction;
  /** Dir-requirements spec §6.1 (Rule 17): the panel's environment, where a dir group's vault is found ($ORCA_VAULT_DIR). */
  env?: NodeJS.ProcessEnv;
  /**
   * Multi-directory projects spec §6.3: the registry's members of a multi-dir project by control repo id, for the
   * composed overview's member names. A2 passes it through to the purpose's prepare deps.
   */
  multiDirProjectOf?: MultiDirProjectOf;
}

export interface DriverRun {
  runId: string; groupId: string; workItemId: string; taskId: string | null;
  generation: number; graphVersion: number; targetVersion: number;
  state: string; phase: string; configHash: string; agent: AgentSelection; executionId: string | null;
  highWater: number; providerAttemptOrdinal: number; continuationIntentId?: string | null;
  /** Tester round 3 spec §3: a loop run's observed usage floor, from collect. Shown, never booked. */
  usageLowerBound?: { tokens: number };
  executionProfile: { profileId: string; profileHash: string };
  drive?: DriveRecord;
  [key: string]: unknown;
}

/** Per-driver process state: reconciliation runs in flight (spec §5.3(6)), and whether the driver was stopped. */
export interface DriverContext {
  reconciling: Map<string, Promise<void>>; stopped: boolean;
  /** Debug task plan Task 8 (fix round 1, R1): reproduce-first checks in flight, by run; absent, a process-wide map is used. */
  debugChecks?: Map<string, DebugCheck>;
  /** Multi-directory projects spec §9.4: opt-in checks in flight, by group; a restart re-pre-checks (nothing was written). */
  multiPrechecks?: Map<string, MultiPrecheck>;
  /** Ruling R2 (#241): post-merge checks in flight, by run; a restart merges and checks again (nothing was written). */
  postMergeChecks?: Map<string, PostMergeCheck>;
  /** Reviewed acceptance (spec 2026-11-11 §7): an accepted attempt's checks in flight, by run; a restart merges and checks again. */
  acceptChecks?: Map<string, AcceptCheck>;
  /** Tester follow-up E §5 (#241): group acceptance checks in flight, by group; a restart checks a tip with no record again. */
  acceptanceChecks?: Map<string, GroupAcceptanceCheck>;
  /**
   * Tester #229/#230 (plan 2026-11-10 follow-up B, T1): transient step-E failures already retried, by run. In memory: a
   * restart grants at most TRANSIENT_E_RETRIES more, which is still bounded, and needs no drive-record field.
   */
  transientRetries?: Map<string, number>;
  /**
   * Tester follow-up G §6.1 (#192): runs whose step E is in flight on the settle lane, by run (a pass skips them), and the
   * lane itself -- one chain, so two settles never overlap. A death mid-settle leaves the run landed or settled-but-not-
   * cleaned, which the next driver visits again (D15).
   */
  settles?: Map<string, Promise<boolean>>;
  settleLane?: Promise<unknown>;
}

/** One reproduce-first check running off the driver round: aborted by stop(), its outcome read by a later round. */
export interface DebugCheck { controller: AbortController; settled: { verdict: ReproVerdict | CriteriaBaseVerdict } | { error: unknown } | null }
/** For a step called outside a driver (a criterion calling stepC itself); a driver owns its own map. */
const unownedDebugChecks = new Map<string, DebugCheck>();

export interface ExecutionDriver {
  /** One pass over every run the driver owns; a re-entrant call joins the pass in flight. Answers whether any run moved. */
  round(): Promise<boolean>;
  /** A round now, and another straight after for as long as runs keep moving. */
  kick(): void;
  start(intervalMs: number): boolean;
  /** Stops the timer and waits for the round in flight (spec §2.1 shutdown order). */
  stop(): Promise<void>;
  readonly crashed: CrashPoint | null;
  /** Final-review fix wave (I1): collects the run's task results again (TaskResultCollector.schedule; a job in flight stands). */
  scheduleTaskResults(runId: string): void;
}

export function describeError(error: unknown): string {
  // Spec 2026-10-15 ccloop error codes §4.4: a peer exit is stored cut -- `control-peer-exit:<exit>:<code>: <detail≤512>`.
  const peer = peerFailure(error);
  if (peer !== null) { const text = peerExitText(peer); return text === "" ? "control-peer-exit" : `control-peer-exit:${text}`; }
  if (error instanceof ControlError) return error.detail ? `${error.code}:${error.detail}` : error.code;
  return error instanceof Error && error.message.length > 0 ? error.message : String(error);
}

/** Tester #229/#230 (plan 2026-11-10 follow-up B, T1): how many times a transient step-E failure is retried before it blocks. */
export const TRANSIENT_E_RETRIES = 3;
const TRANSIENT_ERRNO = new Set(["EBUSY", "EAGAIN", "ENOENT"]);

/**
 * Tester #229/#230: an error at step E worth another try -- an artifact-id-conflict (a check that saw the archive change
 * under it) or an I/O race. Step E is idempotent (content-addressed archive, checkpoint id from the candidate), so running
 * it again is safe; anything else blocks at once, as before.
 */
export function transientSettleError(error: unknown): boolean {
  if (error instanceof ControlError) return error.code === "artifact-id-conflict";
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && TRANSIENT_ERRNO.has(code);
}

/** Tester #267: how many times a transient failure at B, B' or C is retried in place before it blocks (as E, above). */
export const TRANSIENT_START_RETRIES = 3;
const TRANSIENT_PEER_ERRNO = new Set(["ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT"]);

/**
 * Tester #267: an error at B, B' or C worth another try -- step E's (an artifact-id-conflict, an I/O race), a ccloop call
 * that timed out (a machine that slept through it), or a dropped connection. Those steps only ask ccloop again (recovery
 * retry --run would put the run back at the same step), so asking again in place is safe; anything else blocks at once.
 */
export function transientDriveError(error: unknown): boolean {
  if (transientSettleError(error)) return true;
  if (error instanceof ControlError) return error.code === "control-peer-timeout";
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && TRANSIENT_PEER_ERRNO.has(code);
}

/**
 * Final review m2 (2026-10-15): the driver's stderr lines keep a peer exit whole. §4.4 cuts only what is stored; with
 * the stored reason cut, these lines are the one place ccloop's full stderr (a stack trace) is still kept.
 */
function logError(error: unknown): string {
  if (error instanceof ControlError && error.code === "control-peer-exit") return error.detail ? `${error.code}:${error.detail}` : error.code;
  return describeError(error);
}

export function readDriverRun(store: ControlStore, runId: string): DriverRun {
  const row = store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId);
  if (!row) throw new ControlError("run-not-found");
  return JSON.parse(String(row.body)) as DriverRun;
}

export function saveDriverRun(store: ControlStore, run: DriverRun): void {
  saveRun(store, run as never);
}

export function admitted<T>(deps: Pick<ExecutionDriverDeps, "admissionGate">, action: () => T): T {
  const release = deps.admissionGate?.enter();
  try { return action(); } finally { release?.(); }
}

export async function admittedAsync<T>(deps: Pick<ExecutionDriverDeps, "admissionGate">, action: () => Promise<T>): Promise<T> {
  const release = deps.admissionGate?.enter();
  try { return await action(); } finally { release?.(); }
}

export const archiveAdmission = (deps: Pick<ExecutionDriverDeps, "admissionGate">) =>
  ({ admit: <T>(operation: () => Promise<T>): Promise<T> => admittedAsync(deps, operation) });

/** Every synchronous write the driver makes: admitted, then one transaction (spec §2.1). */
export function write<T>(deps: Pick<ExecutionDriverDeps, "store" | "admissionGate">, action: () => T): T {
  return admitted(deps, () => deps.store.transaction(action));
}

/** spec §2.2: a run that cannot move on its own is blocked alone, with the step and the reason. */
/** `runFields`: keys set on the run itself beside the block (a single call's lower bound, spec 2026-10-27 §9 R4). */
export function blockRun(deps: Pick<ExecutionDriverDeps, "store" | "admissionGate">, runId: string, step: DriveStep, reason: string, patch: Partial<DriveRecord> = {}, runFields: Record<string, unknown> = {}): void {
  write(deps, () => {
    const run = readDriverRun(deps.store, runId);
    if (run.drive === undefined) throw new ControlError("recovery-blocked", `drive-missing:${runId}`);
    Object.assign(run, runFields);
    run.state = "blocked";
    run.drive = { ...run.drive, ...patch, blockedAt: step, blockedReason: reason };
    saveDriverRun(deps.store, run);
  });
}

/** Integration spec §5: what the integration pass needs, from the driver's own deps and state. */
export function integrationDepsOf(deps: ExecutionDriverDeps, context: DriverContext): IntegrationDeps {
  return {
    store: deps.store, roots: deps.roots, admissionGate: deps.admissionGate, repoPathOf: (repoId) => deps.resolveRepository(repoId),
    now: () => (deps.now?.() ?? new Date()).getTime(), ghBin: process.env.ORCA_GH_BIN || "gh", stopped: () => context.stopped,
    // spec §7: a conflict's resolution run, spawned as the landing reconciliations are and tracked in the same map.
    resolution: { ccloopBin: deps.ccloopBin, agentsTablePath: deps.agentsTablePath, dispatchedPersonDir: deps.dispatchedPersonDir, reconciling: context.reconciling, runTask },
    ...(deps.crash === undefined ? {} : { crash: deps.crash }),
  };
}

// Dir-requirements spec §6.1: the one target resolution lives in dirGroup.ts (requirementCalls.ts reads it there, outside
// this module's import cycle); re-exported for its existing callers.
export { groupRepoId } from "./dirGroup.js";

export function groupStopped(store: ControlStore, groupId: string): boolean {
  return readGroup(store, groupId).stopped || store.db.prepare("SELECT group_id FROM stop_intents WHERE group_id=?").get(groupId) !== undefined;
}

/**
 * Final review I1 (controller ruling, 2026-09-25): no provider attempt starts in a group that is stopped or
 * that a budget breach blocked (usage.ts); the run waits where it is.
 */
export function groupHeld(store: ControlStore, groupId: string): boolean {
  return groupStopped(store, groupId) || readGroup(store, groupId).status === "blocked";
}

/** The frozen profile's port: the one the run was claimed against -- the estimator's for every single call (F2 of the estimate plan). */
export function portFor(deps: Pick<ExecutionDriverDeps, "router">, run: DriverRun): ExecutionPort {
  return deps.router.resolve(singleCallPurposeOf(run) !== null ? "budget-estimate" : "task", run.executionProfile.profileId, run.executionProfile.profileHash).port;
}

export function readStartEnvelope(store: ControlStore, run: DriverRun): StartEnvelope {
  if (run.drive?.envelopeHash == null) throw new ControlError("recovery-blocked", `envelope-missing:${run.runId}`);
  return JSON.parse(readCanonicalRecord(store, run.drive.envelopeHash)) as StartEnvelope;
}

export function newDrive(roots: WorkspaceRoots, runId: string, workspaceMode: WorkspaceMode, workspace: boolean): DriveRecord {
  return {
    workspaceMode, sourceDir: sourceDirOf(roots, runId), workspacePath: workspace ? workspacePathOf(roots, runId) : null, targetRepo: null,
    prepared: false, base: null, envelopeHash: null, inspectUnknown: 0, outcome: null, attemptSha: null, landedCommit: null, noChange: null,
    landingPlan: null, landedDirs: null,
    reconcile: null, blockedAt: null, blockedReason: null, cleanedUp: false, cleanupError: null, publishError: null, skills: null,
    stagedPending: [], ledgerCommit: null, debugRepro: null, stagedDebugClosing: null, stagedCriteriaFlag: null, criteriaBase: null,
  };
}

/** A work run's workspace; only an estimate run has none (spec §6.2), and it never reaches the steps that need one. */
export function workspaceOf(drive: DriveRecord): string {
  if (drive.workspacePath === null) throw new ControlError("recovery-blocked", "workspace-missing");
  return drive.workspacePath;
}

/**
 * A1 (spec §2.2): one transaction reserves the provider attempt and records where the run will live.
 * Only a `starting` run enters, so a restart that finds `start-pending` never reserves a second one.
 * A strict group is refused before any attempt (spec §1, §8). A continuation is no longer refused here
 * (handoff delivery spec §4 removes deviation D21); its budget is the task's remaining grant (A2, §13.2 I-5).
 * Single-call estimate spec §6.2: an estimate run enters the same way, with no workspace.
 */
export function stepA1(deps: ExecutionDriverDeps, runId: string): boolean {
  const { store } = deps;
  return write(deps, () => {
    const run = readDriverRun(store, runId);
    if (run.state !== "starting") return false;
    const purpose = singleCallPurposeOf(run);
    // Multi-directory projects spec §5.4: a multi group has no single repo id; its primary member's setting is a
    // placeholder for a single call / task run (a single-call run has no workspace at all). A2 recomputes the ccloop
    // primary's mode for a multi run (O6).
    const settingRepoId = isMultiGroup(store, run.groupId) ? multiPrimaryRepoId(store, run.groupId) : groupRepoId(store, run.groupId);
    const drive = newDrive(deps.roots, runId, readWorkspaceSetting(store, settingRepoId).workspaceMode, purpose === null);
    const refuse = (reason: string): boolean => {
      const current = readDriverRun(store, runId);
      current.state = "blocked";
      current.drive = { ...drive, blockedAt: "A1", blockedReason: reason };
      saveDriverRun(store, current);
      return true;
    };
    // N1 plan F16: a requirement call has no proposal; its ledger is the clarifying group's, checked at claim time.
    if ((purpose === null || purpose === "estimate") && readBudgetProposal(store, run.groupId).budgetMode === "strict") return refuse("strict-proof-unimplemented");
    if (store.dispatchBlocked || groupHeld(store, run.groupId)) return false;
    const reservation = reserveProviderAttemptInTransaction(store, runId, purpose === null ? "work" : purpose === "estimate" ? "estimate" : "single-call");
    if (reservation.kind === "suppressed") return refuse(`attempt-suppressed:${reservation.requestId ?? "unknown"}`);
    const reserved = readDriverRun(store, runId);
    reserved.state = "start-pending";
    reserved.drive = drive;
    saveDriverRun(store, reserved);
    return true;
  });
}

/**
 * A2 (spec §2.2, §3): the external half. Everything here is redone whole while `prepared` is false;
 * the workspace is reused only if it is already at `base`.
 */
export async function stepA2(deps: ExecutionDriverDeps, runId: string): Promise<boolean> {
  const { store } = deps;
  const run = readDriverRun(store, runId);
  if (run.state !== "start-pending" || run.drive === undefined || run.drive.prepared || run.taskId === null) return false;
  // Backlog #13(c) (agent selection spec §12 m-4, Orca handoff §9.0c): the claim ccloop receives is built from this run
  // row (startEnvelope.ts frozenClaim), so the row must still carry the selection the confirmed snapshot froze for the
  // task -- readConfirmedTaskExecution has already proved the work item agrees with the snapshot. Checked before any
  // workspace, bundle or predecessor cleanup, so a refusal leaves nothing behind; as R does for the reconcile slot, a
  // row that moved away is blocked by name, never dispatched and never silently repaired.
  const frozenAgent = readConfirmedTaskExecution(store, run.groupId, run.taskId).agent;
  if (run.configHash !== frozenAgent.configHash || sha256Canonical(run.agent) !== sha256Canonical(frozenAgent.agent)) {
    blockRun(deps, runId, "A2", "agent-unfrozen");
    return true;
  }
  // Live transcript spec §10.5.2: a continuation's note is frozen into the start envelope, so a row that no longer parses
  // is blocked by name rather than dispatched without its note.
  const rawNote = (run as { operatorNote?: unknown }).operatorNote;
  let operatorNote: OperatorNote | undefined;
  if (rawNote !== undefined) {
    const parsed = operatorNoteSchema.safeParse(rawNote);
    if (!parsed.success) { blockRun(deps, runId, "A2", "run:operatorNote"); return true; }
    operatorNote = parsed.data;
  }
  const drive = run.drive;
  // Multi-directory projects spec §7.1/§7.4: a multi group has no single repository, and A2 reads its frozen list (never
  // the live registry). What a multi run cannot do (continuation, allowance resume, saved-result recovery) is named here,
  // before any workspace exists.
  const multi = multiDirOf(readGroup(store, run.groupId));
  if (multi !== null) {
    if (run.mode === "verify-saved-result" || run.recoveryOf !== undefined) { blockRun(deps, runId, "A2", "multi-dir-recovery-unsupported"); return true; }
    const allowancePredecessor = (allowanceWork(store, run.groupId, run.workItemId) as { allowancePredecessorRunId?: string }).allowancePredecessorRunId;
    const allowanceBase = allowancePredecessor === undefined ? null : readDriverRun(store, allowancePredecessor).drive?.base ?? null;
    if (run.continuationIntentId || allowanceBase !== null) { blockRun(deps, runId, "A2", "multi-dir-continuation-unsupported"); return true; }
    // Task setup spec 2026-11-04 §5.3 (final-review fix wave, minor 3): setup is refused on a multi-directory task (the
    // split refuses it; a contract that reached here anyway is blocked by name, before any workspace exists).
    if (readConfirmedTaskExecution(store, run.groupId, run.taskId).contract.context.setupCommands !== undefined) { blockRun(deps, runId, "A2", "setup-unsupported-here"); return true; }
    return stepA2Multi(deps, run, multi, operatorNote);
  }
  // Task setup spec 2026-11-04 §4.6: a recovery run re-runs the checks without the contract's setup, so it would judge a
  // different environment. Named here, beside the multi-directory refusal, before any workspace exists.
  if ((run.mode === "verify-saved-result" || run.recoveryOf !== undefined) && readConfirmedTaskExecution(store, run.groupId, run.taskId).contract.context.setupCommands !== undefined) {
    blockRun(deps, runId, "A2", "setup-unsupported-here"); return true;
  }
  let targetRepo: string;
  try { targetRepo = deps.resolveRepository(groupRepoId(store, run.groupId)); }
  catch { blockRun(deps, runId, "A2", "repository-path"); return true; }
  if(run.mode==="verify-saved-result"||run.recoveryOf!==undefined)assertCurrentSavedRecovery(store,run,(deps.now?.()??new Date()).getTime());
  const savedAllowance=(allowanceWork(store,run.groupId,run.workItemId) as {allowancePredecessorRunId?:string}).allowancePredecessorRunId;
  const allowanceSource=savedAllowance?readDriverRun(store,savedAllowance):null;
  const continued = run.continuationIntentId ? continuationOf(store, run) : allowanceSource?.drive?.base?{predecessorRunId:allowanceSource.runId,base:allowanceSource.drive.base}:null;
  if (run.continuationIntentId && continued === null) { blockRun(deps, runId, "A2", "continuation-registration"); return true; }
  // Handoff delivery spec §4 (human ruling, plan X): a continuation keeps its predecessor's base and never reads
  // the current tip -- ccloop rebuilds the predecessor's tree on the snapshot HEAD, a descendant of that base
  // (spec §11 I6), so C's bounds check, D's findLanding and the other side of a conflict all count from it.
  if((run.mode==="verify-saved-result"||run.recoveryOf!==undefined)&&continued!==null)throw new ControlError("resume-handoff-invalid","saved-result-explicit-command-required");
  const recovery=run.savedRecovery===undefined?null:savedRecoverySchema.parse(run.savedRecovery);
  const original=recovery?JSON.parse((await readArtifact(store,recovery.sourceEnvelope)).toString()) as StartEnvelope:null;
  // Dir-requirements spec §6.5: a dir group's work branch is made by its export, on its base; ensureWorkBranch would read
  // the vault's unborn HEAD instead. Unreachable while start waits for the export: named so a broken invariant is loud.
  if (original?.work.kind !== "loop" && continued === null && isDirGroup(store, run.groupId)
    && await revParse(targetRepo, workBranchRef(run.groupId)).then(() => false, () => true)) {
    blockRun(deps, runId, "A2", "dir-base-missing");
    return true;
  }
  const base = original?.work.kind==="loop"?original.work.base:continued !== null ? continued.base : await ensureWorkBranch(targetRepo, run.groupId, stackBaseOf(store, run.groupId));
  privateDirectory(drive.sourceDir);
  await ensureWorkspace(targetRepo, drive.workspaceMode, workspaceOf(drive), base, deps.roots);
  deps.crash?.("A2-after-workspace");
  let inputCheckpoint: InputCheckpointV1 | null = null;
  if (continued !== null) {
    inputCheckpoint = await continuationBundle(deps, continued.predecessorRunId, drive.sourceDir);
    deps.crash?.("A2-after-bundle");
    // spec §4: the predecessor's workspace goes only once the bundle exists and has verified itself.
    await cleanupPredecessor(deps, targetRepo, continued.predecessorRunId);
  }
  const confirmed = readConfirmedTaskExecution(store, run.groupId, run.taskId);
  // ccloop opens its attempt worktrees from repoPath's HEAD, not from `base` (spec §3.2), so the
  // contract points at this run's own workspace. The frozen derivedContractHash is unchanged.
  const runtime = {
    ...confirmed.contract, context: { ...confirmed.contract.context, repoPath: workspaceOf(drive) },
    executionPolicy: dispatchedPolicy(store, run, confirmed.contract.executionPolicy, (run.grant as { work: { tokens: number|null; activeMs: number; attempts: number } }).work),
  };
  const prepared = await skillFilledRuntime(deps, run, targetRepo, runtime, confirmed);
  if ("blocked" in prepared) { blockRun(deps, runId, "A2", prepared.blocked); return true; }
  const contract = prepared.runtime, skills = prepared.skills;
  // ccloop priorFailures spec 2026-10-21 §3 (kanban spec §6 level 1): built once here, frozen in the envelope below. A
  // continuation copies its predecessor's entries; a saved-result recovery carries none (ccloop refuses them there).
  const priorFailures = await priorFailuresAtPrepare(store, { groupId: run.groupId, taskId: run.taskId, runId }, { recovery: recovery !== null, predecessorRunId: continued?.predecessorRunId ?? null });
  const packageRecord=recovery?{...materializeRecoveryPackage(store,drive.sourceDir,recovery),recoveryOf:recovery.recoveryOf}:undefined;
  if(recovery)write(deps,()=>{assertCurrentSavedRecovery(store,readDriverRun(store,runId),(deps.now?.()??new Date()).getTime());const admission=savedResultAdmissionSchema.parse(JSON.parse(settlementArtifactBytes(store,recovery.admission).toString()));publishRecoveryFence(drive.sourceDir,admission,packageRecord!.packageHash,packageRecord!.admissionHash);});
  const envelope = toStartEnvelope(readWorkClaimEnvelope(store, run.groupId, runId), {...run,...(packageRecord?{savedResultRecovery:packageRecord}:{})}, {
    sourceDir: drive.sourceDir, targetRepo, base, ...(priorFailures !== undefined ? { priorFailures } : {}), ...skillEnvelopeKey(prepared.kind, skills),
    ...(operatorNote === undefined ? {} : { operatorNote }),
  }, contract, inputCheckpoint);
  const envelopeHash = sha256Canonical(envelope);
  return write(deps, () => {
    writeCanonicalRecord(store, run.groupId, envelopeHash, canonicalBytes(envelope).toString("utf8"));
    const current = readDriverRun(store, runId);
    if (current.state !== "start-pending" || current.drive === undefined || current.drive.prepared) return false;
    current.drive = { ...current.drive, targetRepo, base, envelopeHash, prepared: true, skills };
    if(current.mode==="verify-saved-result"||current.recoveryOf!==undefined){const marker=savedDispatchSchema.parse(current.savedDispatch);if(marker.state!=="never-submitted")throw new ControlError("saved-result-source-stale");current.savedDispatch={...marker,envelopeHash};}
    saveDriverRun(store, current);
    return true;
  });
}

/**
 * A2 for a multi group's run (multi-directory projects spec §7.1): every written directory, in registered order, gets its
 * work branch and workspace. The first written one is the ccloop primary and keeps today's workspace path; the others are
 * flat leaves of the workspaces root. Skills inject into the primary only.
 */
async function stepA2Multi(deps: ExecutionDriverDeps, run: DriverRun, multi: FrozenMultiDir, operatorNote: OperatorNote | undefined): Promise<boolean> {
  const { store } = deps;
  const runId = run.runId, drive = run.drive!, taskId = run.taskId!;
  const writes = taskWrites(store, run.groupId, taskId);
  if (writes === null || writes.length === 0) { blockRun(deps, runId, "A2", "multi-dir-writes-missing"); return true; }
  const order = new Map(multi.dirs.map((dir, index) => [dir.key, index] as const));
  for (const write of writes) {
    if (!order.has(write.dir)) { blockRun(deps, runId, "A2", `multi-dir-writes:${write.dir}`); return true; }
  }
  const written = [...writes].sort((left, right) => order.get(left.dir)! - order.get(right.dir)!);
  privateDirectory(drive.sourceDir);
  const preparedDirs: Array<{ key: string; targetRepo: string; base: string; workspacePath: string; mode: WorkspaceMode }> = [];
  // Recorded as each workspace is made: a block after one still names every extra directory a cleanup must remove (the
  // primary's is already `drive.workspacePath`). Only the prepared write below records the envelope.
  const recordDirs = (): void => {
    write(deps, () => {
      const current = readDriverRun(store, runId);
      if (current.state !== "start-pending" || current.drive === undefined || current.drive.prepared) return false;
      current.drive = { ...current.drive, dirs: preparedDirs.map(({ key, targetRepo, base, workspacePath }) => ({ key, targetRepo, base, workspacePath })) };
      saveDriverRun(store, current);
      return true;
    });
  };
  for (const write of written) {
    const member = multi.dirs.find((dir) => dir.key === write.dir)!;
    const targetRepoId = dirTargetRepoId(store, run.groupId, write.dir);
    let targetRepo: string;
    try { targetRepo = deps.resolveRepository(targetRepoId); }
    catch { blockRun(deps, runId, "A2", "repository-path"); return true; }
    // Dir-requirements spec §6.5: a dir member's work branch is made by the export; there is none to read here.
    if (member.kind === "dir" && !(await revParse(targetRepo, workBranchRef(run.groupId)).then(() => true, () => false))) {
      blockRun(deps, runId, "A2", "dir-base-missing");
      return true;
    }
    const base = await ensureWorkBranch(targetRepo, run.groupId, null);
    const mode = readWorkspaceSetting(store, targetRepoId).workspaceMode;
    const workspacePath = preparedDirs.length === 0 ? workspaceOf(drive) : extraWorkspacePathOf(deps.roots, runId, write.dir);
    await ensureWorkspace(targetRepo, mode, workspacePath, base, deps.roots);
    preparedDirs.push({ key: write.dir, targetRepo, base, workspacePath, mode });
    recordDirs();
  }
  deps.crash?.("A2-after-workspace");
  const primary = preparedDirs[0]!;
  const confirmed = readConfirmedTaskExecution(store, run.groupId, taskId);
  const contractContext = (confirmed.contract as unknown as { context: Record<string, unknown> & { additionalRepos?: Array<{ key: string }> } }).context;
  const contractExtras = Array.isArray(contractContext.additionalRepos) ? contractContext.additionalRepos : [];
  for (const extra of contractExtras) {
    if (!preparedDirs.some((dir) => dir.key === extra.key)) { blockRun(deps, runId, "A2", `multi-dir-contract:${extra.key}`); return true; }
  }
  for (const dir of preparedDirs.slice(1)) {
    if (!contractExtras.some((extra) => extra.key === dir.key)) { blockRun(deps, runId, "A2", `multi-dir-contract:${dir.key}`); return true; }
  }
  const workspaceOfKey = new Map(preparedDirs.map((dir) => [dir.key, dir.workspacePath] as const));
  const runtime = {
    ...confirmed.contract,
    context: {
      ...contractContext, repoPath: primary.workspacePath,
      ...(contractExtras.length === 0 ? {} : { additionalRepos: contractExtras.map((extra) => ({ ...extra, repoPath: workspaceOfKey.get(extra.key)! })) }),
    },
    executionPolicy: dispatchedPolicy(store, run, confirmed.contract.executionPolicy, (run.grant as { work: { tokens: number|null; activeMs: number; attempts: number } }).work),
  };
  // Flow engine spec §12.2 phase 1 / §12.1: a flow step's skills are injected for this run and its dir tokens filled.
  const prepared = await skillFilledRuntime(deps, run, primary.targetRepo, runtime, confirmed);
  if ("blocked" in prepared) { blockRun(deps, runId, "A2", prepared.blocked); return true; }
  const contract = prepared.runtime, skills = prepared.skills;
  const priorFailures = await priorFailuresAtPrepare(store, { groupId: run.groupId, taskId, runId }, { recovery: false, predecessorRunId: null });
  const additionalRepos = preparedDirs.slice(1).map(({ key, targetRepo, base }) => ({ key, targetRepo, base }));
  const envelope = toStartEnvelope(readWorkClaimEnvelope(store, run.groupId, runId), run, {
    sourceDir: drive.sourceDir, targetRepo: primary.targetRepo, base: primary.base,
    ...(additionalRepos.length === 0 ? {} : { additionalRepos }),
    ...(priorFailures !== undefined ? { priorFailures } : {}),
    ...skillEnvelopeKey(prepared.kind, skills),
    ...(operatorNote === undefined ? {} : { operatorNote }),
  }, contract, null);
  const envelopeHash = sha256Canonical(envelope);
  return write(deps, () => {
    writeCanonicalRecord(store, run.groupId, envelopeHash, canonicalBytes(envelope).toString("utf8"));
    const current = readDriverRun(store, runId);
    if (current.state !== "start-pending" || current.drive === undefined || current.drive.prepared) return false;
    current.drive = {
      ...current.drive, workspaceMode: primary.mode, targetRepo: primary.targetRepo, base: primary.base, envelopeHash, prepared: true, skills,
      dirs: preparedDirs.map(({ key, targetRepo, base, workspacePath }) => ({ key, targetRepo, base, workspacePath })),
    };
    saveDriverRun(store, current);
    return true;
  });
}

/**
 * Syncskill integration spec §10.6 (replaces §4.3 steps 1-2 and 5): the task's frozen skill set, injected afresh into
 * `skills-<runId>` -- a leftover from an A2 that died is removed, never reused (A2 records `skills` only together with
 * `prepared`). The snapshot is made read-only so the agent cannot edit what it is given. Answers what A2 records; the
 * directory is its canonical path, because ccloop's accept requires one. Throws on any failure; A2 blocks by its code.
 */
async function injectRunSkills(deps: ExecutionDriverDeps, targetRepo: string, runId: string, frozen: { profile: string | null; names: string[] }): Promise<NonNullable<DriveRecord["skills"]>> {
  await removeSkillsSnapshot(targetRepo, deps.roots, runId);
  const created = skillsPathOf(deps.roots, runId);
  for (const sub of [created, join(created, "skills"), join(created, ".claude-plugin")]) await mkdir(sub, { mode: 0o700 });
  const dir = await realpath(created);
  const lock = await injectSkills(deps.syncskill ?? { bin: null, env: {} }, frozen.names, join(dir, "skills"));
  // Spec §4.3 step 5: the snapshot must hold exactly the frozen list, in its order.
  if (lock.map((entry) => entry.name).join("\0") !== frozen.names.join("\0")) {
    throw new SyncskillError("syncskill-output-invalid", `syncskill inject answered ${JSON.stringify(lock.map((entry) => entry.name))} for ${JSON.stringify(frozen.names)}`);
  }
  await writeFile(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "orca-run-skills", version: "0.0.0" }), { mode: 0o600 });
  await makeReadOnly(join(dir, "skills"));
  return { dir, profile: frozen.profile, lock };
}

/** The envelope's skill key, by the frozen installation's kind; absent for a run without skills. */
function skillEnvelopeKey(
  kind: "claude" | "codex" | "omp" | undefined,
  skills: DriveRecord["skills"],
): { skillPluginDir?: string; codexSkillsDir?: string; ompSkillsDir?: string } {
  if (skills === null) return {};
  return kind === "codex" ? { codexSkillsDir: join(skills.dir, "skills") } : kind === "omp" ? { ompSkillsDir: join(skills.dir, "skills") } : { skillPluginDir: skills.dir };
}

/**
 * Syncskill integration spec §10.6, flow engine spec §12.2 phase 1 / §12.1: A2's skill block, shared with the
 * saved-result inspection input so a rebuilt envelope names the same copies a dispatch would. Injects the task's frozen
 * set (a flow child's step skills when it declares none) into this run's snapshot, fills `{{skill.<name>.dir}}` only for
 * flow-declared skills whose copy is now known, and answers the installation kind for the envelope key. Any failure is
 * the caller's block reason, exactly as A2 named it.
 */
async function skillFilledRuntime<T>(
  deps: ExecutionDriverDeps,
  run: DriverRun,
  targetRepo: string,
  runtime: T,
  confirmed: Pick<ReturnType<typeof readConfirmedTaskExecution>, "agent" | "skills">,
): Promise<{ kind: "claude" | "codex" | "omp" | undefined; skills: DriveRecord["skills"]; runtime: T } | { blocked: string }> {
  const flowSkills = flowChildSkills(deps.store, run.groupId);
  const declared = confirmed.skills ?? flowSkills;
  if (declared === null) return { kind: undefined, skills: null, runtime };
  try {
    const kind = (await portFor(deps, run).listAgents()).installations.find((installation) => installation.id === confirmed.agent.agent.agent)?.kind;
    if (kind !== "claude" && kind !== "codex" && kind !== "omp") {
      return { blocked: `skills-unsupported-agent:${run.taskId}:${confirmed.agent.agent.agent}:${kind ?? "not-in-table"}` };
    }
    const skills = await injectRunSkills(deps, targetRepo, run.runId, declared);
    if (confirmed.skills !== null || flowSkills === null) return { kind, skills, runtime };
    const filled = withSkillDirs(runtime, skills.dir, skills.lock.map((entry) => entry.name));
    return "unknown" in filled ? { blocked: `flow-skill-dir-unknown:${filled.unknown}` } : { kind, skills, runtime: filled.value };
  } catch (error) {
    return { blocked: `skills-inject-failed:${error instanceof SyncskillError ? error.code : describeError(error)}` };
  }
}

/** The registration this continuation run was claimed from, and its predecessor's base (spec §4). */
function continuationOf(store: ControlStore, run: DriverRun): { predecessorRunId: string; base: string } | null {
  const work = readWork(store, run.groupId, run.workItemId) as unknown as { continuation?: { continuationIntentId: string; predecessorRunId: string } | null };
  const registered = work.continuation ?? null;
  if (registered === null || registered.continuationIntentId !== run.continuationIntentId) return null;
  const base = readDriverRun(store, registered.predecessorRunId).drive?.base ?? null;
  return base === null ? null : { predecessorRunId: registered.predecessorRunId, base };
}

/** spec §11 I5: exportResumeBundle refuses a second export, so a restarted A2 reuses (and re-verifies) the first. */
async function continuationBundle(deps: ExecutionDriverDeps, predecessorRunId: string, sourceDir: string): Promise<InputCheckpointV1> {
  try { return await exportResumeBundle(deps.store, { predecessorRunId, newSourceDir: sourceDir }, archiveAdmission(deps)); }
  catch (error) {
    if (!(error instanceof ControlError && error.code === "resume-bundle-exists")) throw error;
    return readExistingResumeBundle(deps.store, { predecessorRunId, newSourceDir: sourceDir });
  }
}

/**
 * spec §4, §7: the predecessor's own workspace; its source directory and archived snapshot stay. The predecessor
 * is out of the driver's scope, so a failed removal is recorded on it (the residue, visible on the panel) and never
 * blocks the continuation, whose bundle already exists -- the convention of driverHandoff.restartRun.
 */
async function cleanupPredecessor(deps: ExecutionDriverDeps, targetRepo: string, predecessorRunId: string): Promise<void> {
  const predecessor = readDriverRun(deps.store, predecessorRunId);
  if (predecessor.drive === undefined || predecessor.drive.cleanedUp) return;
  let cleanupError: string | null = null;
  try { await cleanupRunWorkspace(targetRepo, deps.roots, predecessorRunId, workspaceOf(predecessor.drive)); }
  catch (error) { cleanupError = describeError(error); }
  write(deps, () => {
    const current = readDriverRun(deps.store, predecessorRunId);
    current.drive = { ...current.drive!, cleanedUp: cleanupError === null, cleanupError };
    saveDriverRun(deps.store, current);
  });
}

/**
 * spec §13.2 I-5 (controller decision): ccloop spends by the contract, not by the grant, so a continuation's
 * contract is cut to what its task has left. The contract hash stays the frozen derivedContractHash, the same
 * rule as the repoPath rewrite above.
 */
export function withinGrant<P extends { maxAttempts: number; tokenBudget: number|null; totalRuntimeBudgetMs: number }>(policy: P, grant: { tokens: number|null; activeMs: number; attempts: number }): P {
  return {
    ...policy, maxAttempts: Math.min(policy.maxAttempts, grant.attempts), tokenBudget: minTokenCeiling(policy.tokenBudget, grant.tokens),
    totalRuntimeBudgetMs: Math.min(policy.totalRuntimeBudgetMs, grant.activeMs),
  };
}

/**
 * The policy a run is dispatched with. A task on the optional accounting mode freezes its authored subtotal into the
 * confirmed contract, but every later top-up is booked separately (`work_grant_top_ups`) and folded into the run's
 * funded grant (fundedAllowance.ts). Taking the min() of the frozen number and the grant silently swallowed a person's
 * top-up: the retried run still carried the authored `tokenBudget` and ccloop stopped in the same place, while Orca's
 * own account said it had funded the difference (paid calibration 2026-11-09, #162/#173).
 * So a top-up extends the frozen declaration by exactly what it granted, and the grant still bounds the result -- a
 * run with no top-up dispatches byte for byte as before, and a continuation still gets only what is left. A
 * `finite-legacy` task keeps today's min(): its retry branch re-grants the run's own grant and refuses a top-up by
 * name. Saved-result recoveries do not come through here: ccloop bounds that runtime from the admission's fresh grant
 * (`boundSavedResultRuntime`).
 */
export function dispatchedPolicy<P extends { maxAttempts: number; tokenBudget: number|null; totalRuntimeBudgetMs: number }>(
  store: ControlStore, run: { groupId: string; workItemId: string }, policy: P, grant: { tokens: number|null; activeMs: number; attempts: number },
): P {
  if (!hasOptionalTaskPolicy(store, run.groupId, run.workItemId)) return withinGrant(policy, grant);
  const topUp = topUpSum(store, run.groupId, run.workItemId, null);
  return withinGrant({
    ...policy, maxAttempts: policy.maxAttempts + topUp.attempts,
    tokenBudget: policy.tokenBudget === null ? null : policy.tokenBudget + topUp.tokens,
    totalRuntimeBudgetMs: policy.totalRuntimeBudgetMs + topUp.activeMs,
  }, grant);
}

/** spec §2.2 B and B': one place turns a port answer into a run state. Answers whether the state changed. */
function persistStatus(deps: ExecutionDriverDeps, runId: string, status: ExecutionStatus, step: "B" | "B'"): boolean {
  const { store } = deps;
  return write(deps, () => {
    const run = readDriverRun(store, runId);
    const drive = run.drive!;
    const block = (reason: string, patch: Partial<DriveRecord> = {}): boolean => {
      run.state = "blocked";
      run.drive = { ...drive, ...patch, blockedAt: step, blockedReason: reason };
      saveDriverRun(store, run);
      return true;
    };
    if (status.kind === "accepted" || status.kind === "stopped") {
      // Controller ruling P5 (2026-09-25): the two branches converge on the same reset, merged here
      // rather than duplicated.
      if (status.kind === "accepted") {
        if (status.configHash !== run.configHash) return block("config-hash-mismatch");
        run.executionId = status.executionId;
      } else {
        // Deviation D4: ccloop answers `stopped` for an execution that ran to its end with a proved stop;
        // what is left is to collect it.
        if (status.proof.generation !== run.generation) return block("stop-proof-generation");
        run.executionId = status.proof.executionId;
      }
      run.state = "accepted";
      run.drive = { ...drive, inspectUnknown: 0 };
    } else if (status.kind === "absent") {
      run.state = "start-pending";
      run.drive = { ...drive, inspectUnknown: 0 };
    } else if (step === "B") {
      run.state = "unknown";
    } else {
      const inspectUnknown = drive.inspectUnknown + 1;
      if (inspectUnknown >= INSPECT_UNKNOWN_LIMIT) return block("inspect-unknown", { inspectUnknown });
      run.drive = { ...drive, inspectUnknown };
      saveDriverRun(store, run);
      return false;
    }
    saveDriverRun(store, run);
    return true;
  });
}

/**
 * B (spec §2.2): send the stored envelope, byte for byte, unless an execution is already recorded.
 * A thrown answer is `unknown` (it may have started), except a deterministic refusal ccloop makes
 * before it writes anything (exit 2), which is blocked by name (deviation D5).
 */
export async function stepB(deps: ExecutionDriverDeps, runId: string): Promise<boolean> {
  const { store } = deps;
  const run = readDriverRun(store, runId);
  if (run.state !== "start-pending" || run.drive?.prepared !== true) return false;
  if (run.executionId !== null) {
    return write(deps, () => { const current = readDriverRun(store, runId); current.state = "accepted"; saveDriverRun(store, current); return true; });
  }
  if (store.dispatchBlocked || groupHeld(store, run.groupId) || deps.admissionGate?.draining) return false;
  if(run.mode==="verify-saved-result"||run.recoveryOf!==undefined)assertCurrentSavedRecovery(store,run,(deps.now?.()??new Date()).getTime());
  if(run.mode==="verify-saved-result"||run.recoveryOf!==undefined)write(deps,()=>{const current=readDriverRun(store,runId),marker=savedDispatchSchema.parse(current.savedDispatch);if(marker.state!=="never-submitted"||marker.envelopeHash!==current.drive?.envelopeHash)throw new ControlError("saved-result-source-stale");current.savedDispatch={...marker,state:"submitted"};saveDriverRun(store,current);});
  let status: ExecutionStatus;
  try {
    status = await portFor(deps, run).accept(readStartEnvelope(store, run));
  } catch (error) {
    if (error instanceof ControlError && error.code === "control-peer-exit" && (error.detail ?? "").startsWith("2:")) {
      blockRun(deps, runId, "B", `accept-refused:${peerExitText(peerFailure(error)!)}`);
      return true;
    }
    const line = peerFailureLogLine(runId, error); if (line !== null) process.stderr.write(line);
    status = { kind: "unknown" };
  }
  deps.crash?.("B-after-accept");
  return persistStatus(deps, runId, status, "B");
}

/** B' (spec §2.2): read-only. `absent` re-arms B; ten unknowns in a row block the run. */
export async function stepBPrime(deps: ExecutionDriverDeps, runId: string): Promise<boolean> {
  const run = readDriverRun(deps.store, runId);
  if (run.state !== "unknown" || run.drive === undefined) return false;
  let status: ExecutionStatus;
  try { status = await portFor(deps, run).inspect(readStartEnvelope(deps.store, run)); }
  catch (error) { const line = peerFailureLogLine(runId, error); if (line !== null) process.stderr.write(line); status = { kind: "unknown" }; }
  if(status.kind==="unknown"&&(run.mode==="verify-saved-result"||run.recoveryOf!==undefined)&&await settleDeadSavedRecovery(deps,run)){
    const current=readDriverRun(deps.store,runId);status=await portFor(deps,current).inspect(readStartEnvelope(deps.store,current));
  }
  if(status.kind==="absent"&&(run.mode==="verify-saved-result"||run.recoveryOf!==undefined)&&savedDispatchSchema.parse(run.savedDispatch).state!=="never-submitted")status={kind:"unknown"};
  return persistStatus(deps, runId, status, "B'");
}

/**
 * C (spec §2.2): collect, book usage and evidence, and only once the stop is proved act on the
 * terminal: succeeded becomes an attempt commit (§3.3) checked against the task's paths (§5.2);
 * anything else is blocked where it stands and nothing is landed.
 */
/**
 * C's collection half (spec §2.2), shared with the handoff step H (handoff delivery spec §3): collect, check
 * every piece of evidence against its hash and archive it, book usage, and check the report is this run's.
 */
export async function collectInto(deps: ExecutionDriverDeps, run: DriverRun): Promise<ExecutionReport> {
  const { store } = deps;
  const runId = run.runId;
  const port = portFor(deps, run);
  const report = await port.collect(readStartEnvelope(store, run), run.highWater);
  const recovery=run.recoveryOf===undefined?null:recoveryOfSchema.parse(run.recoveryOf);
  const verificationOnlyRecovery=recovery!==null&&'kind' in recovery&&recovery.kind==='verification-only-v1';
  if(report.candidate!==null&&(report.candidate.verificationOnly===true)!==verificationOnlyRecovery)throw new ControlError('report-identity-conflict','verification-only-source-mismatch');
  const refs = [...report.events.map((event) => event.source), ...(report.candidate?.artifacts ?? [])];
  if (report.candidate) refs.push(report.candidate.handoff);
  if (report.candidate?.stopProof) refs.push(report.candidate.stopProof.source);
  for (const ref of refs) {
    const bytes = await port.readEvidence(ref);
    if (createHash("sha256").update(bytes).digest("hex") !== ref.hash) throw new ControlError("artifact-hash-mismatch");
    await writeArtifact(store, ref.artifactId, bytes, archiveAdmission(deps));
  }
  for (const event of report.events) {
    if (event.runId !== runId || event.generation !== run.generation) throw new ControlError("report-identity-conflict");
    admitted(deps, () => recordUsage(store, event, deps.now?.().getTime()));
  }
  // Labels and progress spec §3.4 (§8 R2, R3): the latest progress, stored on a FRESH read after the usage above --
  // `run` here predates recordUsage, and saving it would roll cumulative, remaining and highWater back. saveDriverRun
  // writes (and moves changeSeq) only when the body changed. A port that answered no progress field writes nothing, and
  // a null answer over a run that never had progress is no change (absent reads as null, R1; plan finding F15).
  if (report.progress !== undefined) {
    const progress = report.progress;
    write(deps, () => {
      const current = readDriverRun(store, runId);
      if (current.progress === undefined && progress === null) return;
      const before = (current.progress ?? null) as RunProgress | null;
      current.progress = progress;
      saveDriverRun(store, current);
      // Issue-fixes spec §5.2: a collect whose step or attempt differs from the stored one (a null answer is no phase).
      if (progress !== null && (before === null || before.status !== progress.status || before.currentAttempt !== progress.currentAttempt)) {
        recordActivity(store, { groupId: current.groupId, taskId: current.taskId, runId, kind: "phase", body: { step: progress.status, attempt: progress.currentAttempt } });
      }
    });
  }
  try {
  if(report.terminal&&run.taskId!==null&&run.mode===undefined&&run.recoveryOf===undefined&&!isMultiGroup(store,run.groupId)&&(await port.readFeatures?.())?.savedResultRecovery==="v1"&&port.collectSavedResultEvidence&&port.readSavedResultEvidence){
    const page=savedResultCollectionSchema.parse(await port.collectSavedResultEvidence(readStartEnvelope(store,run)));
    if(page.identity.runId!==runId||page.identity.envelopeHash!==run.drive?.envelopeHash||page.identity.executionId!==run.executionId)throw new ControlError("report-identity-conflict");
    if(page.capsule){
      const retain=async(ref:import("./types.js").ArtifactRef):Promise<Buffer>=>{const bytes=await port.readSavedResultEvidence!(readStartEnvelope(store,run),page.capsule!,ref);await writeArtifact(store,ref.artifactId,bytes,archiveAdmission(deps));return bytes;};
      const parsed=JSON.parse((await retain(page.capsule)).toString()),exhaustedSource=parsed.schema==="ccloop-execution-complete-before-verification-v1",withoutFinal=parsed.schema==="ccloop-execution-without-final-v1";
      const capsule=withoutFinal?ompWithoutFinalCompletionSchema.parse(parsed):exhaustedSource?exhaustedCompletionSchema.parse(parsed):executionFormatFailureSchema.parse(parsed);
      if(withoutFinal&&capsule.executor.kind!=='omp')throw new ControlError('report-identity-conflict','verification-only-executor');
      const snapshot=savedExecutionSnapshotSchema.parse(JSON.parse((await retain(capsule.snapshot)).toString()));
      const {usageObservations,...artifacts}=capsule.artifacts;
      for(const ref of [capsule.verifier.proof,...Object.values(artifacts).filter((r):r is import("./types.js").ArtifactRef=>r!==null&&typeof r==="object"&&"artifactId" in r),...(usageObservations??[]).flatMap(a=>[a.source,a.copy]),snapshot.index,snapshot.bundle,snapshot.status,...snapshot.files.map(f=>f.ref)])await retain(ref);
      write(deps,()=>{const current=readDriverRun(store,runId);current.savedSource={authorityKind:withoutFinal?"execution-without-final-v1":exhaustedSource?"execution-complete-before-verification-v1":"execution-format-failure-v1",source:page.capsule,attempt:page.attempt};saveDriverRun(store,current);});
    }
  }
  }catch(error){const line=peerFailureLogLine(runId,error);if(line!==null)process.stderr.write(line);write(deps,()=>{const current=readDriverRun(store,runId);current.savedSourceUnavailable="saved-result-evidence-unavailable";saveDriverRun(store,current);});}
  const candidate = report.candidate;
  if (candidate && (candidate.runId !== runId || candidate.generation !== run.generation || candidate.workItemId !== run.workItemId)) {
    throw new ControlError("report-identity-conflict");
  }
  // Live transcript spec §10.4.1 / §12.3: keep the last transcripts listing of every run collected (agentTranscript/listing.ts).
  if (report.transcripts !== undefined) write(deps, () => noteTranscriptListing(store, runId, readStartEnvelope(store, run).work.sourceDir, report.transcripts));
  // Tester round 3 spec §3: kept beside the run for the settlement view.
  const floor = report.usageLowerBound;
  if (floor !== undefined) write(deps, () => { const current = readDriverRun(store, runId); current.usageLowerBound = floor; saveDriverRun(store, current); });
  deps.taskResults?.schedule(runId);
  return report;
}

/**
 * Issue #209: a provider may answer a model it does not serve with a 429, which ccloop reports as `rate-limited`. When the
 * run's frozen model is missing from the agent's read catalog -- what the selection preview warned about (agentFreeze.ts)
 * -- the miss is kept beside the cause, in the same words, so the failure explanation can name it. A catalog that was not
 * or could not be read names nothing (#124).
 */
async function rateLimitedCatalogMiss(deps: ExecutionDriverDeps, run: DriverRun): Promise<{ catalogMiss?: string }> {
  const agent = (run as { agent?: { agent?: unknown; model?: unknown } | null }).agent;
  if (agent == null || typeof agent.agent !== "string" || typeof agent.model !== "string" || agent.model === "") return {};
  try {
    const miss = await selectorMissOf(portFor(deps, run), { agent: agent.agent, model: agent.model });
    return miss === null ? {} : { catalogMiss: catalogMissReason(miss) };
  } catch { return {}; }
}

export async function stepC(deps: ExecutionDriverDeps, runId: string, context?: DriverContext): Promise<boolean> {
  const { store } = deps;
  const run = readDriverRun(store, runId);
  if (run.state !== "accepted" || run.drive === undefined || run.taskId === null) return false;
  const drive = run.drive;
  // Debug task plan Task 8 (fix round 1, R1): a run whose reproduce-first check started is never collected or committed
  // again; the check owns its workspace until its verdict is applied.
  if (drive.debugRepro?.state === "checking") return stepDebugCheck(deps, run, context);
  let report = await collectInto(deps, run);
  if((run.mode==="verify-saved-result"||run.recoveryOf!==undefined)&&(!report.terminal||!report.candidate?.stopProof)){
    const status=await portFor(deps,run).inspect(readStartEnvelope(store,run));
    if(status.kind==="unknown"&&await settleDeadSavedRecovery(deps,run))report=await collectInto(deps,readDriverRun(store,runId));
  }
  const candidate = report.candidate;
  // Handoff delivery spec §3 (X1): a proved stop with no terminal and no request of this run's is not
  // something to wait for forever; it is blocked by name. With a request, step H owns the run.
  if (!report.terminal && candidate?.stopProof && openRequestOf(store, run) === null) {
    blockRun(deps, runId, "C", "candidate-without-terminal");
    return true;
  }
  if (!report.terminal || !candidate?.stopProof) return report.events.length > 0;
  if (report.terminal.sourceDir !== drive.sourceDir) throw new ControlError("report-path-conflict");
  const source = await writeArtifact(store, `report-${runId}-${hashPayload(report)}`, Buffer.from(JSON.stringify(report)), archiveAdmission(deps));
  write(deps, () => store.db.prepare("INSERT INTO outbox VALUES (?, 'report', ?, 0) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(`report:${runId}`, JSON.stringify({ source })));
  deps.crash?.("C-after-terminal");
  const outcome = report.terminal.outcome;
  if((run.mode==="verify-saved-result"||run.recoveryOf!==undefined)&&report.terminal.waitingCause==="token-allowance")throw new ControlError("resume-handoff-invalid","saved-result-explicit-command-required");
  if(report.terminal.waitingCause==="token-allowance")return settleTokenAllowance(deps,runId,report);
  if (outcome !== "succeeded") {
    if(run.mode===undefined&&run.recoveryOf===undefined)try{await archiveRun(store,{runId,sourceDir:drive.sourceDir,repoDir:join(drive.sourceDir,"repo"),stopProof:candidate.stopProof},archiveAdmission(deps));}catch{write(deps,()=>{const current=readDriverRun(store,runId);current.savedSourceUnavailable="saved-result-evidence-unavailable";saveDriverRun(store,current);});}
    // Issue fixes spec §4.2(1): ccloop's reason is kept beside the outcome (the run view and the panel explain it); the
    // blocked reason is unchanged.
    const stopReason = report.terminal.stopReason ? { stopReason: report.terminal.stopReason } : {};
    // Failure-cause spec 2026-10-21 §3 and ccloop priorFailures spec §3: the cause and the last rejection are kept beside
    // the reason, for the panel's next-step line and a later re-dispatch; absent when ccloop stated none.
    // ccloop per-contract tool rules spec §5: the run's tool-rule report goes with them, so a violation can be read back.
    const failure = { ...(report.terminal.failureCause !== undefined ? { failureCause: report.terminal.failureCause } : {}), ...(report.terminal.lastFailure !== undefined ? { lastFailure: report.terminal.lastFailure } : {}), ...(report.terminal.budgetSnapshot !== undefined ? { budgetSnapshot: report.terminal.budgetSnapshot } : {}), ...(report.toolRules !== undefined ? { toolRules: report.toolRules } : {}), ...(report.pathPolicyMisses !== undefined ? { pathPolicyMisses: report.pathPolicyMisses } : {}) };
    const catalogMiss = report.terminal.failureCause?.cause === "rate-limited" ? await rateLimitedCatalogMiss(deps, run) : {};
    blockRun(deps, runId, "C", report.terminal.stopReason?.includes("codex-skills-") ? report.terminal.stopReason : `terminal:${outcome}`, { outcome, ...stopReason, ...failure, ...catalogMiss });
    if(run.mode==="verify-saved-result"||run.recoveryOf!==undefined)await retainSavedInterruption(deps,runId);
    return true;
  }
  let attemptSha: string;
  const contract = readConfirmedTaskExecution(store, run.groupId, run.taskId).contract;
  // Multi-directory projects spec §7.2: one attempt commit and one harvest per written directory, each with its own
  // claims. The primary's sha stays in drive.attemptSha; every directory's sha is kept in drive.dirs[].
  const multi = isMultiGroup(store, run.groupId);
  const multiDirs = multi ? drive.dirs ?? null : null;
  if (multi && multiDirs === null) { blockRun(deps, runId, "C", "multi-dir-writes-missing", { outcome }); return true; }
  const dirAttempts: string[] = [];
  const dirReconciliations: Array<{ key: string; outOfBounds: string[]; empty: boolean }> = [];
  let measured: Reconciliation;
  if (multiDirs === null) {
    attemptSha = await commitAttempt(join(drive.sourceDir, "repo"));
    measured = await harvest({ runId, workdir: drive.sourceDir, outcome: "succeeded", attemptSha }, drive.base!, writeSetOf(contract));
    if (measured.outOfBounds.length > 0) {
      blockRun(deps, runId, "C", `out-of-bounds:${measured.outOfBounds.join(",")}`, { outcome, attemptSha });
      return true;
    }
  } else {
    for (const [index, dir] of multiDirs.entries()) {
      const resultRepo = index === 0 ? join(drive.sourceDir, "repo") : join(drive.sourceDir, "repos", dir.key);
      const dirSha = await commitAttempt(resultRepo);
      dirAttempts.push(dirSha);
      const declared = index === 0 ? writeSetOf(contract) : extraClaimsOf(contract, dir.key);
      const result = await harvest({ runId, workdir: drive.sourceDir, outcome: "succeeded", attemptSha: dirSha }, dir.base, declared, resultRepo);
      dirReconciliations.push({ key: dir.key, outOfBounds: result.outOfBounds, empty: result.empty });
    }
    attemptSha = dirAttempts[0]!;
    measured = { actualPaths: [], outOfBounds: [], declaredNotProduced: [], empty: dirReconciliations.every((dir) => dir.empty) };
    const offending = dirReconciliations.filter((dir) => dir.outOfBounds.length > 0).map((dir) => `${dir.key}:${dir.outOfBounds.join(",")}`);
    if (offending.length > 0) {
      // The runs that were committed stay named on the blocked run, as the primary's sha is.
      const dirs = multiDirs.map((dir, index) => ({ ...dir, ...(dirAttempts[index] === undefined ? {} : { attemptSha: dirAttempts[index]! }) }));
      blockRun(deps, runId, "C", `out-of-bounds:${offending.join(";")}`, { outcome, attemptSha, dirs });
      return true;
    }
  }
  // Debug-task design §12.8 (plan Task 8): a debug group's run is checked before it moves on, an empty attempt included
  // (it added no test, so it fails `no-tests`). Fix round 1 (R1): the check runs off the driver round. The marker that
  // lets a restart restore the workspace is persisted first; a later round applies the verdict (stepDebugCheck).
  if (readDebugMark(readGroup(store, run.groupId)) !== null) {
    const workdir = join(drive.sourceDir, "repo");
    // Final-review fix wave (I2): with setup, the snapshot keeps the ignored paths, so the restore removes what setup installs.
    const snapshot = await snapshotWorkspace(workdir, contract.context.setupCommands);
    const marked = write(deps, () => {
      const current = readDriverRun(store, runId);
      if (current.state !== "accepted" || current.drive === undefined) return false;
      current.drive = { ...current.drive, debugRepro: { state: "checking", startedAt: (deps.now?.() ?? new Date()).toISOString(), attemptSha, ...snapshot, empty: measured.empty } };
      saveDriverRun(store, current);
      return true;
    });
    if (!marked) return false;
    startDebugCheck(deps, runId, context, { groupId: run.groupId, workdir, base: drive.base!, attemptSha, contract, report, snapshot });
    return true;
  }
  // Protect-acceptance-criteria spec §4.2 / §7a.1: an attempt that modified (not only added to, not weakened) the files
  // defining its checks has its required checks re-run with the base versions of those files, off the driver round and
  // under the same marker as the reproduce-first check. A weakening is flagged whatever the re-run says, so it is not run.
  // A flow run's hidden child is never judged (its checks are the template's; driverLanding.criteriaFlagOf), so not re-run.
  // A multi run's per-directory criteria check and base re-run are skipped here (spec §7.2: the base re-run is never
  // started; the landing's flag says `base-run-skipped: multi-dir`), so drive.criteriaBase stays null.
  if (!measured.empty && multiDirs === null && !isFlowChildGroup(store, run.groupId)) {
    const workdir = join(drive.sourceDir, "repo");
    const change = await classifyCriteriaChange(workdir, drive.base!, attemptSha, contract.verification.requiredChecks, contract.context.setupCommands);
    if (change.kind === "modified") {
      const snapshot = await snapshotWorkspace(workdir, contract.context.setupCommands);
      const marked = write(deps, () => {
        const current = readDriverRun(store, runId);
        if (current.state !== "accepted" || current.drive === undefined) return false;
        current.drive = { ...current.drive, debugRepro: { state: "checking", startedAt: (deps.now?.() ?? new Date()).toISOString(), attemptSha, ...snapshot, empty: false, check: "criteria-base" } };
        saveDriverRun(store, current);
        return true;
      });
      if (!marked) return false;
      startDebugCheck(deps, runId, context, { groupId: run.groupId, workdir, base: drive.base!, attemptSha, contract, report, snapshot, criteriaFiles: change.files });
      return true;
    }
  }
  // No-change completion (2026-11-08, design Correction 2): only a contract that declares its command checks decide the
  // goal, and only an attempt whose Git tree equals its base tree, may complete without a landing (the declaration is no
  // longer required -- follow-up G, below). The proof is measured here from the result repository; a differing tree leaves
  // D14 exactly as it was.
  // Tester follow-up G spec §1.1 / §10.1: the proof is measured for every succeeded empty run, declared or not; stepE
  // decides by route (noChange.ts) whether it completes, asks the goal judge, or keeps D14. A multi run has a proof only
  // when every directory's tree equals its base: the primary's proof in `noChange`, every directory's in `noChangeDirs`.
  let noChange: NonNullable<DriveRecord["noChange"]> | null = null;
  let noChangeDirs: NonNullable<DriveRecord["noChangeDirs"]> | null = null;
  const treeOf = async (repoDir: string, rev: string) => (await git(repoDir, [...QUIET_GIT, "rev-parse", `${rev}^{tree}`])).trim();
  if (measured.empty && multiDirs === null && drive.base !== null) {
    const resultRepo = join(drive.sourceDir, "repo");
    const [baseTree, attemptTree] = [await treeOf(resultRepo, drive.base), await treeOf(resultRepo, attemptSha)];
    if (allDirsUnchanged([{ baseTree, attemptTree }])) {
      noChange = { base: drive.base, attempt: attemptSha, baseTree, attemptTree, contractHash: sha256Canonical(contract), requiredChecks: [...contract.verification.requiredChecks] };
    }
  } else if (measured.empty && multiDirs !== null) {
    const dirs: NonNullable<DriveRecord["noChangeDirs"]> = [];
    for (const [index, dir] of multiDirs.entries()) {
      const resultRepo = index === 0 ? join(drive.sourceDir, "repo") : join(drive.sourceDir, "repos", dir.key);
      dirs.push({ key: dir.key, base: dir.base, attempt: dirAttempts[index]!, baseTree: await treeOf(resultRepo, dir.base), attemptTree: await treeOf(resultRepo, dirAttempts[index]!) });
    }
    if (allDirsUnchanged(dirs)) {
      const primary = dirs[0]!;
      noChange = { base: primary.base, attempt: primary.attempt, baseTree: primary.baseTree, attemptTree: primary.attemptTree, contractHash: sha256Canonical(contract), requiredChecks: [...contract.verification.requiredChecks] };
      noChangeDirs = dirs;
    }
  }
  return write(deps, () => {
    const current = readDriverRun(store, runId);
    if (current.state !== "accepted") return false;
    // Deviation D14: an empty result is not landed; `landedCommit` stays null and the settle step
    // (Task 7) applies D14 and decides E from there.
    current.state = measured.empty ? "landed" : "collected";
    current.drive = {
      ...current.drive!, outcome, attemptSha, landedCommit: null, noChange,
      ...(noChangeDirs === null ? {} : { noChangeDirs }),
      ...(multiDirs === null ? {} : { dirs: multiDirs.map((dir, index) => ({ ...dir, attemptSha: dirAttempts[index]! })) }),
    };
    saveDriverRun(store, current);
    return true;
  });
}

/**
 * Multi-directory projects spec §7.1: the repository whose worktree cleanup acts in -- a multi run's first written
 * directory, which owns the run's workspace and skill snapshot. A run blocked before its prepared write has no
 * `drive.dirs`; its first write in registered order is the directory A2 made first.
 */
function cleanupRepoIdOf(store: ControlStore, run: DriverRun): string {
  const multi = multiDirOf(readGroup(store, run.groupId));
  if (multi === null) return groupRepoId(store, run.groupId);
  const recorded = run.drive?.dirs?.[0]?.key;
  if (recorded !== undefined) return dirTargetRepoId(store, run.groupId, recorded);
  const order = new Map(multi.dirs.map((dir, index) => [dir.key, index] as const));
  const writes = run.taskId === null ? null : taskWrites(store, run.groupId, run.taskId);
  const first = (writes ?? []).slice().sort((left, right) =>
    (order.get(left.dir) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.dir) ?? Number.MAX_SAFE_INTEGER))[0];
  return dirTargetRepoId(store, run.groupId, first?.dir ?? multi.dirs[0]!.key);
}

/** Multi-directory projects spec §7.2: an extra directory's claims are its contract entry's targetPaths ∪ allowlistPaths. */
function extraClaimsOf(contract: unknown, key: string): ClaimedPath[] {
  const context = (contract as { context?: { additionalRepos?: Array<{ key?: string; targetPaths?: unknown; allowlistPaths?: unknown }> } } | null | undefined)?.context;
  const entry = context?.additionalRepos?.find((candidate) => candidate.key === key);
  if (entry === undefined) throw new ControlError("multi-dir-invalid", `contract:${key}`);
  const paths = (value: unknown): string[] => Array.isArray(value) ? value.filter((path): path is string => typeof path === "string") : [];
  return [...paths(entry.targetPaths), ...paths(entry.allowlistPaths)].map(normalizeClaim);
}

function debugChecksOf(context: DriverContext | undefined): Map<string, DebugCheck> {
  return context?.debugChecks ?? unownedDebugChecks;
}

/** Starts the check as a promise the driver does not await; its outcome is kept on the entry for a later round. */
/** Flow engine spec §13.2: a debug group whose frozen correction is repository-only or a bare run, so locating comes first. */
function locateRequired(store: ExecutionDriverDeps["store"], groupId: string): boolean {
  const mark = readDebugMark(readGroup(store, groupId));
  if (mark === null) return false;
  // A frozen input that is gone is not this check's to report: the landing reads it and blocks the run at D by name.
  if (!store.db.prepare("SELECT 1 FROM execution_snapshots WHERE hash=?").get(mark.inputHash)) return false;
  const kind = correctionTargetOf((JSON.parse(readCanonicalRecord(store, mark.inputHash)) as DebugInputV1).correction).kind;
  return kind === "run" || kind === "repository";
}

function startDebugCheck(deps: ExecutionDriverDeps, runId: string, context: DriverContext | undefined, input: {
  groupId: string; workdir: string; base: string; attemptSha: string; contract: ReturnType<typeof readConfirmedTaskExecution>["contract"]; report: ExecutionReport; snapshot: WorkspaceSnapshot;
  /** Set for the criteria base-version re-run (the changed check-defining files); absent for the reproduce-first check. */
  criteriaFiles?: readonly string[];
}): void {
  // Fix round 2: a round still running when stop() was called (parked at an await in stepC or in the resume branch) starts
  // no check that stop() could no longer abort. The marker is already persisted, so the next driver restores and checks.
  if (context?.stopped) return;
  const entry: DebugCheck = { controller: new AbortController(), settled: null };
  debugChecksOf(context).set(runId, entry);
  // Review I1: the commands are the agent's; they run as this run, with the panel's empty person directory.
  const as = { runId, ...(deps.dispatchedPersonDir === undefined ? {} : { personDir: deps.dispatchedPersonDir }) };
  if (input.criteriaFiles !== undefined) {
    void runChecksAtBase({
      workdir: input.workdir, base: input.base, attemptSha: input.attemptSha, files: input.criteriaFiles, requiredChecks: input.contract.verification.requiredChecks,
      timeoutMs: input.contract.executionPolicy.perAttemptTimeoutMs, snapshot: input.snapshot, signal: entry.controller.signal, as,
      ...(input.contract.context.setupCommands === undefined ? {} : { setupCommands: input.contract.context.setupCommands }),
    }).then((verdict) => { entry.settled = { verdict }; }, (error: unknown) => { entry.settled = { error }; });
    return;
  }
  const reported = reportedDebugOf(input.report);
  void (deps.checkReproduction ?? checkReproduction)({
    workdir: input.workdir, base: input.base, attemptSha: input.attemptSha, contract: input.contract, timeoutMs: input.contract.executionPolicy.perAttemptTimeoutMs,
    result: reported.kind === "object" ? reported.value : {}, resultMalformed: reported.kind === "malformed", snapshot: input.snapshot, signal: entry.controller.signal, as,
    ...(locateRequired(deps.store, input.groupId) ? { requireLocated: true } : {}),
    ...(input.contract.context.setupCommands === undefined ? {} : { setupCommands: input.contract.context.setupCommands }),
  }).then((verdict) => { entry.settled = { verdict }; }, (error: unknown) => { entry.settled = { error }; });
}

/**
 * A debug run whose check started. With no check in flight here (a restart, a crash, another driver), the workspace is
 * restored to the marker first and the check is run again; while it runs nothing moves. A failed check fails the attempt
 * like a failed verification (isTerminallyFailedRun: blocked at C with an outcome other than `succeeded`); a check that
 * threw is blocked by the round with its error and keeps the marker, so a retry restores and checks again.
 */
async function stepDebugCheck(deps: ExecutionDriverDeps, run: DriverRun, context: DriverContext | undefined): Promise<boolean> {
  const { store } = deps;
  const runId = run.runId, drive = run.drive!, marker = drive.debugRepro;
  if (marker?.state !== "checking") return false;
  const checks = debugChecksOf(context);
  const entry = checks.get(runId);
  if (entry === undefined) {
    const workdir = join(drive.sourceDir, "repo");
    const restoreFailure = await restoreWorkspace(workdir, marker.attemptSha, marker);
    if (restoreFailure !== null) throw restoreFailure;
    const contract = readConfirmedTaskExecution(store, run.groupId, run.taskId!).contract;
    // The criteria re-run recomputes its files from git (the marker keeps only what the restore needs).
    const criteriaFiles = marker.check === "criteria-base"
      ? (await classifyCriteriaChange(workdir, drive.base!, marker.attemptSha, contract.verification.requiredChecks, contract.context.setupCommands)).files : undefined;
    startDebugCheck(deps, runId, context, {
      groupId: run.groupId, workdir, base: drive.base!, attemptSha: marker.attemptSha, contract, report: await savedReport(store, runId), snapshot: marker,
      ...(criteriaFiles === undefined ? {} : { criteriaFiles }),
    });
    return true;
  }
  if (entry.settled === null) return false;
  checks.delete(runId);
  if ("error" in entry.settled) throw entry.settled.error;
  const verdict = entry.settled.verdict;
  if (verdict.kind === "base-passed" || verdict.kind === "base-failed" || verdict.kind === "base-setup-failed") {
    // Spec §4.2: the verdict rides on the drive record to the landing, which decides the flag (driverLanding.ts).
    return write(deps, () => {
      const current = readDriverRun(store, runId);
      if (current.state !== "accepted" || current.drive?.debugRepro?.state !== "checking") return false;
      current.state = "collected";
      current.drive = {
        ...current.drive, outcome: "succeeded", attemptSha: marker.attemptSha, landedCommit: null, debugRepro: null,
        // Task setup spec §4.6: a setup that failed is the base run's could-not-run, named as `setup: <cmd>` in the same text.
        criteriaBase: verdict.kind === "base-passed" ? { result: "passed" }
          : { result: "failed", command: verdict.kind === "base-setup-failed" ? `setup: ${verdict.command}` : verdict.command },
      };
      saveDriverRun(store, current);
      return true;
    });
  }
  if (verdict.kind === "failed") {
    blockRun(deps, runId, "C", `debug-repro:${verdict.reason}`, { outcome: "repro-failed", attemptSha: marker.attemptSha, debugRepro: null });
    return true;
  }
  return write(deps, () => {
    const current = readDriverRun(store, runId);
    if (current.state !== "accepted" || current.drive?.debugRepro?.state !== "checking") return false;
    // Deviation D14, as in stepC: an empty result is not landed.
    current.state = marker.empty ? "landed" : "collected";
    current.drive = {
      ...current.drive, outcome: "succeeded", attemptSha: marker.attemptSha, landedCommit: null,
      debugRepro: verdict.kind === "skipped" ? { state: "skipped", reason: verdict.reason } : null,
    };
    saveDriverRun(store, current);
    return true;
  });
}

/**
 * A2 of a single call (N1 spec §5.1; single-call estimate spec §6.2): a private source directory, and the prompt and
 * response schema the purpose builds, in a protocol-3 single-call envelope. No workspace and no branch. Everything is
 * redone while `prepared` is false, as for a work run.
 * N1 spec §5.1: written once for every purpose; the purpose's handler builds, classifies and completes.
 */
export async function stepA2SingleCall(deps: ExecutionDriverDeps, runId: string): Promise<boolean> {
  const { store } = deps;
  const run = readDriverRun(store, runId);
  const purpose = singleCallPurposeOf(run);
  if (purpose === null || run.state !== "start-pending" || run.drive === undefined || run.drive.prepared) return false;
  const prepared = await singleCallHandler(purpose).prepare(deps, run);
  if ("blocked" in prepared) { blockRun(deps, runId, "A2", prepared.blocked); return true; }
  privateDirectory(run.drive.sourceDir);
  const envelope = toSingleCallEnvelope(readSingleCallClaimEnvelope(store, run.groupId, runId), run, { sourceDir: run.drive.sourceDir, ...prepared });
  const envelopeHash = sha256Canonical(envelope);
  return write(deps, () => {
    writeCanonicalRecord(store, run.groupId, envelopeHash, canonicalBytes(envelope).toString("utf8"));
    const current = readDriverRun(store, runId);
    if (current.state !== "start-pending" || current.drive === undefined || current.drive.prepared) return false;
    current.drive = { ...current.drive, envelopeHash, prepared: true };
    saveDriverRun(store, current);
    return true;
  });
}
/** DR2: the estimate plan's name for the same step; existing criteria call it. */
export const stepA2Estimate = stepA2SingleCall;

/** ccloop's record of one single call (contract: `ccloop-single-call-record-v1`). */
const singleCallRecordSchema = z.object({
  schema: z.literal("ccloop-single-call-record-v1"),
  promptSha256: z.string().regex(/^[a-f0-9]{64}$/),
  responseSchemaSha256: z.string().regex(/^[a-f0-9]{64}$/),
  outcome: z.enum(["complete", "aborted", "failed"]),
  outputRef: z.object({ artifactId: z.string().min(1), hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().nullable(),
  errorCode: z.string().min(1).nullable(),
  // Spec 2026-10-27 single-call unknown usage §5 C2/O1: what ccloop observed of a call that did not complete (never usage).
  usageLowerBound: singleCallUsageLowerBoundSchema.optional(),
  // Spec 2026-11-06 quota probe §4 step 1 (R0): ccloop's typed cause of a call that did not complete -- `cause` a bounded
  // string as runFailureCauseSchema's (a cause a newer ccloop adds is no wire break), `detail` ccloop's causeDetail head.
  failureCause: z.object({ cause: z.string().min(1).max(64), detail: z.string().max(FAILURE_DETAIL_MAX).nullable() }).strict().optional(),
}).strict();

/**
 * Spec 2026-10-15 ccloop error codes §4.5: the record's errorCode as Orca stores it -- the part before the first `:`
 * (ccloop prints `omp-single-call-stop:<reason>`) when it is a code, else `unknown`; null stays null.
 */
export function normalizeSingleCallErrorCode(errorCode: string | null): string | null {
  if (errorCode === null) return null;
  const head = errorCode.split(":", 1)[0]!;
  return /^[a-z][a-z0-9-]{0,63}$/.test(head) ? head : "unknown";
}

/**
 * C of an estimate run (single-call estimate spec §6.3): collect as C does; once the stop is proved, check that the
 * call ccloop made is the one Orca sent (the prompt's hash against the stored envelope, controller ruling F10), then
 * settle the estimate and the run in one transaction. A call with no observed usage (aborted or failed) cannot settle
 * (run-stop-unconfirmed) and is blocked by name instead of retried every round. A stop that arrived while this step
 * was collecting wins (drafter finding F6): the settlement yields and step H closes the run next round.
 * N1 spec §5.1: written once for every purpose; the purpose's handler builds, classifies and completes.
 */
export async function stepCSingleCall(deps: ExecutionDriverDeps, runId: string): Promise<boolean> {
  const { store } = deps;
  const run = readDriverRun(store, runId);
  const purpose = singleCallPurposeOf(run);
  if (purpose === null || run.state !== "accepted" || run.drive === undefined) return false;
  const report = await collectInto(deps, run);
  const candidate = report.candidate;
  if (!candidate?.stopProof) return report.events.length > 0;
  const envelope = readStartEnvelope(store, run);
  // Final review (2026-09-28): a call record that is not ccloop's single-call record, or a stored envelope that is not a
  // single call, cannot be settled by any later round either -- block it by name instead of throwing every round.
  let recordJson: unknown;
  try { recordJson = JSON.parse((await readArtifact(store, candidate.handoff)).toString("utf8")); } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  const parsedRecord = singleCallRecordSchema.safeParse(recordJson);
  if (envelope.work.kind !== "single-call" || !parsedRecord.success) {
    blockRun(deps, runId, "C", "single-call-record-invalid");
    return true;
  }
  const record = parsedRecord.data;
  // Controller ruling F10 (2026-09-28): only the prompt is compared. It is one string, byte-exact on both sides; the
  // schema's hash depends on key order, which ccloop re-sorts (localeCompare) when it stores the envelope, and a
  // tampered schema cannot slip an invalid answer past classifyEstimateOutput's zod check anyway.
  if (record.promptSha256 !== createHash("sha256").update(envelope.work.prompt, "utf8").digest("hex")) {
    blockRun(deps, runId, "C", "single-call-prompt-mismatch");
    return true;
  }
  let rawOutput: unknown = null;
  if (record.outcome === "complete" && record.outputRef !== null) {
    const text = (await readArtifact(store, record.outputRef)).toString("utf8");
    try { rawOutput = JSON.parse(text); } catch { rawOutput = text; }
  }
  const handler = singleCallHandler(purpose);
  // N1 spec §8.3: a purpose that must read the target repository to judge its output does so before the transaction.
  // §4.5: "the call failed" means outcome !== complete; the handler is told ccloop's (normalised) code, rawOutput is unchanged.
  const failure = record.outcome === "complete" ? null : normalizeSingleCallErrorCode(record.errorCode);
  // Issue #125: `complete` is given the same facts, so a failed requirement call can keep ccloop's failure detail.
  const facts = { outcome: record.outcome, failureCause: record.failureCause ?? null };
  const settled = handler.evaluate === undefined ? rawOutput : await handler.evaluate(deps, run, rawOutput, failure, facts);
  try {
    // Spec 2026-10-27 single-call unknown usage §9 R2: one commit, shared with a person's usage settlement.
    handler.complete({ store, admissionGate: deps.admissionGate }, run, settled, singleCallCommitTerminal(store, run), failure, facts);
  } catch (error) {
    if (error instanceof ControlError && error.code === "run-stop-unconfirmed") {
      const reason = failure === null ? handler.usageUnknownReason : `${handler.usageUnknownReason}:${failure}`;
      // Spec 2026-11-03 soft-mode approximate usage §2: a group with no token limit books the floor and goes on; the
      // purpose then completes with the answer and failure it was given, as a call with known usage does.
      // Review (session 43913afc) m2: verifyStoppedSingleCall also says run-stop-unconfirmed for a ledger that does not
      // match; only a run whose usage is in fact unknown takes the approximate path, the rest are blocked by name as before.
      const current = readRun(store, runId);
      // Quota probe spec 2026-11-06 (controller decision, session 86352010): a purpose may know from its record that the
      // provider refused the call before any work (a probe's typed `quota`), and book its usage 0 -- as ccloop books a
      // codex 429 before work -- then complete as a call with known usage does. Any other unknown usage is unchanged.
      if (handler.completeInTransaction !== undefined && handler.rejectedBeforeWork?.(settled) === true && current.unknown.work && !current.unknown.handoff) {
        write(deps, () => {
          bookRejectedZeroInTransaction(store, runId);
          handler.completeInTransaction!(store, readRun(store, runId) as never, settled, singleCallCommitTerminal(store, run), failure, facts);
        });
        return true;
      }
      if (handler.completeInTransaction !== undefined && (current.unknown.work || current.unknown.handoff) && approximateUsageApplies(store, run)) {
        const at = (deps.now?.() ?? new Date()).getTime();
        write(deps, () => {
          bookApproximateFloorInTransaction(store, runId, { floorTokens: record.usageLowerBound?.tokens ?? null, reason, at });
          handler.completeInTransaction!(store, readRun(store, runId) as never, settled, singleCallCommitTerminal(store, run), failure, facts);
        });
        return true;
      }
      // Same spec O1, R4: ccloop's lower bound stays on the blocked run for the view and the settlement marker.
      const bound = record.usageLowerBound === undefined ? {} : { singleCallUsageLowerBound: record.usageLowerBound };
      // Quota probe spec 2026-11-06 §2 Outcome: a purpose may keep what its record told, though the usage is unknown.
      const kept = handler.blockedRunFields?.(settled, (deps.now?.() ?? new Date()).getTime()) ?? { run: {}, drive: {} };
      blockRun(deps, runId, "C", reason, kept.drive, { ...bound, ...kept.run });
      return true;
    }
    if (error instanceof ControlError && error.code === "handoff-request-conflict" && error.detail === "estimate-yields-to-handoff") return false;
    if (error instanceof ControlError && error.code === "start-state-conflict" && error.detail === "estimate-run-moved") return false;
    throw error;
  }
  return true;
}
/** DR2: the estimate plan's name for the same step; existing criteria call it. */
export const stepCEstimate = stepCSingleCall;

/** Issues #153/#127: the blocked reason a D14 settle records on its run (no landing, so no acceptance, so the task is blocked). */
export const EMPTY_RESULT_REASON = "empty-result";

export async function savedReport(store: ControlStore, runId: string): Promise<ExecutionReport> {
  const row = store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='report'").get(`report:${runId}`);
  if (!row) throw new ControlError("control-terminal-pending");
  return JSON.parse((await readArtifact(store, JSON.parse(String(row.body)).source)).toString()) as ExecutionReport;
}

/**
 * E (spec §2.2): acceptance first -- `commitCandidate` marks the work done only when acceptance already
 * exists (checkpoints.ts) -- then the checkpoint, then publication, then cleanup. A run that settled
 * before it was cleaned (a death in between) is visited again for whatever is left (D15).
 *
 * Fix round 1 (2026-09-25, review Important 1/2): publication and cleanup are retried independently of
 * each other, every round, for as long as either is outstanding. A publish failure is recorded in its
 * own `publishError` (never `cleanupError`, and never cleared by a successful cleanup); cleanup still
 * runs regardless of whether publication succeeded, and is not gated on it.
 */
export async function stepE(deps: ExecutionDriverDeps, runId: string): Promise<boolean> {
  const { store } = deps;
  const run = readDriverRun(store, runId);
  if (run.drive === undefined) return false;
  const drive = run.drive;
  let settledJustNow = false;
  // Issue #192: a settle that took minutes left the chain stalled with no line saying where. Marks are taken after each
  // await; one line is written when the settle is at least `settleSlowMs` (default 5 s, 0 for the tests).
  const settleStarted = Date.now();
  const settleMarks: Array<[string, number]> = [];
  const mark = (label: string): void => { settleMarks.push([label, Date.now()]); };
  const reportSlowSettle = (): void => {
    const total = Date.now() - settleStarted;
    if (total < (deps.settleSlowMs ?? 5_000)) return;
    const parts = settleMarks.map(([label, at], index) => `${label} ${at - (index === 0 ? settleStarted : settleMarks[index - 1]![1])}`);
    process.stderr.write(`orca-driver: ${runId}: settle took ${total} ms (${parts.join(", ")})\n`);
  };
  if (run.state === "landed") {
    const report = await savedReport(store, runId);
    const raw = report.candidate;
    if (raw === null || report.terminal === null) throw new ControlError("control-terminal-pending");
    // Control run decisions plan Task 7: an empty result's decisions go onto the group branch in a ledger-only commit.
    // A multi run that landed only non-primary directories has no `landedCommit` but is not an empty result.
    const landed = landedAnywhere(drive);
    // No-change completion (2026-11-08): the C proof is used only when it names this run's attempt; anything else keeps
    // D14's empty-result block. `acceptanceEvidence` re-checks the same binding before it counts the task done.
    const proved = !landed && drive.noChange !== null && drive.noChange.attempt === drive.attemptSha ? drive.noChange : null;
    // Tester follow-up G spec §1.1 / §10.1: a bound proof completes the task directly only on the `complete` route (an
    // agent verifier approved the goal, or the contract declares its command checks decide it); `judge` and `none` keep
    // D14 here (the judge's call is claimed below once the run is settled, Task 5).
    const taskContract = proved === null ? null : readConfirmedTaskExecution(store, run.groupId, run.taskId!).contract;
    // A flow run's hidden child keeps D14: its flow port reads the blocked empty result itself (flow spec §9.6, an
    // effect step that changes no file); it is never auto-completed or judged.
    const route = proved === null || isFlowChildGroup(store, run.groupId) ? "none" : noChangeRouteOf(taskContract!, readGroup(store, run.groupId));
    const noChange = route === "complete" ? proved : null;
    const noChangeDecidedBy = taskContract?.verification.verifierType === "agent" ? "agent-verifier" as const : "command-checks" as const;
    if (!landed && drive.ledgerCommit === null) {
      const recorded = await recordEmptyResultDecisions(deps, runId);
      if (recorded !== "settle") return recorded === "blocked";
    }
    const archive = await archiveRun(store, { runId, sourceDir: drive.sourceDir, repoDir: join(drive.sourceDir, "repo"), stopProof: raw.stopProof }, archiveAdmission(deps));
    mark("archive");
    if (landed || noChange !== null) {
      // Same evidence shape `confirmLanding` writes (schedulerBridge.ts). checksPassed: ccloop's verifier
      // ran the contract's requiredChecks in this run and it ended `succeeded`.
      const source = await writeArtifact(store, `acceptance-${runId}`, Buffer.from(JSON.stringify(landed
        ? { runId, checksPassed: true, landing: "landed", commit: drive.landedCommit, ...(drive.landedDirs === null ? {} : { dirs: drive.landedDirs }), ...(raw.verificationOnly===true?{verificationOnly:true as const}:{}), intent: `drive:${runId}` }
        : { runId, checksPassed: true, landing: "no-change", commit: noChange!.attempt, noChange: noChange!, decidedBy: noChangeDecidedBy, ...(raw.verificationOnly===true?{verificationOnly:true as const}:{}), intent: `drive:${runId}` })), archiveAdmission(deps));
      write(deps, () => store.db.prepare("INSERT INTO outbox VALUES (?, 'acceptance', ?, 1) ON CONFLICT(id) DO NOTHING").run(`acceptance:${runId}`, JSON.stringify({ runId, accepted: true, source })));
    }
    deps.crash?.("E-after-acceptance");
    mark("acceptance");
    const record = readRun(store, runId);
    const missing = [...archive.missing, ...raw.missing];
    const candidate: Candidate = {
      groupId: record.groupId, workItemId: record.workItemId, taskId: record.taskId, runId, generation: record.generation,
      graphVersion: record.graphVersion, targetVersion: record.targetVersion, checkpointId: `settle-${runId}`, usageHighWater: raw.usageHighWater,
      result: missing.length === 0 && raw.result === "complete" ? "complete" : "partial",
      artifacts: [...archive.artifacts, ...raw.artifacts, raw.handoff], snapshot: archive.snapshot, missing,
      unresolvedRequestIds: raw.unresolvedRequestIds, stopProof: raw.stopProof, terminalOutcome: report.terminal.outcome, handoff: raw.handoff,
      ...(raw.verificationOnly===true?{verificationOnly:true as const}:{}),
    };
    candidate.checkpointId = `settle-${runId}-${hashPayload(candidate).slice(0, 16)}`;
    // Spec §1.2: the no-change record is written in the settle's own transaction, once the task is done.
    const explanation = noChange === null ? null : await noChangeExplanationOf(store, runId);
    // §10.1: on the judge route the goal judge is claimed in the same transaction (or the run names why not).
    await commitCandidate(store, candidate, { ...archiveAdmission(deps), ...(noChange !== null ? { onSettled: (tx: ControlStore, settledCandidate: Candidate) => {
      if ((readWork(tx, settledCandidate.groupId, settledCandidate.workItemId) as { status: string }).status !== "done") return;
      recordNoChangeCompletionInTransaction(tx, { groupId: settledCandidate.groupId, taskId: settledCandidate.workItemId, runId, decidedBy: noChangeDecidedBy, explanation });
    } } : route === "judge" ? { onSettled: (tx: ControlStore, settledCandidate: Candidate) => {
      routeNoChangeJudgeInTransaction(tx, { groupId: settledCandidate.groupId, taskId: settledCandidate.workItemId, runId, at: (deps.now?.() ?? new Date()).getTime() });
    } } : {}) });
    mark("commit");
    reportSlowSettle();
    if (readDriverRun(store, runId).state !== "settled") { blockRun(deps, runId, "E", "settle-incomplete"); return true; }
    // Issues #153/#127: D14 left the task blocked (an empty or ledger-only result has no acceptance); the reason is
    // recorded so the board card and the overview say why. The run stays `settled`; this is not a driver block.
    if (!landed && noChange === null) write(deps, () => {
      const current = readDriverRun(store, runId);
      if (current.state !== "settled" || current.drive === undefined || current.drive.blockedReason !== null) return;
      // Tester follow-up G §10.1: a run the goal judge is deciding is not an empty result.
      if (current.drive.noChangeJudge !== undefined) return;
      current.drive = { ...current.drive, blockedReason: EMPTY_RESULT_REASON };
      saveDriverRun(store, current);
    });
    settledJustNow = true;
  }
  const settled = readDriverRun(store, runId);
  if (settled.state !== "settled" || settled.drive === undefined) return settledJustNow;
  if (!deps.admissionGate?.draining) {
    try {
      await publishPending(store, archiveAdmission(deps));
      write(deps, () => {
        const current = readDriverRun(store, runId);
        if (current.state === "settled" && current.drive !== undefined && current.drive.publishError !== null) {
          current.drive = { ...current.drive, publishError: null };
          saveDriverRun(store, current);
        }
      });
    } catch (error) {
      // A draining panel ends the round the same way every other step does; only a real publish
      // fault (IO, a schema drift in the candidate's handoff, ...) is recorded here.
      if (error instanceof ControlError && error.code === "panel-draining") throw error;
      write(deps, () => {
        const current = readDriverRun(store, runId);
        if (current.state === "settled" && current.drive !== undefined) {
          current.drive = { ...current.drive, publishError: describeError(error) };
          saveDriverRun(store, current);
        }
      });
    }
  }
  const afterPublish = readDriverRun(store, runId);
  if (afterPublish.state !== "settled" || afterPublish.drive === undefined || afterPublish.drive.cleanedUp) return settledJustNow;
  await cleanupRunWorkspace(deps.resolveRepository(cleanupRepoIdOf(store, afterPublish)), deps.roots, runId, workspaceOf(afterPublish.drive));
  for (const dir of afterPublish.drive.dirs?.slice(1) ?? []) await cleanupExtraWorkspace(dir.targetRepo, deps.roots, runId, dir.key);
  write(deps, () => {
    const current = readDriverRun(store, runId);
    current.drive = { ...current.drive!, cleanedUp: true, cleanupError: null };
    saveDriverRun(store, current);
  });
  return true;
}

/**
 * Issue fixes spec §4.2(2): a run retry-task settled as failed keeps its evidence and loses its workspace. Its saved
 * terminal report is the stop proof (stepC wrote it before blocking). Like stepE's cleanup it never blocks: a failure is
 * recorded in `cleanupError` by the round and retried next round, and the task's new run has its own workspace.
 */
export async function stepCleanupFailed(deps: ExecutionDriverDeps, runId: string): Promise<boolean> {
  const { store } = deps;
  const run = readDriverRun(store, runId);
  if (run.state !== "settled-failed" || run.drive === undefined || run.drive.cleanedUp) return false;
  const drive = run.drive;
  const report = await savedReport(store, runId);
  await archiveRun(store, { runId, sourceDir: drive.sourceDir, repoDir: join(drive.sourceDir, "repo"), stopProof: report.candidate?.stopProof ?? null }, archiveAdmission(deps));
  await cleanupRunWorkspace(deps.resolveRepository(cleanupRepoIdOf(store, run)), deps.roots, runId, workspaceOf(drive));
  for (const dir of drive.dirs?.slice(1) ?? []) await cleanupExtraWorkspace(dir.targetRepo, deps.roots, runId, dir.key);
  write(deps, () => {
    const current = readDriverRun(store, runId);
    if (current.state !== "settled-failed" || current.drive === undefined) return;
    current.drive = { ...current.drive, cleanedUp: true, cleanupError: null };
    saveDriverRun(store, current);
  });
  return true;
}

/** Group states the driver re-arms dispatch for; `commitCandidate` moves a group to `review` (checkpoints.ts). */
export const DISPATCHABLE_GROUP_STATES = new Set(["ready", "running", "review"]);

/**
 * CR1 (spec §2.1): a start wake claims one task, and nothing else ever arms another. For each started,
 * dispatchable group with ready work and no wake pending, arm one `start` wake under the group's last
 * start revision; the pump claims one task per wake, so parallelism grows by one per round. A group
 * nobody started has no start wake to copy and gets nothing.
 *
 * Review-exit spec 2026-11-05 §3.1 (D1, controller decision): a group executing already (a run, a busy task or a pending
 * wake) adds no slot by arming another claim. One that executes nothing -- it regained work by a retry, a continue, a
 * resume -- takes a slot: it is armed only while fewer than the cap execute, debug groups first (the auto-start pass's
 * order), flow children exempt. Otherwise the cap the explicit start keeps would be passed through this door (#129).
 */
export function replenishStartWakes(deps: Pick<ExecutionDriverDeps, "store" | "admissionGate">): string[] {
  const { store } = deps;
  if (store.dispatchBlocked) return [];
  const failed: string[] = [];
  const armedIds = write(deps, () => {
    const armed: string[] = [];
    const executing = (groupId: string) => groupExecutionPendingInStore(store, groupId) || store.db.prepare("SELECT 1 FROM runs WHERE group_id=? AND active=1").get(groupId) !== undefined;
    let slotsTaken = runningGroupIds(store).filter(executing).length;
    const cap = readOrchestrationSettings(store).maxRunningGroups;
    // Each body is parsed once here (archivedWakePerformance's bound); a body that does not parse fails in its own savepoint.
    const rows = store.db.prepare("SELECT id,body FROM groups ORDER BY id").all().map((row, index) => {
      let parsed: { ok: true; body: unknown } | { ok: false; error: unknown };
      try { parsed = { ok: true, body: JSON.parse(String(row.body)) }; } catch (error) { parsed = { ok: false, error }; }
      return { groupId: String(row.id), parsed, index, admission: parsed.ok ? admissionOf(parsed.body) : { rank: 1, flowChild: false } };
    }).sort((a, b) => a.admission.rank - b.admission.rank || a.index - b.index);
    for (const { groupId, parsed, admission } of rows) {
      // Backlog #3 (Orca handoff §9.0 挂账): a group whose wake cannot be armed -- a row that does not parse, a query
      // that throws -- is skipped and named on stderr below, like every failure the driver cannot pin on a run. It no
      // longer takes every other group's wake, and the whole round, down with it. Each group writes at most one row,
      // last, so a group that failed wrote nothing.
      // Plan B final review (2026-09-29): each group runs under its own savepoint. A failure SQLite pins on the
      // statement is undone to it and stays this group's; one that takes the whole transaction down (SQLITE_FULL,
      // IOERR, NOMEM) leaves no savepoint to return to, and is rethrown so the round fails with its real cause.
      let open = true;
      store.db.exec("SAVEPOINT replenish_group");
      try {
        if (!parsed.ok) throw parsed.error;
        const group = parsed.body as { planHash?: string; status: string; stopped: boolean };
        if (group.planHash === undefined || group.stopped || !DISPATCHABLE_GROUP_STATES.has(group.status)) continue;
        if (store.db.prepare("SELECT group_id FROM stop_intents WHERE group_id=?").get(groupId)) continue;
        if (store.db.prepare("SELECT id FROM recovery_blockers WHERE group_id=? AND scope='group'").get(groupId)) continue;
        if (store.db.prepare("SELECT id FROM scheduler_wakes WHERE group_id=? AND kind IN ('start','no-start','resume') AND delivered=0").get(groupId)) continue;
        const last = store.db.prepare("SELECT body FROM scheduler_wakes WHERE group_id=? AND kind='start' ORDER BY rowid DESC LIMIT 1").get(groupId);
        if (!last || nextClaimableTask(store, groupId, group) === null) continue;
        const takesSlot = !admission.flowChild && !executing(groupId);
        if (takesSlot && slotsTaken >= cap) continue;
        const body = JSON.parse(String(last.body)) as { startRevision: number; executionSnapshotHash?: string };
        const ordinal = Number(store.db.prepare("SELECT COUNT(*) AS n FROM scheduler_wakes WHERE group_id=? AND id LIKE ?").get(groupId, `drive:${groupId}:%`)!.n) + 1;
        const wakeId = `drive:${groupId}:${ordinal}`;
        store.db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES (?,?,'start',?,0)").run(wakeId, groupId, canonicalBytes({
          groupId, startRevision: body.startRevision, ...(body.executionSnapshotHash === undefined ? {} : { executionSnapshotHash: body.executionSnapshotHash }),
        }).toString("utf8"));
        armed.push(wakeId);
        if (takesSlot) slotsTaken += 1;
      } catch (error) {
        open = false;
        try { store.db.exec("ROLLBACK TO replenish_group"); store.db.exec("RELEASE replenish_group"); } catch { throw error; }
        failed.push(`${groupId}: ${describeError(error)}`);
      } finally {
        if (open) store.db.exec("RELEASE replenish_group");
      }
    }
    return armed;
  });
  for (const line of failed) process.stderr.write(`orca-driver: group ${line}\n`);
  return armedIds;
}

const DRIVEN = new Set(["starting", "start-pending", "accepted", "unknown", "collected", "landed", "reconciling"]);

/**
 * spec §2.1: every Web work run the driver can still move, by runId; plus a settled run that is not
 * yet cleaned or not yet published (deviation D15, extended by fix round 1's independent publish
 * retry -- a settled, cleaned run whose last publish attempt failed stays in scope until one succeeds).
 */
export function driverRunIds(store: ControlStore): string[] {
  const ids: string[] = [];
  for (const row of store.db.prepare("SELECT id,body FROM runs ORDER BY id").all()) {
    const runId = String(row.id);
    const run = JSON.parse(String(row.body)) as DriverRun;
    // Single-call estimate spec §6.1, N1 spec §5.1: a single-call run the Web ledger claimed is the driver's too.
    const ours = (run.phase === "work" && isWebWorkRun(store, runId)) || isSingleCallRun(store, runId);
    if (!ours) continue;
    if (DRIVEN.has(run.state) || (run.state === "settled" && run.drive !== undefined && (!run.drive.cleanedUp || run.drive.publishError !== null))
      // Issue fixes spec §4.2(2): a settled-failed run until its evidence is archived and its workspace removed.
      || (run.state === "settled-failed" && run.drive !== undefined && !run.drive.cleanedUp)
      // Reviewed acceptance (spec 2026-11-11 §7): a settled-failed run whose owner's acceptance is still to be carried out.
      || (run.state === "settled-failed" && run.drive !== undefined && acceptPending(run))) ids.push(runId);
  }
  return ids;
}

/** How a blocked run's reason records a later error: the reason it was blocked for, then only the newest error. */
export const LATER_ERROR = " | then: ";
function laterError(reason: string | null, error: string): string {
  const original = reason === null ? "" : reason.split(LATER_ERROR)[0]!;
  return original === "" ? error : `${original}${LATER_ERROR}${error}`;
}

/** The step a run is at, for blocking it where it failed. `running` is persisted `accepted` (deviation D3). */
export function stepOf(run: DriverRun): DriveStep {
  switch (run.state) {
    case "starting": return "A1";
    case "start-pending": return run.drive?.prepared ? "B" : "A2";
    case "unknown": return "B'";
    case "accepted": return "C";
    case "collected": return "D";
    case "reconciling": return "R";
    default: return "E";
  }
}

/** One step for one run (spec §2.2 table). Later tasks add D, R and E here. */
export async function advance(deps: ExecutionDriverDeps, runId: string, context: DriverContext): Promise<boolean> {
  const run = readDriverRun(deps.store, runId);
  // N1 spec §5.1: every single call has the same chain, whatever it is for; the work chain below is unchanged.
  if (singleCallPurposeOf(run) !== null) {
    switch (run.state) {
      case "starting": return stepA1(deps, runId);
      case "start-pending": return run.drive?.prepared ? stepB(deps, runId) : stepA2SingleCall(deps, runId);
      case "unknown": return stepBPrime(deps, runId);
      case "accepted": return stepCSingleCall(deps, runId);
      default: return false;
    }
  }
  switch (run.state) {
    case "starting": return stepA1(deps, runId);
    case "start-pending": return run.drive?.prepared ? stepB(deps, runId) : stepA2(deps, runId);
    case "unknown": return stepBPrime(deps, runId);
    case "accepted": return stepC(deps, runId, context);
    case "collected": return stepD(deps, runId, context);
    case "reconciling": return stepR(deps, runId, context);
    case "landed": case "settled": return stepE(deps, runId);
    // Reviewed acceptance (spec 2026-11-11 §7): after the failed run's evidence is archived and its workspace removed.
    case "settled-failed": return run.drive?.cleanedUp === true && acceptPending(run) ? stepAcceptAttempt(deps, runId, context) : stepCleanupFailed(deps, runId);
    default: return false;
  }
}

/**
 * What a pass does with a step that threw (moved out of the pass for the settle lane, #192): a draining panel ends the round
 * ("draining"), a recorded failure that moved the run counts as progress ("progressed"), anything else goes on to the next
 * run ("next"). A DriverCrash is rethrown.
 */
export async function recordStepFailure(deps: ExecutionDriverDeps, context: DriverContext, runId: string, error: unknown): Promise<"next" | "progressed" | "draining"> {
  if (error instanceof DriverCrash) throw error;
  // A draining panel refuses every write; the round ends and no run is blamed for it.
  if (error instanceof ControlError && error.code === "panel-draining") return "draining";
  // Backlog #3 (Orca handoff §9.0 挂账): recording this run's failure can fail too -- a write the store refuses,
  // a row that no longer reads. That second failure is this run's alone: it is named on stderr with both errors,
  // and the round goes on to the next run instead of ending for every group.
  try {
    const run = readDriverRun(deps.store, runId);
    // A settled (or settled-failed) run stays where it is: whatever failed here is the settle step's own cleanup work,
    // never a reason to reopen it as blocked at an earlier step (controller ruling P7,
    // 2026-09-25). Record the failure on the run and leave it for the next round to retry --
    // re-checked inside the write since another write may have landed while this step was
    // in flight (the deferred note from Task 4's review: never write after an await without
    // re-reading state first).
    // Issue fixes spec §4.2(2): a settled-failed run's cleanup failure is recorded the same way.
    if (run.state === "settled" || run.state === "settled-failed") {
      write(deps, () => {
        const current = readDriverRun(deps.store, runId);
        if ((current.state === "settled" || current.state === "settled-failed") && current.drive !== undefined && !current.drive.cleanedUp) {
          current.drive = { ...current.drive, cleanupError: describeError(error) };
          saveDriverRun(deps.store, current);
        }
      });
      process.stderr.write(`orca-driver: ${runId}: ${logError(error)}\n`);
      return "next";
    }
    if (run.drive === undefined) { process.stderr.write(`orca-driver: ${runId}: ${logError(error)}\n`); return "next"; }
    // Final fix wave (FR-C2, controller ruling 2026-09-25): a run that is already blocked stays blocked where it
    // was. `blockedAt` decides which branch closes it under a stop (spec §13.2 I-3) and where a retry resumes it,
    // so a later error on it (a transient collect failure, an H-settle that threw) never moves it -- `stepOf`
    // would name "E" for every blocked run. The original reason is kept as the prefix; the new error follows it.
    if (run.state === "blocked" && run.drive.blockedAt !== null) {
      blockRun(deps, runId, run.drive.blockedAt, laterError(run.drive.blockedReason, describeError(error)));
      process.stderr.write(`orca-driver: ${runId}: blocked at ${run.drive.blockedAt}: ${logError(error)}\n`);
    } else {
      // Tester #229/#230: a landed run whose settle failed transiently stays landed, so a later round runs E again,
      // up to TRANSIENT_E_RETRIES times; the failure after that blocks it as before.
      if (run.state === "landed" && transientSettleError(error)) {
        const retries = context.transientRetries ?? (context.transientRetries = new Map());
        const done = retries.get(runId) ?? 0;
        if (done < TRANSIENT_E_RETRIES) {
          retries.set(runId, done + 1);
          process.stderr.write(`orca-driver: ${runId}: E: ${logError(error)}; transient, retry ${done + 1} of ${TRANSIENT_E_RETRIES}\n`);
          return "next";
        }
        retries.delete(runId);
      }
      // Tester #267: likewise a transient failure at B, B' or C (a collect a sleeping machine timed out): the run stays
      // at its step and the next round asks ccloop again, up to TRANSIENT_START_RETRIES times.
      if ((run.state === "start-pending" || run.state === "unknown" || run.state === "accepted") && transientDriveError(error)) {
        const retries = context.transientRetries ?? (context.transientRetries = new Map());
        const done = retries.get(runId) ?? 0;
        if (done < TRANSIENT_START_RETRIES) {
          retries.set(runId, done + 1);
          process.stderr.write(`orca-driver: ${runId}: ${stepOf(run)}: ${logError(error)}; transient, retry ${done + 1} of ${TRANSIENT_START_RETRIES}\n`);
          return "next";
        }
        retries.delete(runId);
      }
      const step = stepOf(run);
      blockRun(deps, runId, step, describeError(error));
      process.stderr.write(`orca-driver: ${runId}: blocked at ${step}: ${logError(error)}\n`);
    }
    return "progressed";
  } catch (recordError) {
    if (recordError instanceof DriverCrash) throw recordError;
    if (recordError instanceof ControlError && recordError.code === "panel-draining") return "draining";
    process.stderr.write(`orca-driver: ${runId}: ${logError(error)}; recording it failed: ${logError(recordError)}\n`);
    return "next";
  }
}

export function createExecutionDriver(options: ExecutionDriverDeps): ExecutionDriver {
 const taskResults=options.taskResults??createTaskResultCollector({store:options.store,admissionGate:options.admissionGate,resolve(runId){
  const run=readDriverRun(options.store,runId);if(!run.drive?.envelopeHash||!run.executionId)return null;
  return {input:readStartEnvelope(options.store,run),executionId:run.executionId,port:portFor(options,run)};
 }});
 // Preserve the caller's live dependency getters and method owner; only retention is overlaid.
 const deps=new Proxy(options,{get(target,key){
  if(key==='taskResults')return taskResults;
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
  const context: DriverContext = { reconciling: new Map(), stopped: false, debugChecks: new Map(), multiPrechecks: new Map(), postMergeChecks: new Map(), acceptChecks: new Map(), acceptanceChecks: new Map(), transientRetries: new Map(), settles: new Map() };
  let inFlight: Promise<boolean> | null = null;
  let timer: NodeJS.Timeout | null = null;
  let crashed: CrashPoint | null = null;
  const stopTimer = (): void => { if (timer !== null) { clearInterval(timer); timer = null; } };
  const settles = context.settles!;

  /**
   * Tester follow-up G §6.1 (#192): a landed run's step E (archive, checkpoint, publish, cleanup) goes on the settle lane
   * instead of holding the pass, so the next pass claims and advances its dependent meanwhile (the claim reads
   * dependencyReady). One lane per driver: settles never overlap each other. A failure is recorded as the pass records
   * one; a DriverCrash ends the driver as it does in a pass.
   */
  const startSettle = (runId: string): Promise<boolean> => {
    const lane = (context.settleLane ?? Promise.resolve()).then(async (): Promise<boolean> => {
      if (crashed !== null) return false;
      try {
        await deps.beforeSettle?.(runId);
        const moved = await stepE(deps, runId);
        context.transientRetries?.delete(runId);
        return moved;
      } catch (error) {
        try {
          return await recordStepFailure(deps, context, runId, error) === "progressed";
        } catch (fatal) {
          if (fatal instanceof DriverCrash) { crashed = fatal.point; stopTimer(); return false; }
          process.stderr.write(`orca-driver: ${runId}: settle failed: ${logError(fatal)}\n`);
          return false;
        }
      }
    }).finally(() => { settles.delete(runId); });
    context.settleLane = lane;
    settles.set(runId, lane);
    return lane;
  };
  /** A work run's settle with no open request and a landed commit goes on the lane; an empty result's ledger commit stays inline. */
  const settlesOnLane = (run: DriverRun): boolean =>
    singleCallPurposeOf(run) === null && (run.state === "settled" || (run.state === "landed" && landedAnywhere(run.drive)));

  const pass = async (started: Promise<boolean>[]): Promise<boolean> => {
    let progressed = false;
    try {
      if (replenishStartWakes(deps).length > 0) { progressed = true; deps.kickPump?.(); }
    } catch (error) {
      if (error instanceof ControlError && error.code === "panel-draining") return false;
      throw error;
    }
    for (const runId of visitOrder(deps.store)) {
      if (context.stopped) break;
      // #192: a run settling on the lane is the lane's until its step E answered.
      if (settles.has(runId)) continue;
      try {
        const run = readDriverRun(deps.store, runId);
        // Handoff delivery spec §3: a run with an open request goes to H (its settle stays inline); every other run is advanced as before.
        const open = openRequestOf(deps.store, run) !== null;
        if (!open && settlesOnLane(run)) { started.push(startSettle(runId)); continue; }
        const moved = open ? await stepH(deps, runId, context) : await advance(deps, runId, context);
        // Tester #267: a step that answered ends its run of transient failures; only consecutive ones count toward a block.
        context.transientRetries?.delete(runId);
        if (moved) progressed = true;
      } catch (error) {
        const next = await recordStepFailure(deps, context, runId, error);
        if (next === "draining") return progressed;
        if (next === "progressed") progressed = true;
      }
    }
    // Spec 2026-11-06 soft-mode loop run settlement §3.3: after the runs moved (a run just blocked at C is settled in this
    // round), before the claims (the pump's), a loop run of an unlimited group with unknown usage is booked at its floor.
    // Loaded on first use, not imported (the import-cycle rule, as groupDone below).
    try {
      const { softLoopSettlementPass } = await import("./softLoopSettlement.js");
      if (softLoopSettlementPass(deps)) { progressed = true; deps.kickPump?.(); }
    } catch (error) { if (error instanceof ControlError && error.code === "panel-draining") return progressed; throw error; }
    // N1 spec §9.2 (DR14): a requirement's export has git side effects, so it is the driver's, once per round. It runs
    // after the runs: an await before them would let a stop() issued with the round land before the round's first step.
    try { if (await exportPendingRequirements(deps)) progressed = true; }
    catch (error) { if (error instanceof ControlError && error.code === "panel-draining") return progressed; throw error; }
    // Tester follow-up E §5 (#241): a group whose tasks are all done is accepted on its final tip before the integration
    // pass delivers it and the done pass marks it. Loaded on first use, not imported (the import-cycle rule, as groupDone).
    try {
      const { acceptGroups } = await import("./groupAcceptance.js");
      if (await acceptGroups({
        store: deps.store, roots: deps.roots, resolveRepository: deps.resolveRepository, admissionGate: deps.admissionGate,
        ...(deps.dispatchedPersonDir === undefined ? {} : { dispatchedPersonDir: deps.dispatchedPersonDir }),
        write: (action) => write(deps, action), stopped: () => context.stopped,
      }, context.acceptanceChecks ?? (context.acceptanceChecks = new Map()))) progressed = true;
    } catch (error) { if (error instanceof ControlError && error.code === "panel-draining") return progressed; throw error; }
    // Tester follow-up G spec §3: a requirement group accepted on its tip is reviewed against its acceptance criteria before
    // it can be done. Loaded on first use, not imported (the import-cycle rule, as the acceptance pass).
    try {
      const { reviewRequirements } = await import("./requirementReview.js");
      if (await reviewRequirements({ store: deps.store, resolveRepository: deps.resolveRepository, admissionGate: deps.admissionGate, write: (action) => write(deps, action) })) progressed = true;
    } catch (error) { if (error instanceof ControlError && error.code === "panel-draining") return progressed; throw error; }
    // Integration spec §5: the integration pass, once per round after the exports (its git side effects are the driver's).
    try { if (await integratePendingGroups(integrationDepsOf(deps, context))) progressed = true; }
    catch (error) { if (error instanceof ControlError && error.code === "panel-draining") return progressed; throw error; }
    // Multi-directory projects spec §9.1: the multi landing, right after integration (its git side effects are the driver's).
    try {
      if (await landMultiDirGroups({
        store: deps.store, roots: deps.roots, repoPathOf: (repoId) => deps.resolveRepository(repoId),
        personDir: deps.dispatchedPersonDir ?? join(deps.store.stateDir, DISPATCHED_PERSON_DIRNAME),
        admissionGate: deps.admissionGate, env: deps.env, stopped: () => context.stopped, prechecks: context.multiPrechecks ?? new Map(),
        ...(deps.crash === undefined ? {} : { crash: deps.crash }),
      })) progressed = true;
    } catch (error) { if (error instanceof ControlError && error.code === "panel-draining") return progressed; throw error; }
    // Dir-requirements spec §8.5: placement of each dir group's landed work into its folder, right after integration.
    try {
      if (await placeDirGroups({ store: deps.store, admissionGate: deps.admissionGate, env: deps.env, stopped: () => context.stopped, ...(deps.crash === undefined ? {} : { crash: deps.crash }) })) progressed = true;
    } catch (error) { if (error instanceof ControlError && error.code === "panel-draining") return progressed; throw error; }
    // Review-exit spec 2026-11-05 §3.1 (D1): after integration, landing and placement, a group with everything delivered
    // is done -- every round, so it covers every settle path and a group left in review before this existed.
    // Loaded on first use, not imported: groupDone pulls in groupEdges, whose static import into this module's cycle reorders
    // the control modules' evaluation (session 3cfc2e73, d69ec6c5).
    try { const { markGroupsDone } = await import("./groupDone.js"); if (write(deps, () => markGroupsDone(deps.store)).length > 0) progressed = true; }
    catch (error) { if (error instanceof ControlError && error.code === "panel-draining") return progressed; throw error; }
    return progressed;
  };

  const round = (): Promise<boolean> => {
    if (context.stopped || crashed !== null) return Promise.resolve(false);
    if (inFlight !== null) return inFlight;
    const started: Promise<boolean>[] = [];
    const current = pass(started)
      .catch((error: unknown) => {
        if (error instanceof DriverCrash) { crashed = error.point; stopTimer(); return false; }
        if (!context.stopped) process.stderr.write(`orca-driver: round failed: ${logError(error)}\n`);
        return false;
      })
      .finally(() => { inFlight = null; });
    inFlight = current;
    // #192: the pass is what a re-entrant call joins; the caller of this round also waits for the settles it started.
    return current.then(async (progressed) => (await Promise.all(started)).some(Boolean) || progressed);
  };

  const kick = (): void => {
    void round().then((progressed) => { if (progressed && !context.stopped && crashed === null) setImmediate(kick); });
  };

  return {
    round,
    kick,
    start(intervalMs: number): boolean {
      if (timer !== null || context.stopped) return false;
      timer = setInterval(kick, intervalMs);
      timer.unref();
      return true;
    },
    async stop(): Promise<void> {
      context.stopped = true;
      stopTimer();
      // Debug task plan Task 8 (fix round 1, R1): a reproduce-first check is not awaited. Its process group is killed and its
      // persisted marker stays, so the next driver restores the workspace and checks again.
      for (const check of context.debugChecks?.values() ?? []) check.controller.abort();
      // Ruling R2: a post-merge check likewise; nothing moved, so the next driver merges and checks again. One still
      // running is recorded as skipped (stopped) first (#245).
      abortPostMergeChecks(deps, context);
      for (const check of context.acceptChecks?.values() ?? []) check.controller.abort();
      for (const check of context.acceptanceChecks?.values() ?? []) check.controller.abort();
      const stopping=taskResults.stop();
      if (inFlight !== null) await inFlight;
      // #192: a settle on the lane is finished, not cut: its run is written to settled before the store can go away.
      await Promise.all([...settles.values()]);
      // Belt and braces for the guard in startDebugCheck: anything started while the last round finished is aborted too.
      for (const check of context.debugChecks?.values() ?? []) check.controller.abort();
      abortPostMergeChecks(deps, context);
      for (const check of context.acceptChecks?.values() ?? []) check.controller.abort();
      for (const check of context.acceptanceChecks?.values() ?? []) check.controller.abort();
      // Tester follow-up E §5: an aborted group acceptance check is waited for until its scratch worktree is gone, so a
      // restart (or anything removing the state directory) never races its git or its commands. It records nothing.
      await Promise.all([...(context.acceptanceChecks?.values() ?? [])].map((check) => check.done));
      await stopping;
    },
    get crashed() { return crashed; },
    scheduleTaskResults(runId: string): void { taskResults.schedule(runId); },
  };
}

/** A renewable boundary is an atomic known settlement plus a saved ready-work registration. */
async function settleTokenAllowance(deps:ExecutionDriverDeps,runId:string,report:ExecutionReport):Promise<boolean> {
 const {store}=deps,run=readDriverRun(store,runId),raw=report.candidate!;
 // This already-running attempt must settle even if overspend or a pause held the group; held still gates new dispatch.
 if(openRequestOf(store,run)!==null)return false;
 const current=readRun(store,runId);
 if(current.unknown.work||current.unknown.handoff){blockRun(deps,runId,"C","usage-unknown");return true;}
 try{await validateAllowanceCheckpoint(store,raw,readStartEnvelope(store,run));}
 catch(error){blockRun(deps,runId,"C",`allowance-evidence:${describeError(error)}`);return true;}
 const archive=await archiveRun(store,{runId,sourceDir:run.drive!.sourceDir,repoDir:join(run.drive!.sourceDir,"repo"),stopProof:raw.stopProof},archiveAdmission(deps));
 if(archive.missing.length||archive.snapshot===null){blockRun(deps,runId,"C","allowance-snapshot-incomplete");return true;}
 await verifySnapshot(store,archive.snapshot);
 const candidate:Candidate={...raw,checkpointId:`allowance-${runId}`,artifacts:[...archive.artifacts,...raw.artifacts,raw.handoff],snapshot:archive.snapshot};
 await commitCandidate(store,candidate,{...archiveAdmission(deps),onSettled:()=>{
  const settled=readDriverRun(store,runId);
  if(openRequestOf(store,settled)!==null||settled.state!=="settled")throw new ControlError("handoff-request-conflict","allowance-yields-to-handoff");
  const work=allowanceWork(store,run.groupId,run.workItemId) as ReturnType<typeof allowanceWork>&{allowancePredecessorRunId?:string;currentRunId?:string|null};
  if(work.currentRunId!==undefined&&work.currentRunId!==runId)throw new ControlError("work-already-active");
  settled.state="settled-recoverable";settled.drive={...settled.drive!,outcome:report.terminal!.outcome};saveDriverRun(store,settled);
  work.status="ready";work.allowancePredecessorRunId=runId;Object.assign(work,{fundingReleased:true});saveAllowanceWork(store,run.groupId,work);
  const group=allowanceGroup(store,run.groupId);if(!group.stopped&&group.status!=="blocked")group.status="running";saveAllowanceGroup(store,group);
 }});
 return true;
}

/** Dead-owner mechanical RPC cannot execute checks/providers or reclaim the old worker. */
async function settleDeadSavedRecovery(deps:ExecutionDriverDeps,run:DriverRun):Promise<boolean>{
 const port=portFor(deps,run);if(!port.settleSavedResult||!port.readSavedResultSettlement)throw new ControlError("control-saved-result-unsupported");
 const input=readStartEnvelope(deps.store,run);let result;
 try{result=await port.settleSavedResult(input);}catch(error){
  // A live/identity-unproven owner remains unknown. Never invent zero usage or call accept again.
  if(error instanceof ControlError&&error.code==="control-peer-exit")return false;throw error;
 }
 if(result.settlement.identity.runId!==run.runId||result.settlement.identity.envelopeHash!==run.drive?.envelopeHash||run.executionId!==null&&result.settlement.identity.executionId!==run.executionId)throw new ControlError("report-identity-conflict");
 const page=result.settlement,refs=[result.ref,page.state,...(page.lifecycle?[page.lifecycle]:[]),page.accepted,page.envelope,page.usage,page.stopProof,...page.usageObservations.flatMap(a=>[a.source,a.copy])];
 for(const ref of refs){const bytes=await port.readSavedResultSettlement(input,result.ref,ref);await writeArtifact(deps.store,ref.artifactId,bytes,archiveAdmission(deps));}
 write(deps,()=>{const current=readDriverRun(deps.store,run.runId);current.savedSettlement=result.ref;current.executionId=page.identity.executionId;saveDriverRun(deps.store,current);});return true;
}
export async function retainSavedInterruption(deps:Pick<ExecutionDriverDeps,"store"|"admissionGate">,runId:string):Promise<void>{
 const run=readDriverRun(deps.store,runId);if(!run.savedSettlement)return;
 const page=savedResultSettlementSchema.parse(JSON.parse((await readArtifact(deps.store,run.savedSettlement as import("./types.js").ArtifactRef)).toString()));
 if(page.disposition!=="interrupted"||(page.usageStatus!=="known"&&!(run.usageSettlement!==undefined&&hasValidUsageSettlement(deps.store,run)))||page.lifecycle===null||!["saved-result-verification-interrupted","saved-result-before-entry-interrupted"].includes(run.drive?.stopReason??""))return;
 const record=savedRecoverySchema.parse(run.savedRecovery),input=readStartEnvelope(deps.store,run);
 const packageBytes=await readFile(join(input.savedResultRecovery!.packagePath,"package.json"));
 if(createHash("sha256").update(packageBytes).digest("hex")!==input.savedResultRecovery!.packageHash)throw new ControlError("artifact-hash-mismatch");
 write(deps,()=>{
  const current=readDriverRun(deps.store,runId),accounting=savedRecoveryAccounting(deps.store,current);
  const packageRef=persistRecoveryArtifact(deps.store,packageBytes),refs=[page.envelope,page.accepted,packageRef,record.admission,page.state,page.lifecycle!,page.usage,accounting.report,accounting.stopProof,...(accounting.settlement?[accounting.settlement,accounting.receipt!]:[]),...page.usageObservations.flatMap(a=>[a.source,a.copy])];
  const artifacts=[...recoveryClosure(deps.store,[...refs,record.source.source,...record.artifacts]).values()].map(v=>v.ref);
  current.savedInterruption=persistRecoveryArtifact(deps.store,interruptedSavedResultSchema.parse({schema:"ccloop-saved-result-interrupted-v1",envelope:page.envelope,accepted:page.accepted,package:packageRef,admission:record.admission,state:page.state,lifecycle:page.lifecycle,usage:page.usage,accounting,artifacts}));saveDriverRun(deps.store,current);
 });
}

/** Inspection-only input for an authorized claim whose controller has durably never submitted accept. */
export async function savedRecoveryInspectionInput(deps:ExecutionDriverDeps,run:DriverRun):Promise<StartEnvelope>{
 const marker=savedDispatchSchema.parse(run.savedDispatch);if(marker.state!=="never-submitted"||run.executionId!==null)throw new ControlError("recovery-blocked","saved-result-accept-unknown");
 const binding=savedRecoverySchema.parse(run.savedRecovery);if(marker.admissionHash!==binding.admission.hash||marker.fundingHash!==sha256Canonical(binding.funding)||marker.revision!==binding.revision)throw new ControlError("recovery-blocked","saved-result-accept-unknown");
 if(run.drive?.envelopeHash)return readStartEnvelope(deps.store,run);
 const record=savedRecoverySchema.parse(run.savedRecovery),original=JSON.parse((await readArtifact(deps.store,record.sourceEnvelope)).toString()) as StartEnvelope;
 if(original.work.kind!=="loop")throw new ControlError("saved-result-source-stale");
 const drive=run.drive??newDrive(deps.roots,run.runId,readWorkspaceSetting(deps.store,groupRepoId(deps.store,run.groupId)).workspaceMode,true);
 privateDirectory(drive.sourceDir);const targetRepo=deps.resolveRepository(groupRepoId(deps.store,run.groupId)),base=original.work.base;
 if(run.taskId===null)throw new ControlError("recovery-blocked","saved-result-accept-unknown");
 const packageRecord={...materializeRecoveryPackage(deps.store,drive.sourceDir,record),recoveryOf:record.recoveryOf};
 // The rebuilt envelope mirrors A2 (syncskill integration spec §10.6): the frozen contract, and the same skill snapshot
 // a dispatch would name, injected under this run's id -- never the source run's dirs, which are gone.
 const confirmed=readConfirmedTaskExecution(deps.store,run.groupId,run.taskId);
 const runtime={...confirmed.contract,context:{...confirmed.contract.context,repoPath:workspaceOf(drive)},executionPolicy:withinGrant(confirmed.contract.executionPolicy,(run.grant as any).work)};
 const prepared=await skillFilledRuntime(deps,run,targetRepo,runtime,confirmed);
 if("blocked" in prepared)throw new ControlError("recovery-blocked",prepared.blocked);
 const input=toStartEnvelope(readWorkClaimEnvelope(deps.store,run.groupId,run.runId),{...run,savedResultRecovery:packageRecord},{sourceDir:drive.sourceDir,targetRepo,base,...skillEnvelopeKey(prepared.kind,prepared.skills)},prepared.runtime,null),envelopeHash=sha256Canonical(input);
 write(deps,()=>{const current=readDriverRun(deps.store,run.runId),still=savedDispatchSchema.parse(current.savedDispatch);if(still.state!=="never-submitted"||still.admissionHash!==record.admission.hash)throw new ControlError("saved-result-source-stale");writeCanonicalRecord(deps.store,run.groupId,envelopeHash,canonicalBytes(input).toString());current.drive={...drive,targetRepo,base,envelopeHash,skills:prepared.skills};current.savedDispatch={...still,envelopeHash};saveDriverRun(deps.store,current);});return input;
}
