import { describe, expect, it } from "vitest";
import { describeLoopPlan } from "../../src/control/loopPlans.js";
import { readArchivedPlan } from "../../src/control/queries.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { webFixture } from "./fixtures/web.js";

/**
 * Loop plans spec §4.1 (D9, C7): the task view names its loop plan in plain words, built server-side from the recipe;
 * a hand-written task has no plan but still shows its contract's goal and success condition.
 */
const LOOP = { goal: "fix login", successCondition: "the login test passes", targetPaths: ["a"], checks: ["npm test"] };

describe("a task's plan in the group view (spec §4.1)", () => {
  it("shows the plan, how it was chosen and its summary lines for a loop task", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", labels: ["bug", "custom:x"], loop: LOOP }]);
    try {
      const recipe = readArchivedPlan(h.store, "g").plan.tasks[0]!.loop!;
      const item = readControlGroup(h.store, "epoch", "g").workItems[0]!;
      expect(item.loopPlan).toEqual({
        planId: "bugfix", planVersion: 1, planName: "Bug fix (red first)", chosenBy: "labels", chosenByLabel: "bug",
        amended: false, loopVersion: 0, inputs: recipe.inputs, summary: describeLoopPlan(recipe)!.summary,
      });
      expect(item.objective).toEqual({ goal: "fix login", successCondition: "the login test passes" });
    } finally { await h.dispose(); }
  });

  it("names no label for a plan the plan file named", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", labels: ["bug"], loop: { ...LOOP, plan: "standard" } }]);
    try {
      expect(readControlGroup(h.store, "epoch", "g").workItems[0]!.loopPlan).toMatchObject({ planId: "standard", chosenBy: "explicit", chosenByLabel: null });
    } finally { await h.dispose(); }
  });

  it("shows a hand-written task as no plan, with its contract's goal and success condition", async () => {
    const h = await webFixture(undefined, [{ taskId: "a" }]);
    try {
      const item = readControlGroup(h.store, "epoch", "g").workItems[0]!;
      expect(item.loopPlan).toBeNull();
      expect(item.objective).toEqual({ goal: "ship", successCondition: "passes" });
    } finally { await h.dispose(); }
  });
});
