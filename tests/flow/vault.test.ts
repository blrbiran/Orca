/**
 * Flow engine spec §5.2 and §5.4 (C3, plan Task 6): the per-directory vault, its import commits and copy-back into the
 * person's folder. The folder is the person's: copy-back applies only what a flow-head advance changed, merges three-way
 * where the person edited meanwhile, leaves the person's file byte-identical on a conflict, deletes only an untouched
 * file, never follows or writes through a symlink, and never `git clean`s, `checkout .`s or overwrites the whole tree.
 * Review Focus 4 (two runs, one vault) and 5 (symlinks and special files) are here too.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { copyBack } from "../../src/flow/vault/copyBack.js";
import { importSnapshot } from "../../src/flow/vault/snapshot.js";
import { openVault } from "../../src/flow/vault/vault.js";
import { gv, vaultWorld } from "./fixtures/vaultWorld.js";

const caps = { perFileBytes: 50 * 1024 * 1024, perSnapshotBytes: 500 * 1024 * 1024 };
const read = (path: string): string => readFileSync(path, "utf8");
/** Every entry under `dir` with group or other permission bits set. */
function widened(dir: string): string[] {
  const out: string[] = [];
  if ((lstatSync(dir).mode & 0o077) !== 0) out.push(dir);
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = lstatSync(path);
    if (stat.isDirectory()) out.push(...widened(path));
    else if (!stat.isSymbolicLink() && (stat.mode & 0o077) !== 0) out.push(path);
  }
  return out;
}
function digestTree(dir: string): string {
  const hash = createHash("sha256");
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const path = join(d, name);
      const stat = lstatSync(path);
      hash.update(`${path}\0${stat.mode}\0`);
      if (stat.isDirectory()) walk(path); else if (stat.isFile()) hash.update(readFileSync(path));
    }
  };
  walk(dir);
  return hash.digest("hex");
}

