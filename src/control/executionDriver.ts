import { createHash } from "node:crypto";
import { join } from "node:path";
import { writeArtifact } from "./archive.js";
import { saveRun } from "./budget.js";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { hashPayload } from "./commands.js";
import { ControlError } from "./errors.js";
import { readConfirmedTaskExecution } from "./executionSnapshot.js";
import { privateDirectory } from "./paths.js";
import { readBudgetProposal, readGroup } from "./queries.js";
import { readCanonicalRecord, writeCanonicalRecord } from "./snapshot.js";
import { toStartEnvelope } from "./startEnvelope.js";
import { recordUsage } from "./usage.js";
import { isWebWorkRun, readWorkClaimEnvelope, reserveProviderAttemptInTransaction } from "./webDispatch.js";
import { readWorkspaceSetting, type WorkspaceMode } from "./workspaceSettings.js";
import { commitAttempt, ensureWorkBranch, ensureWorkspace, sourceDirOf, workspacePathOf, type WorkspaceRoots } from "./workspace.js";
import { stepD } from "./driverLanding.js";
import { harvest } from "../scheduler/harvest.js";
import { writeSetOf } from "../scheduler/writeSet.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { DriveRecord, DriveStep } from "./driveRecord.js";
import type { ExecutionPort, ExecutionStatus, StartEnvelope } from "./executionPort.js";
import type { ExecutionProfileRouter } from "./profiles.js";
import type { ControlStore } from "./store.js";

/**
 * Execution driver spec §2. Owned by the panel's control assembly next to the wake pump, and only
 * when an execution port is configured. It is the only place a provider is invoked for a Web run:
 * recovery and the pump never do (spec §2.1).
 */

export type CrashPoint = "A2-after-workspace" | "B-after-accept" | "C-after-terminal" | "D-after-cas" | "E-after-acceptance";

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
  /** spec §5.3(6): the binary and codex adapter config a reconciliation `ccloop run` is spawned with. */
  ccloopBin: string;
  adapterConfigPath: string;
  kickPump?: () => void;
  crash?: (point: CrashPoint) => void;
  /** Test seam (spec §5.1): runs between a landing's merge and its compare-and-swap. */
  beforeCas?: () => Promise<void>;
}

export interface DriverRun {
  runId: string; groupId: string; workItemId: string; taskId: string | null;
  generation: number; graphVersion: number; targetVersion: number;
  state: string; phase: string; configHash: string; executionId: string | null;
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
  return (readGroup(store, groupId) as unknown as { plan: { repoId: string } }).plan.repoId;
}

export function groupStopped(store: ControlStore, groupId: string): boolean {
  return readGroup(store, groupId).stopped || store.db.prepare("SELECT group_id FROM stop_intents WHERE group_id=?").get(groupId) !== undefined;
}

/** The frozen worker profile's port: the one the run was claimed against. */
export function portFor(deps: Pick<ExecutionDriverDeps, "router">, run: DriverRun): ExecutionPort {
  return deps.router.resolve("task", run.executionProfile.profileId, run.executionProfile.profileHash).port;
}

export function readStartEnvelope(store: ControlStore, run: DriverRun): StartEnvelope {
  if (run.drive?.envelopeHash == null) throw new ControlError("recovery-blocked", `envelope-missing:${run.runId}`);
  return JSON.parse(readCanonicalRecord(store, run.drive.envelopeHash)) as StartEnvelope;
}

function newDrive(roots: WorkspaceRoots, runId: string, workspaceMode: WorkspaceMode): DriveRecord {
  return {
    workspaceMode, sourceDir: sourceDirOf(roots, runId), workspacePath: workspacePathOf(roots, runId), targetRepo: null,
    prepared: false, base: null, envelopeHash: null, inspectUnknown: 0, outcome: null, attemptSha: null, landedCommit: null,
    reconcile: null, blockedAt: null, blockedReason: null, cleanedUp: false,
  };
}

/**
 * A1 (spec §2.2): one transaction reserves the provider attempt and records where the run will live.
 * Only a `starting` run enters, so a restart that finds `start-pending` never reserves a second one.
 * A strict group is refused before any attempt (spec §1, §8); so is a continuation (deviation D21).
 */
