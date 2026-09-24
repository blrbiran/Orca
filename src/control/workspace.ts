import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { ORCA_IDENTITY, git } from "../scheduler/gitExec.js";
import { within } from "./archive.js";
import { privateDirectory } from "./paths.js";
import type { WorkspaceMode } from "./workspaceSettings.js";

/**
 * Execution driver spec §3 and §5. Every git command the driver runs in a repository a person owns,
 * or in a copy of one, carries these: a hook or an fsmonitor configured there must not run on the
 * driver's behalf (handoff §7.2).
 */
export const QUIET_GIT = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"];

export interface WorkspaceRoots { runsRoot: string; workspacesRoot: string }

/**
 * spec §3.2, deviation D9. `archiveRun` requires a source directory outside the store directory, and
 * the store directory is `<control root>/<repoKey>` itself, so the roots are its siblings: they move
 * with ORCA_CONTROL_DIR and --control-state-dir, and they are created 0700 (an existing one keeps its mode).
 */
export function controlWorkspaceRoots(stateDir: string): WorkspaceRoots {
  return { runsRoot: privateDirectory(`${stateDir}.runs`), workspacesRoot: privateDirectory(`${stateDir}.workspaces`) };
}

export const sourceDirOf = (roots: WorkspaceRoots, runId: string): string => join(roots.runsRoot, runId);
export const workspacePathOf = (roots: WorkspaceRoots, runId: string): string => join(roots.workspacesRoot, runId);
export const landingPathOf = (roots: WorkspaceRoots, runId: string): string => join(roots.workspacesRoot, `landing-${runId}`);
export const conflictPathOf = (roots: WorkspaceRoots, runId: string): string => join(roots.workspacesRoot, `conflict-${runId}`);
export const reconcileRunsDirOf = (roots: WorkspaceRoots, runId: string): string => join(roots.workspacesRoot, `reconcile-${runId}`);
export const workBranchRef = (groupId: string): string => `refs/heads/orca/${groupId}`;
export const incomingRefOf = (runId: string): string => `refs/orca/incoming/${runId}`;

/** Only a direct child of `workspacesRoot` is the driver's to create or delete (spec §3.5). */
function assertOwnPath(roots: WorkspaceRoots, path: string): void {
  if (dirname(path) !== roots.workspacesRoot || !within(roots.workspacesRoot, path)) {
    throw new Error(`orca: refusing to touch ${path}, which is not a workspace this driver named`);
  }
}

export async function revParse(repo: string, rev: string): Promise<string> {
  return (await git(repo, [...QUIET_GIT, "rev-parse", "--verify", `${rev}^{commit}`])).trim();
}

/**
 * spec §5.1: `orca/<groupId>` is created from the target repository's current HEAD commit and is never
 * checked out. Create-only (`update-ref <ref> <new> ""`), so a concurrent creator wins and this reads
 * whatever it created. Never deleted.
 */
export async function ensureWorkBranch(targetRepo: string, groupId: string): Promise<string> {
  const ref = workBranchRef(groupId);
  try { return await revParse(targetRepo, ref); } catch { /* absent: create it below */ }
  const head = await revParse(targetRepo, "HEAD");
  try { await git(targetRepo, [...QUIET_GIT, "update-ref", ref, head, ""]); } catch { /* created concurrently */ }
  return revParse(targetRepo, ref);
}

async function registeredWorktree(targetRepo: string, path: string): Promise<boolean> {
  const list = await git(targetRepo, [...QUIET_GIT, "worktree", "list", "--porcelain"]);
  return list.split("\n").some((line) => line === `worktree ${path}`);
}

/** A path the driver named: a registered worktree goes through git, anything else is deleted from disk. */
export async function removeOwnPath(targetRepo: string, roots: WorkspaceRoots, path: string): Promise<void> {
  assertOwnPath(roots, path);
  if (await registeredWorktree(targetRepo, path)) await git(targetRepo, [...QUIET_GIT, "worktree", "remove", "--force", path]);
  await rm(path, { recursive: true, force: true });
}

/** A checkout rooted exactly at `path` whose HEAD is `base`; a parent repository answering for it does not count. */
async function checkedOutAt(path: string, base: string): Promise<boolean> {
  try {
    if ((await git(path, [...QUIET_GIT, "rev-parse", "--show-toplevel"])).trim() !== path) return false;
    return await revParse(path, "HEAD") === base;
  } catch { return false; }
}

/** spec §3.2 / step A2: reuse a workspace already at `base`, otherwise delete this driver's own path and rebuild it. */
export async function ensureWorkspace(targetRepo: string, mode: WorkspaceMode, path: string, base: string, roots: WorkspaceRoots): Promise<void> {
  assertOwnPath(roots, path);
  if (existsSync(path)) {
    if (await checkedOutAt(path, base)) return;
    await removeOwnPath(targetRepo, roots, path);
  }
  if (mode === "worktree") {
    await git(targetRepo, [...QUIET_GIT, "worktree", "add", "--detach", path, base]);
    return;
  }
  await git(roots.workspacesRoot, [...QUIET_GIT, "clone", "--local", "--no-checkout", targetRepo, path]);
  await git(path, [...QUIET_GIT, "checkout", "--detach", base]);
}

/**
 * spec §3.3: the attempt commit is made from the result repository ccloop materialised
 * (`<sourceDir>/repo`), never read from `refs/ccloop/run/attempts/<n>`. A dirty tree is committed on
 * top of its HEAD; a clean one is taken as it is.
 */
export async function commitAttempt(resultRepo: string): Promise<string> {
  const status = await git(resultRepo, [...QUIET_GIT, "status", "--porcelain", "--untracked-files=all"]);
  if (status.trim().length > 0) {
    await git(resultRepo, [...QUIET_GIT, "add", "-A"]);
    await git(resultRepo, [...QUIET_GIT, ...ORCA_IDENTITY, "commit", "--allow-empty", "-m", "orca: attempt result"]);
  }
  return revParse(resultRepo, "HEAD");
}

/** spec §5.1: move `ref` to `next` only if it is still at `old`. False means someone moved it. */
export async function compareAndSwap(repo: string, ref: string, next: string, old: string): Promise<boolean> {
  try {
    await git(repo, [...QUIET_GIT, "update-ref", ref, next, old]);
    return true;
  } catch { return false; }
}

/** spec §3.5: a settled run's own workspace and its incoming ref. `orca/<groupId>` is never touched. */
export async function cleanupRunWorkspace(targetRepo: string, roots: WorkspaceRoots, runId: string, workspacePath: string): Promise<void> {
  if (basename(workspacePath) !== runId) throw new Error(`orca: refusing to clean ${workspacePath}, which is not named after ${runId}`);
  await removeOwnPath(targetRepo, roots, workspacePath);
  await git(targetRepo, [...QUIET_GIT, "update-ref", "-d", incomingRefOf(runId)]).catch(() => undefined);
}
