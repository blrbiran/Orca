import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod";
import { add, syncWebBudget } from "./budget.js";
import { canonicalBytes } from "./canonicalJson.js";
import { reconcileAffordable, reconcileNextAction, processAlive, readLoopState } from "./driverLanding.js";
import { ControlError } from "./errors.js";
import { readConfirmedReconcileSlot, readConfirmedTaskExecution } from "./executionSnapshot.js";
import { describeError, groupRepoId, write } from "./executionDriver.js";
import { conflictedNames, gitChild, gitOk } from "./integrationGit.js";
import { finishResolvedIntegration, type IntegrationDeps } from "./integrationPass.js";
import { readGroupIntegration, type GroupIntegration, type Method } from "./integrationScheme.js";
import { privateDirectory } from "./paths.js";
import { readGroup, saveGroup } from "./queries.js";
import { bookReconcileUsage } from "./usageLedger.js";
import { reconcileRunsDirOf, removeOwnPath, type WorkspaceRoots } from "./workspace.js";
import { TERMINAL_OUTCOMES, cloneDirOf, latestAttemptSha, loopDirOf } from "../scheduler/ccloopRunner.js";
import { ORCA_IDENTITY } from "../scheduler/gitExec.js";
import { markersRemaining, materialiseConflict, pinConflictCommit } from "../scheduler/reconcile.js";
import type { PlanFile, PlanTask, taskContractSchema } from "../scheduler/planFile.js";
import type { ReconcileRecord } from "./driveRecord.js";
import type { ControlStore } from "./store.js";

/**
 * Integration spec §7 (ruling R3): an integration conflict resolved by an agent. A group-level machine of its own that
 * reuses the landing reconciliation's pieces -- the conflict re-created in an Orca-owned clone and pinned, a ccloop run
 * under the group's frozen reconcile slot, the landing's spawn/wait/collect rules, markers refused by code -- keyed by
 * `integrate-<g>-<attempt>` for the copy, the runs directory and the outbox.
 */
type Conflict = NonNullable<GroupIntegration["conflict"]>;
type TaskContract = z.infer<typeof taskContractSchema>;

export const integrationKeyOf = (groupId: string, attempt: number): string => `integrate-${groupId}-${attempt}`;
/** The conflict's copy: a direct child of the workspaces root, so only `removeOwnPath` ever deletes it. */
export const conflictCopyOf = (workspacesRoot: string, groupId: string, attempt: number): string => join(workspacesRoot, `integration-conflict-${groupId}-${attempt}`);
/** A copy's name read back: the attempt is the last `-<digits>`, so group `g-1`'s copies are never group `g`'s. */
const COPY_NAME = /^integration-conflict-(.+)-(\d+)$/;
export function copyOwner(name: string): string | null { return COPY_NAME.exec(name)?.[1] ?? null; }
/** In the target repository: the pinned conflict outlives its copy. */
export const integrationConflictRefOf = (groupId: string, attempt: number): string => `refs/orca/integration-conflict/${groupId}/${attempt}`;
/** Orca-owned refs in the target repository: the work tip the copy fetches, and the resolution's attempt. */
const workRefOf = (groupId: string): string => `refs/orca/integration/${groupId}/work`;
const resolvedRefOf = (groupId: string): string => `refs/orca/integration/${groupId}/resolved`;

const CONFLICT_MESSAGE = "orca: the integration conflict itself, recorded so an agent can read it -- never integrated";

/**
 * spec §7, on conflict: a `git clone --local --no-checkout` of the target repository, the conflict re-created there and
 * pinned, and its ref fetched back into the target repository. `merge` re-runs the merge (`materialiseConflict`);
 * `squash` is the same three-way merge §6.2 ran (`merge-tree` with `lastIntegrated` as merge base), whose tree with its
 * markers is the conflict state. Null when the copy does not reproduce the conflict: the copy is removed and the
 * conflict is named integration-conflict-unreproducible (a person can Retry).
 */
