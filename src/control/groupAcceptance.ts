import { recordActivity } from "./activity.js";
import { isGroupArchived } from "./archivedMark.js";
import { runCheckRecorded, type CheckFailure, type PostMergeOutcome } from "./checkCommand.js";
import { acceptanceSetupDigest, readAcceptanceBaselineShape, readAcceptanceFailureIdentities, recordAcceptanceFailureIdentities, type AcceptanceFailureIdentity } from "./acceptanceFailureIdentity.js";
import { existingTestChanges, type ExistingTestChanges } from "./acceptanceTestChanges.js";
import { groupRepoId, isDirGroup } from "./dirGroup.js";
import { readConfirmedTaskExecution } from "./executionSnapshot.js";
import { isMultiGroup } from "./multiGroup.js";
import { recordProjectionChange } from "./projectionJournal.js";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { QUIET_GIT, groupAcceptancePathOf, isGroupAcceptancePathOf, removeOwnPath, workBranchTip, type WorkspaceRoots } from "./workspace.js";
import { unionSetup } from "./setupUnion.js";
import { isDirFlowGroup } from "../flow/groups.js";
import { git } from "../scheduler/gitExec.js";
import type { AdmissionGate } from "./admissionGate.js";
import { acceptanceOf, groupBaseCommit, landedRunCount, landedTaskCount, maxLandingsWithoutAcceptance, type AcceptanceEvidence, type AcceptanceIdentityComparison, type FullSuiteRecord, type GroupAcceptance } from "./groupAcceptanceRecord.js";
import { fullSuiteCommand, suggestFullSuiteCommand } from "./fullSuite.js";
import { readPreexistingFailures } from "./preexistingFailure.js";
import { loadSuiteCountBaselineOnce, type SuiteCountBaseline, type SuiteCountBaselineKey } from "./acceptanceSuiteBaseline.js";
import type { ControlStore } from "./store.js";

/**
 * Tester follow-up E §5 (#241): a group is accepted on its final tree before it is delivered and done. Each task's required
 * checks ran on its own attempt's tree, and (ruling R2) on its merge; a later landing can still break an earlier task's
 * checks unseen -- the tester's group had every task done while its final `npm test` failed. Overrides review-exit spec
 * 2026-11-05 §3.1 D1 ("all tasks done and landed => done automatically"): done also needs a satisfied acceptance.
 *
 * A pass by code (Rule 5), every driver round before the integration pass. For each group whose tasks are all done with
 * no active run: the union of the done tasks' setup commands, then the union of their required checks (each once, first
 * seen order), in a scratch worktree at the tip of `orca/<g>`, off the round (as the post-merge check), each command bounded
 * by the longest `perAttemptTimeoutMs` among the tasks. The outcome is kept on the group body as `acceptance`, keyed by the
 * tip it ran on, so a restart does not run again what is recorded for the current tip, and a tip that moved (a retried task,
 * a person's fix) is checked again. Not needed when at most one task landed (its own checks ran on that tree); a
 * multi-directory or folder group is recorded `not-run` (no group-wide check runs on it; since #337 its requirement review
 * judges each work branch instead, and a review that does not pass is noted without holding the group). passed, failed and waived
 * write a `group-acceptance` activity row; not-needed and not-run write the record only (as §4's post-merge record).
 *
 * Tester #278: a work branch that does not exist (deleted after delivery, say) is a recorded state, not an error retried
 * every round: `not-run: work-branch-missing`, keyed by the runs landed so far, so later rounds skip the group without a
 * git child until a new landing. Any other failure (a lock, a repository that does not resolve) is tried again next round
 * and logged once per distinct message per group, not every round.
 *
 * Full suite spec 2026-11-12 (#279): after a green union, the project's full-suite command (its integration-check command,
 * fullSuite.ts) runs once in the same tree and bound, once more if red: green on the retry passes as flaky, red twice
 * fails. With it set, one landing is checked too. With none set, nothing more runs and the record names the suggestion.
 * Tester #383 (2026-11-20): task runs that reported the suite red make a green first run insufficient -- it runs twice
 * anyway, and both greens are recorded flaky; the reports are evidence the suite has been red.
 */
export * from "./groupAcceptanceRecord.js";

/** Writes (or removes) the record inside the caller's transaction, re-reading the body there. */
export function saveAcceptance(store: ControlStore, groupId: string, record: GroupAcceptance | null): void {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  if (row === undefined) return;
  const body = JSON.parse(String(row.body)) as Record<string, unknown>;
  if (record === null) delete body.acceptance; else body.acceptance = record;
  store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(body), groupId);
  recordProjectionChange(store, [groupId]);
}

/**
 * `done` settles once the check is over, its scratch worktree removed included (driver stop() waits on it). `suite`: the
 * full-suite command it runs after the union (full suite spec 2026-11-12 §4), null when none was set as it started.
 */
