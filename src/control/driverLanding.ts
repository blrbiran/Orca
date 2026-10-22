import { claimCapBlocking } from "./spendCaps.js";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { add, budgetBalance, readRun, syncWebBudget } from "./budget.js";
import { canonicalBytes } from "./canonicalJson.js";
import { ControlError } from "./errors.js";
import { readConfirmedReconcileSlot, readConfirmedTaskExecution } from "./executionSnapshot.js";
import { privateDirectory } from "./paths.js";
import { groupHasReconcilingRun, readGroup, saveGroup } from "./queries.js";
import { bookReconcileUsage } from "./usageLedger.js";
import { insertPendingDecisions } from "./pendingDecisions.js";
import { flagDecision } from "./flaggedDecisions.js";
import { ORCHESTRATION_ACTOR } from "./orchestration.js";
import { reportedDecisionsOf, type ReportedDecisions } from "./reportedDecisions.js";
import { ccloopEvidenceString, runEvidence, runLedgerEvents, writeRunLedger, type PendingEntry } from "./runLedger.js";
import { flowGroupOf, isDirFlowGroup } from "../flow/groups.js";
import { appendFlowDecision } from "../flow/store.js";
import { commitLedgerOnGroupBranch, exportLedgerDir, treeWithLedgerFiles } from "./ledgerTree.js";
import { readDebugMark, type ClosingRecord } from "./debugChecks.js";
import { writeDebugClosing } from "./debugClosing.js";
import { reconcileDecision } from "../scheduler/ledgerWiring.js";
import type { DecisionEvent } from "../ledger/schema.js";
import { classifyCriteriaChange, criteriaDecision, flagged } from "./criteriaProtection.js";
import { ORCA_IDENTITY, git } from "../scheduler/gitExec.js";
import { AgentsRunRefused, TERMINAL_OUTCOMES, cloneDirOf, latestAttemptSha, loopDirOf, runTask } from "../scheduler/ccloopRunner.js";
import { netChangeSet } from "../scheduler/harvest.js";
import { markersRemaining, materialiseConflict, pinConflictCommit, rebuildMergeCommit, synthesizeReconcileContractOf } from "../scheduler/reconcile.js";
import { blockRun, describeError, groupRepoId, readDriverRun, savedReport, saveDriverRun, write, type DriverContext, type DriverRun, type ExecutionDriverDeps } from "./executionDriver.js";
import { QUIET_GIT, compareAndSwap, conflictPathOf, incomingRefOf, landingPathOf, reconcileRunsDirOf, removeOwnPath, revParse, workBranchRef } from "./workspace.js";
import type { ReconcileRecord } from "./driveRecord.js";
import type { ControlStore } from "./store.js";
import type { PlanFile, PlanTask } from "../scheduler/planFile.js";
import type { FrozenSlot } from "./agentSelection.js";

/**
 * Execution driver spec §5. Nothing here runs in the person's checkout: every merge happens in a
 * detached worktree the driver names under its own root, and the work branch moves only by
 * compare-and-swap from the tip it was read at.
 */

/**
 * spec §2.2 D's idempotence: a landing the driver already made (it died after the swap, before it
 * recorded it) is found, not repeated. The landing is the first-parent commit whose second parent is
 * this run's attempt; an attempt reachable some other way is not a landing this driver can name.
 */
export async function findLanding(targetRepo: string, base: string, tip: string, attemptSha: string): Promise<string | null> {
  try { await git(targetRepo, [...QUIET_GIT, "merge-base", "--is-ancestor", attemptSha, tip]); }
  catch { return null; }
  const lines = (await git(targetRepo, [...QUIET_GIT, "rev-list", "--first-parent", "--parents", `${base}..${tip}`])).trim().split("\n").filter(Boolean);
  const hit = lines.map((line) => line.split(" ")).find((parts) => parts[2] === attemptSha);
  if (hit === undefined) throw new ControlError("recovery-blocked", "landing-outcome-unknown");
  return hit[0]!;
}

export function markLanded(deps: ExecutionDriverDeps, runId: string, landedCommit: string): void {
  write(deps, () => {
    const run = readDriverRun(deps.store, runId);
    if (run.state !== "collected" && run.state !== "reconciling") return;
    run.state = "landed";
    landedWithPending(deps.store, run);
    run.drive = { ...run.drive!, landedCommit };
    saveDriverRun(deps.store, run);
  });
}

/**
 * Control run decisions: the refused decisions staged before the swap become pending only when the landing is
 * recorded, inside that same write transaction, so a run whose landing never completed leaves none behind. D
 * (markLanded) and R (finishReconcile) both land through here so the two cannot diverge; whatever else a landing
 * must move out of the drive record in that transaction belongs here too. The caller saves the run.
 *
 * Cross-plan resolution 3 (debug task plan Task 9): a debug run's staged closing record goes into its group's
 * `debug.closing` in the same write, so a moved-tip retry or a findLanding recovery neither repeats nor loses it.
 */
