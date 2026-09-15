/**
 * task 8 ruling K5: spec section 4.2's default-view mitigation. `App` feeds
 * this pure component the already-fetched todo rows and metrics, so a
 * criterion can render it with `renderToStaticMarkup` without touching
 * `fetch` at all. The to-do heading comes FIRST -- "reviewed" coverage can sit
 * near zero for a long time (PanelCoverage's own caveat), so the panel's
 * first screen is the work a person already owes, not a number.
 */
import type { JSX } from "react";
import { DecisionList } from "./DecisionList.js";
import { MetricsView } from "./MetricsView.js";
import type { DecisionListRow, MetricsReport, PanelCoverage } from "./types.js";

export function PanelHome({
  todo,
  report,
  coverage,
  onOpen,
}: {
  todo: readonly DecisionListRow[];
  report: MetricsReport;
  coverage: PanelCoverage;
  onOpen?: (row: DecisionListRow) => void;
}): JSX.Element {
  return (
    <div className="panel-home">
      <h1>Unreviewed high-tier decisions</h1>
      <DecisionList rows={todo} onOpen={onOpen} />
      <MetricsView report={report} coverage={coverage} />
    </div>
  );
}
