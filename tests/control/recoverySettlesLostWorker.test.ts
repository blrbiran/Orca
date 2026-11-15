import { describe, expect, it } from "vitest";
import { readGroupActivity } from "../../src/control/activity.js";
import { ControlError } from "../../src/control/errors.js";
import { blockRun } from "../../src/control/executionDriver.js";
import { readControlRecovery } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";

// #267/#273: a driver run blocked at C with outcome=null used to be resumed and re-blocked forever. recovery retry --run
// now asks ccloop to settle the run first when ccloop can prove its worker dead; an alive worker keeps the old resume.
const rows = (t: Awaited<ReturnType<typeof driverHarness>>, kind: string) => readGroupActivity(t.h.store, "g", 100).filter((row) => row.kind === kind);

async function blockedAtC(settle: () => Promise<unknown>) {
  const t = await driverHarness([{ taskId: "a" }], { wrapPort: (port) => ({ ...port, settleLostWorker: settle } as unknown as typeof port) });
  // Production builds the panel service and the driver on one router (controlAssembly.ts); the fixture wraps the port
  // after the service exists, so point the service at the same router for this criterion.
  (t.service as unknown as { deps: { profileRouter: unknown } }).deps.profileRouter = t.deps.router;
  const runId = await t.claim();
  await t.until(t.driver(), () => t.body(runId).state === "accepted");
  blockRun(t.deps, runId, "C", "control-peer-timeout");
  return { t, runId };
}

describe("recovery retry settles a provably lost worker (#267 #273)", () => {
  it("asks ccloop before resuming, and records the settlement", async () => {
    let settled = 0;
    const { t, runId } = await blockedAtC(async () => { settled += 1; });
    try {
      const result = await t.service.recoveryRetry(t.h.runCommand("recovery-retry", runId, { scope: "run", runId }));
      expect("error" in result ? result.error : result.result).toMatchObject({ kind: "recovery-observed", resolved: true });
      // mutation: skip settleLostWorkerBeforeRetry -> settled is 0.
      expect(settled).toBe(1);
      expect(t.body(runId).state).toBe("accepted");
      expect(rows(t, "worker-lost").map((row) => row.body)).toEqual([{ reason: "settled before recovery retry" }]);
    } finally { await t.h.dispose(); }
  });

  it("keeps the old resume when ccloop says the worker is not lost", async () => {
    let settled = 0;
    const { t, runId } = await blockedAtC(async () => { settled += 1; throw new ControlError("control-peer-exit", "2:control-worker-not-lost: owner alive"); });
    try {
      const result = await t.service.recoveryRetry(t.h.runCommand("recovery-retry", runId, { scope: "run", runId }));
      expect("error" in result ? result.error : result.result).toMatchObject({ kind: "recovery-observed", resolved: true });
      expect(settled).toBe(1);
      expect(t.body(runId).state).toBe("accepted");
      expect(rows(t, "worker-lost")).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  it("the next collect consumes the terminal ccloop settled", async () => {
    let behaviour: "succeed" | "failed" = "succeed";
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => behaviour, wrapPort: (port) => ({ ...port, settleLostWorker: async () => ({ candidate: null }) } as unknown as typeof port) });
    (t.service as unknown as { deps: { profileRouter: unknown } }).deps.profileRouter = t.deps.router;
    const runId = await t.claim();
    await t.until(t.driver(), () => t.body(runId).state === "accepted");
    blockRun(t.deps, runId, "C", "control-peer-timeout");
    const result = await t.service.recoveryRetry(t.h.runCommand("recovery-retry", runId, { scope: "run", runId }));
    expect("error" in result ? result.error : result.result).toMatchObject({ resolved: true });
    // ccloop wrote the lost worker's terminal; the resumed run's next collect reaches it, so the run leaves the
    // blocked+outcome-null half-state and recovery list can name its next command.
    behaviour = "failed";
    await t.until(t.driver(), () => t.body(runId).drive?.outcome === "failed", 200);
    expect(t.body(runId).state).toBe("blocked");
    expect(readControlRecovery(t.h.store, "epoch").terminalRuns).toEqual([
      expect.objectContaining({ runId, outcome: "failed", next: "close-run" }),
    ]);
  });

  it("surfaces a settlement failure instead of reporting a resolution", async () => {
    const { t, runId } = await blockedAtC(async () => { throw new ControlError("control-peer-exit", "2:codex-exit-error: ccloop did not answer"); });
    try {
      // mutation: catch every error and resume -> the command reports resolved:true and the assertion below fails.
      await expect(t.service.recoveryRetry(t.h.runCommand("recovery-retry", runId, { scope: "run", runId })))
        .rejects.toMatchObject({ code: "control-peer-exit" });
      expect(t.body(runId).state).toBe("blocked");
    } finally { await t.h.dispose(); }
  });
});