export async function materialiseIntegrationConflict(
  deps: { roots: WorkspaceRoots; repo: string }, groupId: string, base: string, tip: string, method: Method, attempt: number, lastIntegrated: string | null,
): Promise<GroupIntegration["conflict"]> {
  const { roots, repo } = deps;
  const copy = conflictCopyOf(roots.workspacesRoot, groupId, attempt), key = integrationKeyOf(groupId, attempt);
  await removeOwnPath(repo, roots, copy);
  await gitOk(repo, ["update-ref", workRefOf(groupId), tip]);
  await gitOk(roots.workspacesRoot, ["clone", "--quiet", "--local", "--no-checkout", repo, copy]);
  let conflictCommit: string, paths: string[];
  try {
    if (method === "merge") {
      const materialised = await materialiseConflict(copy, base, workRefOf(groupId));
      conflictCommit = materialised.conflictCommit;
      paths = materialised.conflictedPaths;
    } else {
      const mergeBase = lastIntegrated ?? (await gitOk(repo, ["merge-base", tip, base])).trim();
      const merged = await gitChild(copy, ["-c", "merge.conflictStyle=merge", "merge-tree", "--write-tree", "--name-only", `--merge-base=${mergeBase}`, base, tip]);
      if (merged.code !== 1) throw new Error(`git merge-tree exited ${merged.code} in ${copy}`);
      paths = conflictedNames(merged.stdout).sort();
      const tree = merged.stdout.split("\n")[0]!.trim();
      conflictCommit = (await gitOk(copy, [...ORCA_IDENTITY, "commit-tree", tree, "-p", base, "-p", tip, "-m", CONFLICT_MESSAGE])).trim();
    }
  } catch (error) {
    process.stderr.write(`orca-driver: integration ${groupId}: the conflict is not reproduced in its copy: ${describeError(error)}\n`);
    await removeOwnPath(repo, roots, copy);
    return null;
  }
  const ref = integrationConflictRefOf(groupId, attempt);
  await pinConflictCommit(copy, key, conflictCommit, ref);
  await gitOk(repo, ["fetch", "--quiet", "--no-tags", "--no-write-fetch-head", copy, `+${ref}:${ref}`]);
  return { attempt, key, base, tip, paths };
}

/** The group's task contracts, as confirmed (sorted by task id). */
export function groupTaskContracts(store: ControlStore, groupId: string): { taskIds: string[]; contracts: TaskContract[] } {
  const taskIds = store.db.prepare("SELECT id, body FROM work_items WHERE group_id=? ORDER BY id").all(groupId)
    .filter((row) => (JSON.parse(String(row.body)) as { kind?: string }).kind === "task").map((row) => String(row.id));
  return { taskIds, contracts: taskIds.map((taskId) => readConfirmedTaskExecution(store, groupId, taskId).contract) };
}

interface ContractInput { taskContracts: readonly TaskContract[]; conflict: Conflict; target: string; groupId: string; copy: string; conflictCommit: string }

/**
 * spec §7, the synthesized contract: the goal names the target branch and the group and says the target's changes must
 * survive; targetPaths are the conflicted paths; the checks are the union of the group's task contracts' requiredChecks
 * (a blank check is no check); the budget is the landing reconciliation's (the largest of the sides'), one attempt.
 */
export function integrationContractOf(input: ContractInput): { contract: Record<string, unknown>; tokenBudget: number } | { refused: "integration-no-checks" } {
  const { taskContracts, conflict, target, groupId } = input;
  const checks = [...new Set(taskContracts.flatMap((contract) => contract.verification.requiredChecks).filter((check) => check.trim() !== ""))];
  if (checks.length === 0) return { refused: "integration-no-checks" };
  const max = (pick: (contract: TaskContract) => number): number => Math.max(...taskContracts.map(pick));
  const tokenBudget = max((contract) => contract.executionPolicy.tokenBudget);
  const paths = conflict.paths.join(", ");
  const contract = {
    objective: {
      taskId: conflict.key,
      goal: `Integrating group \`${groupId}\` into \`${target}\`: resolve the conflict between the target branch \`${target}\` and the work of group `
        + `\`${groupId}\`; the target branch's changes must survive. HEAD is a commit that records the conflict itself, so the conflict markers `
        + `are ordinary text in the working tree. Remove every conflict marker in: ${paths}. Where a block cannot keep both the target `
        + `branch's changes and the group's work, it belongs to a human: leave that block alone and stop, rather than choosing one side.`,
      successCondition: `No file in ${paths} contains a conflict marker, and the group's required checks pass.`,
      nonGoals: ["changing anything outside the conflicting blocks", "dropping a change the target branch made"],
    },
    context: {
      repoPath: input.copy, targetPaths: conflict.paths, relevantDocs: [], buildTestCommands: checks,
      constraints: [`The conflict is recorded in commit ${input.conflictCommit}, whose parents are ${conflict.base} (the target branch \`${target}\`) `
        + `and ${conflict.tip} (the work branch \`orca/${groupId}\`).`],
    },
    executionPolicy: {
      autonomyLevel: "L2", maxAttempts: 1, perAttemptTimeoutMs: max((c) => c.executionPolicy.perAttemptTimeoutMs),
      totalRuntimeBudgetMs: max((c) => c.executionPolicy.totalRuntimeBudgetMs), tokenBudget, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 0,
    },
    safetyPolicy: { allowlistPaths: [], denylistPaths: [], maxFilesTouched: conflict.paths.length, humanGateConditions: [] },
    verification: { verifierType: "command", requiredChecks: checks, rejectOn: ["nonzero exit"], evidenceRequired: [] },
    escalationAndExit: { escalationTargets: [], pauseOn: [], stopOn: [], terminalStates: [...TERMINAL_OUTCOMES] },
  };
  return { contract, tokenBudget };
}

