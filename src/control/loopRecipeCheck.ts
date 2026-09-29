import { expandRecipe, type LoopRecipe } from "./loopPlans.js";

/**
 * Loop plans spec §3.3: a loop task's recipe must re-expand, byte for byte, to the contract the task carries (repoPath
 * is the stored contract's own, Drafter finding F9). The one check shared by the projection (plan Task A5) and the
 * amendment reader (plan Task B1, ruling P5). Kept out of loopPlans.ts so it calls expandRecipe through the module's
 * export: a registry that drifts under an archived recipe is what this check exists to catch.
 */
export function recipeExpandsTo(taskId: string, repoPath: string, recipe: LoopRecipe, contractCanonicalJson: string): boolean {
  const expanded = expandRecipe(taskId, repoPath, recipe);
  return expanded.ok && expanded.canonicalJson === contractCanonicalJson;
}
