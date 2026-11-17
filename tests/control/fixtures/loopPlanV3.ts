import type * as LoopPlans from "../../../src/control/loopPlans.js";

type LoopPlansModule = typeof LoopPlans;

/**
 * Off-plan writes spec W5 (#346): `--allow-observed-paths` and path allowances still serve groups whose loop tasks are
 * version 3 or older, but plan-file import always expands at the current version (4, no allowlist), so an allowlist miss
 * cannot be staged with a fresh task any more. A suite that exercises those v<=3 features mocks loopPlans with this:
 * every loop task a plan file or split expands is archived from an explicit version-3 recipe, and everything downstream
 * re-expands from that recipe's own version. Test-only; no production caller can choose a version.
 *
 *   vi.mock("../../src/control/loopPlans.js", async (actual) =>
 *     (await import("./fixtures/loopPlanV3.js")).loopPlansAtV3(await actual()));
 */
export function loopPlansAtV3(actual: LoopPlansModule): LoopPlansModule {
  const expandLoopTask: LoopPlansModule["expandLoopTask"] = (taskId, repoPath, input, labels) => {
    const current = actual.expandLoopTask(taskId, repoPath, input, labels);
    if (!current.ok) return current;
    const recipe = { ...current.recipe, planVersion: 3 };
    const v3 = actual.expandRecipe(taskId, repoPath, recipe);
    return v3.ok ? { ...v3, recipe } : v3;
  };
  return { ...actual, expandLoopTask };
}
