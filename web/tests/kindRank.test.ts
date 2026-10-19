import { describe, expect, it } from "vitest";
import { KIND_RANK, kindLabel, sortKinds } from "../src/kindRank.js";

/**
 * Human ruling (session f8281a60, 2026-09-27): every kind is high-tier (src/metrics/highTier.ts), so
 * "importance" is a finer, UI-only order by how hard a wrong call is to undo -- three levels:
 * 🔴 reconcile, abandon; 🟠 interface, dependency, boundary; 🟡 criteria, scheduling.
 */
describe("kind importance (human ruling, session f8281a60)", () => {
  it("orders the kinds most-to-least important, with a value it does not know last", () => {
    const shuffled = ["scheduling", "boundary", "zzz-unknown", "reconcile", "criteria", "interface", "abandon", "dependency"];
    expect(sortKinds(shuffled)).toEqual([
      "reconcile", "abandon", "interface", "dependency", "boundary", "criteria", "scheduling", "zzz-unknown",
    ]);
  });

  // Rewritten under the session grant (human, session 3831d12f, 2026-10-20: 「这次批准改写所有必要的判据」):
  // reported-decisions spec §6 adds the kind `implementation` at { order: 7, level: 3 }; the seven ruled levels are unchanged.
  it("puts each kind in the level the human ruled, and marks it with that level's colour", () => {
    expect(Object.fromEntries(Object.entries(KIND_RANK).map(([k, r]) => [k, r.level]))).toEqual({
      reconcile: 1, abandon: 1, interface: 2, dependency: 2, boundary: 2, criteria: 3, scheduling: 3, implementation: 3,
    });
    expect(sortKinds(["implementation", "scheduling"])).toEqual(["scheduling", "implementation"]);
    expect(kindLabel("reconcile")).toBe("🔴 reconcile");
    expect(kindLabel("boundary")).toBe("🟠 boundary");
    expect(kindLabel("scheduling")).toBe("🟡 scheduling");
    expect(kindLabel("zzz-unknown")).toBe("zzz-unknown");
  });
});
