/**
 * Gaps spec §13 (plan Task 9, G10's "registry rows and payload schemas exist" end to end): the verbs the gaps add reach
 * the kernel through the control service, as the panel's route does. `flow-plan-step` answers one step of the running
 * plan and is awaited (a refusal comes back by its own code, booked, never a 200); `flow-answer {feedback}` answers a
 * feedback intake's clarify round; a `defer` names the effect steps it holds and how to release them; the run read
 * carries each step's mark and the steps holding it, and each intake's waiting clarify round.
 */
import { describe, expect, it } from "vitest";
import { WebControlService } from "../../src/control/webService.js";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { acceptMessage } from "../../src/flow/messages.js";
import { getIntake, listPlans } from "../../src/flow/store.js";
import { readFlowRun } from "../../src/flow/views.js";
import { fakeChildPort } from "./fixtures/childPort.js";
import { flowWorld } from "./fixtures/flowWorld.js";

type World = Awaited<ReturnType<typeof flowWorld>>;
let n = 0;
const raw = (verb: string, payload: unknown) => ({ schema: "orca-raw-command-v1", commandId: `gv-${++n}`, actorId: "owner", expectedRevision: 0, verb, target: { kind: "flows" }, payload }) as never;
const serviceOf = (w: World) => new WebControlService({ store: w.store, port: {} as never, profileRouter: {} as never, trustedConfig: {} as never, flowDeps: () => w.deps } as never);
type Answer = { result?: Record<string, unknown>; error?: { code: string; message: string } };
const send = async (w: World, verb: string, payload: unknown): Promise<Answer> => (await serviceOf(w).flowCommand(raw(verb, payload))) as Answer;

const draftSteps = (ids: string[]) => ({
  yaml: `format: orca-flow-v1\nid: t\nworkspace: {kind: dir}\nsteps:\n${ids.map((id) => `  - {id: ${id}, kind: draft, prompt: ${id}.md}`).join("\n")}\n`,
  assets: Object.fromEntries(ids.map((id) => [`${id}.md`, `${id}.\n`])),
});
async function drain(w: World, from: number, content: (stepKey: string) => string): Promise<number> {
  let i = from;
  while (i < w.calls.length) {
    const call = w.calls[i]!;
    await w.answer(i, call.purpose === "rerun-proposal" ? { skips: [] } : { content: content(call.key.stepKey) });
    i += 1;
  }
  return i;
}

describe("flow-plan-step through the control service (gaps §5.5, §13)", () => {
  it("accept-unchanged answers the running plan; a non-candidate is refused by its own code and changes nothing; another plan is stale", async () => {
    const w = await flowWorld({ t: draftSteps(["p", "s", "b", "c"]) }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t" });
      await w.advance();
      await drain(w, 0, (k) => `${k} 1`);
      await acceptMessage(w.deps, flowRunId, { kind: "feedback", target: { kind: "step", stepKey: "s" }, body: { text: "sharper" }, by: "ann", via: "cli:test", requestId: "fb-1" });
      await w.answer(w.calls.map((c) => c.purpose).lastIndexOf("rerun-proposal"), { skips: [] });
      const chosen = () => (listPlans(w.store, flowRunId).find((p) => p.planNo === 1)!.chosen as { steps: string[] }).steps;
      expect(chosen()).toEqual(["s", "b", "c"]);
      expect(await send(w, "flow-plan-step", { runId: flowRunId, planNo: 1, stepKey: "p", choice: "accept-unchanged" }))
        .toMatchObject({ error: { code: "flow-plan-step-not-candidate" } });
      expect(await send(w, "flow-plan-step", { runId: flowRunId, planNo: 7, stepKey: "b", choice: "accept-unchanged" }))
        .toMatchObject({ error: { code: "flow-plan-stale" } });
      expect(await send(w, "flow-plan-step", { runId: flowRunId, planNo: 1, stepKey: "b", choice: "run" }))
        .toMatchObject({ error: { code: "flow-plan-step-not-candidate" } });
      expect(chosen()).toEqual(["s", "b", "c"]);
      expect((await send(w, "flow-plan-step", { runId: flowRunId, planNo: 1, stepKey: "b", choice: "accept-unchanged" })).result)
        .toEqual({ kind: "flow-plan-step-applied", flowRunId, planNo: 1, stepKey: "b", choice: "accept-unchanged" });
      expect(chosen()).toEqual(["s", "c"]);
    } finally { await w.dispose(); }
  });
});

const EFFECT_TPL = {
  yaml: `format: orca-flow-v1
id: e
workspace: {kind: dir}
effects:
  wechat-draft: {class: external}
steps:
  - {id: write, kind: draft, prompt: write.md}
  - {id: push, kind: work, prompt: push.md, effect: wechat-draft}
`,
  assets: { "write.md": "Write.\n", "push.md": "Push it.\n" },
};

