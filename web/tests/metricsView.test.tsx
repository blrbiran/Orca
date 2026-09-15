import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MetricsView, UNKNOWN_RATE } from "../src/MetricsView.js";
import type { MetricsReport, PanelCoverage } from "../src/types.js";

/**
 * task 8 ruling K3: this fixture lies ON PURPOSE. 3 of 10 is 30%; the field
 * says 99%. A frontend that computes anything of its own (`numerator /
 * denominator`) renders 30 and goes red -- that is mutation F-4's only
 * landing place, and it only works because the fixture is self-inconsistent.
 * Do NOT "fix" it into a self-consistent number: a self-consistent fixture
 * makes "compute it" and "display it verbatim" produce the same HTML, and the
 * mutation becomes structurally unable to go red (the same failure E2's
 * mutation C-1 hit).
 *
 * Every count below is DISTINCT (2 unresolved, 3 malformed, 7 excluded) so no
 * assertion can pass by matching a different field's number, and the stale
 * -bias assertion below matches the fixture's own `known_bias` sentence
 * rather than a bare `/stale/i`, which a neighbouring label like "excluding
 * stale" would already satisfy without the view ever rendering the bias note.
 *
 * Typed as the web `MetricsReport` (web/src/types.ts), never `as never`: tsc
 * holds the shape, so the only thing left deliberately wrong is the NUMBER.
 */
const report: MetricsReport = {
  as_of: "2026-09-10T00:00:00.000Z",
  as_of_mode: "wall_clock",
  repos: [{ projectKey: "k", decisions: 10 }],
  correction_rate: {
    numerator_corrections_excluding_stale: 3,
    denominator_decisions: 10,
    rate_excluding_stale: 0.99,
    corrections_total_including_stale: 5,
    by_decision_kind: [],
    buckets: [],
    caveats: ["the correction-rate caveat sentence, distinct from every other fixture string"],
  },
  repair_rate: {
    numerator_overturned: 1,
    denominator_corrections_including_stale: 4,
    rate: 0.5,
    stale_only: {
      numerator_overturned: 0,
      denominator_corrections: 2,
      rate: 0,
      known_bias: "the stale-only known-bias sentence, distinct from every other fixture string",
    },
    buckets: [],
    caveats: ["the repair-rate caveat sentence, distinct from every other fixture string"],
  },
  backlog: { open_corrections: 3, oldest_age_ms: 1_000, oldest_correction_id: "c_1", by_correction_kind: [] },
  breakdown_by_correction_kind_including_stale: [{ kind: "stale", corrections: 2 }],
  review_coverage: { available: false, reason: "no producer has run yet" },
  excluded_as_future: 7,
  unresolved_decisions: [
    { correctionId: "c_1", projectKey: "k", decisionId: "run/9" },
    { correctionId: "c_2", projectKey: "k", decisionId: "run/10" },
  ],
  unkeyable_repos: [{ path: "/tmp/x", reason: "no remote" }],
  malformed_lines: [
    { file: "a.jsonl", line: 3, bytes: 12, reason: "bad json", torn: false },
    { file: "b.jsonl", line: 4, bytes: 20, reason: "bad json", torn: false },
    { file: "c.jsonl", line: 5, bytes: 30, reason: "bad json", torn: false },
  ],
};

const coverage: PanelCoverage = {
  reviewed_high_tier: 1,
  high_tier_total: 4,
  rate: 0.25,
  caveat: "read it with the backlog",
};

describe("MetricsView (spec section 4.1)", () => {
  it("renders the rate the server sent, never one of its own", () => {
    const html = renderToStaticMarkup(<MetricsView report={report} coverage={coverage} />);
    expect(html).toContain("99");
    // 3/10 is what a frontend that computed it would show.
    expect(html).not.toContain("30%");
  });

  it("shows every one of E2's annotations, each with its own visible text", () => {
    const html = renderToStaticMarkup(<MetricsView report={report} coverage={coverage} />);
    expect(html).toContain("no producer has run yet"); // E2 3.5 coverage reason
    expect(html).toContain(report.correction_rate.caveats[0]); // correction rate's own caveats
    expect(html).toContain(report.repair_rate.caveats[0]); // repair rate's own caveats
    expect(html).toMatch(/unresolved[^<]*2/i); // E2 3.4.1
    expect(html).toMatch(/malformed[^<]*3/i); // E2 5.2
    expect(html).toContain(report.repair_rate.stale_only.known_bias); // E2 3.2.1 bias, by its own sentence
    expect(html).toMatch(/excluded[^<]*7/i); // E2 4.2
  });

  it("prints the whole report even when a line was malformed", () => {
    // E2 section 5.2: malformed lines are reported ALONGSIDE the full report,
    // never instead of it.
    const html = renderToStaticMarkup(<MetricsView report={report} coverage={coverage} />);
    expect(html).toContain("99");
    expect(html).toMatch(/malformed[^<]*3/i);
  });

  it("shows the coverage caveat next to the coverage number, not somewhere else", () => {
    const html = renderToStaticMarkup(<MetricsView report={report} coverage={coverage} />);
    expect(html).toContain("read it with the backlog");
  });

  it("renders a null coverage rate as unknown, not as zero", () => {
    const html = renderToStaticMarkup(
      <MetricsView report={report} coverage={{ ...coverage, rate: null, high_tier_total: 0 }} />,
    );
    // 0/0 shown as 0% reads as "nobody reviewed anything", which is a
    // different claim from "there is nothing to review".
    expect(html).not.toMatch(/\b0%/);
    expect(html).toContain(UNKNOWN_RATE);
  });
});
