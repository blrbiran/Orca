import { describe, expect, it } from "vitest";
import { openTestStore } from "./fixtures/store.js";
import { webFixture } from "./fixtures/web.js";
import { driverHarness } from "./fixtures/driverHarness.js";

// Issue-fixes spec §5 (ruling H5): Orca's own wall-clock record. Every time it writes comes from the store's clock,
// which tests inject so a criterion can name the exact instant a row or a run time must carry.
describe("the control store's clock (issue-fixes spec §5.2)", () => {
  it("answers the injected clock, and Date.now when none is given", async () => {
    let clock = 1_234;
    const fixed = await openTestStore({ now: () => clock });
    const plain = await openTestStore();
    try {
      expect(fixed.store.now()).toBe(1_234);
      clock = 5_678;
      expect(fixed.store.now()).toBe(5_678);
      const before = Date.now();
      const read = plain.store.now();
      expect(read).toBeGreaterThanOrEqual(before);
      expect(read).toBeLessThanOrEqual(Date.now());
    } finally { await fixed.dispose(); await plain.dispose(); }
  });

  it("reaches the store through the Web fixture and the driver harness", async () => {
    const h = await webFixture(undefined, undefined, { storeNow: () => 42 });
    try { expect(h.store.now()).toBe(42); } finally { await h.dispose(); }
    const t = await driverHarness([{ taskId: "a" }], { storeNow: () => 7 });
    try { expect(t.h.store.now()).toBe(7); } finally { await t.h.dispose(); }
  });
});
