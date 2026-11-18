/**
 * Off-plan writes #346, W4, plan Task 5 fix round 1 (controller ruling, Orca session 4389b15f, 2026-11-18): a stop on a
 * parallel sibling's frozen claim is classified once, when the driver records the block, and kept on the drive record as
 * `drive.parallelClaim` -- absent when the stop is on no sibling's claim. Two block sites are driven here through the
 * synthetic ccloop: ccloop's `blocked_waiting_human` terminal with `denylist match: <path>`, and Orca's own harvest bound
 * at collect (`out-of-bounds:<paths>`). The stored claim is what the diagnosis reads, so it outlives a later change to the
 * task's frozen entry (Task 6's `--after` drops that sibling).
 */
import { describe, expect, it } from "vitest";
import { readRunDiagnosis } from "../../src/panel/runDiagnosis.js";
import { driverHarness, type HarnessOptions } from "./fixtures/driverHarness.js";

const CLAIM = { path: "b", repoKey: null, siblingIds: ["b"] };

/** a and b run in parallel: b's claim `b` is frozen into a's denylist; `.env` is a's own protected path. */
async function blockedRun(options: HarnessOptions) {
  const t = await driverHarness([{ taskId: "a", safetyPolicy: { denylistPaths: [".env"] } }, { taskId: "b" }], options);
  const runId = await t.claim();
  if (t.body(runId).taskId !== "a") throw new Error(`claimed ${t.body(runId).taskId}, not a`);
  await t.until(t.driver(), () => t.body(runId).state === "blocked");
  return { t, runId };
}
const denylistStop = (path: string): HarnessOptions => ({
  behaviour: (id) => id === "a" ? "blocked-waiting-human" : "succeed", stopReason: (id) => id === "a" ? `denylist match: ${path}` : null,
});

describe("the driver stores a parallel claim where it records the block", { timeout: 60_000 }, () => {
  it("ccloop's denylist stop on b's claim: stored, and still read after a's frozen entry no longer names b", async () => {
    const { t, runId } = await blockedRun(denylistStop("b"));
    let body: any;
    try {
      body = t.body(runId);
      expect(body.drive).toMatchObject({ blockedAt: "C", blockedReason: "terminal:blocked_waiting_human", stopReason: "denylist match: b" });
      // mutation: the terminal block site does not classify -> no parallelClaim, red
      expect(body.drive.parallelClaim).toEqual(CLAIM);
      expect(readRunDiagnosis(t.h.store, body)).toMatchObject({ cause: "parallel-claim", siblings: ["b"] });
    } finally { await t.h.dispose(); }
    // The same group and task with no frozen sibling -- what Task 6's `--after b` leaves of a's entry. The run's own record
    // still says why it stopped.
    // mutation: the view classifies against the task's current confirmed execution (first round) -> unknown, red
    const after = await driverHarness([{ taskId: "a" }]); try {
      expect(readRunDiagnosis(after.h.store, body)).toMatchObject({ cause: "parallel-claim", siblings: ["b"] });
    } finally { await after.h.dispose(); }
  });

  it("ccloop's denylist stop on a protected path only: nothing stored", async () => {
    const { t, runId } = await blockedRun(denylistStop(".env")); try {
      expect(t.body(runId).drive.stopReason).toBe("denylist match: .env");
      // mutation: a stop on no sibling's claim stores a claim anyway -> present, red
      expect(Object.hasOwn(t.body(runId).drive, "parallelClaim")).toBe(false);
      expect(readRunDiagnosis(t.h.store, t.body(runId)).cause).toBe("unknown");
    } finally { await t.h.dispose(); }
  });

  it("Orca's out-of-bounds block at collect on b's claim: stored", async () => {
    // The synthetic ccloop enforces no denylist, so a's write into `b` reaches Orca's own bound (Task 4b).
    const { t, runId } = await blockedRun({ files: (id): Record<string, string> => id === "a" ? { a: "a\n", b: "from a\n" } : { b: "b\n" } }); try {
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "C", blockedReason: "out-of-bounds:b" });
      // mutation: the out-of-bounds block site does not classify -> no parallelClaim, red
      expect(t.body(runId).drive.parallelClaim).toEqual(CLAIM);
    } finally { await t.h.dispose(); }
  });
});
