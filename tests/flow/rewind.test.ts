import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { fakeChildPort } from "./fixtures/childPort.js";
import { recordOfExecution } from "../../src/flow/kernel.js";
import { acceptMessage } from "../../src/flow/messages.js";
import { runPlan } from "../../src/flow/rerun.js";
import { getHead, listMessages, listPlans } from "../../src/flow/store.js";
import { flowWorld } from "./fixtures/flowWorld.js";

/**
 * Flow engine spec §8.3, §21 C11 (IR-I13): a rewind keeps the person's later messages. Rewinding `draft` to its first
 * execution makes every later step a candidate, queues the later feedback on `voice` again (it reaches voice's revision
 * prompt), and re-applies the later edit to `finetune` as a three-way patch on finetune's re-run output. An excluded
 * message is not re-applied; an edit that no longer applies becomes feedback on its step, flagged red.
 */
const TPL = {
  yaml: `format: orca-flow-v1
id: t
workspace: {kind: dir}
steps:
  - {id: draft, kind: draft, prompt: draft.md}
  - {id: voice, kind: draft, prompt: voice.md}
  - {id: finetune, kind: draft, prompt: finetune.md}
  - {id: article, kind: draft, prompt: article.md}
`,
  assets: { "draft.md": "Draft.\n", "voice.md": "Voice.\n", "finetune.md": "Finetune.\n", "article.md": "Article.\n" },
};
const FT1 = "line1\nline2\nline3\nline4\nline5\n";
let n = 0;
const send = (w: Awaited<ReturnType<typeof flowWorld>>, id: string, over: Record<string, unknown>) =>
  acceptMessage(w.deps, id, { by: "ann", via: "cli:test", requestId: `m-${(n += 1)}`, ...over } as Parameters<typeof acceptMessage>[2]);
const last = (w: Awaited<ReturnType<typeof flowWorld>>) => w.calls.length - 1;

/** Run to done, re-run everything from draft (draft#2 and every later step on it), then feedback on voice and an edit to finetune. */
async function history() {
  const w = await flowWorld({ t: TPL });
  const { flowRunId } = await w.start({ templateRef: "builtin/t" });
  await w.advance();
  for (const [i, content] of ["D1", "V1", FT1, "A1"].entries()) await w.answer(i, { content });
  await send(w, flowRunId, { kind: "feedback", target: { kind: "step", stepKey: "draft" }, body: { text: "about tea" } });
  await w.answer(last(w), { skips: [] });
  await runPlan(w.deps, flowRunId, 1, {}, "ann", "cli:test");
  for (const content of ["D2", "V1b", FT1, "A1b"]) await w.answer(last(w), { content });
  expect(listPlans(w.store, flowRunId)[0]!.state).toBe("done");
  const voice = await send(w, flowRunId, { kind: "feedback", target: { kind: "step", stepKey: "voice" }, body: { text: "warmer, please" } });
  const edit = await send(w, flowRunId, { kind: "edit", target: { kind: "step", stepKey: "finetune" }, body: { record: { content: "line1\nline2 by Ann\nline3\nline4\nline5\n" } } });
  expect(w.latest(flowRunId, "finetune")).toMatchObject({ by: "ann", state: "done" });
  return { w, flowRunId, voiceSeq: voice.seq, editSeq: edit.seq };
}
const contentOf = (w: Awaited<ReturnType<typeof flowWorld>>, id: string, step: string) => (recordOfExecution(w.store, w.latest(id, step)) as { content: string }).content;

