import { describe, expect, it } from "vitest";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { readArchivedPlan } from "../../src/control/queries.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { estimateHarness, estimateOutput } from "./fixtures/estimateHarness.js";

// Estimate usable-answer spec §4.2: repair runs in the settlement, before the classifier, so an answer whose only
// defects are mechanical settles `ready` instead of costing the person a paid call for nothing. Every estimate the
// settlement completes records what repair changed (`[]` when nothing); the raw answer stays on record as before.
const settle = async (output: (planHash: string) => unknown, extra: Parameters<typeof estimateHarness>[0] = {}) => {
  const x = await estimateHarness({ output, ...extra });
  await x.rounds(() => x.estimate().state !== "running");
  return x;
};

describe("repair in the estimate settlement (estimate usable-answer spec §4.2)", () => {
  it("settles the evidence answer (task a twice, the second a placeholder) ready with the first entry", async () => {
    // The shape a real paid call returned: the real entry first, then the same task again as a placeholder.
    const evidence = (planHash: string) => {
      const good = estimateOutput(planHash);
      return { ...good, tasks: [good.tasks[0], { ...good.tasks[0], rationale: "placeholder", assumptions: ["placeholder"] }] };
    };
    const x = await settle(evidence); try {
      const planHash = readArchivedPlan(x.h.store, "g").planHash;
      expect(x.estimate()).toMatchObject({ state: "ready", reasonCode: null, repairs: ["duplicate-task-dropped:a"],
        output: estimateOutput(planHash), outputHash: sha256Canonical(estimateOutput(planHash)) });
      // The raw answer, not the repaired one, is what the receipt names and what stays on record.
      expect(readCanonicalRecord(x.h.store, sha256Canonical(evidence(planHash)))).toBe(canonicalBytes(evidence(planHash)).toString("utf8"));
      // Usage is booked as for any estimate: repair is not a call.
      expect(readControlGroup(x.h.store, "epoch", "g").ledger.used.tokens).toBe(777);
      expect(x.body().state).toBe("settled-restartable");
    } finally { await x.h.dispose(); }
  });

  it("records an empty repair list on a valid answer", async () => {
    const x = await settle(estimateOutput); try {
      expect(x.estimate()).toMatchObject({ state: "ready", reasonCode: null, repairs: [] });
    } finally { await x.h.dispose(); }
  });

  it("settles an answer for another plan hash ready, with the hash copied", async () => {
    const x = await settle(() => estimateOutput("f".repeat(64))); try {
      const planHash = readArchivedPlan(x.h.store, "g").planHash;
      expect(x.estimate()).toMatchObject({ state: "ready", repairs: ["plan-hash-copied"], output: estimateOutput(planHash) });
    } finally { await x.h.dispose(); }
  });

  it("fails an answer missing the plan's task as invalid (repair failed; it never reaches the plan-mismatch check), keeping the raw answer", async () => {
    const missing = (planHash: string) => ({ ...estimateOutput(planHash), tasks: [{ ...estimateOutput(planHash).tasks[0], taskId: "b" }] });
    const x = await settle(missing); try {
      const planHash = readArchivedPlan(x.h.store, "g").planHash;
      expect(x.estimate()).toMatchObject({ state: "failed", reasonCode: "estimate-output-invalid", output: null, outputHash: null, repairs: [] });
      expect(readCanonicalRecord(x.h.store, sha256Canonical(missing(planHash)))).toBe(canonicalBytes(missing(planHash)).toString("utf8"));
      expect(readControlGroup(x.h.store, "epoch", "g").ledger.used.tokens).toBe(777);
    } finally { await x.h.dispose(); }
  });

  it("fails a call that read no JSON object without running repair", async () => {
    const x = await settle(estimateOutput, { outcome: "failed", errorCode: "single-call-output-invalid" }); try {
      expect(x.estimate()).toMatchObject({ state: "failed", reasonCode: "estimate-call-failed:single-call-output-invalid", output: null, repairs: [] });
    } finally { await x.h.dispose(); }
  });
});
