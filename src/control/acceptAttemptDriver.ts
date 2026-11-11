import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { recordActivity } from "./activity.js";
import { readArtifact, within, writeArtifact } from "./archive.js";
import { operatorAcceptanceOf, type OperatorAcceptance, type StagedAcceptance } from "./acceptAttempt.js";
import { runCheckRecorded, type CheckFailure } from "./checkCommand.js";
import { completeAcceptedAttempt } from "./checkpoints.js";
import { classifyCriteriaChange, flagged } from "./criteriaProtection.js";
import { groupRepoId } from "./dirGroup.js";
import { ControlError } from "./errors.js";
import { readConfirmedTaskExecution } from "./executionSnapshot.js";
import {
  archiveAdmission, describeError, DriverCrash, groupStopped, readDriverRun, savedReport, saveDriverRun, write,
  type DriverContext, type DriverRun, type ExecutionDriverDeps,
} from "./executionDriver.js";
import { insertPendingDecisions } from "./pendingDecisions.js";
import { groupHasReconcilingRun, readWork } from "./queries.js";
import { reportedDecisionsOf } from "./reportedDecisions.js";
import { ccloopEvidenceString, runEvidence, writeRunLedger, type PendingEntry } from "./runLedger.js";
import { snapshotSchema } from "./snapshot.js";
import { QUIET_GIT, compareAndSwap, incomingRefOf, landingPathOf, removeOwnPath, revParse, workBranchRef, type WorkspaceRoots } from "./workspace.js";
import type { ArtifactRef } from "./types.js";
import type { DecisionEvent } from "../ledger/schema.js";
import { ORCA_IDENTITY, git } from "../scheduler/gitExec.js";
import { harvest } from "../scheduler/harvest.js";
import { writeSetOf } from "../scheduler/writeSet.js";
import type { CcloopOutcome } from "../scheduler/ccloopRunner.js";

/**
 * Reviewed acceptance (spec 2026-11-11 §7), the driver half. A settled-failed run whose owner recorded an acceptance
 * (acceptAttempt.ts) is visited after its cleanup. Each visit, in the spirit of D's post-merge check (driverLanding.ts):
 *  1. the attempt is rebuilt from the run's archive snapshot into a fresh repository the driver names -- HEAD from the
 *     bundle, the index as captured, every path the attempt deleted removed, the captured tree written -- and committed as
 *     ccloop's attempt would have been (`git add -A`), with a fixed date so a restart rebuilds the same commit;
 *  2. the write-set harvest refuses out-of-bounds paths, and a modified or weakened check-defining file is refused (the
 *     person accepts on the checks' word, so checks the attempt changed cannot give it);
 *  3. the attempt is merged onto the group branch tip in a landing worktree with the run's ledger (the code-authored
 *     acceptance decision, and the agent's own reported decisions unchanged) in the same merge commit; nothing moves;
 *  4. off the round, the task's setup and required checks run on that merged tree; kept in memory only, so a restart
 *     merges and checks again (nothing was written);
 *  5. a later visit lands it by compare-and-swap when the tip is the one checked (a moved tip merges and checks again), or
 *     refuses it naming the failing command and its exit. The acceptance proof and the ledger's refused entries are staged
 *     on the run before the swap, so a death after it finishes the landing instead of making a second one.
 * Accounting is never touched.
 */

const NUL = String.fromCharCode(0);

export interface AcceptCheck {
  controller: AbortController; old: string; next: string; attemptSha: string; pending: PendingEntry[];
  settled: { outcomes: CheckFailure[]; failure: CheckFailure | null } | { error: unknown } | null;
}
/** For a step called outside a driver (a criterion calling it itself); a driver owns its own map. */
const unownedAcceptChecks = new Map<string, AcceptCheck>();
const checksOf = (context: DriverContext | undefined): Map<string, AcceptCheck> => context?.acceptChecks ?? unownedAcceptChecks;

export const acceptRebuildPathOf = (roots: WorkspaceRoots, runId: string): string => join(roots.workspacesRoot, `accept-${runId}`);
export const acceptCheckPathOf = (roots: WorkspaceRoots, runId: string): string => join(roots.workspacesRoot, `accept-check-${runId}`);

