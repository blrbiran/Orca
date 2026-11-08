import { describe, expect, it } from "vitest";
import { expandLoopTask, loopPlanFileSchema } from "../../src/control/loopPlans.js";
import { taskContractSchema } from "../../src/scheduler/planFile.js";

const task = { plan: "standard", goal: "do no more than necessary", successCondition: "checks cover every requirement", targetPaths: ["src/**"], checks: ["npm test"] };

describe("decisive checks are an authored contract claim", () => {
  it("preserves an explicit opt-in through a standard loop plan", () => {
    const input = loopPlanFileSchema.parse({ ...task, commandChecksDecideGoal: true });
    const expanded = expandLoopTask("t1", "/repo", input, []);
    expect(expanded.ok).toBe(true);
    if (!expanded.ok) return;
    expect(taskContractSchema.parse(JSON.parse(expanded.canonicalJson)).verification.commandChecksDecideGoal).toBe(true);
  });

  it("keeps old recipe bytes unchanged when no declaration is given", () => {
    const input = loopPlanFileSchema.parse(task);
    const expanded = expandLoopTask("t1", "/repo", input, []);
    expect(expanded.ok).toBe(true);
    if (!expanded.ok) return;
    expect(taskContractSchema.parse(JSON.parse(expanded.canonicalJson)).verification).not.toHaveProperty("commandChecksDecideGoal");
  });

  it("refuses the opt-in with an agent verifier or setup commands at the frozen contract", () => {
    const input = loopPlanFileSchema.parse({ ...task, plan: "bugfix", commandChecksDecideGoal: true });
    const agentVerified = expandLoopTask("t1", "/repo", input, []);
    if (!agentVerified.ok) throw new Error(agentVerified.reason);
    expect(taskContractSchema.safeParse(JSON.parse(agentVerified.canonicalJson)).success).toBe(false);
    const withSetup = loopPlanFileSchema.parse({ ...task, commandChecksDecideGoal: true, setup: ["true"] });
    const setupExpanded = expandLoopTask("t1", "/repo", withSetup, []);
    if (!setupExpanded.ok) throw new Error(setupExpanded.reason);
    expect(taskContractSchema.safeParse(JSON.parse(setupExpanded.canonicalJson)).success).toBe(false);
  });
});
