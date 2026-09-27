import { describe, expect, it } from "vitest";
import { classifyEstimateOutput } from "../../src/control/estimator.js";
import { readArchivedPlan, readEstimateRecord } from "../../src/control/queries.js";
import { WebControlService } from "../../src/control/webService.js";
import { webFixture } from "./fixtures/web.js";

// Single-call estimate spec §6.4: a failed estimate says why -- the call gave nothing, the answer is not
// budget-estimate-v1, or it is but for another plan. Before this round every one of them was plan-version-conflict.
const amount = { tokens: 100, activeMs: 100, attempts: 1, sessions: 1 };
const task = { taskId: "a", complexity: "M", confidence: "high", work: amount, handoff: { tokens: 0, activeMs: 100, attempts: 0, sessions: 0 }, rationale: "small", assumptions: ["clean tree"] };
const output = (planHash: string, patch: Record<string, unknown> = {}) => ({ schema: "budget-estimate-v1", planHash, tasks: [task], goalReviewReserve: amount, groupRationale: "small", ...patch });

describe("classifying an estimate's raw output (single-call estimate spec §6.4)", () => {
  it("names each reason by its own code", () => {
    const planHash = "a".repeat(64);
    expect(classifyEstimateOutput(null, planHash, ["a"])).toEqual({ ok: false, reasonCode: "estimate-call-failed" });
    expect(classifyEstimateOutput({ schema: "budget-estimate-v1" }, planHash, ["a"])).toEqual({ ok: false, reasonCode: "estimate-output-invalid" });
    expect(classifyEstimateOutput(output("b".repeat(64)), planHash, ["a"])).toEqual({ ok: false, reasonCode: "estimate-output-plan-mismatch" });
    expect(classifyEstimateOutput(output(planHash, { tasks: [{ ...task, taskId: "b" }] }), planHash, ["a"])).toEqual({ ok: false, reasonCode: "estimate-output-plan-mismatch" });
    expect(classifyEstimateOutput(output(planHash), planHash, ["a"])).toEqual({ ok: true, output: output(planHash) });
  });

  it.each([
    ["a call that returned nothing", () => null, "estimate-call-failed"],
    ["an answer that is not budget-estimate-v1", () => ({ schema: "budget-estimate-v1" }), "estimate-output-invalid"],
    ["a schema-valid answer that is not canonical JSON", (planHash: string) => output(planHash, { tasks: [{ ...task, work: { ...amount, tokens: -0 } }] }), "estimate-output-invalid"],
    ["an answer for another plan", () => output("f".repeat(64)), "estimate-output-plan-mismatch"],
    ["an answer about other tasks", (planHash: string) => output(planHash, { tasks: [{ ...task, taskId: "b" }] }), "estimate-output-plan-mismatch"],
  ] as const)("fails the estimate with its reason: %s", async (_label, raw, reasonCode) => {
    const h = await webFixture(); try {
      const service = new WebControlService(h.deps), run = await service.claimEstimate("g", h.estimateId);
      const row = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(run!.runId)!.body));
      row.state = "settled-restartable";
      h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(row), run!.runId);
      service.completeEstimate("g", h.estimateId, raw(readArchivedPlan(h.store, "g").planHash));
      expect(readEstimateRecord(h.store, "g", h.estimateId)).toMatchObject({ state: "failed", reasonCode, output: null, outputHash: null });
    } finally { await h.dispose(); }
  });
});
