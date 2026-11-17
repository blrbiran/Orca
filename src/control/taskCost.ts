/**
 * Tester #321 part C: what a task has cost so far -- tokens and time over every run it had -- set against the group's
 * median over comparable tasks, so a person can judge at the first failure whether another run is worth it. Display
 * only: nothing here pauses, stops or changes a run, a budget or a retry. Shared by the panel (Problems row, task
 * detail), `orca group brief` (server side, from stored runs) and `orca task show` (from the group view), so the three
 * cannot disagree on a figure or a threshold. Pure: the caller passes `now`.
 */

/**
 * A task is flagged at this multiple of the group median, in tokens or in time. The tester's suggestion (#321: "3×
 * 中位数"). In the reported group a single run of an ordinary task cost 1.3M-5.0M tokens -- a ~4× spread between
 * ordinary tasks, so 2× of a median inside it would flag ordinary variation. The issue gives no per-task median; T8's
 * 14.5M is at least 3× any median up to 4.8M, i.e. any median that range can have short of its very top.
 */
export const COST_OUTLIER_MULTIPLE = 3;

/**
 * A task that has run this long (all its runs together) is flagged whatever the median says: the tester's absolute line
 * (#321: "或 30 分钟"). It needs no comparable tasks, so it also covers the first tasks of a group and small groups, and
 * the reported review-fix task (27.7 minutes and still running) would have crossed it a few minutes later.
 */
export const COST_LONG_RUNNING_MS = 30 * 60_000;

/**
 * Fewer finished tasks than this and there is no median to compare with. With one task the "median" is that task; with
 * two it is their mean, so one unusual task sets the bar. Three is the least count whose median ignores one outlier.
 */
export const COST_MIN_COMPARABLE_TASKS = 3;

/** One run as the cost reads it; `underWay` is the caller's own "running now" (each surface has its own run shape). */
export interface CostRun {
  taskId: string | null;
  tokens: number;
  activeMs: number;
  startedAt: number | null;
  endedAt: number | null;
  underWay: boolean;
}

export type CostReason = "tokens-multiple" | "time-multiple" | "long-running";

export interface TaskCost {
  taskId: string;
  runs: number;
  tokens: number;
  ms: number;
  /** A run of the task is under way, so its figures still grow and it is not a comparable task for the others. */
  underWay: boolean;
  /** The other tasks of the group with runs, none under way: what the medians are taken over. */
  comparable: number;
  /** Null when fewer than COST_MIN_COMPARABLE_TASKS tasks are comparable. */
  medianTokens: number | null;
  medianMs: number | null;
  /** This task's figure over the median; null without a median or when the median is 0. */
  tokensMultiple: number | null;
  timeMultiple: number | null;
  /** Why this task is flagged; empty when it is not. */
  reasons: CostReason[];
}

/** The panel's run view (and `group show`'s runs) as a cost run; "running now" is the Live region's starting/running. */
export function costRunOfView(run: { taskId: string | null; state: string; startedAt?: number | null; endedAt?: number | null; used: { tokens: number; activeMs: number } }): CostRun {
  return {
    taskId: run.taskId, tokens: run.used.tokens, activeMs: run.used.activeMs, startedAt: run.startedAt ?? null, endedAt: run.endedAt ?? null,
    underWay: run.endedAt == null && (run.state === "starting" || run.state === "running"),
  };
}

/**
 * A run's time, as the task table's duration column reads it: the active time booked for it, or only when none was, its
 * wall-clock span. A run under way has its booked time lag (usage is booked at phase end), so it counts the time since
 * it started when that is more.
 */
export function runMs(run: CostRun, now: number): number {
  if (run.underWay && run.startedAt !== null) return Math.max(run.activeMs, now - run.startedAt);
  if (run.activeMs > 0) return run.activeMs;
  return run.startedAt !== null && run.endedAt !== null ? Math.max(0, run.endedAt - run.startedAt) : 0;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Every task that had a run, in the order its first run appears, with its cost and how it compares. */
export function taskCosts(runs: readonly CostRun[], now: number): TaskCost[] {
  const totals = new Map<string, { runs: number; tokens: number; ms: number; underWay: boolean }>();
  for (const run of runs) {
    if (run.taskId === null) continue;
    const total = totals.get(run.taskId) ?? { runs: 0, tokens: 0, ms: 0, underWay: false };
    totals.set(run.taskId, { runs: total.runs + 1, tokens: total.tokens + run.tokens, ms: total.ms + runMs(run, now), underWay: total.underWay || run.underWay });
  }
  return [...totals].map(([taskId, total]) => {
    // A task is compared with the others, never with itself: in a small group its own figure would pull the median up.
    const others = [...totals].filter(([other, entry]) => other !== taskId && !entry.underWay).map(([, entry]) => entry);
    const enough = others.length >= COST_MIN_COMPARABLE_TASKS;
    const medianTokens = enough ? median(others.map((entry) => entry.tokens)) : null;
    const medianMs = enough ? median(others.map((entry) => entry.ms)) : null;
    const tokensMultiple = medianTokens === null || medianTokens === 0 ? null : total.tokens / medianTokens;
    const timeMultiple = medianMs === null || medianMs === 0 ? null : total.ms / medianMs;
    const reasons: CostReason[] = [
      ...(tokensMultiple !== null && tokensMultiple >= COST_OUTLIER_MULTIPLE ? ["tokens-multiple" as const] : []),
      ...(timeMultiple !== null && timeMultiple >= COST_OUTLIER_MULTIPLE ? ["time-multiple" as const] : []),
      ...(total.ms >= COST_LONG_RUNNING_MS ? ["long-running" as const] : []),
    ];
    return { taskId, ...total, comparable: others.length, medianTokens, medianMs, tokensMultiple, timeMultiple, reasons };
  });
}

/**
 * One task's cost from a group view's runs (`orca task show`); null when the task had no run, or when a run carries no
 * `used` (a partial view): a median over runs whose usage is missing would be a wrong figure, not a smaller one.
 */
export function viewTaskCost(runs: ReadonlyArray<Parameters<typeof costRunOfView>[0] | { used?: undefined }>, taskId: string, now: number): TaskCost | null {
  if (runs.some((run) => run.used === undefined)) return null;
  return taskCosts((runs as Array<Parameters<typeof costRunOfView>[0]>).map(costRunOfView), now).find((cost) => cost.taskId === taskId) ?? null;
}

/** The tasks flagged: the Problems rows, and `group brief`'s `costOutliers`. */
export function costOutliers(runs: readonly CostRun[], now: number): TaskCost[] {
  return taskCosts(runs, now).filter((cost) => cost.reasons.length > 0);
}