/** A run the driver still has an owner's acceptance to carry out for. */
export function acceptPending(run: object): boolean {
  return operatorAcceptanceOf(run)?.state === "pending";
}

/** A refusal the person can read: the step's reason, and for a check the command, its exit and its output's end. */
class Refusal extends Error { constructor(readonly reason: string, readonly failure: CheckFailure | null = null) { super(reason); } }

export async function stepAcceptAttempt(deps: ExecutionDriverDeps, runId: string, context?: DriverContext): Promise<boolean> {
  const { store } = deps;
  const run = readDriverRun(store, runId);
  const intent = operatorAcceptanceOf(run);
  if (intent === null || intent.state !== "pending" || run.state !== "settled-failed" || run.taskId === null || run.drive === undefined) return false;
  try {
    return await visit(deps, run, intent, context);
  } catch (error) {
    if (error instanceof DriverCrash) throw error;
    if (error instanceof ControlError && error.code === "panel-draining") throw error;
    checksOf(context).get(runId)?.controller.abort();
    checksOf(context).delete(runId);
    refuse(deps, runId, error instanceof Refusal ? error.reason : `error:${describeError(error)}`.slice(0, 2048), error instanceof Refusal ? error.failure : null);
    return true;
  }
}

async function visit(deps: ExecutionDriverDeps, run: DriverRun, intent: OperatorAcceptance, context: DriverContext | undefined): Promise<boolean> {
  const { store } = deps, runId = run.runId, groupId = run.groupId, taskId = run.taskId!, drive = run.drive!;
  const work = readWork(store, groupId, taskId) as unknown as { status: string; currentRunId?: string | null };
  // The task moved on since the command (a retry, another landing): this run's attempt is no longer the task's to land.
  if (intent.staged === null && (work.status === "done" || work.currentRunId !== runId)) throw new Refusal(`task-moved:${work.status}`);
  // As D: no landing while a sibling reconciles or the group is stopped; the next round looks again.
  if (groupHasReconcilingRun(store, groupId) || groupStopped(store, groupId)) return false;
  if (drive.base === null) throw new Refusal("base-missing");
  let targetRepo: string;
  try { targetRepo = deps.resolveRepository(groupRepoId(store, groupId)); } catch { throw new Refusal("repository-path"); }
  const ref = workBranchRef(groupId);
  const tip = await revParse(targetRepo, ref);
  // A landing staged before its swap: the swap happened if the tip holds it (a death after the swap); finish it once.
  if (intent.staged !== null) {
    if (await isAncestor(targetRepo, intent.staged.next, tip)) { finish(deps, runId); return true; }
    write(deps, () => {
      const current = readDriverRun(store, runId), live = operatorAcceptanceOf(current);
      if (live?.state === "pending") { current.operatorAcceptance = { ...live, staged: null }; saveDriverRun(store, current); }
    });
    return true;
  }
  const checks = checksOf(context);
  const checked = checks.get(runId);
  if (checked !== undefined) {
    if (checked.settled === null) return false;
    checks.delete(runId);
    if ("error" in checked.settled) throw checked.settled.error;
    if (checked.old === tip) {
      if (checked.settled.failure !== null) throw new Refusal(`check-failed:${checked.settled.failure.command}`, checked.settled.failure);
      return land(deps, run, intent, targetRepo, checked, checked.settled.outcomes);
    }
    // The tip moved while the checks ran: the tree they checked will never land. Merge onto the new tip and check that.
  }
  const contract = readConfirmedTaskExecution(store, groupId, taskId).contract;
  if (contract.verification.requiredChecks.length === 0) throw new Refusal("no-required-checks");
  const rebuilt = acceptRebuildPathOf(deps.roots, runId);
  await removeOwnPath(targetRepo, deps.roots, rebuilt);
  try {
    const attemptSha = await restoreSnapshotAttempt(store, intent.snapshot, rebuilt, intent.at);
    const measured = await harvest({ runId, workdir: drive.sourceDir, outcome: drive.outcome as CcloopOutcome, attemptSha }, drive.base, writeSetOf(contract), rebuilt);
    if (measured.empty) throw new Refusal("empty-attempt");
    if (measured.outOfBounds.length > 0) throw new Refusal(`out-of-bounds:${measured.outOfBounds.join(",")}`.slice(0, 2048));
    const change = await classifyCriteriaChange(rebuilt, drive.base, attemptSha, contract.verification.requiredChecks, contract.context.setupCommands);
    if (flagged(change)) throw new Refusal(`criteria-${change.kind}:${[...change.signals, ...change.files].join(", ")}`.slice(0, 2048));
    const merged = await mergeOnTip(deps, run, intent, targetRepo, rebuilt, tip, attemptSha);
    // A round still running when stop() was called starts nothing stop() could no longer abort; the next driver merges again.
    if (context?.stopped) return false;
    const entry: AcceptCheck = { controller: new AbortController(), old: tip, next: merged.next, attemptSha, pending: merged.pending, settled: null };
    checks.set(runId, entry);
    void runAcceptChecks(deps, targetRepo, runId, merged.next, contract, entry.controller.signal)
      .then((settled) => { entry.settled = settled; }, (error: unknown) => { entry.settled = { error }; });
    return true;
  } finally {
    await removeOwnPath(targetRepo, deps.roots, rebuilt).catch(() => undefined);
  }
}

