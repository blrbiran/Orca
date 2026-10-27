/**
 * Dir-requirements spec §8.3–§8.6 and §9.1, criterion D6 (plan Task 5a/5b: classification, stop, modes, lossless writes,
 * the watch re-run; the answers `recheck` / `take-folder` and the overview row are Task 5c's). Each case is its own
 * folder and vault (fixtures/dirPlacementWorld.ts) and runs the placement pass itself.
 *
 * - Collisions stop as `folder-changed` naming exactly the path, and every folder entry keeps its bytes, mode, inode and
 *   mtime (folderState): edit / create / delete / edit-of-a-deleted / edit of a renamed file's old path / `+x` / an
 *   over-cap file (read directly: a snapshot would have left it out) / a `.gitignore`d file.
 * - Not collisions: an edit identical to the landing's (`at-to`: not written, inode and mtime unchanged); the person's
 *   changes on paths no landing touches (placement proceeds and leaves them; a later landing that writes one stops).
 * - Unwritable (`folder-unwritable`, nothing written, the reason named): symlinks, file/directory swaps over their whole
 *   prefix, case clashes -- on this file system and on a case-sensitive one.
 * - Withheld paths (§9.2 `withhold`, through the real command): the stopped paths with their `to` entry and the
 *   answer's `by`; the rest is placed, and each withhold lasts until its `to` entry changes.
 * - The answers (§9.2): `recheck` looks again; `take-folder` reads exactly `changed` directly (so an over-cap or
 *   ignored path is taken), writes the person's folder commit as a `folder edit` on the work branch with the
 *   `Orca-Resolution` trailer and a kept `drift/<n>`, and the next landing stacks on it; a symlink is not taken, and
 *   an Orca-own path never is.
 * - Modes: new files 0644/0755 and new directories 0755 under umask 0077; a changed file keeps its bits, its executable
 *   state following `to`; a file no landing changes keeps its mode.
 * - The watch signature: a stopped group costs no progress until the stopping paths change; an undone edit is placed
 *   with no command. `folder-missing` reports progress only when it moves.
 * - Lossless writes (§8.4, review N1): a hook writes where a person could between the steps.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { readPlacement } from "../../src/control/dirGroup.js";
import { classifyLandingPaths } from "../../src/control/dirPlacement.js";
import { withDirLock } from "../../src/flow/vault/dirLock.js";
import { DOC, folderState, orcaNames, placementWorld, type PlacementWorld } from "./fixtures/dirPlacementWorld.js";

const PLACED = "refs/orca/group/g/placed";
async function inWorld(files: Record<string, string | Buffer>, body: (w: PlacementWorld) => Promise<void>, options: { folder?: string } = {}): Promise<void> {
  const w = await placementWorld(files, options);
  try { await body(w); } finally { await w.dispose(); }
}
const read = (w: PlacementWorld, path: string): string => readFileSync(join(w.folder, path), "utf8");
const modeOf = (w: PlacementWorld, path: string): number => lstatSync(join(w.folder, path)).mode & 0o7777;

/** A collision: the person's change, then one round: stopped on exactly `path`, nothing in the folder touched. */
async function expectCollision(files: Record<string, string | Buffer>, landing: Parameters<PlacementWorld["land"]>[0], person: (w: PlacementWorld) => void, path: string, setup?: (w: PlacementWorld) => void): Promise<void> {
  await inWorld(files, async (w) => {
    setup?.(w);
    w.land(landing);
    person(w);
    const before = folderState(w.folder), placed = w.ref(PLACED);
    expect(await w.place()).toBe(true);
    expect(w.record()).toMatchObject({ state: "folder-changed", changed: [path], changedTotal: 1, unwritable: [], pending: null });
    expect(folderState(w.folder)).toEqual(before);
    expect(w.ref(PLACED)).toBe(placed);
    expect(w.ref("refs/orca/group/g/pending")).toBeNull();
    // The full list is a vault blob under refs/orca/group/g/stop, named in the record.
    expect(w.ref("refs/orca/group/g/stop")).toBe(w.record().stopRecord);
    expect(JSON.parse(w.git(["cat-file", "blob", w.record().stopRecord!]))).toMatchObject({ changed: [path], unwritable: [] });
  });
}

