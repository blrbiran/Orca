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
 * Reference events pin only ev and id; everything else passes through —
 * decision orca-dev-09cc3ea1/5.
 * passthrough is required: the spec §3.3 bound example carries a note field.
 */
export const referenceEventSchema = z
  .object({
    ev: z.enum(["bound", "superseded", "overturned"]),
    id: z.string().min(1),
  })
  .passthrough();

export const REFERENCE_EVENT_TYPES = ["bound", "superseded", "overturned"] as const;

export type DecisionEvent = z.infer<typeof decisionEventSchema>;
export type ReferenceEvent = z.infer<typeof referenceEventSchema>;
