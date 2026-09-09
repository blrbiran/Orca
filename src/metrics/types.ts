import type { DecisionKind, DecisionScope } from "../ledger/types.js";
import type { CorrectionKind } from "../corrections/schema.js";

/**
 * A line that could not be turned into a row. spec §5.2: excluded from the
 * computation, named in the output, and the report still prints in full.
 *
 * `bytes` rather than the text itself: a corrections line carries a person's
 * own words, and a metrics report is the kind of thing that gets pasted into a
 * chat. The length tells a truncated write from a garbage line without
 * republishing what someone wrote.
 *
 * 🔴 `torn` lives on the LINE, not on the read. spec §5.2 row 4 exempts a bad
 * LAST line with no trailing newline — that is the expected race of reading an
 * append-only file, not corruption. A single flag per read cannot express it:
 * with one torn tail in the store and one genuinely corrupt middle line in a
 * ledger, a per-read flag either suppresses the exit code the corrupt line has
 * to produce, or invents one for the tail that must not produce it.
 */
export interface MalformedLine {
  file: string;
  line: number;
  bytes: number;
  reason: string;
  torn: boolean;
}

export interface LenientRead<T> {
  rows: T[];
  malformed: MalformedLine[];
}

/**
 * One decision, flattened to the few cells the metrics need.
 *
 * spec §3.4: validateLine's verdict decides membership. A `rejected` line does
 * NOT enter the denominator (it is not a legal record); a `downgraded` one DOES
 * (the record is legal, this particular decision just could not be made by an
 * agent — A' §1.1). Neither is a MALFORMED LINE; keeping those three apart is
 * the whole point of leaving the schema verdict to validateLine.
 */
export interface DecisionObservation {
  projectKey: string;
  id: string;
  at: string;
  kind: DecisionKind;
  scope: DecisionScope;
  verdict: "ok" | "downgraded";
}

/** spec §3.4.1: a correction whose decision is outside what was scanned. */
export interface UnresolvedDecision {
  correctionId: string;
  projectKey: string;
  decisionId: string;
}

/** An overturned row, already resolved back to the correction it closes. */
export interface OverturnedObservation {
  correctionId: string;
  at: string;
}

// ---------------------------------------------------------------------------
// Output shape. spec §6: this is the interface E3 and E4 take away, so it
// cannot be empty and it cannot depend on anyone's readdir order.
//
// 🔴 The names are load-bearing (§6 item 4). Two denominators live in here and
// they are DIFFERENT SETS: the correction rate excludes `stale` from its
// numerator (a stale correction is the world changing, not the agent being
// wrong — A' §4.2 as corrected by A' ERRATUM 3), while the repair rate keeps
// `stale` in its denominator (an unrepaired stale IS the backlog). Every field
// carries its qualifier in its own name so no reader can subtract one from the
// other and believe the result.
// ---------------------------------------------------------------------------

export interface RepoSummary {
  projectKey: string;
  /**
   * 🔴 Zero is a real, meaningful value here: a repository with decisions and
   * no corrections is exactly the one spec §2.1's scan exists to find.
   */
  decisions: number;
}

export interface CorrectionRateSlice {
  kind: DecisionKind;
  tier: "high" | "low";
  numerator_corrections_excluding_stale: number;
  denominator_decisions: number;
  rate_excluding_stale: number | null;
}

export interface CorrectionRateBucket {
  /** cohort by decision.at, "YYYY-MM" */
  bucket: string;
  numerator_corrections_excluding_stale: number;
  denominator_decisions: number;
  rate_excluding_stale: number | null;
  /**
   * 🔴 spec §3.3 requires an explicit per-bucket statement that a cohort bucket
   * is still filling in. A boolean would have to be a constant `true` — a
   * cohort bucket never closes, a decision from any month can be corrected
   * tomorrow — and a constant field is one no mutation can turn red. This
   * carries the as-of instead: the number is what was observable through this
   * instant, and re-running with a later --as-of can only raise it. It also
   * gives the "read the wall clock instead of as-of" mutation a place to land
   * in the golden diff.
   */
  counted_through: string;
}

