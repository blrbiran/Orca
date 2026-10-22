import { describe, expect, it } from "vitest";
import { orchestrationRevision, writeOrchestrationSettings } from "../../src/control/orchestration.js";
import { discardEffect, enactEffect } from "../../src/flow/effects.js";
import { openAsks } from "../../src/flow/kernel.js";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { getFlowRun, listEffects, listMessages } from "../../src/flow/store.js";
import { fakeChildPort } from "./fixtures/childPort.js";
import { flowWorld } from "./fixtures/flowWorld.js";

/**
 * Flow engine spec §9.1-§9.2, §9.6, §21 C13 (H24-H26; the human: 默认直接执行再标红，设置里可改为先弹确认卡片或默认不执行):
 * an effect-classed step runs at its level. `apply-flag` runs it and flags it red with the remote id it reported;
 * `confirm` parks only that step behind a confirm card while its parallel sibling finishes; `stage-only` does not run it,
 * leaves an immutable staged record, and the flow ends without it -- enacting the record runs the step then (once:
 * a second enact is refused), discarding closes it, and a record whose inputs moved is replaced, not enacted.
 * The record id is in the step's prompt as `--confirmed-by-orca` (§9.6). Enacting through the control verb and the
 * CLI is plan Task 15's (the verbs land there); here the domain functions the verb calls.
 */
const TPL = {
  yaml: `format: orca-flow-v1
id: t
workspace: {kind: dir}
effects:
  wechat-draft: {class: external}
steps:
  - {id: upload, kind: work, prompt: upload.md, effect: wechat-draft}
  - {id: side, kind: draft, prompt: side.md, parallelWith: upload}
  - {id: after, kind: draft, prompt: after.md}
`,
  assets: { "upload.md": "Upload the draft.\n", "side.md": "Side.\n", "after.md": "After.\n" },
};
const level = (store: Parameters<typeof orchestrationRevision>[0], value: string) =>
  store.transaction(() => writeOrchestrationSettings(store, { maxRunningGroups: 3, flows: { effects: { external: value as "confirm" } } }, orchestrationRevision(store) + 1));
async function world(levelValue?: string) {
  const children = fakeChildPort();
  const w = await flowWorld({ t: TPL }, { children: children.port });
  if (levelValue !== undefined) level(w.store, levelValue);
  const { flowRunId } = await w.start({ templateRef: "builtin/t" });
  await w.advance();
  return { w, children, flowRunId, child: childGroupIdOf(flowRunId, "upload", 1) };
}
const sideCall = (w: Awaited<ReturnType<typeof flowWorld>>) => w.calls.findIndex((c) => c.key.stepKey === "side");
const goalOf = (children: ReturnType<typeof fakeChildPort>, id: string) => JSON.parse(children.opened.get(id)!.plan.tasks[0]!.originalContractCanonicalJson).objective.goal as string;
const runState = (w: Awaited<ReturnType<typeof flowWorld>>, id: string) => getFlowRun(w.store, id)!.state;