describe("collisions stop placement and touch nothing (§8.3, §9.1)", () => {
  const files = { "a.md": "A\n", "b.md": "B\n" };
  it("the person edits a file the landing modifies", () => expectCollision(files, { "a.md": "A2\n" }, (w) => writeFileSync(join(w.folder, "a.md"), "mine\n"), "a.md"));
  it("the person creates a file where the landing adds one", () => expectCollision(files, { "n.md": "N\n" }, (w) => writeFileSync(join(w.folder, "n.md"), "mine\n"), "n.md"));
  it("the person deletes a file the landing modifies", () => expectCollision(files, { "a.md": "A2\n" }, (w) => unlinkSync(join(w.folder, "a.md")), "a.md"));
  it("the person edits a file the landing deletes", () => expectCollision(files, { "a.md": null }, (w) => writeFileSync(join(w.folder, "a.md"), "mine\n"), "a.md"));
  it("the person edits the old path of a file the landing renames", () => expectCollision(files, { "a.md": null, "c.md": "A\n" }, (w) => writeFileSync(join(w.folder, "a.md"), "mine\n"), "a.md"));
  it("the person sets +x on a file the landing modifies", () => expectCollision(files, { "a.md": "A2\n" }, (w) => chmodSync(join(w.folder, "a.md"), 0o755), "a.md"));
  it("the person edits an over-cap file the landing modifies (read directly, never through a snapshot)", async () => {
    const big = Buffer.alloc(50 * 1024 * 1024 + 1, 0x61);
    await expectCollision({ ...files, "big.bin": big }, { "big.bin": "small\n" }, (w) => appendFileSync(join(w.folder, "big.bin"), "!"), "big.bin", (w) => {
      // The import leaves an over-cap file out; as if an earlier placement had written it, `placed` and the tip hold it.
      expect(w.git(["ls-tree", "--name-only", w.base, "--", "big.bin"])).toBe("");
      const placed = w.commitOn(w.base, { "big.bin": big }), tip = w.commitOn(w.doc, { "big.bin": big });
      w.git(["update-ref", PLACED, placed, w.base]);
      w.git(["update-ref", "refs/heads/orca/g", tip, w.doc]);
      w.setRecord({ tip, landedTip: tip });
    });
  });
  it("the person edits a .gitignore'd file a landing writes", () => expectCollision({ ...files, ".gitignore": "build/\n", "build/out.txt": "mine\n" }, { "build/out.txt": "orca\n" },
    (w) => writeFileSync(join(w.folder, "build/out.txt"), "mine, edited\n"), "build/out.txt"));
});

describe("not collisions (§8.3 at-to, §9.1 narrow rule)", () => {
  it("an edit identical to the landing's is at-to: skipped, not written (inode and mtime unchanged), placement proceeds", () => inWorld({ "a.md": "A\n", "b.md": "B\n" }, async (w) => {
    const tip = w.land({ "a.md": "A2\n", "b.md": "B2\n" });
    writeFileSync(join(w.folder, "a.md"), "A2\n");
    const before = folderState(w.folder)["a.md"];
    expect(await w.place()).toBe(true);
    expect(w.record()).toMatchObject({ state: "idle", tip, landedTip: tip, pending: null, changed: [] });
    expect(folderState(w.folder)["a.md"]).toBe(before);
    expect(read(w, "b.md")).toBe("B2\n");
  }));

  // Review 2026-10-27 (session 7753e97d): `withheld` is the person's list ("Kept in Orca's store" on the page). Orca's own
  // files -- each run's `.decisions/` file and the requirement document -- are never written either, but they are not
  // the person's withholds: recorded there they grew by one per landed run and read as paths the person left out.
  it("Orca's own files are kept out of the folder and never recorded as withheld, however many runs land", () => inWorld({ "a.md": "A\n" }, async (w) => {
    w.land({ "a.md": "A2\n" });
    expect(await w.place()).toBe(true);
    const tip = w.land({ "b.md": "B\n" });
    expect(await w.place()).toBe(true);
    expect(w.record()).toMatchObject({ state: "idle", tip });
    expect(read(w, "b.md")).toBe("B\n");
    expect(existsSync(join(w.folder, ".decisions"))).toBe(false);
    expect(existsSync(join(w.folder, DOC))).toBe(false);
    expect(w.record().withheld).toEqual([]);
  }));

  it("the person's changes on paths no landing touches are left as they are; a later landing that writes one stops", () => inWorld({ "a.md": "A\n", "b.md": "B\n", "d.md": "D\n" }, async (w) => {
    w.land({ "a.md": "A2\n" });
    writeFileSync(join(w.folder, "b.md"), "mine\n");
    writeFileSync(join(w.folder, "c.md"), "created\n");
    unlinkSync(join(w.folder, "d.md"));
    expect(await w.place()).toBe(true);
    expect(w.record()).toMatchObject({ state: "idle", changed: [] });
    expect(read(w, "a.md")).toBe("A2\n");
    expect(read(w, "b.md")).toBe("mine\n");
    expect(read(w, "c.md")).toBe("created\n");
    expect(existsSync(join(w.folder, "d.md"))).toBe(false);
    // Orca's own paths never reach the folder.
    expect(existsSync(join(w.folder, ".orca"))).toBe(false);
    expect(existsSync(join(w.folder, ".decisions"))).toBe(false);
    w.land({ "b.md": "B2\n" });
    expect(await w.place()).toBe(true);
    expect(w.record()).toMatchObject({ state: "folder-changed", changed: ["b.md"] });
    expect(read(w, "b.md")).toBe("mine\n");
  }));
});

