/**
 * Tester #285: a codex run reports usage only when a phase ends, so during a long execute `used` stays at the last phase
 * end's figure and the activity row does not move. These lines say what the figure is, that the run is still producing
 * output when its transcript says so, and, once the run has ended, its usage by kind. Times are UTC.
 */
import { isTerminalRunState } from "../../control/budget.js";
import { TRANSCRIPT_STALE_MS, transcriptLive } from "../../control/transcriptLiveness.js";

export interface UsageRun {
  runId?: string; state?: string; endedAt?: number | null; used?: { tokens: number };
  usageObservation?: string; usageAt?: number; usageBreakdown?: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

const clock = (ms: number, seconds = false): string => `${new Date(ms).toISOString().slice(11, seconds ? 19 : 16)}Z`;
const count = (n: number): string => n.toLocaleString("en-US");
/** Under way: not ended (issue-fixes spec §5.2), not settled, and (tester #285, follow-up J) not blocked. */
export const underWay = (run: UsageRun): boolean => run.endedAt == null && typeof run.state === "string" && !isTerminalRunState(run.state) && run.state !== "blocked";
const PHASE_END = "this agent reports usage only when a phase ends";

/** `orca run show`: the used figure's footing, the transcript's last write, and the split once the run has ended. */
export function runUsageLines(run: UsageRun | undefined, lastTranscriptAt: number | undefined, now: number = Date.now()): string[] {
  if (run === undefined) return [];
  const live = underWay(run);
  // Tester #285 (follow-up J): "producing output" only for a run not blocked whose transcript was written within
  // TRANSCRIPT_STALE_MS; a blocked run, or a stale write, says when the output stopped instead.
  const transcript = lastTranscriptAt === undefined || (!live && run.state !== "blocked") ? []
    : transcriptLive(run, lastTranscriptAt, now) ? [`transcript: producing output, last at ${clock(lastTranscriptAt, true)}`]
      : [`transcript: no output since ${clock(lastTranscriptAt, true)}${run.state === "blocked" ? " (the run is blocked)" : ` (over ${TRANSCRIPT_STALE_MS / 60_000} minutes ago)`}`];
  return [
    ...(live && run.usageObservation === "phase-end" && run.used !== undefined
      ? [`used: ${count(run.used.tokens)} tokens (${run.usageAt === undefined ? "no phase has ended yet" : `as of the last phase end at ${clock(run.usageAt)}`}; ${PHASE_END})`] : []),
    ...transcript,
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
