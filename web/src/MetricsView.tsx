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
import { useTranslation } from "react-i18next";
import i18n from "./i18n.js";
import { en } from "./locales/en.js";
import type { MetricsReport, PanelCoverage } from "./types.js";
import { metricCaveats, metricHealth, metricLabel, metricNotes, metricTile, metricValue } from "./ui/classes.js";

/** The one literal the null-rate branch prints (task 8 ruling K4), in English; the render uses the reader's language. */
export const UNKNOWN_RATE = en.metrics.unknownRate;

/** Formats what it is given. It does not divide anything. */
function formatRate(rate: number | null): string {
  return rate === null ? i18n.t("metrics.unknownRate") : `${(rate * 100).toFixed(0)}%`;
}

/** Panel i18n spec §3.4: a metrics sentence in the reader's language when its code is known here, else as the server sent it. */
function noteText(sentence: string, code: string | undefined): string {
  const key = `metrics.note.${code ?? ""}`;
  return code !== undefined && i18n.exists(key) ? (i18n.t(key as never) as string) : sentence;
}

export function MetricsView({ report, coverage }: { report: MetricsReport; coverage: PanelCoverage }): JSX.Element {
  const { t } = useTranslation();
  return (
    <section className="metrics">
      <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
        <div className={metricTile}>
          <h2 className={metricLabel}>{t("metrics.correctionRate")}</h2>
          <p className={metricValue} data-testid="correction-rate">{formatRate(report.correction_rate.rate_excluding_stale)}</p>
          <div className={metricNotes}>
            <ul className={metricCaveats} data-testid="correction-rate-caveats">
              {report.correction_rate.caveats.map((caveat, index) => (
                <li key={caveat}>{noteText(caveat, report.correction_rate.caveatCodes?.[index])}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className={metricTile}>
          <h2 className={metricLabel}>{t("metrics.repairRate")}</h2>
          <p className={metricValue} data-testid="repair-rate">{formatRate(report.repair_rate.rate)}</p>
          <div className={metricNotes}>
            <ul className={metricCaveats} data-testid="repair-rate-caveats">
              {report.repair_rate.caveats.map((caveat, index) => (
                <li key={caveat}>{noteText(caveat, report.repair_rate.caveatCodes?.[index])}</li>
              ))}
            </ul>
            <p className="text-xs text-muted" data-testid="stale-bias">
              {noteText(report.repair_rate.stale_only.known_bias, report.repair_rate.stale_only.knownBiasCode)}
            </p>
          </div>
        </div>
        <div className={metricTile}>
          <h2 className={metricLabel}>{t("metrics.reviewCoverage")}</h2>
          <p className={metricValue} data-testid="panel-coverage-rate">{formatRate(coverage.rate)}</p>
          <div className={metricNotes}>
            <p className="caveat" data-testid="review-coverage-reason">
              {noteText(report.review_coverage.reason, report.review_coverage.reasonCode)}
            </p>
            <p className="caveat" data-testid="panel-coverage-caveat">
              {noteText(coverage.caveat, coverage.caveatCode)}
            </p>
          </div>
        </div>
      </div>
      <div className={metricHealth}>
        <div><h2>{t("metrics.unresolvedTitle")}</h2><p data-testid="unresolved-count">{report.unresolved_decisions.length}</p></div>
        <div><h2>{t("metrics.malformedTitle")}</h2><p data-testid="malformed-count">{report.malformed_lines.length}</p></div>
        <div><h2>{t("metrics.futureTitle")}</h2><p data-testid="excluded-as-future">{report.excluded_as_future}</p></div>
        <div><h2>{t("metrics.unrecordedDecisionCorrections")}</h2><p data-testid="unrecorded-decision-corrections">{report.corrections_on_unrecorded_decisions ?? 0}</p></div>
        <div><h2>{t("metrics.coarseTargetCorrections")}</h2><p data-testid="coarse-target-corrections">{report.corrections_on_coarse_targets ?? 0}</p></div>
      </div>
    </section>
  );
}
