/**
 * Multi-directory projects spec §9.7-§9.8, criterion M18 (review 10): a folder stop can take the person's landing verb
 * (`multi-dir-landing` is accepted in `folder-changed`), `resolve-folder-change` names the member (`dir` is required,
 * refused `folder-change-dir-mismatch` without it), and after `{dir, recheck}` the next round pre-checks again and
 * lands with no further command. Once the landing is done the verb is refused.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { placementRefs } from "../../src/control/dirPlacement.js";
import { multiLandingWorld, type MultiLandingWorld } from "./fixtures/multiLandingWorld.js";

let world: MultiLandingWorld | null = null;
afterEach(async () => { await world?.dispose(); world = null; });

/** The person edits a path the landing writes, and the pass stops there. */
async function stopOnFolder(w: MultiLandingWorld): Promise<void> {
  writeFileSync(join(w.folder, "notes", "p1.md"), "person edit\n");
  await w.settle();
  expect(w.landing()).toMatchObject({ state: "folder-changed", failedKey: "posts", reason: "dir-folder-changed:posts" });
}

describe("a folder stop and the person's answer (§9.7-§9.8, M18)", () => {
  it("accepts multi-dir-landing while the folder stop holds", async () => {
    world = await multiLandingWorld();
    const w = world;
    await stopOnFolder(w);
    const answer = w.answer("retry-rest");
    expect(answer).toMatchObject({ ok: true, result: { kind: "multi-dir-landing-set", action: "retry-rest" } });
    // The person has not answered the folder yet: the next pre-check stops at the same path, nothing lands.
    await w.settle();
    expect(w.landing()).toMatchObject({ state: "folder-changed", failedKey: "posts", reason: "dir-folder-changed:posts" });
    expect(w.tipOf(w.local, "refs/heads/main")).toBe(w.localMain);
    expect(w.tipOf(w.bare, "refs/heads/main")).toBe(w.remoteMain);
  });

  it("pre-checks again after {dir, recheck} and lands with no further command", async () => {
    world = await multiLandingWorld();
    const w = world;
    await stopOnFolder(w);
    // The person undoes the edit: the folder is again what `placed` holds.
    writeFileSync(join(w.folder, "notes", "p1.md"), "first post\n");
    expect(w.resolve("recheck", "posts")).toEqual({ ok: true });
    await w.settle();
    expect(w.landing()).toMatchObject({ state: "landed", pending: null, lastLanded: { local: w.localWork, remote: w.remoteWork, posts: w.postsWork } });
    // Everything landed once; the folder's landing wrote the work branch's tree over the export base.
    expect(w.repoOf(w.local)(["rev-list", "--parents", "-n", "1", w.tipOf(w.local, "refs/heads/main")!]).split(" ").slice(1)).toEqual([w.localMain, w.localWork]);
    expect(w.repoOf(w.bare)(["rev-list", "--parents", "-n", "1", w.tipOf(w.bare, "refs/heads/main")!]).split(" ").slice(1)).toEqual([w.remoteMain, w.remoteWork]);
    const placed = w.tipOf(w.vault, placementRefs("g").placed)!;
    expect(w.vaultOf(w.vault)(["rev-parse", `${placed}^{tree}`])).toBe(w.vaultOf(w.vault)(["rev-parse", `${w.postsWork}^{tree}`]));
    expect(w.vaultOf(w.vault)(["rev-list", "--parents", "-n", "1", placed]).split(" ").slice(1)).toEqual([w.base]);
    expect(readFileSync(join(w.folder, "notes", "p1.md"), "utf8")).toBe("landed post\n");
  });

  it("pre-checks again when the person undoes the edit, with no command at all (§9.8)", async () => {
    world = await multiLandingWorld();
    const w = world;
    await stopOnFolder(w);
    // The person undoes the edit; the watch signature moves, so the next round classifies again on its own.
    writeFileSync(join(w.folder, "notes", "p1.md"), "first post\n");
    await w.settle();
    expect(w.landing()).toMatchObject({ state: "landed", pending: null, lastLanded: { local: w.localWork, remote: w.remoteWork, posts: w.postsWork } });
    expect(readFileSync(join(w.folder, "notes", "p1.md"), "utf8")).toBe("landed post\n");
  });

  it("waits on a stopped folder whose signature has not moved (§9.8)", async () => {
    world = await multiLandingWorld();
    const w = world;
    await stopOnFolder(w);
    const sentinel = join(w.root, "precheck-ran.txt");
    w.setCheck("local", true, `printf ran >> ${sentinel}`);
    // The folder and its stopping paths are untouched: the pass waits and lands nothing.
    expect(await w.pass()).toBe(false);
    expect(w.landing()).toMatchObject({ state: "folder-changed" });
    expect(existsSync(sentinel)).toBe(false);
  });

  it("records a stopped folder that vanished as missing, not a crash (§9.8)", async () => {
    world = await multiLandingWorld();
    const w = world;
    await stopOnFolder(w);
    renameSync(w.folder, `${w.folder}-gone`);
    await w.settle();
    expect(w.landing()).toMatchObject({ state: "blocked", failedKey: "posts", reason: "folder-missing:posts" });
    expect(w.tipOf(w.local, "refs/heads/main")).toBe(w.localMain);
  });

  it("records a vanished folder as missing even when its stop list is truncated (§9.8)", async () => {
    world = await multiLandingWorld();
    const w = world;
    await stopOnFolder(w);
    // A large stop keeps its full list in the vault; reading it is what opens the folder that then vanished.
    const posts = w.landing().placement!.posts!;
    const blob = w.vaultOf(w.vault)(["hash-object", "-w", "--stdin"], { input: JSON.stringify({ changed: posts.changed, unwritable: posts.unwritable }) });
    w.setLanding({ placement: { ...w.landing().placement, posts: { ...posts, changedTotal: posts.changed.length + 1, stopRecord: blob } } });
    renameSync(w.folder, `${w.folder}-gone`);
    await w.settle();
    expect(w.landing()).toMatchObject({ state: "blocked", failedKey: "posts", reason: "folder-missing:posts" });
  });

  it("refuses resolve-folder-change without the member key", async () => {
    world = await multiLandingWorld();
    const w = world;
    await stopOnFolder(w);
    expect(w.resolve("recheck")).toEqual({ ok: false, code: "folder-change-dir-mismatch" });
    // The stop still stands: nothing answered it.
    expect(w.landing()).toMatchObject({ state: "folder-changed", failedKey: "posts" });
  });

  it("refuses multi-dir-landing once the landing is done", async () => {
    world = await multiLandingWorld();
    const w = world;
    await w.settle();
    expect(w.landing()).toMatchObject({ state: "landed" });
    expect(w.answer("retry-rest")).toEqual({ ok: false, code: "multi-dir-landing-not-pending" });
  });
});
