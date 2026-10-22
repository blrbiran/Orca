/**
 * Flow engine spec §7.3: the rerun proposal (one `rerun-proposal` single call) may only remove. Its output is
 * `{skips: [{stepKey, reason}], startAt?}`; code checks that every key is a candidate, turns `startAt` into skips of the
 * earlier candidates, refuses a skip of a feedback-targeted or fill step, and validates `unsure` marks (gaps spec §5.1). Anything else is invalid (the single call's
 * existing retry path; exhausted => no proposal, the plan is every candidate). The model cannot add, reorder or change.
 */
import { z } from "zod";
import type { Candidate } from "./candidates.js";

const proposalSchema = z.object({
  skips: z.array(z.object({ stepKey: z.string().min(1), reason: z.string().min(1) }).strict()),
  startAt: z.string().min(1).optional(),
  unsure: z.array(z.object({ stepKey: z.string().min(1), question: z.string().min(1).max(200) }).strict()).optional(),
}).strict();

export type Skip = { stepKey: string; reason: string };
export type Unsure = { stepKey: string; question: string };

export function validateProposal(raw: unknown, list: readonly Candidate[], feedbackTargets: ReadonlySet<string>): { ok: true; skips: Skip[]; unsure: Unsure[] } | { ok: false; why: string } {
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
  // A step the person's words (feedback targets) or hands (fill reason) put in the plan is never the model's to remove or doubt.
  const protectedKeys = new Set([...feedbackTargets, ...list.filter((c) => c.reasons.includes("fill")).map((c) => c.stepKey)]);
  const targeted = skips.find((s) => protectedKeys.has(s.stepKey));
  if (targeted !== undefined) return { ok: false, why: `${targeted.stepKey} has feedback or fill; it may not be skipped` };
  const unsure: Unsure[] = [];
  for (const mark of parsed.data.unsure ?? []) {
    const candidate = list.find((c) => c.stepKey === mark.stepKey);
    if (candidate === undefined) return { ok: false, why: `unsure ${mark.stepKey} is not a candidate` };
    if (unsure.some((u) => u.stepKey === mark.stepKey)) return { ok: false, why: `${mark.stepKey} is marked unsure twice` };
    if (skips.some((s) => s.stepKey === mark.stepKey)) return { ok: false, why: `${mark.stepKey} is both skipped and unsure` };
    if (protectedKeys.has(mark.stepKey)) return { ok: false, why: `${mark.stepKey} has feedback or fill; it may not be unsure` };
    if (candidate.reasons.includes("never-succeeded")) return { ok: false, why: `${mark.stepKey} never succeeded; there is no output to keep` };
    unsure.push(mark);
  }
  return {
    ok: true,
    skips: keys.map((key) => skips.find((s) => s.stepKey === key)).filter((s): s is Skip => s !== undefined),
    unsure: keys.map((key) => unsure.find((u) => u.stepKey === key)).filter((u): u is Unsure => u !== undefined),
  };
}
