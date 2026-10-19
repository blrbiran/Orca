export const DECISION_KINDS = [
  "dependency",
  "interface",
  "scheduling",
  "abandon",
  "criteria",
  "boundary",
  // Reconciling a merge conflict is an agent choosing between two agents'
  // code, not a scheduling choice. Folding it into "scheduling" would leave
  // the panel unable to tell an ordering decision from a code-content one,
  // and the second is an order of magnitude riskier.
  "reconcile",
  // Reported-decisions spec 2026-10-20 §6 (human ruling, same day): naming and local implementation trade-offs may be
  // reported too, graded minor; this is their home. Low tier (src/metrics/highTier.ts), so no metric moves.
  "implementation",
] as const;

/**
 * Reported-decisions spec 2026-10-20 §6 (goal.md §1.3): a decision's grade. "major" is what an interactive session
 * would have stopped to ask, or a direction, architecture or interface choice; "minor" is naming and local
 * implementation. A line without one (every line written before it) reads as major.
 */
export const DECISION_IMPORTANCES = ["major", "minor"] as const;
export type DecisionImportance = (typeof DECISION_IMPORTANCES)[number];

export const DECISION_SCOPES = ["file", "task", "repo", "cross-repo"] as const;

export type DecisionKind = (typeof DECISION_KINDS)[number];
export type DecisionScope = (typeof DECISION_SCOPES)[number];

/**
 * Three states, not a boolean. Per decision orca-dev-09cc3ea1/3:
 * spec §3.8's table header says "emit ok or a rejection reason", but row 3 of
 * that same table gives "downgraded to Tier 0" as the outcome for stale references.
 * Downgraded != rejected: the record itself is legal, this particular decision
 * just can't be made by an agent and must go to a human.
 */
export type ValidationResult =
  | { verdict: "ok" }
  | { verdict: "downgraded"; tier: 0; reasons: string[] }
  | { verdict: "rejected"; reasons: string[] };
