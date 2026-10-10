import { getJson } from "./api.js";
import type { OverviewV1 } from "./controlTypes.js";
/** Authenticated GET only. Uses the panel's existing session/error handling. */
export const fetchOverview = (): Promise<OverviewV1> => getJson<OverviewV1>("/api/control/overview");
