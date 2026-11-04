import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { expandLoopTask, expandRecipe, loopInputsSchema, loopPlanFileSchema, loopRecipeSchema, normalizeLoopInputs, SETUP_CONSTRAINT } from "../../src/control/loopPlans.js";
import { taskContractSchema } from "../../src/scheduler/planFile.js";

/** Task setup spec A2: a task's optional `setup` reaches the contract as context.setupCommands; absent, no byte changes. */
const GOLDEN_INPUT = { plan: "bugfix", goal: "fix login", successCondition: "the login test passes", targetPaths: ["a"], checks: ["npm test"] };
const golden = JSON.parse(readFileSync(new URL("./fixtures/loopPlanGolden.json", import.meta.url), "utf8")) as
  { contractHash: string; recipeCanonical: string };

function expand(extra: Record<string, unknown> = {}) {
  const e = expandLoopTask("a", "/repo", loopPlanFileSchema.parse({ ...GOLDEN_INPUT, ...extra }), []);
  if (!e.ok) throw new Error(`refused: ${e.reason}`);
  return e;
}

describe("task setup through plan, recipe and contract", () => {
  it("absent setup leaves recipe and contract bytes as committed", () => {
    const recipe = loopRecipeSchema.parse(JSON.parse(golden.recipeCanonical));
    const historical = expandRecipe("a", "/repo", recipe);
    if (!historical.ok) throw new Error(historical.reason);
    expect(historical.hash).toBe(golden.contractHash);
    expect(canonicalBytes(recipe).toString("utf8")).toBe(golden.recipeCanonical);
    expect("setupCommands" in (historical.contract as { context: object }).context).toBe(false);
    const e = expand();
    // The fresh path (plan file -> normalizeLoopInputs -> expandLoopTask) is at the current plan version; the golden is
    // version 2. Pinned to the golden's version, its bytes and contract hash must be the committed ones.
    expect(e.recipe.planVersion).toBeGreaterThan(recipe.planVersion);
    const pinned = { ...e.recipe, planVersion: recipe.planVersion };
    expect(canonicalBytes(pinned).toString("utf8")).toBe(golden.recipeCanonical);
    const pinnedExpansion = expandRecipe("a", "/repo", pinned);
    if (!pinnedExpansion.ok) throw new Error(pinnedExpansion.reason);
    expect(pinnedExpansion.hash).toBe(golden.contractHash);
  });

  it("present setup reaches context.setupCommands and adds the constraint", () => {
    const { context } = expand({ setup: ["npm ci"] }).contract as { context: { setupCommands?: string[]; constraints: string[] } };
    expect(context.setupCommands).toEqual(["npm ci"]);
    expect(context.constraints.at(-1)).toBe(SETUP_CONSTRAINT);
    expect(SETUP_CONSTRAINT).toBe("When a required check or a setup command cannot run, report it in your result; do not change the repository to make it run unless the task is about that. Install any dependency you add.");
  });

  it("setup is bounded", () => {
    const bad = [[], Array.from({ length: 9 }, (_, i) => `c${i}`), ["x".repeat(4097)], ["é".repeat(2049)], ["a\nb"], ["a\rb"], [""]];
    for (const setup of bad) expect(loopPlanFileSchema.safeParse({ ...GOLDEN_INPUT, setup }).success, JSON.stringify(setup).slice(0, 30)).toBe(false);
    for (const setup of [["x".repeat(4096)], Array.from({ length: 8 }, (_, i) => `c${i}`)]) {
      expect(loopPlanFileSchema.safeParse({ ...GOLDEN_INPUT, setup }).success).toBe(true);
    }
  });

  it("loopInputsSchema (set-task-loop, webProtocol) bounds setup the same way", () => {
    const inputs = { goal: "g", successCondition: "s", targetPaths: ["a"], checks: ["c"], nonGoals: [], relevantDocs: [], protectedPaths: [], maxFilesTouched: null };
    expect(loopInputsSchema.safeParse({ ...inputs, setup: ["npm ci"] }).success).toBe(true);
    for (const setup of [[], ["a\nb"], ["x".repeat(4097)], Array.from({ length: 9 }, (_, i) => `c${i}`)]) {
      expect(loopInputsSchema.safeParse({ ...inputs, setup }).success).toBe(false);
    }
  });

  it("a plan file may give setup", () => {
    const parsed = loopPlanFileSchema.parse({ ...GOLDEN_INPUT, setup: ["npm ci", "make gen"] });
    expect(normalizeLoopInputs(parsed).setup).toEqual(["npm ci", "make gen"]);
    const e = expand({ setup: ["npm ci", "make gen"] });
    expect(e.recipe.inputs.setup).toEqual(["npm ci", "make gen"]);
    expect((e.contract as { context: { setupCommands: string[] } }).context.setupCommands).toEqual(["npm ci", "make gen"]);
  });

  it("the contract schema accepts setupCommands within bounds and refuses outside them", () => {
    const base = expand().contract as { context: object };
    const withSetup = (setupCommands: unknown) => taskContractSchema.safeParse({ ...base, context: { ...base.context, setupCommands } }).success;
    expect(withSetup(["npm ci"])).toBe(true);
    expect(withSetup([])).toBe(false);
    expect(withSetup(["a\nb"])).toBe(false);
    expect(withSetup(["x".repeat(4097)])).toBe(false);
  });
});
