import { z } from "zod";
import { commandSuccessObjectSchema, commandSuccessSchema } from "../webProtocol.js";

/**
 * Checks spec 2026-10-22 §4.4 (P1: no aliases): verbs removed from the command surface. A new command naming one is
 * refused by the raw schema like any unknown verb; a stored success body naming one (a ledger row written before the
 * removal) stays readable, so `GET …/commands/:id` and a replay keep answering it (plan Review Focus 1).
 */
export const RETIRED_VERBS = ["set-integration-check"] as const;

// Every retired verb was a repository-scoped settings verb: its own revision, no group projection.
const retiredSuccessSchema = commandSuccessObjectSchema.extend({
  verb: z.enum(RETIRED_VERBS),
  commandRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  projectionSeq: z.null(),
}).strict();

/** The read side of a stored success body: today's schema, else a retired verb's. */
export const storedCommandSuccessSchema = z.union([commandSuccessSchema, retiredSuccessSchema]);
