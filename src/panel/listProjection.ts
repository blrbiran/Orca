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
 */
export const LIST_FIELDS = [
  "projectKey",
  "id",
  "at",
  "kind",
  "scope",
  "verdict",
] as const satisfies readonly (keyof DecisionObservation)[];

export type DecisionListRow = Pick<DecisionObservation, (typeof LIST_FIELDS)[number]>;

export function projectForList(decision: DecisionObservation): DecisionListRow {
  const row = {} as Record<string, unknown>;
  for (const field of LIST_FIELDS) row[field] = decision[field];
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