function landedWithPending(store: ControlStore, run: DriverRun): void {
  insertPendingDecisions(store, run.groupId, run.runId, (run.drive!.stagedPending ?? []) as PendingEntry[]);
  // Protect-acceptance-criteria spec §4.3: the flag lands with the decision it is on, in the same write.
  const criteria = run.drive!.stagedCriteriaFlag ?? null;
  if (criteria !== null) flagDecision(store, { ...criteria, groupId: run.groupId, runId: run.runId, source: "test-change", by: ORCHESTRATION_ACTOR, at: new Date(store.now()).toISOString() });
  const closing = run.drive!.stagedDebugClosing ?? null;
  if (closing !== null) {
    const group = readGroup(store, run.groupId) as GroupWithMark;
    // A staged record with no mark is unreachable: only debugClosingOf stages one, and only for a marked group (the mark
    // is written once at open and never removed). The guard keeps a group body from gaining a bare `debug` field.
    if (readDebugMark(group) !== null) saveGroup(store, { ...group, debug: { ...group.debug, closing } } as typeof group);
  }
  // Flow engine spec §6.2: a `dir` flow group's decisions go to `flow_decisions` in this same write, not to `.decisions/`.
  const flowDecisions = run.drive!.stagedFlowDecisions;
  if (flowDecisions !== undefined && flowDecisions.length > 0) writeFlowDecisions(store, run.groupId, flowDecisions as DecisionEvent[]);
  run.drive = { ...run.drive!, stagedPending: [], stagedDebugClosing: null, stagedCriteriaFlag: null, ...(flowDecisions === undefined ? {} : { stagedFlowDecisions: [] }) };
}

/** §6.2: one `flow_decisions` row per decision, graded as the ledger reads it (absent importance is major), by orca-auto. */
function writeFlowDecisions(store: ControlStore, groupId: string, events: readonly DecisionEvent[]): void {
  const flow = flowGroupOf(store, groupId);
  if (flow === null) throw new ControlError("recovery-blocked", `flow-group-missing:${groupId}`);
  for (const event of events) appendFlowDecision(store, { flowRunId: flow.flowRunId, grade: event.importance ?? "major", stepKey: flow.stepKey ?? "", body: event, by: ORCHESTRATION_ACTOR });
}

/** §6.2 recovery probe: the rows a landing of `runId` already wrote (only that write writes them, with the landing). */
function flowDecisionsWritten(store: ControlStore, groupId: string, runId: string): boolean {
  const flow = flowGroupOf(store, groupId);
  return flow !== null && store.db.prepare("SELECT 1 FROM flow_decisions WHERE flow_run_id=? AND json_extract(body,'$.run')=? LIMIT 1").get(flow.flowRunId, runId) !== undefined;
}

type GroupWithMark = ReturnType<typeof readGroup> & { debug: Record<string, unknown> };

/**
 * Control run decisions plan Task 7: E's first act for an empty result (deviation D14: no landing merge). The run's
 * ledger goes onto `orca/<groupId>` in a ledger-only commit `orca: decisions <runId>`; its refused entries are staged
 * before the swap and become pending in the same write that records `ledgerCommit`, through landedWithPending like D
 * and R. Nothing to write is no commit, and the pending entries are still inserted. A moved tip answers `moved`: the
 * next round writes again on the new tip.
 *
 * Crash recovery: a tip that already holds `.decisions/<runId>.jsonl` was moved by this run (only it writes that
 * file) before it could record so -- its newest first-parent `orca: decisions <runId>` commit is adopted, never a second.
 */
export async function recordEmptyResultDecisions(deps: ExecutionDriverDeps, runId: string): Promise<"settle" | "moved" | "blocked"> {
  const { store } = deps;
  const run = readDriverRun(store, runId);
  let targetRepo: string;
  try { targetRepo = deps.resolveRepository(groupRepoId(store, run.groupId)); }
  catch { blockRun(deps, runId, "E", "repository-path"); return "blocked"; }
  // Flow engine spec §6.2: a `dir` flow group makes no ledger-only commit; its decisions are written to `flow_decisions` in
  // the write that records the result, and a replay that finds them there writes none again.
  if (isDirFlowGroup(store, run.groupId)) {
    const { reported, evidence, at } = await runLedgerInputs(deps, runId);
    const { events, pending } = runLedgerEvents({ ledgerRun: runId, reported, codeAuthored: [], at, evidence });
    write(deps, () => {
      const current = readDriverRun(store, runId);
      if (current.state !== "landed") return;
      if (!flowDecisionsWritten(store, current.groupId, runId)) current.drive = { ...current.drive!, stagedPending: pending, stagedFlowDecisions: events };
      landedWithPending(store, current);
      current.drive = { ...current.drive!, ledgerCommit: null };
      saveDriverRun(store, current);
    });
    return "settle";
  }
  const name = `${runId}.jsonl`;
  const subject = `orca: decisions ${runId}`;
  const tip = await revParse(targetRepo, workBranchRef(run.groupId));
  let ledgerCommit: string | null;
  if (await hasPath(targetRepo, tip, `.decisions/${name}`)) {
    ledgerCommit = await findLedgerCommit(targetRepo, tip, subject);
  } else {
    // Final review I1: as D, no commit on the group branch while a sibling reconciles; the next round writes again.
    if (groupHasReconcilingRun(store, run.groupId)) return "moved";
    const result = await commitLedgerOnGroupBranch({
      repo: targetRepo, roots: deps.roots, groupId: run.groupId, worktreeName: `ledger-${runId}`, message: subject, beforeCas: deps.beforeCas,
      write: async (decisionsDir) => {
        const { reported, evidence, at } = await runLedgerInputs(deps, runId);
        const { writtenIds, pending } = await writeRunLedger(decisionsDir, { ledgerRun: runId, reported, codeAuthored: [], at, evidence });
        // Before the swap: a death after it adopts the commit and still has these to insert.
        stagePending(deps, runId, pending);
        return writtenIds.length > 0 ? [name] : [];
      },
    });
    if (result.kind === "moved") return "moved";
    ledgerCommit = result.kind === "swapped" ? result.commit : null;
    if (ledgerCommit !== null) deps.crash?.("E-after-ledger-cas");
  }
  write(deps, () => {
    const current = readDriverRun(store, runId);
    if (current.state !== "landed") return;
    landedWithPending(store, current);
    current.drive = { ...current.drive!, ledgerCommit };
    saveDriverRun(store, current);
  });
  return "settle";
}

