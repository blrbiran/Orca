import { describe, expect, it, vi } from "vitest";
import { readStopIntent } from "../../src/control/stopIntent.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { requestBody, requestState, stop } from "./fixtures/handoffHarness.js";

// Task 4 fix round 1 (review finding 2): `archiveRun`'s type allows a null snapshot, though `captureSnapshot` today
// always returns one or throws. H-settle's `snapshot-missing` condition is for that case: a checkpoint without the
// repository's snapshot is one a continuation cannot rebuild the work from. The archive is replaced (in this file
// only) by one that drops its snapshot.
vi.mock("../../src/control/archive.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/control/archive.js")>();
  return { ...real, archiveRun: async (...args: Parameters<typeof real.archiveRun>) => ({ ...(await real.archiveRun(...args)), snapshot: null }) };
});

describe("a stop whose archive produced no snapshot (Web spec §6.2)", { timeout: 60_000 }, () => {
  it("settles the request unrecoverable, naming snapshot-missing", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "stoppable" }); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "accepted");
      const [requestId] = await stop(t);
      await t.until(driver, () => !["request-pending", "collecting"].includes(requestState(t, requestId!)));
      expect(requestBody(t, requestId!)).toMatchObject({ state: "settled-unrecoverable", failureCode: "snapshot-missing" });
      expect(t.body(runId)).toMatchObject({ state: "settled-unrecoverable", recoverable: false });
      expect(readStopIntent(t.h.store, "g")!.state).toBe("handoff-partial");
    } finally { await t.h.dispose(); }
  });
});