/** spec §7: the contract written into the resolution's runs directory (outside the target repository and the copy). */
export async function synthesizeIntegrationContract(input: ContractInput & { runsDir: string }): Promise<{ contractPath: string } | { refused: "integration-no-checks" }> {
  const built = integrationContractOf(input);
  if ("refused" in built) return built;
  const contractPath = join(input.runsDir, `contract-${input.conflict.key}.json`);
  await writeFile(contractPath, JSON.stringify(built.contract, null, 2));
  return { contractPath };
}

/** What `resolve-integration-conflict` read before its transaction: the waiting conflict's copy and pinned commit. */
export interface ResolutionPrepared { attempt: number; copyPath: string; conflictCommit: string; runsDir: string }

/**
 * spec §7, the approval's checks and record (inside the command's transaction; nothing spawns here). Refused
 * integration-not-blocked unless a materialised conflict of this attempt waits, integration-no-checks, reconcile-budget.
 */
export function approveResolution(store: ControlStore, groupId: string, group: Record<string, unknown>, prepared: ResolutionPrepared | null): GroupIntegration {
  const current = readGroupIntegration(group);
  if (current === null || current.state !== "conflict" || current.conflict === null || prepared === null || prepared.attempt !== current.conflict.attempt) {
    throw new ControlError("integration-not-blocked");
  }
  const conflict = current.conflict;
  const { taskIds, contracts } = groupTaskContracts(store, groupId);
  const built = integrationContractOf({ taskContracts: contracts, conflict, target: (current.scheme as { target: string }).target, groupId, copy: prepared.copyPath, conflictCommit: prepared.conflictCommit });
  if ("refused" in built) throw new ControlError(built.refused);
  if (!reconcileAffordable(store, groupId, built.tokenBudget)) throw new ControlError("reconcile-budget");
  const resolution: ReconcileRecord = {
    copyPath: prepared.copyPath, old: conflict.base, conflictCommit: prepared.conflictCommit, conflictedPaths: conflict.paths,
    otherTaskId: taskIds[0]!, otherTaskIds: taskIds, reconcileRunId: conflict.key, runsDir: prepared.runsDir,
    contractPath: join(prepared.runsDir, `contract-${conflict.key}.json`), tokenBudget: built.tokenBudget,
    spawning: true, pid: null, outcome: null, attemptSha: null, spawnSeq: 0,
  };
  return { ...current, state: "resolving", reason: null, retryAfter: null, transient: 0, resolution };
}

/** The pre-transaction read for the approval: null when no materialised conflict waits (the command then refuses). */
export async function prepareResolution(store: ControlStore, roots: WorkspaceRoots, groupId: string, repoPath: (repoId: string) => string): Promise<ResolutionPrepared | null> {
  try {
    const integration = readGroupIntegration(readGroup(store, groupId));
    // Only the conflict's attempt is read here; whether it still waits is judged inside the transaction.
    if (integration === null || integration.conflict === null) return null;
    const { attempt, key } = integration.conflict;
    const copyPath = conflictCopyOf(roots.workspacesRoot, groupId, attempt);
    if (!existsSync(copyPath)) return null;
    const pinned = await gitChild(repoPath(groupRepoId(store, groupId)), ["rev-parse", "--verify", "--quiet", `${integrationConflictRefOf(groupId, attempt)}^{commit}`]);
    if (pinned.code !== 0) return null;
    return { attempt, copyPath, conflictCommit: pinned.stdout.trim(), runsDir: reconcileRunsDirOf(roots, key) };
  } catch { return null; }
}

