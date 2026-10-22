/**
 * Flow engine spec §5.4, §7.2, §20 (C5 through the kernel; review findings C3 + I1): the person's drift is taken by the
 * kernel itself -- before each execution, and before every copy-back -- not only by the vault module. An edit to a file a
 * step wrote becomes a person-authored execution of that step (by the run's owner, via `fs`), the next composition holds
 * it, and the planner sees an edit: that step is not a candidate, later steps are. An edit to a file no step wrote moves
 * the run's start. A path the folder still has but the snapshot no longer lists (newly ignored) is never a deletion.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadRun, vaultOf } from "../../src/flow/kernel.js";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { getFlowRun, getHead, listMessages, listPlans } from "../../src/flow/store.js";
import { readHead } from "../../src/flow/vault/compose.js";
import { vaultGit } from "../../src/flow/vault/vault.js";
import { fakeChildPort } from "./fixtures/childPort.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const assets = { "p.md": "Write.\n", "d.md": "Summarise.\n" };
/** finetune (work) → summary (a call: the run waits at a boundary) → article (work). */
const TPL = { t: { yaml: `format: orca-flow-v1
id: t
workspace: {kind: dir}
steps:
  - {id: finetune, kind: work, prompt: p.md}
  - {id: summary, kind: draft, prompt: d.md}
  - {id: article, kind: work, prompt: p.md}
`, assets } };
/** finetune (work) → article (work): the person edits while article runs. */
const TWO = { two: { yaml: `format: orca-flow-v1
id: two
workspace: {kind: dir}
steps:
  - {id: finetune, kind: work, prompt: p.md}
  - {id: article, kind: work, prompt: p.md}
`, assets } };

async function finetuned(templates: Record<string, { yaml: string; assets: Record<string, string> }>, ref: string) {
  const children = fakeChildPort();
  const w = await flowWorld(templates, { children: children.port, files: { "notes.txt": "n\n" } });
  const { flowRunId } = await w.start({ templateRef: ref });
  await w.advance();
  children.land(childGroupIdOf(flowRunId, "finetune", 1), { "a.wechat.md": "title: one\n" });
  await w.advance();
  expect(readFileSync(join(w.folder, "a.wechat.md"), "utf8")).toBe("title: one\n");
  const show = async (commit: string, path: string) => vaultGit(vaultOf(loadRun(w.store, flowRunId))!, ["show", `${commit}:${path}`]).catch(() => null);
  const head = async () => (await readHead(vaultOf(loadRun(w.store, flowRunId))!, flowRunId))!;
  return { w, children, flowRunId, show, head };
}

describe("drift through the kernel (C3, C5)", () => {
  it("before the next execution: an edit to finetune's file becomes finetune's person execution; article does not start on the old base; the plan sees an edit", async () => {
    const { w, children, flowRunId, show, head } = await finetuned(TPL, "builtin/t"); try {
      expect(w.calls.map((c) => c.key.stepKey)).toEqual(["summary"]);
      writeFileSync(join(w.folder, "a.wechat.md"), "title: mine\n");
      await w.answer(0, { content: "S" });
      const person = w.latest(flowRunId, "finetune")!;
      expect(person).toMatchObject({ seq: 2, state: "done", by: "ann", via: "fs", reasons: ["edit"], outputKind: "commit" });
      expect(getHead(w.store, flowRunId, "finetune")).toBe(2);
      expect(await show(person.outputRef!, "a.wechat.md")).toBe("title: mine\n");
      // The flow head holds it, and the folder kept the person's bytes.
      expect(await show(await head(), "a.wechat.md")).toBe("title: mine\n");
      expect(readFileSync(join(w.folder, "a.wechat.md"), "utf8")).toBe("title: mine\n");
      // article did not start on the base without the edit.
      expect(children.counts().dispatches).toBe(1);
      const plan = listPlans(w.store, flowRunId).at(-1)!;
      expect(plan).toMatchObject({ via: "fs", candidates: { trigger: "edit", edits: ["finetune"] } });
      const list = (plan.candidates as { list: Array<{ stepKey: string; reasons: string[] }> }).list;
      expect(list.map((c) => c.stepKey)).toEqual(["summary", "article"]);
      expect(list[0]!.reasons).toContain("upstream-changed:finetune");
      expect(listMessages(w.store, flowRunId).filter((m) => m.via === "fs").map((m) => [m.kind, m.state])).toEqual([["edit", "applied"]]);
    } finally { await w.dispose(); }
  });

  it("an edit to a file no step wrote is placed at the start: the run's import moves; done steps become candidates on it", async () => {
    const { w, flowRunId, show } = await finetuned(TPL, "builtin/t"); try {
      const before = (getFlowRun(w.store, flowRunId)!.body as { importCommit: string }).importCommit;
      writeFileSync(join(w.folder, "notes.txt"), "mine\n");
      await w.answer(0, { content: "S" });
      const after = (getFlowRun(w.store, flowRunId)!.body as { importCommit: string }).importCommit;
      expect(after).not.toBe(before);
      expect(await show(after, "notes.txt")).toBe("mine\n");
      expect(w.latest(flowRunId, "finetune")!.seq).toBe(1);
      const list = (listPlans(w.store, flowRunId).at(-1)!.candidates as { list: Array<{ stepKey: string; reasons: string[] }> }).list;
      expect(list.find((c) => c.stepKey === "finetune")?.reasons).toContain("upstream-changed:start");
    } finally { await w.dispose(); }
  });

  it("before the copy-back: an edit made while article runs is taken when article lands, never written over", async () => {
    const { w, children, flowRunId, show, head } = await finetuned(TWO, "builtin/two"); try {
      expect(children.counts().dispatches).toBe(2);
      writeFileSync(join(w.folder, "a.wechat.md"), "title: mine\n");
      children.land(childGroupIdOf(flowRunId, "article", 1), { "a.wechat.html": "<p>" });
      await w.advance();
      expect(w.latest(flowRunId, "finetune")).toMatchObject({ seq: 2, by: "ann", via: "fs" });
      expect(await show(await head(), "a.wechat.md")).toBe("title: mine\n");
      expect(await show(await head(), "a.wechat.html")).toBe("<p>");
      expect(readFileSync(join(w.folder, "a.wechat.html"), "utf8")).toBe("<p>");
      expect(readFileSync(join(w.folder, "a.wechat.md"), "utf8")).toBe("title: mine\n");
    } finally { await w.dispose(); }
  });

  it("I1: a file the person now ignores is not a deletion: it stays in the composition and in the folder", async () => {
    const { w, flowRunId, show, head } = await finetuned(TPL, "builtin/t"); try {
      writeFileSync(join(w.folder, ".gitignore"), "a.wechat.md\n");
      await w.answer(0, { content: "S" });
      const message = listMessages(w.store, flowRunId).find((m) => m.via === "fs")!;
      expect((message.body as { drift: { paths: string[] } }).drift.paths).toEqual([".gitignore"]);
      expect(await show(await head(), "a.wechat.md")).toBe("title: one\n");
      expect(existsSync(join(w.folder, "a.wechat.md"))).toBe(true);
    } finally { await w.dispose(); }
  });
});
