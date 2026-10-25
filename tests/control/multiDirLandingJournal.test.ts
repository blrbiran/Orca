/**
 * Multi-directory projects spec §9.5 step 1 and §9.6, criterion M12: the plan is journaled whole before the first
 * publish, and a process death at any of the landing's crash points replays without publishing anything twice. Each
 * case ends `landed` with every target at `next` exactly once -- one merge commit per repository, one placement.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { placementRefs } from "../../src/control/dirPlacement.js";
import { multiLandingWorld, type MultiLandingCrashPoint, type MultiLandingWorld } from "./fixtures/multiLandingWorld.js";

let world: MultiLandingWorld | null = null;
afterEach(async () => { await world?.dispose(); world = null; });

const CRASHES: MultiLandingCrashPoint[] = [
  "multi-land-after-journal",
  "multi-land-after-publish:local",
  "multi-land-after-publish:remote",
  "multi-land-after-publish:posts",
  "multi-land-after-record:local",
  "multi-land-after-record:remote",
  "multi-land-after-record:posts",
];

/** §9.5 step 2: each publish is recorded after it, so a death before the record leaves it out. */
const LANDED_AT_CRASH: Record<MultiLandingCrashPoint, string[]> = {
  "multi-land-after-journal": [],
  "multi-land-after-publish:local": [],
  "multi-land-after-publish:remote": ["local"],
  "multi-land-after-publish:posts": ["local", "remote"],
  "multi-land-after-record:local": ["local"],
  "multi-land-after-record:remote": ["local", "remote"],
  "multi-land-after-record:posts": ["local", "remote", "posts"],
};

/** The first crash at `at`; a replay at the same point is allowed through. */
const crashOnce = (at: MultiLandingCrashPoint) => {
  let fired = false;
  return (point: MultiLandingCrashPoint): void => {
    if (point !== at || fired) return;
    fired = true;
    throw new Error(`crash ${at}`);
  };
};

/** A merge commit count between `from` and `to`, and the tip's parents. */
const merges = (w: MultiLandingWorld, repo: string, from: string, to: string): number =>
  Number(w.repoOf(repo)(["rev-list", "--count", "--min-parents=2", `${from}..${to}`]));
const parents = (w: MultiLandingWorld, repo: string, commit: string): string[] =>
  w.repoOf(repo)(["rev-list", "--parents", "-n", "1", commit]).split(" ").slice(1);

/** Every target is at `next`, landed exactly once. */
function expectLandedOnce(w: MultiLandingWorld): void {
  const record = w.landing();
  expect(record).toMatchObject({ state: "landed", pending: null, failedKey: null, reason: null, movedBeforeAny: 0 });
  expect(record.lastLanded).toEqual({ local: w.localWork, remote: w.remoteWork, posts: w.postsWork });
  const localMain = w.tipOf(w.local, "refs/heads/main")!;
  expect(parents(w, w.local, localMain)).toEqual([w.localMain, w.localWork]);
  expect(merges(w, w.local, w.localMain, localMain)).toBe(1);
  const remoteMain = w.tipOf(w.bare, "refs/heads/main")!;
  expect(parents(w, w.bare, remoteMain)).toEqual([w.remoteMain, w.remoteWork]);
  expect(merges(w, w.bare, w.remoteMain, remoteMain)).toBe(1);
  const placed = w.tipOf(w.vault, placementRefs("g").placed)!;
  expect(placed).not.toBe(w.base);
  expect(w.vaultOf(w.vault)(["rev-parse", `${placed}^{tree}`])).toBe(w.vaultOf(w.vault)(["rev-parse", `${w.postsWork}^{tree}`]));
  expect(w.vaultOf(w.vault)(["rev-list", "--parents", "-n", "1", placed]).split(" ").slice(1)).toEqual([w.base]);
  expect(readFileSync(join(w.folder, "notes", "p1.md"), "utf8")).toBe("landed post\n");
}

describe("the landing journal's replay (§9.6, M12)", () => {
  for (const at of CRASHES) {
    it(`replays a death at ${at} without publishing twice`, async () => {
      world = await multiLandingWorld();
      const w = world;
      await expect(w.settle({ crash: crashOnce(at) })).rejects.toThrow(`crash ${at}`);
      // The death is mid-sequence, never after it: the journal is on the record and no target is `landed` yet.
      const record = w.landing();
      expect(record.state).toBe("landing");
      expect(record.pending?.plan.map((entry) => entry.key)).toEqual(["local", "remote", "posts"]);
      expect(record.pending?.landed).toEqual(LANDED_AT_CRASH[at]);
      if (at === "multi-land-after-journal") {
        // Nothing was published before the death.
        expect(record.pending?.landed).toEqual([]);
        expect(w.tipOf(w.local, "refs/heads/main")).toBe(w.localMain);
        expect(w.tipOf(w.bare, "refs/heads/main")).toBe(w.remoteMain);
        expect(w.tipOf(w.vault, placementRefs("g").placed)).toBe(w.base);
      }
      if (at === "multi-land-after-publish:local") {
        // The hook names the moment after the publish: the target already moved, the record has not.
        expect(w.tipOf(w.local, "refs/heads/main")).not.toBe(w.localMain);
        expect(record.pending?.landed).toEqual([]);
      }
      await w.settle();
      expectLandedOnce(w);
    });
  }

  it("does not pre-check again while it replays the journal (§9.6)", async () => {
    world = await multiLandingWorld();
    const w = world;
    const sentinel = join(w.root, "precheck-ran.txt");
    w.setCheck("local", true, `printf 'ran\n' >> ${sentinel}`);
    let crashed = false;
    await expect(w.settle({ crash: (point) => {
      if (point !== "multi-land-after-journal" || crashed) return;
      crashed = true;
      throw new Error("crash after journal");
    } })).rejects.toThrow("crash after journal");
    // The pre-check ran once, before the journal: its check left one line.
    expect(readFileSync(sentinel, "utf8")).toBe("ran\n");
    await w.settle();
    // A replay resumes the journaled plan; a second pre-check would have run the check again.
    expect(readFileSync(sentinel, "utf8")).toBe("ran\n");
    expectLandedOnce(w);
  });
});
