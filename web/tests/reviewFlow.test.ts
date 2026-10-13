import { describe, expect, it } from "vitest";
import { nextAfterReview } from "../src/reviewFlow.js";
import type { DecisionListRow } from "../src/types.js";

const row = (id: string): DecisionListRow => ({ projectKey: "p", id, at: "2026-10-01T00:00:00.000Z", kind: "interface", scope: "repo", verdict: "ok", question: id }) as DecisionListRow;
const [a, b, c] = [row("a"), row("b"), row("c")];

/** Taste refinement P1-3: after a review lands, the person is taken to the next row -- never away from one that stayed. */
describe("nextAfterReview", () => {
  it("moves to the row that followed the reviewed one", () => {
    expect(nextAfterReview([a, b, c], b, [a, c])?.id).toBe("c");
  });
  it("moves back when the reviewed row was last", () => {
    expect(nextAfterReview([a, b, c], c, [a, b])?.id).toBe("b");
  });
  it("skips rows that also left the list", () => {
    expect(nextAfterReview([a, b, c], a, [c])?.id).toBe("c");
  });
  it("stays (null) while the reviewed row is still listed -- a refresh that failed, or a single row (Review Focus 3)", () => {
    expect(nextAfterReview([a, b], a, [a, b])).toBeNull();
  });
  it("stays (null) when nothing is left", () => {
    expect(nextAfterReview([a], a, [])).toBeNull();
  });
  it("matches rows by project and id, so a same-id row in another project is not the reviewed one", () => {
    const other = { ...a, projectKey: "q" } as DecisionListRow;
    expect(nextAfterReview([a, other], a, [other])?.projectKey).toBe("q");
  });
});
