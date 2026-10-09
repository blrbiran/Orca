/**
 * Issue fixes spec §4.2(5): the facts the runs table and the task detail decide a run's reason and button by. Pure (type
 * imports only, no React or i18n), so the server's criteria compute the same run number the panel shows
 * (tests/control/retryTask.test.ts).
 */
import type { GroupViewV1, RunViewV1 } from "./controlTypes.js";

/** Failure is historical evidence: accounting and handoff state changes do not erase its cause. */
export function hasFailureOutcome(run: RunViewV1): boolean {
  return run.outcome != null && run.outcome !== "succeeded";
}

/** Existing active failed-run classification, retained for callers of the original predicate. */
export function isTerminalFailure(run: RunViewV1): boolean {
  return run.state === "blocked" && hasFailureOutcome(run);
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
  if (hasFailureOutcome(run) || run.state === "settled-failed") return run.stopReason ?? run.blockedReason ?? null;
  return run.state === "blocked" ? run.blockedReason ?? null : null;
}

/**
 * Spec §4.2(2): retry-task is refused on a clarifying group (group-state-invalid) and under any stop intent
 * (stop-mode-conflict), so the panel offers it only outside both (no button the server always refuses).
 */
export function retryTaskOpen(view: GroupViewV1): boolean {
  return view.stop === null && view.summary.state !== "clarifying" && view.summary.archived !== true;
}

/** UI qualification uses only exposed server facts; immutable proof and pending event validation remain server-side. */
export function retryRunOpen(view: GroupViewV1, run: RunViewV1): boolean {
  if (!retryTaskOpen(view) || !hasFailureOutcome(run) || run.taskId === null) return false;
  const work = view.workItems.find(item => item.taskId === run.taskId);
  if (work && (work.currentRunId !== run.runId || work.pendingRunId != null)) return false;
  if (run.unknownUsageSettlement && !run.unknownUsageSettlement.settlement) return false;
  if (view.handoffRequests.some(request => request.runId === run.runId && ["request-pending", "latched", "collecting", "outcome-unknown"].includes(request.state))) return false;
  if (run.state === "blocked") return true;
  if (!work || work.pendingRunId !== null || view.ledger.usageUnknown) return false;
  const allocations = view.allocations.filter(item => item.ownerKind === "task" && item.ownerId === run.taskId);
  const allocated = (state: "held" | "terminal"): boolean => ["work", "handoff"].every(bucket => allocations.some(item => item.bucket === bucket && item.state === state));
  if (run.state === "settled-recoverable") return work.status === "held" && allocated("held")
    && view.handoffRequests.some(request => request.runId === run.runId && request.state === "settled-recoverable")
    && view.checkpoints.some(checkpoint => checkpoint.runId === run.runId && checkpoint.state === "complete" && checkpoint.snapshotHash !== null);
  return run.state === "settled-failed" && work.status === "blocked" && allocated("terminal")
    && run.unknownUsageSettlement?.settlement?.reservationDisposition === "released"
    && view.handoffRequests.some(request => request.runId === run.runId && request.state === "settled-failed");
}

/**
 * The run states the group view shows only for an inactive run: controlViews.ts runViews refuses a view in which a run's
 * `active` flag disagrees with this set, so every other state is an active run.
 */
const INACTIVE_RUN_STATES: ReadonlySet<RunViewV1["state"]> = new Set([
  "failed-before-provider", "settled-recoverable", "settled-restartable", "settled-unrecoverable", "settled-failed",
]);

/**
 * Final review M1: the server's archive guards (src/control/archiveGroup.ts refuseArchive), in its order, so Archive is
 * offered only where archive-group is accepted. Its requirement-call guard has no counterpart here: a clarifying group
 * has no group view. An archived group is refused by the ledger gate instead; its view renders no Archive at all.
 */
export function archiveOpen(view: GroupViewV1): boolean {
  if (view.estimates.some((estimate) => estimate.state === "running" || estimate.state === "start-unknown")) return false;
  if (view.stop !== null && view.stop.mode !== "pause" && view.stop.state !== "handoff-complete" && view.stop.state !== "handoff-partial") return false;
  if (view.integration?.state === "resolving") return false;
  return view.runs.every((run) => INACTIVE_RUN_STATES.has(run.state));
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
