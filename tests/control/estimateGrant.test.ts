import { describe, expect, it } from "vitest";
import { ESTIMATE_GRANT, estimateGrantFor, readEstimateContract } from "../../src/control/estimator.js";
import { retryPromptFits } from "../../src/control/estimateRetry.js";
import { WebControlService } from "../../src/control/webService.js";
import { readBudgetProposal, readEstimateRecord } from "../../src/control/queries.js";
import { profileSnapshot, webFixture, type WebFixtureOptions } from "./fixtures/web.js";

/**
 * Tester round 2 spec §5 (ruling H2): the estimate grant and the preflight's input bound are two numbers. The bound is the
 * selected model's context window only; the grant is min(1,000,000 / 30 min cap, the group's remaining tokens in a limited
 * group, the binding spend cap's headroom when it covers the request) -- frozen into the row, the contract and the run.
 */
type Fixture = Awaited<ReturnType<typeof webFixture>>;
const groupBody = (h: Fixture) => JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
const estimate = (h: Fixture, service: WebControlService) => service.createEstimate(h.command("estimate", { proposalVersion: readBudgetProposal(h.store, "g").proposalVersion, estimatorProfileId: "all", estimatorProfileHash: h.frozen.profileHash, estimateMode: "soft" }));
/** A limited (finite-legacy) group whose remaining tokens -- limit - used - committed -- are exactly `remaining`. */
function setRemaining(h: Fixture, service: WebControlService, remaining: number): void {
  const body = groupBody(h), proposal = readBudgetProposal(h.store, "g");
  const answer = service.editProposal(h.command("proposal-edit", { baseProposalVersion: proposal.proposalVersion, operations: [],
    proposedGroupLimit: { ...proposal.groupLimit, tokens: body.used.tokens + body.reserved.tokens + remaining } }));
  if ("error" in answer) throw new Error(JSON.stringify(answer));
  const after = groupBody(h);
  expect(after.limit.tokens - after.used.tokens - after.reserved.tokens).toBe(remaining);
}
/** A profile whose estimator output bound makes the request need about `outputTokens` more tokens. */
const withOutputBound = (outputTokens: number) => { const snapshot = profileSnapshot(); snapshot.profile.estimatorPreflight!.maxOutputTokens = outputTokens; return snapshot; };
async function fixture(options: WebFixtureOptions = {}, snapshot = profileSnapshot()) {
  const h = await webFixture(snapshot, [{ taskId: "a" }], options);
  return { h, service: new WebControlService(h.deps) };
}

describe("estimateGrantFor (C11)", () => {
  const capOthers = { activeMs: 1_800_000, attempts: 1, sessions: 1 };
  it("is the 1,000,000 / 30-minute cap with no limit and no cap", () => {
    expect(ESTIMATE_GRANT).toEqual({ tokens: 1_000_000, ...capOthers });
    expect(estimateGrantFor({ limitTokens: null, remainingTokens: null, capHeadroom: null, requiredRequestTokens: 100 })).toEqual({ tokens: 1_000_000, ...capOthers });
  });
  it("is min(remaining, cap) in a limited group, the other dimensions the cap's", () => {
    expect(estimateGrantFor({ limitTokens: 5_000_000, remainingTokens: 600_000, capHeadroom: null, requiredRequestTokens: 100 })).toEqual({ tokens: 600_000, ...capOthers });
    expect(estimateGrantFor({ limitTokens: 5_000_000, remainingTokens: 2_000_000, capHeadroom: null, requiredRequestTokens: 100 })).toEqual({ tokens: 1_000_000, ...capOthers });
  });
  it("takes the cap headroom only when it covers the request", () => {
    expect(estimateGrantFor({ limitTokens: null, remainingTokens: null, capHeadroom: 300_000, requiredRequestTokens: 200_000 }).tokens).toBe(300_000);
    expect(estimateGrantFor({ limitTokens: null, remainingTokens: null, capHeadroom: 300_000, requiredRequestTokens: 350_000 }).tokens).toBe(1_000_000);
  });
});

