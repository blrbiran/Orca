import { posix } from "node:path";
import type { z } from "zod";
import { intersect } from "../scheduler/pathTrie.js";
import type { taskContractSchema } from "../scheduler/planFile.js";
import { normalizeClaim, writeSetOf, type ClaimedPath } from "../scheduler/writeSet.js";

type TaskContract = z.infer<typeof taskContractSchema>;

/**
 * `repoKey` is relative to the task that RECEIVES these claims, not to the sibling that declared them: `null` when the
 * claim lies in the receiver's primary repository, otherwise the receiver's own `additionalRepos[].key` for that
 * directory. A claim in a directory the receiver has no entry for is left out (the receiver cannot write there). A
 * sibling stays listed even when none of its claims lie in the receiver's directories.
 */
export interface SiblingClaims { siblingId: string; claims: Array<{ repoKey: string | null; path: string }> }
export interface ParallelClaimsInput { taskId: string; dependencyTaskIds: readonly string[]; contract: TaskContract }

type Directory = string;

/**
 * A repository is a directory (ruling 2026-11-18, fix round 1), never a role: in a multi-directory group a task's
 * primary is the first directory it writes, so two tasks' primaries can be different directories and one task's
 * primary can be another task's extra. Lexical only (posix.resolve), so the module stays pure: no fs, no realpath.
 */
function directoryOf(repoPath: string): Directory {
  return posix.resolve(repoPath);
}

/**
 * A task's write set per directory: the primary repository's targetPaths ∪ allowlistPaths (as writeSetOf reads them),
 * each extra repository's the same. The same path in two directories is two different files.
 */
function claimsByDirectory(contract: TaskContract): Map<Directory, ClaimedPath[]> {
  const out = new Map<Directory, ClaimedPath[]>([[directoryOf(contract.context.repoPath), writeSetOf(contract)]]);
  for (const repo of contract.context.additionalRepos ?? []) {
    out.set(directoryOf(repo.repoPath), [...repo.targetPaths, ...(repo.allowlistPaths ?? [])].map(normalizeClaim));
  }
  return out;
}

/** How a task names each directory it may write: `null` for its primary, its own key for each extra. */
function keysByDirectory(contract: TaskContract): Map<Directory, string | null> {
  const out = new Map<Directory, string | null>([[directoryOf(contract.context.repoPath), null]]);
  for (const repo of contract.context.additionalRepos ?? []) out.set(directoryOf(repo.repoPath), repo.key);
  return out;
}

/** Every task reachable from `taskId` over `dependencyTaskIds`. An id that names no task adds nothing. */
function ancestorsOf(taskId: string, dependencies: ReadonlyMap<string, readonly string[]>): Set<string> {
  const seen = new Set<string>();
  const stack = [...(dependencies.get(taskId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(dependencies.get(id) ?? []));
  }
  return seen;
}

function writeSetsIntersect(a: Map<Directory, ClaimedPath[]>, b: Map<Directory, ClaimedPath[]>): boolean {
  for (const [directory, claims] of a) {
    const other = b.get(directory);
    if (other !== undefined && intersect(claims, other).length > 0) return true;
  }
  return false;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Off-plan writes spec W1: for each v4 task (empty primary allowlist), the claims of every other task that may run at
 * the same time -- neither its ancestor nor its descendant, and with no write-set intersection in any one directory
 * (an intersection is an implicit edge, so that pair is ordered). Any task may be a sibling; a v3 task receives none,
 * since its own allowlist already bounds what it may write. Pure: the caller freezes the result into the contracts.
 */
export function parallelClaimsOf(tasks: readonly ParallelClaimsInput[]): Map<string, SiblingClaims[]> {
  const dependencies = new Map(tasks.map((t) => [t.taskId, t.dependencyTaskIds]));
  const ancestors = new Map(tasks.map((t) => [t.taskId, ancestorsOf(t.taskId, dependencies)]));
  const writeSets = new Map(tasks.map((t) => [t.taskId, claimsByDirectory(t.contract)]));

  const out = new Map<string, SiblingClaims[]>();
  for (const t of tasks) {
    const siblings: SiblingClaims[] = [];
    if (t.contract.safetyPolicy.allowlistPaths.length === 0) {
      const receiverKeys = keysByDirectory(t.contract);
      for (const s of tasks) {
        if (s.taskId === t.taskId) continue;
        if (ancestors.get(t.taskId)!.has(s.taskId) || ancestors.get(s.taskId)!.has(t.taskId)) continue;
        if (writeSetsIntersect(writeSets.get(t.taskId)!, writeSets.get(s.taskId)!)) continue;
        siblings.push({ siblingId: s.taskId, claims: declaredClaims(writeSets.get(s.taskId)!, receiverKeys) });
      }
    }
    out.set(t.taskId, siblings.sort((a, b) => compareText(a.siblingId, b.siblingId)));
  }
  return out;
}

function declaredClaims(byDirectory: Map<Directory, ClaimedPath[]>, receiverKeys: Map<Directory, string | null>): SiblingClaims["claims"] {
  const unique = new Map<string, { repoKey: string | null; path: string }>();
  for (const [directory, claims] of byDirectory) {
    const repoKey = receiverKeys.get(directory);
    if (repoKey === undefined) continue;
    // NUL cannot appear in a repository key or a path, so the composite key never collides.
    for (const claim of claims) unique.set(`${repoKey ?? ""}\0${claim.declared}`, { repoKey, path: claim.declared });
  }
  return [...unique.values()].sort((a, b) => compareText(a.repoKey ?? "", b.repoKey ?? "") || compareText(a.path, b.path));
}