describe("unwritable changes stop with their reason and write nothing (§8.3 step 1)", () => {
  async function expectUnwritable(files: Record<string, string>, landing: Parameters<PlacementWorld["land"]>[0], unwritable: Array<{ path: string; reason: string }>, setup?: (w: PlacementWorld) => void): Promise<void> {
    await inWorld(files, async (w) => {
      setup?.(w);
      w.land(landing);
      const before = folderState(w.folder);
      expect(await w.place()).toBe(true);
      expect(w.record()).toMatchObject({ state: "folder-unwritable", changed: [], unwritable, unwritableTotal: unwritable.length });
      expect(folderState(w.folder)).toEqual(before);
    });
  }
  it("a landing that adds a symlink", () => expectUnwritable({ "a.md": "A\n" }, { "link.md": { content: "a.md", mode: "120000" }, "n.md": "N\n" }, [{ path: "link.md", reason: "symlink" }]));
  it("a landing that edits a symlink", () => expectUnwritable({ "a.md": "A\n" }, { "link.md": { content: "b.md", mode: "120000" } }, [{ path: "link.md", reason: "symlink" }], (w) => {
    symlinkSync("a.md", join(w.folder, "link.md"));
    const placed = w.commitOn(w.base, { "link.md": { content: "a.md", mode: "120000" } }), tip = w.commitOn(w.doc, { "link.md": { content: "a.md", mode: "120000" } });
    w.git(["update-ref", PLACED, placed, w.base]);
    w.git(["update-ref", "refs/heads/orca/g", tip, w.doc]);
    w.setRecord({ tip, landedTip: tip });
  }));
  it("a file replacing a folder: every landing path under the swapped prefix", () => expectUnwritable({ "docs/x.md": "X\n", "docs/y.md": "Y\n" }, { "docs/x.md": null, "docs/y.md": null, docs: "now a file\n" },
    [{ path: "docs", reason: "type-change" }, { path: "docs/x.md", reason: "type-change" }, { path: "docs/y.md", reason: "type-change" }]));
  it("a file the landing adds where the person made a directory", () => expectUnwritable({ "a.md": "A\n" }, { "n": "N\n" }, [{ path: "n", reason: "type-change" }],
    (w) => mkdirSync(join(w.folder, "n"))));
  it("an added README.md beside the folder's readme.md, and two added names that differ only in case", () => expectUnwritable({ "readme.md": "r\n" }, { "README.md": "R\n", "Guide.md": "g\n", "guide.md": "g\n" },
    [{ path: "Guide.md", reason: "case-clash" }, { path: "README.md", reason: "case-clash" }, { path: "guide.md", reason: "case-clash" }]));
  // Review 2026-10-27 (session 7753e97d): on a case-insensitive folder `Docs/a.md` and `docs/b.md` land in one directory,
  // spelt as whichever came first, so the folder would no longer hold what the folder commit says. The paths differ as a
  // whole; their directories clash.
  it("two added paths whose directories differ only in case", () => expectUnwritable({ "a.md": "A\n" }, { "Docs/a.md": "a\n", "docs/b.md": "b\n", "n.md": "N\n" },
    [{ path: "Docs/a.md", reason: "case-clash" }, { path: "docs/b.md", reason: "case-clash" }]));

  it("a folder replacing a file (docs, 3 files below) lists all 4; withheld together, the rest is placed; a later change of a withheld `to` entry is judged again", () => inWorld({ docs: "a file\n", "a.md": "A\n" }, async (w) => {
    const tip = w.land({ docs: null, "docs/a.md": "a\n", "docs/b.md": "b\n", "docs/c.md": "c\n", "other.md": "O\n" });
    const four = ["docs", "docs/a.md", "docs/b.md", "docs/c.md"];
    expect(await w.place()).toBe(true);
    expect(w.record()).toMatchObject({ state: "folder-unwritable", unwritable: four.map((path) => ({ path, reason: "type-change" })) });
    expect(existsSync(join(w.folder, "other.md"))).toBe(false);
    // The answer: every unwritable path with its `to` entry; the pass writes the rest and consumes the answer.
    expect(w.resolve("withhold")).toEqual({ ok: true });
    expect(await w.place()).toBe(true);
    expect(w.record()).toMatchObject({ state: "idle", tip, unwritable: [], resolution: null });
    expect(read(w, "other.md")).toBe("O\n");
    expect(read(w, "docs")).toBe("a file\n");
    expect(w.record().withheld.filter((entry) => entry.reason === "type-change").map((entry) => entry.path)).toEqual(four);
    for (const path of four) expect(w.record().withheld.find((entry) => entry.path === path)).toMatchObject({ toEntry: w.entry(tip, path), by: "owner@example.invalid" });
    // Kept in Orca's store: the placed folder commit holds the old file, the work branch the task's directory.
    expect(w.show(w.ref(PLACED)!, "docs")).toBe("a file");
    const later = w.land({ "docs/a.md": "a, changed\n" });
    expect(await w.place()).toBe(true);
    expect(w.record()).toMatchObject({ state: "folder-unwritable", unwritable: four.map((path) => ({ path, reason: "type-change" })) });
    expect(w.record().withheld.map((entry) => entry.path)).not.toContain("docs/a.md");
    expect(w.record().landedTip).toBe(later);
  }));

  it("withhold in folder-changed keeps the person's version and places the rest", () => inWorld({ "a.md": "A\n" }, async (w) => {
    const tip = w.land({ "a.md": "A2\n", "n.md": "N\n" });
    writeFileSync(join(w.folder, "a.md"), "mine\n");
    expect(await w.place()).toBe(true);
    expect(w.record()).toMatchObject({ state: "folder-changed", changed: ["a.md"] });
    expect(w.resolve("withhold")).toEqual({ ok: true });
    expect(await w.place()).toBe(true);
    expect(w.record()).toMatchObject({ state: "idle", tip, changed: [], resolution: null });
    expect(read(w, "a.md")).toBe("mine\n");
    expect(read(w, "n.md")).toBe("N\n");
    expect(w.record().withheld).toContainEqual(expect.objectContaining({ path: "a.md", reason: "changed", toEntry: w.entry(tip, "a.md"), by: "owner@example.invalid" }));
  }));

  it("case folding is NFC then toLowerCase: 'straße' is not a clash with 'strasse' (full case folding would make it one)", () => inWorld({ "strasse.md": "s\n" }, async (w) => {
    const tip = w.land({ "straße.md": "ß\n" });
    const placed = w.ref(PLACED)!;
    const classified = await classifyLandingPaths(w.ws, placed, w.commitOn(placed, { "straße.md": "ß\n" }));
    expect(classified.unwritable).toEqual([]);
    expect(tip).toBeTruthy();
  }));
});

