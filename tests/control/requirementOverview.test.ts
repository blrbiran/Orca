import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, statSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildRepositoryOverview, overviewPathExists, resolveAstGrepBin } from "../../src/control/requirementOverview.js";

// N1 spec §6 and §12.2: the overview is built from HEAD's committed tree only, with stated cuts, an optional structure
// part whose five statuses are each reachable, the target's sgconfig.yml never read, and zero writes to the target.
const roots: string[] = [];
afterAll(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }); });
const g = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8" }).trim();
const FAKE = resolve("tests/control/fixtures/fake-ast-grep.mjs");
/** Task 0a measured this form: without `-c`, ast-grep discovers it and exits 79. */
const HOSTILE_SGCONFIG = "customLanguages:\n  foo:\n    libraryPath: nowhere.so\n    extensions: [foo]\n";

async function world(files: Record<string, string | Buffer>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-overview-")));
  roots.push(root);
  const repo = join(root, "repo");
  await mkdir(repo);
  g(repo, "init", "-q", "-b", "main");
  for (const [path, content] of Object.entries(files)) { await mkdir(join(repo, path, ".."), { recursive: true }); await writeFile(join(repo, path), content); }
  g(repo, "add", "-A"); g(repo, "commit", "-qm", "base");
  return { root, repo, stateDir: join(root, "control", "repo") };
}
interface FakeCall { args: string[]; cwd: string; config: string | null; work: Array<{ path: string; dir: boolean; mode: number }> }
async function fakeBin(root: string, mode: "ok" | "fail" | "hang") {
  const log = join(root, `ast-grep-${mode}.log`), bin = join(root, `ast-grep-${mode}`);
  await writeFile(bin, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" ${mode} "${log}" "$@"\n`);
  await chmod(bin, 0o700);
  return { bin, calls: async (): Promise<FakeCall[]> => existsSync(log) ? (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as FakeCall) : [] };
}
/** Every path under `dir`, with mtime, size and mode -- directories included (spec §12.2 "directory mtimes included"). */
function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (path: string) => { const s = statSync(path); out.push(`${path} ${s.mtimeMs} ${s.size} ${s.mode}`); if (s.isDirectory()) for (const name of readdirSync(path).sort()) walk(join(path, name)); };
  walk(dir);
  return out;
}
/** Every path under `dir` with its permission bits, `dir` itself included. */
function modes(dir: string): Array<{ path: string; dir: boolean; mode: number }> {
  const out: Array<{ path: string; dir: boolean; mode: number }> = [];
  const walk = (path: string) => { const s = lstatSync(path); out.push({ path, dir: s.isDirectory(), mode: s.mode & 0o777 }); if (s.isDirectory()) for (const name of readdirSync(path).sort()) walk(join(path, name)); };
  walk(dir);
  return out;
}

