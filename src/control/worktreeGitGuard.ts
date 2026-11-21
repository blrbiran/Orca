import { join } from "node:path";
import { netChangeSet } from "../scheduler/harvest.js";

/**
 * Tester #328: a worktree workspace's `.git` points at the project's shared, read-only Git directory, so an agent
 * that needs to make a merge commit there invents a second git directory inside the worktree (`.git-merge-local`,
 * `GIT_DIR=...`) and materialises the resulting tree back. That attempt, if landed, carries a tree that has the
 * shape of a merge but is not one; refuse it by name instead of recording a landed tip.
 *
 * The check runs over the paths `base..attempt` actually committed, so a directory the agent created untracked (or
 * that its `.gitignore` hides) is invisible once the worktree is cleaned up -- the limitation is stated here rather
 * than covered by a test that would claim otherwise.
 */

/** Files that legitimately start with `.git` and are not a git directory of their own. */
const KNOWN_DOT_GIT_NAMES = new Set([
  ".gitignore", ".gitattributes", ".gitmodules", ".github", ".git-blame-ignore-revs", ".gitlab-ci.yml"
]);

/** The path whose first offending component names an alternate git directory (the entry itself, or one below it). */
export function alternateGitPathIn(paths: readonly string[]): string | null {
  for (const path of paths) {
    const hit = path.split("/").find((part) => part.startsWith(".git-") && !KNOWN_DOT_GIT_NAMES.has(part));
    if (hit !== undefined) return path;
  }
  return null;
}

/**
 * The alternate git directory an attempt carried, or null. The attempt's range is read from the target repository
 * when it has the attempt (pinned attempt-delivery runs) and otherwise from the run's own result copy; an unreadable
 * range is not evidence, so it never blocks -- the same rule the off-plan record follows.
 */
export async function alternateGitDirOf(
  repo: string,
  drive: { base: string | null; attemptSha: string | null; sourceDir: string },
): Promise<string | null> {
  if (drive.base === null || drive.attemptSha === null) return null;
  for (const candidate of [repo, join(drive.sourceDir, "repo")]) {
    try {
      return alternateGitPathIn(await netChangeSet(candidate, drive.base, drive.attemptSha));
    } catch { continue; }
  }
  return null;
}
