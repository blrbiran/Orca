import type { z } from "zod";
import { intersect } from "../scheduler/pathTrie.js";
import type { taskContractSchema } from "../scheduler/planFile.js";
import { normalizeClaim, writeSetOf, type ClaimedPath } from "../scheduler/writeSet.js";

type TaskContract = z.infer<typeof taskContractSchema>;

export interface SiblingClaims { siblingId: string; claims: Array<{ repoKey: string | null; path: string }> }
export interface ParallelClaimsInput { taskId: string; dependencyTaskIds: readonly string[]; contract: TaskContract }

/**
 * A task's write set per repository: the primary repository under `null` (targetPaths ∪ allowlistPaths, as writeSetOf
 * reads them), each extra repository under its own key. Claims are compared only within one repository: the same path
 * in two repositories is two different files.
 */
function claimsByRepository(contract: TaskContract): Map<string | null, ClaimedPath[]> {
  const out = new Map<string | null, ClaimedPath[]>([[null, writeSetOf(contract)]]);
  for (const repo of contract.context.additionalRepos ?? []) {
    out.set(repo.key, [...repo.targetPaths, ...(repo.allowlistPaths ?? [])].map(normalizeClaim));
  }
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

function writeSetsIntersect(a: Map<string | null, ClaimedPath[]>, b: Map<string | null, ClaimedPath[]>): boolean {
  for (const [repoKey, claims] of a) {
    const other = b.get(repoKey);
    if (other !== undefined && intersect(claims, other).length > 0) return true;
  }
  return false;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Off-plan writes spec W1: for each v4 task (empty primary allowlist), the claims of every other task that may run at
 * the same time -- neither its ancestor nor its descendant, and with no write-set intersection in any one repository
 * (an intersection is an implicit edge, so that pair is ordered). Any task may be a sibling; a v3 task receives none,
 * since its own allowlist already bounds what it may write. Pure: the caller freezes the result into the contracts.
 */
export function parallelClaimsOf(tasks: readonly ParallelClaimsInput[]): Map<string, SiblingClaims[]> {
  const dependencies = new Map(tasks.map((t) => [t.taskId, t.dependencyTaskIds]));
  const ancestors = new Map(tasks.map((t) => [t.taskId, ancestorsOf(t.taskId, dependencies)]));
  const writeSets = new Map(tasks.map((t) => [t.taskId, claimsByRepository(t.contract)]));

  const out = new Map<string, SiblingClaims[]>();
  for (const t of tasks) {
    const siblings: SiblingClaims[] = [];
    if (t.contract.safetyPolicy.allowlistPaths.length === 0) {
      for (const s of tasks) {
        if (s.taskId === t.taskId) continue;
        if (ancestors.get(t.taskId)!.has(s.taskId) || ancestors.get(s.taskId)!.has(t.taskId)) continue;
        if (writeSetsIntersect(writeSets.get(t.taskId)!, writeSets.get(s.taskId)!)) continue;
        siblings.push({ siblingId: s.taskId, claims: declaredClaims(writeSets.get(s.taskId)!) });
      }
    }
    out.set(t.taskId, siblings.sort((a, b) => compareText(a.siblingId, b.siblingId)));
  }
  return out;
}

function declaredClaims(byRepository: Map<string | null, ClaimedPath[]>): SiblingClaims["claims"] {
  const unique = new Map<string, { repoKey: string | null; path: string }>();
  for (const [repoKey, claims] of byRepository) {
    // NUL cannot appear in a repository key or a path, so the composite key never collides.
    for (const claim of claims) unique.set(`${repoKey ?? ""}\0${claim.declared}`, { repoKey, path: claim.declared });
  }
  return [...unique.values()].sort((a, b) => compareText(a.repoKey ?? "", b.repoKey ?? "") || compareText(a.path, b.path));
}
