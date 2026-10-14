import { describe, expect, it } from "vitest";
import { frozenSlotOf, type AgentResolution } from "../../src/control/agentSelection.js";
import { ccloopResolutionSchema } from "../../src/control/ccloopPort.js";

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
