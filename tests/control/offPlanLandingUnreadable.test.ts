/**
 * Off-plan writes spec W3 (#346; final fix wave, Minor 1 of the final whole-branch review 2026-11-18): the off-plan record
 * is information only and never fails or blocks a landing. Past the swap it matters most: a driver that died after D's
 * compare-and-swap finds the landing on the tip (findLanding) and must still mark the run landed when the record cannot be
 * read -- the tip already holds the landing. Its own file, because the reader is replaced for the whole module; it reads
 * normally until the crash, then throws.
 */
import { describe, expect, it, vi } from "vitest";
import { DriverCrash, createExecutionDriver } from "../../src/control/executionDriver.js";
import { driverHarness } from "./fixtures/driverHarness.js";

const reader = vi.hoisted(() => ({ failing: false }));
vi.mock("../../src/control/offPlanWrites.js", async (original) => {
  const actual = await original<typeof import("../../src/control/offPlanWrites.js")>();
  return {
    ...actual,
    landingOffPlanWrite: vi.fn(async (...args: Parameters<typeof actual.landingOffPlanWrite>) => {
      if (reader.failing) throw new Error("frozen contract unreadable");
      return actual.landingOffPlanWrite(...args);
    }),
  };
});

describe("a landing found after a death past the swap whose off-plan record cannot be read", { timeout: 120_000 }, () => {
  it("is still marked landed, writes no row, and says why on stderr", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["a"] }], { files: () => ({ a: "a\n", "notes.md": "n\n" }) });
    const stderr = vi.spyOn(process.stderr, "write");
    try {
      const runId = await t.claim();
      const crashing = createExecutionDriver({ ...t.deps, crash: (point) => { if (point === "D-after-cas") throw new DriverCrash(point); } });
      await t.until(crashing, () => crashing.crashed === "D-after-cas");
      await crashing.stop();
      expect(t.body(runId).state).toBe("collected");
      reader.failing = true;
      // mutation: stepD's findLanding branch calls landingOffPlanWrite unguarded -> the round throws, the run stays collected, red
      await t.until(t.driver(), () => ["landed", "settled"].includes(t.body(runId).state));
      expect(t.h.store.db.prepare("SELECT 1 FROM activity WHERE group_id='g' AND kind='off-plan-write'").all()).toEqual([]);
      expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain("frozen contract unreadable");
    } finally { reader.failing = false; stderr.mockRestore(); await t.h.dispose(); }
  });
});
