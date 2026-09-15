import { isHighTier } from "../metrics/highTier.js";
import type { DecisionObservation } from "../metrics/types.js";
import type { ReviewRow } from "./reviewsStore.js";

export interface PanelCoverage {
  reviewed_high_tier: number;
  high_tier_total: number;
  /** null, never 0, when the denominator is 0. */
  rate: number | null;
  caveat: string;
}

// A NUL (U+0000) join, not a space: spec section 4.2 keys by (projectKey, id) because a
// decision id repeats across clones and forks (compute.ts's decisionByKey
// carries the same lesson). A space-joined key would collide whenever either
// half itself contains a space; neither projectKey nor a decision id is
// guaranteed free of one.
const keyOf = (projectKey: string, id: string): string => `${projectKey}\x00${id}`;

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
 */
export function computePanelCoverage(
  decisions: readonly DecisionObservation[],
  reviews: readonly ReviewRow[],
): PanelCoverage {
  const highTier = new Set<string>();
  for (const d of decisions) {
    if (isHighTier(d.scope, d.kind)) highTier.add(keyOf(d.projectKey, d.id));
  }
  const reviewed = new Set<string>();
  for (const r of reviews) {
    if (r.action !== "reviewed") continue;
    const key = keyOf(r.projectKey, r.decisionId);
    if (highTier.has(key)) reviewed.add(key);
  }
  return {
    reviewed_high_tier: reviewed.size,
    high_tier_total: highTier.size,
    rate: highTier.size === 0 ? null : reviewed.size / highTier.size,
    caveat:
      "`reviewed` is a deliberate act, so this number can sit near zero for a long time -- and " +
      "a long-zero coverage is not distinguishable from nobody looking. Read it with the backlog, " +
      "not on its own.",
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
  const reviewed = new Set<string>();
  for (const r of reviews) {
    if (r.action !== "reviewed") continue;
    reviewed.add(keyOf(r.projectKey, r.decisionId));
  }
  return decisions.filter((d) => isHighTier(d.scope, d.kind) && !reviewed.has(keyOf(d.projectKey, d.id)));
}
