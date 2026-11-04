import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { expandLoopTask, expandRecipe, loopPlanFileSchema, loopRecipeSchema, normalizeLoopInputs, SETUP_CONSTRAINT } from "../../src/control/loopPlans.js";
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
    expect("setup" in e.recipe.inputs).toBe(false);
    expect("setupCommands" in (e.contract as { context: object }).context).toBe(false);
    expect(e.canonicalJson).not.toContain("setup");
    expect(e.canonicalJson).not.toContain(SETUP_CONSTRAINT);
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
