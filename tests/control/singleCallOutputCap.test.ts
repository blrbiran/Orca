import { describe, expect, it } from "vitest";
import { frozenSlotOf, type AgentResolution } from "../../src/control/agentSelection.js";
import { ccloopResolutionSchema } from "../../src/control/ccloopPort.js";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { buildBudgetEstimateRequest, ESTIMATE_GRANT, persistEstimateArtifacts, readEstimateContract, singleCallOutputBound } from "../../src/control/estimator.js";
import { readArchivedPlan } from "../../src/control/queries.js";
import { singleCallHandler, type SingleCallPrepareDeps } from "../../src/control/singleCallPurposes.js";
import { webFixture } from "./fixtures/web.js";

// OMP single call (spec 2026-10-14-omp-single-call-design.md §4, criterion 10): ccloop now states the cap an agent's single
// call runs under. Orca must accept it (or the strict schema refuses every omp resolution once ccloop is repinned), refuse
// a value that could not be a cap, keep refusing keys it does not know, and never freeze it into a slot.
const answer = (extra: Record<string, unknown> = {}) => ({
  protocol: 3, selection: { agent: "omp", model: "gateway/model-a", contextWindow: "agent-default" }, configHash: "d".repeat(64), timeoutMs: 120_000, killGraceMs: 5_000,
  capabilities: { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: 200_000, requestBoundProof: null },
  singleCallExecution: "v1", ...extra,
});

describe("singleCallOutputCap on the resolution (criterion 10)", () => {
  it("C10: accepts a positive safe integer, null, or no field", () => {
    for (const extra of [{ singleCallOutputCap: 8_192 }, { singleCallOutputCap: Number.MAX_SAFE_INTEGER }, { singleCallOutputCap: null }, {}]) {
      expect([extra, ccloopResolutionSchema.safeParse(answer(extra)).success]).toEqual([extra, true]);
    }
  });

  it("C10: refuses 0, a negative, a fraction, a string and an unsafe integer, and still refuses an unknown key", () => {
    for (const value of [0, -1, 1.5, "8192", 2 ** 53]) {
      expect([value, ccloopResolutionSchema.safeParse(answer({ singleCallOutputCap: value })).success]).toEqual([value, false]);
    }
    expect(ccloopResolutionSchema.safeParse(answer({ singleCallOutputCap: 8_192, outputCap: 8_192 })).success).toBe(false);
  });

  it("is never frozen into a slot", () => {
    const { protocol: _protocol, ...parsed } = ccloopResolutionSchema.parse(answer({ singleCallOutputCap: 8_192 }));
    const slot = frozenSlotOf(parsed as AgentResolution, { agent: "omp" }, { agent: "operator", model: "descriptor", contextWindow: "descriptor" });
    expect(Object.keys(slot).sort()).toEqual(["capabilities", "configHash", "killGraceMs", "partial", "provenance", "selection", "timeoutMs"]);
  });
});

// Criteria 8 and 9 (spec §4): omp cannot take the request's cap, so Orca sizes and sends the larger of the preflight's cap
// and the agent's own -- otherwise the estimate would book less than the call can spend, and ccloop's spawn check
// (row.maxTokens <= maxOutputTokens) would refuse every omp estimate whose catalog cap is above the preflight's.
type Fixture = Awaited<ReturnType<typeof webFixture>>;
async function build(h: Fixture, cap: number | null | undefined) {
  const plan = readArchivedPlan(h.store, "g");
  const observation = await h.deps.profileRouter.probe(h.frozen, { agent: "codex" });
  const withCap = cap === undefined ? observation : { ...observation, resolution: { ...observation.resolution!, singleCallOutputCap: cap } };
  return buildBudgetEstimateRequest({ planHash: plan.planHash, planCanonicalJson: plan.canonicalJson, profile: h.frozen, observation: withCap, mode: "strict" });
}

describe("the estimate's output bound (criteria 8 and 9)", () => {
  it("C8: a cap above the preflight value is the contract's maxOutputTokens, read back for the envelope, and sizes the request", async () => {
    const h = await webFixture(); try {
      const raised = await build(h, 100_000);
      expect(raised.state).toBe("queued");
      expect(raised.contract!.maxOutputTokens).toBe(100_000);
      expect(raised.requiredRequestTokens).toBe(raised.inputTokens! + 100_000);
      // The single-call envelope takes contract.maxOutputTokens (singleCallPurposes.ts ESTIMATE.prepare) from the persisted contract.
      persistEstimateArtifacts(h.store, "g", "estimate-cap", raised);
      expect(readEstimateContract(h.store, "g", "estimate-cap").maxOutputTokens).toBe(100_000);
    } finally { await h.dispose(); }
  });

  // Controller ruling I1: spec §5.8 names the envelope, so the envelope itself is measured -- ESTIMATE.prepare's
  // maxOutputTokens is what ccloop receives as the request's cap and checks the catalog row against at spawn.
  it("C8: the single-call envelope ESTIMATE.prepare sends carries the raised bound", async () => {
    const h = await webFixture(); try {
      const raised = await build(h, 100_000);
      // A second estimate record beside the fixture's own, carrying the fixture's request; its contract is the raised one.
      const row = h.store.db.prepare("SELECT body FROM estimates WHERE group_id='g' AND id=?").get(h.estimateId)!;
      const record = { ...JSON.parse(String(row.body)), estimateId: "estimate-cap", estimateVersion: 2 };
      h.store.db.prepare("INSERT INTO estimates(group_id,id,estimate_version,state,body) VALUES ('g','estimate-cap',2,?,?)").run(record.state, canonicalBytes(record).toString("utf8"));
      persistEstimateArtifacts(h.store, "g", "estimate-cap", raised);
      const envelope = await singleCallHandler("estimate").prepare({ store: h.store } as unknown as SingleCallPrepareDeps, { runId: "run-cap", groupId: "g", workItemId: "estimate", estimateId: "estimate-cap" });
      expect(envelope).toMatchObject({ maxOutputTokens: 100_000 });
    } finally { await h.dispose(); }
  });

  it("C8: no cap, a null cap or a smaller cap leaves today's numbers", async () => {
    const h = await webFixture(); try {
      for (const cap of [undefined, null, 1_000]) {
        const today = await build(h, cap);
        expect([cap, today.state, today.contract!.maxOutputTokens, today.requiredRequestTokens! - today.inputTokens!]).toEqual([cap, "queued", 64_000, 64_000]);
      }
    } finally { await h.dispose(); }
  });

  it("C9: a cap of 250 001 with a small input is input-too-large, though the input alone fits", async () => {
    const h = await webFixture(); try {
      const result = await build(h, 250_001);
      expect(result.inputTokens!).toBeLessThan(ESTIMATE_GRANT.tokens);
      expect(result).toMatchObject({ state: "input-too-large", reasonCode: "estimate-input-too-large", requiredRequestTokens: result.inputTokens! + 250_001 });
    } finally { await h.dispose(); }
  });

  it("takes the larger of the preflight cap and the agent's cap", () => {
    expect([singleCallOutputBound(64_000, null), singleCallOutputBound(64_000, {}), singleCallOutputBound(64_000, { singleCallOutputCap: null }),
      singleCallOutputBound(64_000, { singleCallOutputCap: 16_384 }), singleCallOutputBound(64_000, { singleCallOutputCap: 524_288 })]).toEqual([64_000, 64_000, 64_000, 64_000, 524_288]);
  });
});
