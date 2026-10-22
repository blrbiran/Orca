/**
 * Gaps spec §5.5, §5.6, §17 G4: "accept as unchanged" -- the output a step has now stands for its new inputs and counts
 * as unchanged for every later step. One verb (`flow-plan-step accept-unchanged`), two cases decided by code: a chosen
 * step not yet executed under the plan is carried forward without running; an executed one feeds the cutoff. A step a
 * plan skipped or accepted must not come back in the NEXT plan just because its carried-forward execution forgot what it
 * ran on (the persistence fix): the planner reads the newest done-or-carried execution's inputs.
 */
import { describe, expect, it } from "vitest";
import { orchestrationRevision, writeOrchestrationSettings } from "../../src/control/orchestration.js";
import { loadRun } from "../../src/flow/kernel.js";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { acceptMessage } from "../../src/flow/messages.js";
import { planStep } from "../../src/flow/planStep.js";
import { currentCandidates } from "../../src/flow/rerun.js";
import { listMessages, listPlans } from "../../src/flow/store.js";
import { fakeChildPort } from "./fixtures/childPort.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const draftSteps = (ids: string[], extra: Record<string, string> = {}) => ({
  yaml: `format: orca-flow-v1\nid: t\nworkspace: {kind: dir}\nsteps:\n${ids.map((id) => `  - {id: ${id}, kind: draft, prompt: ${id}.md${extra[id] ?? ""}}`).join("\n")}\n`,
  assets: Object.fromEntries(ids.map((id) => [`${id}.md`, `${id}.\n`])),
});

/** Answer every outstanding draft call (oldest first) until none is left; returns how many were answered. */
async function drain(w: Awaited<ReturnType<typeof flowWorld>>, from: number, content: (stepKey: string, seq: number) => string): Promise<number> {
  let n = from;
  while (n < w.calls.length) {
    const call = w.calls[n]!;
    await w.answer(n, call.purpose === "rerun-proposal" ? { skips: [] } : { content: content(call.key.stepKey, call.key.seq) });
    n += 1;
  }
  return n;
}

const feedback = (w: Awaited<ReturnType<typeof flowWorld>>, flowRunId: string, stepKey: string, text: string, requestId: string) =>
  acceptMessage(w.deps, flowRunId, { kind: "feedback", target: { kind: "step", stepKey }, body: { text }, by: "ann", via: "cli:test", requestId });

describe("the next plan does not propose a plan-skipped step again (§5.5 persistence, G4)", () => {
  it("plan skip of deslop, then feedback on the unrelated later finetune: the next plan is finetune only", async () => {
    const w = await flowWorld({ t: draftSteps(["draft", "deslop", "voice", "finetune"]) }); try {
      w.deps.rerunReview = () => "auto";
      const { flowRunId } = await w.start({ templateRef: "builtin/t" });
      await w.advance();
      let n = await drain(w, 0, (k) => `${k} 1`);
      await feedback(w, flowRunId, "draft", "shorter", "fb-1");
      // Plan 1: draft (feedback), deslop/voice/finetune (upstream); the model skips deslop.
      expect(w.calls[n]).toMatchObject({ purpose: "rerun-proposal" });
      await w.answer(n, { skips: [{ stepKey: "deslop", reason: "deslop only removes slop the new draft does not have" }] });
      n += 1;
      n = await drain(w, n, (k) => `${k} 2`);
      expect(listPlans(w.store, flowRunId).map((p) => [p.planNo, p.state])).toEqual([[1, "done"]]);
      expect(w.latest(flowRunId, "deslop")).toMatchObject({ state: "skipped" });
      await feedback(w, flowRunId, "finetune", "punchier", "fb-2");
      const plan2 = listPlans(w.store, flowRunId).find((p) => p.planNo === 2)!;
      expect((plan2.candidates as { list: Array<{ stepKey: string }> }).list.map((c) => c.stepKey)).toEqual(["finetune"]);
    } finally { await w.dispose(); }
  });
});

interface Chosen { steps: string[]; pending?: Array<Record<string, unknown>>; accepted?: Array<Record<string, unknown>> }
const chosenOf = (w: Awaited<ReturnType<typeof flowWorld>>, flowRunId: string, planNo: number) => listPlans(w.store, flowRunId).find((p) => p.planNo === planNo)!.chosen as Chosen;
const callOf = (w: Awaited<ReturnType<typeof flowWorld>>, stepKey: string, seq: number) => w.calls.findIndex((c) => c.key.stepKey === stepKey && c.key.seq === seq);
const lastProposal = (w: Awaited<ReturnType<typeof flowWorld>>) => w.calls.map((c) => c.purpose).lastIndexOf("rerun-proposal");