/** Final review T7: no entry is absent; a git failure (a missing tip, a broken repository) throws, never reads as absent. */
export async function hasPath(repo: string, commit: string, path: string): Promise<boolean> {
  return (await git(repo, [...QUIET_GIT, "ls-tree", commit, "--", path])).trim() !== "";
}

async function findLedgerCommit(repo: string, tip: string, subject: string): Promise<string> {
  const lines = (await git(repo, [...QUIET_GIT, "log", "--first-parent", "--format=%H %s", tip])).split("\n");
  const hit = lines.find((line) => line.slice(41) === subject);
  if (hit === undefined) throw new ControlError("recovery-blocked", "ledger-commit-unknown");
  return hit.slice(0, 40);
}

/** Control run decisions: what a run's ledger is written from -- the decisions it reported, its evidence and the time. */
export async function runLedgerInputs(deps: ExecutionDriverDeps, runId: string): Promise<{ reported: ReportedDecisions; evidence: string[]; at: string }> {
  const run = readDriverRun(deps.store, runId);
  const reported = reportedDecisionsOf(await savedReport(deps.store, runId));
  // Ledger spec ERRATUM 8 (human ruling 2026-10-18): the attempt sha, never the landing commit.
  const evidence = runEvidence(runId, run.drive!.attemptSha!, await ccloopEvidenceString(deps.ccloopBin));
  return { reported, evidence, at: (deps.now?.() ?? new Date()).toISOString() };
}

/**
 * Control run decisions: the run's refused decisions, replacing whatever an earlier landing attempt staged. Debug task
 * plan Task 9: a debug run's closing record is staged (and replaced) with them; every other landing stages none.
 */
export function stagePending(deps: ExecutionDriverDeps, runId: string, pending: PendingEntry[], closing: ClosingRecord | null = null, criteria: CriteriaFlag | null = null, flowDecisions?: DecisionEvent[]): void {
  write(deps, () => {
    const run = readDriverRun(deps.store, runId);
    run.drive = { ...run.drive!, stagedPending: pending, stagedDebugClosing: closing, stagedCriteriaFlag: criteria, ...(flowDecisions === undefined ? {} : { stagedFlowDecisions: flowDecisions }) };
    saveDriverRun(deps.store, run);
  });
}

type CriteriaFlag = { decisionId: string; reason: string; evidence: string[] };

/**
 * Protect-acceptance-criteria spec §4 (as-built §8): a flagged change to the task's check-defining files gives the run's
 * `criteria` decision and the flag the landing writes; null when the attempt only added tests or left them alone.
 */
async function criteriaFlagOf(deps: ExecutionDriverDeps, run: DriverRun, repo: string, at: string, range?: { base: string; attempt: string }): Promise<{ decision: DecisionEvent; flag: CriteriaFlag } | null> {
  const base = range?.base ?? run.drive?.base, attempt = range?.attempt ?? run.drive?.attemptSha;
  if (run.taskId === null || base == null || attempt == null) return null;
  // Checks spec 2026-10-22 §6.1 step 4: a model review writes only its findings file; its check names that file.
  if (run.groupId.startsWith("sysreview-")) return null;
  const checks = readConfirmedTaskExecution(deps.store, run.groupId, run.taskId).contract.verification.requiredChecks;
  const change = await classifyCriteriaChange(repo, base, attempt, checks);
  if (!flagged(change)) return null;
  // Spec §4.2: a modification whose code also passes the base versions of the checks gives no notice; a failed (or
  // unrunnable, §7a.4) base run is named in the flag. A weakening is flagged either way and never re-run.
  const baseRun = run.drive?.criteriaBase ?? null;
  if (change.kind === "modified" && baseRun?.result === "passed") return null;
  const baseNote = change.kind === "modified" && baseRun?.result === "failed" ? [`base-run-failed: ${baseRun.command}`] : [];
  const decision = criteriaDecision(run.runId, run.groupId, base, { ...change, signals: [...change.signals, ...baseNote] }, at);
  const reason = `${change.kind === "weakening" ? "Checks weakened" : baseNote.length > 0 ? "Only the changed checks pass" : "Checks changed"} so they pass: ${[...change.signals, ...baseNote, ...change.files].join(", ")}`.slice(0, 2048);
  return { decision, flag: { decisionId: decision.id, reason, evidence: decision.evidence ?? [] } };
}

/** Debug task plan Task 9: the closing rows of a debug group's run, written beside its ledger; null for any other group. */
async function debugClosingOf(
  deps: ExecutionDriverDeps, run: DriverRun, repo: string, decisionsDir: string, base: string,
): Promise<{ written: string | null; record: ClosingRecord } | null> {
  if (readDebugMark(readGroup(deps.store, run.groupId)) === null) return null;
  return writeDebugClosing({
    store: deps.store, run, repo, decisionsDir, base, attemptSha: run.drive!.attemptSha!, now: () => deps.now?.() ?? new Date(),
  });
}

