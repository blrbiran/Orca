import { describe, expect, it } from "vitest";
import { readEstimateRecord } from "../../src/control/queries.js";
import { WebControlService } from "../../src/control/webService.js";
import { fixtureResolveAgent } from "./fixtures/agents.js";
import { webFixture } from "./fixtures/web.js";

// Human ruling 24 (Orca ledger 2026-09-27-single-call-estimate §3.21; landed by session c85d2c4e, 2026-09-28): each of
// estimator.ts's two single-call gates gets a criterion of its own, beside estimatePrompt.test.ts's unit one. Both go
// through the service, as the panel and the driver reach them, and the estimator's context window stays a known number
// throughout -- so `contextWindowTokens: null`, which blocks an estimate on its own, is not what these observe.
// Additive only: no existing criterion changed.

/** Answer every later probe as ccloop answers for an agent without single calls: the same view, `singleCallExecution: null`. */
function answerNull(h: Awaited<ReturnType<typeof webFixture>>): void {
  h.resolveAgent.mockImplementation(fixtureResolveAgent(() => structuredClone(h.frozen.snapshot.profile.capabilities), { singleCallExecution: null }));
}

describe("the estimator's single-call gates, each on its own (ruling 24)", () => {
  it.each(["v1", null] as const)("createEstimate queues only when ccloop answers v1 (answer %s)", async answer => {
    const h = await webFixture(); try {
      if (answer === null) answerNull(h);
      const payload = { proposalVersion: 1, estimatorProfileId: "all", estimatorProfileHash: h.frozen.profileHash, estimateMode: "soft" as const };
      expect(await new WebControlService(h.deps).createEstimate(h.command("estimate", payload))).toMatchObject({ result: answer === "v1"
        ? { kind: "estimate-created", estimateState: "queued", reasonCode: null }
        : { kind: "estimate-created", estimateState: "blocked-capability", reasonCode: "estimate-blocked-capability", wakeId: null } });
      // What the gate saw: this answer beside a known window (the probe the service made, read back from the mock).
      const seen = await h.resolveAgent.mock.results.at(-1)!.value;
      expect(seen).toMatchObject({ singleCallExecution: answer });
      expect(seen.capabilities.contextWindowTokens).toEqual(expect.any(Number));
      expect(h.accept).not.toHaveBeenCalled();
    } finally { await h.dispose(); }
  });

  it("claimEstimate degrades a queued estimate, without a run, when ccloop stops answering v1 for its frozen selection", async () => {
    const h = await webFixture(); try {
      answerNull(h);
      expect(await new WebControlService(h.deps).claimEstimate("g", h.estimateId)).toBeNull();
      expect(readEstimateRecord(h.store, "g", h.estimateId)).toMatchObject({ state: "blocked-capability", reasonCode: "estimate-capability-degraded" });
      expect(h.store.db.prepare("SELECT count(*) AS n FROM runs").get()!.n).toBe(0);
      const seen = await h.resolveAgent.mock.results.at(-1)!.value;
      expect(seen).toMatchObject({ singleCallExecution: null });
      expect(seen.capabilities.contextWindowTokens).toEqual(expect.any(Number));
    } finally { await h.dispose(); }
  });
});
