import { describe, expect, it } from "vitest";
import { recoverControl } from "../../src/control/recovery.js";
import { handoffRunIds, stepH } from "../../src/control/driverHandoff.js";
import { stepA1 } from "../../src/control/executionDriver.js";
import { groupStopState } from "../../src/control/stopIntent.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { estimateHarness } from "./fixtures/estimateHarness.js";

// Single-call estimate spec §6.5: an estimate run under a stop and across a restart. Task 0 item 2 first.
describe("Task 0 item 2: startup recovery with estimate runs (single-call estimate spec §8.1)", () => {
  it("leaves an in-flight estimate run to the driver: nothing blocked, dispatch open", async () => {
    const x = await estimateHarness(); try {
      const result = await recoverControl(x.h.store, {} as never, undefined, { driverOwnsWebRuns: true });
      expect(result.blockedRunIds).toEqual([]);
      expect(x.h.store.dispatchBlocked).toBe(false);
    } finally { await x.h.dispose(); }
  });

  it("leaves a finished estimate run alone too", async () => {
    const x = await estimateHarness(); try {
      await x.rounds(() => x.estimate().state === "ready");
      const result = await recoverControl(x.h.store, {} as never, undefined, { driverOwnsWebRuns: true });
      expect(result.blockedRunIds).toEqual([]);
      expect(x.h.store.dispatchBlocked).toBe(false);
    } finally { await x.h.dispose(); }
  });
});

describe("an estimate run under a stop (single-call estimate spec §6.5)", () => {
  it("H1: a running call is stopped, its estimate interrupted, its commitment returned, and the stop completes", async () => {
    const x = await estimateHarness({ stoppable: true, tokens: 40 }); try {
      const atImport = readControlGroup(x.h.store, "epoch", "g").ledger;
      await x.rounds(() => x.body().state === "accepted" && x.fake.calls.collect > 0);
      const stopped = await x.service.handoffStop(x.h.command("handoff-stop", {}));
      if ("error" in stopped || stopped.result.kind !== "handoff-stopped") throw new Error(JSON.stringify(stopped));
      const [requestId] = stopped.result.requestIds;
      const request = () => String(x.h.store.db.prepare("SELECT state FROM handoff_requests WHERE id=?").get(requestId)!.state);
      await x.rounds(() => request() === "settled-restartable");
      expect(x.estimate()).toMatchObject({ state: "interrupted", output: null });
      expect(x.active()).toBe(0);
      expect(groupStopState(x.h.store, "g")).toBe("handoff-complete");
      const after = readControlGroup(x.h.store, "epoch", "g").ledger;
      expect(after.committedRemaining.tokens).toBe(atImport.committedRemaining.tokens - 250_000);
      expect(after.used.tokens).toBe(40);
      expect(x.fake.calls.handoff).toBe(1);
    } finally { await x.h.dispose(); }
  });

  it("H2: a run that never started is restarted without touching any workspace", async () => {
    const x = await estimateHarness(); try {
      const atImport = readControlGroup(x.h.store, "epoch", "g").ledger;
      expect(stepA1(x.deps, x.runId)).toBe(true);
      const stopped = await x.service.handoffStop(x.h.command("handoff-stop", {}));
      if ("error" in stopped) throw new Error(JSON.stringify(stopped));
      expect(await stepH(x.deps, x.runId, { reconciling: new Map(), stopped: false })).toBe(true);
      expect(x.estimate().state).toBe("interrupted");
      // O3 review carry-forward (c): restartRun reaches terminaliseRun -- the run is inactive and its whole unused
      // commitment (nothing was spent) is back in the reserve.
      expect(x.body().state).toBe("settled-restartable");
      expect(x.active()).toBe(0);
      expect(readControlGroup(x.h.store, "epoch", "g").ledger.committedRemaining.tokens).toBe(atImport.committedRemaining.tokens - 250_000);
      expect(groupStopState(x.h.store, "g")).toBe("handoff-complete");
      expect(x.body().drive).toMatchObject({ workspacePath: null, cleanedUp: true, cleanupError: null });
      expect(x.fake.calls.accept).toHaveLength(0);
    } finally { await x.h.dispose(); }
  });

  it("H3: a stop that lands while C collects a finished call wins; the estimate is interrupted, not ready", async () => {
    let x!: Awaited<ReturnType<typeof estimateHarness>>;
    x = await estimateHarness({ duringCollect: async () => {
      const stopped = await x.service.handoffStop(x.h.command("handoff-stop", {}));
      if ("error" in stopped) throw new Error(JSON.stringify(stopped));
    } }); try {
      await x.rounds(() => ["interrupted", "ready", "failed"].includes(x.estimate().state));
      expect(x.estimate()).toMatchObject({ state: "interrupted", output: null, outputHash: null });
      expect(x.h.store.db.prepare("SELECT id FROM outbox WHERE id=?").get(`estimate-result:g:${x.h.estimateId}`)).toBeUndefined();
      expect(groupStopState(x.h.store, "g")).toBe("handoff-complete");
    } finally { await x.h.dispose(); }
  });

  it("H4: a blocked estimate run is still closed by a stop (it is visited only through its request)", async () => {
    const x = await estimateHarness({ tamper: "prompt" }); try {
      await x.rounds(() => x.body().state === "blocked");
      expect(handoffRunIds(x.h.store)).toEqual([]);
      const stopped = await x.service.handoffStop(x.h.command("handoff-stop", {}));
      if ("error" in stopped) throw new Error(JSON.stringify(stopped));
      expect(handoffRunIds(x.h.store)).toEqual([x.runId]);
      await x.rounds(() => x.estimate().state === "interrupted");
      expect(groupStopState(x.h.store, "g")).toBe("handoff-complete");
    } finally { await x.h.dispose(); }
  });
});
