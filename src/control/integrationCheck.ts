import { createHash } from "node:crypto";
import { firstFailingSetup, runAsCheck, type CheckFailure } from "./checkCommand.js";
import { join } from "node:path";
import { taskContractSchema } from "../scheduler/planFile.js";
import { isGroupArchived } from "./archivedMark.js";
import { gitChild } from "./integrationGit.js";
import { readGroupIntegration } from "./integrationScheme.js";
import { readArchivedPlan } from "./queries.js";
import type { ControlStore } from "./store.js";
import { removeOwnPath, type WorkspaceRoots } from "./workspace.js";
import { unionSetup } from "./setupUnion.js";
import { readRepositorySettingsBody } from "./workspaceSettings.js";

/**
 * Kanban spec 2026-10-20 §7 layer 1 (human: "同意，但是不要那么频繁，并且可以关闭。有的代码跑test 太费时间"): after groups
 * that each passed their own checks were merged into the target, Orca runs the checks again on the merged result. Code
 * only (Rule 5). It runs when >= 2 groups landed since the last check AND (no group of the repository is running OR
 * >= 6 h passed since the last check). It runs the repository's integration command when one is set, else the landed
 * groups' required checks, in a detached worktree of the target's head. A red result opens a system debug group
 * (system debug task spec 2026-10-21). Off unless an owner turns it on (builder's call, §11 of the kanban spec: a fresh
 * worktree has no installed dependencies, so an unconfigured check could only go red and spend a debug run).
 */
export const INTEGRATION_CHECK_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Each command's bound: the slow suites the human named fit; a hung one cannot hold the check forever. */
export const INTEGRATION_CHECK_COMMAND_TIMEOUT_MS = 60 * 60 * 1000;

export interface IntegrationCheckSetting { enabled: boolean; command: string | null }

export function readIntegrationCheckSetting(store: ControlStore, repoId: string): IntegrationCheckSetting {
  // Checks spec 2026-10-22 §4.1: the project layer's integration check (absent is off, no command).
  const layer = readRepositorySettingsBody(store, repoId)?.checks?.integrationCheck;
  return { enabled: layer?.enabled ?? false, command: layer?.command ?? null };
}

/** `setup`: task setup spec 2026-11-04 §4.6, the group's tasks' `context.setupCommands` (unionSetup: first-seen, once). */
export interface LandedGroup { groupId: string; integratedCommit: string; target: string; checks: string[]; setup: string[] }

/**
 * The repository's groups merged into a local target (the only delivery a check on the target can see). Checks spec
 * 2026-10-22 §2.3: system-generated groups (any `systemDebug` mark) are left out -- they never make a range due nor
 * appear as a side of a finding; their commits stay on the target and are checked as code.
 */
export function landedGroups(store: ControlStore, repoId: string, options: { includeSystem?: boolean } = {}): LandedGroup[] {
  return store.db.prepare("SELECT id, body FROM groups ORDER BY rowid").all().flatMap((row) => {
    const groupId = String(row.id);
    let body: Record<string, unknown>;
    try { body = JSON.parse(String(row.body)) as Record<string, unknown>; } catch { return []; }
    if ((body.plan as { repoId?: unknown } | undefined)?.repoId !== repoId || isGroupArchived(store, groupId)) return [];
    if (options.includeSystem !== true && Object.hasOwn(body, "systemDebug")) return [];
    let integration: ReturnType<typeof readGroupIntegration>;
    try { integration = readGroupIntegration(body); } catch { return []; }
    if (integration === null || integration.scheme.delivery !== "local" || integration.integratedCommit === null) return [];
    let checks: string[] = [], setup: string[] = [];
    try {
      const contracts = readArchivedPlan(store, groupId).plan.tasks.map((task) => taskContractSchema.parse(JSON.parse(task.originalContractCanonicalJson)));
      checks = contracts.flatMap((contract) => contract.verification.requiredChecks);
      setup = unionSetup(contracts.map((contract) => contract.context.setupCommands)) ?? [];
    } catch { /* a plan that cannot be read adds no check and no setup */ }
    return [{ groupId, integratedCommit: integration.integratedCommit, target: integration.scheme.target, checks, setup }];
  });
}

export type { CheckFailure };
/**
 * `setupFailure`: task setup spec 2026-11-04 §4.6 (controller ruling, A4 fix round 1) -- the first setup command that did
 * not exit 0 (its own command, no prefix). The check could not run, so it is no check verdict: `failures` stays empty and
 * no check ran.
 */
export interface IntegrationCheckRun { commit: string; failures: CheckFailure[]; commands: string[]; setupFailure: CheckFailure | null }

/**
 * Run the commands in a detached worktree of `target`'s head under the driver's workspaces root (removed afterwards).
 * Each command as ccloop runs a required check (`sh -lc`, inherited environment); a timeout is a failure.
 * `personDir`: the panel's empty `dispatched-person` directory, the commands' ORCA_PERSON_DIR (CLI v2 spec §15.3, review M1).
 * Task setup spec 2026-11-04 §4.6: the fresh worktree has no dependencies, so `setup` (the landed tasks' setup commands,
 * de-duplicated by the caller) runs first, each the same way and with the same bound; the first that fails is answered as
 * `setupFailure` (a could-not-run, never a check failure), and no check runs after it.
 */
export async function runIntegrationCheck(repo: string, roots: WorkspaceRoots, repoId: string, target: string, commands: string[], setup: readonly string[], at: number, personDir: string, rev: string = `refs/heads/${target}`): Promise<IntegrationCheckRun> {
  const head = await gitChild(repo, ["rev-parse", "--verify", `${rev}^{commit}`]);
  if (head.code !== 0) throw new Error(`integration-check: target ${target} unreadable: ${head.stderr.trim().slice(0, 200)}`);
  const commit = head.stdout.trim();
  const checkId = `integration-check-${createHash("sha256").update(repoId).digest("hex").slice(0, 12)}-${at}`;
  const path = join(roots.workspacesRoot, checkId);
  const added = await gitChild(repo, ["worktree", "add", "--detach", path, commit]);
  if (added.code !== 0) throw new Error(`integration-check: worktree: ${added.stderr.trim().slice(0, 200)}`);
  const failures: CheckFailure[] = [];
  let setupFailure: CheckFailure | null = null;
  const as = { runId: checkId, personDir }; // CLI v2 spec §15.3-§15.4 (review M1)
  try {
    setupFailure = await firstFailingSetup(path, setup, INTEGRATION_CHECK_COMMAND_TIMEOUT_MS, as);
    if (setupFailure === null) for (const command of commands) {
      const failure = await runAsCheck(path, command, INTEGRATION_CHECK_COMMAND_TIMEOUT_MS, as);
      if (failure !== null) failures.push(failure);
    }
  } finally {
    await removeOwnPath(repo, roots, path).catch(() => undefined);
  }
  return { commit, failures, commands, setupFailure };
}

/** The facts a red check gives its debug task (system debug task spec §2): which commands failed, their exit and output tail. */
export function integrationCheckFacts(run: IntegrationCheckRun, groups: string[], target: string): string[] {
  return [
    `the target ${target} at ${run.commit}, after groups ${groups.join(", ")} were merged into it, fails these checks:`,
    ...run.failures.map((failure) => `\`${failure.command}\` exited ${failure.exit}${failure.tail === "" ? "" : `; the end of its output:\n${failure.tail}`}`.slice(0, 4096)),
  ].slice(0, 32);
}