/**
 * Controller ruling P3 (2026-09-25): the one landing path D and R share. A detached worktree of the
 * driver's own at `old`; `produce` makes the commit to land in it (null: nothing to land, a conflict);
 * the work branch moves only by compare-and-swap from `old`; the worktree is removed whatever happens.
 */
type Landing = { kind: "not-produced" } | { kind: "moved" } | { kind: "swapped"; commit: string };

async function landOnTip(
  deps: ExecutionDriverDeps, targetRepo: string, runId: string, groupId: string, old: string,
  produce: (landing: string) => Promise<string | null>,
): Promise<Landing> {
  const landing = landingPathOf(deps.roots, runId);
  await removeOwnPath(targetRepo, deps.roots, landing);
  await git(targetRepo, [...QUIET_GIT, "worktree", "add", "--detach", landing, old]);
  try {
    const next = await produce(landing);
    if (next === null) return { kind: "not-produced" };
    await deps.beforeCas?.();
    return await compareAndSwap(targetRepo, workBranchRef(groupId), next, old) ? { kind: "swapped", commit: next } : { kind: "moved" };
  } finally {
    await removeOwnPath(targetRepo, deps.roots, landing);
  }
}

/**
 * D (spec §5.1-§5.2). The out-of-bounds check already ran in C. Here: merge the attempt into the
 * current tip in a fresh detached worktree, then swap the branch from that tip. A moved tip is not an
 * error -- the next round lands on the new one. A conflict goes to a reconciliation (spec §5.3).
 */
export async function stepD(deps: ExecutionDriverDeps, runId: string): Promise<boolean> {
  const { store } = deps;
  const run = readDriverRun(store, runId);
  if (run.state !== "collected" || run.drive?.attemptSha == null || run.drive.base === null) return false;
  // Handoff delivery spec §5.2 N2 (controller decision): at most one landing of a group is reconciling. A
  // sibling landing now would move the tip under it and make it land, and maybe pay, again.
  if (groupHasReconcilingRun(store, run.groupId)) return false;
  const drive = run.drive;
  let targetRepo: string;
  try { targetRepo = deps.resolveRepository(groupRepoId(store, run.groupId)); }
  catch { blockRun(deps, runId, "D", "repository-path"); return true; }
  const old = await revParse(targetRepo, workBranchRef(run.groupId));
  const already = await findLanding(targetRepo, drive.base!, old, drive.attemptSha!);
  if (already !== null) { markLanded(deps, runId, already); return true; }
  const landed = await landOnTip(deps, targetRepo, runId, run.groupId, old, async (landing) => {
    // Into the target's shared refs: the incoming ref is how the attempt stays reachable until settle.
    await git(landing, [...QUIET_GIT, "fetch", "--no-tags", join(drive.sourceDir, "repo"), `+${drive.attemptSha}:${incomingRefOf(runId)}`]);
    try {
      await git(landing, [...QUIET_GIT, ...ORCA_IDENTITY, "merge", "--no-ff", "--no-commit", incomingRefOf(runId)]);
    } catch {
      await git(landing, [...QUIET_GIT, "merge", "--abort"]).catch(() => undefined);
      return null;
    }
    // Control run decisions: the run's ledger lands inside its own merge commit. MERGE_HEAD keeps the commit below the
    // same two-parent merge, so findLanding still names it. `-f`: a target that ignores .decisions/ still gets it.
    const { reported, evidence, at } = await runLedgerInputs(deps, runId);
    // Protect-acceptance-criteria spec §4: what the attempt did to the files that define its checks, read from git.
    const criteria = await criteriaFlagOf(deps, run, landing, at);
    const codeAuthored = criteria === null ? [] : [criteria.decision];
    // Flow engine spec §6.2: a `dir` flow group's decisions are staged for `flow_decisions`; its landing commits no ledger file.
    let flowDecisions: DecisionEvent[] | undefined, pending: PendingEntry[];
    if (isDirFlowGroup(store, run.groupId)) ({ events: flowDecisions, pending } = runLedgerEvents({ ledgerRun: runId, reported, codeAuthored, at, evidence }));
    else {
      const ledger = await writeRunLedger(join(landing, ".decisions"), { ledgerRun: runId, reported, codeAuthored, at, evidence });
      pending = ledger.pending;
      if (ledger.writtenIds.length > 0) await git(landing, [...QUIET_GIT, "add", "-f", join(".decisions", `${runId}.jsonl`)]);
    }
    // Debug task plan Task 9: a debug run's closing rows ride the same commit (same -f).
    const closing = await debugClosingOf(deps, run, targetRepo, join(landing, ".decisions"), old);
    if (closing?.written != null) await git(landing, [...QUIET_GIT, "add", "-f", join(".decisions", closing.written)]);
    await git(landing, [...QUIET_GIT, ...ORCA_IDENTITY, "commit", "--no-edit", "-m", `orca: land ${runId}`]);
    // Before the swap: a death after it finds the landing, skips this produce and still has these for markLanded.
    stagePending(deps, runId, pending, closing?.record ?? null, criteria?.flag ?? null, flowDecisions);
    return revParse(landing, "HEAD");
  });
  if (landed.kind === "not-produced") return beginReconcile(deps, runId, targetRepo, old);
  // A moved tip only (final review I2): any other failed swap threw from compareAndSwap and blocks the run.
  if (landed.kind === "moved") return false;
  deps.crash?.("D-after-cas");
  markLanded(deps, runId, landed.commit);
  return true;
}