describe("effect levels (C13)", () => {
  it("apply-flag (the external default) runs the step with its record id and flags it red with the remote id", async () => {
    const { w, children, flowRunId, child } = await world(); try {
      const [record] = listEffects(w.store, flowRunId);
      expect(record).toMatchObject({ stepKey: "upload", state: "confirmed", level: "apply-flag", class: "external", effectKind: "wechat-draft", policy: { value: "apply-flag", source: "builtin", lockedBy: null } });
      expect(goalOf(children, child)).toContain(`--confirmed-by-orca '${record!.id}'`);
      children.land(child, { "sent.json": "{}" }, { flow: { effect: { remoteId: "media-1" } } });
      await w.advance();
      expect(listEffects(w.store, flowRunId)[0]).toMatchObject({ state: "applied", remoteRef: "media-1" });
      expect((w.latest(flowRunId, "upload")!.body as { flags?: string[] }).flags).toContain("effect-applied");
    } finally { await w.dispose(); }
  });

  it("a failed effect is red and its record failed; nothing retries it", async () => {
    const { w, children, flowRunId, child } = await world(); try {
      children.fail(child, "agent-error");
      await w.advance();
      expect(listEffects(w.store, flowRunId)[0]!.state).toBe("failed");
      expect(w.latest(flowRunId, "upload")).toMatchObject({ state: "failed", seq: 1 });
      expect((w.latest(flowRunId, "upload")!.body as { flags?: string[] }).flags).toContain("effect-failed");
      await w.advance();
      expect(children.counts().dispatches).toBe(1);
    } finally { await w.dispose(); }
  });

  // T18 acceptance (fr-12b4198a cover): with no image provider the agent hand-wrote an SVG, landed it, reported no
  // flow.effect -- and the record said `applied` for a spend that never happened. The record is the person's only
  // account of what the run did outside the folder, so "applied" must mean the agent reported the effect (§9.6: it
  // reports flow.effect.remoteId either way); a landing without that report is the effect failing (§9.6: failed, red,
  // only the person retries), and its landed files do not become the step's output.
  it("a landing that reports no flow.effect is effect-failed, not applied; its files do not become the output", async () => {
    const { w, children, flowRunId, child } = await world(); try {
      children.land(child, { "assets/wechat/00-cover.svg": "<svg/>" });
      await w.advance();
      expect(listEffects(w.store, flowRunId)[0]).toMatchObject({ state: "failed", remoteRef: null });
      const upload = w.latest(flowRunId, "upload")!;
      expect(upload).toMatchObject({ state: "failed", seq: 1 });
      expect(upload.body as { flags?: string[]; failure?: string }).toMatchObject({ failure: "effect-not-reported" });
      expect((upload.body as { flags?: string[] }).flags).toContain("effect-failed");
      expect((upload.body as { flags?: string[] }).flags).not.toContain("effect-applied");
      expect(upload.outputKind).not.toBe("commit");
      await w.advance();
      expect(children.counts().dispatches).toBe(1);
    } finally { await w.dispose(); }
  });

  it("confirm parks only its step behind a card while the parallel sibling finishes; the confirm runs it", async () => {
    const { w, children, flowRunId, child } = await world("confirm"); try {
      expect(children.counts().dispatches).toBe(0);
      const [record] = listEffects(w.store, flowRunId);
      expect(record).toMatchObject({ state: "staged", level: "confirm", policy: { value: "confirm", source: "global" } });
      expect(w.latest(flowRunId, "upload")!.state).toBe("needs-person");
      expect(openAsks(w.store, flowRunId)).toEqual([{ stepKey: "upload", seq: 1, ask: expect.objectContaining({ kind: "effect-confirm", recordId: record!.id, effectKind: "wechat-draft", class: "external" }) }]);
      await w.answer(sideCall(w), { content: "side" });
      expect(w.latest(flowRunId, "side")!.state).toBe("done");
      expect(w.execs(flowRunId, "after")).toHaveLength(0);
      expect(await enactEffect(w.deps, record!.id, "ann", "web", "confirm")).toEqual({ state: "running", recordId: record!.id });
      expect(children.counts().dispatches).toBe(1);
      expect(goalOf(children, child)).toContain(`--confirmed-by-orca '${record!.id}'`);
      children.land(child, { "sent.json": "{}" }, { flow: { effect: { remoteId: "media-2" } } });
      await w.advance();
      expect(listEffects(w.store, flowRunId)[0]).toMatchObject({ state: "applied", remoteRef: "media-2" });
      expect(w.calls.at(-1)!.key.stepKey).toBe("after");
      expect(listMessages(w.store, flowRunId).find((m) => m.target === "effect")).toMatchObject({ by: "ann", via: "web", body: { command: "confirm", recordId: record!.id } });
    } finally { await w.dispose(); }
  });

  it("stage-only leaves a staged record and the flow ends without the effect; enacting runs it once", async () => {
    const { w, children, flowRunId, child } = await world("stage-only"); try {
      const [record] = listEffects(w.store, flowRunId);
      expect(record).toMatchObject({ state: "staged", level: "stage-only" });
      expect(w.latest(flowRunId, "upload")!.state).toBe("staged");
      await w.answer(sideCall(w), { content: "side" });
      await w.answer(w.calls.length - 1, { content: "after" });
      expect(runState(w, flowRunId)).toBe("done");
      expect(children.counts().dispatches).toBe(0);
      expect(await enactEffect(w.deps, record!.id, "ann", "cli:test")).toEqual({ state: "running", recordId: record!.id });
      expect(children.counts().dispatches).toBe(1);
      await expect(enactEffect(w.deps, record!.id, "ann", "cli:test")).rejects.toThrow(/flow-effect-not-staged/);
      children.land(child, { "sent.json": "{}" }, { flow: { effect: { remoteId: "media-3" } } });
      await w.advance();
      expect(listEffects(w.store, flowRunId)[0]).toMatchObject({ state: "applied", remoteRef: "media-3" });
      await expect(enactEffect(w.deps, record!.id, "ann", "cli:test")).rejects.toThrow(/flow-effect-closed/);
      expect(children.counts().dispatches).toBe(1);
    } finally { await w.dispose(); }
  });

  it("discarding a staged record closes it; the step never runs and the record cannot be enacted after", async () => {
    const { w, children, flowRunId } = await world("stage-only"); try {
      const [record] = listEffects(w.store, flowRunId);
      discardEffect(w.deps, record!.id, "ann", "cli:test");
      expect(listEffects(w.store, flowRunId)[0]!.state).toBe("discarded");
      expect(w.latest(flowRunId, "upload")!.state).toBe("skipped");
      await expect(enactEffect(w.deps, record!.id, "ann", "cli:test")).rejects.toThrow(/flow-effect-closed/);
      expect(() => discardEffect(w.deps, record!.id, "ann", "cli:test")).toThrow(/flow-effect-closed/);
      expect(children.counts().dispatches).toBe(0);
    } finally { await w.dispose(); }
  });

  it("a staged record whose inputs moved is not enacted: a new record replaces it and the old one is closed", async () => {
    const children = fakeChildPort();
    const w = await flowWorld({ t: { yaml: TPL.yaml.replace("  - {id: upload", "  - {id: first, kind: draft, prompt: side.md}\n  - {id: upload"), assets: TPL.assets } }, { children: children.port }); try {
      level(w.store, "stage-only");
      const { flowRunId } = await w.start({ templateRef: "builtin/t" });
      await w.advance();
      await w.answer(0, { content: "first 1" });
      await w.answer(sideCall(w), { content: "side" });
      await w.answer(w.calls.length - 1, { content: "after" });
      expect(runState(w, flowRunId)).toBe("done");
      const [record] = listEffects(w.store, flowRunId);
      // The person's edit moves what upload would run on.
      const { acceptMessage } = await import("../../src/flow/messages.js");
      await acceptMessage(w.deps, flowRunId, { kind: "edit", target: { kind: "step", stepKey: "first" }, body: { record: { content: "first by Ann" } }, by: "ann", via: "cli:test", requestId: "e1" });
      const result = await enactEffect(w.deps, record!.id, "ann", "cli:test");
      expect(result).toMatchObject({ state: "restaged", replaces: record!.id });
      expect(result.recordId).not.toBe(record!.id);
      expect(listEffects(w.store, flowRunId).map((r) => [r.id, r.state])).toEqual([[record!.id, "staged"], [result.recordId, "staged"]]);
      await expect(enactEffect(w.deps, record!.id, "ann", "cli:test")).rejects.toThrow(/flow-effect-closed/);
      expect(children.counts().dispatches).toBe(0);
    } finally { await w.dispose(); }
  });
});