async function isAncestor(repo: string, commit: string, of: string): Promise<boolean> {
  try { await git(repo, [...QUIET_GIT, "merge-base", "--is-ancestor", commit, of]); return true; } catch { return false; }
}

/** §7 item 4: Orca's own record of the person's acceptance, written in the run's ledger inside the landing commit. */
function acceptanceDecision(runId: string, groupId: string, intent: OperatorAcceptance, attemptSha: string, at: string): DecisionEvent {
  return {
    ev: "decision", id: `${runId}/orca-operator-accept`, at, run: runId,
    question: `run ${runId} ended without success, but published an attempt (${attemptSha}) no recovery path accepts. May it land?`,
    chose: `land it: ${intent.principal} accepted it after reviewing it ("${intent.note.slice(0, 400)}"), and Orca re-ran the task's setup and required checks on the merged tree before the branch moved`,
    alternatives: [
      { option: "leave the task blocked and retry it", why_not: "the person reviewed the attempt and chose to accept it; a retry pays again for work the checks pass" },
    ],
    because: `operator-reviewed acceptance, command ${intent.commandId}: the checks ran on the merged tree, and a person is accountable for the rest`,
    undo: { how: `git revert -m 1 --no-edit <the merge commit on orca/${groupId} whose second parent is ${attemptSha}>`, cost: "one task's landed work", blast_radius: "the attempt's paths" },
    scope: "task", kind: "criteria", importance: "major",
    evidence: [`principal ${intent.principal}`, `command ${intent.commandId}`, `attempt ${attemptSha}`, `snapshot ${intent.snapshot.artifactId}`],
  };
}