export interface CorrectionRate {
  numerator_corrections_excluding_stale: number;
  denominator_decisions: number;
  /** null when the denominator is 0 — that is a different claim from 0. */
  rate_excluding_stale: number | null;
  corrections_total_including_stale: number;
  by_decision_kind: CorrectionRateSlice[];
  buckets: CorrectionRateBucket[];
  caveats: string[];
}

export interface RepairRateBucket {
  /** cohort by correction.at, "YYYY-MM" */
  bucket: string;
  numerator_overturned: number;
  denominator_corrections_including_stale: number;
  rate: number | null;
  counted_through: string;
}

export interface RepairRate {
  numerator_overturned: number;
  denominator_corrections_including_stale: number;
  rate: number | null;
  /**
   * spec §3.2.1 / A' ERRATUM 3: closing a `stale` needs a --chose-instead that
   * schema.ts says it may not have, so its repair rate is systematically low
   * and reads as "nobody is doing the work". Split out and labelled here; the
   * writer in E1 is NOT changed by this cut.
   */
  stale_only: {
    numerator_overturned: number;
    denominator_corrections: number;
    rate: number | null;
    known_bias: string;
  };
  buckets: RepairRateBucket[];
  caveats: string[];
}

export interface BacklogSlice {
  kind: CorrectionKind;
  open: number;
  oldest_age_ms: number | null;
}

export interface Backlog {
  open_corrections: number;
  /** wall clock: as_of minus correction.at (spec §4.1) */
  oldest_age_ms: number | null;
  oldest_correction_id: string | null;
  by_correction_kind: BacklogSlice[];
}

export interface CorrectionKindCount {
  kind: CorrectionKind;
  corrections: number;
}

/**
 * spec §3.5: this cut does not compute review coverage — its only producer is
 * the panel (E3). `available` is deliberately a constant until then, and what
 * is pinned is NOT this boolean but the caveat it forces into BOTH rates:
 * A' §4.4 says the correction rate must never be read alone.
 */
export interface ReviewCoverage {
  available: false;
  reason: string;
}

export interface MetricsReport {
  as_of: string;
  as_of_mode: "explicit" | "wall_clock";
  /** projectKey ascending */
  repos: RepoSummary[];
  correction_rate: CorrectionRate;
  repair_rate: RepairRate;
  backlog: Backlog;
  breakdown_by_correction_kind_including_stale: CorrectionKindCount[];
  review_coverage: ReviewCoverage;
  excluded_as_future: number;
  /** correctionId ascending */
  unresolved_decisions: UnresolvedDecision[];
  /** path ascending */
  unkeyable_repos: Array<{ path: string; reason: string }>;
  /** (file, line) ascending */
  malformed_lines: MalformedLine[];
}

/**
 * Serialization order comes from here, not from the object's own key order —
 * the same lever as CORRECTION_FIELDS in corrections/fields.ts, whose comment
 * says the `satisfies` constraint "buys a compile error" for a typo'd name.
 * Without a written-down order there is no byte-exact golden to diff against
 * (spec §6 item 1).
 *
 * ⚠️ This list is deliberately NOT in the same order as MetricsReport's own
 * declarations: a renderer that forgot to use it would then produce the same
 * bytes anyway, and the mutation that deletes the whitelist could not go red.
 */
export const METRICS_FIELDS = [
  "as_of",
  "as_of_mode",
  "correction_rate",
  "repair_rate",
  "backlog",
  "repos",
  "breakdown_by_correction_kind_including_stale",
  "review_coverage",
  "excluded_as_future",
  "unresolved_decisions",
  "unkeyable_repos",
  "malformed_lines",
] as const satisfies readonly (keyof MetricsReport)[];
