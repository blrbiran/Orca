import { describe, expect, it } from "vitest";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";

describe("a human-blocked run keeps ccloop's observed path evidence", { timeout: 60_000 }, () => {
  const misses = [{ repoKey: null, path: "test/new.test.js" }];

  it("persists the exact list and exposes it in the run JSON view", async () => {
    const t = await driverHarness([{ taskId: "a" }], {
      behaviour: () => "blocked-waiting-human", stopReason: () => "allowlist miss: test/new.test.js",
      pathPolicyMisses: () => misses,
    });
    try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(t.body(runId).drive.pathPolicyMisses).toEqual(misses);
      expect(readControlGroup(t.h.store, "epoch", "g").runs.find((run) => run.runId === runId)?.pathPolicyMisses).toEqual(misses);
    } finally { await t.h.dispose(); }
  });

  it("leaves the field absent when an older ccloop reports only the human stop reason", async () => {
    const t = await driverHarness([{ taskId: "a" }], {
      behaviour: () => "blocked-waiting-human", stopReason: () => "allowlist miss: test/new.test.js",
    });
    try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(Object.hasOwn(t.body(runId).drive, "pathPolicyMisses")).toBe(false);
      expect(readControlGroup(t.h.store, "epoch", "g").runs.find((run) => run.runId === runId)?.pathPolicyMisses).toBeUndefined();
    } finally { await t.h.dispose(); }
  });
});
