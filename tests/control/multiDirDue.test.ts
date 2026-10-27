/**
 * Multi-directory projects spec §9.1, §9.4, criterion M17: only a directory that wrote is carried (and only it moves);
 * a `keep` directory with new work never makes the group due; a due group with nothing to carry ends `landed` with
 * `lastLanded[key] = tip` and is not due on the next round (round 2, N3). The accept/export half -- every member's export
 * base in `lastLanded` -- is exercised by `multiDirSplit.test.ts` against a real export.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { placementRefs } from "../../src/control/dirPlacement.js";
import { prerequisiteDone } from "../../src/control/groupEdges.js";
import { reopenMultiLanding, type LandingScheme } from "../../src/control/multiLandingRecord.js";
import { readProjectionChanges, readProjectionState } from "../../src/control/projectionJournal.js";
import { multiLandingWorld, type MultiLandingWorld } from "./fixtures/multiLandingWorld.js";

let world: MultiLandingWorld | null = null;
afterEach(async () => { await world?.dispose(); world = null; });

const keep: Record<"local" | "remote" | "posts", LandingScheme> = {
  local: { delivery: "local", trigger: "task", method: "merge", target: "main" },
  remote: { delivery: "keep" },
  posts: { delivery: "place" },
};

describe("due and never-written directories (§9.1, M17)", () => {
  it("carries only the directory that wrote, leaving the other targets untouched", async () => {
    world = await multiLandingWorld();
    const w = world;
    // The export bases are this fixture's start; say the other two never wrote.
    w.setLanding({ lastLanded: { local: w.localMain, remote: w.remoteWork, posts: w.postsWork } });
    await w.settle();
    expect(w.landing()).toMatchObject({ state: "landed", pending: null, lastLanded: { local: w.localWork, remote: w.remoteWork, posts: w.postsWork } });
    expect(w.tipOf(w.local, "refs/heads/main")).not.toBe(w.localMain);
    expect(w.tipOf(w.bare, "refs/heads/main")).toBe(w.remoteMain);
    expect(w.tipOf(w.vault, placementRefs("g").placed)).toBe(w.base);
    expect(readFileSync(join(w.folder, "notes", "p1.md"), "utf8")).toBe("first post\n");
  });

  it("never makes the group due for a keep directory with new work", async () => {
    world = await multiLandingWorld({ delivery: keep });
    const w = world;
    // Only the keep member holds new work: local and posts are at their export bases.
    w.setLanding({ lastLanded: { local: w.localWork, remote: w.remoteMain, posts: w.postsWork } });
    await w.pass();
    // Complete with nothing carried: `landed`, and nothing is published.
    expect(w.landing()).toMatchObject({ state: "landed", pending: null });
    expect(w.tipOf(w.bare, "refs/heads/main")).toBe(w.remoteMain);
    expect(await w.pass()).toBe(false);
  });

  it("answers a dependent for a complete group that was never due (§9.9)", async () => {
    world = await multiLandingWorld({ delivery: keep });
    const w = world;
    w.store.db.prepare("INSERT INTO work_items VALUES ('g','t',1,?)").run(JSON.stringify({ kind: "task", status: "done" }));
    w.setLanding({ lastLanded: { local: w.localWork, remote: w.remoteMain, posts: w.postsWork } });
    // The record starts `idle`; only a round can settle it, and nothing will ever make it due.
    expect(prerequisiteDone(w.store, "g")).toBe(false);
    await w.pass();
    expect(w.landing()).toMatchObject({ state: "landed", pending: null });
    expect(prerequisiteDone(w.store, "g")).toBe(true);
    expect(w.tipOf(w.local, "refs/heads/main")).toBe(w.localMain);
    expect(w.tipOf(w.bare, "refs/heads/main")).toBe(w.remoteMain);
    expect(w.tipOf(w.vault, placementRefs("g").placed)).toBe(w.base);
  });

  it("skips a group that is not complete, stopped, archived or reconciling (§9.1)", async () => {
    const patch = (w: MultiLandingWorld, values: Record<string, unknown>): void => {
      w.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...w.body(), ...values }));
    };
    const setups: Array<[string, (w: MultiLandingWorld) => void]> = [
      ["not complete", (w) => { w.store.db.prepare("INSERT INTO work_items(group_id,id,target_version,body) VALUES ('g','t',0,?)").run(JSON.stringify({ kind: "task", status: "ready" })); }],
      ["stopped", (w) => patch(w, { stopped: true })],
      ["archived", (w) => patch(w, { archived: { at: 1, actor: "owner" } })],
      ["reconciling", (w) => { w.store.db.prepare("INSERT INTO runs VALUES ('r1','g','t',1,1,?)").run(JSON.stringify({ state: "reconciling" })); }],
    ];
    for (const [name, setup] of setups) {
      world = await multiLandingWorld();
      const w = world;
      setup(w);
      expect(await w.pass(), name).toBe(false);
      expect(w.landing(), name).toMatchObject({ state: "idle", pending: null });
      expect(w.tipOf(w.local, "refs/heads/main"), name).toBe(w.localMain);
      expect(w.tipOf(w.bare, "refs/heads/main"), name).toBe(w.remoteMain);
      await w.dispose();
    }
    world = null;
  });

  it("lands nothing and journals no plan when the driver stops mid-pre-check (§9.1)", async () => {
    world = await multiLandingWorld();
    const w = world;
    // The first probe is the round's; the second is the pre-check's own, mid-walk.
    let probes = 0;
    expect(await w.pass({ stopped: () => ++probes > 1 })).toBe(false);
    // An aborted pre-check writes nothing: a truncated plan must never look journaled.
    expect(w.landing()).toMatchObject({ state: "idle", pending: null, failedKey: null });
    expect(w.tipOf(w.local, "refs/heads/main")).toBe(w.localMain);
    expect(w.tipOf(w.bare, "refs/heads/main")).toBe(w.remoteMain);
  });

  it("moves the group's projection sequence when it lands (§12: the panel's feed sees it)", async () => {
    world = await multiLandingWorld();
    const w = world;
    const seqOf = (): number => Number(w.store.db.prepare("SELECT projection_seq FROM groups WHERE id='g'").get()!.projection_seq);
    const seqBefore = seqOf();
    const changesBefore = readProjectionState(w.store).changeSeq;
    await w.settle();
    expect(w.landing()).toMatchObject({ state: "landed" });
    // The landing writes the group body outside any run's save, so it records its own projection move.
    expect(seqOf()).toBeGreaterThan(seqBefore);
    expect(readProjectionChanges(w.store, changesBefore).groups.map((group) => group.groupId)).toContain("g");
  });

  it("ends a due group with nothing to carry as landed, and is not due again", async () => {
    world = await multiLandingWorld({ delivery: { ...keep, remote: { delivery: "push-target", trigger: "task", method: "merge", target: "main", remote: "origin" } } });
    const w = world;
    // Every carried directory's tip is already in its target (or already its `lastLanded`); only local and remote
    // are behind. The plan is empty, so the pass may only record the tips.
    w.setLanding({ lastLanded: { local: w.localMain, remote: w.remoteMain, posts: w.postsWork } });
    w.repoOf(w.local)(["update-ref", "refs/heads/main", w.localWork, w.localMain]);
    w.repoOf(w.remote)(["push", "-q", "--force", "origin", `${w.remoteWork}:refs/heads/main`]);
    await w.settle();
    expect(w.landing()).toMatchObject({ state: "landed", pending: null, lastLanded: { local: w.localWork, remote: w.remoteWork, posts: w.postsWork } });
    expect(await w.pass()).toBe(false);
    expect(w.landing().lastLanded).toMatchObject({ local: w.localWork, remote: w.remoteWork });
    // Nothing was published: the refs and the folder are where they already were.
    expect(w.tipOf(w.local, "refs/heads/main")).toBe(w.localWork);
    expect(w.tipOf(w.bare, "refs/heads/main")).toBe(w.remoteWork);
    expect(w.tipOf(w.vault, placementRefs("g").placed)).toBe(w.base);
    expect(readFileSync(join(w.folder, "notes", "p1.md"), "utf8")).toBe("first post\n");
  });

  // Review of H7 (Orca session 7753e97d): §9.9 wants `lastLanded` equal to the tip; the DB-only check took `landed` for
  // that, so between a run's landing (a moved tip) and the next pass a dependent could start before the work was carried.
  it("is not done between a landing that moved a work branch and the pass that carries it (§9.9)", async () => {
    world = await multiLandingWorld();
    const w = world;
    w.store.db.prepare("INSERT INTO work_items VALUES ('g','t',1,?)").run(JSON.stringify({ kind: "task", status: "done" }));
    await w.settle();
    expect(prerequisiteDone(w.store, "g")).toBe(true);
    // A later run lands on local's work branch; the landing's write reopens the record (markLanded does this).
    const later = w.commitWith(w.repoOf(w.local), w.localWork, { "local.txt": "later\n" }, "local later");
    w.repoOf(w.local)(["update-ref", "refs/heads/orca/g", later]);
    reopenMultiLanding(w.store, "g");
    expect(prerequisiteDone(w.store, "g")).toBe(false);
    // The pass carries it; only then is the group done again.
    await w.settle();
    expect(w.landing()).toMatchObject({ state: "landed", lastLanded: { local: later } });
    expect(prerequisiteDone(w.store, "g")).toBe(true);
  });
});
