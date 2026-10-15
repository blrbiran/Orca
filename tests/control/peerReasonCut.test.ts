import { describe, expect, it } from "vitest";
import { ControlError } from "../../src/control/errors.js";
import { describeError } from "../../src/control/executionDriver.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { profileSnapshot } from "./fixtures/web.js";

// ccloop error codes spec (2026-10-15) §4.4, criterion 5: a blocked run's reason used to keep ccloop's whole stderr (up to
// 24 MiB) and the panel showed it raw. It is stored as `<exit>:<code>: <detail>` with the detail cut to 512 units.
describe("stored peer-exit reasons are cut (spec A §4.4)", () => {
  it("describeError stores the cut form", () => {
    expect([
      describeError(new ControlError("control-peer-exit", `2:agent-config-invalid: ${"x".repeat(2048)}`)),
      describeError(new ControlError("control-peer-exit", "2:control-config-hash-mismatch")),
      describeError(new ControlError("control-peer-exit")),
      describeError(new ControlError("control-peer-timeout")),
    ]).toEqual([`control-peer-exit:2:agent-config-invalid: ${"x".repeat(511)}…`, "control-peer-exit:2:control-config-hash-mismatch", "control-peer-exit", "control-peer-timeout"]);
  });

  it("an accept refusal with a 2 KiB stderr is stored in its cut form", async () => {
    const t = await driverHarness([{ taskId: "a" }]);
    try {
      (t.fake.port as unknown as Record<string, unknown>).accept = async () => { throw new ControlError("control-peer-exit", `2:agent-config-invalid: ${"y".repeat(2048)}`); };
      t.deps.router = createExecutionProfileRouter([resolveProfile(profileSnapshot(), t.fake.port)]);
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "B", blockedReason: `accept-refused:2:agent-config-invalid: ${"y".repeat(511)}…` });
    } finally { await t.h.dispose(); }
  }, 30_000);
});
