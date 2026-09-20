import { describe, expect, it } from "vitest";
import { WebControlService } from "../../src/control/webService.js";
import { readBudgetProposal } from "../../src/control/queries.js";
import { webFixture } from "./fixtures/web.js";
import express from "express";
import { createServer } from "node:http";
import { registerControlReadRoutes, verifyControlJsonBody } from "../../src/panel/controlApi.js";

describe("proposal commands", () => {
  it("applies atomic field deltas, refunds reserve, and replays the original result", async () => {
    const h = await webFixture(); try {
      const service = new WebControlService(h.deps), before = readBudgetProposal(h.store, "g");
      const operation = { target: { scope: "task" as const, taskId: "a", allocation: "work" as const, dimension: "tokens" as const }, value: 2_000_000, provenance: "human" as const };
      const command = h.command("proposal-edit", { baseProposalVersion: 1, operations: [operation] });
      const result = service.editProposal(command);
      expect(result).toMatchObject({ result: { kind: "proposal-edited", proposalVersion: 2 } });
      const after = readBudgetProposal(h.store, "g");
      expect(after.explicitUnallocatedReserve.tokens).toBe(before.explicitUnallocatedReserve.tokens + 1_000_000);
      expect(after.allocations.find(a => a.ownerId === "a" && a.bucket === "work")!.fieldProvenance.tokens).toEqual({ provenance: "human", estimateId: null });
      expect(service.editProposal(command)).toEqual(result);
      expect(service.editProposal(h.command("proposal-edit", { baseProposalVersion: 2, operations: [operation] }))).toMatchObject({ error: { code: "no-op-command" } });
      expect(service.editProposal(h.command("proposal-edit", { baseProposalVersion: 2, operations: [operation, operation] }))).toMatchObject({ error: { code: "duplicate-proposal-target" } });
      expect(service.editProposal(h.command("proposal-edit", { baseProposalVersion: 1, operations: [operation] }))).toMatchObject({ error: { code: "proposal-version-conflict" } });
      expect(readBudgetProposal(h.store, "g")).toEqual(after);
    } finally { await h.dispose(); }
  });
  it("checks proposal version before domain state and applies allocation plus limit atomically", async () => {
    const h = await webFixture(); try {
      const service = new WebControlService(h.deps), before = readBudgetProposal(h.store, "g");
      const operation = { target: { scope: "task" as const, taskId: "a", allocation: "work" as const, dimension: "tokens" as const }, value: 9000000, provenance: "human" as const };
      expect(service.editProposal(h.command("proposal-edit", { baseProposalVersion: 1, operations: [operation] }))).toMatchObject({ error: { code: "group-budget-unavailable" } });
      expect(readBudgetProposal(h.store, "g")).toEqual(before);
      expect(service.editProposal(h.command("proposal-edit", { baseProposalVersion: 1, operations: [operation], proposedGroupLimit: { ...before.groupLimit, tokens: before.groupLimit.tokens + 6000000 } }))).toMatchObject({ result: { proposalVersion: 2 } });
      const group = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)); group.status = "running";
      h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(group));
      expect(service.editProposal(h.command("proposal-edit", { baseProposalVersion: 1, operations: [operation] }))).toMatchObject({ error: { code: "proposal-version-conflict" } });
      expect(await service.createEstimate(h.command("estimate", { proposalVersion: 1, estimatorProfileId: "all", estimatorProfileHash: h.frozen.profileHash, estimateMode: "soft" }))).toMatchObject({ error: { code: "proposal-version-conflict" } });
      expect(service.confirm(h.command("confirm", { ...h.confirmPayload(), proposalVersion: 1 }))).toMatchObject({ error: { code: "proposal-version-conflict" } });
    } finally { await h.dispose(); }
  });
  it("validates explicit model field provenance again at confirmation", async () => {
    const h = await webFixture(); try {
      const service = new WebControlService(h.deps), run = await service.claimEstimate("g", h.estimateId);
      const row = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(run!.runId)!.body)); row.state = "settled-restartable";
      h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(row), run!.runId);
      const proposal = readBudgetProposal(h.store, "g"), work = proposal.allocations.find(a => a.ownerKind === "task" && a.bucket === "work")!.amount;
      service.completeEstimate("g", h.estimateId, { schema: "budget-estimate-v1", planHash: proposal.planHash, tasks: [{ taskId: "a", complexity: "M", confidence: "high", work: { ...work, tokens: 2000000 }, handoff: { tokens: 0, activeMs: 100, attempts: 0, sessions: 0 }, rationale: "small", assumptions: ["clean"] }], goalReviewReserve: { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 }, groupRationale: "small" });
      const operation = { target: { scope: "task" as const, taskId: "a", allocation: "work" as const, dimension: "tokens" as const }, value: 2000001, provenance: "model" as const, estimateId: h.estimateId };
      expect(service.editProposal(h.command("proposal-edit", { baseProposalVersion: 1, operations: [operation] }))).toMatchObject({ error: { code: "proposal-version-conflict" } });
      expect(service.editProposal(h.command("proposal-edit", { baseProposalVersion: 1, operations: [{ ...operation, value: 2000000 }] }))).toMatchObject({ result: { proposalVersion: 2 } });
      const applied = readBudgetProposal(h.store, "g").allocations.find(a => a.ownerKind === "task" && a.bucket === "work")!;
      expect(applied.fieldProvenance.tokens).toEqual({ provenance: "model", estimateId: h.estimateId });
      expect(service.confirm(h.command("confirm", h.confirmPayload()))).toMatchObject({ result: { kind: "confirmed" } });
      expect(service.editProposal(h.command("proposal-edit", { baseProposalVersion: 2, operations: [{ target: operation.target, value: 3000000, provenance: "complex-1m-default" }] }))).toMatchObject({ result: { proposalVersion: 3 } });
      expect(readBudgetProposal(h.store, "g").allocations.find(a => a.ownerKind === "task" && a.bucket === "work")!.fieldProvenance.tokens.estimateId).toBeNull();
    } finally { await h.dispose(); }
  });
  it("serves closed mutation envelopes with exact durable statuses and replay lookup", async () => {
    const h = await webFixture(); const app = express(); app.use(express.json({ verify: verifyControlJsonBody }));
    registerControlReadRoutes(app, { store: h.store, epoch: "epoch", config: { readView: async () => ({}) } as never, service: new WebControlService(h.deps) });
    const server = createServer(app); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("address");
    const base = `http://127.0.0.1:${address.port}/api/control`;
    try {
      const body = { commandId: "http-estimate", expectedRevision: 1, payload: { proposalVersion: 1, estimatorProfileId: "all", estimatorProfileHash: h.frozen.profileHash, estimateMode: "soft" } };
      const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const first = await post("/groups/g/estimates", body); expect(first.status).toBe(202); const result = await first.json();
      expect((await post("/groups/g/estimates", body)).status).toBe(202);
      const lookup = await (await fetch(`${base}/groups/g/commands/http-estimate`)).json();
      expect(lookup).toEqual({ schema: "orca-command-lookup-v1", originalStatus: 202, body: result });
      expect(result.actorId).toMatch(/^operator-/);
      const duplicate = { target: { scope: "goal-review", dimension: "tokens" }, value: 1, provenance: "human" };
      const rejected = await post("/groups/g/proposal/edit", { commandId: "http-duplicate", expectedRevision: 2, payload: { baseProposalVersion: 1, operations: [duplicate, duplicate] } });
      expect(rejected.status).toBe(422); expect(await rejected.json()).toMatchObject({ error: { code: "duplicate-proposal-target", retryable: false } });
      expect((await post("/groups/g/confirm", { commandId: "http-confirm", expectedRevision: 2, payload: h.confirmPayload() })).status).toBe(200);
      expect((await post("/groups/g/set-limit", { commandId: "http-limit", expectedRevision: 3, payload: { limit: { ...readBudgetProposal(h.store, "g").groupLimit, tokens: 9999999 } } })).status).toBe(200);
      expect((await post("/groups/import-plan", { commandId: "http-import", expectedRevision: 0, payload: { groupId: "other", repoId: "repo", planId: "plan" } })).status).toBe(201);
      expect((await post("/groups/g/estimates", { ...body, actorId: "forged" })).status).toBe(400);
      for (const raw of ['{"commandId":"x","commandId":"y","expectedRevision":4,"payload":{}}', '{broken', '{"commandId":"x","expectedRevision":-0,"payload":{}}', '{"commandId":"\\ud800","expectedRevision":4,"payload":{}}']) {
        const response = await fetch(`${base}/groups/g/confirm`, { method: "POST", headers: { "content-type": "application/json" }, body: raw });
        expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ error: { retryable: false } });
      }
      expect(h.accept).not.toHaveBeenCalled();
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); await h.dispose(); }
  });
});
