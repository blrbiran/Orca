/**
 * Flow engine spec §7.5: after each execution code recomputes candidacy (candidates.ts, with the new output's hash or
 * `equals` projection, and the person's "unchanged" marks); a chosen step whose reasons are all gone leaves the plan.
 * Steps only ever leave: code never adds one the person did not choose. Executed steps stay as the record of the plan.
 */
import type { Candidate } from "./candidates.js";

export interface RunningPlan { chosen: string[]; executed: string[] }

export function afterExecution(plan: RunningPlan, candidatesNow: readonly Candidate[]): RunningPlan {
  const live = new Set(candidatesNow.map((c) => c.stepKey));
  return { chosen: plan.chosen.filter((key) => plan.executed.includes(key) || live.has(key)), executed: [...plan.executed] };
}
