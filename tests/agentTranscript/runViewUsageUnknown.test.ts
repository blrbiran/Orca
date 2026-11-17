/**
 * Tester #321 part C (review ruling 2026-11-18): unknown usage is not 0. A run's stored `unknown[bucket]` says its usage
 * is not known; the group view marks such a run `usageUnknown`, so the cost notice leaves it out of medians and says its
 * tokens are unknown instead of "0 tokens". A run whose usage is known carries no mark.
 */
import { describe, expect, it } from "vitest";
import { readDriverRun } from "../../src/control/executionDriver.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness } from "../control/fixtures/driverHarness.js";

describe("the run view's usageUnknown (#321 C)", () => {
  it("is true while the run's stored usage is unknown, and absent while it is known", async () => {
    const t = await driverHarness([{ taskId: "a" }]);
    try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "accepted");
      const groupId = readDriverRun(t.h.store, runId).groupId;
      const shown = () => readControlGroup(t.h.store, "epoch", groupId).runs.find((run) => run.runId === runId)!;
      // The harness's fake books usage at accept, so the flag is set here as the store holds it before any usage event.
      const setUnknown = (unknown: boolean) => t.h.store.db.prepare("UPDATE runs SET body=json_set(body,'$.unknown.work',json(?)) WHERE id=?").run(String(unknown), runId);
      setUnknown(true);
      // mutation: drop the usageUnknown spread from the run view -> red
      expect(shown().usageUnknown).toBe(true);
      setUnknown(false);
      // mutation: emit usageUnknown whatever run.unknown says -> red
      expect(shown()).not.toHaveProperty("usageUnknown");
    } finally { await t.h.dispose(); }
  });
});
