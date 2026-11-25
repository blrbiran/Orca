import { describe, expect, it } from "vitest";
import { reviewAnswers } from "../../src/control/groupProblemAnswers.js";

/**
 * Tester #392 (human ruling: 「去掉那个必然失败的 requirement feedback 下一步」): `orca requirement feedback` refuses on a
 * confirmed group (`requirement-already-accepted`), so a review left to a person must offer steps that work there.
 */
describe("review answers after confirm (#392)", () => {
  it("a plan criterion is answered by a new requirement, accept or rerun -- never requirement feedback", () => {
    const answers = reviewAnswers("g", "not-fixable-by-work", [{ id: "AC1", by: "plan" }, { id: "AC2", by: "person" }]);
    // mutation: keep the old `orca requirement feedback` first step -> red
    expect(answers.some((command) => command.includes("requirement feedback"))).toBe(false);
    expect(answers).toEqual([
      "orca requirement open --idea '<the requirement, with the plan changed>'",
      "orca group review-accept g --note '<why accept as is>'",
      "orca group review-rerun g --note '<what to look at>'",
    ]);
  });

  it("no plan criterion, and the other reviews, keep their existing answers", () => {
    expect(reviewAnswers("g", "not-fixable-by-work", [{ id: "AC2", by: "person" }])).toEqual([
      "orca group review-accept g --note '<why accept as is>'", "orca group review-rerun g --note '<what to look at>'"]);
    expect(reviewAnswers("g", "failed", [])).toEqual([
      "orca group review-fix g --goal '<what to fix>'", "orca group review-rerun g --note '<what to look at>'",
      "orca group review-accept g --note '<why accept as is>'"]);
  });

  // Tester #502: a check conflict can sit beside a plan-level not-met; the plan step must not be hidden by it.
  it("a check conflict with a plan criterion still offers the new requirement beside fix and accept", () => {
    const answers = reviewAnswers("g", "check-conflict", [{ id: "AC12", by: "plan" }]);
    // mutation: put the plan step behind the not-fixable-by-work branch only -> no requirement open, red
    expect(answers).toContain("orca requirement open --idea '<the requirement, with the plan changed>'");
    expect(answers).toContain("orca group review-accept g --note '<why accept as is>'");
    expect(answers).toContain("orca group review-fix g --goal '<what to fix>'");
  });
});
