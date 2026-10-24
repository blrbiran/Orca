/**
 * Dir-requirements spec §11.2 and §17 criterion D8 (plan Task 7): one folder, a flow run and a dir group.
 *
 * - One folder, one lock: the whole placement pass (from classification to the `placed` swap) runs under one
 *   `withDirLock`, and the flow's drift snapshot and copy-back each take the same lock in turn -- no two holders
 *   overlap, a competing caller queued during the pass only enters after it, and the person's own hold blocks the
 *   pass. The ordered events come from the lock's test-only probe.
 * - A flow copy-back on disjoint paths does not stop the group, and both writers' files end in the folder.
 * - A flow copy-back writing a path the group modifies to other bytes stops the group with that path, the flow's bytes
 *   stay, and a later `take-folder` attributes that path to the flow run and the person's own edit to the person.
 * - The group moves no flow ref, and the flow moves no `refs/orca/group/…` or `heads/orca/<g>` ref.
 *
 * Both writers share one folder and one vault: the placement world (`fixtures/dirPlacementWorld.ts`) makes the folder,
 * its vault and the group; the flow world is built over the same root, store and folder, so `openVault` resolves the
 * same vault. Rule 17 holds through both fixtures (their env paths are under the world's root).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { dirLockHeld, dirLockProbe, withDirLock, type DirLockEvent } from "../../src/flow/vault/dirLock.js";
import { placementWorld, type PlacementWorld } from "./fixtures/dirPlacementWorld.js";
import { fakeChildPort } from "../flow/fixtures/childPort.js";
import { flowWorld } from "../flow/fixtures/flowWorld.js";

const TWO = { two: { yaml: `format: orca-flow-v1
id: two
workspace: {kind: dir}
steps:
  - {id: one, kind: work, prompt: p.md}
  - {id: two, kind: work, prompt: p.md}
`, assets: { "p.md": "Write.\n" } } };

/** A dir group's folder and vault, and a flow run over the same ones (the flow world's dispose is the group world's). */
async function sharedWorld(files: Record<string, string>) {
  const w = await placementWorld(files);
  const children = fakeChildPort();
  const fw = await flowWorld(TWO, { children: children.port, folder: w.folder, harness: { root: w.root, store: w.store, dispose: async () => {} } });
  return { w, children, fw, dispose: () => w.dispose() };
}

const read = (w: PlacementWorld, path: string): string => readFileSync(join(w.folder, path), "utf8");
/** Every ref matching `pattern`, name → object. */
const refsOf = (w: PlacementWorld, pattern: RegExp): Record<string, string> => Object.fromEntries(
  w.git(["for-each-ref", "--format=%(refname) %(objectname)"]).split("\n").filter((line) => line.length > 0)
    .map((line) => line.split(" ") as [string, string]).filter(([name]) => pattern.test(name)));

/** The lock's events are one holder at a time on one key: enter(held 1) / exit(held 0), never nested or overlapped. */
function expectSerial(events: DirLockEvent[], key: string): void {
  let depth = 0;
  for (const event of events) {
    expect(event.key).toBe(key);
    if (event.phase === "enter") { expect(event.held).toBe(1); expect(event.active).toBe(1); depth += 1; }
    else { expect(event.held).toBe(0); expect(event.active).toBe(0); depth -= 1; }
  }
  expect(depth).toBe(0);
}