describe("the repository overview (N1 spec §6)", () => {
  it("lists HEAD's committed files only, never the working tree or the index, and reads root documents from the commit", async () => {
    const w = await world({ "README.md": "# Notes\n", "CLAUDE.md": "rules\n", "src/a.ts": "export const a = 1\n" });
    await writeFile(join(w.repo, "README.md"), "# Edited but not committed\n");
    await writeFile(join(w.repo, "untracked.txt"), "x\n");
    await writeFile(join(w.repo, "src/b.ts"), "export const b = 2\n"); g(w.repo, "add", "src/b.ts");
    const { overview } = await buildRepositoryOverview({ repo: w.repo, repoId: "repo", stateDir: w.stateDir, runId: "run-1", astGrepBin: null });
    expect(overview.commit).toBe(g(w.repo, "rev-parse", "HEAD"));
    expect(overview.files).toEqual({ status: "ok", total: 3, listed: ["CLAUDE.md", "README.md", "src/a.ts"], cut: false, directories: null });
    expect(overview.docs.entries).toEqual([{ path: "CLAUDE.md", text: "rules\n", cut: false }, { path: "README.md", text: "# Notes\n", cut: false }]);
  });

  it("cuts the file list at its cap, says so, and attaches a top-level directory table", async () => {
    const w = await world({ "a/1.ts": "1", "a/2.ts": "2", "b/3.ts": "3", "b/4.ts": "4", "top.md": "t" });
    const { overview } = await buildRepositoryOverview({ repo: w.repo, repoId: "repo", stateDir: w.stateDir, runId: "run-1", astGrepBin: null, limits: { maxPaths: 3 } });
    expect(overview.files).toEqual({ status: "ok", total: 5, listed: ["a/1.ts", "a/2.ts", "b/3.ts"], cut: true, directories: [{ directory: ".", files: 1 }, { directory: "a", files: 2 }, { directory: "b", files: 2 }] });
  });

  it("caps each document and all of them, and names binary and non-UTF-8 documents it skipped", async () => {
    const w = await world({ "README.md": "r".repeat(40), "CONTRIBUTING.md": "c".repeat(40), "AGENTS.md": Buffer.from([0xff, 0xfe, 0x41]), "README.bin": Buffer.from([0x41, 0x00, 0x42]) });
    const { overview } = await buildRepositoryOverview({ repo: w.repo, repoId: "repo", stateDir: w.stateDir, runId: "run-1", astGrepBin: null, limits: { maxDocBytes: 30, maxDocsBytes: 50 } });
    expect(overview.docs.entries).toEqual([{ path: "CONTRIBUTING.md", text: "c".repeat(30), cut: true }]);
    expect(overview.docs.skipped).toEqual([{ path: "AGENTS.md", reason: "non-utf8" }, { path: "README.bin", reason: "binary" }, { path: "README.md", reason: "over-budget" }]);
  });

  it.each([
    ["unavailable", null, {}],
    ["skipped-too-large", "ok", { maxExportBytes: 1 }],
    ["timeout", "hang", { structureTimeoutMs: 500 }],
    ["failed", "fail", {}],
    ["ok", "ok", {}],
  ] as const)("reaches structure status %s and still gives an overview", async (status, mode, limits) => {
    const w = await world({ "src/a.ts": "export const a = 1\n", "docs/x.md": "x" });
    const bin = mode === null ? null : (await fakeBin(w.root, mode)).bin;
    const { overview } = await buildRepositoryOverview({ repo: w.repo, repoId: "repo", stateDir: w.stateDir, runId: "run-1", astGrepBin: bin, limits });
    expect(overview.structure.status).toBe(status);
    expect(overview.files.listed).toEqual(["docs/x.md", "src/a.ts"]);
    if (status === "ok") expect(overview.structure.files).toEqual([{ path: "src/a.ts", symbols: [{ name: "exported_a_ts", kind: "function" }] }]);
    // spec §13: the private export directory is gone after the build, whatever its status.
    expect(readdirSync(`${w.stateDir}.overview`).filter((name) => name.startsWith("tmp-"))).toEqual([]);
  });

  it("passes Orca's own config with -c, from outside the exported tree and its ancestry, and never exports the target's sgconfig.yml", async () => {
    const w = await world({ "src/a.ts": "export const a = 1\n", "sgconfig.yml": HOSTILE_SGCONFIG });
    const fake = await fakeBin(w.root, "ok");
    await buildRepositoryOverview({ repo: w.repo, repoId: "repo", stateDir: w.stateDir, runId: "run-1", astGrepBin: fake.bin });
    const [call] = await fake.calls();
    expect(call!.args).toEqual(["-c", call!.args[1], "outline", "--json=stream", "--items", "exports", "-j", "1", "."]);
    expect(call!.config).toBe("ruleDirs: []\n");
    // PR-I3: ast-grep discovers sgconfig.yml in its working directory and every ancestor; Orca's own sits in neither.
    const configDir = dirname(call!.args[1]!);
    expect(`${call!.cwd}/`.startsWith(`${configDir}/`)).toBe(false);
    expect(call!.work.map((entry) => entry.path).filter((path) => path.endsWith("sgconfig.yml"))).toEqual(["config/sgconfig.yml"]);
  });

  it.runIf(resolveAstGrepBin(process.env) !== null)("with the real ast-grep, a hostile sgconfig.yml at the export root changes nothing", async () => {
    const w = await world({ "src/a.ts": "export function alpha(): number { return 1 }\nfunction hidden() {}\n", "sgconfig.yml": HOSTILE_SGCONFIG });
    // PR-I3: a wrapper plants the hostile config in ast-grep's working directory (the export root), then runs the real binary.
    const hostile = join(w.root, "hostile-sgconfig.yml"), planted = join(w.root, "planted.log"), wrapper = join(w.root, "ast-grep-hostile");
    await writeFile(hostile, HOSTILE_SGCONFIG);
    await writeFile(wrapper, `#!/bin/sh\ncat "${hostile}" > sgconfig.yml\npwd >> "${planted}"\nexec "${resolveAstGrepBin(process.env)!}" "$@"\n`);
    await chmod(wrapper, 0o700);
    const { overview } = await buildRepositoryOverview({ repo: w.repo, repoId: "repo", stateDir: w.stateDir, runId: "run-1", astGrepBin: wrapper });
    expect(await readFile(planted, "utf8")).toBe(`${join(`${w.stateDir}.overview`, "tmp-run-1", "tree")}\n`);
    expect(overview.structure).toEqual({ status: "ok", detail: null, files: [{ path: "src/a.ts", symbols: [{ name: "alpha", kind: "function" }] }], cut: false });
  });

  it("creates every file outside the repository 0600 and every directory 0700: exported files, config and cache (PR-I6)", async () => {
    const w = await world({ "src/deep/a.ts": "export const a = 1\n", "b.ts": "export const b = 2\n" });
    const fake = await fakeBin(w.root, "ok");
    const { overview } = await buildRepositoryOverview({ repo: w.repo, repoId: "repo", stateDir: w.stateDir, runId: "run-1", astGrepBin: fake.bin });
    const [call] = await fake.calls();
    expect(call!.work.map((entry) => entry.path)).toEqual(["config", "config/sgconfig.yml", "tree", "tree/b.ts", "tree/src", "tree/src/deep", "tree/src/deep/a.ts"]);
    for (const entry of call!.work) expect({ path: entry.path, mode: entry.mode }).toEqual({ path: entry.path, mode: entry.dir ? 0o700 : 0o600 });
    const cache = modes(`${w.stateDir}.overview`);
    expect(cache.map((entry) => entry.path)).toEqual([`${w.stateDir}.overview`, join(`${w.stateDir}.overview`, "repo"), join(`${w.stateDir}.overview`, "repo", overview.commit), join(`${w.stateDir}.overview`, "repo", overview.commit, "overview.json")]);
    for (const entry of cache) expect({ path: entry.path, mode: entry.mode }).toEqual({ path: entry.path, mode: entry.dir ? 0o700 : 0o600 });
  });

  it("cuts a document inside a multi-byte character at the last whole character, holding only its capped prefix", async () => {
    const w = await world({ "README.md": `abcde\u00e9${"x".repeat(100)}` });
    const { overview } = await buildRepositoryOverview({ repo: w.repo, repoId: "repo", stateDir: w.stateDir, runId: "run-1", astGrepBin: null, limits: { maxDocBytes: 3 } });
    expect(overview.docs).toEqual({ status: "ok", entries: [{ path: "README.md", text: "abc", cut: true }], skipped: [] });
  });

  it("runs none of the target's filters: a committed smudge driver never fires (review fix 1)", async () => {
    const w = await world({ ".gitattributes": "* filter=marker\n", "README.md": "r\n", "src/a.ts": "export const a = 1\n" });
    const marker = join(w.root, "smudge-ran");
    g(w.repo, "config", "filter.marker.smudge", `touch '${marker}'; cat`);
    const fake = await fakeBin(w.root, "ok");
    const before = snapshot(w.repo);
    const { overview } = await buildRepositoryOverview({ repo: w.repo, repoId: "repo", stateDir: w.stateDir, runId: "run-1", astGrepBin: fake.bin });
    expect(existsSync(marker)).toBe(false);
    expect(snapshot(w.repo)).toEqual(before);
    expect(overview.structure.status).toBe("ok");
    expect(overview.structure.files).toEqual([{ path: "src/a.ts", symbols: [{ name: "exported_a_ts", kind: "function" }] }]);
  });

  it("counts the export against the structure time cap: an export that outlives it is a timeout", async () => {
    const w = await world({ "src/a.ts": "export const a = 1\n" });
    const fake = await fakeBin(w.root, "ok");
    const { overview } = await buildRepositoryOverview({ repo: w.repo, repoId: "repo", stateDir: w.stateDir, runId: "run-1", astGrepBin: fake.bin, limits: { structureTimeoutMs: 1 } });
    expect(overview.structure.status).toBe("timeout");
    expect(await fake.calls()).toEqual([]);
  });

  it("reuses only an ok structure from the cache; any other status is built again on the next call", async () => {
    const w = await world({ "README.md": "r\n", "src/a.ts": "export const a = 1\n" });
    const fake = await fakeBin(w.root, "ok");
    const first = await buildRepositoryOverview({ repo: w.repo, repoId: "repo", stateDir: w.stateDir, runId: "run-1", astGrepBin: null });
    expect(first.overview.structure.status).toBe("unavailable");
    const second = await buildRepositoryOverview({ repo: w.repo, repoId: "repo", stateDir: w.stateDir, runId: "run-2", astGrepBin: fake.bin });
    expect(second.overview.structure.status).toBe("ok");
    expect({ files: second.overview.files, docs: second.overview.docs }).toEqual({ files: first.overview.files, docs: first.overview.docs });
    expect(await fake.calls()).toHaveLength(1);
    const third = await buildRepositoryOverview({ repo: w.repo, repoId: "repo", stateDir: w.stateDir, runId: "run-3", astGrepBin: fake.bin });
    expect(third.hash).toBe(second.hash);
    expect(await fake.calls()).toHaveLength(1);
  });

  it("writes nothing into the target repository: working tree, index and .git, mtimes included", async () => {
    const w = await world({ "README.md": "r", "src/a.ts": "export const a = 1\n" });
    await writeFile(join(w.repo, "dirty.txt"), "d");
    const fake = await fakeBin(w.root, "ok");
    const before = snapshot(w.repo);
    await buildRepositoryOverview({ repo: w.repo, repoId: "repo", stateDir: w.stateDir, runId: "run-1", astGrepBin: fake.bin });
    expect(snapshot(w.repo)).toEqual(before);
  });

  it("caches per commit, removes a crashed build's export directory, and builds again when HEAD moves", async () => {
    const w = await world({ "src/a.ts": "export const a = 1\n" });
    const fake = await fakeBin(w.root, "ok");
    await mkdir(join(`${w.stateDir}.overview`, "tmp-crashed"), { recursive: true });
    const first = await buildRepositoryOverview({ repo: w.repo, repoId: "repo", stateDir: w.stateDir, runId: "run-1", astGrepBin: fake.bin });
    const second = await buildRepositoryOverview({ repo: w.repo, repoId: "repo", stateDir: w.stateDir, runId: "run-2", astGrepBin: fake.bin });
    expect(second.hash).toBe(first.hash);
    expect(second.canonicalJson).toBe(first.canonicalJson);
    expect(await fake.calls()).toHaveLength(1);
    expect(existsSync(join(`${w.stateDir}.overview`, "tmp-crashed"))).toBe(false);
    expect((statSync(join(`${w.stateDir}.overview`, "repo", first.overview.commit, "overview.json")).mode & 0o777)).toBe(0o600);
    await writeFile(join(w.repo, "src/b.ts"), "export const b = 2\n"); g(w.repo, "add", "-A"); g(w.repo, "commit", "-qm", "two");
    const third = await buildRepositoryOverview({ repo: w.repo, repoId: "repo", stateDir: w.stateDir, runId: "run-3", astGrepBin: fake.bin });
    expect(third.overview.commit).not.toBe(first.overview.commit);
    expect(await fake.calls()).toHaveLength(2);
  });

  it("rebuilds over a torn cache entry instead of failing (spec §13: reused or overwritten by the same commit)", async () => {
    const w = await world({ "src/a.ts": "export const a = 1\n" });
    const fake = await fakeBin(w.root, "ok");
    const first = await buildRepositoryOverview({ repo: w.repo, repoId: "repo", stateDir: w.stateDir, runId: "run-1", astGrepBin: fake.bin });
    const cacheFile = join(`${w.stateDir}.overview`, "repo", first.overview.commit, "overview.json");
    await writeFile(cacheFile, first.canonicalJson.slice(0, 20));
    const second = await buildRepositoryOverview({ repo: w.repo, repoId: "repo", stateDir: w.stateDir, runId: "run-2", astGrepBin: fake.bin });
    expect(second.hash).toBe(first.hash);
    expect(await fake.calls()).toHaveLength(2);
    expect(await readFile(cacheFile, "utf8")).toBe(first.canonicalJson);
  });

  it("answers DR19 target-path existence against the commit, not the working tree", async () => {
    const w = await world({ "src/a.ts": "1", "top.md": "t" });
    await mkdir(join(w.repo, "uncommitted")); await writeFile(join(w.repo, "uncommitted/x.ts"), "x");
    const commit = g(w.repo, "rev-parse", "HEAD");
    const exists = (entry: string) => overviewPathExists(w.repo, commit, entry);
    expect(await exists("**")).toBe(true);
    expect(await exists("src/**")).toBe(true);
    expect(await exists("uncommitted/**")).toBe(false);
    expect(await exists("src/a.ts")).toBe(true);
    expect(await exists("src/new.ts")).toBe(true);
    expect(await exists("new.ts")).toBe(true);
    expect(await exists("uncommitted/x.ts")).toBe(false);
    expect(await exists("missing/new.ts")).toBe(false);
  });
});