async function mergeOnTip(
  deps: ExecutionDriverDeps, run: DriverRun, intent: OperatorAcceptance, targetRepo: string, rebuilt: string, tip: string, attemptSha: string,
): Promise<{ next: string; pending: PendingEntry[] }> {
  const runId = run.runId, landing = landingPathOf(deps.roots, runId);
  await removeOwnPath(targetRepo, deps.roots, landing);
  await git(targetRepo, [...QUIET_GIT, "worktree", "add", "--detach", landing, tip]);
  try {
    // Into the target's shared refs: the incoming ref keeps the attempt reachable until it lands or is refused.
    await git(landing, [...QUIET_GIT, "fetch", "--no-tags", rebuilt, `+${attemptSha}:${incomingRefOf(runId)}`]);
    try {
      await git(landing, [...QUIET_GIT, ...ORCA_IDENTITY, "merge", "--no-ff", "--no-commit", incomingRefOf(runId)]);
    } catch {
      const conflicted = (await git(landing, [...QUIET_GIT, "diff", "--name-only", "--diff-filter=U"])).trim().split("\n").filter((path) => path.length > 0);
      await git(landing, [...QUIET_GIT, "merge", "--abort"]).catch(() => undefined);
      throw new Refusal(`merge-conflict:${conflicted.slice(0, 20).join(", ")}`);
    }
    const at = (deps.now?.() ?? new Date()).toISOString();
    // The agent's reported decisions ride along as D writes them (refused ones become pending at the landing); none invented.
    const reported = reportedDecisionsOf(await savedReport(deps.store, runId));
    const evidence = runEvidence(runId, attemptSha, await ccloopEvidenceString(deps.ccloopBin));
    const ledger = await writeRunLedger(join(landing, ".decisions"), { ledgerRun: runId, reported, codeAuthored: [acceptanceDecision(runId, run.groupId, intent, attemptSha, at)], at, evidence });
    await git(landing, [...QUIET_GIT, "add", "-f", join(".decisions", `${runId}.jsonl`)]);
    await git(landing, [...QUIET_GIT, ...ORCA_IDENTITY, "commit", "--no-edit", "-m", `orca: accept ${runId}`]);
    return { next: await revParse(landing, "HEAD"), pending: ledger.pending };
  } finally {
    await removeOwnPath(targetRepo, deps.roots, landing);
  }
}

type TaskContract = ReturnType<typeof readConfirmedTaskExecution>["contract"];

/** As the post-merge check (driverLanding.ts), recording every command's exit and output: setup first, the first red stops. */
async function runAcceptChecks(deps: ExecutionDriverDeps, targetRepo: string, runId: string, next: string, contract: TaskContract, signal: AbortSignal): Promise<{ outcomes: CheckFailure[]; failure: CheckFailure | null }> {
  const path = acceptCheckPathOf(deps.roots, runId);
  await removeOwnPath(targetRepo, deps.roots, path);
  await git(targetRepo, [...QUIET_GIT, "worktree", "add", "--detach", path, next]);
  const as = { runId, ...(deps.dispatchedPersonDir === undefined ? {} : { personDir: deps.dispatchedPersonDir }) };
  const timeoutMs = contract.executionPolicy.perAttemptTimeoutMs;
  const outcomes: CheckFailure[] = [];
  try {
    for (const command of contract.context.setupCommands ?? []) {
      const outcome = { ...await runCheckRecorded(path, command, timeoutMs, as, signal), command: `setup: ${command}` };
      outcomes.push(outcome);
      if (outcome.exit !== "0") return { outcomes, failure: outcome };
    }
    for (const command of contract.verification.requiredChecks) {
      const outcome = await runCheckRecorded(path, command, timeoutMs, as, signal);
      outcomes.push(outcome);
      if (outcome.exit !== "0") return { outcomes, failure: outcome };
    }
    return { outcomes, failure: null };
  } finally {
    await removeOwnPath(targetRepo, deps.roots, path).catch(() => undefined);
  }
}

/** The checked merge lands: proof first, staged on the run, then the swap, then the one write that records it. */
async function land(deps: ExecutionDriverDeps, run: DriverRun, intent: OperatorAcceptance, targetRepo: string, checked: AcceptCheck, outcomes: CheckFailure[]): Promise<boolean> {
  const { store } = deps, runId = run.runId;
  const setup = outcomes.filter((o) => o.command.startsWith("setup: ")).map((o) => ({ ...o, command: o.command.slice("setup: ".length) }));
  const proofBody = {
    runId, checksPassed: true, landing: "landed", commit: checked.next, review: "operator-reviewed",
    principal: intent.principal, note: intent.note, commandId: intent.commandId, attemptSha: checked.attemptSha, merged: checked.next, base: checked.old,
    snapshot: intent.snapshot, setup, checks: outcomes.filter((o) => !o.command.startsWith("setup: ")), intent: `accept:${intent.commandId}`,
  };
  const bytes = Buffer.from(JSON.stringify(proofBody));
  const proof = await writeArtifact(store, `acceptance-${runId}-reviewed-${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}`, bytes, archiveAdmission(deps));
  const staged: StagedAcceptance = { attemptSha: checked.attemptSha, old: checked.old, next: checked.next, proof, pending: checked.pending };
  const ok = write(deps, () => {
    const current = readDriverRun(store, runId), live = operatorAcceptanceOf(current);
    if (live?.state !== "pending" || live.commandId !== intent.commandId) return false;
    current.operatorAcceptance = { ...live, staged };
    saveDriverRun(store, current);
    return true;
  });
  if (!ok) return false;
  await deps.beforeCas?.();
  // A moved tip only: the next visit finds the tip without the staged commit, forgets it and merges again.
  if (!(await compareAndSwap(targetRepo, workBranchRef(run.groupId), checked.next, checked.old))) return true;
  deps.crash?.("accept-after-cas");
  finish(deps, runId);
  return true;
}

