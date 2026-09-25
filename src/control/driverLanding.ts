import { existsSync, readFileSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { add, budgetBalance, readRun, syncWebBudget } from "./budget.js";
import { canonicalBytes } from "./canonicalJson.js";
import { ControlError } from "./errors.js";
import { readConfirmedTaskExecution } from "./executionSnapshot.js";
import { privateDirectory } from "./paths.js";
import { readGroup, saveGroup } from "./queries.js";
import { ORCA_IDENTITY, git } from "../scheduler/gitExec.js";
import { AgentsRunRefused, TERMINAL_OUTCOMES, cloneDirOf, latestAttemptSha, loopDirOf, runTask } from "../scheduler/ccloopRunner.js";
import { netChangeSet } from "../scheduler/harvest.js";
import { markersRemaining, materialiseConflict, pinConflictCommit, rebuildMergeCommit, synthesizeReconcileContractOf } from "../scheduler/reconcile.js";
import { blockRun, describeError, groupRepoId, readDriverRun, saveDriverRun, write, type DriverContext, type DriverRun, type ExecutionDriverDeps } from "./executionDriver.js";
import { QUIET_GIT, compareAndSwap, conflictPathOf, incomingRefOf, landingPathOf, reconcileRunsDirOf, removeOwnPath, revParse, workBranchRef } from "./workspace.js";
import type { ReconcileRecord } from "./driveRecord.js";
import type { ControlStore } from "./store.js";
import type { PlanFile, PlanTask } from "../scheduler/planFile.js";

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
    run.drive = { ...run.drive!, landedCommit };
    saveDriverRun(deps.store, run);
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
  for (const row of store.db.prepare("SELECT body FROM runs WHERE group_id=? AND active=1").all(run.groupId)) {
    if ((JSON.parse(String(row.body)) as DriverRun).state === "reconciling") return false;
  }
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
      await git(landing, [...QUIET_GIT, ...ORCA_IDENTITY, "merge", "--no-ff", "-m", `orca: land ${runId}`, incomingRefOf(runId)]);
    } catch {
      await git(landing, [...QUIET_GIT, "merge", "--abort"]).catch(() => undefined);
      return null;
    }
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
  return budgetBalance(group.limit, group.used, group.reserved).reserve.tokens >= tokenBudget;
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

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

function readLoopState(loopDir: string): { status: string | null; tokenBudgetRemaining: number | null } {
  const path = join(loopDir, "loop-state.json");
  if (!existsSync(path)) return { status: null, tokenBudgetRemaining: null };
  try {
    const state = JSON.parse(readFileSync(path, "utf8")) as { status?: unknown; budgetSnapshot?: { tokenBudgetRemaining?: unknown } };
    const remaining = state.budgetSnapshot?.tokenBudgetRemaining;
    return { status: typeof state.status === "string" ? state.status : null, tokenBudgetRemaining: typeof remaining === "number" ? remaining : null };
  } catch { return { status: null, tokenBudgetRemaining: null }; }
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
    // Agent selection spec §4.9. Agent selection plan T7 bridge -- T11 leaves it, plan T12 deletes this (plan P9) for
    // the group's frozen reconcile slot (§6.1): until then, the conflicted run's own frozen selection and configHash,
    // exactly what the reconciliation ran with before.
    agentsTable: deps.agentsTablePath, agentSelection: { selection: run.agent, configHash: run.configHash },
    // Final review I3: its own process group, output in files inside its runs dir, unref'd -- the panel
    // closing (or a Ctrl-C to its process group) does not end it, and a restarted driver waits on its pid.
    detachedLogDir: workdir,
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
  const tree = (await git(record.copyPath, [...QUIET_GIT, "rev-parse", `${attemptSha}^{tree}`])).trim();
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
      current.drive = { ...current.drive!, landedCommit: merged, reconcile: { ...current.drive!.reconcile!, outcome: loop.status, attemptSha } };
    }
    saveDriverRun(store, current);
    return true;
  });
}