/**
 * spec §5.3(2), deviation D11: the other side is a run of this group that landed after this run's
 * base and whose own change (base..its attempt, the landing's second parent) touches a conflicted
 * path. Exactly one, or the reconciliation would carry a side this driver picked.
 *
 * Handoff delivery spec §5.2 N1 (controller decision, 2026-09-25): every such task, sorted by task id, so
 * the reconciliation carries all of them and none is picked. None is still an escalation: the conflict
 * then comes from a commit no run of this group landed.
 */
export async function otherSideOfWeb(store: ControlStore, targetRepo: string, run: DriverRun, conflictedPaths: readonly string[]): Promise<{ taskIds: string[] } | { escalate: string }> {
  const conflicted = new Set(conflictedPaths);
  const touched = new Set<string>();
  for (const row of store.db.prepare("SELECT body FROM runs WHERE group_id=? ORDER BY id").all(run.groupId)) {
    const other = JSON.parse(String(row.body)) as DriverRun;
    const landed = other.drive?.landedCommit;
    if (other.runId === run.runId || other.taskId === null || landed == null || other.drive?.base == null) continue;
    try {
      await git(targetRepo, [...QUIET_GIT, "merge-base", "--is-ancestor", landed, run.drive!.base!]);
      continue;
    } catch (error) {
      // Exit 1 is git's "not an ancestor": landed after this run's base, a candidate. Anything else
      // (128: a missing object, a broken repository) is an error, not an answer (fix round 1, m7).
      if ((error as { code?: unknown }).code !== 1) throw error;
    }
    const changed = await netChangeSet(targetRepo, other.drive.base, `${landed}^2`);
    if (changed.some((path) => conflicted.has(path))) touched.add(other.taskId);
  }
  return touched.size === 0 ? { escalate: "0" } : { taskIds: [...touched].sort() };
}

/** spec §5.3(5), deviation D12: a read-only check, not a reservation (registered as a known gap). */
export function reconcileAffordable(store: ControlStore, groupId: string, tokenBudget: number): boolean {
  const group = readGroup(store, groupId);
  const available=budgetBalance(group.limit, group.used, group.reserved).reserve.tokens;
  return (available===null||available>=tokenBudget)&&claimCapBlocking(store,groupId,tokenBudget,store.now())===null;
}

/**
 * spec §5.3(1)-(5): re-create the conflict in a clone of the target (its `origin` is the target, which
 * `materialiseConflict` fetches from), name the other side, synthesize a contract carrying both sides,
 * and check the group can afford it -- all before anything is spent.
 */
async function beginReconcile(deps: ExecutionDriverDeps, runId: string, targetRepo: string, old: string): Promise<boolean> {
  const { store, roots } = deps;
  const run = readDriverRun(store, runId);
  const copy = conflictPathOf(roots, runId);
  await removeOwnPath(targetRepo, roots, copy);
  await git(roots.workspacesRoot, [...QUIET_GIT, "clone", "--local", "--no-checkout", targetRepo, copy]);
  const conflict = await materialiseConflict(copy, old, incomingRefOf(runId));
  await pinConflictCommit(copy, runId, conflict.conflictCommit);
  const other = await otherSideOfWeb(store, targetRepo, run, conflict.conflictedPaths);
  if ("escalate" in other) { blockRun(deps, runId, "D", `reconcile-other-side:${other.escalate}`); return true; }
  const others = other.taskIds;
  const contracts = new Map<string, unknown>(
    [run.taskId!, ...others].map((taskId) => [taskId, readConfirmedTaskExecution(store, run.groupId, taskId).contract]),
  );
  const runsDir = privateDirectory(reconcileRunsDirOf(roots, runId));
  // A reconciliation reset by a moved tip left its terminal loop state here; a new one must not collect
  // it. Measured (handoff delivery Task 6): it did, and landed a tree built on the old tip.
  await rm(join(runsDir, `reconcile-${runId}`), { recursive: true, force: true });
  const side = (taskId: string): PlanTask => ({ taskId, contract: "", dependsOn: [] });
  const synthesized = await synthesizeReconcileContractOf(side(run.taskId!), others.map(side), contracts, runsDir, conflict);
  if ("escalate" in synthesized) { blockRun(deps, runId, "D", `reconcile-contract:${synthesized.escalate}`); return true; }
  const tokenBudget = (JSON.parse(await readFile(synthesized.path, "utf8")) as { executionPolicy: { tokenBudget: number } }).executionPolicy.tokenBudget;
  if (!reconcileAffordable(store, run.groupId, tokenBudget)) { blockRun(deps, runId, "D", "reconcile-budget"); return true; }
  const record: ReconcileRecord = {
    copyPath: copy, old, conflictCommit: conflict.conflictCommit, conflictedPaths: conflict.conflictedPaths, otherTaskId: others[0]!, otherTaskIds: others,
    reconcileRunId: `reconcile-${runId}`, runsDir, contractPath: synthesized.path, tokenBudget, spawning: false, pid: null, outcome: null, attemptSha: null,
    // Handoff delivery spec §11 I7, §13.2 I-6: the spawn key is monotonic per run. A moved-tip reset clears
    // this record, so it resumes from the spawns already booked instead of from 0 (a booked key collides).
    // Controller ruling D-SPAWNKEY (2026-09-25): MAX of the booked spawn numbers, not a row count -- a spawn
    // whose process died unbooked would make a count collide with a booked key.
    spawnSeq: Number(store.db.prepare("SELECT COALESCE(MAX(CAST(substr(id, ?) AS INTEGER)), 0) AS n FROM outbox WHERE id LIKE ?")
      .get(`reconcile-usage:${runId}:spawn-`.length + 1, `reconcile-usage:${runId}:spawn-%`)!.n),
    // Control run decisions plan Task 6: the reconcile decision names the blocks; only where they are is kept.
    conflictBlocks: conflict.blocks.map(({ path, startLine, endLine }) => ({ path, startLine, endLine })),
  };
  return write(deps, () => {
    const current = readDriverRun(store, runId);
    if (current.state !== "collected") return false;
    current.state = "reconciling";
    current.drive = { ...current.drive!, reconcile: record };
    saveDriverRun(store, current);
    return true;
  });
}