describe("accept as unchanged (§5.5, G4)", () => {
  /** p, s, b, c settled; feedback on s makes plan 1 = s, b, c; s's re-run is out (b not executed yet). */
  async function planOnS() {
    const w = await flowWorld({ t: draftSteps(["p", "s", "b", "c"]) });
    const { flowRunId } = await w.start({ templateRef: "builtin/t" });
    await w.advance();
    await drain(w, 0, (k) => `${k} 1`);
    await feedback(w, flowRunId, "s", "sharper", "fb-1");
    await w.answer(lastProposal(w), { skips: [] });
    expect(chosenOf(w, flowRunId, 1).steps).toEqual(["s", "b", "c"]);
    expect(callOf(w, "s", 2)).toBeGreaterThan(-1);
    return { w, flowRunId };
  }

  it("on a chosen step not executed yet: it leaves the plan, is carried forward, later steps lose upstream-changed:<it>; the next plan does not propose it", async () => {
    const { w, flowRunId } = await planOnS(); try {
      expect(await planStep(w.deps, { flowRunId, planNo: 1, stepKey: "b", choice: "accept-unchanged", by: "ann", via: "cli:test" })).toEqual({ result: "flow-plan-step-applied" });
      const chosen = chosenOf(w, flowRunId, 1);
      expect(chosen.steps).toEqual(["s", "c"]);
      expect(chosen.accepted).toEqual([expect.objectContaining({ stepKey: "b", seq: 1, by: "ann", via: "cli:test", source: "person", ranOnInputs: expect.objectContaining({ earlier: expect.any(Array) }) })]);
      expect(listMessages(w.store, flowRunId).find((m) => m.kind === "command" && (m.body as { command?: string }).command === "accept-unchanged"))
        .toMatchObject({ state: "applied", by: "ann", body: { command: "accept-unchanged", planNo: 1, stepKey: "b" } });
      await w.answer(callOf(w, "s", 2), { content: "s 2" });
      // b never ran again: its output was carried onto s's new output.
      expect(callOf(w, "b", 2)).toBe(-1);
      expect(w.latest(flowRunId, "b")).toMatchObject({ seq: 2, state: "skipped", body: expect.objectContaining({ acceptedUnchanged: { by: "ann", via: "cli:test", source: "person" } }) });
      // c still re-runs for s, but no longer because of b.
      expect(callOf(w, "c", 2)).toBeGreaterThan(-1);
      const now = currentCandidates(w.deps, loadRun(w.store, flowRunId), []);
      expect(now.map((c) => `${c.stepKey}: ${c.reasons.join(" ")}`)).toEqual(["c: upstream-changed:s"]);
      await w.answer(callOf(w, "c", 2), { content: "c 2" });
      expect(listPlans(w.store, flowRunId).map((p) => p.state)).toEqual(["done"]);
      // New feedback on the later c: the accepted b is not proposed again.
      await feedback(w, flowRunId, "c", "shorter", "fb-2");
      const plan2 = listPlans(w.store, flowRunId).find((p) => p.planNo === 2)!;
      expect((plan2.candidates as { list: Array<{ stepKey: string }> }).list.map((c) => c.stepKey)).toEqual(["c"]);
    } finally { await w.dispose(); }
  });

  it("refuses a non-candidate, a second accept, no open plan (flow-plan-step-not-candidate) and another plan's number (flow-plan-stale)", async () => {
    const { w, flowRunId } = await planOnS(); try {
      const step = (stepKey: string, planNo = 1) => planStep(w.deps, { flowRunId, planNo, stepKey, choice: "accept-unchanged", by: "ann", via: "cli:test" });
      await expect(step("p")).rejects.toThrow(/flow-plan-step-not-candidate/);
      await expect(step("b", 7)).rejects.toThrow(/flow-plan-stale/);
      await expect(planStep(w.deps, { flowRunId, planNo: 1, stepKey: "b", choice: "run", by: "ann", via: "cli:test" })).rejects.toThrow(/flow-plan-step-not-candidate/);
      await step("b");
      await expect(step("b")).rejects.toThrow(/flow-plan-step-not-candidate/);
      await w.answer(callOf(w, "s", 2), { content: "s 2" });
      await w.answer(callOf(w, "c", 2), { content: "c 2" });
      expect(listPlans(w.store, flowRunId).map((p) => p.state)).toEqual(["done"]);
      await expect(step("c")).rejects.toThrow(/flow-plan-step-not-candidate/);
      expect(chosenOf(w, flowRunId, 1).steps).toEqual(["s", "c"]);
    } finally { await w.dispose(); }
  });

  it("on an executed step: the cutoff drops a later step whose only reason was it", async () => {
    const w = await flowWorld({ t: draftSteps(["b", "x", "c"], { x: ", parallelWith: b" }) }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t" });
      await w.advance();
      await drain(w, 0, (k) => `${k} 1`);
      await feedback(w, flowRunId, "b", "warmer", "fb-1");
      await feedback(w, flowRunId, "x", "tighter", "fb-2");
      await w.answer(lastProposal(w), { skips: [] });
      const planNo = listPlans(w.store, flowRunId).at(-1)!.planNo;
      expect(chosenOf(w, flowRunId, planNo).steps).toEqual(["b", "x", "c"]);
      await w.answer(callOf(w, "b", 2), { content: "b 2" });
      // c waits for x; the person says b's new output counts as unchanged.
      await planStep(w.deps, { flowRunId, planNo, stepKey: "b", choice: "accept-unchanged", by: "ann", via: "cli:test" });
      expect(chosenOf(w, flowRunId, planNo).accepted).toEqual([expect.objectContaining({ stepKey: "b", seq: 2, source: "person" })]);
      // x's re-run leaves its output as it was: c's only remaining reason was b, so c leaves the plan.
      await w.answer(callOf(w, "x", 2), { content: "x 1" });
      expect(callOf(w, "c", 2)).toBe(-1);
      expect(chosenOf(w, flowRunId, planNo).steps).toEqual(["b", "x"]);
      expect(listPlans(w.store, flowRunId).at(-1)!.state).toBe("done");
    } finally { await w.dispose(); }
  });
});

