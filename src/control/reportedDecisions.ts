import { z } from "zod";

/**
 * The one place Orca knows where a run result keeps the decisions the agent reported:
 * the top-level `decisions` property. Everything downstream reads it through here.
 */
export type ReportedDecisions =
  | { kind: "absent" }
  | { kind: "array"; entries: unknown[] }
  | { kind: "malformed"; value: unknown };

export function reportedDecisionsOf(result: unknown): ReportedDecisions {
  if (typeof result !== "object" || result === null || !("decisions" in result)) return { kind: "absent" };
  const value = (result as { decisions?: unknown }).decisions;
  if (value === undefined) return { kind: "absent" };
  return Array.isArray(value) ? { kind: "array", entries: value } : { kind: "malformed", value };
}

/**
 * Debug-task design §12.8 (plan Task 8): what a debug run's agent reports beside `decisions`, under the top-level `debug`
 * key. Kept here so this module stays the only one that knows where an agent's reported values live in a run result.
 */
export const debugResultSchema = z.object({
  choseInstead: z.string().min(1).optional(),
  reproTests: z.array(z.string().min(1)).optional(),
  reproCommand: z.string().min(1).optional(),
  reproduction: z.literal("not-expressible").optional(),
  reproductionReason: z.string().min(1).optional(),
  // Flow engine spec §13.2 (W-COR): for a repository-only or bare-run correction, where the agent located it. Code
  // bounded where it could look (the frozen window); the person sees it; a located decision is cited when closing.
  located: z.object({
    groupId: z.string().min(1).optional(), runId: z.string().min(1).optional(), decisionId: z.string().min(1).optional(),
    paths: z.array(z.string().min(1)), because: z.string().min(1),
  }).strict().optional(),
}).strict();
export type DebugResult = z.infer<typeof debugResultSchema>;

export type ReportedDebug = { kind: "absent" } | { kind: "object"; value: DebugResult } | { kind: "malformed"; value: unknown };

/** Reads only the top-level `debug` key, as reportedDecisionsOf reads `decisions`; a value the schema refuses is malformed. */
export function reportedDebugOf(result: unknown): ReportedDebug {
  if (typeof result !== "object" || result === null || !("debug" in result)) return { kind: "absent" };
  const value = (result as { debug?: unknown }).debug;
  if (value === undefined) return { kind: "absent" };
  const parsed = debugResultSchema.safeParse(value);
  return parsed.success ? { kind: "object", value: parsed.data } : { kind: "malformed", value };
}
