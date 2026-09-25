import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentSelection, PartialSelection } from "../../src/control/agentSelection.js";
import { claimWork, readRun } from "../../src/control/budget.js";
import { commitCandidate } from "../../src/control/checkpoints.js";
import { hashPayload, putWork } from "../../src/control/commands.js";
import { startClaim } from "../../src/control/dispatch.js";
import type { ExecutionPort } from "../../src/control/executionPort.js";
import { readWork, workAgents } from "../../src/control/queries.js";
import { makeControlledExecution } from "../../src/control/schedulerBridge.js";
import { ControlService } from "../../src/control/service.js";
import type { ControlStore } from "../../src/control/store.js";
import { candidateCase } from "./fixtures/candidate.js";
import { fakePeer } from "./fixtures/peer.js";
import { amount, caps, openTestStore, resolvedAs, seedBudgetCase } from "./fixtures/store.js";

/**
 * Agent selection spec §6.4 (C3), legacy (non-Web) paths of plan T7 (M-7): every capability gate asks ccloop about the
 * selection it is about to dispatch -- a claim about its work item's frozen selection, a group gate about each distinct
 * task selection, a reconciliation about its conflicted task's, a handoff about the handed-off run's, a continuation
 * about its predecessor's -- and the claims copy that selection. The fixtures freeze selections that are neither the
 * fixture default nor each other, so an ask of `{}` or of another item's selection is told apart from the right one.
 */
const AGENT_A: AgentSelection = { agent: "claude", model: "claude-opus-5-5", contextWindow: 1_000_000 };
const AGENT_B: AgentSelection = { agent: "codex", model: "gpt-6-sol", contextWindow: "agent-default" };

function recording(base: Partial<ExecutionPort> = {}) {
  const asked: PartialSelection[] = [];
  const port = {
    ...base,
    resolveAgent: async (partial: PartialSelection) => { asked.push(structuredClone(partial)); return resolvedAs(caps, partial); },
  } as ExecutionPort;
  return { port, asked };
}

function freezeAgent(store: ControlStore, table: "work_items" | "runs", id: string, agent: AgentSelection): void {
  const where = table === "work_items" ? "group_id='g1' AND id=?" : "id=?";
  const row = store.db.prepare(`SELECT body FROM ${table} WHERE ${where}`).get(id)!;
  store.db.prepare(`UPDATE ${table} SET body=? WHERE ${where}`).run(JSON.stringify({ ...JSON.parse(String(row.body)), agent }), id);
}

