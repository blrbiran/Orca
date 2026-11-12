import { hasObservedUsage, readRun } from "./budget.js";
import { landedAnywhere } from "./driveRecord.js";
import type { ControlStore } from "./store.js";

/**
 * Tester follow-up G §6.1 (#192): whether a dependency no longer holds its dependents back. Its work item is `done`, or
 * its current run already landed on the group branch -- a landed commit, outcome `succeeded`, no block reason, and every
 * usage observed and booked (nothing past the run's high water). Archive, settle and publish then continue off the
 * claim path; the landed run keeps its booked usage in `group.used` and its remaining grant in `group.reserved` until
 * its settle releases it, so a claim on top of it cannot overspend.
 */
export function dependencyReady(store: ControlStore, groupId: string, dependencyWorkItemId: string): boolean {
  const row = store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(groupId, dependencyWorkItemId);
  if (row === undefined) return false;
  const work = JSON.parse(String(row.body)) as { status?: unknown; currentRunId?: unknown };
  if (work.status === "done") return true;
  if (typeof work.currentRunId !== "string") return false;
  const runRow = store.db.prepare("SELECT body FROM runs WHERE id=? AND group_id=?").get(work.currentRunId, groupId);
  if (runRow === undefined) return false;
  const run = JSON.parse(String(runRow.body)) as { state?: unknown; phase?: unknown; highWater?: unknown; drive?: { outcome?: unknown; blockedReason?: unknown; landedCommit?: unknown; landedDirs?: unknown } };
  const drive = run.drive;
  if (run.state !== "landed" || run.phase !== "work" || drive === undefined) return false;
  if (!landedAnywhere(drive) || drive.outcome !== "succeeded" || (drive.blockedReason ?? null) !== null) return false;
  if (!hasObservedUsage(store, readRun(store, work.currentRunId))) return false;
  return store.db.prepare("SELECT seq FROM usage_events WHERE run_id=? AND seq>?").get(work.currentRunId, Number(run.highWater)) === undefined;
}