export interface GroupAcceptanceCheck { controller: AbortController; tip: string; suite: string | null; base: string; testChanges: ExistingTestChanges; settled: { outcome: AcceptanceOutcome } | { error: unknown } | null; done: Promise<void> }
/** The union's outcome and, after it, the full suite's: each of its runs' exits (empty when it did not run). */
export interface AcceptanceOutcome extends PostMergeOutcome {
  suiteExits: string[];
  /** Tester #383 (2026-11-20): task runs that had already reported this suite red when the check started. */
  reported?: number;
  /** Tester #387 (2026-11-20): what the suite's last run said it ran (`# tests N`), null when it said nothing. */
  tests?: number | null;
  /** Tester #387: where the suite ran and what the tip tree held there (the base's counts are filled once it runs). */
  evidence?: AcceptanceEvidence;
  /** Spec 2026-11-16: the suite's runs at the group's base, when the tip was red. */
  baseline?: { tip: string; exits: string[]; failure: CheckFailure | null; tests?: number | null };
  identityComparisons?: AcceptanceIdentityComparison[];
}

export interface GroupAcceptanceDeps {
  store: ControlStore; roots: WorkspaceRoots; resolveRepository: (repoId: string) => string;
  dispatchedPersonDir?: string; admissionGate?: AdmissionGate;
  write: <T>(action: () => T) => T; stopped: () => boolean;
  /** Test seam: awaited after a check's commands, before its scratch worktree is removed (a slow removal, on demand). */
  beforeScratchRemoved?: (path: string) => Promise<void>;
}

/**
 * Tester follow-up F §5 (w5): every check has its own scratch worktree. A check aborted because the tip moved is not waited
 * for, so its removal can still be running when the next check starts; with one shared path it removed the next check's
 * tree. `checkSeq` names them; `inUse` holds the paths whose check has not finished removing them, which the sweep before
 * each start leaves alone. Anything else of this group's (a crash's leftover, round E's single path) is removed there.
 */
let checkSeq = 0;
const inUse = new Set<string>();
/**
 * #278: per owner (a driver's checks map, or the store for a pass without one) and pass, the failure last logged for each
 * group; a round without one clears it, so the same failure coming back later is logged again.
 */
interface SuiteBaselineLoad { baseline: SuiteCountBaseline | null; commands: PostMergeOutcome["commands"] }

async function loadSuiteBaseline(
  deps: GroupAcceptanceDeps, repo: string, groupId: string, key: SuiteCountBaselineKey, setup: string[], timeoutMs: number, signal: AbortSignal,
  as: { runId: string; personDir?: string },
): Promise<SuiteBaselineLoad> {
  const commands: PostMergeOutcome["commands"] = [];
  const loaded = await loadSuiteCountBaselineOnce(deps.store, key, async () => runOnScratchTip(
    deps, repo, groupAcceptancePathOf(deps.roots, groupId, ++checkSeq),
    (name) => isGroupAcceptancePathOf(name, groupId), key.base, async (tree) => {
      for (const command of setup) {
        const started = performance.now();
        const answer = await runCheckRecorded(tree, command, timeoutMs, as, signal);
        commands.push({ command: `baseline setup: ${command}`, exit: answer.exit, ms: Math.round(performance.now() - started) });
        if (answer.exit !== "0") return null;
      }
      const started = performance.now();
      const answer = await runCheckRecorded(tree, key.command, timeoutMs, as, signal);
      commands.push({ command: `baseline: ${key.command}`, exit: answer.exit, ms: Math.round(performance.now() - started) });
      if (!/^\d+$/.test(answer.exit)) return null;

      const tests = testsRan(answer.tail);
      if (answer.exit !== "0" && answer.failureIdentityStatus === "complete" && (answer.failureIdentities?.length ?? 0) > 0) {
        deps.write(() => recordAcceptanceFailureIdentities(deps.store, {
          ...key, identities: answer.failureIdentities!, source: "group-acceptance", groupId,
          runId: as.runId, at: deps.store.now(), tests, exit: answer.exit,
        }));
      }
      return {
        state: tests === null ? "unavailable" : "counted", tests, exit: answer.exit,
        source: "base-suite", observedAt: deps.store.now(),
      };
    },
  ));
  return { baseline: loaded.baseline, commands: loaded.loaded ? commands : [] };
}

/**
 * #278: per owner (a driver's checks map, or the store for a pass without one) and pass, the failure last logged for each
 * group; a round without one clears it, so the same failure coming back later is logged again.
 */
const logged = new WeakMap<object, Map<string, string>>();

export function logGroupFailureOnce(owner: object, pass: string, groupId: string, error: unknown): void {
  const last = logged.get(owner) ?? new Map<string, string>();
  logged.set(owner, last);
  const message = error instanceof Error ? error.message : String(error), key = `${pass}\0${groupId}`;
  if (last.get(key) === message) return;
  last.set(key, message);
  process.stderr.write(`orca-driver: group ${groupId}: ${pass}: ${message}\n`);
}
export function clearGroupFailure(owner: object, pass: string, groupId: string): void {
  logged.get(owner)?.delete(`${pass}\0${groupId}`);
}

/**
 * #278 (and follow-up I for the landing watch and the requirement review): the work branch was recorded missing and no
 * run landed since -- nothing to look at, and no git child to find that out again. A DB read.
 */
