/**
 * Gaps spec §10 (G9): spend is the tool's numbers only (P7, Rule 14). A single call's tokens are its driver run's
 * `cumulative.work.tokens`; a child group's are the sum over its runs. Each execution, step, feedback intake, plan and
 * the run shows `{tokens | null, unknownReason, usd: null, usdReason, runs}` computed at read time. A run whose usage
 * the tool did not report -- or reported as `0` -- is unknown, never zero; a sum over a mix shows the known part with
 * "partial: n runs unknown". No money amount exists, so `usd` is always null with the fixed reason; allocations and
 * pool draws are never shown as spend. Every call result is a fake: the criterion settles the driver's single-call runs
 * through the handler and writes the tool's usage onto the run rows afterwards (spend reads them at read time).
 *
 * Why it matters: a person deciding whether a re-run is worth it reads these numbers; a 0 for "unknown" or an
 * allocation shown as spend would be a number the tool never gave (spec §2.3 anti-goal, G9's mutations).
 */
import { describe, expect, it } from "vitest";
import type { FrozenSlot } from "../../src/control/agentSelection.js";
import { singleCallHandler } from "../../src/control/singleCallPurposes.js";
import { createFlowCallPort } from "../../src/flow/calls.js";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { acceptMessage } from "../../src/flow/messages.js";
import { sumSpend, USD_REASON, type Spend } from "../../src/flow/spend.js";
import { getIntake, listPlans } from "../../src/flow/store.js";
import { readFlowRun } from "../../src/flow/views.js";
import { profileSnapshot, webFixture } from "../control/fixtures/web.js";
import { fakeChildPort } from "./fixtures/childPort.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const TPL = {
  yaml: `format: orca-flow-v1
id: sp
version: 1
workspace: {kind: dir}
budget: {tokensPerRun: 3000000}
steps:
  - {id: outline, kind: draft, prompt: o.md}
  - {id: write, kind: work, prompt: w.md}
`,
  assets: { "o.md": "Outline the article.\n", "w.md": "Write post.md.\n" },
};
const POST = "# Tea\n\nTea slows you down and that is good.\n\nEngineers think better with a warm cup.\n";

type View = {
  spend: Spend;
  steps: Array<{ stepKey: string; spend: Spend; executions: Array<{ seq: number; spend: Spend }> }>;
  plans: Array<{ planNo: number; spend: Spend }>;
  intakes: Array<{ messageSeq: number; state: string; spend: Spend }>;
};

async function world() {
  const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]);
  const slot = (h.deps.estimatorSlot as unknown as { slot: FrozenSlot }).slot;
  const binding = { profileId: "all", profileHash: h.frozen.profileHash };
  const children = fakeChildPort();
  const w = await flowWorld({ sp: TPL }, {
    harness: h, children: children.port, callPort: (store, now) => createFlowCallPort({ store, now }),
    confirmParent: async () => ({ call: { profile: binding, agentSlot: slot, maxOutputTokens: 8_000 }, children: null }),
  });
  const started = await w.start({ templateRef: "builtin/sp" });
  return { w, children, ...started };
}
type World = Awaited<ReturnType<typeof world>>;

const runRows = (w: World["w"], groupId: string) => w.store.db.prepare("SELECT id, active, body FROM runs WHERE group_id=? ORDER BY rowid").all(groupId)
  .map((row) => ({ id: String(row.id), active: Number(row.active), body: JSON.parse(String(row.body)) as Record<string, unknown> }));

/** Settle the open single call of `purpose` with this (fake) output; the run spent nothing yet (usage is set after). */
async function settle(t: World, purpose: string, output: unknown): Promise<string> {
  const run = runRows(t.w, t.groupId).filter((r) => r.active === 1 && r.body.purpose === purpose).at(-1);
  if (run === undefined) throw new Error(`no open ${purpose} call`);
  singleCallHandler(purpose as "flow-draft").complete({ store: t.w.store }, { ...run.body } as never, output, () => {
    const row = JSON.parse(String(t.w.store.db.prepare("SELECT body FROM runs WHERE id=?").get(run.id)!.body));
    t.w.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...row, state: "settled-restartable" }), run.id);
  });
  await t.w.advance();
  return run.id;
}

/** The tool's usage report on a run row: a token count, or `unknown` (the tool reported none). */
function report(w: World["w"], runId: string, usage: number | "unknown"): void {
  const body = JSON.parse(String(w.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body)) as { cumulative: { work: { tokens: number } }; unknown: { work: boolean } };
  if (usage === "unknown") body.unknown = { ...body.unknown, work: true };
  else body.cumulative = { ...body.cumulative, work: { ...body.cumulative.work, tokens: usage } };
  w.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(body), runId);
}