/** After the swap: the acceptance, the refused entries, the task done (completeAcceptedAttempt) and the activity row, in one write. */
function finish(deps: ExecutionDriverDeps, runId: string): void {
  const { store } = deps;
  const landed = write(deps, () => {
    const current = readDriverRun(store, runId), live = operatorAcceptanceOf(current);
    if (live?.state !== "pending" || live.staged === null) return null;
    const staged = live.staged;
    store.db.prepare("INSERT INTO outbox VALUES (?, 'acceptance', ?, 1) ON CONFLICT(id) DO NOTHING").run(`acceptance:${runId}`, JSON.stringify({ runId, accepted: true, source: staged.proof }));
    insertPendingDecisions(store, current.groupId, runId, staged.pending);
    current.operatorAcceptance = { ...live, state: "landed", staged: null, attemptSha: staged.attemptSha, landedCommit: staged.next, proof: staged.proof };
    saveDriverRun(store, current);
    completeAcceptedAttempt(store, runId);
    recordActivity(store, { groupId: current.groupId, taskId: current.taskId, runId, kind: "attempt-accepted", body: { commandId: live.commandId, principal: live.principal, attemptSha: staged.attemptSha, commit: staged.next } });
    return current;
  });
  if (landed !== null) void dropIncomingRef(deps, landed);
}

function refuse(deps: ExecutionDriverDeps, runId: string, reason: string, failure: CheckFailure | null): void {
  const { store } = deps;
  const refused = write(deps, () => {
    const current = readDriverRun(store, runId), live = operatorAcceptanceOf(current);
    if (live?.state !== "pending") return null;
    current.operatorAcceptance = { ...live, state: "refused", reason, failure, staged: null };
    saveDriverRun(store, current);
    recordActivity(store, { groupId: current.groupId, taskId: current.taskId, runId, kind: "attempt-accept-refused", body: { commandId: live.commandId, reason, ...(failure === null ? {} : { exit: failure.exit }) } });
    return current;
  });
  if (refused !== null) void dropIncomingRef(deps, refused);
}

async function dropIncomingRef(deps: ExecutionDriverDeps, run: DriverRun): Promise<void> {
  try { await git(deps.resolveRepository(groupRepoId(deps.store, run.groupId)), [...QUIET_GIT, "update-ref", "-d", incomingRefOf(run.runId)]); } catch { /* best effort, as cleanup's */ }
}

/**
 * §7 item 1: the attempt a run left in its result repository, rebuilt from its archive snapshot into `dir` (which must not
 * exist): HEAD from the bundle, the index as captured, every path the attempt deleted removed, every captured file and
 * symlink written with its mode; then committed as ccloop's attempt is (`git add -A`, workspace.ts commitAttempt), at the
 * acceptance's time so a rebuild after a restart is the same commit. Answers the attempt sha.
 */
