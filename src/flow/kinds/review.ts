/**
 * Flow engine spec §4.2 `review`: an isolated judge (its role resolved `distinctFrom` the writer at start, §12.3) with
 * the template's rubric and a typed verdict `{verdict: pass | revise | fail, findings[]}`. It runs only after the gates
 * pass -- the kernel starts no step after a failed one. `revise` queues a revision of the reviewed step with the
 * findings as an `orca-auto` feedback message, at most `maxRounds` (default 2), then the review proceeds flagged red.
 */
import { z } from "zod";
import type { KindDefinition } from "./registry.js";

export const REVIEW_JSON_SCHEMA = Object.freeze({
  type: "object",
  properties: { verdict: { type: "string", enum: ["pass", "revise", "fail"] }, findings: { type: "array", items: { type: "string" } } },
  required: ["verdict", "findings"], additionalProperties: false,
});
const verdictSchema = z.object({ verdict: z.enum(["pass", "revise", "fail"]), findings: z.array(z.string().min(1)) }).strict();
export const REVIEW_MAX_ROUNDS_DEFAULT = 2;

export const REVIEW_KIND: KindDefinition = {
  kind: "review", kindVersion: 1, interactive: false,
  async start(ctx) {
    if (ctx.step.kind !== "review") throw new Error("orca: review kind on a non-review step");
    const step = ctx.step;
    const instruction = [
      ...(step.prompt === undefined ? [] : [ctx.asset(step.prompt).trimEnd()]),
      `Review the output of step \`${step.reviews}\` (under "Earlier steps' outputs") and give a verdict: pass, revise (with findings the writer must address) or fail.`,
    ].join("\n\n");
    const acceptance = step.rubric === undefined ? [] : [`Rubric:\n${ctx.asset(step.rubric).trimEnd()}`];
    return { call: { purpose: "flow-review", prompt: ctx.prompt({ instruction, acceptance }), responseSchema: REVIEW_JSON_SCHEMA, maxOutputTokens: 8_000 } };
  },
  collect(ctx, raw) {
    if (ctx.step.kind !== "review") throw new Error("orca: review kind on a non-review step");
    const parsed = verdictSchema.safeParse(raw);
    if (!parsed.success) return { invalid: `schema:${parsed.error.issues[0]?.path.join(".") ?? ""}:${parsed.error.issues[0]?.message ?? "invalid"}` };
    const record = parsed.data;
    if (record.verdict === "fail") return { failed: { reason: "review-failed", record } };
    if (record.verdict === "pass") return { done: { record } };
    const reviewed = ctx.step.reviews;
    const maxRounds = ctx.step.maxRounds ?? REVIEW_MAX_ROUNDS_DEFAULT;
    // Rounds spent: revisions of the reviewed step this review already queued.
    const spent = ctx.executions().filter((e) => e.stepKey === reviewed && (e.body as { reviewedBy?: string }).reviewedBy === ctx.step.id).length;
    if (spent >= maxRounds) return { done: { record, flags: ["review-unresolved"] } };
    return { done: { record, revise: { stepKey: reviewed, feedback: record.findings } } };
  },
  projection: (record) => {
    const r = record as { verdict: string; findings: string[] };
    return [`verdict: ${r.verdict}`, ...r.findings.map((f) => `- ${f}`)].join("\n");
  },
};