export function workBranchKnownMissing(store: ControlStore, groupId: string, body: unknown): boolean {
  const recorded = acceptanceOf(body);
  return recorded?.why === "work-branch-missing" && recorded.landings === landedRunCount(store, groupId);
}

/**
 * #278: a missing work branch is the acceptance record `not-run: work-branch-missing`, keyed by the runs landed so far,
 * whichever pass found it (acceptance, landing watch, requirement review): one record, shown in `group show` and Problems,
 * and one stderr line. Every pass skips the group (workBranchKnownMissing) until a new landing.
 */
export function recordWorkBranchMissing(deps: Pick<GroupAcceptanceDeps, "store" | "write">, groupId: string, pass: string): void {
  const { store } = deps;
  deps.write(() => saveAcceptance(store, groupId, { tip: null, result: "not-run", why: "work-branch-missing", landings: landedRunCount(store, groupId), commands: [], at: store.now() }));
  process.stderr.write(`orca-driver: group ${groupId}: ${pass}: not run, orca/${groupId} does not exist (checked again after a new landing)\n`);
}

/** Every task done and no run of any phase active (integrationPass.ts groupComplete, read here to stay off its imports). */
function tasksComplete(store: ControlStore, groupId: string): boolean {
  const tasks = store.db.prepare("SELECT body FROM work_items WHERE group_id=?").all(groupId)
    .map((row) => JSON.parse(String(row.body)) as { kind?: string; status?: string }).filter((work) => work.kind === "task");
  if (tasks.length === 0 || tasks.some((work) => work.status !== "done")) return false;
  return store.db.prepare("SELECT 1 FROM runs WHERE group_id=? AND active=1").get(groupId) === undefined;
}

/**
 * The union the acceptance runs: setup first, then checks, each command once in first-seen order; the longest bound. The
 * done tasks' (acceptance), or every task's (`all`: the landing watch, tester follow-up G §6.2 A3).
 */
export function acceptanceCommands(store: ControlStore, groupId: string, which: "done" | "all" = "done"): { setup: string[]; checks: string[]; timeoutMs: number } {
  const contracts = store.db.prepare("SELECT body FROM work_items WHERE group_id=? ORDER BY rowid").all(groupId)
    .map((row) => JSON.parse(String(row.body)) as { kind?: string; status?: string; taskId?: string | null })
    .filter((work) => work.kind === "task" && (which === "all" || work.status === "done") && typeof work.taskId === "string")
    .map((work) => readConfirmedTaskExecution(store, groupId, work.taskId!).contract);
  const checks: string[] = [];
  for (const contract of contracts) for (const command of contract.verification.requiredChecks) if (!checks.includes(command)) checks.push(command);
  return {
    setup: unionSetup(contracts.map((contract) => contract.context.setupCommands)) ?? [],
    checks,
    timeoutMs: Math.max(...contracts.map((contract) => contract.executionPolicy.perAttemptTimeoutMs)),
  };
}

/** One round of the pass; answers whether anything was recorded. */
export async function acceptGroups(deps: GroupAcceptanceDeps, checks: Map<string, GroupAcceptanceCheck>): Promise<boolean> {
  const { store } = deps;
  let moved = false;
  for (const row of store.db.prepare("SELECT id, body FROM groups ORDER BY rowid").all()) {
    if (deps.stopped()) break;
    const groupId = String(row.id);
    let body: Record<string, unknown>;
    // A row that does not parse is named by its own reads (as the done pass leaves it, groupDone.ts), not a second time here.
    try { body = JSON.parse(String(row.body)) as Record<string, unknown>; } catch { continue; }
    try {
      if (await acceptGroup(deps, checks, groupId, body)) moved = true;
      clearGroupFailure(checks, "acceptance", groupId);
    } catch (error) {
      // This group's alone (a repository that does not resolve, a contract that does not read); tried again next round,
      // and logged once while the same failure repeats (#278).
      logGroupFailureOnce(checks, "acceptance", groupId, error);
    }
  }
  return moved;
}

export function acceptanceResultOf(outcome: AcceptanceOutcome): "passed" | "passed-relative" | "failed" {
  const comparisons = outcome.identityComparisons ?? [];
  const redTipCommands = comparisons.filter((comparison) => comparison.tipAttempts.some((attempt) => attempt.exit !== "0"));
  const hadComparableTipRed = redTipCommands.length > 0;
  const shortfall = outcome.evidence?.shortfall ?? shortfallOf({
    tests: outcome.tests ?? outcome.evidence?.tests,
    baseline: { tests: outcome.evidence?.baselineTests ?? outcome.baseline?.tests },
  });
  if (shortfall !== null) return "failed";
  const relative = hadComparableTipRed && redTipCommands.length === comparisons.length && redTipCommands.every((comparison) => comparison.reason === undefined);
  return outcome.failure === null && !hadComparableTipRed ? "passed" : relative ? "passed-relative" : "failed";
}

function gateTestChanges(record: GroupAcceptance, changes: ExistingTestChanges, base: string): GroupAcceptance {
  const checkedChanges = { ...changes, base };
  if (changes.paths.length === 0) return { ...record, testChanges: checkedChanges };
  const pendingResult = record.result === "test-change-pending" ? record.testChanges?.pendingResult ?? "failed" : record.result;
  return { ...record, result: "test-change-pending", testChanges: { ...checkedChanges, pendingResult } };
}