export type ReconcileAction = "collect" | "wait" | "orphan" | "spawn";

/**
 * spec §5.3(6), deviation D17. A terminal loop state is collected; a recorded live process is waited
 * on; a spawn that was begun but whose process id never got recorded may still be running somewhere,
 * so it is blocked rather than run twice; anything else is (re)spawned.
 *
 * Final review I4: `collected` says the terminal loop state on disk was already collected and refused
 * (its outcome is recorded) -- a person's retry then means run it again, so it is discarded and respawned.
 */
export function reconcileNextAction(input: { loopStatus: string | null; spawning: boolean; pid: number | null; alive: boolean; collected?: boolean }): ReconcileAction {
  if (input.loopStatus !== null && TERMINAL_OUTCOMES.includes(input.loopStatus)) {
    if (input.collected !== true) return "collect";
    return input.pid !== null && input.alive ? "wait" : "spawn";
  }
  if (input.pid !== null && input.alive) return "wait";
  if (input.spawning && input.pid === null) return "orphan";
  return "spawn";
}

export function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

export function readLoopState(loopDir: string): { status: string | null; tokenBudgetRemaining: number | null } {
  const path = join(loopDir, "loop-state.json");
  if (!existsSync(path)) return { status: null, tokenBudgetRemaining: null };
  try {
    const state = JSON.parse(readFileSync(path, "utf8")) as { status?: unknown; budgetSnapshot?: { tokenBudgetRemaining?: unknown } };
    const remaining = state.budgetSnapshot?.tokenBudgetRemaining;
    return { status: typeof state.status === "string" ? state.status : null, tokenBudgetRemaining: typeof remaining === "number" ? remaining : null };
  } catch { return { status: null, tokenBudgetRemaining: null }; }
}

/** Control run decisions plan Task 6: the whole loop state, for what the reconciling agent reported; null if unreadable. */
export function readLoopStateRaw(loopDir: string): unknown {
  try { return JSON.parse(readFileSync(join(loopDir, "loop-state.json"), "utf8")) as unknown; }
  catch { return null; }
}

/**
 * spec §5.3(5), deviation D18: `ccloop run` reports no usage events, so the reconciliation's token
 * spend is read off its loop state and booked on the group once per spawn, whatever the spawn ended
 * as (spec §5.3(5); fix round 1, I1), keeping the Web ledger mirror in step. `spawnKey` names the
 * spawn by its persisted sequence number (final review I4), so a retry never books one twice and a new
 * spawn is always booked.
 */
export function recordReconcileUsage(deps: ExecutionDriverDeps, groupId: string, runId: string, spawnKey: string, tokens: number): void {
  write(deps, () => {
    const id = `reconcile-usage:${runId}:${spawnKey}`;
    if (deps.store.db.prepare("SELECT id FROM outbox WHERE id=?").get(id)) return;
    const group = readGroup(deps.store, groupId);
    group.used = add(group.used, { tokens, activeMs: 0, attempts: 1, sessions: 1 });
    bookReconcileUsage(deps.store, { runId, groupId, groupBody: group as unknown as Record<string, unknown>, tokens, appliedAt: deps.now?.().getTime() ?? Date.now() });
    syncWebBudget(deps.store, group, readRun(deps.store, runId));
    group.budgetVersion += 1;
    saveGroup(deps.store, group);
    deps.store.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?,'reconcile-usage',?,1)")
      .run(id, canonicalBytes({ groupId, runId, spawnKey, tokens }).toString("utf8"));
  });
}

/**
 * R (spec §5.3(6)-(7)). The reconciliation `ccloop run` is never awaited inside a round: it runs in
 * the background and every round looks at its loop state. Its process id is recorded as soon as it
 * exists, so a restarted driver waits on it instead of starting a second one.
 */