describe("the vault (§5.2, C3)", () => {
  it("V1: a new vault is a bare repository in ORCA_VAULT_DIR with nothing readable by group or others; HEAD is unborn", async () => {
    const w = await vaultWorld({ "a.md": "A\n" });
    expect(w.vault.path.startsWith(join(w.root, "vaults"))).toBe(true);
    expect(gv(w.vault, ["rev-parse", "--is-bare-repository"])).toBe("true");
    expect(gv(w.vault, ["config", "core.precomposeUnicode"])).toBe("true");
    await importSnapshot(w.vault, w.folder, { flowRunId: "run-1", caps });
    expect(widened(join(w.root, "vaults"))).toEqual([]);
    expect(statSync(join(w.root, "vaults")).mode & 0o777).toBe(0o700);
    expect(() => gv(w.vault, ["rev-parse", "--verify", "-q", "HEAD"])).toThrow();
  });

  it("V2: an existing vault root keeps the mode the person gave it", async () => {
    const w = await vaultWorld();
    chmodSync(join(w.root, "vaults"), 0o755);
    await openVault(w.env, w.folder);
    expect(statSync(join(w.root, "vaults")).mode & 0o777).toBe(0o755);
  });

  it("V3: the first import is a root commit at refs/orca/import/1 and the run's base; the next one's parent is the previous import, never HEAD", async () => {
    const w = await vaultWorld({ "a.md": "A\n", "sub/b.md": "B\n" });
    const first = await importSnapshot(w.vault, w.folder, { flowRunId: "run-1", caps });
    expect(first.n).toBe(1);
    expect(gv(w.vault, ["rev-parse", "refs/orca/import/1"])).toBe(first.commit);
    expect(gv(w.vault, ["rev-parse", "refs/orca/run-1/base"])).toBe(first.commit);
    expect(gv(w.vault, ["rev-list", "--parents", "-n", "1", first.commit])).toBe(first.commit);
    expect(gv(w.vault, ["log", "-1", "--format=%s", first.commit])).toBe("orca: import");
    expect(gv(w.vault, ["ls-tree", "-r", "--name-only", first.commit]).split("\n")).toEqual(["a.md", "sub/b.md"]);
    // A HEAD pointing anywhere must not become a parent.
    const stray = w.stepCommit(first.commit, { "stray.md": "x" });
    gv(w.vault, ["update-ref", "refs/heads/stray", stray]);
    gv(w.vault, ["symbolic-ref", "HEAD", "refs/heads/stray"]);
    writeFileSync(join(w.folder, "a.md"), "A2\n");
    const second = await importSnapshot(w.vault, w.folder, { flowRunId: "run-2", caps });
    expect(second.n).toBe(2);
    expect(gv(w.vault, ["rev-parse", `${second.commit}^`])).toBe(first.commit);
    expect(w.show(second.commit, "stray.md")).toBeNull();
  });

  it("V4: excludes: .git/, node_modules/, .DS_Store and the template's own; a person's .git is never touched", async () => {
    const w = await vaultWorld({ "a.md": "A\n", "node_modules/x/i.js": "x", ".DS_Store": "d", ".md2publish/cache/c.bin": "c", "keep/.DS_Store": "d" }, { excludes: [".md2publish/cache/"] });
    execFileSync("git", ["-c", "init.defaultBranch=main", "init", "-q"], { cwd: w.folder });
    execFileSync("git", ["-c", "user.name=p", "-c", "user.email=p@p", "add", "a.md"], { cwd: w.folder });
    execFileSync("git", ["-c", "user.name=p", "-c", "user.email=p@p", "commit", "-qm", "mine"], { cwd: w.folder });
    const before = digestTree(join(w.folder, ".git"));
    const { commit } = await importSnapshot(w.vault, w.folder, { flowRunId: "run-1", caps });
    expect(gv(w.vault, ["ls-tree", "-r", "--name-only", commit]).split("\n")).toEqual(["a.md"]);
    expect(digestTree(join(w.folder, ".git"))).toBe(before);
  });

  it("V5: files over the per-file or per-snapshot cap are excluded and listed, never dropped silently", async () => {
    const w = await vaultWorld({ "a.md": "12345", "b.md": "1234567890123", "c.md": "123", "d.md": "1234" });
    const result = await importSnapshot(w.vault, w.folder, { flowRunId: "run-1", caps: { perFileBytes: 10, perSnapshotBytes: 9 } });
    expect(result.overCap).toEqual(["b.md", "d.md"]);
    expect(gv(w.vault, ["ls-tree", "-r", "--name-only", result.commit]).split("\n")).toEqual(["a.md", "c.md"]);
  });

  it("V6 (Review Focus 5): a symlink is stored as a link and its target is never read; a fifo is excluded and listed", async () => {
    const w = await vaultWorld({ "a.md": "A\n" });
    const outside = join(w.root, "outside.txt");
    writeFileSync(outside, "secret\n");
    chmodSync(outside, 0o000);
    symlinkSync(outside, join(w.folder, "link"));
    execFileSync("mkfifo", [join(w.folder, "pipe")]);
    const result = await importSnapshot(w.vault, w.folder, { flowRunId: "run-1", caps });
    expect(gv(w.vault, ["ls-tree", result.commit, "link"])).toMatch(/^120000 blob [0-9a-f]+\tlink$/);
    expect(w.show(result.commit, "link")).toBe(outside);
    expect(result.excluded).toEqual(["pipe"]);
    chmodSync(outside, 0o600);
    expect(read(outside)).toBe("secret\n");
  });

  it("V7 (Review Focus 4): two concurrent imports get distinct numbers", async () => {
    const w = await vaultWorld({ "a.md": "A\n" });
    const [a, b] = await Promise.all([importSnapshot(w.vault, w.folder, { flowRunId: "run-a", caps }), importSnapshot(w.vault, w.folder, { flowRunId: "run-b", caps })]);
    expect([a.n, b.n].sort()).toEqual([1, 2]);
    const second = a.n === 2 ? a : b;
    const firstCommit = a.n === 1 ? a.commit : b.commit;
    expect(gv(w.vault, ["rev-parse", `${second.commit}^`])).toBe(firstCommit);
  });
});

