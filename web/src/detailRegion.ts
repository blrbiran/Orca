/** Presentation only: stored state chooses the first region; explicit owner navigation wins. */
import type { GroupViewV1 } from "./controlTypes.js";
import type { GroupRegion } from "./overviewNavigation.js";
export const DETAIL_REGIONS = ["progress", "preparation", "problem", "results", "runs", "technical"] as const;
export type DetailRegion = typeof DETAIL_REGIONS[number];
export function defaultDetailRegion(view: GroupViewV1): DetailRegion {
  if (view.summary.state === "done") return "results";
  if (view.summary.state === "draft") return "preparation";
  return "progress";
}
export function dispatchDetailRegion(view: GroupViewV1): DetailRegion {
  // Feedback #47/#53: a ready group whose execution is pending (a start wake waits or a task runs) is not in preparation.
  return view.summary.state === "draft" || (view.summary.state === "ready" && view.summary.executionPending !== true) ? "preparation" : "problem";
}
export function focusedDetailRegion(view: GroupViewV1, region: GroupRegion): DetailRegion {
  if (region === "dispatch") return dispatchDetailRegion(view);
  if (region === "integration") return "results";
  return region;
}
export const runRegionId = (groupId: string, runId: string): string => `detail-run-${encodeURIComponent(groupId)}-${encodeURIComponent(runId)}`;