/** A child group's driver runs (phase `work`), as the execution driver keeps them. */
function childRun(w: World["w"], groupId: string, runId: string, tokens: number, unknown = false): void {
  w.store.db.prepare("INSERT INTO runs VALUES (?,?,?,1,0,?)").run(runId, groupId, `${runId}-item`, JSON.stringify({
    runId, groupId, phase: "work", state: "settled", cumulative: { work: { tokens, activeMs: 0, attempts: 1, sessions: 1 } }, unknown: { work: unknown, handoff: false },
  }));
}

const view = (w: World["w"], flowRunId: string) => readFlowRun(w.store, flowRunId) as View;
const step = (v: View, key: string) => v.steps.find((s) => s.stepKey === key)!;
const NONE = { usd: null, usdReason: "the tool reports no money amount" } as const;

/** outline's draft call answered once invalid, once valid; write's child landed with two driver runs. */
async function settledRun(): Promise<World & { draftRuns: string[] }> {
  const t = await world();
  await t.w.advance();
  const invalid = await settle(t, "flow-draft", { nonsense: true });
  const valid = await settle(t, "flow-draft", { content: "An outline." });
  const child = childGroupIdOf(t.flowRunId, "write", 1);
  childRun(t.w, child, "child-run-1", 30_000);
  childRun(t.w, child, "child-run-2", 12_000);
  t.children.land(child, { "post.md": POST }, { spentTokens: 42_000 });
  await t.w.advance();
  expect(t.w.latest(t.flowRunId, "write")!.state).toBe("done");
  return { ...t, draftRuns: [invalid, valid] };
}

