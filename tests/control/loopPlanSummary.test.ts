import { describe, expect, it } from "vitest";
import { LOOP_PLAN_IDS, describeLoopPlan, type LoopInputs, type LoopPlanId } from "../../src/control/loopPlans.js";

/**
 * Loop plans spec §4.1 (D9, C7; criterion 7): the card's plain-language lines are a pure function of the recipe, built
 * server-side. They never carry command text (shown collapsed by the card) or a rejectOn token, and never claim more
 * hardness than the code enforces (spec §2.1): only an agent-verified discipline says the model checks it.
 */
const CHECKS = ["npm test -- --run auth/login.test.ts", "npm run lint"];
const inputs = (over: Partial<LoopInputs> = {}): LoopInputs => ({
  goal: "fix login", successCondition: "the login test passes", targetPaths: ["src/auth/**"], checks: CHECKS,
  nonGoals: [], relevantDocs: [], protectedPaths: [], maxFilesTouched: null, ...over,
});
const lines = (planId: LoopPlanId, over: Partial<LoopInputs> = {}): string[] => {
  const described = describeLoopPlan({ planId, planVersion: 1, inputs: inputs(over) });
  if (described === null) throw new Error("no such plan");
  return described.summary;
};
const AGENT_PLANS: LoopPlanId[] = ["bugfix", "design", "investigate"];

describe("the loop plan summary (criterion 7)", () => {
  it("pins bugfix's lines", () => {
    expect(lines("bugfix", { protectedPaths: ["tests/fixtures/**"] })).toEqual([
      "Goal: fix login",
      "Done when: the login test passes",
      "Only changes: src/auth/**",
      "Must not change: tests/fixtures/** (reported by the agent, not checked in git)",
      "At most 25 files changed (reported by the agent)",
      "Acceptance: 2 check commands, all must pass",
      "Write a failing test that reproduces the bug, then fix it (checked by a model, not proven mechanically)",
    ]);
  });

  it("puts another goal into another first line", () => {
    expect(lines("standard", { goal: "fix logout" })[0]).toBe("Goal: fix logout");
  });

  it.each([...LOOP_PLAN_IDS])("%s: never puts a check command's text or a rejectOn token into a line", (plan) => {
    for (const line of lines(plan)) {
      for (const check of CHECKS) expect(line).not.toContain(check);
      expect(line).not.toContain("REJECT:");
    }
  });

  it("shows the red-first discipline for bugfix only, and 'checked by a model' for exactly the agent-verified plans (Drafter finding F6)", () => {
    for (const plan of LOOP_PLAN_IDS) {
      expect(lines(plan).some((line) => line.startsWith("Write a failing test that reproduces the bug"))).toBe(plan === "bugfix");
      expect(lines(plan).filter((line) => line.includes("checked by a model")).length).toBe(AGENT_PLANS.includes(plan) ? 1 : 0);
    }
  });

  it("marks protected paths and the file cap as agent-reported, shows no protected line without protected paths, and investigate's cap as 1", () => {
    expect(lines("standard").some((line) => line.startsWith("Must not change: "))).toBe(false);
    expect(lines("investigate", { targetPaths: ["docs/report.md"], maxFilesTouched: 7 })).toContain("At most 1 file changed (reported by the agent)");
    expect(lines("refactor", { maxFilesTouched: 7 })).toContain("At most 7 files changed (reported by the agent)");
  });

  it("says a v2 task with no file cap has no file limit, and names the cap its inputs set (human ruling H2)", () => {
    const v2 = (planId: LoopPlanId, over: Partial<LoopInputs> = {}) => describeLoopPlan({ planId, planVersion: 2, inputs: inputs(over) })!.summary;
    expect(v2("standard")).toContain("No file limit");
    expect(v2("standard").some((line) => line.startsWith("At most"))).toBe(false);
    expect(v2("standard", { maxFilesTouched: 7 })).toContain("At most 7 files changed (reported by the agent)");
    expect(v2("investigate", { targetPaths: ["docs/report.md"] })).toContain("At most 1 file changed (reported by the agent)");
  });

  it("says 1 check command in the singular (ruling P1)", () => {
    expect(lines("standard", { checks: ["npm run lint"] })).toContain("Acceptance: 1 check command, all must pass");
  });

  it("names each plan in plain words, and knows no plan version it does not have", () => {
    // Rewritten under human ruling H19 (2026-10-01) for loop plans v2.
    expect(LOOP_PLAN_IDS.map((planId) => describeLoopPlan({ planId, planVersion: 1, inputs: inputs() })!.planName))
      .toEqual(["Standard", "Bug fix (red first)", "Safe refactor", "Design / docs first", "Investigate only"]);
    expect(describeLoopPlan({ planId: "standard", planVersion: 3, inputs: inputs() })).toBeNull();
  });
});
