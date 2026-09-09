import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { computeMetrics } from "../../src/metrics/compute.js";
import { GHOST, OBS, c, d } from "./fixture.js";

const M = () => computeMetrics(OBS, { bucket: "month" });

describe("computeMetrics (E2 spec §3, §4.3)", () => {
  it("keeps stale OUT of the correction rate's numerator, and reports the total separately", () => {
    const r = M();
    expect(r.correction_rate.numerator_corrections_excluding_stale).toBe(3); // wrong + not_my_taste + GHOST
    expect(r.correction_rate.corrections_total_including_stale).toBe(4);
  });

  it("keeps stale IN the repair rate's denominator — an unrepaired stale is the backlog", () => {
    const r = computeMetrics(
      { ...OBS, overturned: [{ correctionId: OBS.corrections[0].row.id, at: "2026-05-01T00:00:00.000Z" }] },
      { bucket: "month" },
    );
    expect(r.repair_rate.denominator_corrections_including_stale).toBe(4);
    expect(r.repair_rate.numerator_overturned).toBe(1);
  });

  // 「downgraded 进分母」是「什么都不做」,删不掉 ⇒ 正向观测。
  it("counts a downgraded decision in the denominator", () => {
    expect(M().correction_rate.denominator_decisions).toBe(4);
  });

  // 钉【年龄的字面毫秒数】,不只钉「跑出来了」。
  it("ages the backlog against as_of, in literal milliseconds", () => {
    const r = M();
    expect(r.backlog.open_corrections).toBe(4);
    expect(r.backlog.oldest_correction_id).toBe(OBS.corrections[0].row.id);
    expect(r.backlog.oldest_age_ms).toBe(
      Date.parse("2026-09-09T00:00:00.000Z") - Date.parse("2026-03-01T00:00:00.000Z"),
    );
  });

  it("buckets the correction rate by decision.at, not by correction.at", () => {
    const r = M();
    expect(r.correction_rate.buckets.map((b) => b.bucket)).toEqual(["2026-01", "2026-02"]);
    expect(r.correction_rate.buckets[0].denominator_decisions).toBe(3);
    expect(r.correction_rate.buckets[0].counted_through).toBe("2026-09-09T00:00:00.000Z");
  });

  // 🔴 分子是 3(含 GHOST),而进桶的只有 2 —— 两个数【分开】才让「塞进默认桶」的变异有落点。
  it("puts a correction whose decision was never scanned into NO decision-kind bucket", () => {
    const r = M();
    const inBuckets = r.correction_rate.by_decision_kind.reduce(
      (n, s) => n + s.numerator_corrections_excluding_stale,
      0,
    );
    expect(r.correction_rate.numerator_corrections_excluding_stale).toBe(3);
    expect(inBuckets).toBe(2);
    expect(r.unresolved_decisions.map((u) => u.correctionId)).toEqual([GHOST.row.id]);
  });

  it("reports review coverage as unavailable and taints BOTH rates with the caveat", () => {
    const r = M();
    expect(r.review_coverage.available).toBe(false);
    expect(r.correction_rate.caveats.join(" ")).toContain("review coverage");
    expect(r.repair_rate.caveats.join(" ")).toContain("review coverage");
  });

  it("adds a second caveat when unresolved_decisions is non-empty", () => {
    expect(M().correction_rate.caveats.join(" ")).toContain("unresolved");
  });

  it("splits stale's repair rate out and names the known bias", () => {
    const r = M();
    expect(r.repair_rate.stale_only.denominator_corrections).toBe(1);
    expect(r.repair_rate.stale_only.known_bias).toContain("chose_instead");
  });

  it("gives null, not 0, when a denominator is 0 — they are different claims", () => {
    const empty = computeMetrics(
      { ...OBS, decisions: [], corrections: [], unresolvedDecisions: [] },
      { bucket: "month" },
    );
    expect(empty.correction_rate.rate_excluding_stale).toBeNull();
    expect(empty.repair_rate.rate).toBeNull();
  });

  it("lets the rate exceed 1 rather than clamping — A' §4.4 counts corrections, and --again exists", () => {
    const twice = computeMetrics(
      {
        ...OBS,
        decisions: [d("orca-dev-1/1", "2026-01-05T00:00:00.000Z", "interface", "repo", "ok")],
        corrections: [
          c("orca-dev-1/1", "wrong", "2026-03-01T00:00:00.000Z"),
          c("orca-dev-1/1", "wrong", "2026-03-02T00:00:00.000Z"),
        ],
        unresolvedDecisions: [],
      },
      { bucket: "month" },
    );
    expect(twice.correction_rate.rate_excluding_stale).toBe(2);
  });

  it("keeps a zero-decision repository in repos", () => {
    expect(M().repos.map((r) => [r.projectKey, r.decisions])).toEqual([
      ["github.com/biran/a", 3],
      ["github.com/biran/m-fork", 1],
      ["github.com/biran/z-empty", 0],
    ]);
  });
});

describe("compute.ts is pure (E2 spec §5, §4.3)", () => {
  it("imports nothing from node: and reads no clock", async () => {
    const src = await readFile(new URL("../../src/metrics/compute.ts", import.meta.url), "utf8");
    // 🔴 Strip comments first. A scanner that fires on the prose explaining what
    // it forbids is a scanner people learn to ignore — the same defect this
    // plan's own shell scan hit and fixed the same way.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/from\s+"node:/);
    expect(code).not.toMatch(/\bnew Date\s*\(/);
    expect(code).not.toMatch(/\bDate\.now\s*\(/);
    expect(code).not.toMatch(/\bperformance\.now\s*\(/);
  });

  it("is deterministic: the same observations twice give byte-identical JSON", () => {
    expect(JSON.stringify(M())).toBe(JSON.stringify(M()));
  });
});