describe("spend: only the tool's numbers (gaps §10, G9)", { timeout: 60_000 }, () => {
  it("an execution's spend is the sum of its call runs; its run ids survive completeFlowCall", async () => {
    const t = await settledRun(); try {
      const [invalid, valid] = t.draftRuns;
      report(t.w, invalid!, 900);
      report(t.w, valid!, 1_300);
      const outline = t.w.latest(t.flowRunId, "outline")!;
      expect(outline.state).toBe("done");
      // completeFlowCall deleted call/callResult; the calls list still names both driver runs.
      const body = outline.body as Record<string, unknown>;
      expect(body.callResult).toBeUndefined();
      expect(body.call).toBeUndefined();
      expect(body.calls).toEqual([{ runId: invalid, purpose: "flow-draft" }, { runId: valid, purpose: "flow-draft" }]);
      const v = view(t.w, t.flowRunId);
      expect(step(v, "outline").executions[0]!.spend).toEqual({
        tokens: 2_200, unknownReason: null, ...NONE, runs: [{ runId: invalid, purpose: "flow-draft", tokens: 900 }, { runId: valid, purpose: "flow-draft", tokens: 1_300 }],
      });
    } finally { await t.w.dispose(); }
  });

  it("a child group's spend equals the sum of its driver runs' tokens; the allocation is never shown", async () => {
    const t = await settledRun(); try {
      const v = view(t.w, t.flowRunId);
      const write = step(v, "write").executions[0]!.spend;
      expect(write).toEqual({
        tokens: 42_000, unknownReason: null, ...NONE, runs: [{ runId: "child-run-1", purpose: "work", tokens: 30_000 }, { runId: "child-run-2", purpose: "work", tokens: 12_000 }],
      });
      // The child was opened with an allocation drawn from the pool; that number appears nowhere in the spend.
      expect(t.children.opened.get(childGroupIdOf(t.flowRunId, "write", 1))!.work.tokens).not.toBe(42_000);
    } finally { await t.w.dispose(); }
  });

  it("a step sums its executions and the run sums every execution, intake and plan, each with its own call", async () => {
    const t = await settledRun(); try {
      const [invalid, valid] = t.draftRuns;
      report(t.w, invalid!, 900);
      report(t.w, valid!, 1_300);
      // Feedback on the run: one triage call answers the intake, one rerun-proposal call answers the plan, then write runs again.
      const sent = await acceptMessage(t.w.deps, t.flowRunId, { by: "ann", via: "cli:test", requestId: "fb-1", kind: "feedback", target: { kind: "run" },
        body: { text: "too sweet", anchors: [{ quote: "Engineers think better with a warm cup." }] } } as Parameters<typeof acceptMessage>[2]);
      const triage = await settle(t, "feedback-triage", { targets: [{ stepKey: "write", why: "write owns the text" }] });
      expect(getIntake(t.w.store, t.flowRunId, sent.seq)!.state).toBe("planned");
      const proposal = await settle(t, "rerun-proposal", { skips: [] });
      expect(listPlans(t.w.store, t.flowRunId)[0]!.state).toBe("running");
      report(t.w, triage, 4_000);
      report(t.w, proposal, 500);
      const second = childGroupIdOf(t.flowRunId, "write", 2);
      childRun(t.w, second, "child-run-3", 8_000);
      t.children.land(second, { "post.md": `${POST}\nLess sweet.\n` });
      await t.w.advance();
      const v = view(t.w, t.flowRunId);
      expect(v.intakes).toEqual([{ messageSeq: sent.seq, state: "planned", spend: { tokens: 4_000, unknownReason: null, ...NONE, runs: [{ runId: triage, purpose: "feedback-triage", tokens: 4_000 }] } }]);
      expect(v.plans.map((p) => [p.planNo, p.spend])).toEqual([[1, { tokens: 500, unknownReason: null, ...NONE, runs: [{ runId: proposal, purpose: "rerun-proposal", tokens: 500 }] }]]);
      expect(step(v, "write").executions.map((e) => e.spend.tokens)).toEqual([42_000, 8_000]);
      expect(step(v, "write").spend).toMatchObject({ tokens: 50_000, unknownReason: null, ...NONE });
      expect(step(v, "write").spend.runs.map((r) => r.runId)).toEqual(["child-run-1", "child-run-2", "child-run-3"]);
      expect(v.spend).toMatchObject({ tokens: 2_200 + 50_000 + 4_000 + 500, unknownReason: null, ...NONE });
      expect(v.spend.runs.map((r) => r.runId).sort()).toEqual([invalid, valid, "child-run-1", "child-run-2", "child-run-3", triage, proposal].sort());
    } finally { await t.w.dispose(); }
  });

  it("a run with unknown usage is null with a reason; a sum over it shows the known part and 'partial: n runs unknown'", async () => {
    const t = await settledRun(); try {
      const [invalid, valid] = t.draftRuns;
      report(t.w, invalid!, "unknown");
      report(t.w, valid!, 1_300);
      childRun(t.w, childGroupIdOf(t.flowRunId, "write", 1), "child-run-x", 0, true);
      const v = view(t.w, t.flowRunId);
      const outline = step(v, "outline").executions[0]!.spend;
      expect(outline).toEqual({ tokens: 1_300, unknownReason: "partial: 1 runs unknown", ...NONE, runs: [{ runId: invalid, purpose: "flow-draft", tokens: null }, { runId: valid, purpose: "flow-draft", tokens: 1_300 }] });
      expect(step(v, "write").spend).toMatchObject({ tokens: 42_000, unknownReason: "partial: 1 runs unknown" });
      expect(v.spend).toMatchObject({ tokens: 1_300 + 42_000, unknownReason: "partial: 2 runs unknown", ...NONE });
    } finally { await t.w.dispose(); }
  });

  it("a tool-given 0 is unknown, never zero spend", async () => {
    const t = await settledRun(); try {
      // Both draft runs keep the 0 the settlement left (the fake tool reported nothing).
      const outline = step(view(t.w, t.flowRunId), "outline").executions[0]!.spend;
      expect(outline.tokens).toBeNull();
      expect(outline.unknownReason).toBe("the tool reported 0 tokens");
      expect(outline.runs.map((r) => r.tokens)).toEqual([null, null]);
    } finally { await t.w.dispose(); }
  });
});

describe("sumSpend (gaps §10)", () => {
  const one = (runId: string, tokens: number | null, unknownReason: string | null = tokens === null ? "the tool reported no usage" : null): Spend =>
    ({ tokens, unknownReason, usd: null, usdReason: USD_REASON, runs: [{ runId, purpose: "flow-draft", tokens }] });

  it("adds the known runs; any unknown makes it partial; all unknown is null with the reason; nothing is never 0", () => {
    expect(sumSpend([one("a", 10), one("b", 5)])).toEqual({ tokens: 15, unknownReason: null, usd: null, usdReason: USD_REASON, runs: [one("a", 10).runs[0], one("b", 5).runs[0]] });
    expect(sumSpend([one("a", 10), one("b", null)])).toMatchObject({ tokens: 10, unknownReason: "partial: 1 runs unknown" });
    expect(sumSpend([one("a", null)])).toMatchObject({ tokens: null, unknownReason: "the tool reported no usage" });
    expect(sumSpend([one("a", null), one("b", null, "the tool reported 0 tokens")])).toMatchObject({ tokens: null, unknownReason: "2 runs unknown" });
    expect(sumSpend([])).toMatchObject({ tokens: null, unknownReason: "no tool runs", usd: null, usdReason: "the tool reports no money amount", runs: [] });
  });
});