async function acceptGroup(deps: GroupAcceptanceDeps, checks: Map<string, GroupAcceptanceCheck>, groupId: string, body: Record<string, unknown>): Promise<boolean> {
  const { store } = deps;
  // Any confirmed group whose tasks are done, whatever its status: the integration pass delivers a blocked group's work too.
  if (body.planHash === undefined || isGroupArchived(store, groupId)) return false;
  if (store.db.prepare("SELECT 1 FROM stop_intents WHERE group_id=?").get(groupId) !== undefined) return false;
  if (!tasksComplete(store, groupId)) return false;
  const recorded = acceptanceOf(body);
  if (isMultiGroup(store, groupId) || isDirGroup(store, groupId) || isDirFlowGroup(store, groupId)) {
    if (recorded?.result === "not-run") return false;
    const why = isMultiGroup(store, groupId) ? "multi-repo" : "dir";
    deps.write(() => saveAcceptance(store, groupId, { tip: null, result: "not-run", why, commands: [], at: store.now() }));
    return true;
  }
  // #278: the branch was found missing and nothing landed since: nothing to check, and no git child to find that out again.
  if (workBranchKnownMissing(store, groupId, body)) return false;
  const repo = deps.resolveRepository(groupRepoId(store, groupId));
  const tip = await workBranchTip(repo, groupId);
  const inFlight = checks.get(groupId);
  if (tip === null) {
    if (inFlight !== undefined) { inFlight.controller.abort(); checks.delete(groupId); }
    recordWorkBranchMissing(deps, groupId, "acceptance");
    return true;
  }
  if (inFlight !== undefined) {
    if (inFlight.settled === null) {
      if (inFlight.tip === tip) return false;
      // The tip moved under a running check: its tree will never be delivered. Stop it; the next round checks the new tip.
      inFlight.controller.abort();
      checks.delete(groupId);
      return false;
    }
    checks.delete(groupId);
    if ("error" in inFlight.settled) throw inFlight.settled.error;
    if (inFlight.tip !== tip) return false;
    const outcome = inFlight.settled.outcome;
    const { failure, commands, suiteExits } = outcome;
    const comparisons = outcome.identityComparisons ?? [];
    const result = acceptanceResultOf(outcome);
    const completed: GroupAcceptance = { tip, result, commands, at: store.now(),
      ...(failure === null || failure.tail === "" ? {} : { tail: failure.tail }),
      ...(outcome.evidence === undefined ? {} : { evidence: outcome.evidence }),
      ...(comparisons.length === 0 ? {} : { identityComparisons: comparisons }),
      fullSuite: fullSuiteRecord(inFlight.suite, repo, suiteExits, outcome) };
    const record = inFlight.testChanges === undefined ? completed : gateTestChanges(completed, inFlight.testChanges, inFlight.base);
    deps.write(() => {
      saveAcceptance(store, groupId, record);
      recordActivity(store, { groupId, kind: "group-acceptance", body: { ...record } });
    });
    return true;
  }
  // Legacy records remain display-only; do not infer a test disposition for an acceptance written before this gate existed.
  if (recorded !== null && recorded.tip === tip && recorded.testChanges === undefined) return false;
  const base = groupBaseCommit(store, groupId);
  if (base === null) throw new Error(`acceptance-base-unavailable:${groupId}`);
  const { setup, checks: commands, timeoutMs } = acceptanceCommands(store, groupId);
  const suite = fullSuiteCommand(store, groupRepoId(store, groupId));
  let testChanges: ExistingTestChanges;
  try {
    testChanges = await existingTestChanges(repo, base, tip, { checks: [...commands, ...(suite === null ? [] : [suite])], setupCommands: setup });
  } catch (error) {
    // Fail closed: a tree whose test changes cannot be read is not accepted, in any path including a single landing.
    const record = { tip, result: "failed" as const, commands: [], at: store.now(),
      testChanges: { base, paths: [], weakeningSignals: [], digest: "", error: `test-change-scan-failed: ${(error as Error).message}` } };
    deps.write(() => saveAcceptance(store, groupId, record));
    return true;
  }
  if (recorded !== null && recorded.tip === tip && recorded.testChanges?.digest === testChanges.digest) return false;
  // Full suite spec §4: the project's full-suite command as this check starts; with one set, a single landing is checked too.
  if (landedTaskCount(store, groupId) <= maxLandingsWithoutAcceptance(suite)) {
    const record = gateTestChanges({ tip, result: "not-needed", why: "single-landing", commands: [], at: store.now(), fullSuite: fullSuiteRecord(suite, repo, []) }, testChanges, base);
    deps.write(() => saveAcceptance(store, groupId, record));
    return true;
  }
  const baselineTip = base;
  // A record for an earlier tip says nothing about this one: removed before the check starts, so nothing reads it as current.
  if (recorded !== null) deps.write(() => saveAcceptance(store, groupId, null));
  // A round still running when stop() was called starts nothing stop() could no longer abort; the next driver checks again.
  if (deps.stopped()) return false;
  const controller = new AbortController();
  const entry: GroupAcceptanceCheck = { controller, tip, suite, base, testChanges, settled: null, done: Promise.resolve() };
  entry.done = runAcceptance(deps, repo, groupId, groupAcceptancePathOf(deps.roots, groupId, ++checkSeq), tip, baselineTip, setup, commands, suite, timeoutMs, controller.signal, reportedCount(store, groupId, body, suite))
    .then((outcome) => { entry.settled = { outcome }; }, (error: unknown) => { entry.settled = { error }; });
  checks.set(groupId, entry);
  return recorded !== null;
}