describe("rewind keeps later messages (C11)", () => {
  it("re-queues the later feedback and re-applies the later edit as a three-way patch", async () => {
    const { w, flowRunId } = await history(); try {
      await send(w, flowRunId, { kind: "command", target: { kind: "run" }, body: { command: "rewind", toStep: "draft", toSeq: 1 } });
      expect(getHead(w.store, flowRunId, "draft")).toBe(1);
      const plan = listPlans(w.store, flowRunId).at(-1)!;
      expect(plan.candidates).toMatchObject({ list: [
        { stepKey: "voice", reasons: ["upstream-changed:draft", "feedback"] },
        { stepKey: "finetune", reasons: ["upstream-changed:draft", "upstream-changed:voice"] },
        { stepKey: "article", reasons: ["upstream-changed:draft", "upstream-changed:voice", "upstream-changed:finetune"] },
      ], feedback: { voice: ["warmer, please"] } });
      await w.answer(last(w), { skips: [] });
      await runPlan(w.deps, flowRunId, plan.planNo, {}, "ann", "cli:test");
      expect(w.calls[last(w)]).toMatchObject({ key: { stepKey: "voice" } });
      expect(w.calls[last(w)]!.prompt).toContain("warmer, please");
      await w.answer(last(w), { content: "V2" });
      expect(w.calls[last(w)]).toMatchObject({ key: { stepKey: "finetune" } });
      await w.answer(last(w), { content: "line1\nline2\nline3\nline4\nline5 tuned\n" });
      // The person's line and the re-run's line both stand; the result is the person's execution.
      expect(w.latest(flowRunId, "finetune")).toMatchObject({ by: "ann", reasons: ["edit"] });
      expect(contentOf(w, flowRunId, "finetune")).toBe("line1\nline2 by Ann\nline3\nline4\nline5 tuned\n");
      expect(w.calls[last(w)]).toMatchObject({ key: { stepKey: "article" } });
      expect(w.calls[last(w)]!.prompt).toContain("line2 by Ann");
    } finally { await w.dispose(); }
  });

  it("an excluded message is not re-applied", async () => {
    const { w, flowRunId, voiceSeq, editSeq } = await history(); try {
      await send(w, flowRunId, { kind: "command", target: { kind: "run" }, body: { command: "rewind", toStep: "draft", toSeq: 1, exclude: [voiceSeq, editSeq] } });
      const messages = listMessages(w.store, flowRunId);
      expect(messages.find((m) => m.seq === voiceSeq)!.state).toBe("excluded");
      expect(messages.find((m) => m.seq === editSeq)!.state).toBe("excluded");
      expect(messages.filter((m) => m.requestId.startsWith("rewind:"))).toEqual([]);
      const plan = listPlans(w.store, flowRunId).at(-1)!;
      expect(plan.candidates).toMatchObject({ feedback: {} });
      expect((plan.candidates as { list: Array<{ stepKey: string; reasons: string[] }> }).list.find((c) => c.stepKey === "voice")!.reasons).not.toContain("feedback");
      await w.answer(last(w), { skips: [] });
      await runPlan(w.deps, flowRunId, plan.planNo, {}, "ann", "cli:test");
      expect(w.calls[last(w)]!.prompt).not.toContain("warmer, please");
      await w.answer(last(w), { content: "V2" });
      await w.answer(last(w), { content: "line1\nline2\nline3\nline4\nline5 tuned\n" });
      expect(w.latest(flowRunId, "finetune")!.reasons).not.toContain("edit");
      expect(contentOf(w, flowRunId, "finetune")).toBe("line1\nline2\nline3\nline4\nline5 tuned\n");
    } finally { await w.dispose(); }
  });

  it("an edit that no longer applies becomes feedback on its step and the new output is flagged red", async () => {
    const { w, flowRunId } = await history(); try {
      await send(w, flowRunId, { kind: "command", target: { kind: "run" }, body: { command: "rewind", toStep: "draft", toSeq: 1 } });
      const planNo = listPlans(w.store, flowRunId).at(-1)!.planNo;
      await w.answer(last(w), { skips: [] });
      await runPlan(w.deps, flowRunId, planNo, {}, "ann", "cli:test");
      await w.answer(last(w), { content: "V2" });
      await w.answer(last(w), { content: "line1\nline2 rewritten\nline3\nline4\nline5\n" });
      const rerun = w.latest(flowRunId, "finetune")!;
      expect(rerun).toMatchObject({ by: "ann", state: "done" });
      expect((rerun.body as { flags?: string[] }).flags).toContain("edit-no-longer-applies");
      expect(contentOf(w, flowRunId, "finetune")).toBe("line1\nline2 rewritten\nline3\nline4\nline5\n");
      const feedback = listMessages(w.store, flowRunId).filter((m) => m.kind === "feedback" && m.requestId.startsWith("edit-no-longer-applies:"));
      expect(feedback).toHaveLength(1);
      expect((feedback[0]!.body as { text: string }).text).toContain("line2 by Ann");
      // It is the person's own feedback now: the next plan has it on finetune.
      expect(listPlans(w.store, flowRunId).at(-1)!.candidates).toMatchObject({ feedback: { finetune: [expect.stringContaining("line2 by Ann")] } });
    } finally { await w.dispose(); }
  });

  it("a workspace edit is re-applied by git merge-file on the step's re-run output and copied back", async () => {
    const children = fakeChildPort();
    const w = await flowWorld({ w: { yaml: "format: orca-flow-v1\nid: w\nworkspace: {kind: dir}\nsteps:\n  - {id: tune, kind: work, prompt: p.md}\n", assets: { "p.md": "Tune.\n" } } }, { children: children.port }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/w" });
      await w.advance();
      children.land(childGroupIdOf(flowRunId, "tune", 1), { "t.md": FT1 });
      await w.advance();
      expect(readFileSync(join(w.folder, "t.md"), "utf8")).toBe(FT1);
      await send(w, flowRunId, { kind: "edit", target: { kind: "step", stepKey: "tune" }, body: { files: { "t.md": "line1\nline2 by Ann\nline3\nline4\nline5\n" } } });
      expect(w.latest(flowRunId, "tune")).toMatchObject({ seq: 2, by: "ann", outputKind: "commit" });
      expect(readFileSync(join(w.folder, "t.md"), "utf8")).toBe("line1\nline2 by Ann\nline3\nline4\nline5\n");
      await send(w, flowRunId, { kind: "command", target: { kind: "run" }, body: { command: "rewind", toStep: "tune" } });
      expect(getHead(w.store, flowRunId, "tune")).toBeNull();
      await w.answer(last(w), { skips: [] });
      await runPlan(w.deps, flowRunId, listPlans(w.store, flowRunId).at(-1)!.planNo, {}, "ann", "cli:test");
      children.land(childGroupIdOf(flowRunId, "tune", 3), { "t.md": "line1\nline2\nline3\nline4\nline5 tuned\n" });
      await w.advance();
      expect(w.latest(flowRunId, "tune")).toMatchObject({ seq: 4, by: "ann", reasons: ["edit"] });
      expect(readFileSync(join(w.folder, "t.md"), "utf8")).toBe("line1\nline2 by Ann\nline3\nline4\nline5 tuned\n");
    } finally { await w.dispose(); }
  });
});
