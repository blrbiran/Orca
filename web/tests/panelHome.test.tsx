import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PanelHome } from "../src/PanelHome.js";
import type { DecisionListRow, MetricsReport, PanelCoverage } from "../src/types.js";

const todo: DecisionListRow[] = [
  { projectKey: "proj", id: "run/1", at: "2026-09-01T00:00:00.000Z", kind: "interface", scope: "repo", verdict: "ok" },
];

// Self-consistent on purpose: this criterion is about ORDER, not about
// numbers (metricsView.test.tsx already pins the deliberately-inconsistent
// fixture and the annotations).
const report: MetricsReport = {
  as_of: "2026-09-10T00:00:00.000Z",
  as_of_mode: "wall_clock",
  repos: [{ projectKey: "k", decisions: 1 }],
  correction_rate: {
    numerator_corrections_excluding_stale: 0,
    denominator_decisions: 1,
    rate_excluding_stale: 0,
    corrections_total_including_stale: 0,
    by_decision_kind: [],
    buckets: [],
    caveats: [],
  },
  repair_rate: {
    numerator_overturned: 0,
    denominator_corrections_including_stale: 0,
    rate: null,
    stale_only: { numerator_overturned: 0, denominator_corrections: 0, rate: null, known_bias: "n/a" },
    buckets: [],
    caveats: [],
  },
  backlog: { open_corrections: 0, oldest_age_ms: null, oldest_correction_id: null, by_correction_kind: [] },
  breakdown_by_correction_kind_including_stale: [],
  review_coverage: { available: false, reason: "no producer has run yet" },
  excluded_as_future: 0,
  unresolved_decisions: [],
  unkeyable_repos: [],
  malformed_lines: [],
};

const coverage: PanelCoverage = { reviewed_high_tier: 0, high_tier_total: 0, rate: null, caveat: "c" };

/** task 8 ruling K5's own criterion, and mutation H-1's landing place. */
describe("PanelHome (task 8 ruling K5)", () => {
  it("shows the todo rows' ids, with the todo heading before the metrics heading", () => {
    const html = renderToStaticMarkup(<PanelHome todo={todo} report={report} coverage={coverage} />);
    expect(html).toContain("run/1");

    const todoAt = html.indexOf("Unreviewed high-tier decisions");
    const metricsAt = html.indexOf("Correction rate");
    expect(todoAt).toBeGreaterThanOrEqual(0);
    expect(metricsAt).toBeGreaterThan(todoAt);
  });
});