describe("the person's answers (§9.2)", () => {
  it("recheck looks again: still changed stops again and asks again; once the person undoes the edit, it places", () => inWorld({ "a.md": "A\n" }, async (w) => {
    const tip = w.land({ "a.md": "A2\n" });
    writeFileSync(join(w.folder, "a.md"), "mine\n");
    expect(await w.place()).toBe(true);
    expect(w.record()).toMatchObject({ state: "folder-changed", changed: ["a.md"] });
    expect(w.resolve("recheck")).toEqual({ ok: true });
    expect(await w.place()).toBe(true);
    expect(w.record()).toMatchObject({ state: "folder-changed", changed: ["a.md"], resolution: null });
    expect(read(w, "a.md")).toBe("mine\n");
    writeFileSync(join(w.folder, "a.md"), "A\n");
    expect(w.resolve("recheck")).toEqual({ ok: true });
    expect(await w.place()).toBe(true);
    expect(w.record()).toMatchObject({ state: "idle", tip, changed: [], resolution: null });
    expect(read(w, "a.md")).toBe("A2\n");
  }));

  it("take-folder reads exactly changed directly (an over-cap path too), joins the person's version to the work branch and the folder commit, keeps the drift, and the next landing stacks on it", async () => {
    const big = Buffer.alloc(50 * 1024 * 1024 + 1, 0x61);
    await inWorld({ "a.md": "A\n", "big.bin": big }, async (w) => {
      // As in the over-cap collision case: the import left the big file out, `placed` and the tip hold it.
      const placed = w.commitOn(w.base, { "big.bin": big }), tip = w.commitOn(w.doc, { "big.bin": big });
      w.git(["update-ref", PLACED, placed, w.base]);
      w.git(["update-ref", "refs/heads/orca/g", tip, w.doc]);
      w.setRecord({ tip, landedTip: tip });
      w.land({ "a.md": "A2\n", "big.bin": "orca\n" });
      writeFileSync(join(w.folder, "a.md"), "mine\n");
      appendFileSync(join(w.folder, "big.bin"), "!");
      expect(await w.place()).toBe(true);
      expect(w.record()).toMatchObject({ state: "folder-changed", changed: ["a.md", "big.bin"] });
      expect(w.resolve("take-folder")).toEqual({ ok: true });
      expect(await w.place()).toBe(true);
      const record = w.record();
      expect(record).toMatchObject({ state: "idle", changed: [], pending: null, resolution: { action: "take-folder" } });
      const branch = w.ref("refs/heads/orca/g")!;
      expect(w.show(branch, "a.md")).toBe("mine");
      expect(w.show(branch, "big.bin")).toHaveLength(big.length + 1);
      // The person's version is the folder commit too, and the work-branch commit carries the answer's trailer.
      expect(w.show(w.ref(PLACED)!, "a.md")).toBe("mine");
      expect(w.git(["show", "-s", "--format=%B", branch])).toContain(`Orca-Resolution: ${record.resolution!.id}`);
      // The drift commit is kept (review I4) and holds the person's bytes.
      const drift = w.ref("refs/orca/group/g/drift/1")!;
      expect(w.show(drift, "a.md")).toBe("mine");
      // The next landing is a child of the folder edit and is placed on top of it, not over it.
      const later = w.land({ "n.md": "N\n" });
      expect(await w.place()).toBe(true);
      expect(w.record()).toMatchObject({ state: "idle", changed: [], tip: later });
      expect(read(w, "n.md")).toBe("N\n");
      expect(read(w, "a.md")).toBe("mine\n");
      expect(w.show(w.ref(PLACED)!, "a.md")).toBe("mine");
      expect(w.show(w.ref(PLACED)!, "n.md")).toBe("N");
    });
  }, 60_000);

  // Review 2026-10-27 (session 7753e97d): the stopped landing's paths the person did not touch are placed by the same
  // round. Before the fix the record claimed the folder held the whole landing (tip = the folder edit on the branch),
  // so b.md stayed at its old bytes, n.md never appeared, and the group read idle and done.
  it("take-folder places the rest of the stopped landing in the same round, and a landing that came while stopped too", () => inWorld({ "a.md": "A\n", "b.md": "B\n", "c.md": "C\n" }, async (w) => {
    w.land({ "a.md": "A2\n", "b.md": "B2\n", "n.md": "N\n" });
    writeFileSync(join(w.folder, "a.md"), "mine\n");
    expect(await w.place()).toBe(true);
    expect(w.record()).toMatchObject({ state: "folder-changed", changed: ["a.md"] });
    w.land({ "c.md": "C2\n" });
    expect(w.resolve("take-folder")).toEqual({ ok: true });
    // mutation: record tip = T′ and answer done (the old take-folder) -> b.md "B", n.md absent, c.md "C", red
    expect(await w.place()).toBe(true);
    expect([read(w, "a.md"), read(w, "b.md"), read(w, "n.md"), read(w, "c.md")]).toEqual(["mine\n", "B2\n", "N\n", "C2\n"]);
    const branch = w.ref("refs/heads/orca/g")!;
    expect(w.record()).toMatchObject({ state: "idle", changed: [], pending: null, tip: branch, landedTip: branch });
    expect(w.show(w.ref(PLACED)!, "b.md")).toBe("B2");
    expect(w.show(w.ref(PLACED)!, "a.md")).toBe("mine");
  }));

  it("take-folder does not take a symlink: it stays changed, the group asks again, and the answer is consumed", () => inWorld({ "a.md": "A\n", "b.md": "B\n" }, async (w) => {
    w.land({ "a.md": "A2\n", "b.md": "B2\n" });
    writeFileSync(join(w.folder, "a.md"), "mine\n");
    unlinkSync(join(w.folder, "b.md"));
    symlinkSync("a.md", join(w.folder, "b.md"));
    expect(await w.place()).toBe(true);
    expect(w.record()).toMatchObject({ state: "folder-changed", changed: ["a.md", "b.md"] });
    expect(w.resolve("take-folder")).toEqual({ ok: true });
    expect(await w.place()).toBe(true);
    expect(w.record()).toMatchObject({ state: "folder-changed", changed: ["b.md"], resolution: null });
    expect(w.record().detail).toContain("not taken: b.md");
    expect(w.show(w.ref("refs/heads/orca/g")!, "a.md")).toBe("mine");
    expect(lstatSync(join(w.folder, "b.md")).isSymbolicLink()).toBe(true);
  }));

  it("take-folder attributes a taken blob that a flow run's head holds to that run", () => inWorld({ "a.md": "A\n" }, async (w) => {
    w.land({ "a.md": "A2\n" });
    w.git(["update-ref", "refs/orca/run-1/head", w.commitOn(w.doc, { "a.md": "mine\n" })]);
    writeFileSync(join(w.folder, "a.md"), "mine\n");
    expect(await w.place()).toBe(true);
    expect(w.resolve("take-folder")).toEqual({ ok: true });
    expect(await w.place()).toBe(true);
    const body = w.git(["show", "-s", "--format=%B", w.ref("refs/heads/orca/g")!]);
    expect(body).toContain("orca: folder edit g");
    expect(body).toContain("Orca-Placed-By: run-1 1 paths");
    expect(body).toContain("Orca-Person-Edit: 0 paths");
  }));

  it("take-folder never takes an Orca-own path (the requirement document), even when a stop record names it", () => inWorld({ "a.md": "A\n" }, async (w) => {
    w.land({ "a.md": "A2\n" });
    writeFileSync(join(w.folder, "a.md"), "mine\n");
    mkdirSync(dirname(join(w.folder, DOC)), { recursive: true });
    writeFileSync(join(w.folder, DOC), "person's notes\n");
    expect(await w.place()).toBe(true);
    expect(w.record()).toMatchObject({ state: "folder-changed", changed: ["a.md"] });
    // A stop record that also names the document (as a corrupted or older record could).
    const stop = JSON.parse(w.git(["cat-file", "blob", w.record().stopRecord!]));
    const blob = w.git(["hash-object", "-w", "--stdin"], JSON.stringify({ ...stop, changed: [DOC, "a.md"] }));
    w.git(["update-ref", "refs/orca/group/g/stop", blob]);
    w.setRecord({ changed: [DOC, "a.md"], changedTotal: 2, stopRecord: blob });
    expect(w.resolve("take-folder")).toEqual({ ok: true });
    expect(await w.place()).toBe(true);
    expect(w.record()).toMatchObject({ state: "idle", changed: [] });
    expect(w.show(w.ref("refs/heads/orca/g")!, DOC)).toBe("# Notes export");
    expect(read(w, DOC)).toBe("person's notes\n");
  }));

  // Review 2026-10-27 (session 7753e97d): the pass reads the answer before it takes the folder lock and acts on it for a
  // while; the person may answer again meanwhile (the command is accepted while the group still reads stopped). The
  // first answer's save must not overwrite the second: a second answer silently gone is a decision of the person's lost.
  it.each([
    ["take-folder", "recheck"],
    ["withhold", "recheck"],
    ["recheck", "withhold"],
  ] as const)("a second answer given while the pass acts on a first (%s, then %s) is kept, not overwritten", (first, second) => inWorld({ "a.md": "A\n" }, async (w) => {
    w.land({ "a.md": "A2\n", "n.md": "N\n" });
    writeFileSync(join(w.folder, "a.md"), "mine\n");
    expect(await w.place()).toBe(true);
    expect(w.record()).toMatchObject({ state: "folder-changed", changed: ["a.md"] });
    expect(w.resolve(first, "first")).toEqual({ ok: true });
    let pass: Promise<boolean> | undefined;
    await withDirLock(w.frozen.dir, async () => {
      // The pass has read the record (with the first answer) and now waits for the lock; the person answers again.
      pass = w.place();
      expect(w.resolve(second, "second")).toEqual({ ok: true });
    });
    await pass;
    expect(w.record().resolution).toMatchObject({ id: "second", action: second });
  }));

  // Review 2026-10-27 (session 7753e97d): a recorded take-folder that meets a state other than folder-changed (the folder
  // went missing before the pass ran) is acted on as a recheck; the person is asked again, so the page says why.
  it("a take-folder the folder-missing state overtook is a recheck, and the stop asks again saying why", () => inWorld({ "a.md": "A\n" }, async (w) => {
    w.land({ "a.md": "A2\n" });
    writeFileSync(join(w.folder, "a.md"), "mine\n");
    expect(await w.place()).toBe(true);
    expect(w.resolve("take-folder")).toEqual({ ok: true });
    renameSync(w.folder, `${w.folder}-away`);
    expect(await w.place()).toBe(true);
    expect(w.record()).toMatchObject({ state: "folder-missing" });
    renameSync(`${w.folder}-away`, w.folder);
    expect(await w.place()).toBe(true);
    expect(w.record()).toMatchObject({ state: "folder-changed", changed: ["a.md"], resolution: null, detail: "take-folder not applied: the placement was folder-missing when the answer was read; checked again" });
    expect(read(w, "a.md")).toBe("mine\n");
  }));

  it("withhold with no stopped state, or take-folder outside folder-changed, is refused", () => inWorld({ "a.md": "A\n" }, async (w) => {
    expect(w.resolve("withhold")).toEqual({ ok: false, code: "folder-change-not-pending" });
    expect(w.resolve("take-folder")).toEqual({ ok: false, code: "folder-change-not-pending" });
    w.land({ "a.md": { content: "a.md", mode: "120000" } });
    expect(await w.place()).toBe(true);
    expect(w.record()).toMatchObject({ state: "folder-unwritable", unwritable: [{ path: "a.md", reason: "symlink" }] });
    expect(w.resolve("take-folder")).toEqual({ ok: false, code: "folder-change-not-pending" });
    expect(w.resolve("withhold")).toEqual({ ok: true });
  }));
});

