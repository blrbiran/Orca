import { describe, expect, it } from "vitest";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";

/**
 * Tester #512: the run view's `state` is the first line a person reads (`orca run show`, the card). A normally settled
 * run used to borrow `settled-recoverable` from its recoverable checkpoint, the same string a handoff/ceiling stop shows,
 * so 8 succeeded runs and the one stuck run in a group were indistinguishable. The persisted row stays `settled`; only
 * the projection changed (controlViews.ts displayRunState).
 */
describe("run view state (#512)", { timeout: 60_000 }, () => {
  it("a run the driver settled normally displays as settled-succeeded", async () => {
    const t = await driverHarness([{ taskId: "a" }]);
    try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "settled" && t.body(runId).drive?.cleanedUp === true);
      expect(t.body(runId)).toMatchObject({ state: "settled", recoverable: true });
      // mutation: project `settled` as recoverable ? settled-recoverable : settled-unrecoverable -> red
      expect(readControlGroup(t.h.store, "epoch-test", "g").runs.find((entry) => entry.runId === runId)!.state).toBe("settled-succeeded");
    } finally { await t.h.dispose(); }
  });
});