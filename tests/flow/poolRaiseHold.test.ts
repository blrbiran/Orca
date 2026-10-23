/**
 * Gaps spec §6.3 (final review I1, ledger R2-O1): raising the pool is a budget act, not a release. An effect step parked
 * on an exhausted pool that a standing defer has since come to hold stays held when the person raises the pool: it is
 * parked `deferred-upstream` (what the run page already shows, views.ts heldBy), its `confirmed` effect record is closed
 * (`discarded`) so nothing dangles, and only a release (here `defer … proceed`, with the person's authority) starts it --
 * as a new execution through its own level gate, with one live record.
 *
 * Scenario (the final review's probe, tests/flow/finalProbeR2O1.test.ts in its clone): `write` uses up the pool, `push`
 * (external, apply-flag) passes its gate and parks on the empty pool; the person defers `write`; the person raises.
 */
import { describe, expect, it } from "vitest";
import { WebControlService } from "../../src/control/webService.js";
import { DEFERRED_UPSTREAM } from "../../src/flow/kernel.js";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { acceptMessage } from "../../src/flow/messages.js";
import { POOL_EXHAUSTED } from "../../src/flow/pool.js";
import { listEffects, listExecutions } from "../../src/flow/store.js";
import { readFlowList } from "../../src/flow/views.js";
import { fakeChildPort } from "./fixtures/childPort.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const TPL = { yaml: `format: orca-flow-v1
id: e
workspace: {kind: dir}
budget: {tokensPerRun: 1000}
effects:
  wechat-draft: {class: external}
steps:
  - {id: write, kind: work, prompt: write.md, budget: {tokens: 1000}}
  - {id: push, kind: work, prompt: push.md, effect: wechat-draft}
`, assets: { "write.md": "Write.\n", "push.md": "Push it.\n" } };

async function poolParkedPush() {
  const children = fakeChildPort();
  const w = await flowWorld({ e: TPL }, { children: children.port });
  const service = new WebControlService({ store: w.store, port: {} as never, profileRouter: {} as never, trustedConfig: {} as never, flowDeps: () => w.deps,
    flowProjects: () => [{ repoId: "articles-00000000", path: w.folder }] } as never);
  const { flowRunId } = await w.start({ templateRef: "builtin/e" });
  await w.advance();
  children.land(childGroupIdOf(flowRunId, "write", 1), { "a.md": "x\n" }, { spentTokens: 1000 });
  await w.advance();
  const push = () => listExecutions(w.store, flowRunId).filter((e) => e.stepKey === "push");
  // The setup the scenario needs: push passed its gate (record confirmed) and parked on the empty pool.
  expect(push().map((e) => [e.seq, e.state, (e.body as { needsYou?: { reason?: string } }).needsYou?.reason])).toEqual([[1, "parked", POOL_EXHAUSTED]]);
  expect(listEffects(w.store, flowRunId).map((r) => r.state)).toEqual(["confirmed"]);
  let n = 0;
  const personMark = (stepKey: string, body: Record<string, unknown>) =>
    acceptMessage(w.deps, flowRunId, { kind: "command", target: { kind: "step", stepKey }, body, by: "ann", via: "cli:test", requestId: `p${++n}`, personAuthority: true });
  const raise = (tokens: number) => service.flowCommand({ schema: "orca-raw-command-v1", commandId: `pool-${++n}`, actorId: "owner", expectedRevision: 0, verb: "flow-pool",
    target: { kind: "flows" }, payload: { runId: flowRunId, raiseTokens: tokens } } as never);
  return { w, children, flowRunId, push, personMark, raise };
}

describe("a pool raise keeps a held effect held (gaps §6.3, final review I1)", () => {
  it("a raise re-parks the held push deferred-upstream and closes its record; defer … proceed then starts it afresh through its gate", { timeout: 60_000 }, async () => {
    const { w, children, flowRunId, push, personMark, raise } = await poolParkedPush();
    try {
      expect(await personMark("write", { command: "defer" })).toMatchObject({ state: "applied" });
      await w.advance();
      expect(await raise(5000)).toMatchObject({ result: { kind: "flow-pool-raised" } });
      await w.advance();
      // mutation: drop the hold check in raisePool -> push child opened, push#1 running, red
      expect([...children.opened.keys()]).not.toContain(childGroupIdOf(flowRunId, "push", 1));
      expect(push().map((e) => [e.seq, e.state, (e.body as { needsYou?: unknown }).needsYou])).toEqual([[1, "parked", { kind: DEFERRED_UPSTREAM, deferred: ["write"] }]]);
      // mutation: keep the confirmed record open at the re-park -> ["confirmed", "confirmed"] after the release below, red
      expect(listEffects(w.store, flowRunId).map((r) => r.state)).toEqual(["discarded"]);
      // The person releases it: a new execution, gated afresh (apply-flag: a new confirmed record), its child opened.
      expect(await personMark("write", { command: "defer", effects: { push: "proceed" } })).toMatchObject({ state: "applied" });
      await w.advance();
      expect(push().map((e) => `${e.seq}:${e.state}`)).toEqual(["1:skipped", "2:running"]);
      expect([...children.opened.keys()]).toContain(childGroupIdOf(flowRunId, "push", 2));
      expect(listEffects(w.store, flowRunId).map((r) => `${r.seq}:${r.state}`)).toEqual(["1:discarded", "2:confirmed"]);
    } finally { await w.dispose(); }
  });

  it("a raise with no standing hold resumes the pool-parked push as before (the hold check blocks only a held step)", { timeout: 60_000 }, async () => {
    const { w, children, flowRunId, push, raise } = await poolParkedPush();
    try {
      expect(await raise(5000)).toMatchObject({ result: { kind: "flow-pool-raised" } });
      await w.advance();
      // mutation: re-park every pool-parked effect step at a raise -> push#1 parked, no child, red
      expect(push().map((e) => `${e.seq}:${e.state}`)).toEqual(["1:running"]);
      expect([...children.opened.keys()]).toContain(childGroupIdOf(flowRunId, "push", 1));
      expect(listEffects(w.store, flowRunId).map((r) => r.state)).toEqual(["confirmed"]);
    } finally { await w.dispose(); }
  });

  it("needs-you counts a defer holding a parked step once (final review M6)", { timeout: 60_000 }, async () => {
    const { w, flowRunId, push, personMark, raise } = await poolParkedPush();
    try {
      await personMark("write", { command: "defer" });
      await w.advance();
      await raise(5000);
      await w.advance();
      expect(push().map((e) => `${e.seq}:${e.state}`)).toEqual(["1:parked"]);
      // One thing owed: fill (or release) the deferred write. mutation: count deferred-upstream parks again -> 2, red
      expect(readFlowList(w.store).runs.find((r) => r.flowRunId === flowRunId)).toMatchObject({ needsYou: 1 });
    } finally { await w.dispose(); }
  });
});
