import { describe, expect, it } from "vitest";
import { planLayers, planOrderTasks } from "../../src/control/planOrder.js";

/**
 * #296: `ControlPlanV1.tasks` is sorted by taskId for a stable `planHash`; that is not the plan's business order. These
 * helpers derive the dependency order consumers actually mean, without touching the stored plan.
 */
const TASKS = [
  { taskId: "a-integration", dependencyTaskIds: ["z-core"] },
  { taskId: "m-metric", dependencyTaskIds: [] },
  { taskId: "z-core", dependencyTaskIds: [] },
];

describe("the plan's dependency order (#296)", () => {
  it("places a dependency before its dependent, and sorts within a layer by taskId", () => {
    // mutation: return the input order (or sort by taskId) -> a-integration comes first, red.
    expect(planOrderTasks(TASKS).map((task) => task.taskId)).toEqual(["m-metric", "z-core", "a-integration"]);
    expect(planLayers(TASKS).map((layer) => layer.map((task) => task.taskId))).toEqual([["m-metric", "z-core"], ["a-integration"]]);
  });

  it("stays finite on a cycle a draft should never have accepted", () => {
    const cyclic = [{ taskId: "a", dependencyTaskIds: ["b"] }, { taskId: "b", dependencyTaskIds: ["a"] }];
    expect(planOrderTasks(cyclic).map((task) => task.taskId).sort()).toEqual(["a", "b"]);
  });
});
