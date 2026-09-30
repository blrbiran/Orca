// @vitest-environment jsdom
/**
 * Panel i18n spec §3.4, §6.10: a metrics sentence whose code this panel knows is shown in the reader's language; one whose
 * code it does not know (a newer server), or that has no code, is shown as the server sent it -- never as a key.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { en } from "../src/locales/en.js";
import { zh } from "../src/locales/zh.js";
import { MetricsView } from "../src/MetricsView.js";
import type { MetricsNoteCode, MetricsReport, PanelCoverage } from "../src/types.js";

const UNKNOWN = "a-code-this-panel-does-not-know" as unknown as MetricsNoteCode;
const KNOWN_SENTENCE = "the server's sentence beside the known code";
const UNKNOWN_SENTENCE = "the server's sentence beside the unknown code";
const report: MetricsReport = {
  as_of: "2026-10-01T00:00:00.000Z", as_of_mode: "wall_clock", repos: [],
  correction_rate: {
    numerator_corrections_excluding_stale: 0, denominator_decisions: 0, rate_excluding_stale: null, corrections_total_including_stale: 0,
    by_decision_kind: [], buckets: [], caveats: [KNOWN_SENTENCE, UNKNOWN_SENTENCE], caveatCodes: ["no-review-coverage", UNKNOWN],
  },
  repair_rate: {
    numerator_overturned: 0, denominator_corrections_including_stale: 0, rate: null,
    stale_only: { numerator_overturned: 0, denominator_corrections: 0, rate: null, known_bias: "the server's bias sentence", knownBiasCode: "stale-bias" },
    // One caveat with a known code and one past the end of caveatCodes (no code), so the repair index is exercised.
    buckets: [], caveats: ["the server's repair sentence beside the known code", "the server's repair sentence, no code"], caveatCodes: ["no-review-coverage"],
  },
  backlog: { open_corrections: 0, oldest_age_ms: null, oldest_correction_id: null, by_correction_kind: [] },
  breakdown_by_correction_kind_including_stale: [],
  review_coverage: { available: false, reason: "the server's reason sentence", reasonCode: "no-review-coverage" },
  excluded_as_future: 0, unresolved_decisions: [], unkeyable_repos: [], malformed_lines: [],
};
const coverage: PanelCoverage = { reviewed_high_tier: 1, high_tier_total: 4, rate: 0.25, caveat: "the server's coverage sentence", caveatCode: "reviewed-is-deliberate" };

afterEach(cleanup);

describe("metrics notes in the reader's language (spec §6.10)", () => {
  it("shows a known code's note in Chinese, and the server's sentence for an unknown code or none", async () => {
    await i18n.changeLanguage("zh");
    const view = render(<MetricsView report={report} coverage={coverage} />);
    const text = view.container.textContent ?? "";
    expect(text).toContain(zh.metrics.note["no-review-coverage"]);
    expect(text).toContain(zh.metrics.note["stale-bias"]);
    expect(text).toContain(zh.metrics.note["reviewed-is-deliberate"]);
    expect(text).toContain(UNKNOWN_SENTENCE);
    expect(text).toContain("the server's repair sentence, no code");
    expect(text).not.toContain(KNOWN_SENTENCE);
    expect(text).not.toContain("metrics.note");
    // Every heading, count and unknown rate is in the reader's language, read where it is shown: "纠正率" alone would
    // also match inside the no-review-coverage note, so a heading left in English could not turn this red.
    expect([...view.container.querySelectorAll("h2")].map((h) => h.textContent)).toEqual([
      zh.metrics.correctionRate, zh.metrics.repairRate, zh.metrics.reviewCoverage,
      zh.metrics.unresolvedTitle, zh.metrics.malformedTitle, zh.metrics.futureTitle,
    ]);
    expect(view.getByTestId("correction-rate").textContent).toBe(zh.metrics.unknownRate);
    expect(view.getByTestId("unresolved-count").textContent).toBe("未解析的决策：0");
    expect(view.getByTestId("malformed-count").textContent).toBe("格式错误的行：0");
    expect(view.getByTestId("excluded-as-future").textContent).toBe("因日期在未来而排除：0");
    // Each note site read where it is shown: the zh no-review-coverage note is also the correction caveat's, so a
    // toContain on the whole text could not see the review-coverage reason or a repair caveat left as sent.
    expect(view.getByTestId("review-coverage-reason").textContent).toBe(zh.metrics.note["no-review-coverage"]);
    expect([...view.getByTestId("repair-rate-caveats").querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      zh.metrics.note["no-review-coverage"], "the server's repair sentence, no code",
    ]);
  });

  it("shows a known code's English note in English, and the server's sentence for an unknown code", () => {
    const text = render(<MetricsView report={report} coverage={coverage} />).container.textContent ?? "";
    expect(text).toContain(en.metrics.note["no-review-coverage"]);
    expect(text).toContain(UNKNOWN_SENTENCE);
    expect(text).toContain("Correction rate");
  });
});
