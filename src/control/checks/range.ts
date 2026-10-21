import type { ChildResult } from "../integrationGit.js";
import type { LandedGroup } from "../integrationCheck.js";

/**
 * Checks spec 2026-10-22 §2.3, §3: the range W..H on a project's target and the groups Orca landed in it, by code with
 * git. "Landed in the range" = the group's integratedCommit is reachable from H and not from W. When W is no longer an
 * ancestor of H (someone rewrote the target), the range starts at merge-base(W, H) and is marked rebased (§5.3).
 */
export type Git = (repo: string, args: string[]) => Promise<ChildResult>;
export interface RangeGroup extends LandedGroup { paths: string[] }
export interface CheckRange { from: string; to: string; groups: RangeGroup[]; rebased: boolean }

async function ok(git: Git, repo: string, args: string[]): Promise<string> {
  const answer = await git(repo, args);
  if (answer.code !== 0) throw new Error(`git ${args.join(" ")}: ${answer.stderr.trim().slice(0, 200)}`);
  return answer.stdout;
}

// Commits are immutable: a range and a commit's changed paths, once computed, never change.
const rangeCache = new Map<string, { from: string; inRange: Set<string>; chain: Array<{ commit: string; parents: string[] }>; rebased: boolean }>();
const pathCache = new Map<string, string[]>();

/**
 * The paths a landed group's integration changed (spec §3, builder's rule): a merge commit (≥ 2 parents) ⇒ its diff
 * against its first parent; otherwise the diff from the nearest earlier first-parent commit of H that is the range's
 * start or another landed group's integratedCommit (a fast-forward or squash landing; it over-includes a person's
 * direct commits in between -- accepted, recorded in the plan's ledger).
 */
async function changedPaths(git: Git, repo: string, prev: string, commit: string): Promise<string[]> {
  const key = `${repo}\0${prev}\0${commit}`;
  const cached = pathCache.get(key);
  if (cached !== undefined) return cached;
  const paths = (await ok(git, repo, ["diff", "--name-only", "--no-renames", prev, commit])).split("\n").filter((line) => line !== "").sort();
  pathCache.set(key, paths);
  return paths;
}

/**
 * `landed` are the groups that count (system groups excluded); `boundaries` are every landed group's integrated commit
 * (system groups included), so a system group's own change is never attributed to the next counted group's paths.
 */
export async function rangeOf(git: Git, repo: string, W: string, H: string, landed: readonly LandedGroup[], boundaries: ReadonlySet<string> = new Set()): Promise<CheckRange> {
  const key = `${repo}\0${W}\0${H}`;
  let base = rangeCache.get(key);
  if (base === undefined) {
    const ancestor = await git(repo, ["merge-base", "--is-ancestor", W, H]);
    let from = W, rebased = false;
    if (ancestor.code !== 0) { from = (await ok(git, repo, ["merge-base", W, H])).trim(); rebased = true; }
    const inRange = new Set(from === "" ? [] : (await ok(git, repo, ["rev-list", `${from}..${H}`])).split("\n").filter((line) => line !== ""));
    const chain = (await ok(git, repo, ["rev-list", "--first-parent", "--reverse", "--parents", `${from}..${H}`])).split("\n").filter((line) => line !== "")
      .map((line) => { const [commit, ...parents] = line.split(" "); return { commit: commit!, parents }; });
    base = { from, inRange, chain, rebased };
    rangeCache.set(key, base);
  }
  const groups = landed.filter((group) => base.inRange.has(group.integratedCommit));
  const commits = new Set([...groups.map((group) => group.integratedCommit), ...boundaries]);
  const out: RangeGroup[] = [];
  for (const group of groups) {
    const at = base.chain.findIndex((entry) => entry.commit === group.integratedCommit);
    const entry = at === -1 ? null : base.chain[at]!;
    let prev: string;
    if (entry !== null && entry.parents.length >= 2) prev = entry.parents[0]!;
    else if (entry !== null) {
      prev = base.from;
      for (let i = at - 1; i >= 0; i -= 1) if (commits.has(base.chain[i]!.commit)) { prev = base.chain[i]!.commit; break; }
    } else prev = `${group.integratedCommit}^1`;
    out.push({ ...group, paths: await changedPaths(git, repo, prev, group.integratedCommit) });
  }
  // Oldest first, by the target's first-parent order (a group off the chain sorts last).
  const order = (group: RangeGroup) => { const i = base.chain.findIndex((entry) => entry.commit === group.integratedCommit); return i === -1 ? Number.MAX_SAFE_INTEGER : i; };
  out.sort((a, b) => order(a) - order(b));
  return { from: base.from, to: H, groups: out, rebased: base.rebased };
}

/** The largest number of range groups that changed one same path (0 or 1 means no overlap). */
export function overlapGroups(groups: readonly RangeGroup[]): number {
  const count = new Map<string, number>();
  for (const group of groups) for (const path of new Set(group.paths)) count.set(path, (count.get(path) ?? 0) + 1);
  return Math.max(0, ...count.values());
}
