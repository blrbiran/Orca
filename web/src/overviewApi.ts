import { getJson } from "./api.js";
import type { OverviewV1 } from "./controlTypes.js";
/** GET /api/control/overview -- with `sinceChangeSeq` the answer lists only what moved since it (Tester #393). */
export const fetchOverview = (sinceChangeSeq?: number): Promise<OverviewV1> =>
  getJson<OverviewV1>(sinceChangeSeq === undefined ? "/api/control/overview" : `/api/control/overview?sinceChangeSeq=${sinceChangeSeq}`);
