/**
 * Multi-directory projects spec §9.5, §9.7, criterion M11: a target that moves after the pre-check stops the sequence
 * mid-way (`partial`), the directories that landed are not reverted, and the overview asks the person with
 * `multi-dir-partially-landed`; `retry-rest` pre-checks and lands only the rest; `mark-resolved` records `unlanded` with
 * its `by`; a target moved before anything landed retries once and then blocks `multi-dir-target-moved`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { initialLanding } from "../../src/control/multiLandingRecord.js";
import { readProjectionState } from "../../src/control/projectionJournal.js";
import { readControlOverview } from "../../src/panel/controlOverview.js";
import { webFixture } from "./fixtures/web.js";
import { multiLandingWorld, type MultiLandingWorld } from "./fixtures/multiLandingWorld.js";

let world: MultiLandingWorld | null = null;
afterEach(async () => { await world?.dispose(); world = null; });

/** Push a sibling commit onto the bare remote's main before the remote member publishes. */
function moveRemoteOnce(w: MultiLandingWorld): { hook: (key: string) => void; moved: () => string } {
  let sibling: string | null = null, done = false;
  return {
    hook: (key) => {
      if (key !== "remote" || done) return;
      done = true;
      sibling = w.commitWith(w.repoOf(w.remote), w.remoteMain, { "sibling.txt": "s\n" }, "sibling");
      w.repoOf(w.remote)(["push", "-q", "--force", "origin", `${sibling}:refs/heads/main`]);
    },
    moved: () => sibling!,
  };
}