describe("a defer through the control service names what it holds (gaps §6.3, §13)", () => {
  it("defer without effects holds the draft-box step and says how to release it; with proceed it holds nothing; the read carries the mark and the hold", async () => {
    const w = await flowWorld({ e: EFFECT_TPL }, { children: fakeChildPort().port }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/e" });
      await w.advance();
      const defer = (effects?: Record<string, string>) => send(w, "flow-message", { runId: flowRunId, kind: "command", target: { kind: "step", stepKey: "write" }, body: { command: "defer", ...(effects === undefined ? {} : { effects }) } });
      const held = await defer();
      expect(held.result).toMatchObject({ kind: "flow-message-stored", held: ["push"], release: `orca flow defer ${flowRunId} --step write --effects push=proceed --as-person` });
      await w.answer(0, { content: "w 1" });
      const view = readFlowRun(w.store, flowRunId) as { steps: Array<{ stepKey: string; mark: unknown; heldBy: string[] }> };
      expect(view.steps.map((s) => [s.stepKey, s.mark, s.heldBy])).toEqual([
        ["write", { kind: "defer", messageSeq: held.result!.seq, effects: {} }, []],
        ["push", null, ["write"]],
      ]);
      const released = await defer({ push: "proceed" });
      expect(released.result).toMatchObject({ kind: "flow-message-stored" });
      expect(released.result!.held).toBeUndefined();
      // A skip holds nothing either: the result carries no hold.
      const skipped = await send(w, "flow-message", { runId: flowRunId, kind: "command", target: { kind: "step", stepKey: "write" }, body: { command: "skip" } });
      expect(skipped.result!.held).toBeUndefined();
    } finally { await w.dispose(); }
  });
});

const FB_TPL = {
  yaml: `format: orca-flow-v1
id: fb
version: 1
workspace: {kind: dir}
steps:
  - {id: draft, kind: work, prompt: draft.md}
  - {id: polish, kind: work, prompt: polish.md}
`,
  assets: { "draft.md": "Write post.md.\n", "polish.md": "Polish it into post.final.md.\n" },
};

describe("flow-answer {feedback} through the control service (gaps §4.6, §13)", () => {
  it("the read shows the intake's waiting round; consensus answers it and the second triage goes out; a stepKey beside feedback is invalid", { timeout: 60_000 }, async () => {
    const children = fakeChildPort();
    const w = await flowWorld({ fb: FB_TPL }, { children: children.port }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/fb" });
      await w.advance();
      children.land(childGroupIdOf(flowRunId, "draft", 1), { "post.md": "# Tea\n\nWarm.\n" });
      await w.advance();
      children.land(childGroupIdOf(flowRunId, "polish", 1), { "post.final.md": "# Tea\n\nWarm and slow.\n" });
      await w.advance();
      const sent = await acceptMessage(w.deps, flowRunId, { kind: "feedback", target: { kind: "run" }, body: { text: "something feels off" }, by: "ann", via: "cli:test", requestId: "fb-1" });
      await w.answer(w.calls.length - 1, { targets: [{ stepKey: "polish", why: "tone" }], clarity: "vague" });
      const q = (i: number) => ({ key: `q${i}`, question: `Question ${i}?`, recommendedAnswer: `Answer ${i}`, why: "w", dependsOn: [] });
      await w.answer(w.calls.length - 1, { slug: "fb", statement: "## What feels wrong\nx\n## Where\ny\n## What it should become\nz", acceptanceCriteria: [], questions: [q(1)], frontierEmpty: false, openBranches: [], glossary: [], adrs: [] });
      expect(getIntake(w.store, flowRunId, sent.seq)!.state).toBe("clarifying");
      const view = readFlowRun(w.store, flowRunId) as { intakes: Array<Record<string, unknown>> };
      expect(view.intakes).toEqual([expect.objectContaining({ messageSeq: sent.seq, state: "clarifying", text: "something feels off",
        clarify: { roundNo: 1, questions: [{ id: "R1.Q1", question: "Question 1?", recommendedAnswer: "Answer 1" }] } })]);
      expect(await send(w, "flow-answer", { runId: flowRunId, stepKey: "polish", feedback: sent.seq, consensus: true })).toMatchObject({ error: { code: "flow-answer-invalid" } });
      const triages = w.calls.filter((c) => c.purpose === "feedback-triage").length;
      expect((await send(w, "flow-answer", { runId: flowRunId, feedback: sent.seq, consensus: true })).result)
        .toEqual({ kind: "flow-feedback-answered", flowRunId, messageSeq: sent.seq, answer: "consensus" });
      expect(w.calls.filter((c) => c.purpose === "feedback-triage")).toHaveLength(triages + 1);
      expect(getIntake(w.store, flowRunId, sent.seq)!.state).toBe("restating");
      // Answered: a second answer finds nothing waiting.
      expect(await send(w, "flow-answer", { runId: flowRunId, feedback: sent.seq, consensus: true })).toMatchObject({ error: { code: "flow-ask-closed" } });
    } finally { await w.dispose(); }
  });
});
