/**
 * Tester follow-up B T3 (#224), follow-up F §4 (#173): whether an estimator profile is pinned to an estimate instruction
 * older than the newest this Orca holds. The CLI (`group estimate`, `group confirm`, human and --json) and the panel's
 * budget editor both say so, from this one module.
 *
 * web/ bundles it, so like budgetSuggestions.ts it imports nothing (task 8 ruling K2): the versions are listed here, and
 * tests/control/estimateInstructionAge.test.ts fails when they differ from estimatePrompt.ts ESTIMATE_INSTRUCTIONS' keys.
 */
export const ESTIMATE_INSTRUCTION_VERSIONS: readonly string[] = ["1", "2", "3", "4"];
export const NEWEST_ESTIMATE_INSTRUCTION = Math.max(...ESTIMATE_INSTRUCTION_VERSIONS.map(Number));

/** The profile's version when it is a known one older than the newest; null when it is the newest, unknown or not reported. */
export function olderEstimateInstruction(version: string | null | undefined): string | null {
  if (typeof version !== "string" || !ESTIMATE_INSTRUCTION_VERSIONS.includes(version) || Number(version) >= NEWEST_ESTIMATE_INSTRUCTION) return null;
  return version;
}
