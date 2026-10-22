/**
 * Flow engine plan Review Focus 3 (spec §6.2): the child id `flow-<run>-<step>-<seq>` is deterministic and its open
 * idempotent, so a kernel restarted while a child is running -- or between dispatching it and recording that it did --
 * finds the same child: one dispatch and one draw in total. A second dispatch would run (and pay for) the work twice.
 */
import { describe, expect, it } from "vitest";
import { advanceFlowRuns } from "../../src/flow/kernel.js";
import { builtinKinds } from "../../src/flow/kinds/registry.js";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { getFlowRun } from "../../src/flow/store.js";
import { fakeChildPort } from "./fixtures/childPort.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const T = { w: { yaml: `format: orca-flow-v1
id: w
workspace: {kind: dir}
budget: {tokensPerRun: 100000}
steps:
  - {id: write, kind: work, prompt: p.md, budget: {tokens: 30000}}
`, assets: { "p.md": "Write.\n" } } };

describe("restart mid-execution (Review Focus 3)", () => {
  it("a restarted kernel finds the running child: same id, one dispatch", async () => {
    const children = fakeChildPort();
    const w = await flowWorld(T, { children: children.port }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/w" });
      await w.advance();
      // A fresh kernel over the same store (new registry, same port): nothing is opened again.
      const restarted = { ...w.deps, registry: builtinKinds() };
      await advanceFlowRuns(restarted);
      await advanceFlowRuns(restarted);
      expect(children.counts()).toEqual({ opens: 1, dispatches: 1 });
      expect(w.execs(flowRunId, "write").map((e) => [e.seq, e.state, e.childGroupId])).toEqual([[1, "running", childGroupIdOf(flowRunId, "write", 1)]]);
      children.land(childGroupIdOf(flowRunId, "write", 1), { "a.md": "a\n" }, { spentTokens: 30_000 });
      await advanceFlowRuns(restarted);
      expect(w.latest(flowRunId, "write")).toMatchObject({ state: "done" });
    } finally { await w.dispose(); }
  });

  it("a crash between the dispatch and its record: the restart reopens the same child id and draws nothing twice", async () => {
    const children = fakeChildPort();
    const w = await flowWorld(T, { children: children.port }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/w" });
      children.failNextOpen();
      await expect(w.advance()).rejects.toThrow(/crash after the dispatch/);
      expect(w.latest(flowRunId, "write")).toMatchObject({ state: "running", childGroupId: null });
      await advanceFlowRuns({ ...w.deps, registry: builtinKinds() });
      expect(children.counts()).toEqual({ opens: 2, dispatches: 1 });
      expect(w.latest(flowRunId, "write")).toMatchObject({ state: "running", childGroupId: childGroupIdOf(flowRunId, "write", 1) });
      expect(w.execs(flowRunId, "write")).toHaveLength(1);
      expect(getFlowRun(w.store, flowRunId)!.poolDrawn).toBe(30_000);
    } finally { await w.dispose(); }
  });
});
