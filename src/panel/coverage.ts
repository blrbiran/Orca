import { isHighTier } from "../metrics/highTier.js";
import type { DecisionObservation } from "../metrics/types.js";
import { keyOf, reviewStates } from "./reviewState.js";
import type { ReviewRow } from "./reviewsStore.js";

export interface PanelCoverage {
  reviewed_high_tier: number;
  high_tier_total: number;
  /** null, never 0, when the denominator is 0. */
  rate: number | null;
  caveat: string;
  /** Panel i18n spec §3.4: the caveat's stable code. */
  caveatCode: "reviewed-is-deliberate";
}

// `keyOf` -- the (projectKey, id) key and the reason it is NUL-joined -- now
// lives in reviewState.ts (decisions review withdraw spec section 4.2), beside
// the review state that is keyed by it.

/**
 * spec section 4.2. The numerator is distinct decisions carrying a `reviewed`
 * row; `opened` is deliberately absent from it.
 *
 * Why `opened` cannot be the numerator: the natural React implementation of a
 * table with a detail pane fetches the detail for the selected row, so holding
 * the down arrow through twenty rows produces twenty `opened` records and not
 * one of them was read. Moving the observation point to the server changes WHO
 * reports the signal, not WHAT causes it -- it defends against forgery, and
 * forgery was never the threat here. Noise is.
 *
 * `reviewed` is a deliberate act: a recorded correction, or an explicit "agreed
 * / nothing to change". An arrow key cannot produce either.
 *
 * *** ERRATUM (2026-10-18, session b304f167, decisions review withdraw spec section 4.2) ***
 * "carrying a `reviewed` row" now reads "with at least one person whose
 * latest reviewed/withdrawn row is `reviewed`": a review can be withdrawn. The
 * numerator is `reviewedKeys`, so there is one definition of reviewed.
 */
export function computePanelCoverage(
  decisions: readonly DecisionObservation[],
  reviews: readonly ReviewRow[],
): PanelCoverage {
  const highTier = new Set<string>();
  for (const d of decisions) {
    if (isHighTier(d.scope, d.kind)) highTier.add(keyOf(d.projectKey, d.id));
  }
  const reviewedAll = reviewedKeys(reviews);
  let reviewed = 0;
  for (const key of highTier) if (reviewedAll.has(key)) reviewed += 1;
  return {
    reviewed_high_tier: reviewed,
    high_tier_total: highTier.size,
    rate: highTier.size === 0 ? null : reviewed / highTier.size,
    caveat:
      "`reviewed` is a deliberate act, so this number can sit near zero for a long time -- and " +
      "a long-zero coverage is not distinguishable from nobody looking. Read it with the backlog, " +
      "not on its own.",
    caveatCode: "reviewed-is-deliberate",
  };
}

/**
 * spec section 4.2's mitigation, task 8 ruling K5: the panel's default view is
 * a to-do list of unreviewed high-tier decisions, because `reviewed` coverage
 * can sit near zero for a long time (the caveat above) and a click landing on
 * the work a person already owes is better than one landing nowhere.
 *
 * Reuses `keyOf` -- the SAME (projectKey, id) key `computePanelCoverage` uses
 * -- so there is one definition of "the same decision", not two that could
 * drift. `opened` rows are deliberately absent from `reviewed`, for the same
 * reason `computePanelCoverage` excludes them: an arrow key through a table
 * cannot produce a deliberate review. Output order is `decisions`' own order.
 */
export function unreviewedHighTier(
  decisions: readonly DecisionObservation[],
  reviews: readonly ReviewRow[],
): DecisionObservation[] {
  const reviewed = reviewedKeys(reviews);
  return decisions.filter((d) => isHighTier(d.scope, d.kind) && !reviewed.has(keyOf(d.projectKey, d.id)));
}

/**
 * Integration-and-panel-fixes spec §9.2(1): the set of decisions carrying a `reviewed` row, by the same
 * `keyOf` key `unreviewedHighTier` uses, and the per-decision answer built on it -- so the full list can say
 * `reviewed` / `highTier` without a second definition of either.
 *
 * *** ERRATUM (2026-10-18, session b304f167, decisions review withdraw spec section 4.2) ***
 * "carrying a `reviewed` row" becomes "with at least one active reviewer"
 * (`reviewStates`): a person's latest reviewed/withdrawn row decides, so a
 * withdrawn review no longer counts.
 */
export function reviewedKeys(reviews: readonly ReviewRow[]): Set<string> {
  const reviewed = new Set<string>();
  for (const [key, byPerson] of reviewStates(reviews)) {
    for (const action of byPerson.values()) {
      if (action === "reviewed") {
        reviewed.add(key);
        break;
      }
    }
  }
  return reviewed;
}

export function reviewFlags(
  d: DecisionObservation,
  reviewed: ReadonlySet<string>,
): { reviewed: boolean; highTier: boolean } {
  return { reviewed: reviewed.has(keyOf(d.projectKey, d.id)), highTier: isHighTier(d.scope, d.kind) };
}
