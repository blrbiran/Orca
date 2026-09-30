import { describe, expect, it } from "vitest";
import { loopPlanViewSchema } from "../../src/control/webProtocol.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { webFixture } from "./fixtures/web.js";

/**
 * Panel i18n spec §3.1, §6.8: the loop plan view carries the fields the panel builds its words from -- the expanded
 * contract's file cap (not the input's: investigate is always 1, and a v2 plan has none unless the input sets one) and
 * whether the plan version has a discipline line -- and no English sentence: the strict schema refuses a view that still
 * carries summary or planName.
 */
const LOOP = { goal: "fix login", successCondition: "the login test passes", targetPaths: ["a"], checks: ["npm test"] };
const FIELDS = ["amended", "chosenBy", "chosenByLabel", "hasDiscipline", "inputs", "loopVersion", "maxFiles", "planId", "planVersion"];

describe("the loop plan view's fields (panel i18n spec §3.1, §6.8)", () => {
  it("carries exactly the fields of §3.1: the contract's file cap and whether the plan version has a discipline line", async () => {
    const h = await webFixture(undefined, [
      { taskId: "a", loop: { ...LOOP, plan: "standard" } },
      { taskId: "b", loop: { ...LOOP, plan: "bugfix", targetPaths: ["b"], maxFilesTouched: 7 } },
      { taskId: "c", loop: { ...LOOP, plan: "investigate", targetPaths: ["docs/report.md"] } },
    ]);
    try {
      const [a, b, c] = readControlGroup(h.store, "epoch", "g").workItems.map((item) => item.loopPlan!);
      expect(Object.keys(a!).sort()).toEqual(FIELDS);
      expect(a).toMatchObject({ planId: "standard", planVersion: 2, maxFiles: Number.MAX_SAFE_INTEGER, hasDiscipline: false });
      expect(b).toMatchObject({ planId: "bugfix", planVersion: 2, maxFiles: 7, hasDiscipline: true });
      expect(c).toMatchObject({ planId: "investigate", planVersion: 2, maxFiles: 1, hasDiscipline: true });
    } finally { await h.dispose(); }
  });

  it("refuses a view that still carries summary or planName", () => {
    const view = {
      planId: "standard", planVersion: 2, chosenBy: "explicit", chosenByLabel: null, amended: false, loopVersion: 0,
      inputs: { goal: "g", successCondition: "s", targetPaths: ["a"], checks: ["npm test"], nonGoals: [], relevantDocs: [], protectedPaths: [], maxFilesTouched: null },
      maxFiles: 1, hasDiscipline: false,
    };
    expect(loopPlanViewSchema.safeParse(view).success).toBe(true);
    expect(loopPlanViewSchema.safeParse({ ...view, summary: ["Goal: g"] }).success).toBe(false);
    expect(loopPlanViewSchema.safeParse({ ...view, planName: "Standard" }).success).toBe(false);
  });
});
