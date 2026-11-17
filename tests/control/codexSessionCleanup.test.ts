import { describe, expect, it } from "vitest";
import type { ExecutionPort, ExecutionReport } from "../../src/control/executionPort.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";

// Tester #349 (human's ruling, session 4389b15f, 2026-11-18): ccloop lists the run's Codex sessions it could not delete; Orca
// keeps the latest list on the run as a standing notice (the run view shows it, also after the run settles), and drops it
// when ccloop stops listing it (the sweep or a person deleted the session).
const entry = { threadId: "01a1e8f9-d197-7e41-83ee-d32888151bda", home: "/c/codex-home", state: "failed" as const, detail: "exit 1: Error: failed to delete session" };

async function inFlight() {
  let listed: ExecutionReport["sessionCleanup"];
  const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "stoppable-silent", wrapPort: (port: ExecutionPort) => ({
    ...port,
    collect: async (input, afterSeq) => ({ ...await port.collect(input, afterSeq), ...(listed === undefined ? {} : { sessionCleanup: listed }) }),
  }) });
  const runId = await t.claim();
  const driver = t.driver();
  await t.until(driver, () => t.body(runId).state === "accepted");
  return { t, driver, runId, set: (value: ExecutionReport["sessionCleanup"]) => { listed = value; } };
}

describe("a Codex session ccloop could not delete (#349)", () => {
  it("is kept on the run and carried by the run view, and dropped once ccloop no longer lists it", async () => {
    const { t, driver, runId, set } = await inFlight(); try {
      set([entry]);
      await driver.round();
      // mutation: the driver ignores report.sessionCleanup -> undefined -> red
      expect(t.body(runId).sessionCleanup).toEqual([entry]);
      // mutation: the view projection leaves it out -> undefined -> red
      expect(readControlGroup(t.h.store, "epoch", "g").runs.find((run) => run.runId === runId)?.sessionCleanup).toEqual([entry]);
      set(undefined);
      await driver.round();
      // mutation: never cleared -> still present -> red
      expect(t.body(runId)).not.toHaveProperty("sessionCleanup");
    } finally { await t.h.dispose(); }
  });
});
