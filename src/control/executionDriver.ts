import { createHash } from "node:crypto";
import { z } from "zod";
import { join } from "node:path";
import { archiveRun, readArtifact, writeArtifact } from "./archive.js";
import { readRun, saveRun } from "./budget.js";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { commitCandidate } from "./checkpoints.js";
import { hashPayload } from "./commands.js";
import { ControlError } from "./errors.js";
import { readConfirmedTaskExecution } from "./executionSnapshot.js";
import { privateDirectory } from "./paths.js";
import { publishPending } from "./projection.js";
import { readBudgetProposal, readGroup, readWork } from "./queries.js";
import { readCanonicalRecord, writeCanonicalRecord } from "./snapshot.js";
import { toSingleCallEnvelope, toStartEnvelope } from "./startEnvelope.js";
import { exportResumeBundle, readExistingResumeBundle, type InputCheckpointV1 } from "./resumeBundle.js";
import { recordUsage } from "./usage.js";
import { exportPendingRequirements } from "./requirementExport.js";
import { isSingleCallRun, isWebWorkRun, nextClaimableTask, readSingleCallClaimEnvelope, readWorkClaimEnvelope, reserveProviderAttemptInTransaction } from "./webDispatch.js";
import { singleCallPurposeOf } from "./singleCall.js";
import { singleCallHandler } from "./singleCallPurposes.js";
import { readWorkspaceSetting, type WorkspaceMode } from "./workspaceSettings.js";
import { cleanupRunWorkspace, commitAttempt, ensureWorkBranch, ensureWorkspace, sourceDirOf, workspacePathOf, type WorkspaceRoots } from "./workspace.js";
import { stepD, stepR } from "./driverLanding.js";
import { openRequestOf, stepH, visitOrder } from "./driverHandoff.js";
import { harvest } from "../scheduler/harvest.js";
import { writeSetOf } from "../scheduler/writeSet.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { DriveRecord, DriveStep } from "./driveRecord.js";
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
  // Handoff delivery spec §9.2 R-H, §11 I5, §13.2 I-1.
  | "H-after-deliver" | "H-after-candidate" | "H-between-commit-and-settle" | "A2-after-bundle";

/** Test-only fault injection (spec §7.2 R1): thrown from `crash`, it ends the driver as a process death would. */
export class DriverCrash extends Error {
  constructor(readonly point: CrashPoint) { super(`driver-crash:${point}`); this.name = "DriverCrash"; }
}

/** spec §2.2 B': consecutive unknown inspections before the run is blocked. A controller choice (spec §9). */
export const INSPECT_UNKNOWN_LIMIT = 10;

export interface ExecutionDriverDeps {
  store: ControlStore;
  router: ExecutionProfileRouter;
  admissionGate?: AdmissionGate;
  roots: WorkspaceRoots;
  /** spec §3.1: the trusted path for a repoId, its witness re-validated on every call. */
  resolveRepository(repoId: string): string;
  /** spec §5.3(6): the binary and agents table a reconciliation `ccloop run` is spawned with (agent selection spec §4.9). */
  ccloopBin: string;
  agentsTablePath: string;
  /** N1 spec §6: the ast-grep binary the overview's structure part runs; null = unavailable. */
  astGrepBin?: string | null;
  kickPump?: () => void;
  crash?: (point: CrashPoint) => void;
  /** Test seam (spec §5.1): runs between a landing's merge and its compare-and-swap. */
  beforeCas?: () => Promise<void>;
  /** Handoff delivery spec §3: the clock a request's grace is judged by (tests move it). */
  now?: () => Date;
  /**
   * Test seam only: overrides handoffGraceMsOf(run) (agent selection spec §6.6: the run's frozen killGraceMs + 60 s).
   * *** ERRATUM (ccloop consolidation step 1, 2026-10-01, Orca session be653b22, ruling R5) *** it overrides handoffGraceMsOf(run, window): max(killGraceMs, frozen recovery window + 5 s) + 60 s.
   */
  handoffGraceMs?: number;
}

export interface DriverRun {
  runId: string; groupId: string; workItemId: string; taskId: string | null;
  generation: number; graphVersion: number; targetVersion: number;
  state: string; phase: string; configHash: string; agent: AgentSelection; executionId: string | null;
  highWater: number; providerAttemptOrdinal: number; continuationIntentId?: string | null;
  executionProfile: { profileId: string; profileHash: string };
  drive?: DriveRecord;
  [key: string]: unknown;
}

