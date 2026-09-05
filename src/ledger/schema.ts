import { z } from "zod";
import { DECISION_KINDS, DECISION_SCOPES } from "./types.js";

export const alternativeSchema = z
  .object({
    option: z.string().min(1),
    why_not: z.string().min(1),
  })
  .strict();

export const undoSchema = z
  .object({
    how: z.string().min(1),
    cost: z.string().min(1),
    blast_radius: z.string().min(1),
  })
  .strict();

export const decisionEventSchema = z
  .object({
    ev: z.literal("decision"),
    id: z.string().min(1),
    at: z.string().min(1),
    run: z.string().min(1),
    question: z.string().min(1),
    chose: z.string().min(1),
    alternatives: z.array(alternativeSchema).min(1),
    because: z.string().min(1),
    undo: undoSchema,
    scope: z.enum(DECISION_SCOPES),
    kind: z.enum(DECISION_KINDS),
    // Optional per spec §3.4's canonical example and §3.5.1 (evidence is how a
    // decision's trustworthiness is judged); not one of the 11 required fields
    // in §3.8 check 1, but legitimate. Fix round 1, finding 1.
    evidence: z.array(z.string()).optional(),
  })
  .strict();

/**
 * Single source of truth for the reference event names — fix wave finding 4
 * (whole-branch review): this list used to exist independently in three
 * places (here, inlined again in the schema below, and in
 * validateFile.ts's REFERENCE_EVENTS), which let check 5 silently
 * desynchronise from check 1 if only one copy was updated.
 */
export const REFERENCE_EVENT_TYPES = ["bound", "superseded", "overturned"] as const;

/**
 * Reference events pin only ev and id; everything else passes through —
 * decision orca-dev-09cc3ea1/5.
 * passthrough is required: the spec §3.3 bound example carries a note field.
 */
export const referenceEventSchema = z
  .object({
    ev: z.enum(REFERENCE_EVENT_TYPES),
    id: z.string().min(1),
  })
  .passthrough();

/**
 * bound is the one reference event that answers "which task implemented this
 * decision". Its two extra fields are required rather than optional because
 * the ledger is append-only: an optional field is one an agent will omit, and
 * the omission can never be repaired on a line already written. superseded and
 * overturned keep the looser shape — they do not carry that question.
 */
export const boundEventSchema = referenceEventSchema.extend({
  taskId: z.string().min(1),
  runId: z.string().min(1),
});

export type BoundEvent = z.infer<typeof boundEventSchema>;

/**
 * overturned is the one reference event pinned all the way down. It can be:
 * it has no rows yet (measured on this repository's own ledgers: 87 decision,
 * 7 bound, 0 superseded, 0 overturned), so no historical line needs the loose
 * shape to keep passing — and once a line is written it can never be repaired.
 * All six fields are required rather than optional for that reason: in an
 * append-only file an optional field is one that will simply never arrive.
 *
 * ev is overridden to a literal on purpose. referenceEventSchema types it as
 * the three-name enum, so without this line the schema would happily accept a
 * bound, and §3's field table would be claiming a check that does not exist.
 * bound carries the same looseness; that is pre-existing and left alone.
 */
export const overturnedEventSchema = referenceEventSchema.extend({
  ev: z.literal("overturned"),
  correctionId: z.string().min(1),
  replacedBy: z.string().min(1),
  at: z.string().min(1),
  run: z.string().min(1),
});

export type OverturnedEvent = z.infer<typeof overturnedEventSchema>;

export type ReferenceEventName = (typeof REFERENCE_EVENT_TYPES)[number];

/**
 * Event name to schema, exhaustively. A Record keyed by ReferenceEventName
 * rather than a chain of ternaries, so that adding a fourth reference event
 * without giving it a schema is a compile error instead of a silent
 * "unknown ev" at runtime. Same lever as keying the scheduler's check codes
 * by name instead of destructuring them by position.
 */
export const REFERENCE_EVENT_SCHEMAS: Record<ReferenceEventName, z.ZodTypeAny> = {
  bound: boundEventSchema,
  superseded: referenceEventSchema,
  overturned: overturnedEventSchema,
};

const REFERENCE_EVENT_NAMES: ReadonlySet<string> = new Set(REFERENCE_EVENT_TYPES);

/**
 * The router in validateLine used to spell these three names out again, which
 * made REFERENCE_EVENT_TYPES a source of truth for the schema but not for the
 * routing — a fourth name could be added to the constant and still be answered
 * with "unknown ev". Deriving the predicate here keeps the two in step by
 * construction rather than by anyone remembering to update both.
 */
export function isReferenceEventName(ev: unknown): ev is ReferenceEventName {
  return typeof ev === "string" && REFERENCE_EVENT_NAMES.has(ev);
}

export type DecisionEvent = z.infer<typeof decisionEventSchema>;
export type ReferenceEvent = z.infer<typeof referenceEventSchema>;
