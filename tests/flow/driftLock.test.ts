/**
 * Dir-requirements spec §11.2, §17 criterion D15 (plan Task 7): the drift snapshot runs under the folder's directory lock,
 * the same in-process lock a dir group's placement pass takes for its whole run -- a placement on one folder never shows
 * the snapshot a half-done write, and the snapshot waits while the placement holds it. The lock is not re-entrant, so the
 * snapshot's own `withDirLock` must come after any copy-back's (a pending copy-back is taken first, unlocked, then the
 * snapshot): nesting them deadlocks and this suite's 5 s timeout fails the test. The ordered events come from the lock's
 * test-only probe; `driftKernel.test.ts` (unchanged) covers a flow run alone.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { absorbDrift, loadRun, vaultOf } from "../../src/flow/kernel.js";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { getFlowRun, updateFlowRunBody } from "../../src/flow/store.js";
import { readHead } from "../../src/flow/vault/compose.js";
import { dirLockProbe, withDirLock, type DirLockEvent } from "../../src/flow/vault/dirLock.js";
import { fakeChildPort } from "./fixtures/childPort.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const TWO = { two: { yaml: `format: orca-flow-v1
id: two
workspace: {kind: dir}
steps:
  - {id: finetune, kind: work, prompt: p.md}
  - {id: article, kind: work, prompt: p.md}
`, assets: { "p.md": "Write.\n" } } };

/** A run whose flow head and folder agree on `a.wechat.md` (finetune landed and was copied back). */
async function flowing() {
  const children = fakeChildPort();
  const w = await flowWorld(TWO, { children: children.port, files: { "notes.txt": "n\n" } });
  const { flowRunId } = await w.start({ templateRef: "builtin/two" });
  await w.advance();
  children.land(childGroupIdOf(flowRunId, "finetune", 1), { "a.wechat.md": "title: one\n" });
  await w.advance();
  return { w, flowRunId };
}

const pair = (key: string): DirLockEvent[] => [
  { phase: "enter", key, held: 1, active: 1 },
  { phase: "exit", key, held: 0, active: 0 },
];

describe("D15: flow drift under the folder's lock (§11.2)", { timeout: 5_000 }, () => {
  it("the snapshot waits while another holder of the same folder is inside, then reads once", async () => {
    const { w, flowRunId } = await flowing();
    const events: DirLockEvent[] = [];
    dirLockProbe.observe = (event) => events.push(event);
    try {
      const run = loadRun(w.store, flowRunId);
      const key = run.body.dir!.normalize("NFC");
      writeFileSync(join(w.folder, "notes.txt"), "mine\n");
      let entered!: () => void;
      const inside = new Promise<void>((resolve) => { entered = resolve; });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const held = withDirLock(key, async () => { entered(); await gate; });
      await inside;
      events.length = 0; // the holder's own enter; what remains must be the flow's
      let taken: boolean | null = null;
      const drift = absorbDrift(w.deps, run, vaultOf(run)!).then((value) => { taken = value; return value; });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(events).toEqual([]); // no snapshot read while the folder is held
      expect(taken).toBeNull();
      release();
      await held;
      expect(events.shift()).toMatchObject({ phase: "exit", key, held: 0, active: 0 });
      expect(await drift).toBe(true);
      expect(events).toEqual(pair(key));
      expect(readFileSync(join(w.folder, "notes.txt"), "utf8")).toBe("mine\n");
    } finally { dirLockProbe.observe = undefined; await w.dispose(); }
  });

  it("a pending copy-back and the snapshot take the lock one after the other, never nested", async () => {
    const { w, flowRunId } = await flowing();
    const events: DirLockEvent[] = [];
    dirLockProbe.observe = (event) => events.push(event);
    try {
      const run = loadRun(w.store, flowRunId);
      const key = run.body.dir!.normalize("NFC");
      const vault = vaultOf(run)!;
      const head = (await readHead(vault, flowRunId))!;
      w.store.transaction(() => updateFlowRunBody(w.store, flowRunId, (body) => ({ ...body, pendingCopyBack: { from: head, to: head, key: null } })));
      // No person's edit, so the snapshot finds nothing after the copy-back: false, both locks released.
      expect(await absorbDrift(w.deps, loadRun(w.store, flowRunId), vault)).toBe(false);
      expect(events).toEqual([...pair(key), ...pair(key)]);
      expect((getFlowRun(w.store, flowRunId)!.body as { pendingCopyBack?: unknown }).pendingCopyBack).toBeUndefined();
    } finally { dirLockProbe.observe = undefined; await w.dispose(); }
  });
});
