/**
 * Multi-directory projects spec §9.4-§9.5, criterion M10: three directories -- a `local` repository, a `push-target`
 * repository and a folder -- land in registered order; a folder stop (a person's edit to a path the landing writes)
 * stops the whole pre-check before anything moved; drift on a path the landing does not write never stops; `withhold`
 * lets the next pre-check pass.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { placementRefs } from "../../src/control/dirPlacement.js";
import { folderState } from "./fixtures/dirPlacementWorld.js";
import { multiLandingWorld, type MultiLandingWorld } from "./fixtures/multiLandingWorld.js";

let world: MultiLandingWorld | null = null;
afterEach(async () => { await world?.dispose(); world = null; });

const refsOf = (w: MultiLandingWorld) => ({
  localMain: w.tipOf(w.local, "refs/heads/main"),
  remoteMain: w.tipOf(w.bare, "refs/heads/main"),
  postsPlaced: w.tipOf(w.vault, placementRefs("g").placed),
});

describe("the pre-check's refusals (§9.4)", () => {
  it("blocks a missing target branch before anything lands", async () => {
    world = await multiLandingWorld();
    const w = world;
    w.repoOf(w.local)(["update-ref", "-d", "refs/heads/main"]);
    await w.settle();
    expect(w.landing()).toMatchObject({ state: "blocked", pending: null, failedKey: "local", reason: "multi-dir-target-missing:local" });
    expect(w.tipOf(w.bare, "refs/heads/main")).toBe(w.remoteMain);
    expect(w.tipOf(w.vault, placementRefs("g").placed)).toBe(w.base);
  });

  it("names the paths of a conflict against the directory's target and lands nothing", async () => {
    world = await multiLandingWorld();
    const w = world;
    // The person changed the same file on `main` after the export base: the merge with the work branch conflicts.
    const sibling = w.commitWith(w.repoOf(w.local), w.localMain, { "local.txt": "person\n" }, "person");
    w.repoOf(w.local)(["update-ref", "refs/heads/main", sibling]);
    await w.settle();
    expect(w.landing()).toMatchObject({ state: "blocked", pending: null, failedKey: "local", reason: "multi-dir-precheck-conflict:local:local.txt" });
    expect(w.landing().detail).toContain("local.txt");
    expect(w.tipOf(w.local, "refs/heads/main")).toBe(sibling);
    expect(w.tipOf(w.bare, "refs/heads/main")).toBe(w.remoteMain);
  });

  it("refuses a checked-out target with a dirty worktree", async () => {
    world = await multiLandingWorld();
    const w = world;
    w.repoOf(w.local)(["checkout", "-q", "main"]);
    writeFileSync(join(w.local, "local.txt"), "dirty\n");
    await w.settle();
    expect(w.landing()).toMatchObject({ state: "blocked", pending: null, failedKey: "local", reason: "integration-worktree-dirty:local" });
    expect(w.tipOf(w.local, "refs/heads/main")).toBe(w.localMain);
    expect(w.tipOf(w.local, "HEAD")).toBe(w.localMain);
  });

  it("refuses a push-target member whose remote is not configured", async () => {
    world = await multiLandingWorld();
    const w = world;
    w.repoOf(w.remote)(["remote", "remove", "origin"]);
    await w.settle();
    expect(w.landing()).toMatchObject({ state: "blocked", pending: null, failedKey: "remote", reason: "integration-remote-missing:remote" });
    // The directories before it were pre-checked but nothing was published.
    expect(w.tipOf(w.local, "refs/heads/main")).toBe(w.localMain);
    expect(w.tipOf(w.bare, "refs/heads/main")).toBe(w.remoteMain);
  });
});

describe("a multi group's landing (§9.4-§9.5, M10)", () => {
  it("lands a local repository, a push-target repository and a folder in registered order", async () => {
    world = await multiLandingWorld();
    const w = world;
    const order: string[] = [];
    await w.settle({ beforePublish: (key) => { order.push(key); } });
    const record = w.landing();
    expect(record).toMatchObject({ state: "landed", pending: null, failedKey: null, reason: null });
    expect(order).toEqual(["local", "remote", "posts"]);
    expect(record.lastLanded).toEqual({ local: w.localWork, remote: w.remoteWork, posts: w.postsWork });
    // local: a merge of the work branch into the target's base.
    const localMain = w.tipOf(w.local, "refs/heads/main")!;
    expect(w.repoOf(w.local)(["rev-list", "--parents", "-n", "1", localMain]).split(" ").slice(1)).toEqual([w.localMain, w.localWork]);
    expect(w.repoOf(w.local)(["show", `${localMain}:local.txt`])).toBe("landed");
    // push-target: the same merge, pushed to the bare remote.
    const remoteMain = w.tipOf(w.bare, "refs/heads/main")!;
    expect(w.repoOf(w.bare)(["rev-list", "--parents", "-n", "1", remoteMain]).split(" ").slice(1)).toEqual([w.remoteMain, w.remoteWork]);
    expect(w.repoOf(w.bare)(["show", `${remoteMain}:remote.txt`])).toBe("landed");
    // place: the folder holds the work branch's tree, and `placed` names that commit.
    expect(readFileSync(join(w.folder, "notes", "p1.md"), "utf8")).toBe("landed post\n");
    expect(w.vaultOf(w.vault)(["rev-parse", `${w.tipOf(w.vault, placementRefs("g").placed)!}^{tree}`]))
      .toBe(w.vaultOf(w.vault)(["rev-parse", `${w.postsWork}^{tree}`]));
  });

  it("blocks the whole pre-check on a folder path the landing writes, then lands the rest after withhold", async () => {
    world = await multiLandingWorld();
    const w = world;
    writeFileSync(join(w.folder, "notes", "p1.md"), "person edit\n");
    const refsBefore = refsOf(w), folderBefore = folderState(w.folder);
    await w.settle();
    expect(w.landing()).toMatchObject({ state: "folder-changed", failedKey: "posts", reason: "dir-folder-changed:posts" });
    // Nothing moved: every target ref and every folder entry is what it was.
    expect(refsOf(w)).toEqual(refsBefore);
    expect(folderState(w.folder)).toEqual(folderBefore);
    expect(w.resolve("withhold", "posts")).toEqual({ ok: true });
    await w.settle();
    expect(w.landing()).toMatchObject({ state: "landed", pending: null });
    // The person's bytes stay; the withheld path was not written.
    expect(readFileSync(join(w.folder, "notes", "p1.md"), "utf8")).toBe("person edit\n");
    expect(w.landing().lastLanded.posts).toBe(w.postsWork);
    expect(w.tipOf(w.local, "refs/heads/main")).not.toBe(w.localMain);
    expect(w.tipOf(w.bare, "refs/heads/main")).not.toBe(w.remoteMain);
  });

  it("does not stop for an edit to a folder path the landing does not write", async () => {
    world = await multiLandingWorld();
    const w = world;
    writeFileSync(join(w.folder, "README.md"), "# Posts, edited by the person\n");
    await w.settle();
    expect(w.landing()).toMatchObject({ state: "landed", pending: null });
    expect(readFileSync(join(w.folder, "README.md"), "utf8")).toBe("# Posts, edited by the person\n");
    expect(readFileSync(join(w.folder, "notes", "p1.md"), "utf8")).toBe("landed post\n");
  });
});
