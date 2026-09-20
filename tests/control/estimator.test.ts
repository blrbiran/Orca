import { describe, expect, it } from "vitest";
import { buildBudgetEstimateRequest, complex1mDefaults, estimateCapabilityDegraded } from "../../src/control/estimator.js";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { readArchivedPlan, readBudgetProposal, readEstimateRecord } from "../../src/control/queries.js";
import { WebControlService } from "../../src/control/webService.js";
import { lookupCommandResult } from "../../src/control/commandLedger.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { sha256Canonical } from "../../src/control/canonicalJson.js";
import { recordUsage } from "../../src/control/usage.js";
import { webFixture, profileSnapshot } from "./fixtures/web.js";

describe("frozen estimator", () => {
  it("builds the five-task complex-1m ledger exactly and rejects aggregate overflow", () => {
    expect(complex1mDefaults(5)).toEqual({ base: { tokens: 17750000, activeMs: 85500000, attempts: 17, sessions: 17 }, reserve: { tokens: 3550000, activeMs: 17100000, attempts: 4, sessions: 4 }, limit: { tokens: 21300000, activeMs: 102600000, attempts: 21, sessions: 21 } });
    expect(() => complex1mDefaults(Number.MAX_SAFE_INTEGER)).toThrow("numeric-overflow");
  });
  it("claims an explicitly soft estimate when its unchanged declaration has no proof", async () => {
    const profile = profileSnapshot(); profile.profile.capabilities.requestBoundProof = null;
    const h = await webFixture(profile); try {
      expect(await new WebControlService(h.deps).claimEstimate("g", h.estimateId)).toMatchObject({ state: "starting" });
      expect(h.accept).not.toHaveBeenCalled();
    } finally { await h.dispose(); }
  });
  it("freezes exact input formula, contract constants, and checks later degradation", async () => {
    const h = await webFixture(); try {
      const plan = readArchivedPlan(h.store, "g");
      const observation = await h.deps.profileRouter.probe(h.frozen);
      const result = buildBudgetEstimateRequest({ planHash: plan.planHash, planCanonicalJson: plan.canonicalJson, profile: h.frozen, observation, mode: "strict" });
      expect(result.state).toBe("queued");
      const serialized = Math.ceil(canonicalBytes(result.request).length * 2 / 3);
      expect(result.inputTokens).toBe(serialized + 17);
      expect(result.requiredRequestTokens).toBe(serialized + 17 + 64000);
      expect(result.contract).toMatchObject({ requestHash: result.requestHash, framingTokenOverhead: 17, maxOutputTokens: 64000 });
      expect(estimateCapabilityDegraded(result.request!, { ...observation, observed: { ...observation.observed, contextWindowTokens: 999999 } })).toBe(true);
      expect(estimateCapabilityDegraded(result.request!, observation)).toBe(false);
      const tooLarge = buildBudgetEstimateRequest({ planHash: plan.planHash, planCanonicalJson: plan.canonicalJson, profile: h.frozen, observation: { ...observation, observed: { ...observation.observed, contextWindowTokens: 1 } }, mode: "soft" });
      expect(tooLarge.state).toBe("input-too-large"); expect(h.accept).not.toHaveBeenCalled();
    } finally { await h.dispose(); }
  });
  it("accounts durable estimate creation/replay, terminal preflight, and claim degradation without a run", async () => {
    const h = await webFixture(); try {
      const service = new WebControlService(h.deps), before = readBudgetProposal(h.store, "g");
      const command = h.command("estimate", { proposalVersion: 1, estimatorProfileId: "all", estimatorProfileHash: h.frozen.profileHash, estimateMode: "strict" });
      const result = await service.createEstimate(command);
      expect(result).toMatchObject({ result: { kind: "estimate-created", estimateState: "queued", estimateVersion: 2 } });
      expect(lookupCommandResult(h.store, "g", command.commandId)?.originalStatus).toBe(202);
      expect(await service.createEstimate(command)).toEqual(result);
      expect(readBudgetProposal(h.store, "g").explicitUnallocatedReserve.tokens).toBe(before.explicitUnallocatedReserve.tokens - 250000);
      h.setObserved({ ...h.frozen.snapshot.profile.capabilities, contextWindowTokens: 999999 });
      expect(await service.claimEstimate("g", h.estimateId)).toBeNull();
      expect(readEstimateRecord(h.store, "g", h.estimateId)).toMatchObject({ state: "blocked-capability", reasonCode: "estimate-capability-degraded" });
      expect(h.store.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(0);
      expect(readControlGroup(h.store, "epoch", "g").estimates).toHaveLength(2);
      h.setObserved({ ...h.frozen.snapshot.profile.capabilities, contextWindowTokens: 1 });
      const terminal = h.command("estimate", { ...command.payload });
      expect(await service.createEstimate(terminal)).toMatchObject({ result: { estimateState: "input-too-large", wakeId: null } });
      expect(lookupCommandResult(h.store, "g", terminal.commandId)?.originalStatus).toBe(200);
      expect(h.accept).not.toHaveBeenCalled();
    } finally { await h.dispose(); }
  });
  it.each([false, true])("settles accounted estimate atomically and never overwrites dirty fields (invalid=%s)", async invalid => {
    const h = await webFixture(); try {
      const service = new WebControlService(h.deps);
      const run = await service.claimEstimate("g", h.estimateId);
      expect(run).toMatchObject({ phase: "estimate", state: "starting", claimOrdinal: null, providerAttemptOrdinal: 0 });
      expect(await service.claimEstimate("g", h.estimateId)).toEqual(run);
      expect(readControlGroup(h.store, "epoch", "g").runs).toHaveLength(1);
      service.editProposal(h.command("proposal-edit", { baseProposalVersion: 1, operations: [{ target: { scope: "task", taskId: "a", allocation: "work", dimension: "tokens" }, value: 2000000, provenance: "human" }] }));
      const before = readBudgetProposal(h.store, "g"), revision = h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision;
      // The scheduler's verified terminal boundary supplies settled known usage.
      const row = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(run!.runId)!.body));
      row.state = "settled-restartable";
      h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(row), run!.runId);
      const plan = readArchivedPlan(h.store, "g");
      const output = { schema: "budget-estimate-v1", planHash: plan.planHash, tasks: [{ taskId: invalid ? "unknown" : "a", complexity: "M", confidence: "high", work: { tokens: 100, activeMs: 100, attempts: 1, sessions: 1 }, handoff: { tokens: 0, activeMs: 100, attempts: 0, sessions: 0 }, rationale: "small", assumptions: ["clean tree"] }], goalReviewReserve: { tokens: 100, activeMs: 100, attempts: 1, sessions: 1 }, groupRationale: "small" };
      service.completeEstimate("g", h.estimateId, output);
      expect(readEstimateRecord(h.store, "g", h.estimateId)).toMatchObject({ state: invalid ? "failed" : "ready", outputHash: invalid ? null : sha256Canonical(output) });
      const after = readBudgetProposal(h.store, "g");
      expect(after.allocations.filter(a => a.ownerKind !== "reserve")).toEqual(before.allocations.filter(a => a.ownerKind !== "reserve"));
      expect(after.explicitUnallocatedReserve.tokens).toBe(before.explicitUnallocatedReserve.tokens + 250000);
      service.completeEstimate("g", h.estimateId, output);
      expect(readBudgetProposal(h.store, "g")).toEqual(after);
      expect(h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision).toBe(revision);
      expect(h.accept).not.toHaveBeenCalled();
    } finally { await h.dispose(); }
  });
  it("rejects contradictory or prematurely settled output without releasing commitments", async () => {
    const h = await webFixture(); try {
      const service = new WebControlService(h.deps), run = await service.claimEstimate("g", h.estimateId);
      const before = readBudgetProposal(h.store, "g");
      expect(() => service.completeEstimate("g", h.estimateId, {})).toThrow("run-stop-unconfirmed");
      const row = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(run!.runId)!.body));
      row.state = "settled-restartable"; row.remaining.work.tokens += 1;
      h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(row), run!.runId);
      expect(() => service.completeEstimate("g", h.estimateId, {})).toThrow("recovery-blocked");
      expect(readBudgetProposal(h.store, "g")).toEqual(before);
    } finally { await h.dispose(); }
  });
  it("publishes terminal run/output/refund in one transaction and rolls back the settlement hook", async () => {
    const h = await webFixture(); try {
      const service = new WebControlService(h.deps), run = await service.claimEstimate("g", h.estimateId);
      const terminal = (corrupt: boolean) => {
        const row = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(run!.runId)!.body));
        row.state = "settled-restartable";
        if (corrupt) row.remaining.work.tokens += 1;
        h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(row), run!.runId);
      };
      expect(() => service.completeEstimate("g", h.estimateId, {}, () => terminal(true))).toThrow("recovery-blocked");
      expect(JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(run!.runId)!.body)).state).toBe("starting");
      service.completeEstimate("g", h.estimateId, {}, () => terminal(false));
      expect(readEstimateRecord(h.store, "g", h.estimateId).state).toBe("failed");
      expect(h.store.db.prepare("SELECT active FROM runs WHERE id=?").get(run!.runId)!.active).toBe(0);
    } finally { await h.dispose(); }
  });
  it("holds gaps/unknown usage and refunds only settled remainder after confirmed usage", async () => {
    const h = await webFixture(); try {
      const service = new WebControlService(h.deps), run = await service.claimEstimate("g", h.estimateId);
      const event = { runId: run!.runId, generation: 1, bucket: "work" as const, source: { artifactId: "event", hash: "a".repeat(64) } };
      recordUsage(h.store, { ...event, eventSeq: 2, cumulative: { tokens: 1000, activeMs: 100, attempts: 0, sessions: 0 } });
      expect(service.confirm(h.command("confirm", h.confirmPayload()))).toMatchObject({ error: { code: "recovery-blocked" } });
      recordUsage(h.store, { ...event, eventSeq: 1, cumulative: null });
      expect(service.confirm(h.command("confirm", h.confirmPayload()))).toMatchObject({ result: { kind: "confirmed" } });
      const before = readBudgetProposal(h.store, "g");
      const row = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(run!.runId)!.body));
      row.state = "settled-restartable";
      h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(row), run!.runId);
      service.completeEstimate("g", h.estimateId, {});
      expect(readBudgetProposal(h.store, "g").explicitUnallocatedReserve.tokens).toBe(before.explicitUnallocatedReserve.tokens + 249000);
      expect(readControlGroup(h.store, "epoch", "g").ledger.used.tokens).toBe(1000);
    } finally { await h.dispose(); }
  });
});
