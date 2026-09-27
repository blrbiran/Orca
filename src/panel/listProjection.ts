import type { DecisionObservation } from "../metrics/types.js";

/**
 * spec section 4.2 / mutation L-3b. The ONE definition of what a list row
 * carries, in one place both the server and its criterion read.
 *
 * `question`, `chose`, `because` and every derivative of them are absent on
 * purpose. Section 1.5 measured that `question` CARRIES THE REASONING -- 122 of
 * the repository's own decisions do not even read as a question -- so a "one
 * line summary" taken from it would let a person read the reasoning off the
 * list, while the ledger records that they never opened it. The signal would be
 * void and no mutation would say so.
 *
 * The `satisfies` constraint buys a compile error for a name that is not a real
 * field, the same lever CORRECTION_FIELDS uses.
 *
 * *** ERRATUM (2026-09-27, session a50f4d80, branch ui/panel-redesign, human ruling U1) ***
 * The paragraph above no longer governs the list. The human, shown "keep the spec and fix
 * only the layout" as the recommended option, chose "show the question on the list".
 * Rows now carry `question` (the ledger's own value, or null) beside these six fields;
 * `reviewed` is still the only numerator of coverage, and `opened` is now weaker still.
 * See docs/superpowers/specs/2026-09-27-panel-ui-redesign-design.md §2. Text above kept verbatim.
 */
export const LIST_FIELDS = [
  "projectKey",
  "id",
  "at",
  "kind",
  "scope",
  "verdict",
] as const satisfies readonly (keyof DecisionObservation)[];

// `question` is optional in the TYPE only, on both sides (web/src/types.ts mirrors it), so the web
// criteria's existing literal rows still type-check without an edit nobody authorised; projectForList
// always sets it, and the two list criteria pin its presence with toStrictEqual.
export type DecisionListRow = Pick<DecisionObservation, (typeof LIST_FIELDS)[number]> & { question?: string | null };

export function projectForList(decision: DecisionObservation, question: string | null): DecisionListRow {
  const row = {} as Record<string, unknown>;
  for (const field of LIST_FIELDS) row[field] = decision[field];
  row.question = question;
  return row as DecisionListRow;
}

/** The ONE place a detail URL is spelled. Criteria and verify-panel.mjs both call it. */
export const detailUrl = (projectKey: string, decisionId: string): string =>
  `/api/decision?projectKey=${encodeURIComponent(projectKey)}&decisionId=${encodeURIComponent(decisionId)}`;

/**
 * The detail endpoint's one refusal code, named here rather than left as a
 * literal a criterion would have to retype (task 6 ruling H4).
 */
export const DECISION_NOT_FOUND = "decision-not-found";