/**
 * Tester #383 (2026-11-20): how many task runs had already reported this same suite command red (by the person's
 * reading of the rows -- unanswered or answered, the report is what makes one green insufficient). The suite command is
 * matched exactly, or as the prefix of a longer reported command (`npm test -- --x`).
 */
function reportedCount(store: ControlStore, groupId: string, body: Record<string, unknown>, suite: string | null): number {
  if (suite === null) return 0;
  try {
    return readPreexistingFailures(store, groupId, body).filter((row) => row.command === suite || row.command.startsWith(`${suite} `)).reduce((n, row) => n + Math.max(1, row.reportedBy.length), 0);
  } catch { return 0; }
}

/**
 * Full suite spec §3-§4: what the record says of the suite. Unset: the suggestion code detects in the repository's checkout
 * (never run; human: 「人采纳才用」). Set: each run's exit, and flaky when it passed only on the retry -- or when task runs
 * had already reported it red and both confirmation runs were green (tester #383: the reports are the evidence it has
 * been red, so two greens do not make it stable; human ruling 2026-11-20, P1).
 */
function fullSuiteRecord(suite: string | null, repo: string, exits: string[], outcome?: AcceptanceOutcome): FullSuiteRecord {
  const reported = outcome?.reported ?? 0;
  return {
    command: suite, suggestion: suite === null ? suggestFullSuiteCommand(repo) : null, exits,
    flaky: exits.length === 2 && exits[1] === "0" && (exits[0] !== "0" || reported > 0),
    ...(outcome?.tests === undefined || outcome.tests === null ? {} : { tests: outcome.tests }),
    ...(outcome?.evidence?.suiteTests === undefined ? {} : { invocationTests: outcome.evidence.suiteTests }),
    ...(outcome?.evidence?.baselineCount === undefined ? {} : { baselineCount: outcome.evidence.baselineCount }),
    ...(reported === 0 ? {} : { reported }),
    ...(outcome?.baseline === undefined ? {} : { baseline: { tip: outcome.baseline.tip, exits: outcome.baseline.exits, ...(outcome.baseline.failure?.tail ? { tail: outcome.baseline.failure.tail } : {}), ...(outcome.baseline.tests === undefined || outcome.baseline.tests === null ? {} : { tests: outcome.baseline.tests }) } }),
  };
}

/** Delivery tail D3: the next scratch path of `groupId`'s acceptance checks (shared counter, so no two checks share one). */
export function nextAcceptancePath(roots: WorkspaceRoots, groupId: string): string {
  return groupAcceptancePathOf(roots, groupId, ++checkSeq);
}

