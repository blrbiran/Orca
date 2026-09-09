import { CORRECTION_KINDS } from "../corrections/schema.js";
import type { CorrectionKind } from "../corrections/schema.js";
import { KIND_ORDER, KIND_TIER } from "./highTier.js";
import type { Observations } from "./collect.js";
import type {
  Backlog,
  BacklogSlice,
  CorrectionKindCount,
  CorrectionRate,
  CorrectionRateBucket,
  CorrectionRateSlice,
  MetricsReport,
  RepairRate,
  RepairRateBucket,
  RepoSummary,
} from "./types.js";

/**
 * 🔴 Pure: zero fs, zero clock, zero git. `now` never appears — every instant
 * this function uses comes in as `obs.asOf`, injected by the caller (spec §4.3,
 * §5). This is the one module E3 and E4 both consume, and a metrics layer with
 * a filesystem and a clock in it is one each of them would end up copying,
 * which is the drift A' §4.4 exists to prevent.
 *
 * `Date.parse` is a pure string→number conversion and is the only date call
 * here — no wall clock and no monotonic clock is read anywhere in this file.
 */
export interface ComputeOptions {
  /**
   * Cohort granularity. A function argument rather than a constant welded into
   * the body: spec §6 calls this output "the interface E3 and E4 take away",
   * and `bucket`'s value domain is part of that interface. Not a CLI flag —
   * nobody has asked for a second granularity, and an unused switch is the
   * speculation CLAUDE.md Rule 2 forbids.
   */
  bucket: "month";
}

const NO_REVIEW_COVERAGE =
  "review coverage has no data: its only producer is the panel (E2 spec §3.5), " +
  "and A' §4.4 says the correction rate must never be read on its own";

const UNRESOLVED_CAVEAT =
  "some corrections point at decisions outside what was scanned (see unresolved_decisions); " +
  "they count in the totals but sit in no decision-kind bucket";

const STALE_BIAS =
  "systematically low: closing a stale correction requires the chose_instead field " +
  "(CLI flag --chose-instead) that corrections/schema.ts says a stale may not have " +
  "(E2 spec §3.2.1, A' ERRATUM 3)";

function bucketOf(at: string): string {
  return at.slice(0, 7);
}

function rate(numerator: number, denominator: number): number | null {
  // null, not 0. "no decisions at all" and "no decision was ever corrected" are
  // different claims and a reader has to be able to tell them apart.
  return denominator === 0 ? null : numerator / denominator;
}

