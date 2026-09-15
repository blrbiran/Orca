import { describe, expect, it } from "vitest";
import type { PanelCoverage as ServerPanelCoverage } from "../../src/panel/coverage.js";
import type { DecisionListRow as ServerDecisionListRow } from "../../src/panel/listProjection.js";
import { LIST_FIELDS } from "../../src/panel/listProjection.js";
import type { MetricsReport as ServerMetricsReport } from "../../src/metrics/types.js";
import { METRICS_FIELDS } from "../../src/metrics/types.js";
import type {
  DecisionListRow as WebDecisionListRow,
  MetricsReport as WebMetricsReport,
  PanelCoverage as WebPanelCoverage,
} from "../../web/src/types.js";
import { WEB_LIST_FIELDS, WEB_REPORT_FIELDS } from "../../web/src/types.js";

/**
 * task 8 ruling K2. `web/` cannot import `src/` (a browser bundle cannot ship
 * the server's module graph), so it keeps its own copies of the three shapes
 * the panel's UI touches. Parity is enforced from the ROOT side, twice: this
 * file's `it`s below are the RUNTIME half (field-set equality); the bare
 * functions after them are the COMPILE-TIME half -- `npm run typecheck` type
 * -checks this file, so a diverging field on either side fails the build, not
 * a test run. Neither function is ever called: the criterion is that they
 * compile at all.
 *
 * METRICS_FIELDS' own comment says its order is deliberately NOT declaration
 * order, so both sides are sorted before compare -- an order-sensitive
 * equality would be pinning an accident, not the field set.
 */
describe("web/src/types.ts stays in lockstep with the server shapes (task 8 ruling K2)", () => {
  it("WEB_REPORT_FIELDS is the same SET as METRICS_FIELDS", () => {
    expect([...WEB_REPORT_FIELDS].sort()).toEqual([...METRICS_FIELDS].sort());
  });

  it("WEB_LIST_FIELDS is the same SET as LIST_FIELDS", () => {
    expect([...WEB_LIST_FIELDS].sort()).toEqual([...LIST_FIELDS].sort());
  });
});

// --- compile-time mutual-assignability checks (never called at runtime) ---

function reportServerToWeb(x: ServerMetricsReport): WebMetricsReport {
  return x;
}
function reportWebToServer(x: WebMetricsReport): ServerMetricsReport {
  return x;
}
function coverageServerToWeb(x: ServerPanelCoverage): WebPanelCoverage {
  return x;
}
function coverageWebToServer(x: WebPanelCoverage): ServerPanelCoverage {
  return x;
}
function listRowServerToWeb(x: ServerDecisionListRow): WebDecisionListRow {
  return x;
}
function listRowWebToServer(x: WebDecisionListRow): ServerDecisionListRow {
  return x;
}

// Referenced so nothing above is dead code the compiler is free to ignore;
// never invoked for its behavior, only so the assignments above are real
// return statements the type checker has to verify.
export const __webParityAssignabilityChecks__ = [
  reportServerToWeb,
  reportWebToServer,
  coverageServerToWeb,
  coverageWebToServer,
  listRowServerToWeb,
  listRowWebToServer,
] as const;
