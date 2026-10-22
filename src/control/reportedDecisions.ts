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

const debugResultWithoutLocated = debugResultSchema.omit({ located: true });

/**
 * Reads only the top-level `debug` key, as reportedDecisionsOf reads `decisions`; a value the schema refuses is malformed.
 * `located` is read on its own (controller call, session b37f7ce9): a malformed `located` drops only itself, so the
 * agent's choseInstead and reproduction fields still count; a coarse correction's check then fails `not-located`.
 */
export function reportedDebugOf(result: unknown): ReportedDebug {
  if (typeof result !== "object" || result === null || !("debug" in result)) return { kind: "absent" };
  const value = (result as { debug?: unknown }).debug;
  if (value === undefined) return { kind: "absent" };
  const parsed = debugResultSchema.safeParse(value);
  if (parsed.success) return { kind: "object", value: parsed.data };
  if (typeof value === "object" && value !== null && !Array.isArray(value) && "located" in value) {
    const { located: _located, ...rest } = value as Record<string, unknown>;
    const withoutLocated = debugResultWithoutLocated.safeParse(rest);
    if (withoutLocated.success) return { kind: "object", value: withoutLocated.data };
  }
  return { kind: "malformed", value };
}

/**
 * Flow engine spec §4.3 (plan Task 8): what an agent in a flow step reports beside `decisions` and `debug`, under the
 * top-level `flow` key -- a request for a person (`needs`), choices it made that a later `ask` step offers again
 * (`candidates`, at most three, `recommended` indexing them), and the remote id of a side effect it enacted (`effect`).
 */
const text = z.string().min(1);
const flowCandidatesSchema = z.object({ items: z.array(text).min(1).max(3), recommended: z.number().int().min(0) }).strict()
  .refine((value) => value.recommended < value.items.length, { message: "recommended must index items" });
export const flowResultSchema = z.object({
  needs: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("confirmation"), what: text, payloadSummary: text }).strict(),
    z.object({ kind: z.literal("input"), question: text, candidates: z.array(text) }).strict(),
  ]).optional(),
  candidates: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/), flowCandidatesSchema).optional(),
  effect: z.object({ remoteId: text, url: text.optional() }).strict().optional(),
}).strict();
export type FlowResult = z.infer<typeof flowResultSchema>;
export type FlowNeeds = NonNullable<FlowResult["needs"]>;
export type ReportedFlow = { kind: "absent" } | { kind: "object"; value: FlowResult } | { kind: "malformed"; value: unknown };

/** Reads only the top-level `flow` key, as reportedDecisionsOf reads `decisions`; a value the schema refuses is malformed. */
export function reportedFlowOf(result: unknown): ReportedFlow {
  if (typeof result !== "object" || result === null || !("flow" in result)) return { kind: "absent" };
  const value = (result as { flow?: unknown }).flow;
  if (value === undefined) return { kind: "absent" };
  const parsed = flowResultSchema.safeParse(value);
  return parsed.success ? { kind: "object", value: parsed.data } : { kind: "malformed", value };
}
