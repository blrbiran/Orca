import { posix } from "node:path";
import type { z } from "zod";
import { intersect } from "../scheduler/pathTrie.js";
import { denylistMatches } from "./harvestBound.js";
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

/**
 * A task's write set as one list for buildGraph (plan Task 3: the implicit write-set edges that order a confirmed plan),
 * each claim prefixed by its directory as a single NUL-led segment, the way qualifiedWriteSetOf prefixes a split's: two
 * claims intersect only within one directory, and the same relative path in two directories never does.
 */
export function directoryQualifiedWriteSetOf(contract: TaskContract): ClaimedPath[] {
  return [...claimsByDirectory(contract)].flatMap(([directory, claims]) => claims.map((claim) => ({
    normalized: `\0${encodeURIComponent(directory)}/${claim.normalized}`, declared: claim.declared,
  })));
}

/**
 * Plan Task 3 fix round 1 (ruling: `off-plan-claims-overlap`): the frozen claims that meet `contract`'s own write set, read
 * as `contract` keys them (`null` its primary, a key its extra repository of that key), compared as the write-set rules
 * compare (normalizeClaim, intersect). Named as the constraint line names them (`<key>:<path>` for an extra repository's),
 * sorted and de-duplicated. A claim keyed to a repository `contract` has no entry for meets nothing here.
 */
export function ownWritesDenied(contract: TaskContract, siblings: readonly SiblingClaims[]): string[] {
  const writeSets = new Map<string | null, ClaimedPath[]>([[null, writeSetOf(contract)],
    ...(contract.context.additionalRepos ?? []).map((repo): [string, ClaimedPath[]] => [repo.key, [...repo.targetPaths, ...(repo.allowlistPaths ?? [])].map(normalizeClaim)])]);
  const denied = new Set<string>();
  for (const claim of siblings.flatMap((sibling) => sibling.claims)) {
    const own = writeSets.get(claim.repoKey);
    if (own !== undefined && intersect([normalizeClaim(claim.path)], own).length > 0) denied.add(claim.repoKey === null ? claim.path : `${claim.repoKey}:${claim.path}`);
  }
  return [...denied].sort(compareText);
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

/** A stop on a parallel sibling's claim: the path, its repository (receiver-relative, as the claims are), the siblings. */
export interface ParallelClaim { path: string; repoKey: string | null; siblingIds: string[] }

export const DENYLIST_STOP = "denylist match: ";
const OUT_OF_BOUNDS_STOP = "out-of-bounds:";

/**
 * Off-plan writes W4 (#346, plan Task 5; moved here from src/panel/runDiagnosis.ts in fix round 1, so the driver that
 * records the block classifies it without importing the panel): the path a v4 run was stopped on for writing a parallel sibling's frozen claim,
 * and the siblings whose claim it is -- matched with ccloop's denylist rule (exact, `<dir>/**` by prefix, `**`), in the
 * repository the stop names. `null` when the stop is of neither shape below, or names only paths no sibling claims (a
 * protected path: that stop keeps its own diagnosis).
 *
 * The two stops are read so:
 * - ccloop's gate, `denylist match: <path>`, or `denylist match: <key>:<path>` for an extra repository (ccloop's runLoop
 *   prefixes the extra's key). The key is relative to the receiving task (as `siblings`' claims are), so it is read as a
 *   key only when it is one of `contract`'s `additionalRepos[].key`; otherwise the whole is a primary path that holds `:`.
 * - Orca's harvest bound at collect (executionDriver), `out-of-bounds:<paths>` for one directory and, in a multi-directory
 *   run, `out-of-bounds:<key>:<paths>;<key>:<paths>...` keyed by the run's `drive.dirs[].key`. `primaryDirKey` is that run's
 *   first directory's key (its primary, which the receiver keys `null`); it is given exactly for a multi-directory run.
 *   A segment keyed by neither it nor an extra key of `contract`'s is skipped. Paths are joined by `,` and segments by `;`
 *   as the producer joins them; a path that itself holds `,` (or, multi-directory, `;`) is misread as several, and a
 *   piece that matches no claim is simply not a parallel claim.
 * Where several paths qualify, the first in the stop's order answers.
 */
export function parallelClaimOf(stopReason: string | undefined, contract: TaskContract, siblings: readonly SiblingClaims[], primaryDirKey?: string): ParallelClaim | null {
  const extraKeys = new Set((contract.context.additionalRepos ?? []).map(repo => repo.key));
  let candidates: Array<{ repoKey: string | null; path: string }>;
  if (stopReason?.startsWith(DENYLIST_STOP) === true) {
    const named = stopReason.slice(DENYLIST_STOP.length), colon = named.indexOf(":");
    const key = colon < 0 ? null : named.slice(0, colon);
    candidates = [key !== null && extraKeys.has(key) ? { repoKey: key, path: named.slice(colon + 1) } : { repoKey: null, path: named }];
  } else if (stopReason?.startsWith(OUT_OF_BOUNDS_STOP) === true) {
    const listed = stopReason.slice(OUT_OF_BOUNDS_STOP.length);
    candidates = primaryDirKey === undefined ? listed.split(",").map(path => ({ repoKey: null, path }))
      : listed.split(";").flatMap(segment => {
        const colon = segment.indexOf(":"), key = segment.slice(0, colon);
        const repoKey = colon < 0 ? undefined : key === primaryDirKey ? null : extraKeys.has(key) ? key : undefined;
        return repoKey === undefined ? [] : segment.slice(colon + 1).split(",").map(path => ({ repoKey, path }));
      });
  } else return null;
  for (const candidate of candidates) {
    const siblingIds = siblings.filter(sibling => sibling.claims.some(claim => claim.repoKey === candidate.repoKey && denylistMatches(claim.path, candidate.path)))
      .map(sibling => sibling.siblingId);
    if (siblingIds.length > 0) return { ...candidate, siblingIds };
  }
  return null;
}
