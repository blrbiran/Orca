import { describe, expect, it } from "vitest";
import { computePanelCoverage, unreviewedHighTier } from "../../src/panel/coverage.js";
import type { DecisionObservation } from "../../src/metrics/types.js";
import type { ReviewRow } from "../../src/panel/reviewsStore.js";

// reviews compaction spec C16. E3 section 4.3.2 accepted duplicate rows from
// concurrent panel processes on the grounds that both consumers key by
// (projectKey, id) through a Set. Nothing pinned that ground until now.
const A = "github.com/biran/a";
const B = "github.com/biran/b";
const decision = (projectKey: string, id: string): DecisionObservation => ({
  projectKey,
  id,
  at: "2026-01-01T00:00:00.000Z",
  kind: "interface",
  scope: "repo",
  verdict: "ok",
});
const reviewed = (projectKey: string, decisionId: string, by = "amy"): ReviewRow => ({
  decisionId,
  projectKey,
  action: "reviewed",
  by,
  at: "2026-09-10T00:00:00.000Z",
});
const decisions = [decision(A, "orca-dev-1/1"), decision(B, "orca-dev-1/1")];

describe("panel coverage under duplicate review rows (reviews compaction spec C16)", () => {
  it("C16 duplicate reviewed rows change neither the coverage nor the to-do list", () => {
    const once = [reviewed(A, "orca-dev-1/1")];
    const thrice = [...once, reviewed(A, "orca-dev-1/1"), reviewed(A, "orca-dev-1/1", "bob")];
    expect(computePanelCoverage(decisions, thrice)).toEqual(computePanelCoverage(decisions, once));
    expect(unreviewedHighTier(decisions, thrice)).toEqual(unreviewedHighTier(decisions, once));
    expect(computePanelCoverage(decisions, thrice).reviewed_high_tier).toBe(1);
  });

  it("C16 must-catch: a reviewed row for the same id in ANOTHER repository does change them", () => {
    // Without this, a coverage function that ignored review rows entirely
    // would satisfy the equalities above.
    const both = [reviewed(A, "orca-dev-1/1"), reviewed(B, "orca-dev-1/1")];
    expect(computePanelCoverage(decisions, both).reviewed_high_tier).toBe(2);
    expect(unreviewedHighTier(decisions, both)).toEqual([]);
  });
});
