import { join } from "node:path";
import { archiveRun } from "./archive.js";
import { hasObservedUsage, readRun, saveRun } from "./budget.js";
import { persistCanonicalCheckpoint, verifyCandidateArtifacts } from "./checkpoints.js";
import { hashPayload } from "./commands.js";
import { ControlError } from "./errors.js";
import {
  ADOPTABLE_STATES, handoffRequestFromOutbox, latestRequestForRun, readHandoffRequest, saveHandoffRequest,
  settleCompletedRunRequestInTransaction, settleHandoffRequestInTransaction, type HandoffRequestBody,
} from "./stopIntent.js";
import { isWebWorkRun } from "./webDispatch.js";
import { cleanupRunWorkspace, revParse, workBranchRef } from "./workspace.js";
import { findLanding } from "./driverLanding.js";
import {
  INSPECT_UNKNOWN_LIMIT, advance, archiveAdmission, collectInto, describeError, driverRunIds, groupRepoId, portFor, readDriverRun,
  readStartEnvelope, saveDriverRun, savedReport, stepC, write, type DriverContext, type DriverRun, type ExecutionDriverDeps,
} from "./executionDriver.js";
import type { ExecutionReport, ExecutionStatus } from "./executionPort.js";
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

const stopDeps = (deps: ExecutionDriverDeps) => ({ store: deps.store, profileRouter: deps.router });
const nowMs = (deps: ExecutionDriverDeps): number => (deps.now ?? (() => new Date()))().getTime();

/** spec §11 I3: the run's newest request, when it is still open -- `outcome-unknown` included. */
export function openRequestOf(store: ControlStore, run: Pick<DriverRun, "groupId" | "runId">): HandoffRequestBody | null {
  const request = latestRequestForRun(store, run.groupId, run.runId);
  return request !== null && ADOPTABLE_STATES.includes(request.state) ? request : null;
}

/** spec §13.2 I-2: every Web work run with an open request, whatever its state (blocked and settled included). */
export function handoffRunIds(store: ControlStore): string[] {
  const ids: string[] = [];
  for (const row of store.db.prepare("SELECT DISTINCT run_id FROM handoff_requests ORDER BY run_id").all()) {
    const runId = String(row.run_id);
    const body = store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId);
    if (!body) continue;
    const run = JSON.parse(String(body.body)) as DriverRun;
    if (run.phase === "work" && isWebWorkRun(store, runId) && openRequestOf(store, run) !== null) ids.push(runId);
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
    case "accepted": return deliverAndCollect(deps, run, request);
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
  const run = readDriverRun(store, runId);
  let cleanupError: string | null = null;
  if (run.drive !== undefined) {
    try { await cleanupRunWorkspace(deps.resolveRepository(groupRepoId(store, run.groupId)), deps.roots, runId, run.drive.workspacePath); }
    catch (error) { cleanupError = describeError(error); }
  }
  return write(deps, () => {
    const request = readHandoffRequest(store, run.groupId, requestId).request;
    if (!ADOPTABLE_STATES.includes(request.state)) return false;
    const current = readDriverRun(store, runId);
    if (current.drive !== undefined) {
      current.drive = { ...current.drive, cleanedUp: cleanupError === null, cleanupError };
      saveDriverRun(store, current);
    }
    settleHandoffRequestInTransaction(stopDeps(deps), run.groupId, requestId, "settled-restartable", null);
    return true;
  });
}

/** spec §3 `unknown` row and §11 C4: ask ccloop whether the execution exists before deciding anything. */
async function inspectUnderStop(deps: ExecutionDriverDeps, run: DriverRun, request: HandoffRequestBody): Promise<boolean> {
  let status: ExecutionStatus;
  try { status = await portFor(deps, run).inspect(readStartEnvelope(deps.store, run)); }
  catch { status = { kind: "unknown" }; }
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
async function deliverAndCollect(deps: ExecutionDriverDeps, run: DriverRun, request: HandoffRequestBody): Promise<boolean> {
  const { store } = deps;
  if (request.state === "request-pending") {
    if (deps.admissionGate?.draining) return false;
    let delivered = false;
    try {
      const ack = await portFor(deps, run).requestHandoff(readStartEnvelope(store, run), handoffRequestFromOutbox(store, request.requestId));
      // spec Minor f: a replayed request is answered `complete` once the candidate exists; both mean ccloop holds it.
      delivered = ack.requestId === request.requestId && (ack.kind === "latched" || ack.kind === "complete");
    } catch { delivered = false; }
    deps.crash?.("H-after-deliver");
    if (!delivered) return settleIfPastGrace(deps, run, request);
    return write(deps, () => {
      const current = readHandoffRequest(store, run.groupId, request.requestId).request;
      if (current.state !== "request-pending") return false;
      saveHandoffRequest(store, run.groupId, { ...current, state: "collecting" });
      return true;
    });
  }
  const report = await collectInto(deps, run);
  if (report.terminal !== null && report.candidate?.stopProof && run.state === "accepted") return stepC(deps, run.runId);
  if (report.candidate?.stopProof) {
    deps.crash?.("H-after-candidate");
    return settleHandoffCheckpoint(deps, run.runId, request.requestId, report);
  }
  return settleIfPastGrace(deps, run, request) || report.events.length > 0;
}

/** spec §3 grace (controller decision): past deadline + killGraceMs + 60 s with nothing collected. */
function settleIfPastGrace(deps: ExecutionDriverDeps, run: DriverRun, request: HandoffRequestBody): boolean {
  if (request.state === "outcome-unknown") return false;
  if (nowMs(deps) <= Date.parse(request.deadlineAt) + (deps.handoffGraceMs ?? HANDOFF_EXTRA_GRACE_MS)) return false;
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
  if (drive.landedCommit !== null) return false;
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
async function landedUnrecorded(deps: ExecutionDriverDeps, run: DriverRun): Promise<boolean> {
  const drive = run.drive!;
  if (drive.attemptSha === null || drive.base === null) return false;
  try {
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
