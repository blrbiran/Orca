import { z } from "zod";
import type { RangeGroup } from "../checks/range.js";

/**
 * Checks spec 2026-10-22 §6.3–§6.4: the review's output `orca-model-review-findings-v1` (zod, strict) and its validation
 * by code (Rule 5, P7: the model only finds). The schema and the range are checked first -- a file that fails either is
 * not read at all (the review is `errored`); then each finding's evidence is checked against the range's groups and the
 * files at its head, and an invalid finding is dropped with its reason.
 */
export const FINDINGS_SCHEMA = "orca-model-review-findings-v1";
const commit = z.string().regex(/^[a-f0-9]{40}([a-f0-9]{24})?$/);
const findingSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  category: z.enum(["contract-drift", "duplication", "uncovered-behaviour"]),
  severity: z.enum(["major", "minor"]),
  title: z.string().min(1).max(120),
  explanation: z.string().min(1).max(2000),
  evidence: z.array(z.object({ groupId: z.string().min(1).max(200), path: z.string().min(1).max(4096), line: z.number().int().min(1), note: z.string().max(300) }).strict()).min(2).max(8),
  suggestedFix: z.string().max(2000),
}).strict();
export const findingsSchema = z.object({
  schema: z.literal(FINDINGS_SCHEMA),
  range: z.object({ from: commit, to: commit }).strict(),
  findings: z.array(findingSchema).max(20).superRefine((findings, ctx) => {
    const ids = findings.map((finding) => finding.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "finding ids must be unique" });
  }),
}).strict();
export type FindingsDoc = z.infer<typeof findingsSchema>;
export type Finding = FindingsDoc["findings"][number];

export type ParsedFindings = { ok: true; doc: FindingsDoc } | { ok: false; reason: string };

/** Schema, then range: `schema:<first issue>` or `range-mismatch`. */
export function parseFindings(value: unknown, range: { from: string; to: string }): ParsedFindings {
  const parsed = findingsSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, reason: `schema:${issue?.path.join(".") ?? ""}: ${issue?.message ?? "invalid"}` };
  }
  if (parsed.data.range.from !== range.from || parsed.data.range.to !== range.to) return { ok: false, reason: "range-mismatch" };
  return { ok: true, doc: parsed.data };
}

/**
 * §6.4: valid only if every evidence entry names a group landed in the range, a path that group changed, a line within
 * the file at the range's head (`lineCount` null: no such file), and the entries span ≥ 2 distinct groups.
 */
export function validateFindings(doc: FindingsDoc, groups: readonly RangeGroup[], lineCount: (path: string) => number | null): { valid: Finding[]; dropped: Array<{ finding: Finding; reason: string }> } {
  const byId = new Map(groups.map((group) => [group.groupId, new Set(group.paths)]));
  const valid: Finding[] = [], dropped: Array<{ finding: Finding; reason: string }> = [];
  for (const finding of doc.findings) {
    const outside = finding.evidence.find((entry) => byId.get(entry.groupId)?.has(entry.path) !== true);
    if (outside !== undefined) { dropped.push({ finding, reason: `ref-not-in-range:${outside.groupId}:${outside.path}` }); continue; }
    if (finding.evidence.some((entry) => { const n = lineCount(entry.path); return n === null || entry.line > n; })) { dropped.push({ finding, reason: "line-out-of-file" }); continue; }
    if (new Set(finding.evidence.map((entry) => entry.groupId)).size < 2) { dropped.push({ finding, reason: "one-sided" }); continue; }
    valid.push(finding);
  }
  return { valid, dropped };
}
