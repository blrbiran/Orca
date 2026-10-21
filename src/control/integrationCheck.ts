import { createHash } from "node:crypto";
import { dispatchedEnv } from "./commandClient.js";
import { join } from "node:path";
import { taskContractSchema } from "../scheduler/planFile.js";
import { isGroupArchived } from "./archivedMark.js";
import { ChildTimeout, gitChild, spawnRunChild } from "./integrationGit.js";
import { readGroupIntegration } from "./integrationScheme.js";
import { readArchivedPlan } from "./queries.js";
import type { ControlStore } from "./store.js";
import { removeOwnPath, type WorkspaceRoots } from "./workspace.js";
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
const TAIL_CHARS = 2048;

export interface IntegrationCheckSetting { enabled: boolean; command: string | null }

export function readIntegrationCheckSetting(store: ControlStore, repoId: string): IntegrationCheckSetting {
  // Checks spec 2026-10-22 §4.1: the project layer's integration check (absent is off, no command).
  const layer = readRepositorySettingsBody(store, repoId)?.checks?.integrationCheck;
  return { enabled: layer?.enabled ?? false, command: layer?.command ?? null };
}

export interface LandedGroup { groupId: string; integratedCommit: string; target: string; checks: string[] }

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
    let checks: string[] = [];
    try {
      checks = readArchivedPlan(store, groupId).plan.tasks.flatMap((task) => taskContractSchema.parse(JSON.parse(task.originalContractCanonicalJson)).verification.requiredChecks);
    } catch { /* a plan that cannot be read adds no check */ }
    return [{ groupId, integratedCommit: integration.integratedCommit, target: integration.scheme.target, checks }];
  });
}

export interface CheckFailure { command: string; exit: string; tail: string }
export interface IntegrationCheckRun { commit: string; failures: CheckFailure[]; commands: string[] }

const tail = (text: string): string => text.length <= TAIL_CHARS ? text : text.slice(text.length - TAIL_CHARS);

/**
 * Run the commands in a detached worktree of `target`'s head under the driver's workspaces root (removed afterwards).
 * Each command as ccloop runs a required check (`sh -lc`, inherited environment); a timeout is a failure.
 * `personDir`: the panel's empty `dispatched-person` directory, the commands' ORCA_PERSON_DIR (CLI v2 spec §15.3, review M1).
 */
export async function runIntegrationCheck(repo: string, roots: WorkspaceRoots, repoId: string, target: string, commands: string[], at: number, personDir: string): Promise<IntegrationCheckRun> {
  const head = await gitChild(repo, ["rev-parse", "--verify", `refs/heads/${target}^{commit}`]);
  if (head.code !== 0) throw new Error(`integration-check: target ${target} unreadable: ${head.stderr.trim().slice(0, 200)}`);
  const commit = head.stdout.trim();
  const checkId = `integration-check-${createHash("sha256").update(repoId).digest("hex").slice(0, 12)}-${at}`;
  const path = join(roots.workspacesRoot, checkId);
  const added = await gitChild(repo, ["worktree", "add", "--detach", path, commit]);
  if (added.code !== 0) throw new Error(`integration-check: worktree: ${added.stderr.trim().slice(0, 200)}`);
  const failures: CheckFailure[] = [];
  try {
    for (const command of commands) {
      try {
        const answer = await spawnRunChild("sh", ["-lc", command], { cwd: path, timeoutMs: INTEGRATION_CHECK_COMMAND_TIMEOUT_MS, inheritEnv: true, env: dispatchedEnv({ runId: checkId, personDir }) }); // CLI v2 spec §15.3-§15.4 (review M1)
        if (answer.code !== 0) failures.push({ command, exit: String(answer.code), tail: tail(`${answer.stdout}\n${answer.stderr}`.trim()) });
      } catch (error) {
        if (!(error instanceof ChildTimeout)) throw error;
        failures.push({ command, exit: `timeout ${INTEGRATION_CHECK_COMMAND_TIMEOUT_MS} ms`, tail: "" });
      }
    }
  } finally {
    await removeOwnPath(repo, roots, path).catch(() => undefined);
  }
  return { commit, failures, commands };
}

/** The facts a red check gives its debug task (system debug task spec §2): which commands failed, their exit and output tail. */
export function integrationCheckFacts(run: IntegrationCheckRun, groups: string[], target: string): string[] {
  return [
    `the target ${target} at ${run.commit}, after groups ${groups.join(", ")} were merged into it, fails these checks:`,
    ...run.failures.map((failure) => `\`${failure.command}\` exited ${failure.exit}${failure.tail === "" ? "" : `; the end of its output:\n${failure.tail}`}`.slice(0, 4096)),
  ].slice(0, 32);
}
