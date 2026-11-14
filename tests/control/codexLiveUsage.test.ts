import { describe, expect, it } from "vitest";
import { collectInto } from "../../src/control/executionDriver.js";
import type { ExecutionPort, ExecutionReport } from "../../src/control/executionPort.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";

/** ccloop's provisional Codex response watermark, not a usage event. */
const reading = (runId: string, revision = 1, tokens = 125): NonNullable<ExecutionReport["liveUsage"]> => ({
  schema: "ccloop-live-usage-v1", runId, attempt: 1, phase: "execute", callId: "call-1",
  threadId: "01a1da57-817e-7450-907a-f3a3f0371154", tokens, observedAt: new Date().toISOString(), revision,
});

async function inFlight() {
  let observation: ExecutionReport["liveUsage"];
  const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "stoppable-silent", wrapPort: (port: ExecutionPort) => ({
    ...port,
    collect: async (input, afterSeq) => ({ ...await port.collect(input, afterSeq), ...(observation === undefined ? {} : { liveUsage: observation }) }),
  }) });
  const runId = await t.claim();
  const driver = t.driver();
  await t.until(driver, () => t.body(runId).state === "accepted");
  return { t, driver, runId, set: (value: ExecutionReport["liveUsage"]) => { observation = value; } };
}

describe("Codex's running response usage (#285)", () => {
  it("stores a matching reading without booking it as work or changing the group budget", async () => {
    const { t, driver, runId, set } = await inFlight(); try {
      const budget = readControlGroup(t.h.store, "epoch", "g").ledger.used.tokens;
      set(reading(runId));
      await driver.round();
      expect(t.body(runId).liveUsage).toMatchObject({ runId, phase: "execute", tokens: 125, revision: 1 });
      // The view carries it as provisional while the run is under way; the booked figure is untouched.
      expect(readControlGroup(t.h.store, "epoch", "g").runs.find((run) => run.runId === runId)?.liveUsage)
        .toMatchObject({ phase: "execute", tokens: 125, attempt: 1, revision: 1 });
      expect(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM usage_events WHERE run_id=?").get(runId)).toEqual({ n: 0 });
      expect(readControlGroup(t.h.store, "epoch", "g").ledger.used.tokens).toBe(budget);
      set(undefined);
      await driver.round();
      expect(t.body(runId)).not.toHaveProperty("liveUsage");
    } finally { await t.h.dispose(); }
  });

  it("keeps a newer watermark when an older collect answer arrives for the same call", async () => {
    const { t, driver, runId, set } = await inFlight(); try {
      set(reading(runId, 2, 300));
      await driver.round();
      set(reading(runId, 1, 125));
      await driver.round();
      expect(t.body(runId).liveUsage).toMatchObject({ revision: 2, tokens: 300 });
    } finally { await t.h.dispose(); }
  });

  it("rejects another run's reading before retaining it", async () => {
    const { t, runId, set } = await inFlight(); try {
      set(reading("run-foreign"));
      await expect(collectInto(t.deps, t.body(runId))).rejects.toMatchObject({ code: "report-identity-conflict" });
      expect(t.body(runId)).not.toHaveProperty("liveUsage");
    } finally { await t.h.dispose(); }
  });
});
