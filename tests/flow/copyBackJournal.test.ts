/**
 * Flow engine spec §5.3-§5.4, §20 (review finding I2, and C2's "git/EACCES during copy-back"): the flow head moves by
 * CAS before the folder is written, so the copy-back it owes is journaled on the run before the move. A copy-back that
 * fails (here: the folder is read-only, EACCES) or never ran (a crash) is recorded -- on the run and, red, on the step's
 * execution -- never thrown through the pump, and done at the next boundary. While it is owed, the folder is behind the
 * head: what differs there is not the person's drift (the step's new file must not be read as the person deleting it).
 */
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadRun, vaultOf } from "../../src/flow/kernel.js";
import { commitFiles } from "../../src/flow/messages.js";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { getFlowRun, updateFlowRunBody } from "../../src/flow/store.js";
import { readHead } from "../../src/flow/vault/compose.js";
import { fakeChildPort } from "./fixtures/childPort.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const TWO = { two: { yaml: `format: orca-flow-v1
id: two
workspace: {kind: dir}
steps:
  - {id: finetune, kind: work, prompt: p.md}
  - {id: article, kind: work, prompt: p.md}
`, assets: { "p.md": "Write.\n" } } };

const pendingOf = (w: Awaited<ReturnType<typeof flowWorld>>, id: string) => (getFlowRun(w.store, id)!.body as { pendingCopyBack?: { from: string; to: string; error?: { message: string } } }).pendingCopyBack;

describe("the copy-back is journaled before the head moves (I2)", () => {
  it("a copy-back that fails (EACCES) is recorded, not thrown, the head stays moved, no drift is taken meanwhile, and the next pass finishes it", async () => {
    const children = fakeChildPort();
    const w = await flowWorld(TWO, { children: children.port, files: { "notes.txt": "n\n" } }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/two" });
      await w.advance();
      const landed = children.land(childGroupIdOf(flowRunId, "finetune", 1), { "a.wechat.md": "title: one\n" });
      chmodSync(w.folder, 0o500);
      try {
        await expect(w.advance()).resolves.toBeUndefined();
        expect(existsSync(join(w.folder, "a.wechat.md"))).toBe(false);
        const pending = pendingOf(w, flowRunId)!;
        expect(pending.error?.message).toMatch(/EACCES|permission denied/i);
        expect(await readHead(vaultOf(loadRun(w.store, flowRunId))!, flowRunId)).toBe(pending.to);
        const finetune = w.latest(flowRunId, "finetune")!;
        expect(finetune).toMatchObject({ seq: 1, state: "done", outputRef: landed });
        expect((finetune.body as { flags?: string[] }).flags).toContain("copy-back-failed");
        expect((getFlowRun(w.store, flowRunId)!.body as { lastError?: unknown }).lastError).toBeUndefined();
        // article started meanwhile, and the step's missing file was not read as the person deleting it.
        expect(children.counts().dispatches).toBe(2);
      } finally { chmodSync(w.folder, 0o700); }
      await w.advance();
      expect(readFileSync(join(w.folder, "a.wechat.md"), "utf8")).toBe("title: one\n");
      expect(pendingOf(w, flowRunId)).toBeUndefined();
      expect(w.execs(flowRunId, "finetune").map((e) => e.seq)).toEqual([1]);
    } finally { await w.dispose(); }
  });

  it("a journaled move the head never made (a crash before the swap) owes nothing: it is dropped, the folder untouched", async () => {
    const children = fakeChildPort();
    const w = await flowWorld(TWO, { children: children.port, files: { "notes.txt": "n\n" } }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/two" });
      await w.advance();
      children.land(childGroupIdOf(flowRunId, "finetune", 1), { "a.wechat.md": "title: one\n" });
      const vault = vaultOf(loadRun(w.store, flowRunId))!;
      const head = (await readHead(vault, flowRunId))!;
      const ghost = await commitFiles(vault, head, { "a.wechat.md": "ghost\n" }, "a composition whose swap never happened");
      w.store.transaction(() => updateFlowRunBody(w.store, flowRunId, (body) => ({ ...body, pendingCopyBack: { from: head, to: ghost, key: null } })));
      await w.advance();
      expect(pendingOf(w, flowRunId)).toBeUndefined();
      expect(readFileSync(join(w.folder, "a.wechat.md"), "utf8")).toBe("title: one\n");
    } finally { await w.dispose(); }
  });
});