describe("the grant where an estimate is created", () => {
  it("C11: with headroom below the request, the grant stays the cap and the claim is cap-blocked", async () => {
    const { h, service } = await fixture({ tokenPolicy: "optional-v1" }, withOutputBound(350_000)); try {
      h.store.db.prepare("INSERT INTO spend_caps(scope,period,tokens,updated_at,updated_by) VALUES ('repo:repo','total',300000,0,'human')").run();
      const created = await estimate(h, service);
      if ("error" in created || created.result.kind !== "estimate-created") throw new Error(JSON.stringify(created));
      expect(readEstimateRecord(h.store, "g", created.result.estimateId).grant.tokens).toBe(1_000_000);
      expect(await service.claimEstimate("g", created.result.estimateId)).toBeNull();
      expect(readEstimateRecord(h.store, "g", created.result.estimateId).state).toBe("queued");
      expect(JSON.parse(String(h.store.db.prepare("SELECT body FROM spend_cap_blocks WHERE group_id='g'").get()!.body))).toMatchObject({ code: "spend-cap-reached", claim: "estimate" });
    } finally { await h.dispose(); }
  });
  it("C11a: a repository cap with 400,000 headroom gives a 400,000 grant, claimed on the next wake", async () => {
    const { h, service } = await fixture({ tokenPolicy: "optional-v1" }); try {
      h.store.db.prepare("INSERT INTO spend_caps(scope,period,tokens,updated_at,updated_by) VALUES ('repo:repo','total',400000,0,'human')").run();
      const created = await estimate(h, service);
      if ("error" in created || created.result.kind !== "estimate-created") throw new Error(JSON.stringify(created));
      expect(created.result.estimateState).toBe("queued");
      expect(readEstimateRecord(h.store, "g", created.result.estimateId).grant).toEqual({ ...ESTIMATE_GRANT, tokens: 400_000 });
      const run = await service.claimEstimate("g", created.result.estimateId);
      expect(run).not.toBeNull();
      expect(JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(run!.runId)!.body)).grant.work.tokens).toBe(400_000);
    } finally { await h.dispose(); }
  });
  it("C12: a request larger than the remaining tokens but inside the window queues with the remaining as its grant; the window alone bounds the input", async () => {
    const { h, service } = await fixture({}, withOutputBound(299_000)); try {
      setRemaining(h, service, 200_000);
      const created = await estimate(h, service);
      if ("error" in created || created.result.kind !== "estimate-created") throw new Error(JSON.stringify(created));
      expect(created.result.estimateState).toBe("queued");
      const row = readEstimateRecord(h.store, "g", created.result.estimateId);
      expect(row.request).not.toBeNull();
      expect(row.grant.tokens).toBe(200_000);
      h.setObserved({ ...profileSnapshot().profile.capabilities, contextWindowTokens: 250_000 });
      const small = await estimate(h, service);
      if ("error" in small || small.result.kind !== "estimate-created") throw new Error(JSON.stringify(small));
      expect(small.result).toMatchObject({ estimateState: "input-too-large", reasonCode: "estimate-input-too-large" });
    } finally { await h.dispose(); }
  });
  it("C14: 0 tokens remaining refuses the estimate; 1 token remaining queues it with a 1-token grant", async () => {
    const { h, service } = await fixture(); try {
      setRemaining(h, service, 0);
      expect(await estimate(h, service)).toMatchObject({ error: { code: "group-budget-unavailable" } });
      setRemaining(h, service, 1);
      const created = await estimate(h, service);
      if ("error" in created || created.result.kind !== "estimate-created") throw new Error(JSON.stringify(created));
      expect(created.result.estimateState).toBe("queued");
      expect(readEstimateRecord(h.store, "g", created.result.estimateId).grant.tokens).toBe(1);
    } finally { await h.dispose(); }
  });
  it("C15: in a limited group with 600,000 remaining, the row, the contract and the claimed run carry a 600,000-token grant", async () => {
    const { h, service } = await fixture(); try {
      setRemaining(h, service, 600_000);
      const created = await estimate(h, service);
      if ("error" in created || created.result.kind !== "estimate-created") throw new Error(JSON.stringify(created));
      const id = created.result.estimateId;
      expect(readEstimateRecord(h.store, "g", id).grant).toEqual({ ...ESTIMATE_GRANT, tokens: 600_000 });
      expect(readEstimateContract(h.store, "g", id).grant).toEqual({ ...ESTIMATE_GRANT, tokens: 600_000 });
      const run = await service.claimEstimate("g", id); // the claim's contract-equality check passes
      expect(run).not.toBeNull();
      expect(JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(run!.runId)!.body)).grant.work).toEqual({ ...ESTIMATE_GRANT, tokens: 600_000 });
    } finally { await h.dispose(); }
  });
});

describe("the retry re-check (C13)", () => {
  it("ignores the grant and keeps the window", async () => {
    const { h } = await fixture(); try {
      const contract = readEstimateContract(h.store, "g", h.estimateId), request = readEstimateRecord(h.store, "g", h.estimateId).request!;
      // A prompt needing more than the 1,000,000-token cap but inside a 2,000,000 window fits; the grant plays no part.
      const big = { ...contract, maxOutputTokens: 1_100_000, grant: { ...contract.grant, tokens: 1 }, estimatorCapabilities: { ...contract.estimatorCapabilities, contextWindowTokens: 2_000_000 } };
      expect(retryPromptFits(big, request, ["missing task"])).toBe(true);
      const narrow = { ...big, estimatorCapabilities: { ...big.estimatorCapabilities, contextWindowTokens: 1_000_000 } };
      expect(retryPromptFits(narrow, request, ["missing task"])).toBe(false);
    } finally { await h.dispose(); }
  });
});
