/**
 * Web's own copies of the shapes the panel's UI touches.
 *
 * task 8 ruling K2: `web/` cannot import `src/` (a browser bundle cannot ship
 * the server's module graph), so these are hand-kept copies, not re-exports.
 * Parity with the real thing is enforced from the ROOT side, in
 * `tests/panel/webParity.test.ts` -- runtime field-set equality against
 * `METRICS_FIELDS` / `LIST_FIELDS`, and compile-time mutual-assignability
 * against `src/metrics/types.ts` / `src/panel/coverage.ts` /
 * `src/panel/listProjection.ts`. Every field here has to stay byte-for-byte
 * the same name as its server twin, or that file's `npm run typecheck`
 * assertion goes red.
 *
 * This file must stay free of JSX and DOM-only globals, so the ROOT tsconfig
 * (which has no `jsx` compiler option and no browser lib restriction it needs
 * to reach for) can import it too.
 */

export type DecisionKind =
  | "dependency"
  | "interface"
  | "scheduling"
  | "abandon"
  | "criteria"
  | "boundary"
  | "reconcile";

export type DecisionScope = "file" | "task" | "repo" | "cross-repo";

export type CorrectionKind = "wrong" | "not_my_taste" | "stale";

/**
 * Mirrors src/corrections/schema.ts's CORRECTION_KINDS -- same SET, order not
 * load-bearing here. The correction form's `kind` select offers exactly these.
 */
export const WEB_CORRECTION_KINDS = ["wrong", "not_my_taste", "stale"] as const satisfies readonly CorrectionKind[];

export interface MalformedLine {
  file: string;
  line: number;
  bytes: number;
  reason: string;
  torn: boolean;
}

export interface DecisionObservation {
  projectKey: string;
  id: string;
  at: string;
  kind: DecisionKind;
  scope: DecisionScope;
  verdict: "ok" | "downgraded";
}

export interface UnresolvedDecision {
  correctionId: string;
  projectKey: string;
  decisionId: string;
}

export interface RepoSummary {
  projectKey: string;
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
  bucket: string;
  numerator_corrections_excluding_stale: number;
  denominator_decisions: number;
  rate_excluding_stale: number | null;
  counted_through: string;
}

export interface CorrectionRate {
  numerator_corrections_excluding_stale: number;
  denominator_decisions: number;
  rate_excluding_stale: number | null;
  corrections_total_including_stale: number;
  by_decision_kind: CorrectionRateSlice[];
  buckets: CorrectionRateBucket[];
  caveats: string[];
}

export interface RepairRateBucket {
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
  oldest_age_ms: number | null;
  oldest_correction_id: string | null;
  by_correction_kind: BacklogSlice[];
}

export interface CorrectionKindCount {
  kind: CorrectionKind;
  corrections: number;
}

export interface ReviewCoverage {
  available: false;
  reason: string;
}

export interface MetricsReport {
  as_of: string;
  as_of_mode: "explicit" | "wall_clock";
  repos: RepoSummary[];
  correction_rate: CorrectionRate;
  repair_rate: RepairRate;
  backlog: Backlog;
  breakdown_by_correction_kind_including_stale: CorrectionKindCount[];
  review_coverage: ReviewCoverage;
  excluded_as_future: number;
  unresolved_decisions: UnresolvedDecision[];
  unkeyable_repos: Array<{ path: string; reason: string }>;
  malformed_lines: MalformedLine[];
}

/** Mirrors src/metrics/types.ts's METRICS_FIELDS -- same SET, order not load-bearing here. */
export const WEB_REPORT_FIELDS = [
  "as_of",
  "as_of_mode",
  "repos",
  "correction_rate",
  "repair_rate",
  "backlog",
  "breakdown_by_correction_kind_including_stale",
  "review_coverage",
  "excluded_as_future",
  "unresolved_decisions",
  "unkeyable_repos",
  "malformed_lines",
] as const satisfies readonly (keyof MetricsReport)[];

/** Mirrors src/panel/coverage.ts's PanelCoverage. */
export interface PanelCoverage {
  reviewed_high_tier: number;
  high_tier_total: number;
  /** null, never 0, when the denominator is 0. */
  rate: number | null;
  caveat: string;
}

/** Mirrors src/panel/listProjection.ts's DecisionListRow. */
export type DecisionListRow = Pick<DecisionObservation, "projectKey" | "id" | "at" | "kind" | "scope" | "verdict">;

/** Mirrors src/panel/listProjection.ts's LIST_FIELDS -- same SET, order not load-bearing here. */
export const WEB_LIST_FIELDS = [
  "projectKey",
  "id",
  "at",
  "kind",
  "scope",
  "verdict",
] as const satisfies readonly (keyof DecisionListRow)[];

/** D-launch spec §6.2. Mirrors src/panel/chains.ts's ChainView; parity: tests/panel/chainsApi.test.ts C10. */
export type ChainStopCategory = "done" | "blocked" | "limit" | "anomaly";
export interface ChainStopView {
  reason: string;
  category: ChainStopCategory;
  at: string;
  awaitingHuman: string[];
  detail: string | null;
}
export interface ChainView {
  chainId: string;
  goal: string;
  by: string;
  via: "cli" | "panel";
  startedAt: string;
  state: "running" | "stopped";
  holderGone: boolean;
  sessionsDone: number;
  costUsd: number | null;
  stop: ChainStopView | null;
}
export interface ChainRepoView {
  repoKey: string;
  defaultSessionTimeoutMin: number | null;
  chain: ChainView | null;
  problem: string | null;
}
export const WEB_CHAIN_VIEW_FIELDS = [
  "chainId", "goal", "by", "via", "startedAt", "state", "holderGone", "sessionsDone", "costUsd", "stop",
] as const satisfies readonly (keyof ChainView)[];