export async function stepR(deps: ExecutionDriverDeps, runId: string, context: DriverContext): Promise<boolean> {
  const { store } = deps;
  if (context.reconciling.has(runId)) return false;
  const run = readDriverRun(store, runId);
  const record = run.drive?.reconcile;
  if (run.state !== "reconciling" || record == null) return false;
  const workdir = join(record.runsDir, record.reconcileRunId);
  const loop = readLoopState(loopDirOf(workdir, record.reconcileRunId));
  const action = reconcileNextAction({
    loopStatus: loop.status, spawning: record.spawning, pid: record.pid, alive: record.pid !== null && processAlive(record.pid), collected: record.outcome !== null,
  });
  if (action === "wait") return false;
  if (action === "orphan") { blockRun(deps, runId, "R", "reconcile-orphan-unknown"); return true; }
  if (action === "collect") return finishReconcile(deps, runId, record, loop, await latestAttemptSha(cloneDirOf(workdir), record.reconcileRunId));
  if (context.stopped || deps.admissionGate?.draining) return false;
  if (!reconcileAffordable(store, run.groupId, record.tokenBudget)) { blockRun(deps, runId, "R", "reconcile-budget"); return true; }
  // Agent selection spec §6.1, §4.9 (plan T12, P9): a reconciliation runs with the GROUP's reconcile slot, frozen at
  // confirm (plan T11) -- never the conflicted run's own worker selection. Spec §6.4 step 4 (P14, wave 3 ruling I-2):
  // it is read through the confirmed snapshot's authority, which also proves the group record still agrees; a group
  // with no such slot, or one whose record has moved away from the snapshot, is refused here rather than run with
  // some other selection.
  let reconcileSlot: FrozenSlot;
  try { reconcileSlot = readConfirmedReconcileSlot(store, run.groupId); }
  catch (error) {
    if (!(error instanceof ControlError)) throw error;
    blockRun(deps, runId, "R", "reconcile-agent-unfrozen");
    return true;
  }
  await rm(workdir, { recursive: true, force: true });
  const setRecord = (patch: Partial<ReconcileRecord>): void => write(deps, () => {
    const current = readDriverRun(store, runId);
    current.drive = { ...current.drive!, reconcile: { ...current.drive!.reconcile!, ...patch } };
    saveDriverRun(store, current);
  });
  setRecord({ spawning: true, pid: null, outcome: null, attemptSha: null, spawnSeq: (record.spawnSeq ?? 0) + 1 });
  const plan: PlanFile = { targetRepo: record.copyPath, ccloopBin: deps.ccloopBin, runsDir: record.runsDir, workBranch: `orca/${run.groupId}`, policy: "local-merge", ledgerMode: "out-of-repo", tasks: [] };
  const task: PlanTask = { taskId: record.reconcileRunId, contract: record.contractPath, dependsOn: [] };
  const running = runTask(plan, task, record.conflictCommit, record.reconcileRunId, {
    // Agent selection spec §4.9: ccloop materializes this selection against the table and refuses to run when the
    // hash or the installed version no longer matches.
    agentsTable: deps.agentsTablePath, agentSelection: { selection: reconcileSlot.selection, configHash: reconcileSlot.configHash },
    // Final review I3: its own process group, output in files inside its runs dir, unref'd -- the panel
    // closing (or a Ctrl-C to its process group) does not end it, and a restarted driver waits on its pid.
    detachedLogDir: workdir, dispatchedPersonDir: deps.dispatchedPersonDir,
    // Recorded even after stop(): the child is ours, and a restart can only wait on a pid it can read
    // (fix round 1, m2). A refused write (a draining panel) is logged; the restart then sees an orphan.
    onSpawn: (pid) => {
      try { setRecord({ pid }); }
      catch (error) { process.stderr.write(`orca-driver: ${runId}: reconciliation pid ${pid} not recorded: ${describeError(error)}\n`); }
    },
  }).then(
    () => undefined,
    (error: unknown) => {
      // Controller ruling P7: only a run still reconciling is blocked from here, never one moved on since.
      // Plan T6 ruling: a refusal (`ccloop run --agents` exit 1 naming a code) is blocked under ccloop's own code. An
      // exit 1 that names none is not known to be a refusal and stays a spawn failure with the stderr head (fix round 1).
      const reason = error instanceof AgentsRunRefused && error.refusal !== null ? `reconcile-refused:${error.refusal}` : `reconcile-spawn:${describeError(error)}`;
      if (!context.stopped && readDriverRun(store, runId).state === "reconciling") blockRun(deps, runId, "R", reason);
    },
  ).catch(() => undefined).finally(() => { context.reconciling.delete(runId); });
  context.reconciling.set(runId, running);
  return true;
}