describe("accept decisions carry over to a newer plan (§5.6, G4)", () => {
  const TPL = { t: { yaml: `format: orca-flow-v1
id: t
workspace: {kind: dir}
effects:
  wechat-draft: {class: external}
steps:
  - {id: voice, kind: draft, prompt: voice.md}
  - {id: article, kind: draft, prompt: article.md}
  - {id: cover, kind: draft, prompt: cover.md, parallelWith: article}
  - {id: to-draft-box, kind: work, prompt: box.md, effect: wechat-draft}
`, assets: { "voice.md": "Voice.\n", "article.md": "Article.\n", "cover.md": "Cover.\n", "box.md": "Box.\n" } } };

  /** Plan 1 (feedback on voice) asks about cover; the person accepts it; to-draft-box waits at its confirm card, plan 1 open. */
  async function acceptedInOpenPlan() {
    const children = fakeChildPort();
    const w = await flowWorld(TPL, { children: children.port });
    const { flowRunId } = await w.start({ templateRef: "builtin/t" });
    await w.advance();
    for (const key of ["voice", "article", "cover"]) await w.answer(callOf(w, key, 1), { content: `${key} 1` });
    children.land(childGroupIdOf(flowRunId, "to-draft-box", 1), { "sent.json": "{}\n" }, { flow: { effect: { remoteId: "media-1" } } });
    await w.advance();
    w.store.transaction(() => writeOrchestrationSettings(w.store, { maxRunningGroups: 3, flows: { effects: { external: "confirm" } } }, orchestrationRevision(w.store) + 1));
    await feedback(w, flowRunId, "voice", "warmer", "fb-1");
    await w.answer(lastProposal(w), { skips: [], unsure: [{ stepKey: "cover", question: "Keep the cover?" }] });
    await w.answer(callOf(w, "voice", 2), { content: "voice 2" });
    await w.answer(callOf(w, "article", 2), { content: "article 2" });
    await planStep(w.deps, { flowRunId, planNo: 1, stepKey: "cover", choice: "accept-unchanged", by: "ann", via: "cli:test" });
    expect(w.latest(flowRunId, "cover")).toMatchObject({ seq: 2, state: "skipped" });
    expect(w.latest(flowRunId, "to-draft-box")).toMatchObject({ seq: 2, state: "needs-person" });
    expect(listPlans(w.store, flowRunId).map((p) => p.state)).toEqual(["running"]);
    return { w, flowRunId };
  }

  it("new feedback on the later to-draft-box (cover's inputs unchanged): plan 2 records the accept as carried, neither asks about nor runs cover", async () => {
    const { w, flowRunId } = await acceptedInOpenPlan(); try {
      const covers = w.execs(flowRunId, "cover").length;
      await feedback(w, flowRunId, "to-draft-box", "use the short digest", "fb-2");
      expect(listPlans(w.store, flowRunId).map((p) => p.state)).toEqual(["abandoned", "proposed"]);
      await w.answer(lastProposal(w), { skips: [] });
      // cover is not a candidate at all: its parallel sibling article finishing in plan 1 is not an input of it.
      expect((listPlans(w.store, flowRunId)[1]!.candidates as { list: Array<{ stepKey: string }> }).list.map((c) => c.stepKey)).toEqual(["to-draft-box"]);
      const chosen = chosenOf(w, flowRunId, 2);
      expect(chosen.accepted).toEqual([expect.objectContaining({ stepKey: "cover", source: "carried", fromPlan: 1 })]);
      expect(chosen.steps).not.toContain("cover");
      expect(chosen.pending ?? []).toEqual([]);
      expect(w.execs(flowRunId, "cover")).toHaveLength(covers);
      expect(callOf(w, "cover", 3)).toBe(-1);
    } finally { await w.dispose(); }
  });

  it("new feedback on the earlier voice (cover's inputs change): the accept is dropped and cover is planned afresh", async () => {
    const { w, flowRunId } = await acceptedInOpenPlan(); try {
      await feedback(w, flowRunId, "voice", "cooler after all", "fb-2");
      await w.answer(lastProposal(w), { skips: [] });
      const chosen = chosenOf(w, flowRunId, 2);
      expect((chosen.accepted ?? []).map((a) => a.stepKey)).not.toContain("cover");
      expect(chosen.steps).toContain("cover");
    } finally { await w.dispose(); }
  });
});
