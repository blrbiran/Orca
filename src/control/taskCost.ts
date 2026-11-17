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
 * A task that has run this long (all its runs together) is flagged when there is no median to compare it with: the
 * tester's absolute line (#321: "或 30 分钟"), for the first tasks of a group and small groups. The reported review-fix
 * task (27.7 minutes and still running) would have crossed it a few minutes later. Where a median exists only the
 * multiple flags (controller ruling 2026-11-18): a group whose tasks all run long should not fill Problems with rows that
 * say nothing relative.
 */
export const COST_LONG_RUNNING_MS = 30 * 60_000;

/**
 * Fewer finished tasks than this and there is no median to compare with. With one task the "median" is that task; with
 * two it is their mean, so one unusual task sets the bar. Three is the least count whose median ignores one outlier.
 */
export const COST_MIN_COMPARABLE_TASKS = 3;

/**
 * The states in which a run's agent still spends: the view's `starting` and `running`, and the stored states displayed as
 * them (controlViews.ts displayRunState: claimed, starting, start-pending -> starting; accepted -> running). Every other
 * run -- collected, reconciling, unknown, blocked, settled -- counts its booked active time, so a landing wait does not
 * make a task look long-running. Review ruling 2026-11-18: one predicate for the panel, `task show` and `group brief`.
 */
const UNDER_WAY_STATES: ReadonlySet<string> = new Set(["starting", "running", "claimed", "start-pending", "accepted"]);
export const costUnderWay = (run: { state: string; endedAt?: number | null }): boolean => run.endedAt == null && UNDER_WAY_STATES.has(run.state);

/** A run that finished its task: it landed, or ccloop's outcome was success. Only such tasks are compared with. */
export const costFinished = (run: { state: string; outcome?: string | null }): boolean => run.state === "landed" || run.outcome === "succeeded";

/** One run as the cost reads it, from either surface's run shape (the view's, or the stored body for `group brief`). */
export interface CostRun {
  taskId: string | null;
  tokens: number;
  /** False when the run's usage is unknown (`run.unknown`): its `tokens` is then not a figure, not even 0. */
  usageKnown: boolean;
  activeMs: number;
  startedAt: number | null;
  endedAt: number | null;
  underWay: boolean;
  finished: boolean;
}

export type CostReason = "tokens-multiple" | "time-multiple" | "long-running";

export interface TaskCost {
  taskId: string;
  runs: number;
  /** Null when the usage of any of its runs is unknown. */
  tokens: number | null;
  ms: number;
  /** A run of the task is under way, so its figures still grow and it is not a comparable task for the others. */
  underWay: boolean;
  /** The group's other finished tasks (a run landed or succeeded) with known, non-zero usage: what the medians are over. */
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

/** The view's run shape `costRunOfView` reads (the panel's runs, and `group show`'s). */
export type CostViewRun = { taskId: string | null; state: string; outcome?: string | null; usageUnknown?: true; startedAt?: number | null; endedAt?: number | null; used: { tokens: number; activeMs: number } };

/** The panel's run view (and `group show`'s runs) as a cost run. */
export function costRunOfView(run: CostViewRun): CostRun {
  return {
    taskId: run.taskId, tokens: run.used.tokens, usageKnown: run.usageUnknown !== true, activeMs: run.used.activeMs,
    startedAt: run.startedAt ?? null, endedAt: run.endedAt ?? null, underWay: costUnderWay(run), finished: costFinished(run),
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
  const totals = new Map<string, { runs: number; tokens: number | null; ms: number; underWay: boolean; finished: boolean }>();
  for (const run of runs) {
    if (run.taskId === null) continue;
    const total = totals.get(run.taskId) ?? { runs: 0, tokens: 0, ms: 0, underWay: false, finished: false };
    totals.set(run.taskId, { runs: total.runs + 1, tokens: total.tokens === null || !run.usageKnown ? null : total.tokens + run.tokens,
      ms: total.ms + runMs(run, now), underWay: total.underWay || run.underWay, finished: total.finished || run.finished });
  }
  return [...totals].map(([taskId, { finished: _finished, ...total }]) => {
    // A task is compared with its finished peers, never with itself: in a small group its own figure would pull the median
    // up. A peer still under way, unfinished, or whose usage is unknown or 0 is not a figure to compare with (review
    // ruling 2026-11-18: peers of 0, 0, 2M, 2M gave a 1M median).
    const others = [...totals].filter(([other, entry]) => other !== taskId && !entry.underWay && entry.finished && entry.tokens !== null && entry.tokens > 0)
      .map(([, entry]) => ({ tokens: entry.tokens!, ms: entry.ms }));
    const enough = others.length >= COST_MIN_COMPARABLE_TASKS;
    const medianTokens = enough ? median(others.map((entry) => entry.tokens)) : null;
    const medianMs = enough ? median(others.map((entry) => entry.ms)) : null;
    // A peer's tokens are > 0, so a token median is never 0; a time median can be (peers with no time booked or known).
    const tokensMultiple = medianTokens === null || total.tokens === null ? null : total.tokens / medianTokens;
    const timeMultiple = medianMs === null || medianMs === 0 ? null : total.ms / medianMs;
    const reasons: CostReason[] = [
      ...(tokensMultiple !== null && tokensMultiple >= COST_OUTLIER_MULTIPLE ? ["tokens-multiple" as const] : []),
      ...(timeMultiple !== null && timeMultiple >= COST_OUTLIER_MULTIPLE ? ["time-multiple" as const] : []),
      ...(!enough && total.ms >= COST_LONG_RUNNING_MS ? ["long-running" as const] : []),
    ];
    return { taskId, ...total, comparable: others.length, medianTokens, medianMs, tokensMultiple, timeMultiple, reasons };
  });
}

/**
 * One task's cost from a group view's runs (`orca task show`); null when the task had no run, or when a run carries no
 * `used` (a partial view): a median over runs whose usage is missing would be a wrong figure, not a smaller one.
 */
export function viewTaskCost(runs: ReadonlyArray<CostViewRun | { used?: undefined }>, taskId: string, now: number): TaskCost | null {
  if (runs.some((run) => run.used === undefined)) return null;
  return taskCosts((runs as CostViewRun[]).map(costRunOfView), now).find((cost) => cost.taskId === taskId) ?? null;
}

/** The tasks flagged: the Problems rows, and `group brief`'s `costOutliers`. */
export function costOutliers(runs: readonly CostRun[], now: number): TaskCost[] {
  return taskCosts(runs, now).filter((cost) => cost.reasons.length > 0);
}
