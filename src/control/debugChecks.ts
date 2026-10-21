import { z } from "zod";
import type { PartialSelection } from "./agentSelection.js";
import type { DebugInputV1 } from "./debugInput.js";
import { DEBUG_DEFAULT_BUILD_TEST_COMMANDS } from "./debugPlan.js";
import { closingSchema } from "./driveRecord.js";
import { ControlError } from "./errors.js";
import { readArchivedPlan } from "./queries.js";
import type { ControlStore } from "./store.js";

// Leaf module: the debug mark and the checks guard. webDispatch.ts (start) and webService.ts (confirm) use the guard, and
// debugGroup.ts imports executionDriver, which imports webDispatch, so the guard cannot live there without a cycle.

/** Declared here (null at open); Task 9 fills it when the debug run's landing closes the correction. */
export type ClosingRecord = { state: "written"; relPath: string; fixRunId: string } | { state: "refused"; reason: string }
  | { state: "chose-instead-missing" } | { state: "closed-by-human-first"; commit: string };

export interface DebugMark {
  correctionId: string; ordinal: number; inputHash: string; missing: DebugInputV1["missing"];
  agentFallback: { original: PartialSelection; reason: string } | null; undoHow: string | null; closing: ClosingRecord | null;
  /** CLI v2 spec §16: who gave `undoHow` and by which channel; null without one (and on marks written before it). */
  undoHowBy: { by: string; via: string } | null;
  /** Where the task's checks came from (the owner or an agent named them); `namedBy` is null when only the original's are used. */
  checks: { from: "original" | "original+named" | "named"; namedBy: "human" | "agent" | null };
  /**
   * Debug task plan Task 10 (ruling C22, fix round 1): when the integration pass recorded this group's `correction-closed`
   * activity row (store clock, ms), written in that row's transaction; null until then. Durable where the activity row
   * is not (retention keeps 500 rows a group), so a later settle writes no second row. A mark written before it is null.
   */
  closedNotedAt: number | null;
}

const debugMarkSchema = z.object({
  correctionId: z.string().min(1), ordinal: z.number().int().positive(), inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  missing: z.array(z.enum(["run", "base", "attemptSha", "objects", "contract"])),
  agentFallback: z.object({
    original: z.object({ agent: z.string().optional(), model: z.string().optional(), contextWindow: z.string().optional() }).strict(),
    reason: z.string().min(1),
  }).strict().nullable(),
  undoHow: z.string().min(1).nullable(), closing: closingSchema.nullable(),
  undoHowBy: z.object({ by: z.string().min(1), via: z.string().min(1) }).strict().nullable().default(null),
  checks: z.object({ from: z.enum(["original", "original+named", "named"]), namedBy: z.enum(["human", "agent"]).nullable() }).strict()
    .default({ from: "original", namedBy: null }),
  closedNotedAt: z.number().int().nonnegative().nullable().default(null),
}).strict();

/** A group body's debug mark; null on a group no correction opened. A mark that does not parse blocks by name, as the archive mark does. */
export function readDebugMark(group: unknown): DebugMark | null {
  if (typeof group !== "object" || group === null || !Object.hasOwn(group, "debug")) return null;
  const parsed = debugMarkSchema.safeParse((group as { debug: unknown }).debug);
  if (!parsed.success) throw new ControlError("recovery-blocked", "debug-mark-invalid");
  return parsed.data as DebugMark;
}

/** A debug group's mark, where the caller knows the group is one (debugGroupIds): a group without one blocks by name. */
export function requireDebugMark(group: unknown): DebugMark {
  const mark = readDebugMark(group);
  if (mark === null) throw new ControlError("recovery-blocked", "debug-mark-missing");
  return mark;
}

/**
 * Controller ruling (Task 4): a debug group whose task still lists the placeholder check (no original contract was found)
 * is neither confirmed nor started; the agent could not be held to a check nobody named. A group no correction opened is
 * unaffected. Called inside the confirm and start transactions, so the refusal is booked like the others.
 */
export function refuseUnnamedDebugChecks(store: ControlStore, groupId: string, group: unknown): void {
  if (readDebugMark(group) === null) return;
  const placeholder = new Set<string>(DEBUG_DEFAULT_BUILD_TEST_COMMANDS);
  for (const task of readArchivedPlan(store, groupId).plan.tasks) {
    const contract = JSON.parse(task.originalContractCanonicalJson) as { verification: { requiredChecks: string[] } };
    if (contract.verification.requiredChecks.some((check) => placeholder.has(check))) throw new ControlError("debug-checks-unnamed", task.taskId);
  }
}

