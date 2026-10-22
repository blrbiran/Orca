import { describe, expect, it } from "vitest";
import { WebControlService } from "../../src/control/webService.js";
import { FlowRefusal } from "../../src/flow/kernel.js";
import { acceptMessage } from "../../src/flow/messages.js";
import { discardPlan, proposePlan } from "../../src/flow/rerun.js";
import { getFlowRun, listMessages, listPlans } from "../../src/flow/store.js";
import { flowWorld } from "./fixtures/flowWorld.js";

/**
 * Flow engine spec §7.4, §8.1 (T18 enact, finding C): a plan the person has not run holds their run (it is their own
 * revision request), and until now the only way out was to run it. In the acceptance run plan 1 -- from the person's
 * "warmer voice" feedback -- held the run while the person only wanted the draft box retried; nothing could discard it
 * short of re-running five steps. Discarding closes the plan (`abandoned`), records who did it, and withdraws the
 * feedback that made it: those messages become `excluded` (§8.1 states), so the next plan does not carry them in and a
 * later rewind does not re-apply them. Messages only move forward (applied -> excluded); returning them to "accepted"
 * would make the very next boundary build the same plan again. A plan that is not the open, proposed one is refused.
 */
const TPL = { t: { yaml: `format: orca-flow-v1
id: t
workspace: {kind: dir}
steps:
  - {id: voice, kind: draft, prompt: voice.md}
  - {id: after, kind: draft, prompt: after.md}
`, assets: { "voice.md": "Voice.\n", "after.md": "After.\n" } } };

async function proposed() {
  const w = await flowWorld(TPL);
  const { flowRunId } = await w.start({ templateRef: "builtin/t" });
  await w.advance();
  await w.answer(0, { content: "voice" });
  await w.answer(1, { content: "after" });
  expect(getFlowRun(w.store, flowRunId)!.state).toBe("done");
  await acceptMessage(w.deps, flowRunId, { kind: "feedback", target: { kind: "step", stepKey: "voice" }, body: { text: "warmer" }, by: "ann", via: "cli:test", requestId: "fb-1" });
  await w.answer(w.calls.length - 1, { skips: [] });
  expect(listPlans(w.store, flowRunId).map((p) => [p.planNo, p.state])).toEqual([[1, "proposed"]]);
  expect(getFlowRun(w.store, flowRunId)!.state).toBe("running");
  return { w, flowRunId };
}

describe("discarding an open plan (§7.4, T18 finding C)", () => {
  it("closes the plan, excludes its feedback, and the run settles without running anything", async () => {
    const { w, flowRunId } = await proposed(); try {
      const calls = w.calls.length;
      await discardPlan(w.deps, flowRunId, 1, "ann", "cli:test");
      expect(listPlans(w.store, flowRunId).map((p) => [p.planNo, p.state])).toEqual([[1, "abandoned"]]);
      const messages = listMessages(w.store, flowRunId);
      expect(messages.find((m) => m.requestId === "fb-1")).toMatchObject({ state: "excluded", reason: "excluded by discarding plan 1" });
      expect(messages.find((m) => m.requestId === "discard-plan:1")).toMatchObject({ kind: "command", state: "applied", by: "ann", via: "cli:test", body: { command: "discard-plan", planNo: 1, excluded: [messages.find((m) => m.requestId === "fb-1")!.seq] } });
      expect(getFlowRun(w.store, flowRunId)!.state).toBe("done");
      expect(w.calls.length).toBe(calls);
      expect(w.execs(flowRunId, "voice")).toHaveLength(1);
      // The next plan does not carry the withdrawn feedback in.
      await proposePlan(w.deps, flowRunId, "ann", "cli:test");
      expect(listPlans(w.store, flowRunId).at(-1)!.candidates).toMatchObject({ feedback: {} });
    } finally { await w.dispose(); }
  });

  it("is the human-only flow-rerun verb with discard: the command discards; discard with skip or add is refused", async () => {
    const { w, flowRunId } = await proposed(); try {
      const service = new WebControlService({ store: w.store, port: {} as never, profileRouter: {} as never, trustedConfig: {} as never, flowDeps: () => w.deps } as never);
      const send = async (commandId: string, payload: unknown) => (await service.flowCommand({ schema: "orca-raw-command-v1", commandId, actorId: "owner", expectedRevision: 0, verb: "flow-rerun", target: { kind: "flows" }, payload } as never)) as { result?: unknown; error?: { code: string } };
      expect((await send("d-1", { runId: flowRunId, planNo: 1, discard: true, skip: ["after"] })).error?.code).toBe("control-argument-invalid");
      expect(listPlans(w.store, flowRunId).map((p) => p.state)).toEqual(["proposed"]);
      expect((await send("d-2", { runId: flowRunId, planNo: 1, discard: true })).result).toEqual({ kind: "flow-plan-discarded", flowRunId, planNo: 1 });
      expect(listPlans(w.store, flowRunId).map((p) => p.state)).toEqual(["abandoned"]);
      expect(w.execs(flowRunId, "voice")).toHaveLength(1);
    } finally { await w.dispose(); }
  });

  it("refuses a plan that is not the open proposed one (flow-plan-stale), and a second discard", async () => {
    const { w, flowRunId } = await proposed(); try {
      await expect(discardPlan(w.deps, flowRunId, 2, "ann", "cli:test")).rejects.toThrow(FlowRefusal);
      await expect(discardPlan(w.deps, flowRunId, 2, "ann", "cli:test")).rejects.toThrow(/flow-plan-stale/);
      await discardPlan(w.deps, flowRunId, 1, "ann", "cli:test");
      await expect(discardPlan(w.deps, flowRunId, 1, "ann", "cli:test")).rejects.toThrow(/flow-plan-stale/);
      expect(listMessages(w.store, flowRunId).filter((m) => m.requestId.startsWith("discard-plan:"))).toHaveLength(1);
    } finally { await w.dispose(); }
  });
});