/** Per-driver process state: reconciliation runs in flight (spec §5.3(6)), and whether the driver was stopped. */
export interface DriverContext { reconciling: Map<string, Promise<void>>; stopped: boolean }

export interface ExecutionDriver {
  /** One pass over every run the driver owns; a re-entrant call joins the pass in flight. Answers whether any run moved. */
  round(): Promise<boolean>;
  /** A round now, and another straight after for as long as runs keep moving. */
  kick(): void;
  start(intervalMs: number): boolean;
  /** Stops the timer and waits for the round in flight (spec §2.1 shutdown order). */
  stop(): Promise<void>;
  readonly crashed: CrashPoint | null;
}

export function describeError(error: unknown): string {
  if (error instanceof ControlError) return error.detail ? `${error.code}:${error.detail}` : error.code;
  return error instanceof Error && error.message.length > 0 ? error.message : String(error);
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
export function blockRun(deps: Pick<ExecutionDriverDeps, "store" | "admissionGate">, runId: string, step: DriveStep, reason: string, patch: Partial<DriveRecord> = {}): void {
  write(deps, () => {
    const run = readDriverRun(deps.store, runId);
    if (run.drive === undefined) throw new ControlError("recovery-blocked", `drive-missing:${runId}`);
    run.state = "blocked";
    run.drive = { ...run.drive, ...patch, blockedAt: step, blockedReason: reason };
    saveDriverRun(deps.store, run);
  });
}

export function groupRepoId(store: ControlStore, groupId: string): string {
  const group = readGroup(store, groupId) as unknown as { plan?: { repoId: string }; requirement?: { repoId: string } };
  // N1 plan F16: a clarifying group has no plan yet; its requirement names the repository.
  const repoId = group.plan?.repoId ?? group.requirement?.repoId;
  if (repoId === undefined) throw new ControlError("recovery-blocked", `group-repository-missing:${groupId}`);
  return repoId;
}

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

function newDrive(roots: WorkspaceRoots, runId: string, workspaceMode: WorkspaceMode, workspace: boolean): DriveRecord {
  return {
    workspaceMode, sourceDir: sourceDirOf(roots, runId), workspacePath: workspace ? workspacePathOf(roots, runId) : null, targetRepo: null,
    prepared: false, base: null, envelopeHash: null, inspectUnknown: 0, outcome: null, attemptSha: null, landedCommit: null,
    reconcile: null, blockedAt: null, blockedReason: null, cleanedUp: false, cleanupError: null, publishError: null,
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
    const drive = newDrive(deps.roots, runId, readWorkspaceSetting(store, groupRepoId(store, run.groupId)).workspaceMode, purpose === null);
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
  const drive = run.drive;
  let targetRepo: string;
  try { targetRepo = deps.resolveRepository(groupRepoId(store, run.groupId)); }
  catch { blockRun(deps, runId, "A2", "repository-path"); return true; }
  const continued = run.continuationIntentId ? continuationOf(store, run) : null;
  if (run.continuationIntentId && continued === null) { blockRun(deps, runId, "A2", "continuation-registration"); return true; }
  // Handoff delivery spec §4 (human ruling, plan X): a continuation keeps its predecessor's base and never reads
  // the current tip -- ccloop rebuilds the predecessor's tree on the snapshot HEAD, a descendant of that base
  // (spec §11 I6), so C's bounds check, D's findLanding and the other side of a conflict all count from it.
  const base = continued !== null ? continued.base : await ensureWorkBranch(targetRepo, run.groupId);
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
  const contract = {
    ...confirmed.contract, context: { ...confirmed.contract.context, repoPath: workspaceOf(drive) },
    ...(continued !== null ? { executionPolicy: withinGrant(confirmed.contract.executionPolicy, (run.grant as { work: { tokens: number; activeMs: number; attempts: number } }).work) } : {}),
  };
  const envelope = toStartEnvelope(readWorkClaimEnvelope(store, run.groupId, runId), run, { sourceDir: drive.sourceDir, targetRepo, base }, contract, inputCheckpoint);
  const envelopeHash = sha256Canonical(envelope);
  return write(deps, () => {
    writeCanonicalRecord(store, run.groupId, envelopeHash, canonicalBytes(envelope).toString("utf8"));
    const current = readDriverRun(store, runId);
    if (current.state !== "start-pending" || current.drive === undefined || current.drive.prepared) return false;
    current.drive = { ...current.drive, targetRepo, base, envelopeHash, prepared: true };
    saveDriverRun(store, current);
    return true;
  });
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
export function withinGrant<P extends { maxAttempts: number; tokenBudget: number; totalRuntimeBudgetMs: number }>(policy: P, grant: { tokens: number; activeMs: number; attempts: number }): P {
  return {
    ...policy, maxAttempts: Math.min(policy.maxAttempts, grant.attempts), tokenBudget: Math.min(policy.tokenBudget, grant.tokens),
    totalRuntimeBudgetMs: Math.min(policy.totalRuntimeBudgetMs, grant.activeMs),
  };
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
  let status: ExecutionStatus;
  try {
    status = await portFor(deps, run).accept(readStartEnvelope(store, run));
  } catch (error) {
    if (error instanceof ControlError && error.code === "control-peer-exit" && (error.detail ?? "").startsWith("2:")) {
      blockRun(deps, runId, "B", `accept-refused:${error.detail}`);
      return true;
    }
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
  catch { status = { kind: "unknown" }; }
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
    admitted(deps, () => recordUsage(store, event));
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
      current.progress = progress;
      saveDriverRun(store, current);
    });
  }
  const candidate = report.candidate;
  if (candidate && (candidate.runId !== runId || candidate.generation !== run.generation || candidate.workItemId !== run.workItemId)) {
    throw new ControlError("report-identity-conflict");
  }
  return report;
}

export async function stepC(deps: ExecutionDriverDeps, runId: string): Promise<boolean> {
  const { store } = deps;
  const run = readDriverRun(store, runId);
  if (run.state !== "accepted" || run.drive === undefined || run.taskId === null) return false;
  const drive = run.drive;
  const report = await collectInto(deps, run);
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
  if (outcome !== "succeeded") {
    blockRun(deps, runId, "C", `terminal:${outcome}`, { outcome });
    return true;
  }
  const attemptSha = await commitAttempt(join(drive.sourceDir, "repo"));
  const contract = readConfirmedTaskExecution(store, run.groupId, run.taskId).contract;
  const measured = await harvest({ runId, workdir: drive.sourceDir, outcome: "succeeded", attemptSha }, drive.base!, writeSetOf(contract));
  if (measured.outOfBounds.length > 0) {
    blockRun(deps, runId, "C", `out-of-bounds:${measured.outOfBounds.join(",")}`, { outcome, attemptSha });
    return true;
  }
  return write(deps, () => {
    const current = readDriverRun(store, runId);
    if (current.state !== "accepted") return false;
    // Deviation D14: an empty result is not landed; `landedCommit` stays null and the settle step
    // (Task 7) applies D14 and decides E from there.
    current.state = measured.empty ? "landed" : "collected";
    current.drive = { ...current.drive!, outcome, attemptSha, landedCommit: null };
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
}).strict();

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
  const settled = handler.evaluate === undefined ? rawOutput : await handler.evaluate(deps, run, rawOutput);
  try {
    handler.complete({ store, admissionGate: deps.admissionGate }, run, settled, () => {
      if (openRequestOf(store, run) !== null) throw new ControlError("handoff-request-conflict", "estimate-yields-to-handoff");
      const current = readDriverRun(store, runId);
      // As stepC: the run may have moved while this step awaited ccloop; only an `accepted` run is settled here.
      if (current.state !== "accepted") throw new ControlError("start-state-conflict", "estimate-run-moved");
      current.state = "settled-restartable";
      saveDriverRun(store, current);
    });
  } catch (error) {
    if (error instanceof ControlError && error.code === "run-stop-unconfirmed") { blockRun(deps, runId, "C", handler.usageUnknownReason); return true; }
    if (error instanceof ControlError && error.code === "handoff-request-conflict" && error.detail === "estimate-yields-to-handoff") return false;
    if (error instanceof ControlError && error.code === "start-state-conflict" && error.detail === "estimate-run-moved") return false;
    throw error;
  }
  return true;
}
/** DR2: the estimate plan's name for the same step; existing criteria call it. */
export const stepCEstimate = stepCSingleCall;

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
  if (run.state === "landed") {
    const report = await savedReport(store, runId);
    const raw = report.candidate;
    if (raw === null || report.terminal === null) throw new ControlError("control-terminal-pending");
    const archive = await archiveRun(store, { runId, sourceDir: drive.sourceDir, repoDir: join(drive.sourceDir, "repo"), stopProof: raw.stopProof }, archiveAdmission(deps));
    if (drive.landedCommit !== null) {
      // Same evidence shape `confirmLanding` writes (schedulerBridge.ts). checksPassed: ccloop's verifier
      // ran the contract's requiredChecks in this run and it ended `succeeded`.
      const source = await writeArtifact(store, `acceptance-${runId}`, Buffer.from(JSON.stringify({ runId, checksPassed: true, landing: "landed", commit: drive.landedCommit, intent: `drive:${runId}` })), archiveAdmission(deps));
      write(deps, () => store.db.prepare("INSERT INTO outbox VALUES (?, 'acceptance', ?, 1) ON CONFLICT(id) DO NOTHING").run(`acceptance:${runId}`, JSON.stringify({ runId, accepted: true, source })));
    }
    deps.crash?.("E-after-acceptance");
    const record = readRun(store, runId);
    const missing = [...archive.missing, ...raw.missing];
    const candidate: Candidate = {
      groupId: record.groupId, workItemId: record.workItemId, taskId: record.taskId, runId, generation: record.generation,
      graphVersion: record.graphVersion, targetVersion: record.targetVersion, checkpointId: `settle-${runId}`, usageHighWater: raw.usageHighWater,
      result: missing.length === 0 && raw.result === "complete" ? "complete" : "partial",
      artifacts: [...archive.artifacts, ...raw.artifacts, raw.handoff], snapshot: archive.snapshot, missing,
      unresolvedRequestIds: raw.unresolvedRequestIds, stopProof: raw.stopProof, terminalOutcome: report.terminal.outcome, handoff: raw.handoff,
    };
    candidate.checkpointId = `settle-${runId}-${hashPayload(candidate).slice(0, 16)}`;
    await commitCandidate(store, candidate, archiveAdmission(deps));
    if (readDriverRun(store, runId).state !== "settled") { blockRun(deps, runId, "E", "settle-incomplete"); return true; }
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
  await cleanupRunWorkspace(deps.resolveRepository(groupRepoId(store, afterPublish.groupId)), deps.roots, runId, workspaceOf(afterPublish.drive));
  write(deps, () => {
    const current = readDriverRun(store, runId);
    current.drive = { ...current.drive!, cleanedUp: true, cleanupError: null };
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
 */
export function replenishStartWakes(deps: Pick<ExecutionDriverDeps, "store" | "admissionGate">): string[] {
  const { store } = deps;
  if (store.dispatchBlocked) return [];
  const failed: string[] = [];
  const armedIds = write(deps, () => {
    const armed: string[] = [];
    for (const row of store.db.prepare("SELECT id,body FROM groups ORDER BY id").all()) {
      const groupId = String(row.id);
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
        const group = JSON.parse(String(row.body)) as { planHash?: string; status: string; stopped: boolean };
        if (group.planHash === undefined || group.stopped || !DISPATCHABLE_GROUP_STATES.has(group.status)) continue;
        if (store.db.prepare("SELECT group_id FROM stop_intents WHERE group_id=?").get(groupId)) continue;
        if (store.db.prepare("SELECT id FROM recovery_blockers WHERE group_id=? AND scope='group'").get(groupId)) continue;
        if (store.db.prepare("SELECT id FROM scheduler_wakes WHERE group_id=? AND kind IN ('start','no-start','resume') AND delivered=0").get(groupId)) continue;
        const last = store.db.prepare("SELECT body FROM scheduler_wakes WHERE group_id=? AND kind='start' ORDER BY rowid DESC LIMIT 1").get(groupId);
        if (!last || nextClaimableTask(store, groupId) === null) continue;
        const body = JSON.parse(String(last.body)) as { startRevision: number; executionSnapshotHash?: string };
        const ordinal = Number(store.db.prepare("SELECT COUNT(*) AS n FROM scheduler_wakes WHERE group_id=? AND id LIKE ?").get(groupId, `drive:${groupId}:%`)!.n) + 1;
        const wakeId = `drive:${groupId}:${ordinal}`;
        store.db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES (?,?,'start',?,0)").run(wakeId, groupId, canonicalBytes({
          groupId, startRevision: body.startRevision, ...(body.executionSnapshotHash === undefined ? {} : { executionSnapshotHash: body.executionSnapshotHash }),
        }).toString("utf8"));
        armed.push(wakeId);
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
    if (DRIVEN.has(run.state) || (run.state === "settled" && run.drive !== undefined && (!run.drive.cleanedUp || run.drive.publishError !== null))) ids.push(runId);
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
    case "accepted": return stepC(deps, runId);
    case "collected": return stepD(deps, runId);
    case "reconciling": return stepR(deps, runId, context);
    case "landed": case "settled": return stepE(deps, runId);
    default: return false;
  }
}

export function createExecutionDriver(deps: ExecutionDriverDeps): ExecutionDriver {
  const context: DriverContext = { reconciling: new Map(), stopped: false };
  let inFlight: Promise<boolean> | null = null;
  let timer: NodeJS.Timeout | null = null;
  let crashed: CrashPoint | null = null;
  const stopTimer = (): void => { if (timer !== null) { clearInterval(timer); timer = null; } };

  const pass = async (): Promise<boolean> => {
    let progressed = false;
    try {
      if (replenishStartWakes(deps).length > 0) { progressed = true; deps.kickPump?.(); }
    } catch (error) {
      if (error instanceof ControlError && error.code === "panel-draining") return false;
      throw error;
    }
    for (const runId of visitOrder(deps.store)) {
      if (context.stopped) break;
      try {
        // Handoff delivery spec §3: a run with an open request goes to H; every other run is advanced as before.
        const moved = openRequestOf(deps.store, readDriverRun(deps.store, runId)) !== null ? await stepH(deps, runId, context) : await advance(deps, runId, context);
        if (moved) progressed = true;
      } catch (error) {
        if (error instanceof DriverCrash) throw error;
        // A draining panel refuses every write; the round ends and no run is blamed for it.
        if (error instanceof ControlError && error.code === "panel-draining") return progressed;
        // Backlog #3 (Orca handoff §9.0 挂账): recording this run's failure can fail too -- a write the store refuses,
        // a row that no longer reads. That second failure is this run's alone: it is named on stderr with both errors,
        // and the round goes on to the next run instead of ending for every group.
        try {
          const run = readDriverRun(deps.store, runId);
          // A settled run stays settled: whatever failed here is the settle step's own cleanup work,
          // never a reason to reopen it as blocked at an earlier step (controller ruling P7,
          // 2026-09-25). Record the failure on the run and leave it for the next round to retry --
          // re-checked inside the write since another write may have landed while this step was
          // in flight (the deferred note from Task 4's review: never write after an await without
          // re-reading state first).
          if (run.state === "settled") {
            write(deps, () => {
              const current = readDriverRun(deps.store, runId);
              if (current.state === "settled" && current.drive !== undefined && !current.drive.cleanedUp) {
                current.drive = { ...current.drive, cleanupError: describeError(error) };
                saveDriverRun(deps.store, current);
              }
            });
            process.stderr.write(`orca-driver: ${runId}: ${describeError(error)}\n`);
            continue;
          }
          if (run.drive === undefined) { process.stderr.write(`orca-driver: ${runId}: ${describeError(error)}\n`); continue; }
          // Final fix wave (FR-C2, controller ruling 2026-09-25): a run that is already blocked stays blocked where it
          // was. `blockedAt` decides which branch closes it under a stop (spec §13.2 I-3) and where a retry resumes it,
          // so a later error on it (a transient collect failure, an H-settle that threw) never moves it -- `stepOf`
          // would name "E" for every blocked run. The original reason is kept as the prefix; the new error follows it.
          if (run.state === "blocked" && run.drive.blockedAt !== null) {
            blockRun(deps, runId, run.drive.blockedAt, laterError(run.drive.blockedReason, describeError(error)));
          } else {
            blockRun(deps, runId, stepOf(run), describeError(error));
          }
          progressed = true;
        } catch (recordError) {
          if (recordError instanceof DriverCrash) throw recordError;
          if (recordError instanceof ControlError && recordError.code === "panel-draining") return progressed;
          process.stderr.write(`orca-driver: ${runId}: ${describeError(error)}; recording it failed: ${describeError(recordError)}\n`);
        }
      }
    }
    // N1 spec §9.2 (DR14): a requirement's export has git side effects, so it is the driver's, once per round. It runs
    // after the runs: an await before them would let a stop() issued with the round land before the round's first step.
    try { if (await exportPendingRequirements(deps)) progressed = true; }
    catch (error) { if (error instanceof ControlError && error.code === "panel-draining") return progressed; throw error; }
    return progressed;
  };

  const round = (): Promise<boolean> => {
    if (context.stopped || crashed !== null) return Promise.resolve(false);
    if (inFlight !== null) return inFlight;
    const current = pass()
      .catch((error: unknown) => {
        if (error instanceof DriverCrash) { crashed = error.point; stopTimer(); return false; }
        if (!context.stopped) process.stderr.write(`orca-driver: round failed: ${describeError(error)}\n`);
        return false;
      })
      .finally(() => { inFlight = null; });
    inFlight = current;
    return current;
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
      if (inFlight !== null) await inFlight;
    },
    get crashed() { return crashed; },
  };
}
