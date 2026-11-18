/**
 * Off-plan writes (#346) spec W2, plan Task 1: loop plan version 4. A v4 contract has no allowlist -- ccloop reads an
 * empty allowlist as "no allowlist" and enforces only the denylist -- so a task may write files its plan did not name;
 * its targetPaths become a plan, which one constraint line tells the agent. A stored v1-v3 recipe must keep re-expanding
 * to the bytes it was archived with (loop plans spec §2.2), or every archived plan's projection check would fail.
 */
import { describe, expect, it } from "vitest";
import {
  expandLoopPlan, expandRecipe, LOOP_PLAN_IDS, LOOP_RECIPE_SCHEMA, OFF_PLAN_TARGETS_CONSTRAINT, PREEXISTING_FAILURE_CONSTRAINT, offPlanWrites, currentLoopPlanVersion, SETUP_CONSTRAINT,
  type LoopInputs,
} from "../../src/control/loopPlans.js";
import { fixTaskAllowlist } from "../../src/control/requirementReview.js";
import type { MultiSplitOutput } from "../../src/control/requirementSchemas.js";
import { expandMultiSplitDraft } from "../../src/control/requirementSplit.js";

const inputs: LoopInputs = {
  goal: "add the export button", successCondition: "the export test passes",
  targetPaths: ["src/export.ts", "tests/export.test.ts"], checks: ["npm test"],
  nonGoals: [], relevantDocs: [], protectedPaths: ["src/vendor/**"], maxFilesTouched: null,
};
type Contract = { safetyPolicy: { allowlistPaths: string[]; denylistPaths: string[] }; context: { constraints: string[]; targetPaths: string[]; additionalRepos?: Array<Record<string, unknown>> } };

describe("loop plan version 4 (#346 W2)", () => {
  it("a version-4 standard task has no allowlist, its protected paths as the denylist, and the targetPaths line", () => {
    const expanded = expandLoopPlan("t1", "/r", "standard", inputs);
    if (!expanded.ok) throw new Error(expanded.reason);
    const contract = expanded.contract as Contract;
    expect(expanded.recipe.planVersion).toBe(4);
    // mutation: drop the `[]` branch in expandRecipe -> the allowlist is targetPaths again -> red
    expect(contract.safetyPolicy.allowlistPaths).toEqual([]);
    expect(contract.safetyPolicy.denylistPaths).toEqual(inputs.protectedPaths);
    // The targetPaths stay: they are what the planner and executor are told to change.
    expect(contract.context.targetPaths).toEqual(inputs.targetPaths);
    // mutation: drop the constraint line -> red
    // Ruling: human 「这次批准改写所有必要的判据」 (Orca session ca534c51, 2026-11-18) -- #341 L2 appends the pre-existing failure line after it.
    expect(contract.context.constraints.at(-2)).toBe(OFF_PLAN_TARGETS_CONSTRAINT);
    expect(OFF_PLAN_TARGETS_CONSTRAINT).toBe("targetPaths are the files this task is expected to change; change others when the work needs them.");
  });

  it("puts the targetPaths line after the plan's and the setup's constraints", () => {
    const expanded = expandLoopPlan("t1", "/r", "refactor", { ...inputs, setup: ["npm ci"] });
    if (!expanded.ok) throw new Error(expanded.reason);
    expect((expanded.contract as Contract).context.constraints).toEqual([
      // Ruling: human 「这次批准改写所有必要的判据」 (Orca session ca534c51, 2026-11-18) -- #341 L2's line follows the targetPaths line.
      "Change no observable behavior; every existing check must pass unchanged.", SETUP_CONSTRAINT, OFF_PLAN_TARGETS_CONSTRAINT, PREEXISTING_FAILURE_CONSTRAINT,
    ]);
  });

  it("makes version 4 every plan's current version, and only versions from 4 on write off-plan", () => {
    for (const plan of LOOP_PLAN_IDS) expect([plan, currentLoopPlanVersion(plan)]).toEqual([plan, 4]);
    expect([1, 2, 3, 4, 5].map(offPlanWrites)).toEqual([false, false, false, true, true]);
  });

  it("a version-3 recipe re-expands to its old bytes", () => {
    // The golden hash was computed on 8908c975 (before plan version 4 existed) by expanding exactly this recipe with
    // `tsx` (expandRecipe("t1", "/r", recipe).hash); its contract has allowlistPaths = targetPaths and no constraints.
    const recipe = { schema: LOOP_RECIPE_SCHEMA, planId: "standard" as const, planVersion: 3, chosenBy: "explicit" as const, inputs };
    const v3 = expandRecipe("t1", "/r", recipe);
    if (!v3.ok) throw new Error(v3.reason);
    expect(v3.hash).toBe("075aa34135bcb6e505f75c0310bb09e828ebe465fc4fb2ee0e8a4684cbc5cb37");
    expect((v3.contract as Contract).safetyPolicy.allowlistPaths).toEqual(inputs.targetPaths);
  });

  it("a version-4 multi-directory task sends an empty allowlist for each extra repository", () => {
    const output: MultiSplitOutput = { notes: "", tasks: [{ taskId: "both", title: "Both", labels: [], goal: "G", successCondition: "S",
      writes: [{ dir: "a", targetPaths: ["src/a.ts"], checks: ["true"] }, { dir: "b", targetPaths: ["docs/b.md"], checks: ["true"] }, { dir: "c", targetPaths: ["c.txt"], checks: [] }],
      dependsOn: [], traces: ["AC1"] }] };
    const expanded = expandMultiSplitDraft(output, { targetRepo: "/a", ccloopBin: "/bin/false", runsDir: "/runs", groupId: "r", statement: "G",
      successConditions: ["S"], dirs: [{ key: "a", path: "/a" }, { key: "b", path: "/b" }, { key: "c", path: "/c" }] });
    expect(expanded.reasons).toEqual([]);
    const contract = expanded.contracts.get("both") as Contract;
    expect(contract.safetyPolicy.allowlistPaths).toEqual([]);
    // mutation: drop the extra-repo `[]` -> each entry's allowlist is its targetPaths again -> red
    // Review Focus 4: each entry carries the key, explicitly empty.
    expect(contract.context.additionalRepos).toEqual([
      { key: "b", repoPath: "/b", targetPaths: ["docs/b.md"], allowlistPaths: [], requiredChecks: ["true"] },
      { key: "c", repoPath: "/c", targetPaths: ["c.txt"], allowlistPaths: [] },
    ]);
  });

  it("a review fix task of v4 tasks has no allowlist", () => {
    // Every source task is v4 (allowlist []): the union is empty, so the fix task has no allowlist either.
    expect(fixTaskAllowlist([[], []], ["a"])).toEqual([]);
    // Review Focus 3: a mixed v3+v4 group's union is the v3 task's narrow list plus the fix task's targets; the fix task
    // can then miss a file only the v4 task would have written. Accepted; pinned so a change to it is seen.
    expect(fixTaskAllowlist([["x"], []], ["a"])).toEqual(["x", "a"]);
  });
});
