import { describe, expect, it } from "vitest";
import { majorOutsideHighTier } from "../../src/panel/coverage.js";
import type { DecisionObservation } from "../../src/metrics/types.js";
import type { ReviewRow } from "../../src/panel/reviewsStore.js";

/**
 * Tester #257 (spec 2026-11-11-tester-followup-e-design.md §10): the Unreviewed default stays "high tier and not
 * reviewed"; beside it the page says how many unreviewed MAJOR decisions sit outside the high tier, per project.
 */
const decision = (projectKey: string, id: string, over: Partial<DecisionObservation> = {}): DecisionObservation =>
  ({ projectKey, id, at: "2026-09-01T00:00:00.000Z", kind: "interface", scope: "file", verdict: "ok", importance: "major", ...over }) as DecisionObservation;
const review = (projectKey: string, decisionId: string, action: "reviewed" | "withdrawn", at: string): ReviewRow =>
  ({ projectKey, decisionId, action, at, by: "amy" }) as unknown as ReviewRow;

describe("majorOutsideHighTier (#257)", () => {
  it("counts unreviewed major decisions outside the high tier, by project, and nothing else", () => {
    const decisions = [
      decision("a", "1"), // counted
      decision("a", "2", { importance: "minor" }), // mutation: drop the importance test -> a: 3, red
      decision("a", "3", { scope: "repo" }), // high tier -- mutation: drop the tier test -> a: 3, red
      decision("a", "4"), // reviewed -- mutation: drop the review test -> a: 3, red
      decision("a", "5"), // reviewed, then withdrawn: counted again
      decision("b", "1", { kind: "implementation", scope: "repo" }), // low tier by kind: counted
    ];
    const reviews = [review("a", "4", "reviewed", "2026-09-02T00:00:00.000Z"), review("a", "5", "reviewed", "2026-09-02T00:00:00.000Z"), review("a", "5", "withdrawn", "2026-09-03T00:00:00.000Z")];
    expect(majorOutsideHighTier(decisions, reviews)).toStrictEqual({ a: 2, b: 1 });
  });
  it("names no project that has none", () => {
    expect(majorOutsideHighTier([decision("a", "1", { scope: "repo" })], [])).toStrictEqual({});
  });
});
