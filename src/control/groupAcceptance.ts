import { recordActivity } from "./activity.js";
import { isGroupArchived } from "./archivedMark.js";
import { runCheckSequence, type PostMergeOutcome } from "./checkCommand.js";
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
import { acceptanceOf, landedRunCount, landedTaskCount, type GroupAcceptance } from "./groupAcceptanceRecord.js";
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
 * multi-directory or folder group is recorded `not-run` (a known gap: no single tree to check). passed, failed and waived
 * write a `group-acceptance` activity row; not-needed and not-run write the record only (as §4's post-merge record).
 *
 * Tester #278: a work branch that does not exist (deleted after delivery, say) is a recorded state, not an error retried
 * every round: `not-run: work-branch-missing`, keyed by the runs landed so far, so later rounds skip the group without a
 * git child until a new landing. Any other failure (a lock, a repository that does not resolve) is tried again next round
 * and logged once per distinct message per group, not every round.
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

/** `done` settles once the check is over, its scratch worktree removed included (driver stop() waits on it). */
export interface GroupAcceptanceCheck { controller: AbortController; tip: string; settled: { outcome: PostMergeOutcome } | { error: unknown } | null; done: Promise<void> }

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
/** #278: per driver (keyed by its checks map), the failure last logged for each group; cleared by a round without one. */
const logged = new WeakMap<Map<string, GroupAcceptanceCheck>, Map<string, string>>();

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
  const last = logged.get(checks) ?? new Map<string, string>();
  logged.set(checks, last);
  for (const row of store.db.prepare("SELECT id, body FROM groups ORDER BY rowid").all()) {
    if (deps.stopped()) break;
    const groupId = String(row.id);
    let body: Record<string, unknown>;
    // A row that does not parse is named by its own reads (as the done pass leaves it, groupDone.ts), not a second time here.
    try { body = JSON.parse(String(row.body)) as Record<string, unknown>; } catch { continue; }
    try {
      if (await acceptGroup(deps, checks, groupId, body)) moved = true;
      last.delete(groupId);
    } catch (error) {
      // This group's alone (a repository that does not resolve, a contract that does not read); tried again next round,
      // and logged once while the same failure repeats (#278).
      const message = error instanceof Error ? error.message : String(error);
      if (last.get(groupId) === message) continue;
      last.set(groupId, message);
      process.stderr.write(`orca-driver: group ${groupId}: acceptance: ${message}\n`);
    }
  }
  return moved;
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
  if (recorded?.why === "work-branch-missing" && recorded.landings === landedRunCount(store, groupId)) return false;
  const repo = deps.resolveRepository(groupRepoId(store, groupId));
  const tip = await workBranchTip(repo, groupId);
  const inFlight = checks.get(groupId);
  if (tip === null) {
    if (inFlight !== undefined) { inFlight.controller.abort(); checks.delete(groupId); }
    deps.write(() => saveAcceptance(store, groupId, { tip: null, result: "not-run", why: "work-branch-missing", landings: landedRunCount(store, groupId), commands: [], at: store.now() }));
    process.stderr.write(`orca-driver: group ${groupId}: acceptance: not run, orca/${groupId} does not exist (checked again after a new landing)\n`);
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
    const { failure, commands } = inFlight.settled.outcome;
    const record: GroupAcceptance = { tip, result: failure === null ? "passed" : "failed", commands, at: store.now(),
      ...(failure === null || failure.tail === "" ? {} : { tail: failure.tail }) };
    deps.write(() => {
      saveAcceptance(store, groupId, record);
      recordActivity(store, { groupId, kind: "group-acceptance", body: { ...record } });
    });
    return true;
  }
  if (recorded !== null && recorded.tip === tip) return false;
  if (landedTaskCount(store, groupId) <= 1) {
    deps.write(() => saveAcceptance(store, groupId, { tip, result: "not-needed", why: "single-landing", commands: [], at: store.now() }));
    return true;
  }
  const { setup, checks: commands, timeoutMs } = acceptanceCommands(store, groupId);
  // A record for an earlier tip says nothing about this one: removed before the check starts, so nothing reads it as current.
  if (recorded !== null) deps.write(() => saveAcceptance(store, groupId, null));
  // A round still running when stop() was called starts nothing stop() could no longer abort; the next driver checks again.
  if (deps.stopped()) return false;
  const controller = new AbortController();
  const entry: GroupAcceptanceCheck = { controller, tip, settled: null, done: Promise.resolve() };
  entry.done = runAcceptance(deps, repo, groupId, groupAcceptancePathOf(deps.roots, groupId, ++checkSeq), tip, setup, commands, timeoutMs, controller.signal)
    .then((outcome) => { entry.settled = { outcome }; }, (error: unknown) => { entry.settled = { error }; });
  checks.set(groupId, entry);
  return recorded !== null;
}

async function runAcceptance(deps: GroupAcceptanceDeps, repo: string, groupId: string, path: string, tip: string, setup: string[], checks: string[], timeoutMs: number, signal: AbortSignal): Promise<PostMergeOutcome> {
  // The commands are the group's tasks'; they run as the group's acceptance, with the panel's empty person directory.
  const as = { runId: `group-acceptance-${groupId}`, ...(deps.dispatchedPersonDir === undefined ? {} : { personDir: deps.dispatchedPersonDir }) };
  return runOnScratchTip(deps, repo, path, (name) => isGroupAcceptancePathOf(name, groupId), tip, (tree) => runCheckSequence(tree, setup, checks, timeoutMs, as, signal));
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