export function stepA1(deps: ExecutionDriverDeps, runId: string): boolean {
  const { store } = deps;
  return write(deps, () => {
    const run = readDriverRun(store, runId);
    if (run.state !== "starting") return false;
    const drive = newDrive(deps.roots, runId, readWorkspaceSetting(store, groupRepoId(store, run.groupId)).workspaceMode);
    const refuse = (reason: string): boolean => {
      const current = readDriverRun(store, runId);
      current.state = "blocked";
      current.drive = { ...drive, blockedAt: "A1", blockedReason: reason };
      saveDriverRun(store, current);
      return true;
    };
    if (readBudgetProposal(store, run.groupId).budgetMode === "strict") return refuse("strict-proof-unimplemented");
    if (run.continuationIntentId) return refuse("continuation-unsupported");
    if (store.dispatchBlocked || groupStopped(store, run.groupId)) return false;
    const reservation = reserveProviderAttemptInTransaction(store, runId, "work");
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
  const drive = run.drive;
  let targetRepo: string;
  try { targetRepo = deps.resolveRepository(groupRepoId(store, run.groupId)); }
  catch { blockRun(deps, runId, "A2", "repository-path"); return true; }
  const base = await ensureWorkBranch(targetRepo, run.groupId);
  privateDirectory(drive.sourceDir);
  await ensureWorkspace(targetRepo, drive.workspaceMode, drive.workspacePath, base, deps.roots);
  deps.crash?.("A2-after-workspace");
  const confirmed = readConfirmedTaskExecution(store, run.groupId, run.taskId);
  // ccloop opens its attempt worktrees from repoPath's HEAD, not from `base` (spec §3.2), so the
  // contract points at this run's own workspace. The frozen derivedContractHash is unchanged.
  const contract = { ...confirmed.contract, context: { ...confirmed.contract.context, repoPath: drive.workspacePath } };
  const envelope = toStartEnvelope(readWorkClaimEnvelope(store, run.groupId, runId), run, { sourceDir: drive.sourceDir, targetRepo, base }, contract);
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
  if (store.dispatchBlocked || groupStopped(store, run.groupId) || deps.admissionGate?.draining) return false;
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
export async function stepC(deps: ExecutionDriverDeps, runId: string): Promise<boolean> {
  const { store } = deps;
  const run = readDriverRun(store, runId);
  if (run.state !== "accepted" || run.drive === undefined || run.taskId === null) return false;
  const drive = run.drive;
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
  const candidate = report.candidate;
  if (candidate && (candidate.runId !== runId || candidate.generation !== run.generation || candidate.workItemId !== run.workItemId)) {
    throw new ControlError("report-identity-conflict");
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

const DRIVEN = new Set(["starting", "start-pending", "accepted", "unknown", "collected", "landed", "reconciling"]);

/** spec §2.1: every Web work run the driver can still move, by runId; plus settled runs not yet cleaned (deviation D15). */
export function driverRunIds(store: ControlStore): string[] {
  const ids: string[] = [];
  for (const row of store.db.prepare("SELECT id,body FROM runs ORDER BY id").all()) {
    const runId = String(row.id);
    const run = JSON.parse(String(row.body)) as DriverRun;
    if (run.phase !== "work" || !isWebWorkRun(store, runId)) continue;
    if (DRIVEN.has(run.state) || (run.state === "settled" && run.drive !== undefined && !run.drive.cleanedUp)) ids.push(runId);
  }
  return ids;
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
  void context;
  const run = readDriverRun(deps.store, runId);
  switch (run.state) {
    case "starting": return stepA1(deps, runId);
    case "start-pending": return run.drive?.prepared ? stepB(deps, runId) : stepA2(deps, runId);
    case "unknown": return stepBPrime(deps, runId);
    case "accepted": return stepC(deps, runId);
    case "collected": return stepD(deps, runId);
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
    for (const runId of driverRunIds(deps.store)) {
      if (context.stopped) break;
      try {
        if (await advance(deps, runId, context)) progressed = true;
      } catch (error) {
        if (error instanceof DriverCrash) throw error;
        // A draining panel refuses every write; the round ends and no run is blamed for it.
        if (error instanceof ControlError && error.code === "panel-draining") return progressed;
        const run = readDriverRun(deps.store, runId);
        // A settled run stays settled: whatever failed here is the settle step's own cleanup work
        // (Task 7 records cleanupError on the run and retries it), never a reason to reopen it as
        // blocked at an earlier step (controller ruling P7, 2026-09-25).
        if (run.state === "settled") { process.stderr.write(`orca-driver: ${runId}: ${describeError(error)}\n`); continue; }
        if (run.drive === undefined) { process.stderr.write(`orca-driver: ${runId}: ${describeError(error)}\n`); continue; }
        blockRun(deps, runId, stepOf(run), describeError(error));
        progressed = true;
      }
    }
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
