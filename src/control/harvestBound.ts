import type { z } from "zod";
import type { TaskRun } from "../scheduler/ccloopRunner.js";
import { harvest, type Reconciliation } from "../scheduler/harvest.js";
import type { taskContractSchema } from "../scheduler/planFile.js";
import { normalizeClaim, writeSetOf, type ClaimedPath } from "../scheduler/writeSet.js";
import { ControlError } from "./errors.js";

type TaskContract = z.infer<typeof taskContractSchema>;

/**
 * Off-plan writes #346, Task 4b (controller ruling 2026-11-18): Orca's own bound on a task attempt's harvest, per
 * repository. A v4 repository (its `allowlistPaths` an empty array: ccloop reads that as no allowlist) is bounded by its
 * denylist -- protected paths and the frozen sibling claims -- so a write outside targetPaths is not out of bounds and a
 * write into a sibling's claim still is, a second line behind ccloop's own denylist. Any other repository keeps the bound
 * it always had: targetPaths ∪ allowlistPaths.
 */
export type HarvestBound = { kind: "write-set"; claims: ClaimedPath[] } | { kind: "denylist"; patterns: string[] };

/** ccloop's denylist matcher, read the same way (ccloop src/policy/pathPolicy.ts `matches`, at ccloop 2a504f6). */
export function denylistMatches(pattern: string, path: string): boolean {
  if (pattern.endsWith("/**")) return path.startsWith(pattern.slice(0, -2));
  if (pattern === "**") return true;
  return pattern === path;
}

/** The primary repository's bound; a v≤3 contract's is exactly writeSetOf, as before. */
export function primaryHarvestBound(contract: TaskContract): HarvestBound {
  return contract.safetyPolicy.allowlistPaths.length === 0
    ? { kind: "denylist", patterns: [...contract.safetyPolicy.denylistPaths] }
    : { kind: "write-set", claims: writeSetOf(contract) };
}

/**
 * Multi-directory projects spec §7.2: an extra directory's bound from its own contract entry. An absent allowlist is
 * ccloop's default for an extra (that repository's targetPaths), not "none", so only an explicit empty one is v4.
 */
export function extraHarvestBound(contract: TaskContract, key: string): HarvestBound {
  const entry = contract.context.additionalRepos?.find((candidate) => candidate.key === key);
  if (entry === undefined) throw new ControlError("multi-dir-invalid", `contract:${key}`);
  if (entry.allowlistPaths !== undefined && entry.allowlistPaths.length === 0) return { kind: "denylist", patterns: [...(entry.denylistPaths ?? [])] };
  return { kind: "write-set", claims: [...entry.targetPaths, ...(entry.allowlistPaths ?? [])].map(normalizeClaim) };
}

/** The harvest under `bound`. A write-set bound is the harvest as it always was, byte for byte. */
export async function boundedHarvest(run: TaskRun, base: string, bound: HarvestBound, cloneDir?: string): Promise<Reconciliation> {
  if (bound.kind === "write-set") return harvest(run, base, bound.claims, cloneDir);
  // Nothing declared bounds a v4 write set, so the measurement is taken with no claims and judged by the denylist alone;
  // `declaredNotProduced` is empty by construction.
  const measured = await harvest(run, base, [], cloneDir);
  return { ...measured, outOfBounds: measured.actualPaths.filter((path) => bound.patterns.some((pattern) => denylistMatches(pattern, path))) };
}