export async function restoreSnapshotAttempt(store: ExecutionDriverDeps["store"], ref: ArtifactRef, dir: string, at: number): Promise<string> {
  const snapshot = snapshotSchema.parse(JSON.parse((await readArtifact(store, ref)).toString()));
  if (snapshot.missing.length > 0) throw new Refusal(`snapshot-partial:${snapshot.missing.slice(0, 20).join(",")}`);
  await mkdir(dir, { mode: 0o700 });
  const root = await realpath(dir);
  await git(root, [...QUIET_GIT, "init", "-q"]);
  const bundle = join(root, ".git", "orca-snapshot.bundle");
  await writeFile(bundle, await readArtifact(store, snapshot.bundle), { mode: 0o600, flag: "wx" });
  await git(root, [...QUIET_GIT, "fetch", "-q", "--no-tags", bundle, "HEAD"]);
  if ((await revParse(root, "FETCH_HEAD")) !== snapshot.head) throw new Refusal("snapshot-head-mismatch");
  await git(root, [...QUIET_GIT, "checkout", "-q", "--detach", snapshot.head]);
  // The index as captured: a blob the bundle lacks is written from its archived bytes first.
  for (const entry of snapshot.index) {
    if (entry.ref === null) throw new Refusal(`snapshot-partial:index:${entry.path}`);
    const present = await git(root, [...QUIET_GIT, "cat-file", "-e", entry.oid]).then(() => true, () => false);
    if (present) continue;
    const oid = (await git(root, [...QUIET_GIT, "hash-object", "-w", "--stdin"], { input: await readArtifact(store, entry.ref) })).trim();
    if (oid !== entry.oid) throw new Refusal(`snapshot-index-hash-mismatch:${entry.path}`);
  }
  await git(root, [...QUIET_GIT, "read-tree", "--empty"]);
  if (snapshot.index.length > 0) {
    await git(root, [...QUIET_GIT, "update-index", "--index-info"], { input: snapshot.index.map((e) => `${e.mode} ${e.oid} ${e.stage}\t${e.path}`).join("\n") + "\n" });
  }
  // Every path HEAD or the index had that the captured tree does not is a path the attempt deleted.
  const kept = new Set(snapshot.tree.filter((entry) => entry.kind !== "directory").map((entry) => entry.path));
  const headPaths = (await git(root, [...QUIET_GIT, "ls-tree", "-r", "-z", "--name-only", snapshot.head])).split(NUL).filter((path) => path.length > 0);
  // A path is removed or written only below the rebuilt repository: a symlinked parent is never followed out of it.
  const inside = async (path: string): Promise<void> => {
    // The nearest ancestor that exists decides where a write or a `mkdir -p` below it ends up.
    for (let dir = dirname(join(root, path)); ; dir = dirname(dir)) {
      const real = await realpath(dir).catch(() => null);
      if (real === null) continue;
      if (!within(root, real) || real.slice(root.length).split("/").includes(".git")) throw new Refusal(`snapshot-path-escapes:${path}`);
      return;
    }
  };
  for (const path of new Set([...headPaths, ...snapshot.index.map((entry) => entry.path)])) {
    if (kept.has(path)) continue;
    await inside(path);
    await rm(join(root, path), { force: true });
  }
  for (const entry of snapshot.tree) {
    const target = join(root, entry.path);
    if (entry.kind === "directory") { await inside(entry.path); await mkdir(target, { recursive: true }); continue; }
    await inside(entry.path);
    await mkdir(dirname(target), { recursive: true });
    const existing = await lstat(target).catch(() => null);
    if (existing !== null) await rm(target, { recursive: existing.isDirectory(), force: true });
    if (entry.kind === "symlink") { await symlink(entry.target!, target); continue; }
    await writeFile(target, await readArtifact(store, entry.ref!), { flag: "wx", mode: 0o600 });
    await chmod(target, entry.mode);
  }
  const date = `@${Math.floor(at / 1000)} +0000`;
  const status = await git(root, [...QUIET_GIT, "status", "--porcelain", "--untracked-files=all"]);
  if (status.trim().length > 0) {
    await git(root, [...QUIET_GIT, "add", "-A"]);
    await git(root, [...QUIET_GIT, ...ORCA_IDENTITY, "commit", "-q", "--allow-empty", "-m", "orca: attempt result"], { env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  }
  return revParse(root, "HEAD");
}
