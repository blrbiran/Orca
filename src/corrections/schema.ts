import { z } from "zod";

/**
 * corrections live in the DB, not in the ledger (A' §4.1, ruling
 * orca-dev-c1c3c2ec/1).
 *
 * ⚠️ This module is deliberately less strict than src/ledger/. A DB is
 * migratable -- adding a column, tightening one, backfilling are ordinary
 * operations -- while the ledger is append-only and a shape that lands wrong
 * can never be repaired. Strictness follows reversibility, not topic. This
 * round does NOT claim this shape is final: there is no database, no writer
 * and no CLI subcommand for it yet (spec §4.2).
 *
 * *** ERRATUM (2026-09-08, run orca-dev-ad1e30c6): the sentence above is now
 * false in two of its three clauses, and the original text is kept verbatim
 * because it is published. There IS a writer -- store.ts appends rows under
 * storeLock.ts -- and there IS a CLI subcommand, `orca dev correct`, with both a
 * record-only and a loop-closing mode. Only "there is no database" survives,
 * and that one is scheduled: it is subsystem E's third cut (E3), designed on
 * top of the metrics core specified in
 * docs/superpowers/specs/2026-09-08-metrics-core-and-query-design.md.
 *
 * What does NOT change is the paragraph's actual claim -- that this shape is
 * looser than src/ledger/ because a DB row is migratable and a ledger line is
 * not. That reasoning is untouched by the erratum; what expired is only the
 * inventory of what had been built when it was written. ***
 */
export const CORRECTION_KINDS = ["wrong", "not_my_taste", "stale"] as const;
export type CorrectionKind = (typeof CORRECTION_KINDS)[number];

const correctionShape = z
  .object({
    id: z.string().min(1),
    /**
     * The git remote URL -- the same key ccmem indexes memories by. Required,
     * because a decision id cannot say which repository its ledger lives in: a
     * run id is `orca-<taskId>-<hash8>` and that hash is over the contract
     * bytes and the base commit, with no repository identity in it. A central
     * corrections table therefore has to carry it itself.
     *
     * It is an identity, not a path: local checkouts move between machines, so
     * resolution happens at read time.
     */
    projectKey: z.string().min(1),
    decisionId: z.string().min(1).optional(),
    /**
     * Control run decisions plan Task 10 (debug-task design §12.3): a decision a landing refused has no ledger id, so
     * reject-pending-decision names the run and the pending item instead. Exactly one target per row (below).
     */
    runId: z.string().min(1).optional(),
    pendingId: z.string().min(1).optional(),
    kind: z.enum(CORRECTION_KINDS),
    chose_instead: z.string().min(1).optional(),
    /**
     * The human's reason. For the memory layer this is the most valuable field
     * in the row: a contrast sample is worth more than a stated preference
     * precisely because it carries the context in which the other branch was
     * refused (A' §4.3).
     */
    because: z.string().min(1),
    at: z.string().min(1),
    by: z.string().min(1),
    /**
     * CLI v2 spec §16: the channel the recording command came by (web, cli:<c>, mcp:<c>); `by` stays the person.
     * Optional: rows written before it, and by `orca dev correct`, have none.
     */
    via: z.string().min(1).optional(),
  })
  .strict();

/**
 * Only "the human wants a different one" has to name the different one
 * (ruling orca-dev-c1c3c2ec/12).
 *
 * wrong (the facts were wrong) and stale (right then, wrong now) may both have
 * no alternative to point at. Requiring one there buys a field filled with
 * "redo" -- and that kind of pollution cannot be backfilled away, because
 * afterwards nobody can tell a real answer from a coerced one. Widening later
 * is a migration; coerced content is permanent.
 */
export const correctionSchema = correctionShape.superRefine((value, ctx) => {
  const decision = value.decisionId !== undefined;
  const pending = value.runId !== undefined && value.pendingId !== undefined;
  const partial = (value.runId !== undefined) !== (value.pendingId !== undefined);
  if (decision === pending || partial) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [], message: "exactly one target: decisionId, or both runId and pendingId" });
  }
  if (value.kind === "not_my_taste" && value.chose_instead === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["chose_instead"],
      message: "required when kind is not_my_taste",
    });
  }
});

export type Correction = z.infer<typeof correctionShape>;

/** A correction of a recorded decision: the rows every decision-keyed reader (metrics, coverage, --close) works on. */
export type DecisionCorrection = Correction & { decisionId: string };

/**
 * debug-task design §12.3: readers keyed by decision id skip pending-target rows; that plan adds their own line
 * ("N corrections on unrecorded decisions").
 */
// Generic so a row without its id (CorrectionRow) is read by the same guard (target.ts).
export const namesDecision = <R extends { decisionId?: string }>(row: R): row is R & { decisionId: string } => row.decisionId !== undefined;