/**
 * §8.3 "checked on every file system": the same case clash in a folder on a case-sensitive file system. On macOS a
 * case-sensitive APFS image is attached under the world's root (hdiutil, no privilege); elsewhere the temporary directory
 * is used when it is case-sensitive. When neither is available the case is skipped and says so (Rule 12).
 */
describe("case-clash on a case-sensitive file system", () => {
  it("is unwritable there too", async () => {
    const scratch = join(process.env.TMPDIR ?? "/tmp", `orca-cs-${process.pid}-${Date.now()}`);
    mkdirSync(scratch, { recursive: true });
    let mount: string | null = null;
    try {
      if (process.platform === "darwin") {
        const image = join(scratch, "cs");
        execFileSync("hdiutil", ["create", "-size", "16m", "-fs", "Case-sensitive APFS", "-volname", "orcacs", "-type", "SPARSE", image], { stdio: "ignore" });
        mount = join(scratch, "mnt");
        mkdirSync(mount);
        execFileSync("hdiutil", ["attach", "-nobrowse", "-mountpoint", mount, `${image}.sparseimage`], { stdio: "ignore" });
      } else mount = scratch;
      writeFileSync(join(mount, "Probe"), "");
      if (existsSync(join(mount, "probe"))) { console.warn("SKIPPED: no case-sensitive file system available for the case-clash case"); return; }
      await inWorld({ "readme.md": "r\n" }, async (w) => {
        w.land({ "README.md": "R\n" });
        expect(await w.place()).toBe(true);
        expect(w.record()).toMatchObject({ state: "folder-unwritable", unwritable: [{ path: "README.md", reason: "case-clash" }] });
        expect(existsSync(join(w.folder, "README.md"))).toBe(false);
      }, { folder: join(mount, "notes") });
    } finally {
      if (process.platform === "darwin" && mount !== null) execFileSync("hdiutil", ["detach", "-force", mount], { stdio: "ignore" });
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("modes (§8.4, review C2)", () => {
  it("new files 0644/0755 and new directories 0755 under umask 0077; a changed file keeps its bits with the executable state of `to`; others keep theirs", () => inWorld({ "kept.md": "K\n", "flip.sh": "echo\n", "flip2.sh": "echo 2\n", "other.md": "O\n" }, async (w) => {
    chmodSync(join(w.folder, "kept.md"), 0o640);
    chmodSync(join(w.folder, "flip2.sh"), 0o640);
    chmodSync(join(w.folder, "other.md"), 0o600);
    const flipBefore = folderState(w.folder)["flip.sh"]!.split(" ");
    w.land({
      "tool.sh": { content: "#!/bin/sh\n", mode: "100755" }, "plain.md": "P\n", "new/deep/f.md": "F\n", "kept.md": "K2\n",
      "flip.sh": { content: "echo\n", mode: "100755" }, "flip2.sh": { content: "echo 2\n", mode: "100755" },
    });
    const umask = process.umask(0o077);
    try { expect(await w.place()).toBe(true); } finally { process.umask(umask); }
    expect(w.record()).toMatchObject({ state: "idle" });
    expect(modeOf(w, "tool.sh")).toBe(0o755);
    expect(modeOf(w, "plain.md")).toBe(0o644);
    expect(modeOf(w, "new")).toBe(0o755);
    expect(modeOf(w, "new/deep")).toBe(0o755);
    expect(modeOf(w, "new/deep/f.md")).toBe(0o644);
    expect(modeOf(w, "kept.md")).toBe(0o640);
    expect(read(w, "kept.md")).toBe("K2\n");
    // A mode-only change adds x where r is set, and touches no byte (same inode, same mtime).
    expect(modeOf(w, "flip.sh")).toBe(0o755);
    expect(modeOf(w, "flip2.sh")).toBe(0o750);
    const flipAfter = folderState(w.folder)["flip.sh"]!.split(" ");
    expect([flipAfter[2], flipAfter[3], flipAfter[4]]).toEqual([flipBefore[2], flipBefore[3], flipBefore[4]]);
    expect(modeOf(w, "other.md")).toBe(0o600);
  }));
});

describe("the watch signature (§8.6) and the no-progress states (§8.5 step 2)", () => {
  it("a stopped group reports no progress until the stopping path changes; an undone edit is placed with no command", () => inWorld({ "a.md": "A\n" }, async (w) => {
    const tip = w.land({ "a.md": "A2\n" });
    writeFileSync(join(w.folder, "a.md"), "mine\n");
    expect(await w.place()).toBe(true);
    const stopped = w.record();
    expect(stopped).toMatchObject({ state: "folder-changed", changed: ["a.md"] });
    expect(await w.place()).toBe(false);
    expect(w.record()).toEqual(stopped);
    writeFileSync(join(w.folder, "a.md"), "A\n");
    expect(await w.place()).toBe(true);
    expect(w.record()).toMatchObject({ state: "idle", tip, changed: [], watch: null, stopRecord: null });
    expect(read(w, "a.md")).toBe("A2\n");
    expect(w.ref("refs/orca/group/g/stop")).toBeNull();
  }));

  it("a new landing re-runs a stopped group; a resolution re-runs it once", () => inWorld({ "a.md": "A\n", "b.md": "B\n" }, async (w) => {
    w.land({ "a.md": "A2\n" });
    writeFileSync(join(w.folder, "a.md"), "mine\n");
    expect(await w.place()).toBe(true);
    const stopped = w.record();
    const later = w.land({ "b.md": "B2\n" });
    // Re-run: classified again (a new stop record and signature), still stopped, nothing written.
    await w.place();
    expect(w.record()).toMatchObject({ state: "folder-changed", changed: ["a.md"], landedTip: later });
    expect(w.record().stopRecord).not.toBe(stopped.stopRecord);
    expect(w.record().watch).not.toBe(stopped.watch);
    expect(read(w, "b.md")).toBe("B\n");
    expect(await w.place()).toBe(false);
    w.setRecord({ resolution: { id: "recheck-1", action: "recheck", by: "human", at: Date.now() } });
    expect(await w.place()).toBe(true);
    expect(w.record()).toMatchObject({ state: "folder-changed", resolution: null });
    expect(await w.place()).toBe(false);
  }));

  it("a folder gone is folder-missing, progress once; back again, it places", () => inWorld({ "a.md": "A\n" }, async (w) => {
    const tip = w.land({ "a.md": "A2\n" });
    renameSync(w.folder, `${w.folder}-away`);
    expect(await w.place()).toBe(true);
    expect(w.record()).toMatchObject({ state: "folder-missing", detail: w.frozen.dir });
    expect(await w.place()).toBe(false);
    renameSync(`${w.folder}-away`, w.folder);
    expect(await w.place()).toBe(true);
    expect(w.record()).toMatchObject({ state: "idle", tip });
    expect(read(w, "a.md")).toBe("A2\n");
  }));

  it("git wins over a stale landedTip (a replayed landing)", () => inWorld({ "a.md": "A\n" }, async (w) => {
    const tip = w.land({ "a.md": "A2\n" });
    w.setRecord({ landedTip: w.doc });
    expect(await w.place()).toBe(true);
    expect(w.record()).toMatchObject({ state: "idle", tip, landedTip: tip });
  }));
});

describe("lossless writes (§8.4, review N1): a person writing between the steps loses nothing", () => {
  const files = { "a.md": "A\n" };
  it("new bytes at the path after classification, before the aside: put back, the path is changed", () => inWorld(files, async (w) => {
    w.land({ "a.md": "A2\n" });
    expect(await w.place((point, path) => { if (point === "before-aside" && path === "a.md") writeFileSync(join(w.folder, "a.md"), "mine\n"); })).toBe(true);
    expect(read(w, "a.md")).toBe("mine\n");
    expect(w.record()).toMatchObject({ state: "folder-changed", changed: ["a.md"] });
    expect(orcaNames(w.folder)).toEqual([]);
  }));
  it("the path re-created after the aside and its comparison: link refuses to clobber, the person's file stays", () => inWorld(files, async (w) => {
    w.land({ "a.md": "A2\n" });
    expect(await w.place((point, path) => { if (point === "before-link" && path === "a.md") writeFileSync(join(w.folder, "a.md"), "mine\n"); })).toBe(true);
    expect(read(w, "a.md")).toBe("mine\n");
    expect(w.record()).toMatchObject({ state: "folder-changed", changed: ["a.md"] });
    expect(orcaNames(w.folder)).toEqual([]);
  }));
  it("bytes written into the moved-aside entry while the path is re-created: the aside is kept, named, byte-equal", () => inWorld(files, async (w) => {
    w.land({ "a.md": "A2\n" });
    let aside = "";
    expect(await w.place((point, path) => {
      if (point !== "after-aside" || path !== "a.md") return;
      aside = readPlacement(w.body().placement)!.pending!.aside.at(-1)!.name;
      writeFileSync(join(w.folder, aside), "mine, through an open file\n");
      writeFileSync(join(w.folder, "a.md"), "mine, new\n");
    })).toBe(true);
    expect(aside).toMatch(/^\.orca-[0-9a-f]{8}$/);
    expect(read(w, aside)).toBe("mine, through an open file\n");
    expect(read(w, "a.md")).toBe("mine, new\n");
    expect(w.record()).toMatchObject({ state: "folder-changed", changed: ["a.md"], detail: expect.stringContaining(aside) });
    expect(orcaNames(w.folder)).toEqual([aside]);
    expect(statSync(join(w.folder, aside)).isFile()).toBe(true);
  }));
});