/**
 * spec §7: a resolution's spend reaches `group.used` outside any run, booked as one `run-work` `unattributed` row with
 * `run_id` NULL (as Ruling R2 of the accounts spec books reconciliation), once per key (outbox `integration-usage:<key>`).
 * It never reads a run.
 */
export function recordIntegrationUsage(deps: Pick<IntegrationDeps, "store" | "admissionGate" | "now">, groupId: string, key: string, tokens: number): void {
  write(deps, () => {
    const id = `integration-usage:${key}`;
    if (deps.store.db.prepare("SELECT id FROM outbox WHERE id=?").get(id)) return;
    const group = readGroup(deps.store, groupId);
    group.used = add(group.used, { tokens, activeMs: 0, attempts: 1, sessions: 1 });
    bookReconcileUsage(deps.store, { runId: null, groupId, groupBody: group as unknown as Record<string, unknown>, tokens, appliedAt: deps.now() });
    syncWebBudget(deps.store, group, null);
    group.budgetVersion += 1;
    saveGroup(deps.store, group);
    deps.store.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?,'integration-usage',?,1)")
      .run(id, canonicalBytes({ groupId, key, tokens }).toString("utf8"));
  });
}

type ResolvingDeps = IntegrationDeps & { resolution: NonNullable<IntegrationDeps["resolution"]> };

/**
 * spec §7: one round of a `resolving` group, with the landing's `reconcileNextAction` rules: a terminal loop state is
 * collected; a recorded live process is waited on; anything else (an orphan included) is spawned after another
 * affordability check. The run is never awaited inside a round; a stop or shutdown does not end it.
 */
export async function advanceIntegrationResolution(deps: IntegrationDeps, groupId: string): Promise<boolean> {
  if (deps.resolution === undefined) return false;
  const resolving = deps as ResolvingDeps;
  const integration = readGroupIntegration(readGroup(deps.store, groupId));
  if (integration?.state !== "resolving" || integration.resolution === null || integration.conflict === null) return false;
  const record = integration.resolution, key = record.reconcileRunId;
  if (resolving.resolution.reconciling.has(key)) return false;
  const workdir = join(record.runsDir, key);
  const loop = readLoopState(loopDirOf(workdir, key));
  const action = reconcileNextAction({ loopStatus: loop.status, spawning: record.spawning, pid: record.pid, alive: record.pid !== null && processAlive(record.pid), collected: record.outcome !== null });
  if (action === "wait") return false;
  if (action === "collect") return collect(resolving, groupId, integration, loop);
  if (!reconcileAffordable(deps.store, groupId, record.tokenBudget)) return failResolution(resolving, groupId, key, "reconcile-budget");
  let slot;
  try { slot = readConfirmedReconcileSlot(deps.store, groupId); }
  catch (error) {
    if (!(error instanceof ControlError)) throw error;
    return failResolution(resolving, groupId, key, "reconcile-agent-unfrozen");
  }
  const synthesized = await synthesizeIntegrationContract({
    taskContracts: groupTaskContracts(deps.store, groupId).contracts, conflict: integration.conflict, target: (integration.scheme as { target: string }).target, groupId,
    copy: record.copyPath, conflictCommit: record.conflictCommit, runsDir: privateDirectory(record.runsDir),
  });
  // The approval refused a group without checks, and confirmed contracts do not change.
  if ("refused" in synthesized) throw new ControlError(synthesized.refused);
  await rm(workdir, { recursive: true, force: true });
  setResolution(deps, groupId, key, { spawning: true, pid: null, outcome: null, attemptSha: null, spawnSeq: (record.spawnSeq ?? 0) + 1 });
  const plan: PlanFile = { targetRepo: record.copyPath, ccloopBin: resolving.resolution.ccloopBin, runsDir: record.runsDir, workBranch: `orca/${groupId}`, policy: "local-merge", ledgerMode: "out-of-repo", tasks: [] };
  const task: PlanTask = { taskId: key, contract: synthesized.contractPath, dependsOn: [] };
  const running = resolving.resolution.runTask(plan, task, record.conflictCommit, key, {
    agentsTable: resolving.resolution.agentsTablePath, agentSelection: { selection: slot.selection, configHash: slot.configHash },
    // As the landing's reconciliation: its own process group and log files, unref'd, so a restarted driver waits on it.
    detachedLogDir: workdir,
    onSpawn: (pid) => {
      try { setResolution(deps, groupId, key, { pid }); }
      catch (error) { process.stderr.write(`orca-driver: integration ${groupId}: resolution pid ${pid} not recorded: ${describeError(error)}\n`); }
    },
  }).then(
    () => undefined,
    async (error: unknown) => { await failResolution(resolving, groupId, key, `integration-resolution-spawn:${describeError(error)}`); },
  ).catch((error: unknown) => { process.stderr.write(`orca-driver: integration ${groupId}: ${describeError(error)}\n`); })
    .finally(() => { resolving.resolution.reconciling.delete(key); });
  resolving.resolution.reconciling.set(key, running);
  return true;
}