describe("a partial landing and the person's verbs (§9.5, §9.7, M11)", () => {
  it("stops after the first directory, keeps it, and lists the group on the overview", async () => {
    world = await multiLandingWorld();
    const w = world;
    const seam = moveRemoteOnce(w);
    await w.settle({ beforePublish: seam.hook });
    expect(w.landing()).toMatchObject({ state: "partial", failedKey: "remote", reason: "multi-dir-target-moved:remote", pending: { landed: ["local"] } });
    // The first directory stays landed; the moved target is left where the person put it.
    const landedLocal = w.tipOf(w.local, "refs/heads/main")!;
    expect(landedLocal).not.toBe(w.localMain);
    expect(w.tipOf(w.bare, "refs/heads/main")).toBe(seam.moved());
    // The overview raises the needs-you row that names this landing.
    const h = await webFixture();
    try {
      const body = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
      const delivery = [{ key: "a", scheme: { delivery: "keep" as const } }, { key: "b", scheme: { delivery: "keep" as const } }];
      const landing = { ...initialLanding(delivery, 1), state: "partial", failedKey: "b", reason: "multi-dir-target-moved:b" };
      h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({
        ...body, multiDir: { project: "p", landing, dirs: [{ key: "a", repoId: "a", kind: "repo" }, { key: "b", repoId: "b", kind: "repo" }] },
      }));
      const overview = readControlOverview(h.store, "e");
      expect(overview.steps.filter((step) => step.groupId === "g" && step.reason === "multi-dir-partially-landed")).toEqual([
        expect.objectContaining({ kind: "integration-review", ownerRequired: true, destination: { kind: "group", groupId: "g", region: "integration", taskId: null, runId: null } }),
      ]);
    } finally { await h.dispose(); }
  });

  it("retry-rest pre-checks and lands only the directories not landed", async () => {
    world = await multiLandingWorld();
    const w = world;
    const seam = moveRemoteOnce(w);
    await w.settle({ beforePublish: seam.hook });
    const localAfterFailure = w.tipOf(w.local, "refs/heads/main")!;
    // New work arrives on the landed directory after the partial: `retry-rest` must not see it.
    const localLater = w.commitWith(w.repoOf(w.local), w.localWork, { "local.txt": "later\n" }, "local later");
    w.repoOf(w.local)(["update-ref", "refs/heads/orca/g", localLater]);
    expect(w.answer("retry-rest")).toEqual({ ok: true, result: expect.objectContaining({ kind: "multi-dir-landing-set", groupId: "g", action: "retry-rest" }) });
    await w.settle();
    expect(w.landing()).toMatchObject({ state: "landed", pending: null, failedKey: null });
    // Directory 1 was not carried again: its ref is exactly the commit that landed before the failure, and the work
    // that arrived later is still unlanded.
    expect(w.tipOf(w.local, "refs/heads/main")).toBe(localAfterFailure);
    expect(w.landing().lastLanded.local).toBe(w.localWork);
    // The rest landed: the remote on top of the person's sibling, and the folder.
    const remoteMain = w.tipOf(w.bare, "refs/heads/main")!;
    expect(w.repoOf(w.bare)(["rev-list", "--parents", "-n", "1", remoteMain]).split(" ").slice(1)).toEqual([seam.moved(), w.remoteWork]);
    expect(w.landing().lastLanded).toMatchObject({ remote: w.remoteWork, posts: w.postsWork });
    // The next round is due for the work the retry skipped and carries it on top of what landed.
    await w.settle();
    expect(w.tipOf(w.local, "refs/heads/main")).not.toBe(localAfterFailure);
    expect(w.repoOf(w.local)(["rev-list", "--parents", "-n", "1", w.tipOf(w.local, "refs/heads/main")!]).split(" ").slice(1))
      .toEqual([localAfterFailure, localLater]);
    expect(w.landing().lastLanded.local).toBe(localLater);
  });

  it("mark-resolved records the unlanded directories with the person who answered", async () => {
    world = await multiLandingWorld();
    const w = world;
    const seam = moveRemoteOnce(w);
    await w.settle({ beforePublish: seam.hook });
    expect(w.answer("mark-resolved")).toEqual({ ok: true, result: expect.objectContaining({ kind: "multi-dir-landing-set", action: "mark-resolved" }) });
    await w.settle();
    expect(w.landing()).toMatchObject({
      state: "landed", pending: null,
      resolution: { action: "mark-resolved", by: "owner@example.invalid", unlanded: ["remote", "posts"] },
      lastLanded: { remote: w.remoteWork, posts: w.postsWork },
    });
    // "I landed the rest myself": Orca publishes nothing more.
    expect(w.tipOf(w.bare, "refs/heads/main")).toBe(seam.moved());
  });

  it("retries a target moved before anything landed once, then blocks", async () => {
    world = await multiLandingWorld();
    const w = world;
    let moved = 0;
    const hook = (key: string): void => {
      if (key !== "local") return;
      moved += 1;
      const next = w.commitWith(w.repoOf(w.local), w.tipOf(w.local, "refs/heads/main")!, { [`before-${moved}.txt`]: "p\n" }, `person ${moved}`);
      w.repoOf(w.local)(["update-ref", "refs/heads/main", next]);
    };
    await w.settle({ beforePublish: hook });
    expect(w.landing()).toMatchObject({ state: "idle", pending: null, failedKey: "local", reason: "multi-dir-target-moved:local", movedBeforeAny: 1 });
    await w.settle({ beforePublish: hook });
    expect(w.landing()).toMatchObject({ state: "blocked", pending: null, failedKey: "local", reason: "multi-dir-target-moved:local", movedBeforeAny: 0 });
    // Nothing else was attempted.
    expect(w.tipOf(w.bare, "refs/heads/main")).toBe(w.remoteMain);
    expect(w.landing().lastLanded).toMatchObject({ remote: w.remoteMain, posts: w.base });
  });

  // Review of H7 (Orca session 7753e97d): a pre-check that threw wrote the record back unchanged, bumped the projection
  // every round and said so only on stderr -- the group sat `idle` and no one was asked.
  it("blocks multi-dir-precheck-failed when the pre-check throws, and writes nothing more until answered", async () => {
    world = await multiLandingWorld();
    const w = world;
    const repoPathOf = (id: string): string => { if (id === "remote") throw new Error("boom-precheck"); return id === "local" ? w.local : w.vault; };
    await w.pass({ repoPathOf });
    expect(w.landing()).toMatchObject({ state: "blocked", pending: null, failedKey: null, reason: "multi-dir-precheck-failed", detail: "boom-precheck" });
    // Nothing landed anywhere: the pre-check writes into no target.
    expect(w.tipOf(w.local, "refs/heads/main")).toBe(w.localMain);
    expect(w.tipOf(w.bare, "refs/heads/main")).toBe(w.remoteMain);
    // A blocked group waits for the person's answer: the next rounds write nothing.
    const seq = readProjectionState(w.store).changeSeq;
    for (let i = 0; i < 2; i += 1) await w.pass({ repoPathOf });
    expect(readProjectionState(w.store).changeSeq).toBe(seq);
    // The overview asks the person.
    expect(w.answer("retry-rest")).toEqual({ ok: true, result: expect.objectContaining({ action: "retry-rest" }) });
  });

  // Review of H7 (Orca session 7753e97d): `mark-resolved` is accepted while a `retry-rest` pre-check awaits git; the
  // pre-check's journal wrote `resolution: null` over it and the rest landed although the person said they had done it.
  it("keeps a mark-resolved accepted during a retry-rest pre-check and publishes nothing more", async () => {
    world = await multiLandingWorld();
    const w = world;
    const seam = moveRemoteOnce(w);
    await w.settle({ beforePublish: seam.hook });
    expect(w.landing()).toMatchObject({ state: "partial", failedKey: "remote" });
    expect(w.answer("retry-rest")).toEqual({ ok: true, result: expect.objectContaining({ action: "retry-rest" }) });
    let answered: unknown = null;
    const repoPathOf = (id: string): string => {
      if (id === "remote" && answered === null) answered = w.answer("mark-resolved");
      return id === "local" ? w.local : id === "remote" ? w.remote : w.vault;
    };
    await w.pass({ repoPathOf });
    expect(answered).toEqual({ ok: true, result: expect.objectContaining({ action: "mark-resolved" }) });
    // The pass that started from `retry-rest` journaled nothing: the person's later answer is still the record's.
    expect(w.landing()).toMatchObject({ state: "partial", pending: { landed: ["local"] }, resolution: { action: "mark-resolved" } });
    await w.settle();
    expect(w.landing()).toMatchObject({ state: "landed", pending: null, resolution: { action: "mark-resolved", unlanded: ["remote", "posts"] } });
    expect(w.tipOf(w.bare, "refs/heads/main")).toBe(seam.moved());
  });
});
