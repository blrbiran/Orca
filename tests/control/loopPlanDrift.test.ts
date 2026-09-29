import { describe, expect, it, vi } from "vitest";

/**
 * Loop plans spec §3.3 (criterion 6: "a tampered recipe blocks the task in the projection"). planHash makes the archived
 * recipe itself tamper-evident (readArchivedPlan); what is left is the registry drifting under an archived recipe -- a
 * plan's text edited in place instead of versioned (spec §2.2). That is simulated here: every expandRecipe the
 * projection calls expands a changed goal, so the recipe no longer re-expands to the stored contract bytes.
 */
const state = vi.hoisted(() => ({ drift: false }));
vi.mock("../../src/control/loopPlans.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/control/loopPlans.js")>();
  return {
    ...real,
    expandRecipe: (...[taskId, repoPath, recipe]: Parameters<typeof real.expandRecipe>) =>
      real.expandRecipe(taskId, repoPath, state.drift ? { ...recipe, inputs: { ...recipe.inputs, goal: `${recipe.inputs.goal} (edited in place)` } } : recipe),
  };
});

import { readControlGroup } from "../../src/panel/controlViews.js";
import { webFixture } from "./fixtures/web.js";

const LOOP = { plan: "bugfix", goal: "fix login", successCondition: "the login test passes", targetPaths: ["a"], checks: ["npm test"] };

describe("a recipe that no longer re-expands to its task's contract (spec §3.3, criterion 6)", () => {
  it("blocks the loop task by name", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", loop: LOOP }]);
    try {
      state.drift = false;
      expect(readControlGroup(h.store, "epoch", "g").workItems[0]!.loopPlan).toMatchObject({ planId: "bugfix" });
      state.drift = true;
      expect(() => readControlGroup(h.store, "epoch", "g")).toThrow("recovery-blocked:loop-plan-recipe-mismatch:a");
    } finally { state.drift = false; await h.dispose(); }
  });

  it("leaves a hand-written task's view alone", async () => {
    const h = await webFixture(undefined, [{ taskId: "a" }]);
    try {
      state.drift = true;
      expect(readControlGroup(h.store, "epoch", "g").workItems[0]!.loopPlan).toBeNull();
    } finally { state.drift = false; await h.dispose(); }
  });
});