function setResolution(deps: IntegrationDeps, groupId: string, key: string, patch: Partial<ReconcileRecord>): void {
  write(deps, () => {
    const group = readGroup(deps.store, groupId);
    const current = readGroupIntegration(group);
    if (current?.state !== "resolving" || current.resolution?.reconcileRunId !== key) return;
    saveGroup(deps.store, { ...group, integration: { ...current, resolution: { ...current.resolution, ...patch } } } as typeof group);
  });
}

/**
 * spec §7: the spend is booked first, whatever the run ended as. Markers are refused by code; the resolved tree goes on
 * to finish the integration (integrationPass.ts).
 */
async function collect(deps: ResolvingDeps, groupId: string, integration: GroupIntegration, loop: { status: string | null; tokenBudgetRemaining: number | null }): Promise<boolean> {
  const record = integration.resolution!, conflict = integration.conflict!, key = record.reconcileRunId;
  // No `tokenBudgetRemaining` means the spend is unknown, so the whole budget is booked (as the landing does).
  recordIntegrationUsage(deps, groupId, key, loop.tokenBudgetRemaining === null ? record.tokenBudget : Math.max(0, record.tokenBudget - loop.tokenBudgetRemaining));
  const clone = cloneDirOf(join(record.runsDir, key));
  const attemptSha = loop.status === "succeeded" ? await latestAttemptSha(clone, key) : null;
  if (attemptSha === null) return failResolution(deps, groupId, key, `integration-resolution-terminal:${loop.status}`);
  const repo = deps.repoPathOf(groupRepoId(deps.store, groupId));
  await gitOk(repo, ["fetch", "--quiet", "--no-tags", "--no-write-fetch-head", clone, `+${attemptSha}:${resolvedRefOf(groupId)}`]);
  const remaining = await markersRemaining(repo, attemptSha, conflict.paths);
  if (remaining.length > 0) return failResolution(deps, groupId, key, `integration-markers-remaining:${remaining.join(",")}`);
  const tree = (await gitOk(repo, ["rev-parse", `${attemptSha}^{tree}`])).trim();
  return finishResolvedIntegration(deps, repo, groupId, integration, tree);
}

/**
 * spec §7: markers left, a run that failed or could not start -- the group is in `conflict` again with the reason, and
 * the next attempt's conflict is materialised so another approval can start it.
 */
async function failResolution(deps: ResolvingDeps, groupId: string, key: string, reason: string): Promise<boolean> {
  const integration = readGroupIntegration(readGroup(deps.store, groupId));
  if (integration?.state !== "resolving" || integration.resolution?.reconcileRunId !== key || integration.conflict === null) return false;
  const { base, tip, paths } = integration.conflict, attempt = integration.conflict.attempt + 1;
  let next: GroupIntegration["conflict"] = null;
  try {
    next = await materialiseIntegrationConflict({ roots: deps.roots, repo: deps.repoPathOf(groupRepoId(deps.store, groupId)) }, groupId, base, tip,
      (integration.scheme as { method: Method }).method, attempt, integration.lastIntegrated);
  } catch (error) { process.stderr.write(`orca-driver: integration ${groupId}: the next attempt's conflict was not materialised: ${describeError(error)}\n`); }
  return write(deps, () => {
    const group = readGroup(deps.store, groupId);
    const current = readGroupIntegration(group);
    if (current?.state !== "resolving" || current.resolution?.reconcileRunId !== key) return false;
    saveGroup(deps.store, { ...group, integration: { ...current, state: "conflict", reason, resolution: null,
      conflict: next ?? { attempt, key: integrationKeyOf(groupId, attempt), base, tip, paths } } } as typeof group);
    return true;
  });
}
