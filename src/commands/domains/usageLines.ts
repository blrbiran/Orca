/**
 * Tester #285: a codex run reports usage only when a phase ends, so during a long execute `used` stays at the last phase
 * end's figure and the activity row does not move. These lines say what the figure is, that the run is still producing
 * output when its transcript says so, and, once the run has ended, its usage by kind. Times are UTC.
 */
import { isTerminalRunState } from "../../control/budget.js";

export interface UsageRun {
  runId?: string; state?: string; endedAt?: number | null; used?: { tokens: number };
  usageObservation?: string; usageAt?: number; usageBreakdown?: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

const clock = (ms: number, seconds = false): string => `${new Date(ms).toISOString().slice(11, seconds ? 19 : 16)}Z`;
const count = (n: number): string => n.toLocaleString("en-US");
/** Under way: not ended (issue-fixes spec §5.2) and not settled. */
export const underWay = (run: UsageRun): boolean => run.endedAt == null && typeof run.state === "string" && !isTerminalRunState(run.state);
const PHASE_END = "this agent reports usage only when a phase ends";

/** `orca run show`: the used figure's footing, the transcript's last write, and the split once the run has ended. */
export function runUsageLines(run: UsageRun | undefined, lastTranscriptAt: number | undefined): string[] {
  if (run === undefined) return [];
  const live = underWay(run);
  return [
    ...(live && run.usageObservation === "phase-end" && run.used !== undefined
      ? [`used: ${count(run.used.tokens)} tokens (${run.usageAt === undefined ? "no phase has ended yet" : `as of the last phase end at ${clock(run.usageAt)}`}; ${PHASE_END})`] : []),
    ...(live && lastTranscriptAt !== undefined ? [`transcript: producing output, last at ${clock(lastTranscriptAt, true)}`] : []),
    ...(!live && run.usageBreakdown !== undefined ? [`usage by kind: input ${count(run.usageBreakdown.input)} / output ${count(run.usageBreakdown.output)} / cacheRead ${count(run.usageBreakdown.cacheRead)}${run.usageBreakdown.cacheWrite > 0 ? ` / cacheWrite ${count(run.usageBreakdown.cacheWrite)}` : ""}`] : []),
  ];
}

/** `orca group show` / `group brief`: the group's used figure lags while such a run is under way. */
export function phaseEndBudgetLines(runIds: readonly string[], asOf: number | null): string[] {
  if (runIds.length === 0) return [];
  return [`budget: used is as of the last phase end${asOf === null ? "" : ` at ${clock(asOf)}`} for ${runIds.length} run${runIds.length === 1 ? "" : "s"} under way (${runIds.join(", ")}); ${PHASE_END}`];
}

/** The group view's runs under way whose agent reports at phase end, and the newest time any of them booked usage. */
export function phaseEndOfRuns(runs: readonly UsageRun[]): { runIds: string[]; asOf: number | null } {
  const phaseEnd = runs.filter((run) => underWay(run) && run.usageObservation === "phase-end" && typeof run.runId === "string");
  const times = phaseEnd.flatMap((run) => (run.usageAt === undefined ? [] : [run.usageAt]));
  return { runIds: phaseEnd.map((run) => run.runId!), asOf: times.length === 0 ? null : Math.max(...times) };
}
