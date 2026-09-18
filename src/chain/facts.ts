import { stat } from "node:fs/promises";
import { join } from "node:path";
import { CHAIN_RECORDS_DIR, CHECKPOINT_DIR, runIdFor } from "../checkpoint/schema.js";
import { chainGit as git } from "./git.js";

/** D-launch spec §4.1 (review 3): the gate, the chain's own config and records, and other sessions' checkpoints. */
export const GUARDED_PATHS = ["src/gate", ".claude", "scripts/gate-prefilter.mjs", ".orca/level.json", ".orca/chain.json", CHAIN_RECORDS_DIR, CHECKPOINT_DIR] as const;
/** Ignored by a global gitignore on the person's machine (spec §9), so `git status` never shows it; checked by existence. */
export const SETTINGS_LOCAL = ".claude/settings.local.json";

/** Guarded paths that differ from `startHead` (committed or not, tracked or untracked), except this session's own checkpoint. */
export async function guardedChanges(repo: string, startHead: string, sessionId: string): Promise<string[]> {
  const own = `${CHECKPOINT_DIR}/${runIdFor(sessionId)}.json`;
  const diffed = (await git(repo, ["diff", "--name-only", startHead, "--", ...GUARDED_PATHS])).split("\n");
  const untracked = (await git(repo, ["ls-files", "--others", "--exclude-standard", "--", ...GUARDED_PATHS])).split("\n");
  const changed = new Set([...diffed, ...untracked].filter((p) => p !== "" && p !== own));
  if (await stat(join(repo, SETTINGS_LOCAL)).then(() => true, () => false)) changed.add(SETTINGS_LOCAL);
  return [...changed].sort();
}

/** Spec §4.1: commits in from..HEAD that touch at least one path outside .orca/checkpoints/. An empty commit is not progress. */
export async function progressCommits(repo: string, from: string): Promise<number> {
  const shas = (await git(repo, ["rev-list", `${from}..HEAD`])).split("\n").filter((s) => s !== "");
  let n = 0;
  for (const sha of shas) {
    const paths = (await git(repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", sha])).split("\n").filter((p) => p !== "");
    if (paths.some((p) => !p.startsWith(`${CHECKPOINT_DIR}/`))) n += 1;
  }
  return n;
}

export async function worktreeClean(repo: string): Promise<boolean> {
  return (await git(repo, ["status", "--porcelain", "--untracked-files=all"])) === "";
}

export async function currentBranch(repo: string): Promise<string | null> {
  try {
    const name = (await git(repo, ["symbolic-ref", "--short", "-q", "HEAD"])).trim();
    return name === "" ? null : name;
  } catch {
    return null;
  }
}

export async function headOf(repo: string): Promise<string> {
  return (await git(repo, ["rev-parse", "HEAD"])).trim();
}

export async function isAncestor(repo: string, ancestor: string): Promise<boolean> {
  return git(repo, ["merge-base", "--is-ancestor", ancestor, "HEAD"]).then(() => true, () => false);
}