/** Also D3's runner (deliveredAcceptance.ts): `baselineTip` null makes a red command non-comparable. */
export async function runAcceptance(deps: GroupAcceptanceDeps, repo: string, groupId: string, path: string, tip: string, baselineTip: string | null, setup: string[], checks: string[], suite: string | null, timeoutMs: number, signal: AbortSignal, reported = 0): Promise<AcceptanceOutcome> {
  const as = { runId: `group-acceptance-${groupId}`, ...(deps.dispatchedPersonDir === undefined ? {} : { personDir: deps.dispatchedPersonDir }) };
  const setupDigest = acceptanceSetupDigest(setup);
  const repoId = groupRepoId(deps.store, groupId);
  const attemptsByCommand = new Map<string, Array<AcceptanceIdentityComparison["tipAttempts"][number] & { tail: string }>>();
  const baseRuns = new Map<string, { exit: string; tail: string; failureIdentityStatus?: "complete" | "unsupported" | "ambiguous"; failureIdentities?: AcceptanceFailureIdentity[]; tests: number | null }>();
  const outcome: AcceptanceOutcome = { ...await runOnScratchTip(deps, repo, path, (name) => isGroupAcceptancePathOf(name, groupId), tip, async (tree) => {
    const evidence: AcceptanceEvidence = { cwd: tree, head: null, trackedFiles: null, testFiles: null, tests: null };
    try {
      const listed = (await git(tree, ["ls-files"])).split("\n").filter((line) => line.length > 0);
      evidence.head = (await git(tree, ["rev-parse", "HEAD"])).trim();
      evidence.trackedFiles = listed.length;
      evidence.testFiles = listed.filter(isTestPath).length;
    } catch { /* the counts stay unknown; the exits are still the evidence */ }

    const commands: PostMergeOutcome["commands"] = [];
    let failure: PostMergeOutcome["failure"] = null;
    let setupFailed = false;
    for (const command of setup) {
      const started = performance.now();
      const answer = await runCheckRecorded(tree, command, timeoutMs, as, signal);
      commands.push({ command: `setup: ${command}`, exit: answer.exit, ms: Math.round(performance.now() - started) });
      if (answer.exit !== "0") { failure = { ...answer, command: `setup: ${command}` }; setupFailed = true; break; }
    }

    if (!setupFailed) for (const command of checks) {
      const started = performance.now();
      const answer = await runCheckRecorded(tree, command, timeoutMs, as, signal);
      commands.push({ command, exit: answer.exit, ms: Math.round(performance.now() - started) });
      const attempts = answer.identityAttempts ?? [{ exit: answer.exit,
        ...(answer.failureIdentityStatus === undefined ? {} : { failureIdentityStatus: answer.failureIdentityStatus }),
        ...(answer.failureIdentities === undefined ? {} : { failureIdentities: answer.failureIdentities }),
      }];
      attemptsByCommand.set(command, attempts.map((attempt) => ({ ...attempt, tail: answer.tail })));
      if (answer.exit !== "0" && failure === null) failure = answer;
    }

    const suiteExits: string[] = [];
    let tests: number | null = null;
    if (!setupFailed && suite !== null && (failure === null || attemptsByCommand.has(suite))) {
      let suiteAttempts = attemptsByCommand.get(suite);
      if (suiteAttempts === undefined) {
        const started = performance.now();
        const answer = await runCheckRecorded(tree, suite, timeoutMs, as, signal);
        commands.push({ command: suite, exit: answer.exit, ms: Math.round(performance.now() - started) });
        const attempts = answer.identityAttempts ?? [{ exit: answer.exit,
          ...(answer.failureIdentityStatus === undefined ? {} : { failureIdentityStatus: answer.failureIdentityStatus }),
          ...(answer.failureIdentities === undefined ? {} : { failureIdentities: answer.failureIdentities }),
        }];
        suiteAttempts = attempts.map((attempt) => ({ ...attempt, tail: answer.tail }));
        attemptsByCommand.set(suite, suiteAttempts);
        if (answer.exit !== "0" && failure === null) failure = answer;
      }
      suiteExits.push(...suiteAttempts.map((attempt) => attempt.exit));
      const suiteTests = (): number | null => {
        const counts = suiteAttempts!.map((attempt) => attempt.tests ?? testsRan(attempt.tail)).filter((count): count is number => count !== null);
        return counts.length === 0 ? null : Math.min(...counts);
      };
      tests = suiteTests();
      if (suiteAttempts.length === 1 && (suiteAttempts[0]!.exit !== "0" || reported > 0)) {
        const started = performance.now();
        const answer = await runCheckRecorded(tree, suite, timeoutMs, as, signal);
        commands.push({ command: suite, exit: answer.exit, ms: Math.round(performance.now() - started) });
        const attempts = answer.identityAttempts ?? [{ exit: answer.exit,
          ...(answer.failureIdentityStatus === undefined ? {} : { failureIdentityStatus: answer.failureIdentityStatus }),
          ...(answer.failureIdentities === undefined ? {} : { failureIdentities: answer.failureIdentities }),
        }];
        const confirmationAttempts = attempts.map((attempt) => ({ ...attempt, tail: answer.tail }));
        suiteAttempts.push(...confirmationAttempts);
        suiteExits.push(...confirmationAttempts.map((attempt) => attempt.exit));
        tests = suiteTests();
      }
    }
    return { failure, commands, suiteExits, tests, evidence };
  }), ...(reported === 0 ? {} : { reported }) };
  let suiteBaselineLoad: SuiteBaselineLoad | null = null;
  if (suite !== null && baselineTip !== null && attemptsByCommand.has(suite)) {
    try {
      suiteBaselineLoad = await loadSuiteBaseline(deps, repo, groupId,
        { repoId, base: baselineTip, command: suite, setupDigest, reporter: "node-test-tap-v1" }, setup, timeoutMs, signal, as);
      outcome.commands.push(...suiteBaselineLoad.commands);
      if (suiteBaselineLoad.baseline !== null) {
        baseRuns.set(suite, { exit: suiteBaselineLoad.baseline.exit, tail: "", tests: suiteBaselineLoad.baseline.tests });
      }
    } catch { suiteBaselineLoad = null; }
  }
  const suiteBaseline = suiteBaselineLoad?.baseline ?? null;
  const suiteAttempts = suite === null ? [] : attemptsByCommand.get(suite) ?? [];
  const invocationTests = suiteAttempts.map((attempt) => attempt.tests ?? testsRan(attempt.tail));
  const knownInvocationTests = invocationTests.filter((tests): tests is number => tests !== null);
  outcome.tests = knownInvocationTests.length === 0 ? null : Math.min(...knownInvocationTests);
  if (outcome.evidence !== undefined && suite !== null) outcome.evidence.suiteTests = invocationTests;
  if (outcome.evidence !== undefined) outcome.evidence.tests = outcome.tests;

  const redCommands = [...attemptsByCommand.entries()].filter(([, attempts]) => attempts.some((attempt) => attempt.exit !== "0"));
  const comparisons: AcceptanceIdentityComparison[] = [];
  const missingBaselines: string[] = [];
  for (const [command, attempts] of redCommands) {
    const tipIdentities = new Map<string, AcceptanceFailureIdentity>();
    for (const attempt of attempts) if (attempt.exit !== "0" && attempt.failureIdentityStatus === "complete") {
      for (const identity of attempt.failureIdentities ?? []) tipIdentities.set(identity.key, identity);
    }
    const malformedTip = attempts.some((attempt) => attempt.exit !== "0" && (attempt.failureIdentityStatus !== "complete" || (attempt.failureIdentities?.length ?? 0) === 0));
    const baseIdentities = baselineTip === null ? [] : readAcceptanceFailureIdentities(deps.store, { repoId, base: baselineTip, command, setupDigest, reporter: "node-test-tap-v1" });
    if (baselineTip !== null && command !== suite && baseIdentities.length > 0) {
      const shape = readAcceptanceBaselineShape(deps.store, { repoId, base: baselineTip, command, setupDigest, reporter: "node-test-tap-v1" });
      if (shape?.tests !== null && shape?.tests !== undefined) baseRuns.set(command, { exit: shape.exit ?? "1", tail: "", tests: shape.tests });
    }
    const suiteComparisonBaseline = command === suite ? suiteBaseline : null;
    const baselineSource: AcceptanceIdentityComparison["baselineSource"] = baseIdentities.length > 0
      ? command === suite && suiteBaselineLoad?.commands.length ? "collected" : "stored"
      : suiteComparisonBaseline !== null
        ? suiteBaselineLoad?.commands.length ? "collected" : "stored"
        : "unavailable";
    const reason = malformedTip ? "non-comparable"
      : baselineTip === null || (command === suite && suiteComparisonBaseline === null) ? "baseline-unavailable"
        : command === suite && baseIdentities.length === 0
          ? suiteComparisonBaseline!.exit === "0" ? "base-green" : "non-comparable"
          : undefined;
    comparisons.push({ command, base: baselineTip, setupDigest, reporter: "node-test-tap-v1", baselineSource,
      tipAttempts: attempts.map(({ exit, failureIdentityStatus, failureIdentities, reportedFailures, blockCount, tests, tail }) => ({ exit,
        ...(failureIdentityStatus === undefined ? {} : { failureIdentityStatus }), ...(failureIdentities === undefined ? {} : { failureIdentities }),
        ...(reportedFailures === undefined ? {} : { reportedFailures }), ...(blockCount === undefined ? {} : { blockCount }), ...(tests === undefined ? {} : { tests }), ...(tail === undefined ? {} : { tail }),
      })), baseIdentities, tipIdentities: [...tipIdentities.values()], ...(reason === undefined ? {} : { reason }),
    });
    if (baselineTip !== null && command !== suite && baseIdentities.length === 0 && !malformedTip) missingBaselines.push(command);
  }

  if (missingBaselines.length > 0 && baselineTip !== null) {
    try {
      await runOnScratchTip(deps, repo, groupAcceptancePathOf(deps.roots, groupId, ++checkSeq), (name) => isGroupAcceptancePathOf(name, groupId), baselineTip, async (tree) => {
        const baselineCommands: PostMergeOutcome["commands"] = [];
        let setupFailure = false;
        for (const command of setup) {
          const started = performance.now();
          const answer = await runCheckRecorded(tree, command, timeoutMs, as, signal);
          baselineCommands.push({ command: `baseline setup: ${command}`, exit: answer.exit, ms: Math.round(performance.now() - started) });
          if (answer.exit !== "0") { setupFailure = true; break; }
        }
        if (setupFailure) {
          for (const command of missingBaselines) {
            const comparison = comparisons.find((item) => item.command === command)!;
            comparison.baselineSource = "unavailable";
            comparison.reason = "baseline-unavailable";
          }
          outcome.commands.push(...baselineCommands);
          return;
        }
        for (const command of missingBaselines) {
          const started = performance.now();
          const answer = await runCheckRecorded(tree, command, timeoutMs, as, signal);
          baselineCommands.push({ command: `baseline: ${command}`, exit: answer.exit, ms: Math.round(performance.now() - started) });
          const comparison = comparisons.find((item) => item.command === command)!;
          comparison.baselineSource = "collected";
          if (answer.exit !== "0" && answer.failureIdentityStatus === "complete" && (answer.failureIdentities?.length ?? 0) > 0) {
            deps.write(() => recordAcceptanceFailureIdentities(deps.store, {
              repoId, base: baselineTip, command, setupDigest, reporter: "node-test-tap-v1", identities: answer.failureIdentities!,
              source: "group-acceptance", groupId, runId: as.runId, at: deps.store.now(),
              tests: testsRan(answer.tail), exit: answer.exit,
            }));
            comparison.baseIdentities = readAcceptanceFailureIdentities(deps.store, { repoId, base: baselineTip, command, setupDigest, reporter: "node-test-tap-v1" });
          } else if (answer.exit !== "0") comparison.reason = "non-comparable";
          baseRuns.set(command, { exit: answer.exit, tail: answer.tail, tests: testsRan(answer.tail),
            ...(answer.failureIdentityStatus === undefined ? {} : { failureIdentityStatus: answer.failureIdentityStatus }),
            ...(answer.failureIdentities === undefined ? {} : { failureIdentities: answer.failureIdentities }),
          });
        }
        outcome.commands.push(...baselineCommands);
      });
    } catch {
      for (const command of missingBaselines) {
        const comparison = comparisons.find((item) => item.command === command)!;
        comparison.baselineSource = "unavailable";
        comparison.reason = "baseline-unavailable";
      }
    }
  }

  for (const comparison of comparisons) {
    if (comparison.reason !== undefined) continue;
    const baseKeys = new Set(comparison.baseIdentities.map((identity) => identity.key));
    if (comparison.tipIdentities.some((identity) => !baseKeys.has(identity.key))) comparison.reason = "new-failure";
  }
  outcome.identityComparisons = comparisons;

  const suiteComparison = suite === null ? undefined : comparisons.find((comparison) => comparison.command === suite);
  const suiteBaseRun = suite === null ? undefined : baseRuns.get(suite);
  if (outcome.evidence !== undefined && suite !== null && attemptsByCommand.has(suite)) {
    outcome.evidence.baselineCount = suiteBaseline === null
      ? { state: "unavailable", tests: null }
      : { state: suiteBaseline.state, tests: suiteBaseline.tests, source: suiteBaseline.source };
    outcome.evidence.baselineTests = suiteBaseline?.tests ?? null;
    const shortfall = shortfallOf({ tests: outcome.tests, baseline: { tests: suiteBaseline?.tests ?? null } });
    if (shortfall !== null) outcome.evidence.shortfall = shortfall;
  }
  if (baselineTip !== null && suiteComparison !== undefined && suiteBaseRun !== undefined && outcome.evidence !== undefined) {
    try {
      const listed = (await git(repo, ["ls-tree", "-r", "--name-only", baselineTip])).split("\n").filter((line) => line.length > 0);
      outcome.evidence.baselineTrackedFiles = listed.length;
      outcome.evidence.baselineTestFiles = listed.filter(isTestPath).length;
    } catch { /* the counts stay unknown */ }
    if (suiteBaseRun.exit !== "0") outcome.baseline = {
      tip: baselineTip, exits: [suiteBaseRun.exit], failure: { command: `baseline: ${suite}`, exit: suiteBaseRun.exit, tail: suiteBaseRun.tail }, tests: suiteBaseRun.tests,
    };
  }
  return outcome;
}