/** spec §5.3(7): markers are refused by code; the reconciled tree becomes an ordinary merge, landed by CAS. */
async function finishReconcile(
  deps: ExecutionDriverDeps, runId: string, record: ReconcileRecord,
  loop: { status: string | null; tokenBudgetRemaining: number | null }, attemptSha: string | null,
): Promise<boolean> {
  const { store } = deps;
  const run = readDriverRun(store, runId);
  const outcomePatch = { reconcile: { ...record, outcome: loop.status } };
  // Booked before any refusal: a failed or marker-leaving reconciliation spent its tokens too (fix
  // round 1, I1). No `tokenBudgetRemaining` means the spend is unknown, so the whole budget is booked (m4).
  const spent = loop.tokenBudgetRemaining === null ? record.tokenBudget : Math.max(0, record.tokenBudget - loop.tokenBudgetRemaining);
  recordReconcileUsage(deps, run.groupId, runId, `spawn-${record.spawnSeq ?? 0}`, spent);
  if (loop.status !== "succeeded" || attemptSha === null) { blockRun(deps, runId, "R", `reconcile-terminal:${loop.status}`, outcomePatch); return true; }
  const workdir = join(record.runsDir, record.reconcileRunId);
  await git(record.copyPath, [...QUIET_GIT, "fetch", "--no-tags", cloneDirOf(workdir), `+${attemptSha}:refs/orca/reconciled/${runId}`]);
  const remaining = await markersRemaining(record.copyPath, attemptSha, record.conflictedPaths);
  if (remaining.length > 0) { blockRun(deps, runId, "R", `markers-remaining:${remaining.join(",")}`, outcomePatch); return true; }
  let targetRepo: string;
  try { targetRepo = deps.resolveRepository(groupRepoId(store, run.groupId)); }
  catch { blockRun(deps, runId, "R", "repository-path"); return true; }
  let tree = (await git(record.copyPath, [...QUIET_GIT, "rev-parse", `${attemptSha}^{tree}`])).trim();
  // Control run decisions plan Task 6: the merge holds the run's own ledger and the reconciliation's, written onto the
  // reconciled tree's `.decisions/` through a temporary index (ledgerTree.ts); the refused entries of both are staged.
  const ledgerDir = await mkdtemp(join(record.runsDir, "ledger-"));
  // Kanban spec 2026-10-20 §3.5: the reconciliation's own decision (what each side changed, how they were merged) is
  // flagged for the person when the landing is recorded -- the conflict was resolved without them, they learn of it.
  let reconcileFlag: { decisionId: string; reason: string; evidence: string[] } | null = null;
  let criteria: Awaited<ReturnType<typeof criteriaFlagOf>> = null;
  try {
    await exportLedgerDir(record.copyPath, tree, ledgerDir);
    const { reported, evidence, at } = await runLedgerInputs(deps, runId);
    // Protect-acceptance-criteria spec §7: what lands here is the tip..reconciled change (the run's own work and how the
    // conflict was resolved), so it goes through the same detection as a plain landing.
    criteria = await criteriaFlagOf(deps, run, record.copyPath, at, { base: record.old, attempt: attemptSha });
    const own = await writeRunLedger(ledgerDir, { ledgerRun: runId, reported, codeAuthored: criteria === null ? [] : [criteria.decision], at, evidence });
    const reconcileEvidence = runEvidence(record.reconcileRunId, attemptSha, await ccloopEvidenceString(deps.ccloopBin));
    const otherTaskIds = record.otherTaskIds ?? [record.otherTaskId];
    const blocks = record.conflictBlocks;
    // A record written before conflictBlocks existed: no template rather than a false "0 block(s)" line.
    if (blocks === undefined) process.stderr.write(`orca-driver: ${runId}: reconcile decision skipped: record predates conflictBlocks\n`);
    const codeAuthored = blocks === undefined ? [] : [{
      ...reconcileDecision(record.reconcileRunId, 1, run.taskId!, otherTaskIds, {
        conflictedPaths: record.conflictedPaths, conflictCommit: record.conflictCommit, copyPath: record.copyPath, wTip: record.old, blocks,
      }, `orca/${run.groupId}`, at),
      evidence: reconcileEvidence,
    }];
    if (codeAuthored.length > 0) {
      reconcileFlag = {
        decisionId: codeAuthored[0]!.id,
        reason: `landed by merging a conflict with ${otherTaskIds.join(", ")} in ${record.conflictedPaths.join(", ")}`.slice(0, 2048),
        evidence: [`reconcile ${record.reconcileRunId}`, `attempt ${attemptSha}`, ...record.conflictedPaths.slice(0, 30)],
      };
    }
    const reconciler = await writeRunLedger(ledgerDir, {
      ledgerRun: record.reconcileRunId, reported: reportedDecisionsOf(readLoopStateRaw(loopDirOf(workdir, record.reconcileRunId))),
      codeAuthored, at, evidence: reconcileEvidence,
    });
    // Debug task plan Task 9: a debug run's closing rows join the same tree (its integration target is read in targetRepo).
    const closing = await debugClosingOf(deps, run, targetRepo, ledgerDir, record.old);
    const names = [
      ...(own.writtenIds.length > 0 ? [`${runId}.jsonl`] : []),
      ...(reconciler.writtenIds.length > 0 ? [`${record.reconcileRunId}.jsonl`] : []),
      ...(closing?.written != null ? [closing.written] : []),
    ];
    if (names.length > 0) tree = await treeWithLedgerFiles(record.copyPath, tree, ledgerDir, names);
    // By replacement, before the swap: a D attempt that staged items and then conflicted left them stale on the run.
    stagePending(deps, runId, [...own.pending, ...reconciler.pending], closing?.record ?? null, criteria?.flag ?? null);
  } finally {
    await rm(ledgerDir, { recursive: true, force: true });
  }
  const merged = await rebuildMergeCommit(record.copyPath, record.old, incomingRefOf(runId), tree, `orca: land ${runId} (reconciled with ${(record.otherTaskIds ?? [record.otherTaskId]).join(", ")})`);
  await git(record.copyPath, [...QUIET_GIT, "update-ref", `refs/orca/merged/${runId}`, merged]);
  const landed = await landOnTip(deps, targetRepo, runId, run.groupId, record.old, async (landing) => {
    // A bare sha is fetchable because refs/orca/merged/<runId> advertises it in the copy.
    await git(landing, [...QUIET_GIT, "fetch", "--no-tags", record.copyPath, merged]);
    return merged;
  });
  const swapped = landed.kind === "swapped";
  return write(deps, () => {
    const current = readDriverRun(store, runId);
    if (current.state !== "reconciling") return false;
    if (!swapped) {
      // The tip moved while the reconciliation ran, so its merge has a stale first parent: land again. Only a
      // moved tip gets here; a swap that failed otherwise threw and blocks the run at R (final review I2).
      current.state = "collected";
      current.drive = { ...current.drive!, reconcile: null };
    } else {
      current.state = "landed";
      landedWithPending(store, current);
      if (reconcileFlag !== null) {
        flagDecision(store, { ...reconcileFlag, groupId: current.groupId, runId, source: "reconcile", by: ORCHESTRATION_ACTOR, at: new Date(store.now()).toISOString() });
      }
      current.drive = { ...current.drive!, landedCommit: merged, reconcile: { ...current.drive!.reconcile!, outcome: loop.status, attemptSha } };
    }
    saveDriverRun(store, current);
    return true;
  });
}
