/**
 * Flow engine spec §6.2-§6.3 (plan Task 10; Task 8 deferral (a)): a flow run's single calls run on its parent group
 * through the driver's single-call chain, each funded by a draw from the run pool. The claim freezes the prompt and puts
 * a `starting` single-call run on the parent's frozen profile and slot; the driver's A2 asks the purpose handler for that
 * very prompt; the settlement gives the unspent grant back (parent ledger and pool) and leaves the raw output on the
 * execution, which the kernel's next pass judges through the kind. Without this no draft, review or ask call could run
 * outside a criterion's fake port, or it would run unfunded.
 */
import { describe, expect, it } from "vitest";
import type { FrozenSlot } from "../../src/control/agentSelection.js";
import { singleCallHandler } from "../../src/control/singleCallPurposes.js";
import { createFlowCallPort } from "../../src/flow/calls.js";
import { getFlowRun } from "../../src/flow/store.js";
import { profileSnapshot, webFixture } from "../control/fixtures/web.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const TEMPLATE = { yaml: "format: orca-flow-v1\nid: one\nworkspace: {kind: dir}\nbudget: {tokensPerRun: 3000000}\nsteps:\n  - {id: outline, kind: draft, prompt: p.md}\n", assets: { "p.md": "Outline the article.\n" } };

async function world(pool?: number) {
  const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]);
  const slot = (h.deps.estimatorSlot as unknown as { slot: FrozenSlot }).slot;
  const binding = { profileId: "all", profileHash: h.frozen.profileHash };
  const w = await flowWorld({ one: TEMPLATE }, {
    harness: h, callPort: (store, now) => createFlowCallPort({ store, now }),
    confirmParent: async () => ({ call: { profile: binding, agentSlot: slot, maxOutputTokens: 8_000 }, children: null }),
  });
  const started = await w.start({ templateRef: "builtin/one", ...(pool === undefined ? {} : { pool }) });
  return { h, w, ...started };
}
const callRuns = (w: Awaited<ReturnType<typeof world>>["w"], groupId: string) => w.store.db.prepare("SELECT id, active, body FROM runs WHERE group_id=? ORDER BY rowid").all(groupId)
  .map((row) => ({ id: String(row.id), active: Number(row.active), body: JSON.parse(String(row.body)) }));
const groupBody = (w: Awaited<ReturnType<typeof world>>["w"], groupId: string) => JSON.parse(String(w.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body));

describe("flow single calls on the parent (§6.2)", () => {
  it("a draft call is claimed on the parent from the pool, prepared with its prompt, settled back into the pool, and judged by the kernel", async () => {
    const { w, flowRunId, groupId } = await world(); try {
      await w.advance();
      const [run] = callRuns(w, groupId);
      expect(run).toMatchObject({ active: 1, body: { phase: "single-call", purpose: "flow-draft", state: "starting", flowCall: { flowRunId, stepKey: "outline", seq: 1 } } });
      expect(run!.body.grant.work.tokens).toBe(1_000_000);
      expect(getFlowRun(w.store, flowRunId)!.poolDrawn).toBe(1_000_000);
      expect(groupBody(w, groupId).reserved.tokens).toBe(1_000_000);
      expect(w.latest(flowRunId, "outline")).toMatchObject({ state: "running", body: { call: { purpose: "flow-draft", runId: run!.id } } });
      // A2: the handler answers the frozen prompt, capped by the parent's frozen output bound.
      const handler = singleCallHandler("flow-draft");
      const prepared = await handler.prepare({ store: w.store } as never, { ...run!.body });
      expect(prepared).toMatchObject({ maxOutputTokens: 8_000, responseSchema: { required: ["content"] } });
      expect((prepared as { prompt: string }).prompt).toContain("Outline the article.");
      // Ce: the call stopped having spent nothing; the grant goes back and the output waits on the execution.
      const settle = () => handler.complete({ store: w.store }, { ...run!.body }, { content: "An outline." }, () => {
        const row = JSON.parse(String(w.store.db.prepare("SELECT body FROM runs WHERE id=?").get(run!.id)!.body));
        w.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...row, state: "settled-restartable" }), run!.id);
      });
      settle();
      expect(callRuns(w, groupId)[0]!.active).toBe(0);
      expect(getFlowRun(w.store, flowRunId)!.poolDrawn).toBe(0);
      expect(groupBody(w, groupId).reserved.tokens).toBe(0);
      expect(w.latest(flowRunId, "outline")!.state).toBe("running");
      settle(); // a replay is a no-op (the receipt)
      await w.advance();
      expect(w.latest(flowRunId, "outline")).toMatchObject({ state: "done", outputKind: "artifact" });
      expect((w.latest(flowRunId, "outline")!.body as Record<string, unknown>).callResult).toBeUndefined();
      expect(getFlowRun(w.store, flowRunId)!.state).toBe("done");
    } finally { await w.dispose(); }
  });

  it("a pool that cannot fund the call parks only that execution with flow-pool-exhausted; no run is claimed", async () => {
    const { w, flowRunId, groupId } = await world(1); try {
      await w.store.db.prepare("UPDATE flow_runs SET pool_drawn=1 WHERE id=?").run(flowRunId);
      await w.advance();
      expect(callRuns(w, groupId)).toEqual([]);
      expect(w.latest(flowRunId, "outline")).toMatchObject({ state: "parked", body: { needsYou: { reason: "flow-pool-exhausted" } } });
    } finally { await w.dispose(); }
  });

  it("a parent confirmed without a call profile fails the execution flow-call-unconfirmed; nothing is drawn", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]);
    const w = await flowWorld({ one: TEMPLATE }, { harness: h, callPort: (store, now) => createFlowCallPort({ store, now }) }); try {
      const { flowRunId, groupId } = await w.start({ templateRef: "builtin/one" });
      await w.advance();
      expect(callRuns(w, groupId)).toEqual([]);
      expect(w.latest(flowRunId, "outline")).toMatchObject({ state: "failed", body: { failure: "flow-call-unconfirmed" } });
      expect(getFlowRun(w.store, flowRunId)!.poolDrawn).toBe(0);
    } finally { await w.dispose(); }
  });
});
