import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { en } from "../src/locales/en.js";
import { zh } from "../src/locales/zh.js";
import { MetricsView } from "../src/MetricsView.js";
import type { MetricsReport, PanelCoverage } from "../src/types.js";

/** Taste refinement P2-5 (+ spec §7: notes stay shown beside their number -- MetricsView.tsx:7-15, metricsView.test.tsx:101). */
const src = (p: string): string => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

// Fixture copied verbatim from tests/metricsView.test.tsx (not exported there).
const REPORT: MetricsReport = {
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
  excluded_as_future: 7, withdrawn_corrections: 0,
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

const COVERAGE: PanelCoverage = {
  reviewed_high_tier: 1,
  high_tier_total: 4,
  rate: 0.25,
  caveat: "read it with the backlog",
};


describe("Metrics layout (P2-5)", () => {
  it("lays the three rates out as tiles, each number first and its notes visible right under it", () => {
    const html = renderToStaticMarkup(<MetricsView report={REPORT} coverage={COVERAGE} />);
    expect(html.match(/class="metric-tile"/g)?.length).toBe(3);
    expect(html).not.toContain("<details");
    // The coverage tile is the third tile.
    const tile = html.slice(html.lastIndexOf('class="metric-tile"'));
    expect(tile).toContain("Review coverage");
    expect(tile.indexOf('data-testid="panel-coverage-rate"')).toBeGreaterThan(-1);
    expect(tile.indexOf('data-testid="panel-coverage-rate"')).toBeLessThan(tile.indexOf('data-testid="review-coverage-reason"'));
  });
  it("gathers the three data-health counts into one row", () => {
    const html = renderToStaticMarkup(<MetricsView report={REPORT} coverage={COVERAGE} />);
    const row = html.slice(html.indexOf('class="metric-health"'));
    expect(row.length).toBeGreaterThan(0);
    for (const id of ["unresolved-count", "malformed-count", "excluded-as-future"]) expect(row).toContain(`data-testid="${id}"`);
  });
  it("states each data-health count once: the heading names it, the line under it is the number", () => {
    const report: MetricsReport = { ...REPORT, unresolved_decisions: REPORT.unresolved_decisions.slice(0, 2), malformed_lines: REPORT.malformed_lines.slice(0, 1), excluded_as_future: 3 };
    const html = renderToStaticMarkup(<MetricsView report={report} coverage={COVERAGE} />);
    for (const [title, id, n] of [["Unresolved decisions", "unresolved-count", "2"], ["Malformed lines", "malformed-count", "1"], [en.metrics.futureTitle, "excluded-as-future", "3"]] as const)
      expect(html).toContain(`<h2>${title}</h2><p data-testid="${id}">${n}</p>`);
  });
  it("lets wide usage tables scroll inside their own box", () => {
    const usage = src("../src/UsagePanel.tsx");
    expect(usage.match(/<div className="table-scroll">/g)?.length).toBe(3);
    const css = src("../src/styles.css");
    const at = css.indexOf(".table-scroll {");
    expect(at).toBeGreaterThan(-1);
    expect(css.slice(at, css.indexOf("}", at))).toContain("overflow-x: auto");
  });
  it("does not force the two-column groups table to scroll", () => {
    expect(src("../src/UsagePanel.tsx")).toContain('<table data-testid="usage-groups" className="table-narrow">');
    const css = src("../src/styles.css");
    expect(css).toMatch(/\.table-scroll \.table-narrow \{ min-width: 0;/);
  });
  it("speaks to the reader, not in spec citations (zh only)", () => {
    // en mirrors the server's sentences byte for byte; tests/metrics/noteCodes.test.ts pins that neither carries a citation.
    const notes = Object.values(zh.metrics.note).join("\n");
    expect(notes).not.toMatch(/§|ERRATUM|spec|schema\.ts|unresolved_decisions|chose_instead|`reviewed`/);
  });
});
