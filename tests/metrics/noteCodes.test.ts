import { describe, expect, it } from "vitest";
import { computeMetrics } from "../../src/metrics/compute.js";
import { computePanelCoverage } from "../../src/panel/coverage.js";
import { en } from "../../web/src/locales/en.js";
import { OBS } from "./fixture.js";

/**
 * Panel i18n spec §3.4, §6.10: every sentence the metrics and the coverage carry has a stable code beside it, index for
 * index, so the panel can show it in the reader's language; and the panel's English note for each code is the server's
 * sentence byte for byte, so English stays what it was (spec §2).
 */
const notes = en.metrics.note as Record<string, string>;

describe("metrics sentence codes (spec §3.4, §6.10)", () => {
  it("puts a code beside each sentence, index for index, and the panel's English note is the sentence", () => {
    const r = computeMetrics(OBS, { bucket: "month" }); // OBS has one correction whose decision was not scanned
    expect(r.correction_rate.caveatCodes).toEqual(["no-review-coverage", "unresolved-decisions"]);
    expect(r.repair_rate.caveatCodes).toEqual(["no-review-coverage"]);
    const pairs: Array<[string, string]> = [
      ...r.correction_rate.caveats.map((sentence, i): [string, string] => [r.correction_rate.caveatCodes[i]!, sentence]),
      ...r.repair_rate.caveats.map((sentence, i): [string, string] => [r.repair_rate.caveatCodes[i]!, sentence]),
      [r.repair_rate.stale_only.knownBiasCode, r.repair_rate.stale_only.known_bias],
      [r.review_coverage.reasonCode, r.review_coverage.reason],
    ];
    for (const [code, sentence] of pairs) expect(notes[code], code).toBe(sentence);
  });

  it("gives no unresolved code when nothing is unresolved", () => {
    expect(computeMetrics({ ...OBS, unresolvedDecisions: [] }, { bucket: "month" }).correction_rate.caveatCodes).toEqual(["no-review-coverage"]);
  });

  it("gives the coverage caveat its code, and the panel's English note is the caveat", () => {
    const coverage = computePanelCoverage([], []);
    expect(coverage.caveatCode).toBe("reviewed-is-deliberate");
    expect(notes["reviewed-is-deliberate"]).toBe(coverage.caveat);
  });
});
