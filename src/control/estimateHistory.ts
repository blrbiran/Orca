import type { ControlStore } from "./store.js";
import { groupRepoIdOf } from "./usageLedger.js";

/**
 * Tester #173 / #224 / #266 (follow-up L; human, round K: "at confirm, use the median actual spend of this repo's past
 * tasks as a reference, computed by code, and show the estimate/history ratio"). Information only: no estimate, limit or
 * refusal reads it.
 *
 * The sample is every task (a work item of kind `task`) of another group of the same repository (groupRepoIdOf, the
 * ledger's pick) whose status is `done` -- its work completed: landed, an accepted attempt, or accepted as no change. A
 * task's spend is the work tokens of all its runs, failed attempts included (each run's cumulative work: the ledger unit,
 * input + output + cacheRead + cacheWrite). Left out:
 * - system groups, any `systemDebug` mark (checks spec 2026-10-22 §2.3's rule, integrationCheck.ts landedGroups);
 * - a task with no run, or with a run whose usage is unknown or only approximate (its total is not known; the rule of the
 *   group view's `expected`, controlViews.ts taskWorkUsed).
 * Archived groups count: archiving a finished group does not undo what it spent.
 * Below HISTORY_MIN_SAMPLE tasks there is no median: too few to stand for the repository.
 */
export const HISTORY_MIN_SAMPLE = 3;
export interface RepoTaskHistory { medianTokens: number | null; sampleCount: number }

export function repoTaskHistory(store: ControlStore, groupId: string): RepoTaskHistory {
  const own = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  const repoId = own === undefined ? null : groupRepoIdOf(JSON.parse(String(own.body)) as Record<string, unknown>);
  const spent: number[] = [];
  if (repoId !== null) {
    for (const row of store.db.prepare("SELECT id, body FROM groups WHERE id<>? ORDER BY rowid").all(groupId)) {
      let body: Record<string, unknown>;
      try { body = JSON.parse(String(row.body)) as Record<string, unknown>; } catch { continue; } // its own reads name it
      if (groupRepoIdOf(body) !== repoId || Object.hasOwn(body, "systemDebug")) continue;
      const runs = new Map<string, Array<{ unknown?: { work?: boolean }; usageApproximate?: unknown; cumulative?: { work?: { tokens?: number } } }>>();
      for (const r of store.db.prepare("SELECT work_item_id, body FROM runs WHERE group_id=?").all(String(row.id))) {
        const list = runs.get(String(r.work_item_id)) ?? [];
        list.push(JSON.parse(String(r.body)));
        runs.set(String(r.work_item_id), list);
      }
      for (const w of store.db.prepare("SELECT id, body FROM work_items WHERE group_id=?").all(String(row.id))) {
        const work = JSON.parse(String(w.body)) as { kind?: unknown; status?: unknown };
        const taskRuns = runs.get(String(w.id)) ?? [];
        if (work.kind !== "task" || work.status !== "done" || taskRuns.length === 0) continue;
        if (taskRuns.some((r) => r.unknown?.work === true || r.usageApproximate !== undefined)) continue;
        spent.push(taskRuns.reduce((sum, r) => sum + (r.cumulative?.work?.tokens ?? 0), 0));
      }
    }
  }
  return { medianTokens: spent.length < HISTORY_MIN_SAMPLE ? null : medianOf(spent), sampleCount: spent.length };
}

/** The middle value; for an even count the mean of the two middle ones, rounded to a whole token. */
export function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** estimate / median to two significant digits (a 75x gap is 0.013, not 0.0); null when the median is 0. */
export function historyRatio(estimateTokens: number, medianTokens: number): number | null {
  return medianTokens <= 0 ? null : Number((estimateTokens / medianTokens).toPrecision(2));
}

/** The group view's `estimateHistory`: the history, and each task's estimate (null when none is ready) as a multiple of it. */
export interface EstimateHistoryView extends RepoTaskHistory {
  minimumSample: number;
  tasks: Array<{ taskId: string; estimateTokens: number | null; ratio: number | null }>;
}
export function estimateHistoryView(store: ControlStore, groupId: string, taskIds: readonly string[],
  estimate: { output: { tasks: ReadonlyArray<{ taskId: string; work: { tokens: number } }> } | null } | null): EstimateHistoryView {
  const history = repoTaskHistory(store, groupId);
  return { ...history, minimumSample: HISTORY_MIN_SAMPLE, tasks: taskIds.map((taskId) => {
    const estimateTokens = estimate?.output?.tasks.find((task) => task.taskId === taskId)?.work.tokens ?? null;
    return { taskId, estimateTokens, ratio: estimateTokens === null || history.medianTokens === null ? null : historyRatio(estimateTokens, history.medianTokens) };
  }) };
}
