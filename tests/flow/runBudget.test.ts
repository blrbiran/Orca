/**
 * Flow engine spec §6.3, §21 C15 (BC-B2, IR-C2): one run budget pool per flow run. Each child is confirmed with an
 * allocation drawn from the pool (the step's `budget.tokens`, else an even share of what remains) and gives back what it
 * did not spend; there is no estimate call; a pool that cannot fund the next execution parks only that run, with a
 * `flow-pool-exhausted` needs-you item, while another run goes on. Without this a flow could spend past what the person
 * granted, or one run's empty pool would stall every other run.
 */
import { describe, expect, it } from "vitest";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { getFlowRun } from "../../src/flow/store.js";
import { fakeChildPort } from "./fixtures/childPort.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const template = (pool: number, firstBudget: number) => ({
  yaml: `format: orca-flow-v1
id: w${pool}
workspace: {kind: dir}
budget: {tokensPerRun: ${pool}}
steps:
  - {id: write, kind: work, prompt: prompts/write.md, budget: {tokens: ${firstBudget}}}
  - {id: polish, kind: work, prompt: prompts/polish.md}
`,
  assets: { "prompts/write.md": "Write article.md.\n", "prompts/polish.md": "Polish article.md.\n" },
});

describe("run budget pool (C15)", () => {
  it("each child is opened with an allocation drawn from the pool and returns what it did not spend; no estimate", async () => {
    const children = fakeChildPort();
    const w = await flowWorld({ w100000: template(100_000, 60_000) }, { children: children.port }); try {
      const { flowRunId, groupId } = await w.start({ templateRef: "builtin/w100000" });
      await w.advance();
      const first = childGroupIdOf(flowRunId, "write", 1);
      expect([...children.opened.keys()]).toEqual([first]);
      expect(children.opened.get(first)!.work.tokens).toBe(60_000);
      expect(getFlowRun(w.store, flowRunId)!.poolDrawn).toBe(60_000);
      expect(w.latest(flowRunId, "write")).toMatchObject({ state: "running", childGroupId: first });
      children.land(first, { "article.md": "draft\n" }, { spentTokens: 20_000 });
      await w.advance();
      expect(w.latest(flowRunId, "write")).toMatchObject({ state: "done", outputKind: "commit" });
      // 40,000 unspent came back; the next child takes an even share of the 80,000 left (one work step left).
      const second = childGroupIdOf(flowRunId, "polish", 1);
      expect(children.opened.get(second)!.work.tokens).toBe(80_000);
      expect(getFlowRun(w.store, flowRunId)!.poolDrawn).toBe(20_000 + 80_000);
      expect(w.store.db.prepare("SELECT count(*) AS n FROM estimates WHERE group_id=?").get(groupId)).toMatchObject({ n: 0 });
    } finally { await w.dispose(); }
  });

  it("an exhausted pool parks only that run with a flow-pool-exhausted item; another run proceeds", async () => {
    const children = fakeChildPort();
    const w = await flowWorld({ w50000: template(50_000, 60_000), w900000: template(900_000, 60_000) }, { children: children.port }); try {
      const poor = await w.start({ templateRef: "builtin/w50000" });
      const rich = await w.start({ templateRef: "builtin/w900000" });
      await w.advance();
      expect(w.latest(poor.flowRunId, "write")).toMatchObject({ state: "parked", childGroupId: null });
      expect((w.latest(poor.flowRunId, "write")!.body as { needsYou: unknown }).needsYou).toMatchObject({ reason: "flow-pool-exhausted" });
      expect(getFlowRun(w.store, poor.flowRunId)!.poolDrawn).toBe(0);
      expect(w.execs(poor.flowRunId, "polish")).toEqual([]);
      expect([...children.opened.keys()]).toEqual([childGroupIdOf(rich.flowRunId, "write", 1)]);
      expect(w.latest(rich.flowRunId, "write")).toMatchObject({ state: "running" });
    } finally { await w.dispose(); }
  });
});
