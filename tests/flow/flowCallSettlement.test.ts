/**
 * Flow call settlement (spec docs/superpowers/specs/2026-11-01-flow-call-unknown-usage-settlement-design.md; human
 * rulings, session 43913afc: 「同意顺序」 with D1 (a) keep the pool finite). A flow call the driver blocked at C because its
 * usage is unknown (`flow-call-usage-unknown[:<failure>]`) could only be stopped: the execution waited on it for good. Now
 * the owner settles it as a requirement call is settled -- run-scoped recovery-retry acknowledging the charge of the
 * remaining grant -- and the kind's own retry rule then runs. The driver here is the real one, over a synthetic ccloop.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FrozenSlot } from "../../src/control/agentSelection.js";
import { groupUsageUnknown } from "../../src/control/budget.js";
import { withCommandContext } from "../../src/control/commandClient.js";
import { createExecutionDriver, type ExecutionDriverDeps } from "../../src/control/executionDriver.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { WebControlService } from "../../src/control/webService.js";
import { controlWorkspaceRoots } from "../../src/control/workspace.js";
import { createFlowCallPort } from "../../src/flow/calls.js";
import { executionSpend } from "../../src/flow/spend.js";
import { getFlowRun } from "../../src/flow/store.js";
import { singleCallPort, type SingleCallOptions } from "../control/fixtures/estimateHarness.js";
import { profileSnapshot, webFixture } from "../control/fixtures/web.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const TEMPLATE = { yaml: "format: orca-flow-v1\nid: one\nworkspace: {kind: dir}\nbudget: {tokensPerRun: 3000000}\nsteps:\n  - {id: outline, kind: draft, prompt: p.md}\n", assets: { "p.md": "Outline the article.\n" } };
const OWNER = { client: "web", principal: "user:owner" };
const GRANT = 1_000_000;

async function world(options: SingleCallOptions) {
  const snapshot = profileSnapshot();
  const h = await webFixture(snapshot, [{ taskId: "a" }]);
  const slot = (h.deps.estimatorSlot as unknown as { slot: FrozenSlot }).slot;
  const binding = { profileId: "all", profileHash: h.frozen.profileHash };
  const w = await flowWorld({ one: TEMPLATE }, {
    harness: h, callPort: (store, now) => createFlowCallPort({ store, now }),
    confirmParent: async () => ({ call: { profile: binding, agentSlot: slot, maxOutputTokens: 8_000 }, children: null }),
  });
  const { flowRunId, groupId } = await w.start({ templateRef: "builtin/one" });
  const fake = singleCallPort(options, () => "unused");
  const deps: ExecutionDriverDeps = {
    store: h.store, router: createExecutionProfileRouter([resolveProfile(snapshot, fake.port)]), admissionGate: h.deps.admissionGate,
    roots: controlWorkspaceRoots(h.store.stateDir), resolveRepository: () => join(h.root, "repo"), ccloopBin: "/bin/false", agentsTablePath: join(h.root, "agents.json"),
  };
  const driver = createExecutionDriver(deps);
  const service = new WebControlService(h.deps);
  const run = () => {
    const row = h.store.db.prepare("SELECT id, active, body FROM runs WHERE group_id=? ORDER BY rowid DESC LIMIT 1").get(groupId)!;
    return { runId: String(row.id), active: Number(row.active), ...JSON.parse(String(row.body)) };
  };
  const parent = () => JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body));
  const blocked = async () => {
    await w.advance();
    for (let i = 0; i < 30 && run().state !== "blocked"; i += 1) await driver.round();
    expect(run()).toMatchObject({ state: "blocked", purpose: "flow-draft", unknown: { work: true } });
  };
  const settle = (runId: string, as: typeof OWNER | null = OWNER) => {
    const command = { schema: "orca-raw-command-v1", commandId: `c-settle-${runId}`, actorId: "human",
      expectedRevision: Number(h.store.db.prepare("SELECT revision FROM groups WHERE id=?").get(groupId)!.revision), verb: "recovery-retry",
      target: { kind: "run", groupId, runId }, payload: { scope: "run", runId, acknowledge: "charge-remaining-grant" } };
    return as === null ? service.recoveryRetry(command as never) : withCommandContext(command.commandId, as, () => service.recoveryRetry(command as never));
  };
  return { h, w, flowRunId, groupId, run, parent, blocked, settle, driver };
}

describe("settling a flow call blocked on unknown usage", () => {
  // mutation: keep flow calls out of settleableSingleCallBlock -> refused run-usage-not-settleable -> red
  // mutation: drop the settled-call rule in giveBack -> the pool gets the draw back -> pool_drawn 0 -> red
  it("charges the grant, clears the parent's unknown usage, keeps the pool's draw, and hands the execution the failure", async () => {
    const x = await world({ outcome: "failed", tokens: null, errorCode: "omp-stalled", recordExtra: { usageLowerBound: { tokens: 1_234 } } });
    try {
      await x.blocked();
      const blocked = x.run();
      expect(blocked.drive).toMatchObject({ blockedAt: "C", blockedReason: "flow-call-usage-unknown:omp-stalled" });
      expect(blocked.singleCallUsageLowerBound).toEqual({ tokens: 1_234 });
      expect(groupUsageUnknown(x.h.store, x.groupId)).toBe(true);
      expect(getFlowRun(x.w.store, x.flowRunId)!.poolDrawn).toBe(GRANT);
      // Spec §5: the run page offers the charge on the execution's call row, with the amount, the floor and the parent.
      const revision = Number(x.h.store.db.prepare("SELECT revision FROM groups WHERE id=?").get(x.groupId)!.revision);
      expect(executionSpend(x.w.store, x.w.latest(x.flowRunId, "outline")!).runs).toEqual([
        { runId: blocked.runId, purpose: "flow-draft", tokens: null, charge: { groupId: x.groupId, revision, tokens: GRANT, usageLowerBound: 1_234 } }]);
      expect(await x.settle(blocked.runId)).toMatchObject({ result: { kind: "recovery-observed", resolved: true } });
      expect(executionSpend(x.w.store, x.w.latest(x.flowRunId, "outline")!).runs).toEqual([{ runId: blocked.runId, purpose: "flow-draft", tokens: GRANT }]);
      expect(x.run()).toMatchObject({ runId: blocked.runId, active: 0, state: "settled-restartable", unknown: { work: false, handoff: false },
        singleCallSettlement: { method: "remaining-grant", principal: "user:owner", blockedReason: "flow-call-usage-unknown:omp-stalled", usageLowerBound: { tokens: 1_234 }, disposition: "completed" } });
      expect(groupUsageUnknown(x.h.store, x.groupId)).toBe(false);
      expect(x.parent()).toMatchObject({ used: { tokens: GRANT }, reserved: { tokens: 0 } });
      // The charge is the claim that the grant was spent: the pool keeps the whole draw.
      expect(getFlowRun(x.w.store, x.flowRunId)!.poolDrawn).toBe(GRANT);
      // The execution learns the call failed with ccloop's code, and never sees an output.
      expect(x.w.latest(x.flowRunId, "outline")!.body).toMatchObject({ callResult: { runId: blocked.runId, rawOutput: null, failure: "omp-stalled" } });
      await x.w.advance();
      expect((x.w.latest(x.flowRunId, "outline")!.body as { call?: { runId?: string } }).call?.runId).not.toBe(blocked.runId);
    } finally { await x.w.dispose(); }
  });

  // mutation: pass the call's output to storeResult -> rawOutput is ccloop's answer -> red
  it("a call that completed with unknown usage is recorded as flow-call-usage-unknown, its output never reaching the kind", async () => {
    const x = await world({ outcome: "complete", tokens: null, output: () => ({ content: "An outline." }) });
    try {
      await x.blocked();
      const blocked = x.run();
      expect(blocked.drive).toMatchObject({ blockedReason: "flow-call-usage-unknown" });
      expect(await x.settle(blocked.runId)).toMatchObject({ result: { resolved: true } });
      expect(x.w.latest(x.flowRunId, "outline")!.body).toMatchObject({ callResult: { runId: blocked.runId, rawOutput: null, failure: "flow-call-usage-unknown" } });
    } finally { await x.w.dispose(); }
  });

  it("a settlement with no authenticated owner is refused and changes nothing", async () => {
    const x = await world({ outcome: "failed", tokens: null, errorCode: "omp-stalled" });
    try {
      await x.blocked();
      const before = x.run();
      const answer = await x.settle(before.runId, null) as { error?: { code: string; message?: string } };
      expect(answer.error).toMatchObject({ code: "run-usage-not-settleable" });
      expect(answer.error!.message).toContain("owner-required");
      expect(x.run()).toMatchObject({ state: "blocked", unknown: { work: true } });
      expect(groupUsageUnknown(x.h.store, x.groupId)).toBe(true);
    } finally { await x.w.dispose(); }
  });
});