export function computeMetrics(
  obs: Observations,
  opts: ComputeOptions = { bucket: "month" },
): MetricsReport {
  void opts.bucket; // "month" is the only granularity today; see ComputeOptions.

  /**
   * 🔴 Keyed by projectKey AND id, not by id alone. A decision id is
   * `<run-id>/<n>` and the run id is a hash of the contract bytes and the base
   * commit, with no repository identity in it — corrections/schema.ts says so
   * in the very comment explaining why a correction has to carry projectKey.
   * So the same decision id really does occur in two repositories (clones,
   * forks), and a global lookup would bucket a correction by ANOTHER
   * repository's decision. Measured: with a global map, the mutation that
   * removes the unresolved guard could not go red, because the guard was
   * redundant with a lookup that was itself wrong.
   */
  const decisionByKey = new Map(obs.decisions.map((d) => [`${d.projectKey}\u0000${d.id}`, d]));
  const kindOfDecisionFor = (projectKey: string, decisionId: string) =>
    decisionByKey.get(`${projectKey}\u0000${decisionId}`)?.kind;
  const closedIds = new Set(obs.overturned.map((o) => o.correctionId));
  const asOfMs = Date.parse(obs.asOf);

  // ---- correction rate -----------------------------------------------------
  // A' §4.2 as corrected by A' ERRATUM 3: a `stale` is the world changing, not
  // the agent being wrong, so it is out of this numerator — and the total that
  // includes it is reported separately rather than left to subtraction.
  const scoring = obs.corrections.filter((c) => c.row.kind !== "stale");
  const denominatorDecisions = obs.decisions.length;

  const kindSlices: CorrectionRateSlice[] = KIND_ORDER.map((kind) => {
    const denom = obs.decisions.filter((d) => d.kind === kind).length;
    // A correction whose decision was never scanned belongs in NO bucket:
    // bucket membership comes from the original decision's kind, and guessing
    // one would be fabrication (spec §3.4.1). That is expressed by the lookup
    // simply missing — there is no fallback bucket, deliberately.
    const numer = scoring.filter(
      (c) => kindOfDecisionFor(c.row.projectKey, c.row.decisionId) === kind,
    ).length;
    return {
      kind,
      tier: KIND_TIER[kind],
      numerator_corrections_excluding_stale: numer,
      denominator_decisions: denom,
      rate_excluding_stale: rate(numer, denom),
    };
  });

  const correctionBucketKeys = [...new Set(obs.decisions.map((d) => bucketOf(d.at)))].sort();
  const correctionBuckets: CorrectionRateBucket[] = correctionBucketKeys.map((bucket) => {
    // Cohort: bucketed by the DECISION's date, not the correction's. Bucketing
    // a ratio by two different clocks lets it exceed 100% for reasons that have
    // nothing to do with quality (spec §3.3).
    const inBucket = obs.decisions.filter((d) => bucketOf(d.at) === bucket);
    const ids = new Set(inBucket.map((d) => d.id));
    const numer = scoring.filter((c) => ids.has(c.row.decisionId)).length;
    return {
      bucket,
      numerator_corrections_excluding_stale: numer,
      denominator_decisions: inBucket.length,
      rate_excluding_stale: rate(numer, inBucket.length),
      counted_through: obs.asOf,
    };
  });

  const correctionCaveats = [NO_REVIEW_COVERAGE];
  if (obs.unresolvedDecisions.length > 0) correctionCaveats.push(UNRESOLVED_CAVEAT);

  const correction_rate: CorrectionRate = {
    numerator_corrections_excluding_stale: scoring.length,
    denominator_decisions: denominatorDecisions,
    rate_excluding_stale: rate(scoring.length, denominatorDecisions),
    corrections_total_including_stale: obs.corrections.length,
    by_decision_kind: kindSlices,
    buckets: correctionBuckets,
    caveats: correctionCaveats,
  };

  // ---- repair rate ---------------------------------------------------------
  // `stale` STAYS in this denominator: it measures whether a correction someone
  // raised was ever acted on, and a stale nobody redid IS the backlog.
  const closed = obs.corrections.filter((c) => closedIds.has(c.row.id));
  const staleAll = obs.corrections.filter((c) => c.row.kind === "stale");
  const staleClosed = staleAll.filter((c) => closedIds.has(c.row.id));

  const repairBucketKeys = [...new Set(obs.corrections.map((c) => bucketOf(c.row.at)))].sort();
  const repairBuckets: RepairRateBucket[] = repairBucketKeys.map((bucket) => {
    const inBucket = obs.corrections.filter((c) => bucketOf(c.row.at) === bucket);
    const numer = inBucket.filter((c) => closedIds.has(c.row.id)).length;
    return {
      bucket,
      numerator_overturned: numer,
      denominator_corrections_including_stale: inBucket.length,
      rate: rate(numer, inBucket.length),
      counted_through: obs.asOf,
    };
  });

  const repair_rate: RepairRate = {
    numerator_overturned: closed.length,
    denominator_corrections_including_stale: obs.corrections.length,
    rate: rate(closed.length, obs.corrections.length),
    stale_only: {
      numerator_overturned: staleClosed.length,
      denominator_corrections: staleAll.length,
      rate: rate(staleClosed.length, staleAll.length),
      known_bias: STALE_BIAS,
    },
    buckets: repairBuckets,
    caveats: [NO_REVIEW_COVERAGE],
  };

  // ---- backlog -------------------------------------------------------------
  // Wall clock, deliberately (spec §4.1): "nine days of backlog" has to include
  // the days the laptop was shut, which is what a monotonic clock cannot do.
  const open = obs.corrections.filter((c) => !closedIds.has(c.row.id));
  const oldest = open.reduce<{ id: string; at: string } | undefined>((acc, c) => {
    if (acc === undefined || Date.parse(c.row.at) < Date.parse(acc.at)) {
      return { id: c.row.id, at: c.row.at };
    }
    return acc;
  }, undefined);

  const backlogSlices: BacklogSlice[] = CORRECTION_KINDS.map((kind: CorrectionKind) => {
    const mine = open.filter((c) => c.row.kind === kind);
    const oldestOfKind = mine.reduce<string | undefined>(
      (acc, c) => (acc === undefined || Date.parse(c.row.at) < Date.parse(acc) ? c.row.at : acc),
      undefined,
    );
    return {
      kind,
      open: mine.length,
      oldest_age_ms: oldestOfKind === undefined ? null : asOfMs - Date.parse(oldestOfKind),
    };
  });

  const backlog: Backlog = {
    open_corrections: open.length,
    oldest_age_ms: oldest === undefined ? null : asOfMs - Date.parse(oldest.at),
    oldest_correction_id: oldest?.id ?? null,
    by_correction_kind: backlogSlices,
  };

  // ---- breakdown -----------------------------------------------------------
  // A COMPOSITION, not a rate: there is no denominator on this axis. The name
  // says "including stale" so nobody subtracts it from the correction rate's
  // numerator, which excludes stale (spec §3.1).
  const breakdown: CorrectionKindCount[] = CORRECTION_KINDS.map((kind: CorrectionKind) => ({
    kind,
    corrections: obs.corrections.filter((c) => c.row.kind === kind).length,
  }));

  // ---- repos ---------------------------------------------------------------
  const repos: RepoSummary[] = obs.repos
    .map((r) => ({
      projectKey: r.projectKey,
      decisions: obs.decisions.filter((d) => d.projectKey === r.projectKey).length,
    }))
    .sort((a, b) => (a.projectKey < b.projectKey ? -1 : a.projectKey > b.projectKey ? 1 : 0));

  return {
    as_of: obs.asOf,
    as_of_mode: obs.asOfMode,
    repos,
    correction_rate,
    repair_rate,
    backlog,
    breakdown_by_correction_kind_including_stale: breakdown,
    review_coverage: { available: false, reason: NO_REVIEW_COVERAGE },
    excluded_as_future: obs.excludedAsFuture,
    unresolved_decisions: [...obs.unresolvedDecisions].sort((a, b) =>
      a.correctionId < b.correctionId ? -1 : a.correctionId > b.correctionId ? 1 : 0,
    ),
    unkeyable_repos: [...obs.unkeyableRepos].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    malformed_lines: [...obs.malformed].sort((a, b) =>
      a.file !== b.file ? (a.file < b.file ? -1 : 1) : a.line - b.line,
    ),
  };
}
