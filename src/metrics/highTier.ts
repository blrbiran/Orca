import { DECISION_KINDS } from "../ledger/types.js";
import type { DecisionKind, DecisionScope } from "../ledger/types.js";

/**
 * A' §3.6's high-tier set, as corrected by A' ERRATUM 4.
 *
 * 🔴 An exhaustive classification, NOT a second whitelist. A' §3.6 spells six
 * kinds out in prose; DECISION_KINDS has seven, and the seventh — reconcile,
 * whose own comment calls it "an order of magnitude riskier" — sank to the
 * bottom because nobody updated the prose. A seventh name copied into here
 * would buy exactly the same silence for the eighth kind.
 *
 * Keying a Record by DecisionKind makes adding a kind without classifying it a
 * COMPILE error. Same lever as REFERENCE_EVENT_SCHEMAS in ledger/schema.ts and
 * as CORRECTION_FIELDS' `satisfies` in corrections/fields.ts, whose comment
 * says the constraint is there because it "buys a compile error".
 */
export const KIND_TIER: Record<DecisionKind, "high" | "low"> = {
  dependency: "high",
  interface: "high",
  scheduling: "high",
  abandon: "high",
  criteria: "high",
  boundary: "high",
  // A' ERRATUM 4: a class its own source calls an order of magnitude riskier
  // is precisely one that "cuts off future options" — A' §3.6's own test.
  reconcile: "high",
};

/**
 * A' §3.6's rule verbatim: scope ∈ {cross-repo, repo} AND kind in the high
 * set. Both halves — dropping the scope half would promote every file-scoped
 * naming decision the ledger was told never to report.
 */
const HIGH_SCOPES: ReadonlySet<DecisionScope> = new Set<DecisionScope>(["cross-repo", "repo"]);

export function isHighTier(scope: DecisionScope, kind: DecisionKind): boolean {
  return HIGH_SCOPES.has(scope) && KIND_TIER[kind] === "high";
}

/** Declaration order, for the total order spec §6 item 2 requires on kind buckets. */
export const KIND_ORDER: readonly DecisionKind[] = DECISION_KINDS;
