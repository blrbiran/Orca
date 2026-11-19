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
});
