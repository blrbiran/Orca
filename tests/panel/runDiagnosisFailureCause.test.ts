import { describe, expect, it } from "vitest";
import { runViewSchema } from "../../src/control/webProtocol.js";
import { readRunDiagnosis } from "../../src/panel/runDiagnosis.js";
import { openTestStore } from "../control/fixtures/store.js";

// Issue #131 (session 3cfc2e73): ccloop reports a setup failure as failureCause {cause: "setup-failed", phase: "setup",
// detail}, but the diagnosis read only the progress step and a decode capsule, so it said "phase work, cause unknown"
// and a person (or `orca run show`) had to dig for why. The diagnosis now carries ccloop's cause, phase and detail.
const run = { groupId: "g", workItemId: "w", taskId: "t", runId: "run-1", generation: 1, graphVersion: 1, targetVersion: 1, executionId: "exec-1",
  providerAttemptOrdinal: 1, phase: "work" as const, progress: { status: "planning" as const }, failureCode: null };
const setup = { cause: "setup-failed", phase: "setup" as const, retries: 0, detail: "npm ci exit=1" };

describe("the run diagnosis names ccloop's failure cause (#131)", () => {
  it("a setup failure's cause, phase and detail are in the diagnosis, and the run view's schema accepts it", async () => {
    const h = await openTestStore();
    try {
      const diagnosis = readRunDiagnosis(h.store, { ...run, drive: { envelopeHash: null, failureCause: setup } });
      expect(diagnosis.failureCause).toEqual({ cause: "setup-failed", phase: "setup", detail: "npm ci exit=1" });
      const shape = (runViewSchema as unknown as { shape: { diagnosis: { safeParse(v: unknown): { success: boolean } } } }).shape.diagnosis;
      expect(shape.safeParse(diagnosis).success).toBe(true);
    } finally { await h.dispose(); }
  });

  it("control: with no stated cause the diagnosis has no failureCause key (its bytes are as before)", async () => {
    const h = await openTestStore();
    try {
      expect(readRunDiagnosis(h.store, { ...run, drive: { envelopeHash: null, failureCause: null } })).toEqual({ phase: "work", step: "planning", cause: "unknown", attempt: 1 });
      expect(Object.hasOwn(readRunDiagnosis(h.store, run), "failureCause")).toBe(false);
    } finally { await h.dispose(); }
  });
});
