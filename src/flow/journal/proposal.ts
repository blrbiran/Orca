/**
 * Flow engine spec §7.3: the rerun proposal (one `rerun-proposal` single call) may only remove. Its output is
 * `{skips: [{stepKey, reason}], startAt?}`; code checks that every key is a candidate, turns `startAt` into skips of the
 * earlier candidates, and refuses a skip of a feedback-targeted step. Anything else is invalid (the single call's
 * existing retry path; exhausted => no proposal, the plan is every candidate). The model cannot add, reorder or change.
 */
import { z } from "zod";
import type { Candidate } from "./candidates.js";

const proposalSchema = z.object({
  skips: z.array(z.object({ stepKey: z.string().min(1), reason: z.string().min(1) }).strict()),
  startAt: z.string().min(1).optional(),
}).strict();

export type Skip = { stepKey: string; reason: string };

export function validateProposal(raw: unknown, list: readonly Candidate[], feedbackTargets: ReadonlySet<string>): { ok: true; skips: Skip[] } | { ok: false; why: string } {
  const parsed = proposalSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, why: `schema: ${parsed.error.issues[0]?.message ?? "invalid"}` };
  const keys = list.map((c) => c.stepKey);
  const skips: Skip[] = [];
  if (parsed.data.startAt !== undefined) {
    const at = keys.indexOf(parsed.data.startAt);
    if (at === -1) return { ok: false, why: `startAt ${parsed.data.startAt} is not a candidate` };
    for (const key of keys.slice(0, at)) skips.push({ stepKey: key, reason: `before startAt ${parsed.data.startAt}` });
  }
  for (const skip of parsed.data.skips) {
    if (!keys.includes(skip.stepKey)) return { ok: false, why: `${skip.stepKey} is not a candidate` };
    if (skips.some((s) => s.stepKey === skip.stepKey) || parsed.data.skips.filter((s) => s.stepKey === skip.stepKey).length > 1) return { ok: false, why: `${skip.stepKey} is skipped twice` };
    skips.push(skip);
  }
  const targeted = skips.find((s) => feedbackTargets.has(s.stepKey));
  if (targeted !== undefined) return { ok: false, why: `${targeted.stepKey} has feedback; it may not be skipped` };
  return { ok: true, skips: keys.map((key) => skips.find((s) => s.stepKey === key)).filter((s): s is Skip => s !== undefined) };
}