describe("one folder, a flow run and a dir group (D8)", { timeout: 30_000 }, () => {
  it("the placement pass holds one lock from classification to swap; the flow's snapshot and copy-back take it in turn", async () => {
    const s = await sharedWorld({ "a.md": "A\n", "b.md": "B\n" });
    const events: DirLockEvent[] = [];
    dirLockProbe.observe = (event) => events.push(event);
    try {
      const key = s.w.frozen.dir.normalize("NFC");
      const { flowRunId } = await s.fw.start({ templateRef: "builtin/two" });
      await s.fw.advance();
      // The drift snapshot before the first dispatch.
      expect(events.map((event) => event.phase)).toEqual(["enter", "exit"]);
      s.children.land(childGroupIdOf(flowRunId, "one", 1), { "flow-one.txt": "one\n" });
      await s.fw.advance();
      // Settle: the snapshot, then the copy-back; then the snapshot before step two starts.
      expect(events).toHaveLength(8);
      expectSerial(events, key);
      s.children.land(childGroupIdOf(flowRunId, "two", 1), { "conflict.md": "flow bytes\n" });
      await s.fw.advance();
      expectSerial(events, key);

      s.w.land({ "group.txt": "G\n" });
      const from = events.length;
      let competing: Promise<void> | null = null;
      let competingEntered = false;
      expect(await s.w.place((point) => {
        // Every hook fires inside the pass's one lock.
        expect(dirLockHeld(key)).toBe(1);
        if (point === "after-journal" && competing === null) competing = withDirLock(key, async () => { competingEntered = true; });
      })).toBe(true);
      await competing!;
      expect(competingEntered).toBe(true);
      // One pair for the pass, then one for the queued caller: nothing entered between the pass's steps.
      expect(events.slice(from).map((event) => event.phase)).toEqual(["enter", "exit", "enter", "exit"]);
      expectSerial(events, key);
      expect(s.w.record()).toMatchObject({ state: "idle", changed: [] });
      expect(read(s.w, "group.txt")).toBe("G\n");
    } finally { dirLockProbe.observe = undefined; await s.dispose(); }
  });

  it("the placement pass waits while the person holds the folder's lock", async () => {
    const s = await sharedWorld({ "a.md": "A\n" });
    const events: DirLockEvent[] = [];
    dirLockProbe.observe = (event) => events.push(event);
    try {
      const key = s.w.frozen.dir.normalize("NFC");
      s.w.land({ "a.md": "A2\n" });
      let entered!: () => void;
      const inside = new Promise<void>((resolve) => { entered = resolve; });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const held = withDirLock(key, async () => { entered(); await gate; });
      await inside;
      events.length = 0;
      let done = false;
      const placing = s.w.place().then((value) => { done = true; return value; });
      await new Promise((resolve) => setTimeout(resolve, 100));
      // It has not entered the folder's lock while the person holds it (an entry would be recorded at once).
      expect(events).toEqual([]);
      expect(done).toBe(false);
      release();
      await held;
      expect(await placing).toBe(true);
      expect(events.shift()).toMatchObject({ phase: "exit", key, held: 0 });
      expect(events.map((event) => event.phase)).toEqual(["enter", "exit"]);
      expect(read(s.w, "a.md")).toBe("A2\n");
    } finally { dirLockProbe.observe = undefined; await s.dispose(); }
  });

  it("a flow copy-back on disjoint paths does not stop the group, both writers' files end in the folder, and neither moves the other's refs", async () => {
    const s = await sharedWorld({ "a.md": "A\n", "b.md": "B\n" });
    try {
      const groupRefs = (): Record<string, string> => refsOf(s.w, /^refs\/(orca\/group\/g\/|heads\/orca\/g$)/);
      const groupsBefore = groupRefs();
      const { flowRunId } = await s.fw.start({ templateRef: "builtin/two" });
      await s.fw.advance();
      s.children.land(childGroupIdOf(flowRunId, "one", 1), { "flow-one.txt": "one\n" });
      await s.fw.advance();
      expect(read(s.w, "flow-one.txt")).toBe("one\n");
      expect(groupRefs()).toEqual(groupsBefore);
      const flowRefs = (): Record<string, string> => refsOf(s.w, new RegExp(`^refs/orca/${flowRunId}/`));
      const flowBefore = flowRefs();
      expect(Object.keys(flowBefore).length).toBeGreaterThan(0);

      s.w.land({ "group.txt": "G\n" });
      expect(await s.w.place()).toBe(true);
      expect(s.w.record()).toMatchObject({ state: "idle", changed: [] });
      expect(read(s.w, "flow-one.txt")).toBe("one\n");
      expect(read(s.w, "group.txt")).toBe("G\n");
      expect(flowRefs()).toEqual(flowBefore);
    } finally { await s.dispose(); }
  });

  it("a flow copy-back writing a path the group modifies to other bytes stops the group; take-folder attributes it to the run and the person's edit to the person", async () => {
    const s = await sharedWorld({ "a.md": "A\n", "b.md": "B\n" });
    try {
      const { flowRunId } = await s.fw.start({ templateRef: "builtin/two" });
      await s.fw.advance();
      s.children.land(childGroupIdOf(flowRunId, "one", 1), { "conflict.md": "flow bytes\n" });
      await s.fw.advance();
      expect(read(s.w, "conflict.md")).toBe("flow bytes\n");
      const flowRefs = (): Record<string, string> => refsOf(s.w, new RegExp(`^refs/orca/${flowRunId}/`));
      const flowBefore = flowRefs();

      writeFileSync(join(s.w.folder, "b.md"), "mine\n");
      s.w.land({ "b.md": "B2\n", "conflict.md": "group bytes\n" });
      expect(await s.w.place()).toBe(true);
      expect(s.w.record()).toMatchObject({ state: "folder-changed", changed: ["b.md", "conflict.md"], pending: null });
      // The group wrote nothing: the flow's bytes and the person's edit stay.
      expect(read(s.w, "conflict.md")).toBe("flow bytes\n");
      expect(read(s.w, "b.md")).toBe("mine\n");

      expect(s.w.resolve("take-folder")).toEqual({ ok: true });
      expect(await s.w.place()).toBe(true);
      expect(s.w.record()).toMatchObject({ state: "idle", changed: [] });
      const branch = s.w.ref("refs/heads/orca/g")!;
      expect(s.w.show(branch, "conflict.md")).toBe("flow bytes");
      expect(s.w.show(branch, "b.md")).toBe("mine");
      const message = s.w.git(["show", "-s", "--format=%B", branch]);
      expect(message).toContain(`Orca-Placed-By: ${flowRunId} 1 paths`);
      expect(message).toContain("Orca-Person-Edit: 1 paths");
      expect(flowRefs()).toEqual(flowBefore);
    } finally { await s.dispose(); }
  });
});
