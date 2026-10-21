import { describe, expect, it } from "vitest";
import { driverHarness } from "./fixtures/driverHarness.js";

/**
 * Failure-cause spec 2026-10-21 §3 and ccloop priorFailures spec 2026-10-21 §3: when a run blocks at C on a terminal other
 * than `succeeded`, the drive record keeps ccloop's run-level cause (for the next-step line) and the terminal's last
 * rejection (for a later re-dispatch that carries it), beside `stopReason`. Both are absent when ccloop stated none.
 */
const CAUSE = { cause: "required-check-failed", phase: "verify" as const, retries: 0, detail: null };
const LAST = { rejectCategory: "required-check-failed", failingCommand: "node check.js" };

describe("the failure a blocked run keeps (failure-cause spec §3)", () => {
  it("stores the cause and the last rejection on the drive record of a run blocked at C", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed", failure: () => ({ failureCause: CAUSE, lastFailure: LAST }) }); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "blocked");
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "C", blockedReason: "terminal:failed", outcome: "failed", failureCause: CAUSE, lastFailure: LAST });
    } finally { await t.h.dispose(); }
  });

  it("stores neither when ccloop stated none", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "exhausted" }); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "blocked");
      const drive = t.body(runId).drive;
      expect([drive.outcome, "failureCause" in drive, "lastFailure" in drive]).toEqual(["exhausted", false, false]);
    } finally { await t.h.dispose(); }
  });
});
