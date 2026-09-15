/**
 * spec section 4.1. This component computes NOTHING: every number here is a
 * field the server sent (either in `report`, from `GET /api/metrics`, or in
 * `coverage`, that same response's `panel_review_coverage`), rendered as it
 * arrived. `formatRate` below only formats; it never divides.
 *
 * And that is only half the obligation. E2 hands the panel a set of
 * annotations that MUST be displayed, never silently dropped alongside the
 * numbers they qualify (A' section 4.4: the correction rate must never be
 * read alone): the review-coverage reason (E2 3.5), both rates' own
 * `caveats` arrays, unresolved decisions (3.4.1), malformed lines rendered
 * ALONGSIDE the full report (5.2), the stale repair-rate bias (3.2.1) and the
 * count excluded as future (4.2). A view that renders the rate and drops
 * these passes "the frontend does not compute" completely -- which is why
 * task 8's criteria pin every one of them by name.
 */
import type { JSX } from "react";
import type { MetricsReport, PanelCoverage } from "./types.js";

/** The one literal the null-rate branch prints (task 8 ruling K4). */
export const UNKNOWN_RATE = "unknown";

/** Formats what it is given. It does not divide anything. */
function formatRate(rate: number | null): string {
  return rate === null ? UNKNOWN_RATE : `${(rate * 100).toFixed(0)}%`;
}

export function MetricsView({ report, coverage }: { report: MetricsReport; coverage: PanelCoverage }): JSX.Element {
  return (
    <section>
      <h2>Correction rate</h2>
      <p data-testid="correction-rate">{formatRate(report.correction_rate.rate_excluding_stale)}</p>
      <ul className="caveats" data-testid="correction-rate-caveats">
        {report.correction_rate.caveats.map((caveat) => (
          <li key={caveat}>{caveat}</li>
        ))}
      </ul>

      <h2>Repair rate</h2>
      <p data-testid="repair-rate">{formatRate(report.repair_rate.rate)}</p>
      <ul className="caveats" data-testid="repair-rate-caveats">
        {report.repair_rate.caveats.map((caveat) => (
          <li key={caveat}>{caveat}</li>
        ))}
      </ul>
      <p className="stale-bias" data-testid="stale-bias">
        {report.repair_rate.stale_only.known_bias}
      </p>

      <h2>Review coverage</h2>
      <p className="caveat" data-testid="review-coverage-reason">
        {report.review_coverage.reason}
      </p>
      <p data-testid="panel-coverage-rate">{formatRate(coverage.rate)}</p>
      <p className="caveat" data-testid="panel-coverage-caveat">
        {coverage.caveat}
      </p>

      <h2>Unresolved decisions</h2>
      <p data-testid="unresolved-count">Unresolved decisions: {report.unresolved_decisions.length}</p>

      <h2>Malformed lines</h2>
      <p data-testid="malformed-count">Malformed lines: {report.malformed_lines.length}</p>

      <h2>Excluded as future</h2>
      <p data-testid="excluded-as-future">Excluded as future: {report.excluded_as_future}</p>
    </section>
  );
}
