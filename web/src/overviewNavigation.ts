/** Read-only owner destinations; App owns selection, live GETs and focus. */
import type { OverviewDestinationV1 } from "./controlTypes.js";
export type GroupRegion = Extract<OverviewDestinationV1, { kind: "group" }>["region"] | "progress" | "runs" | "technical";
export type RequirementRegion = Extract<OverviewDestinationV1, { kind: "requirement" }>["region"];
export type OverviewTarget = Exclude<OverviewDestinationV1, { kind: "recovery" | "group" }>
  | (Omit<Extract<OverviewDestinationV1, { kind: "group" }>, "region"> & { region: GroupRegion })
  | { kind: "decision"; projectKey: string; id: string }
  | { kind: "global-control"; region: "recovery" | "import" };
export const overviewRegionId = (kind: "group" | "requirement", groupId: string, region: string): string =>
  `overview-${kind}-${encodeURIComponent(groupId)}-${region}`;
export function overviewFocusId(target: OverviewTarget): string {
  if (target.kind === "group" || target.kind === "requirement") return overviewRegionId(target.kind, target.groupId, target.region);
  if (target.kind === "decision") return "overview-decision-detail";
  return `overview-control-${target.region}`;
}
