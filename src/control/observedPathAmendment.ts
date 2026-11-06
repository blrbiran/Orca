import { z } from "zod";
import { lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { taskContractSchema } from "../scheduler/planFile.js";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { ControlError } from "./errors.js";
import { exactObservedPath, pathPolicyMissesSchema, type PathPolicyMissV1 } from "./pathPolicyMisses.js";
import { readCanonicalRecord } from "./snapshot.js";
import type { ControlStore } from "./store.js";
import { normalizeClaim, writeSetOf } from "../scheduler/writeSet.js";
import { intersect } from "../scheduler/pathTrie.js";

type TaskContract = z.infer<typeof taskContractSchema>;
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const observedPathAmendmentSchema = z.object({
  schema: z.literal("orca-observed-path-amendment-v1"), groupId: z.string().min(1), taskId: z.string().min(1),
  version: z.number().int().positive().safe(), previousAmendmentHash: hashSchema.nullable(), sourceRunId: z.string().min(1),
  misses: pathPolicyMissesSchema, previousOriginalContractHash: hashSchema, nextOriginalContractHash: hashSchema,
  previousDerivedContractHash: hashSchema, nextDerivedContractHash: hashSchema,
  commandId: z.string().min(1), actor: z.string().min(1),
}).strict();
export type ObservedPathAmendment = z.infer<typeof observedPathAmendmentSchema>;

/** Change only the lists ccloop and Orca both use for a task's writable scope. */
export function appendObservedPaths(source: TaskContract, misses: readonly PathPolicyMissV1[]): TaskContract {
  const invalid = (detail: string): never => { throw new Error(`observed-path-invalid:${detail}`); };
  if (misses.length === 0) invalid("empty");
  const next = structuredClone(source);
  const seen = new Set<string>();
  for (const { repoKey, path } of misses) {
    if (!exactObservedPath(path)) invalid(`path:${path}`);
    const key = `${repoKey ?? ""}\0${path}`;
    if (seen.has(key)) invalid(`duplicate:${path}`);
    seen.add(key);
    if (repoKey === null) {
      if (next.safetyPolicy.allowlistPaths.length === 0 || next.safetyPolicy.allowlistPaths.includes(path)) invalid(`already-allowed:${path}`);
      if (!next.context.targetPaths.includes(path)) next.context.targetPaths.push(path);
      next.safetyPolicy.allowlistPaths.push(path);
      continue;
    }
    const extra = next.context.additionalRepos?.find((entry) => entry.key === repoKey);
    if (extra === undefined) return invalid(`repository:${repoKey}`);
    if (!extra.allowlistPaths?.length || extra.allowlistPaths.includes(path)) return invalid(`already-allowed:${repoKey}:${path}`);
    if (!extra.targetPaths.includes(path)) extra.targetPaths.push(path);
    extra.allowlistPaths.push(path);
  }
  return next;
}

type MirroredWrite = { dir: string; targetPaths: string[]; checks: string[] };

export interface ObservedPathScope { repoKey: string | null; repoPath: string; path: string }

/** A newly added exact path meets another task's declared write set in the same physical repository. */
export function observedPathOverlaps(original: TaskContract, miss: ObservedPathScope, other: TaskContract): boolean {
  const scope = miss.repoKey === null ? { targetPaths: original.context.targetPaths, allowlistPaths: original.safetyPolicy.allowlistPaths }
    : original.context.additionalRepos?.find((entry) => entry.key === miss.repoKey);
  if (scope === undefined) throw new Error("observed-path-invalid:repository");
  const claim = [normalizeClaim(miss.path)];
  if (intersect(claim, writeSetOf({ context: { targetPaths: scope.targetPaths }, safetyPolicy: { allowlistPaths: scope.allowlistPaths ?? [] } })).length > 0) return false;
  const others = [{ repoPath: other.context.repoPath, targetPaths: other.context.targetPaths, allowlistPaths: other.safetyPolicy.allowlistPaths },
    ...(other.context.additionalRepos ?? [])];
  return others.some((entry) => realpathSync(entry.repoPath) === miss.repoPath
    && intersect(claim, writeSetOf({ context: { targetPaths: entry.targetPaths }, safetyPolicy: { allowlistPaths: entry.allowlistPaths ?? [] } })).length > 0);
}

/** Fail closed on a denylist match or a path that crosses an existing symlink. */
export function validateObservedPathScopes(contract: TaskContract, misses: readonly PathPolicyMissV1[]): ObservedPathScope[] {
  if (misses.length === 0 || misses.length > contract.safetyPolicy.maxFilesTouched) throw new Error("observed-path-invalid:file-count");
  const matches = (pattern: string, path: string) => pattern === "**"
    || (pattern.endsWith("/**") ? path.startsWith(pattern.slice(0, -2)) : pattern === path);
  return misses.map(({ repoKey, path }) => {
    if (!exactObservedPath(path)) throw new Error(`observed-path-invalid:path:${path}`);
    const extra = repoKey === null ? null : contract.context.additionalRepos?.find((entry) => entry.key === repoKey);
    if (repoKey !== null && extra === undefined) throw new Error(`observed-path-invalid:repository:${repoKey}`);
    const repoPath = extra?.repoPath ?? contract.context.repoPath;
    const denylist = extra?.denylistPaths ?? contract.safetyPolicy.denylistPaths;
    if (denylist.some((pattern) => matches(pattern, path))) throw new Error(`observed-path-invalid:denylist:${path}`);
    let cursor = realpathSync(repoPath);
    for (const segment of path.split("/")) {
      cursor = join(cursor, segment);
      try { if (lstatSync(cursor).isSymbolicLink()) throw new Error(`observed-path-invalid:symlink:${path}`); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
        throw error;
      }
    }
    return { repoKey, repoPath: realpathSync(repoPath), path };
  });
}

/** A multi-directory work item's dispatch mirror advances with the contract, without changing its checks or order. */
export function mirrorObservedWrites(writes: unknown, original: TaskContract, misses: readonly PathPolicyMissV1[]): MirroredWrite[] | undefined {
  if (writes === undefined) {
    if (original.context.additionalRepos !== undefined) throw new Error("observed-path-writes-missing");
    return undefined;
  }
  if (!Array.isArray(writes)) throw new Error("observed-path-writes-invalid");
  const copy = structuredClone(writes) as MirroredWrite[];
  const primaryKey = original.context.repoKey ?? copy[0]?.dir;
  const expected = new Map<string, string[]>([
    [primaryKey!, original.context.targetPaths],
    ...(original.context.additionalRepos ?? []).map((entry) => [entry.key, entry.targetPaths] as [string, string[]]),
  ]);
  if (primaryKey === undefined || copy.length !== expected.size || new Set(copy.map((entry) => entry.dir)).size !== copy.length
    || copy.some((entry) => !expected.has(entry.dir) || !Array.isArray(entry.targetPaths) || !Array.isArray(entry.checks)
      || !canonicalBytes(entry.targetPaths).equals(canonicalBytes(expected.get(entry.dir))))) throw new Error("observed-path-writes-invalid");
  for (const miss of misses) {
    const write = copy.find((entry) => entry.dir === (miss.repoKey ?? primaryKey));
    if (write === undefined) throw new Error("observed-path-writes-invalid");
    if (!write.targetPaths.includes(miss.path)) write.targetPaths.push(miss.path);
  }
  return copy;
}

const invalidRecord = (taskId: string): never => { throw new ControlError("recovery-blocked", `observed-path-amendment-invalid:${taskId}`); };

/** Hash-linked records, oldest first. No reader trusts a work item's pointer without checking the whole chain. */
export function readObservedPathChain(store: ControlStore, groupId: string, taskId: string, work: unknown): ObservedPathAmendment[] {
  try {
    const state = work as { observedPathsVersion?: unknown; observedPathAmendmentHash?: unknown } | null;
    const version = state?.observedPathsVersion ?? 0, head = state?.observedPathAmendmentHash ?? null;
    if (version === 0 && head === null) return [];
    if (!Number.isSafeInteger(version) || typeof version !== "number" || version < 1 || !hashSchema.safeParse(head).success) return invalidRecord(taskId);
    const records: ObservedPathAmendment[] = [];
    let hash: string | null = head as string;
    for (let expected = version; expected > 0; expected--) {
      if (hash === null) return invalidRecord(taskId);
      const record = observedPathAmendmentSchema.parse(JSON.parse(readCanonicalRecord(store, hash)));
      if (record.groupId !== groupId || record.taskId !== taskId || record.version !== expected) return invalidRecord(taskId);
      const row = store.db.prepare("SELECT body FROM runs WHERE id=?").get(record.sourceRunId);
      if (row === undefined) return invalidRecord(taskId);
      const run = JSON.parse(String(row.body)) as { runId?: unknown; groupId?: unknown; taskId?: unknown;
        drive?: { outcome?: unknown; pathPolicyMisses?: unknown } };
      if (run.runId !== record.sourceRunId || run.groupId !== groupId || run.taskId !== taskId || run.drive?.outcome !== "blocked_waiting_human"
        || !canonicalBytes(run.drive.pathPolicyMisses).equals(canonicalBytes(record.misses))) return invalidRecord(taskId);
      records.push(record);
      hash = record.previousAmendmentHash;
    }
    if (hash !== null) return invalidRecord(taskId);
    return records.reverse();
  } catch { return invalidRecord(taskId); }
}

/** The loop recipe is verified before this call; each overlay must change only the paths the source run observed. */
export function applyObservedPathChain(store: ControlStore, groupId: string, taskId: string,
  base: { originalContractHash: string; originalContractCanonicalJson: string }, work: unknown): { originalContractHash: string; originalContractCanonicalJson: string } {
  let hash = base.originalContractHash, json = base.originalContractCanonicalJson;
  for (const record of readObservedPathChain(store, groupId, taskId, work)) {
    try {
      if (record.previousOriginalContractHash !== hash) return invalidRecord(taskId);
      const next = appendObservedPaths(JSON.parse(json) as TaskContract, record.misses);
      const nextJson = canonicalBytes(next).toString("utf8"), nextHash = sha256Canonical(next);
      if (nextHash !== record.nextOriginalContractHash || readCanonicalRecord(store, nextHash) !== nextJson) return invalidRecord(taskId);
      hash = nextHash; json = nextJson;
    } catch { return invalidRecord(taskId); }
  }
  return { originalContractHash: hash, originalContractCanonicalJson: json };
}