// Final review fix wave (session b5e8d368, 2026-10-02), finding 2: a tree path is data. git stores entries named `..`
// (mktree takes them, and a clone brings them in with fetch.fsckObjects off, git's default), so ls-tree -r can print a
// path that leads out of the export directory.
describe("a hostile tree in the structure export (final review finding 2)", () => {
  /** A repository whose HEAD tree wraps `name` in `levels` directories each named `dir`, built with plumbing. */
  async function craftedWorld(dir: string, levels: number, name: string) {
    const root = await realpath(await mkdtemp(join(tmpdir(), "orca-overview-")));
    roots.push(root);
    const repo = join(root, "repo");
    await mkdir(repo);
    g(repo, "init", "-q", "-b", "main");
    const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: repo, input: "export const escaped = 1;\n", encoding: "utf8" }).trim();
    let tree = execFileSync("git", ["mktree"], { cwd: repo, input: `100644 blob ${blob}\t${name}\n`, encoding: "utf8" }).trim();
    for (let i = 0; i < levels; i += 1) tree = execFileSync("git", ["mktree"], { cwd: repo, input: `040000 tree ${tree}\t${dir}\n`, encoding: "utf8" }).trim();
    const commit = g(repo, "commit-tree", tree, "-m", "crafted");
    g(repo, "update-ref", "refs/heads/main", commit);
    return { root, repo, stateDir: join(root, "control", "repo") };
  }
  /** Every file named `name` anywhere under `dir`. */
  const found = (dir: string, name: string): string[] => {
    const out: string[] = [];
    const walk = (path: string) => { for (const entry of readdirSync(path, { withFileTypes: true })) { const at = join(path, entry.name); if (entry.isDirectory()) walk(at); else if (entry.name === name) out.push(at); } };
    walk(dir);
    return out;
  };

  it("writes nothing outside the export for `..` entries: the structure fails by name and ast-grep never runs", async () => {
    const w = await craftedWorld("..", 4, "ESCAPED.js");
    const fake = await fakeBin(w.root, "ok");
    const { overview } = await buildRepositoryOverview({ repo: w.repo, repoId: "repo", stateDir: w.stateDir, runId: "run-1", astGrepBin: fake.bin });
    expect(overview.files.listed).toEqual(["../../../../ESCAPED.js"]);
    expect(overview.structure).toEqual({ status: "failed", detail: 'unsafe-path:"../../../../ESCAPED.js"', files: [], cut: false });
    // Four levels up from <stateDir>.overview/tmp-run-1/tree is the temporary root itself; nothing anywhere under it.
    expect(found(w.root, "ESCAPED.js")).toEqual([]);
    expect(await fake.calls()).toEqual([]);
  });

  it("refuses a `.` entry too, though it would land inside the export", async () => {
    const w = await craftedWorld(".", 1, "inner.js");
    const fake = await fakeBin(w.root, "ok");
    const { overview } = await buildRepositoryOverview({ repo: w.repo, repoId: "repo", stateDir: w.stateDir, runId: "run-1", astGrepBin: fake.bin });
    expect(overview.structure).toEqual({ status: "failed", detail: 'unsafe-path:"./inner.js"', files: [], cut: false });
    expect(await fake.calls()).toEqual([]);
  });
});