/**
 * Tester #387 (2026-11-20): node:test's own count of what it ran (`# tests 552`). The tail is 2 KB of the end, and the
 * summary is the end, so it survives even when the failure names were cut. Null when the output names no count.
 */
export function testsRan(tail: string): number | null {
  const found = /^# tests (\d+)$/m.exec(tail);
  return found === null ? null : Number(found[1]);
}

/** Tester #387: the file shapes a test runner discovers (node:test's own `test/` walk plus the usual suffixes). */
function isTestPath(path: string): boolean {
  return /(^|\/)(test|tests|__tests__)\//.test(path) || /\.(test|spec)\.[^/]+$/.test(path);
}

/**
 * Tester #387: did the tip's run see fewer than half the tests the base's run saw? Only when both runs named a count; an
 * output that names none proves nothing either way. The threshold is deliberately coarse (a partial checkout, not a
 * slightly changed suite) so a legitimate test removal does not fail the group.
 */
export function shortfallOf(outcome: { tests?: number | null; baseline?: { tests?: number | null } }): { tests: number; baselineTests: number } | null {
  const tests = outcome.tests ?? null, baselineTests = outcome.baseline?.tests ?? null;
  if (tests === null || baselineTests === null || baselineTests <= 0) return null;
  return tests * 2 < baselineTests ? { tests, baselineTests } : null;
}

/**
 * A scratch worktree at `tip` for `body`, then removed (tester follow-up G §6.2: shared with the landing watch). This owner's
 * leftovers (`isOwnLeftover`) that no running check holds are swept first; the path is held in `inUse` until it is removed.
 */
export async function runOnScratchTip<T>(deps: GroupAcceptanceDeps, repo: string, path: string, isOwnLeftover: (name: string) => boolean, tip: string, body: (path: string) => Promise<T>): Promise<T> {
  inUse.add(path);
  try {
    for (const name of readdirSync(deps.roots.workspacesRoot)) {
      const stale = join(deps.roots.workspacesRoot, name);
      if (isOwnLeftover(name) && !inUse.has(stale)) await removeOwnPath(repo, deps.roots, stale);
    }
    await git(repo, [...QUIET_GIT, "worktree", "add", "--detach", path, tip]);
    try {
      return await body(path);
    } finally {
      await deps.beforeScratchRemoved?.(path);
      await removeOwnPath(repo, deps.roots, path).catch(() => undefined);
    }
  } finally {
    inUse.delete(path);
  }
}
