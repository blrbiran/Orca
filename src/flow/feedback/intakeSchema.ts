import { z } from "zod";

/**
 * Gaps spec §12: the JSON body of a `flow_feedback` row. Strict, so a typo in a field name fails the write rather than
 * hiding. Every field is present (an empty intake is `emptyIntakeBody()`); the types mirror `anchors.ts` / `locate.ts`.
 */
const anchor = z.object({ quote: z.string().optional(), heading: z.string().optional(), paragraph: z.number().int().min(1).optional() }).strict();
const hit = z.object({ file: z.string(), paragraph: z.number().int().min(1), headingPath: z.array(z.string()), excerpt: z.string() }).strict();
const result = z.union([
  z.object({ anchor, located: hit }).strict(),
  z.object({ anchor, hits: z.array(hit), more: z.number().int().min(0) }).strict(),
]);

export const IntakeBody = z.object({
  /** The anchors the message carried or text yielded (§4.1). */
  anchors: z.array(anchor),
  /** The search set locating ran over (§4.3): each markdown file with its last writer. */
  searchSet: z.array(z.object({ path: z.string(), writerKey: z.string() }).strict()),
  /** Per anchor: located, or its hits (§4.3). */
  results: z.array(result),
  /** The first triage verdict (§4.4); null until a triage call returned. */
  triage: z.object({ clarity: z.enum(["concrete", "vague"]) }).strict().nullable(),
  /** The restated feedback after a clarify round (§4.6). */
  restated: z.string().nullable(),
  /** The steps that take the feedback, with the model's reason (§4.4). */
  targets: z.array(z.object({ stepKey: z.string(), why: z.string() }).strict()),
  /** The plan made from this intake once `planned`. */
  planNo: z.number().int().min(1).nullable(),
  /** `triage-defaulted`, `clarify-skipped`, ... */
  flags: z.array(z.string()),
  /** The single calls spent on this intake (at most 3, §4.6). */
  calls: z.array(z.object({ purpose: z.string(), at: z.number().int() }).strict()),
  /** Rewind (§4.2): the message seq whose stored intake this one reuses. */
  reusedFrom: z.number().int().min(1).nullable(),
  /** Gaps plan Task 5 (schema extended by the intake driver): the step a step-targeted intake is on (null: the run). */
  stepKey: z.string().nullable(),
  /** The person's text, as the message carried it. */
  text: z.string(),
  /** §4.6 "use my words as they are": no vague verdict, no clarify round. */
  asIs: z.boolean(),
  /** §4.7: attachment ids (`<sha256>.<ext>`); every call and prompt gets them by id only (§21 entry 2). */
  attachments: z.array(z.string()),
  /** §4.8 `hit`: exact locations taken from a replaced intake's hits (located without a ladder, re-verified). */
  pins: z.array(z.object({ file: z.string(), paragraph: z.number().int().min(1) }).strict()),
  /** §4.3: the reading writer changed several files, so a whole-article or ordinal location is ambiguous among these. */
  ambiguousFiles: z.array(z.string()),
  /** The single call out now (triage, the clarify round, the second triage) and its retries; null when none is. */
  call: z.object({
    purpose: z.enum(["feedback-triage", "clarify"]), runId: z.string().nullable(), retries: z.number().int().min(0), lastInvalid: z.string().nullable(),
    callResult: z.object({ runId: z.string(), rawOutput: z.unknown(), failure: z.string().nullable() }).strict().nullable(),
    /** Review fix: false between writing the call and sending it; a pass finding it false sends it again. */
    requested: z.boolean(),
  }).strict().nullable(),
  /** §4.6: the clarify round's questions and the answers taken (the person's, or the recommended ones by consensus). */
  qa: z.array(z.object({ question: z.string(), answer: z.string() }).strict()),
}).strict();

export type IntakeBody = z.infer<typeof IntakeBody>;

export const emptyIntakeBody = (): IntakeBody => ({
  anchors: [], searchSet: [], results: [], triage: null, restated: null, targets: [], planNo: null, flags: [], calls: [], reusedFrom: null,
  stepKey: null, text: "", asIs: false, attachments: [], pins: [], ambiguousFiles: [], call: null, qa: [],
});
