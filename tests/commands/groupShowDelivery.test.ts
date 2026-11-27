import { describe, expect, it } from "vitest";
import { acceptanceLines, deliveryLines } from "../../src/commands/domains/verbs.js";

it("names a failed test-change scan without presenting it as a flaky test (#565)", () => {
  const failed = { tip: "a".repeat(40), result: "failed", commands: [], testChanges: {
    paths: [], weakeningSignals: [], digest: "", error: "test-change-scan-failed: base revision is missing",
  } };
  for (const lines of [
    acceptanceLines("g1", failed),
    deliveryLines("g1", { ...failed, commit: "b".repeat(40) }, undefined),
  ]) {
    const text = lines.join("\n");
    expect(text).toContain("test-change-scan-failed: base revision is missing");
    expect(text).toContain("orca doctor");
    expect(text).not.toMatch(/flaky|exited \?/);
  }
});

// Delivery tail spec D3/D5 (#333, #336): `group show` says a delivery backing off (when, why, what tries now) and the
// acceptance on the delivered commit, with what answers a red one.
describe("group show's delivery lines", () => {
  it("names a backoff with the next retry, the failure and the integrate command", () => {
    // mutation: drop the backoff line -> [], red
    expect(deliveryLines("g1", undefined, { retryAfter: Date.UTC(2026, 10, 17, 4, 0, 0), transient: 2, transientReason: "ssh timed out" }))
      .toEqual(["integration: retrying after 2026-11-17T04:00:00.000Z (failure 2 in a row: ssh timed out); orca group integrate g1 tries at the next round"]);
    expect(deliveryLines("g1", undefined, {})).toEqual([]);
  });

  it("says a delivered acceptance's result, and a red one's problem with recheck and waive", () => {
    const red = { tip: "a".repeat(40), commit: "b".repeat(40), result: "failed", commands: [{ command: "npm test", exit: "1", ms: 9 }], tail: "x\nnot ok 3", problem: "delivered-acceptance-failed:npm test" };
    // mutation: drop the failed branch's next lines -> no recheck/waive, red
    expect(deliveryLines("g1", red, undefined)).toEqual([
      `problem: delivered-acceptance-failed:npm test on bbbbbbbbbbbb (delivered tip aaaaaaaaaaaa)`, "  x | not ok 3",
      "next: orca group recheck-acceptance g1   (a flaky check)", "  or: orca group waive-acceptance g1 --note '<why the delivered tree is accepted>'",
    ]);
    expect(deliveryLines("g1", { ...red, result: "not-needed", why: "same-tree", commands: [] }, undefined)).toEqual(["delivered acceptance: not needed (same-tree)"]);
    expect(deliveryLines("g1", { ...red, result: "passed" }, undefined)).toEqual(["delivered acceptance: passed on bbbbbbbbbbbb (delivered tip aaaaaaaaaaaa)"]);
  });
});
