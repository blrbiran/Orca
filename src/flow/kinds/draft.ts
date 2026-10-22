/**
 * Flow engine spec §4.2 `draft`: one single call on the parent group (purpose `flow-draft`), its output validated by
 * code against a fixed schema; an invalid output takes the existing retry path (the kernel's, as clarify's and split's).
 * The model writes the content and nothing else (Rule 5).
 */
import { z } from "zod";
import type { KindDefinition } from "./registry.js";

export const DRAFT_JSON_SCHEMA = Object.freeze({
  type: "object", properties: { content: { type: "string" } }, required: ["content"], additionalProperties: false,
});
const draftOutputSchema = z.object({ content: z.string().min(1) }).strict();
export const DRAFT_MAX_OUTPUT_TOKENS = 32_000;

export const DRAFT_KIND: KindDefinition = {
  kind: "draft", kindVersion: 1, interactive: false,
  async start(ctx) {
    return { call: { purpose: "flow-draft", prompt: ctx.prompt(), responseSchema: DRAFT_JSON_SCHEMA, maxOutputTokens: DRAFT_MAX_OUTPUT_TOKENS } };
  },
  collect(_ctx, raw) {
    const parsed = draftOutputSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return { invalid: `schema:${issue?.path.join(".") ?? ""}:${issue?.message ?? "invalid"}` };
    }
    return { done: { record: { content: parsed.data.content } } };
  },
  projection: (record) => (record as { content: string }).content,
};
