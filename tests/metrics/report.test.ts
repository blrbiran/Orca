import { describe, expect, it } from "vitest";
import { computeMetrics } from "../../src/metrics/compute.js";
import { METRICS_FIELDS } from "../../src/metrics/types.js";
import { renderJson, renderTable } from "../../src/metrics/report.js";
import { OBS } from "./fixture.js";

const M = () => computeMetrics(OBS, { bucket: "month" });

describe("report rendering (E2 spec §6)", () => {
  /**
   * ⚠️ 在一台机器上「照绿」是这条判据的默认坏法 ⇒ 判据自己打乱【每一个】输入集合
   * 再跑,断言逐字节相同。OBS 的三个集合各有 2 条,反转才不是恒等操作。
   */
  it("is order-independent: reversing every input collection changes no byte of the JSON", () => {
    const a = renderJson(M());
    const shuffled = {
      ...OBS,
      repos: [...OBS.repos].reverse(),
      decisions: [...OBS.decisions].reverse(),
      corrections: [...OBS.corrections].reverse(),
      unresolvedDecisions: [...OBS.unresolvedDecisions].reverse(),
      unkeyableRepos: [...OBS.unkeyableRepos].reverse(),
      malformed: [...OBS.malformed].reverse(),
    };
    expect(renderJson(computeMetrics(shuffled, { bucket: "month" }))).toBe(a);
  });

  it("serializes top-level keys in METRICS_FIELDS order, not the object's own", () => {
    expect(Object.keys(JSON.parse(renderJson(M())))).toEqual([...METRICS_FIELDS]);
  });

  it("carries no scan-duration field — that quantity varies every run and would break the golden", () => {
    const json = renderJson(M());
    expect(json).not.toContain("scan_ms");
    expect(json).not.toContain("duration_ms");
    expect(json).not.toContain("elapsed_ms");
  });

  it("keeps oldest_age_ms — it varies with as_of, not with the run", () => {
    expect(JSON.parse(renderJson(M())).backlog).toHaveProperty("oldest_age_ms");
  });

  // 🔴 人的原话不许进报告:CorrectionObservation 携带整行 Correction,其中 because
  //    是 A' §4.3 说的「全表对记忆层最值钱的字段」,而报告是会被贴进聊天的东西。
  it("never renders a correction's own words — because and by stay out of the report", () => {
    const json = renderJson(M());
    expect(json).not.toContain("理由");
    expect(json).not.toContain("amy");
    expect(json).not.toContain('"because"');
    expect(json).not.toContain('"by"');
  });

  it("the human table names the review-coverage caveat where a person will read it", () => {
    expect(renderTable(M())).toContain("review coverage");
  });

  it("ends the JSON with exactly one newline, so a golden diff is stable", () => {
    const json = renderJson(M());
    expect(json.endsWith("\n")).toBe(true);
    expect(json.endsWith("\n\n")).toBe(false);
  });
});
