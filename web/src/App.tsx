/**
 * task 8. `App` owns the ONLY side effects in this package: it fetches (via
 * `web/src/api.ts`) and then feeds the result to pure components that a
 * criterion can render with `renderToStaticMarkup` (plan ruling 2) --
 * `PanelHome` for the default view (task 8 ruling K5) and `DecisionDetail`
 * for whichever row was opened. `useEffect` never runs during static
 * server rendering, so this component's own render is never exercised
 * against a live server in a test; `PanelHome` and `DecisionDetail` carry
 * that weight instead.
 */
import { useEffect, useState } from "react";
import type { JSX } from "react";
import { fetchDecision, fetchMetrics, fetchTodo, recordCorrection, recordReview } from "./api.js";
import { DecisionDetail } from "./DecisionDetail.js";
import type { Decision } from "./DecisionDetail.js";
import { PanelHome } from "./PanelHome.js";
import type { DecisionListRow, MetricsReport, PanelCoverage } from "./types.js";

interface HomeState {
  todo: DecisionListRow[];
  report: MetricsReport;
  coverage: PanelCoverage;
}

export function App(): JSX.Element {
  const [home, setHome] = useState<HomeState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DecisionListRow | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [todoBody, metrics] = await Promise.all([fetchTodo(), fetchMetrics()]);
        setHome({ todo: todoBody.rows, report: metrics.report, coverage: metrics.panel_review_coverage });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  useEffect(() => {
    if (selected === null) {
      setDecision(null);
      return;
    }
    void (async () => {
      try {
        const body = await fetchDecision(selected.projectKey, selected.id);
        setDecision(body.decision as Decision);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [selected]);

  if (error !== null) return <main>orca panel: {error}</main>;
  if (home === null) return <main>orca panel loading…</main>;

  return (
    <main>
      <PanelHome todo={home.todo} report={home.report} coverage={home.coverage} onOpen={setSelected} />
      {selected !== null && decision !== null && (
        <DecisionDetail
          decision={decision}
          onAgree={() => {
            void recordReview(selected.projectKey, selected.id);
          }}
          onCorrect={() => {
            void recordCorrection({
              projectKey: selected.projectKey,
              decisionId: selected.id,
              kind: "wrong",
              because: "",
            });
          }}
        />
      )}
    </main>
  );
}
