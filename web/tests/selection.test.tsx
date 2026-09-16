import { describe, expect, it } from "vitest";
import { acceptArrival } from "../src/selection.js";
import type { DecisionListRow } from "../src/types.js";

/**
 * The pure half of parked finding N-1's fix (ruling R71). `acceptArrival` is
 * the only thing between a finished `GET /api/decision` and the screen, so it
 * is the only place that can decide a late answer has been overtaken --
 * App.tsx's criteria (web/tests/appSelection.test.tsx) drive it through the
 * live component; these pin the predicate itself.
 */
const row = (projectKey: string, id: string): DecisionListRow => ({
  projectKey,
  id,
  at: "2026-09-16T00:00:00.000Z",
  kind: "interface",
  scope: "repo",
  verdict: "ok",
});

describe("acceptArrival (parked finding N-1, ruling R71)", () => {
  it("accepts the answer to the row that is still wanted", () => {
    const wanted = row("project-key", "run/1");
    // A separate object with the same identity: App re-renders, so the ref and
    // the effect's closure are not guaranteed to hold the same instance.
    expect(acceptArrival(wanted, row("project-key", "run/1"))).toBe(true);
  });

  it("drops the answer to a row the person has moved on from", () => {
    expect(acceptArrival(row("project-key", "run/1"), row("project-key", "run/2"))).toBe(false);
  });

  it("drops an answer that arrives after the person closed the detail entirely", () => {
    expect(acceptArrival(null, row("project-key", "run/1"))).toBe(false);
  });

  /**
   * The assertion that makes this predicate worth having rather than a pair of
   * string comparisons written inline. `projectKey` and `id` are both
   * unrestricted strings, so a fixed-separator join confuses these two rows
   * (review finding I-1 / ruling R60, and DecisionList.tsx's `rowKey`
   * comment). Confusing them here means showing one repository's decision
   * under another repository's row -- the cross-repository case that E2
   * already had to fix once in the ledger.
   */
  it("tells apart two rows that a fixed-separator join would call the same row", () => {
    expect(acceptArrival(row("a::b", "c"), row("a", "b::c"))).toBe(false);
    expect(acceptArrival(row("a", "b::c"), row("a::b", "c"))).toBe(false);
  });
});
