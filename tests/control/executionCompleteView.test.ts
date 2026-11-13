import { describe, expect, it } from "vitest";
import { readDriverRun, saveDriverRun } from "../../src/control/executionDriver.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import type { FakeBehaviour } from "./fixtures/driverPort.js";

// Tester #263 (follow-up I): ccloop stops a run whose execute completed but whose budget ran out before verification as
// `exhausted`, and the driver keeps its execution-complete-before-verification capsule as the run's saved source. The run's
// view says so (`executionCompleteBeforeVerification`), from that stored source only: a plain exhausted run (no such
// source) and a failed run with another saved source carry nothing new. The real capsule path is in
// savedResultRecovery.paired.test.ts ("a real exhausted completion ...").
const REF = { artifactId: "art-capsule", hash: "a".repeat(64) };

async function blockedRun(behaviour: FakeBehaviour, savedSource?: { authorityKind: string; attempt: number }) {
  const t = await driverHarness([{ taskId: "a" }], { behaviour: () => behaviour });
  const runId = await t.claim();
  await t.until(t.driver(), () => t.body(runId).state === "blocked");
  if (savedSource !== undefined) {
    const run = readDriverRun(t.h.store, runId);
    (run as { savedSource?: unknown }).savedSource = { authorityKind: savedSource.authorityKind, source: REF, attempt: savedSource.attempt };
    saveDriverRun(t.h.store, run);
  }
  return { t, view: () => readControlGroup(t.h.store, "epoch", "g").runs.find((r) => r.runId === runId)! };
}

describe("an exhausted run whose execute completed is named in its view (#263)", { timeout: 90_000 }, () => {
  // mutation M-I2a: the view drops the field (condition never true) -> red
  it("carries the source kind and attempt when the saved source is the completed-before-verification capsule", async () => {
    const { t, view } = await blockedRun("exhausted", { authorityKind: "execution-complete-before-verification-v1", attempt: 2 }); try {
      expect(view().outcome).toBe("exhausted");
      expect(view().executionCompleteBeforeVerification).toEqual({ sourceKind: "execution-complete-before-verification-v1", attempt: 2 });
    } finally { await t.h.dispose(); }
  });

  // mutation M-I2c: the view ignores the source kind (any exhausted run) -> red
  it("carries nothing for a plain exhausted run", async () => {
    const { t, view } = await blockedRun("exhausted"); try {
      expect(view().outcome).toBe("exhausted");
      expect(view()).not.toHaveProperty("executionCompleteBeforeVerification");
    } finally { await t.h.dispose(); }
  });

  // mutation M-I2e: the view ignores the outcome (any run with that source) -> red
  it("carries nothing for a failed run, whatever its saved source", async () => {
    const { t, view } = await blockedRun("failed", { authorityKind: "execution-complete-before-verification-v1", attempt: 1 }); try {
      expect(view().outcome).toBe("failed");
      expect(view()).not.toHaveProperty("executionCompleteBeforeVerification");
    } finally { await t.h.dispose(); }
  });
});
