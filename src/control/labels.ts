import { z } from "zod";
import { ControlError } from "./errors.js";
import { safeInteger } from "./schema.js";

/**
 * Task labels (labels and progress spec §2.1; human rulings L-1, L-6, G11; §8 R15). Two kinds:
 *
 * - system labels: a bare word from G11's closed vocabulary. Only these are ever consumed by code (the later §3.3
 *   loop choice, metrics by label).
 * - custom labels: `custom:` plus 1-32 code points after NFC, any script, no whitespace or control character. Shown and
 *   filtered on, never consumed.
 *
 * The vocabulary is checked at the two INPUT doors only (the plan file and the set-task-labels command). Storage checks
 * format only (L-6), so a word dropped from the vocabulary later leaves every group that used it readable.
 */
export const SYSTEM_LABELS = ["feature", "bug", "refactor", "test", "doc", "design", "investigate", "perf", "security", "chore"] as const;
export type SystemLabel = (typeof SYSTEM_LABELS)[number];
export const CUSTOM_LABEL_PREFIX = "custom:";
export const MAX_TASK_LABELS = 16;
export const MAX_CUSTOM_LABEL_CODE_POINTS = 32;
/** Plan drafter finding F8: storage's own cap, looser than input on purpose, so no input rule change orphans a stored label. */
export const MAX_STORED_LABEL_CODE_POINTS = 64;

const SYSTEM = new Set<string>(SYSTEM_LABELS);
const LONE_SURROGATE = /\p{Cs}/u;
const WHITESPACE_OR_CONTROL = /[\s\p{Cc}]/u;
const codePoints = (value: string): number => [...value].length;

export type LabelCheck = { ok: true; labels: string[] } | { ok: false; detail: string };

/** One input label, normalized, or the detail that names why it is refused. */
function checkLabel(raw: string): { label: string } | { detail: string } {
  // Never echoed (plan finding F9): canonicalBytes refuses a lone surrogate, and a refusal's message is stored canonically.
  if (LONE_SURROGATE.test(raw)) return { detail: "lone-surrogate" };
  if (raw.startsWith(CUSTOM_LABEL_PREFIX)) {
    const body = raw.slice(CUSTOM_LABEL_PREFIX.length).normalize("NFC");
    const length = codePoints(body);
    if (length < 1 || length > MAX_CUSTOM_LABEL_CODE_POINTS || WHITESPACE_OR_CONTROL.test(body)) return { detail: raw };
    return { label: `${CUSTOM_LABEL_PREFIX}${body}` };
  }
  // Case-sensitive (R15): "Feature" is not a vocabulary word, and "Custom:x" is neither the prefix nor a word.
  return SYSTEM.has(raw) ? { label: raw } : { detail: raw };
}

/**
 * The input doors' one rule (spec §2.1, §8 R15): each label checked and normalized, then deduplicated, then at most
 * 16 counted after deduplication, then sorted by UTF-16 code unit (the default sort, never localeCompare).
 */
export function normalizeInputLabels(raw: readonly string[]): LabelCheck {
  const labels = new Set<string>();
  for (const item of raw) {
    const checked = checkLabel(item);
    if ("detail" in checked) return { ok: false, detail: checked.detail };
    labels.add(checked.label);
  }
  if (labels.size > MAX_TASK_LABELS) return { ok: false, detail: `count:${labels.size}` };
  return { ok: true, labels: [...labels].sort() };
}

/** The plan file's door (spec §2.2): any order, duplicates allowed, normalized here; a refusal names the label. */
export const inputLabelsSchema = z.array(z.string()).transform((raw, ctx) => {
  const checked = normalizeInputLabels(raw);
  if (checked.ok) return checked.labels;
  ctx.addIssue({ code: z.ZodIssueCode.custom, message: `labels-invalid:${checked.detail}` });
  return z.NEVER;
});

const storedLabelSchema = z
  .string()
  .min(1)
  .refine((value) => !LONE_SURROGATE.test(value) && codePoints(value) <= MAX_STORED_LABEL_CODE_POINTS, { message: "stored-label-format" });

function sortedUnique(values: readonly string[], ctx: z.RefinementCtx): void {
  for (let index = 1; index < values.length; index += 1) {
    if (!(values[index - 1]! < values[index]!)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index], message: "labels-not-sorted-unique" });
  }
}

/** Storage (L-6): format only -- non-empty, bounded, sorted by code unit, unique, at most 16. Never the vocabulary. */
export const storedLabelsSchema = z.array(storedLabelSchema).max(MAX_TASK_LABELS).superRefine(sortedUnique);
/** The archived plan's `labels` (spec §2.3): present only when non-empty, so a label-free plan's bytes never change. */
export const nonEmptyStoredLabelsSchema = z.array(storedLabelSchema).min(1).max(MAX_TASK_LABELS).superRefine(sortedUnique);

/** A work item's operator layer (spec §2.4): absent keys read as no override at version 0 -- no migration. */
export interface TaskLabelState { override: string[] | null; version: number }
const taskLabelFieldsSchema = z
  .object({ labelsOverride: storedLabelsSchema.nullable().optional(), labelsVersion: safeInteger.optional() })
  .passthrough();

export function readTaskLabelState(workBody: unknown): TaskLabelState {
  const parsed = taskLabelFieldsSchema.safeParse(workBody);
  if (!parsed.success) throw new ControlError("recovery-blocked", "work-item-labels-invalid");
  return { override: parsed.data.labelsOverride ?? null, version: parsed.data.labelsVersion ?? 0 };
}

/**
 * The one place a task's labels are decided (spec §2.5): an override wins -- even `[]`, which is the person clearing
 * them and differs from having no override -- otherwise the archived plan's labels, or none.
 */
export function effectiveTaskLabels(
  state: TaskLabelState,
  planLabels: readonly string[] | undefined,
): { labels: string[]; provenance: "plan" | "operator" } {
  return state.override !== null
    ? { labels: [...state.override], provenance: "operator" }
    : { labels: [...(planLabels ?? [])], provenance: "plan" };
}
