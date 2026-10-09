/**
 * Issue fixes spec §4.2(5): the facts the runs table and the task detail decide a run's reason and button by. Pure (type
 * imports only, no React or i18n), so the server's criteria compute the same run number the panel shows
 * (tests/control/retryTask.test.ts).
 */
import type { GroupViewV1, RunViewV1 } from "./controlTypes.js";

/** A blocked run whose ccloop run ended with an outcome other than `succeeded`: its button is "Retry task". */
export function isTerminalFailure(run: RunViewV1): boolean {
  return run.state === "blocked" && run.outcome != null && run.outcome !== "succeeded";
}

/**
 * ccloop's phase failures reach Orca as `String(error)` (ccloop runLoop.ts PhaseExecutionError), so the reason code follows
 * an `Error: ` prefix; the explanation tables are keyed by the code.
 */
const ERROR_PREFIX = "Error: ";
export function reasonCode(reason: string): string {
  return reason.startsWith(ERROR_PREFIX) ? reason.slice(ERROR_PREFIX.length) : reason;
}

/** The reason a run shows: ccloop's own for a failed or settled-failed run when it gave one, else the driver's blocked reason. */
export function runReasonText(run: RunViewV1): string | null {
  if (isTerminalFailure(run) || run.state === "settled-failed") return run.stopReason ?? run.blockedReason ?? null;
  return run.state === "blocked" ? run.blockedReason ?? null : null;
}

/**
 * Spec §4.2(2): retry-task is refused on a clarifying group (group-state-invalid) and under any stop intent
 * (stop-mode-conflict), so the panel offers it only outside both (no button the server always refuses).
 */
export function retryTaskOpen(view: GroupViewV1): boolean {
  return view.stop === null && view.summary.state !== "clarifying" && view.summary.archived !== true;
}

/** Spec §4.2(2): a task's run number is the count of its lineage runs that reached the provider. */
export function taskRunNumber(view: GroupViewV1, taskId: string): number {
  return lineageRunNumber(view.workItems.find((item) => item.taskId === taskId)?.lineageRunIds ?? [], view.runs);
}

/** The count behind `taskRunNumber`, for a caller that holds the task's lineage and the runs but not a whole group view. */
export function lineageRunNumber(lineageRunIds: readonly string[], runs: readonly RunViewV1[]): number {
  const lineage = new Set(lineageRunIds);
  return runs.filter((run) => lineage.has(run.runId) && run.state !== "failed-before-provider").length;
}
