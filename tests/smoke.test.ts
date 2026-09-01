import { describe, expect, it } from "vitest";

describe("test harness", () => {
  it("actually runs the assertions in this file", () => {
    // The only reason this assertion exists: to prove vitest is really
    // running this file, not that the include glob missed it, ran 0 tests, and reported green.
    expect(1 + 1).toBe(2);
  });
});