describe("copy-back (§5.4, C3)", () => {
  async function landed(files: Record<string, string>, changes: Record<string, string | null>) {
    const w = await vaultWorld(files);
    const { commit: base } = await importSnapshot(w.vault, w.folder, { flowRunId: "run-1", caps });
    return { ...w, base, next: w.stepCommit(base, changes) };
  }

  it("C1: applies adds, modifies and deletes; a new file is 0600 in a new 0700 directory; untouched files keep inode and mtime", async () => {
    const w = await landed({ "keep.md": "K\n", "mod.md": "M\n", "gone.md": "G\n" }, { "mod.md": "M2\n", "gone.md": null, "new/dir/n.md": "N\n" });
    const before = statSync(join(w.folder, "keep.md"));
    const result = await copyBack(w.vault, w.folder, w.base, w.next);
    expect(result).toEqual({ written: ["gone.md", "mod.md", "new/dir/n.md"], conflicts: [] });
    expect(read(join(w.folder, "mod.md"))).toBe("M2\n");
    expect(existsSync(join(w.folder, "gone.md"))).toBe(false);
    expect(read(join(w.folder, "new/dir/n.md"))).toBe("N\n");
    expect(statSync(join(w.folder, "new/dir/n.md")).mode & 0o777).toBe(0o600);
    expect(statSync(join(w.folder, "new")).mode & 0o777).toBe(0o700);
    expect(statSync(join(w.folder, "new/dir")).mode & 0o777).toBe(0o700);
    const after = statSync(join(w.folder, "keep.md"));
    expect([after.ino, after.mtimeMs]).toEqual([before.ino, before.mtimeMs]);
  });

  it("C2: a pre-existing file's mode is unchanged when its content is updated", async () => {
    const w = await landed({ "mod.md": "M\n" }, { "mod.md": "M2\n" });
    chmodSync(join(w.folder, "mod.md"), 0o644);
    await copyBack(w.vault, w.folder, w.base, w.next);
    expect(statSync(join(w.folder, "mod.md")).mode & 0o777).toBe(0o644);
  });

  it("C3: the person's concurrent edit to another part of a changed file merges three-way", async () => {
    const w = await landed({ "a.md": "one\ntwo\nthree\nfour\nfive\n" }, { "a.md": "ONE\ntwo\nthree\nfour\nfive\n" });
    writeFileSync(join(w.folder, "a.md"), "one\ntwo\nthree\nfour\nFIVE\n");
    expect(await copyBack(w.vault, w.folder, w.base, w.next)).toEqual({ written: ["a.md"], conflicts: [] });
    expect(read(join(w.folder, "a.md"))).toBe("ONE\ntwo\nthree\nfour\nFIVE\n");
  });

  it("C4: a conflicting edit leaves the person's file byte-identical and is reported", async () => {
    const w = await landed({ "a.md": "one\n" }, { "a.md": "step\n" });
    writeFileSync(join(w.folder, "a.md"), "person\n");
    const before = statSync(join(w.folder, "a.md"));
    expect(await copyBack(w.vault, w.folder, w.base, w.next)).toEqual({ written: [], conflicts: ["a.md"] });
    expect(read(join(w.folder, "a.md"))).toBe("person\n");
    expect(statSync(join(w.folder, "a.md")).mtimeMs).toBe(before.mtimeMs);
  });

  it("C5: a delete is applied only when the file still equals the previous head's blob", async () => {
    const w = await landed({ "a.md": "A\n" }, { "a.md": null });
    writeFileSync(join(w.folder, "a.md"), "edited\n");
    expect(await copyBack(w.vault, w.folder, w.base, w.next)).toEqual({ written: [], conflicts: ["a.md"] });
    expect(read(join(w.folder, "a.md"))).toBe("edited\n");
  });

  it("C6: a file the person created where the step added one is not overwritten", async () => {
    const w = await landed({}, { "n.md": "step\n" });
    writeFileSync(join(w.folder, "n.md"), "person\n");
    expect(await copyBack(w.vault, w.folder, w.base, w.next)).toEqual({ written: [], conflicts: ["n.md"] });
    expect(read(join(w.folder, "n.md"))).toBe("person\n");
  });

  it("C7: a decomposed (NFD) file name round-trips: the step's change lands in the same file, under the same name", async () => {
    const nfd = "café.md";
    const w = await vaultWorld({ [nfd]: "v1\n" });
    const { commit: base } = await importSnapshot(w.vault, w.folder, { flowRunId: "run-1", caps });
    const inVault = gv(w.vault, ["ls-tree", "-r", "-z", "--name-only", base]).replace(/\0$/, "");
    expect(inVault).toBe("café.md");
    const next = w.stepCommit(base, { [inVault]: "v2\n" });
    expect(await copyBack(w.vault, w.folder, base, next)).toEqual({ written: [inVault], conflicts: [] });
    expect(readdirSync(w.folder)).toHaveLength(1);
    expect(read(join(w.folder, readdirSync(w.folder)[0]!))).toBe("v2\n");
  });

  it("C8 (Review Focus 5): copy-back never writes through a symlink and never creates one pointing outside the folder", async () => {
    const w = await vaultWorld({ "a.md": "A\n" });
    const outside = join(w.root, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(w.folder, "out"));
    const { commit: base } = await importSnapshot(w.vault, w.folder, { flowRunId: "run-1", caps });
    const next = w.stepCommit(base, { "out/x.md": "through\n" });
    const linkBlob = gv(w.vault, ["hash-object", "-w", "--stdin"], "../../escape");
    const index = join(w.root, "idx");
    const env = { ...process.env, GIT_INDEX_FILE: index };
    execFileSync("git", ["--git-dir", w.vault.path, "read-tree", next], { env });
    execFileSync("git", ["--git-dir", w.vault.path, "update-index", "--add", "--cacheinfo", `120000,${linkBlob},esc`], { env });
    const tree = execFileSync("git", ["--git-dir", w.vault.path, "write-tree"], { env, encoding: "utf8" }).trim();
    const withLink = gv(w.vault, ["commit-tree", tree, "-p", base, "-m", "step"]);
    const result = await copyBack(w.vault, w.folder, base, withLink);
    expect(result.written).toEqual([]);
    // The step's tree replaced the link `out` by a directory: neither the link's removal nor the file under it is applied.
    expect(result.conflicts.sort()).toEqual(["esc", "out", "out/x.md"]);
    expect(readdirSync(outside)).toEqual([]);
    expect(existsSync(join(w.folder, "esc"))).toBe(false);
  });

  it("C9 (Review Focus 4): run B's copy-back keeps run A's write to the same file", async () => {
    const w = await vaultWorld({ "a.md": "one\ntwo\nthree\nfour\nfive\n" });
    const [a, b] = await Promise.all([importSnapshot(w.vault, w.folder, { flowRunId: "run-a", caps }), importSnapshot(w.vault, w.folder, { flowRunId: "run-b", caps })]);
    const headA = w.stepCommit(a.commit, { "a.md": "ONE\ntwo\nthree\nfour\nfive\n" });
    const headB = w.stepCommit(b.commit, { "a.md": "one\ntwo\nthree\nfour\nFIVE\n" });
    await copyBack(w.vault, w.folder, a.commit, headA);
    expect(await copyBack(w.vault, w.folder, b.commit, headB)).toEqual({ written: ["a.md"], conflicts: [] });
    expect(read(join(w.folder, "a.md"))).toBe("ONE\ntwo\nthree\nfour\nFIVE\n");
  });

  it("C10: a symlinked file in the folder is not replaced when the step changed that path", async () => {
    const w = await vaultWorld({ "real.md": "R\n" });
    symlinkSync("real.md", join(w.folder, "alias.md"));
    const { commit: base } = await importSnapshot(w.vault, w.folder, { flowRunId: "run-1", caps });
    const next = w.stepCommit(base, { "alias.md": "replaced\n" });
    expect(await copyBack(w.vault, w.folder, base, next)).toEqual({ written: [], conflicts: ["alias.md"] });
    expect(readlinkSync(join(w.folder, "alias.md"))).toBe("real.md");
    expect(read(join(w.folder, "real.md"))).toBe("R\n");
  });
});
