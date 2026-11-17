/**
 * Tester #285: `used` is booked work while a Codex response observation can arrive between phase ends. These lines
 * distinguish booked usage from provisional response usage, name recent transcript output, and show usage by kind
 * once the run has ended. Times are UTC.
 */
import { isTerminalRunState } from "../../control/budget.js";
import { TRANSCRIPT_STALE_MS, transcriptLive } from "../../control/transcriptLiveness.js";
import { COST_LONG_RUNNING_MS, COST_MIN_COMPARABLE_TASKS, type CostReason, type TaskCost } from "../../control/taskCost.js";

export interface UsageRun {
  runId?: string; state?: string; endedAt?: number | null; used?: { tokens: number };
  usageObservation?: string; usageAt?: number; usageBreakdown?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  liveUsage?: { attempt: number; phase: "plan" | "execute" | "verify"; tokens: number; observedAt: string; revision: number };
}

const clock = (ms: number, seconds = false): string => `${new Date(ms).toISOString().slice(11, seconds ? 19 : 16)}Z`;
const count = (n: number): string => n.toLocaleString("en-US");
/** Under way: not ended (issue-fixes spec §5.2), not settled, and (tester #285, follow-up J) not blocked. */
export const underWay = (run: UsageRun): boolean => run.endedAt == null && typeof run.state === "string" && !isTerminalRunState(run.state) && run.state !== "blocked";
const PHASE_END = "booked usage updates only when a phase ends";

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
    ...(live && run.usageObservation === "realtime" && run.liveUsage !== undefined && run.used !== undefined
      ? [`used: ${count(run.used.tokens)} tokens (${run.usageAt === undefined ? "no work event booked yet" : `last booked at ${clock(run.usageAt)}`}; response reading is provisional)`] : []),
    ...(live && run.liveUsage !== undefined
      ? [`observed: at least ${count(run.liveUsage.tokens)} tokens in ${run.liveUsage.phase} (attempt ${run.liveUsage.attempt}), last response at ${run.liveUsage.observedAt} (provisional: not booked; any live ceiling is checked after an observed response, so an in-flight request may pass it)`] : []),
    ...transcript,
    ...(!live && run.usageBreakdown !== undefined ? [`usage by kind: input ${count(run.usageBreakdown.input)} / output ${count(run.usageBreakdown.output)} / cacheRead ${count(run.usageBreakdown.cacheRead)}${run.usageBreakdown.cacheWrite > 0 ? ` / cacheWrite ${count(run.usageBreakdown.cacheWrite)}` : ""}`] : []),
  ];
}

/** `orca group show` / `group brief`: the group's used figure lags while such a run is under way. */
export function phaseEndBudgetLines(runIds: readonly string[], asOf: number | null): string[] {
  if (runIds.length === 0) return [];
  return [`budget: used is as of the last phase end${asOf === null ? "" : ` at ${clock(asOf)}`} for ${runIds.length} run${runIds.length === 1 ? "" : "s"} under way (${runIds.join(", ")}); ${PHASE_END}`];
}

const minutes = (ms: number): string => `${Math.round(ms / 60_000)} min`;
const COST_REASON_WORDS: Record<CostReason, (cost: TaskCost) => string> = {
  "tokens-multiple": (cost) => `${cost.tokensMultiple!.toFixed(1)}x the median tokens`,
  "time-multiple": (cost) => `${cost.timeMultiple!.toFixed(1)}x the median time`,
  "long-running": () => `over ${minutes(COST_LONG_RUNNING_MS)}`,
};

/**
 * Tester #321 part C: one task's cost over all its runs against the group median (taskCost.ts), for `group brief` (each
 * flagged task) and `task show` (the task). A flagged task says so, and that nothing was paused: the line is a notice.
 */
export function taskCostLine(cost: TaskCost): string {
  const own = `${cost.runs} run${cost.runs === 1 ? "" : "s"}, ${minutes(cost.ms)}, ${count(cost.tokens)} tokens${cost.underWay ? " so far" : ""}`;
  const against = cost.medianTokens === null || cost.medianMs === null
    ? `${cost.comparable} finished other task${cost.comparable === 1 ? "" : "s"} to compare with, ${COST_MIN_COMPARABLE_TASKS} needed for a median`
    : `group median over ${cost.comparable} finished other tasks: ${count(Math.round(cost.medianTokens))} tokens, ${minutes(cost.medianMs)}`;
  const flagged = cost.reasons.map((reason) => COST_REASON_WORDS[reason](cost));
  return `cost: task ${cost.taskId}: ${own}; ${against}${flagged.length === 0 ? "" : `; flagged: ${flagged.join(", ")} (a notice: nothing was paused or stopped)`}`;
}

/** The group view's runs under way whose agent reports at phase end, and the newest time any of them booked usage. */
export function phaseEndOfRuns(runs: readonly UsageRun[]): { runIds: string[]; asOf: number | null } {
  const phaseEnd = runs.filter((run) => underWay(run) && run.usageObservation === "phase-end" && typeof run.runId === "string");
  const times = phaseEnd.flatMap((run) => (run.usageAt === undefined ? [] : [run.usageAt]));
  return { runIds: phaseEnd.map((run) => run.runId!), asOf: times.length === 0 ? null : Math.max(...times) };
}
