/**
 * Dir-requirements spec §7, criterion D13 (plan Task 4, its stacking and `prerequisiteDone` rows): a dir group's work
 * reaches its folder by placement, never by its work branch, so
 * - a dependent of a dir group never stacks on the dir group's `orca/<g>` (deliversLocally answers true for it), while a
 *   dependent of a keep repository group still does (the contrast that shows the rule is what decides);
 * - a dir group is done as a prerequisite only when every task is done AND its placement has caught up: state `idle`,
 *   `pending === null`, `tip === landedTip` -- read from the DB alone. A fake `git` first on PATH counts its calls: 0.
 *
 * Every group here is a raw row (no repository, no vault): a git child would have nothing to read, and the fake counts it.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initialPlacement, type PlacementRecord } from "../../src/control/dirGroup.js";
import { prerequisiteDone, stackBaseOf, waitingPrerequisites } from "../../src/control/groupEdges.js";
import type { ControlStore } from "../../src/control/store.js";
import { openTestStore } from "./fixtures/store.js";

const SHA = { base: "a".repeat(40), landed: "b".repeat(40), other: "c".repeat(40), tmp: "d".repeat(40) };
const DIR_WORKSPACE = { dir: "/nowhere/notes", vaultId: "e".repeat(64) };

function group(store: ControlStore, id: string, body: Record<string, unknown>, taskStatus: string): void {
  store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES (?,0,1,?)").run(id, JSON.stringify({ groupId: id, status: "running", ...body }));
  store.db.prepare("INSERT INTO work_items(group_id,id,target_version,body) VALUES (?,'t',1,?)").run(id, JSON.stringify({ kind: "task", status: taskStatus }));
}
const edge = (store: ControlStore, from: string, to: string) => store.db.prepare("INSERT INTO group_edges(from_group,to_group,body) VALUES (?,?,'{}')").run(from, to);
const setPlacement = (store: ControlStore, id: string, placement: PlacementRecord) => {
  const body = JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id=?").get(id)!.body)) as Record<string, unknown>;
  store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify({ ...body, placement }), id);
};

/** Runs `body` with a `git` first on PATH that logs each invocation (one line per call) and then runs the real git. */
function countingGit<T>(dir: string, body: () => T): { value: T; calls: number } {
  const real = execFileSync("/bin/sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  const log = join(dir, "calls");
  mkdirSync(dir, { recursive: true });
  writeFileSync(log, "");
  writeFileSync(join(dir, "git"), `#!/bin/sh\necho "$*" >> "${log}"\nexec "${real}" "$@"\n`);
  chmodSync(join(dir, "git"), 0o755);
  const saved = process.env.PATH;
  process.env.PATH = `${dir}:${saved ?? ""}`;
  try { const value = body(); return { value, calls: readFileSync(log, "utf8").split("\n").filter((line) => line.length > 0).length }; }
  finally { process.env.PATH = saved; }
}

describe("a dir group as a prerequisite (D13, §7)", () => {
  it("a dependent never stacks on a dir group's branch; on a keep repository group it does", async () => {
    const h = await openTestStore(); try {
      group(h.store, "dir", { dirWorkspace: DIR_WORKSPACE, placement: initialPlacement({ base: SHA.base, landedTip: SHA.landed, at: 1 }) }, "done");
      group(h.store, "keep", {}, "done");
      group(h.store, "d1", {}, "pending");
      group(h.store, "d2", {}, "pending");
      edge(h.store, "dir", "d1");
      edge(h.store, "keep", "d2");
      expect(stackBaseOf(h.store, "d1")).toBeNull();
      expect(stackBaseOf(h.store, "d2")).toBe("refs/heads/orca/keep");
    } finally { await h.dispose(); }
  });

  it("is done only once its tasks are done and its placement caught up, read from the DB with no git child", async () => {
    const h = await openTestStore(); try {
      const caughtUp: PlacementRecord = { ...initialPlacement({ base: SHA.base, landedTip: SHA.landed, at: 1 }), tip: SHA.landed };
      group(h.store, "p", { dirWorkspace: DIR_WORKSPACE, placement: caughtUp }, "running");
      group(h.store, "d", {}, "pending");
      edge(h.store, "p", "d");
      const done = (): boolean => {
        const { value, calls } = countingGit(join(h.root, "count"), () => prerequisiteDone(h.store, "p"));
        expect(calls).toBe(0);
        return value;
      };
      // Tasks not done: not done, whatever the placement says.
      expect(done()).toBe(false);
      h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='p'").run(JSON.stringify({ kind: "task", status: "done" }));
      // Stopped and asking the person.
      setPlacement(h.store, "p", { ...caughtUp, state: "folder-changed", changed: ["a.md"], changedTotal: 1 });
      expect(done()).toBe(false);
      // A write owed (journaled, not finished), even with the state still idle.
      setPlacement(h.store, "p", { ...caughtUp, pending: { from: SHA.base, to: SHA.tmp, tip: SHA.landed, tmp: [], aside: [], dirs: [] } });
      expect(done()).toBe(false);
      // A landing not yet placed: the export's record (tip = base, landedTip = the document commit) and a later landing.
      setPlacement(h.store, "p", initialPlacement({ base: SHA.base, landedTip: SHA.landed, at: 1 }));
      expect(done()).toBe(false);
      setPlacement(h.store, "p", { ...caughtUp, landedTip: SHA.other });
      expect(done()).toBe(false);
      // Placed up to the landed tip: done, and the dependent no longer waits.
      setPlacement(h.store, "p", caughtUp);
      expect(done()).toBe(true);
      expect(waitingPrerequisites(h.store, "d")).toEqual([]);
    } finally { await h.dispose(); }
  });

  it("a dir group with no placement record yet (not exported) is not done", async () => {
    const h = await openTestStore(); try {
      group(h.store, "p", { dirWorkspace: DIR_WORKSPACE }, "done");
      expect(prerequisiteDone(h.store, "p")).toBe(false);
    } finally { await h.dispose(); }
  });
});