// Final review fix wave, triage (deferred T11): a GIT_* variable in Orca's own environment -- as a git hook running the
// panel would set -- must not redirect what the overview reads.
describe("the overview's git children and Orca's environment (final review triage)", () => {
  it("reads the target repository even when Orca's environment carries GIT_DIR and GIT_INDEX_FILE for another", async () => {
    const w = await world({ "README.md": "# Target\n", "src/a.ts": "export const a = 1\n" });
    const decoy = await world({ "DECOY.md": "# Decoy\n" });
    const saved = { GIT_DIR: process.env.GIT_DIR, GIT_INDEX_FILE: process.env.GIT_INDEX_FILE };
    process.env.GIT_DIR = join(decoy.repo, ".git"); process.env.GIT_INDEX_FILE = join(decoy.repo, ".git", "index");
    let built;
    try { built = await buildRepositoryOverview({ repo: w.repo, repoId: "repo", stateDir: w.stateDir, runId: "run-1", astGrepBin: null }); }
    finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
    expect(built.overview.commit).toBe(g(w.repo, "rev-parse", "HEAD"));
    expect(built.overview.files.listed).toEqual(["README.md", "src/a.ts"]);
    expect(built.overview.docs.entries).toEqual([{ path: "README.md", text: "# Target\n", cut: false }]);
  });
});