describe("legacy dispatch asks about, and freezes, the selection it dispatches (agent selection spec §6.4)", { timeout: 30_000 }, () => {
  it("claims a work item after asking about exactly its frozen selection, and the claim and run carry it", async () => {
    const h = await openTestStore(); try {
      seedBudgetCase(h.store);
      freezeAgent(h.store, "work_items", "T1", AGENT_A);
      freezeAgent(h.store, "work_items", "T2", AGENT_B);
      const { port, asked } = recording();
      const claim = await new ControlService(h.store, port).claimLegacy("g1", "T2");
      expect(asked).toEqual([AGENT_B]);
      expect(claim.agent).toEqual(AGENT_B);
      expect(readRun(h.store, claim.runId).agent).toEqual(AGENT_B);
    } finally { await h.dispose(); }
  });

  it("probes each distinct task selection once at the group gates (run and the controlled round's preflight)", async () => {
    const h = await openTestStore(); try {
      const seeded = seedBudgetCase(h.store);
      putWork(h.store, "g1", { ...seeded.w1, workItemId: "T3", taskId: "T3", agent: AGENT_A }, { commandId: "w3", expectedRevision: 3, by: "human" });
      freezeAgent(h.store, "work_items", "T1", AGENT_A);
      freezeAgent(h.store, "work_items", "T2", AGENT_B);
      const distinct = workAgents(h.store, "g1");
      expect(distinct).toHaveLength(2);
      expect(distinct).toEqual(expect.arrayContaining([AGENT_A, AGENT_B]));

      const run = recording();
      await expect(new ControlService(h.store, run.port).run("g1", join(h.root, "no-such-plan.json"))).rejects.toThrow();
      expect(run.asked).toEqual(distinct);

      const preflight = recording();
      const execution = makeControlledExecution(new ControlService(h.store, preflight.port), "g1");
      await execution.preflight({} as never).catch(() => undefined);
      expect(preflight.asked).toEqual(distinct);
    } finally { await h.dispose(); }
  });

  it("reconciles a conflicted task after asking about its selection, and the reconciliation's work item and run carry it", async () => {
    const h = await openTestStore(); try {
      seedBudgetCase(h.store);
      freezeAgent(h.store, "work_items", "T1", AGENT_A);
      freezeAgent(h.store, "work_items", "T2", AGENT_B);
      const { port, asked } = recording();
      const service = new ControlService(h.store, port, { reconcileGrant: { work: amount(7, 500, 1, 1), handoff: amount(2, 50, 0, 0) } });
      await service.reconcileBudgetLegacy("g1", "T1");
      expect(asked).toEqual([AGENT_A]);
      expect(readWork(h.store, "g1", "reconcile-T1").agent).toEqual(AGENT_A);
      const runId = String(h.store.db.prepare("SELECT id FROM runs WHERE work_item_id='reconcile-T1'").get()!.id);
      expect(readRun(h.store, runId).agent).toEqual(AGENT_A);
    } finally { await h.dispose(); }
  });

  it("requests a handoff after asking about the handed-off run's selection, not the handoff item's", async () => {
    const h = await openTestStore(); try {
      const s = seedBudgetCase(h.store);
      freezeAgent(h.store, "work_items", "T1", AGENT_A);
      const parent = claimWork(h.store, s.t1Claim);
      expect(parent.agent).toEqual(AGENT_A);
      const basePeer = fakePeer(join(h.root, "peer"));
      const sourceDir = join(h.root, "runs", parent.runId); await mkdir(sourceDir, { recursive: true });
      await startClaim(h.store, basePeer, { protocol: 2, claim: parent, contractHash: hashPayload(s.w1.contract), inputCheckpoint: null, work: { contract: s.w1.contract, targetRepo: h.root, base: "HEAD", sourceDir } });
      putWork(h.store, "g1", { ...s.w1, workItemId: "handoff-T1", kind: "handoff", parentRunId: parent.runId, agent: AGENT_B, grant: { work: amount(0, 0, 0, 0), handoff: s.w1.grant.handoff } }, { commandId: "register-handoff", expectedRevision: 3, by: "service" });
      const { port, asked } = recording({ ...basePeer, requestHandoff: async () => { throw new Error("lost-response"); } });
      await expect(new ControlService(h.store, port).requestHandoff("g1", parent.runId, { requestId: "r1", reason: "context", deadlineAt: "2030-01-01T00:00:00Z" })).rejects.toThrow("handoff-outcome-unknown");
      expect(asked).toEqual([AGENT_A]);
    } finally { await h.dispose(); }
  });

  it("continues a task after asking about its predecessor's selection, and the continuation run carries it", async () => {
    const h = await candidateCase(); try {
      await commitCandidate(h.store, h.candidate);
      freezeAgent(h.store, "work_items", "T1", AGENT_B);
      freezeAgent(h.store, "runs", h.claim.runId, AGENT_B);
      const { port, asked } = recording({
        listAgents: async () => ({ installations: [] }), readEvidence: async () => Buffer.alloc(0),
        accept: async (input) => ({ kind: "accepted", executionId: "continued", configHash: input.claim.configHash }),
        inspect: async (input) => ({ kind: "accepted", executionId: "continued", configHash: input.claim.configHash }),
        requestHandoff: async (_input, request) => ({ kind: "latched", requestId: request.requestId }),
        collect: async () => ({ events: [], candidate: null, terminal: null }),
      });
      const next = await new ControlService(h.store, port).continueTask("g1", "T1", { commandId: "continue", expectedRevision: 3 });
      expect(asked.length).toBeGreaterThan(0);
      expect(asked.every((partial) => JSON.stringify(partial) === JSON.stringify(AGENT_B))).toBe(true);
      expect(asked[0]).toEqual(AGENT_B);
      expect(readRun(h.store, next.runId).agent).toEqual(AGENT_B);
    } finally { await h.dispose(); }
  });
});
