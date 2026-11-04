import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { buildManifests } from "../../src/control/requirementManifests.js";

// Task setup spec §4.1: the split is sent, from the overview's commit, the root's and every workspace's package.json
// (name, scripts, workspaces), which lockfile is there and which other build manifests are there, so it can name setup and
// check commands that exist. Read from the commit, never the disk: the split plans against the tree a task will start from.
const roots: string[] = [];
afterAll(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }); });
const g = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8" }).trim();
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

async function world(files: Record<string, string>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-manifests-")));
  roots.push(root);
  const repo = join(root, "repo");
  await mkdir(repo);
  g(repo, "init", "-q", "-b", "main");
  for (const [path, content] of Object.entries(files)) { await mkdir(join(repo, path, ".."), { recursive: true }); await writeFile(join(repo, path), content); }
  g(repo, "add", "-A"); g(repo, "commit", "-qm", "base");
  return { repo, commit: g(repo, "rev-parse", "HEAD") };
}

describe("the split's manifests (task setup spec §4.1)", () => {
  // mutation C1-M1: read package.json from the disk instead of the commit -> the uncommitted script shows -> red
  it("lists the root and each named workspace with the committed package fields, not what is on disk", async () => {
    const w = await world({
      "package.json": json({ name: "root", private: true, version: "1.0.0", scripts: { test: "vitest run", build: "tsc" }, workspaces: ["web"], dependencies: { a: "1" } }),
      "web/package.json": json({ name: "@x/web", scripts: { test: "vitest" } }),
      "src/a.ts": "export const a = 1;\n",
    });
    await writeFile(join(w.repo, "package.json"), json({ name: "edited", scripts: { test: "edited", added: "x" }, workspaces: ["web"] }));
    const manifests = await buildManifests(w.repo, w.commit);
    expect(manifests).toEqual({
      status: "ok", cut: false,
      entries: [
        { dir: "", package: { name: "root", scripts: { test: "vitest run", build: "tsc" }, workspaces: ["web"] }, lockfiles: [], present: [] },
        { dir: "web", package: { name: "@x/web", scripts: { test: "vitest" }, workspaces: null }, lockfiles: [], present: [] },
      ],
    });
  });

  // mutation C1-M3: take workspace patterns literally (no glob expansion) -> packages/a and tools/deep/x are missing -> red
  it("expands workspace globs against the commit's tree: `*` one level, `**` any depth, only directories with a package.json", async () => {
    const w = await world({
      "package.json": json({ name: "root", workspaces: ["packages/*", "tools/**", "!packages/skip"] }),
      "packages/a/package.json": json({ name: "a" }),
      "packages/b/package.json": json({ name: "b" }),
      "packages/b/nested/package.json": json({ name: "nested" }),
      "packages/c/README.md": "no package here\n",
      "packages/skip/package.json": json({ name: "skip" }),
      "tools/deep/x/package.json": json({ name: "x" }),
    });
    await mkdir(join(w.repo, "packages", "d"), { recursive: true });
    await writeFile(join(w.repo, "packages", "d", "package.json"), json({ name: "d-on-disk-only" }));
    const manifests = await buildManifests(w.repo, w.commit);
    expect(manifests.entries.map((entry) => entry.dir)).toEqual(["", "packages/a", "packages/b", "tools/deep/x"]);
    expect(manifests.entries.map((entry) => entry.package?.name)).toEqual(["root", "a", "b", "x"]);
  });

  // mutation: read `workspaces` as an array only -> yarn's object form expands nothing and reports null -> red
  it("reads yarn's object form `workspaces: { packages }` for expansion and reports its packages", async () => {
    const w = await world({
      "package.json": json({ name: "root", workspaces: { packages: ["packages/*"], nohoist: ["**/x"] } }),
      "packages/a/package.json": json({ name: "a" }),
    });
    const manifests = await buildManifests(w.repo, w.commit);
    expect(manifests.entries.map((entry) => entry.dir)).toEqual(["", "packages/a"]);
    expect(manifests.entries[0]!.package).toEqual({ name: "root", scripts: {}, workspaces: ["packages/*"] });
  });

  it("names the lockfile and the other build manifests in each listed directory, and only there", async () => {
    const w = await world({
      "package.json": json({ name: "root", workspaces: ["web"] }),
      "package-lock.json": "{}\n",
      "Makefile": "all:\n",
      "requirements.txt": "x\n",
      "requirements-dev.txt": "y\n",
      "go.mod": "module x\n",
      "web/package.json": json({ name: "web" }),
      "web/pnpm-lock.yaml": "lockfileVersion: 9\n",
      "web/yarn.lock": "\n",
      "web/pyproject.toml": "[project]\n",
      "web/Cargo.toml": "[package]\n",
      "other/Cargo.toml": "[package]\n",
      "other/bun.lockb": "x",
    });
    const manifests = await buildManifests(w.repo, w.commit);
    expect(manifests.entries.map(({ dir, lockfiles, present }) => ({ dir, lockfiles, present }))).toEqual([
      { dir: "", lockfiles: ["package-lock.json"], present: ["Makefile", "go.mod", "requirements-dev.txt", "requirements.txt"] },
      { dir: "web", lockfiles: ["pnpm-lock.yaml", "yarn.lock"], present: ["Cargo.toml", "pyproject.toml"] },
    ]);
  });

  it("lists the root with no package when there is no package.json, or it is not a JSON object", async () => {
    const bare = await world({ "Makefile": "all:\n" });
    expect(await buildManifests(bare.repo, bare.commit)).toEqual({ status: "ok", cut: false, entries: [{ dir: "", package: null, lockfiles: [], present: ["Makefile"] }] });
    const broken = await world({ "package.json": "{ not json" });
    expect((await buildManifests(broken.repo, broken.commit)).entries).toEqual([{ dir: "", package: null, lockfiles: [], present: [] }]);
  });

  // mutation: never set `cut` / keep a partial entry -> red
  it("cuts whole entries in directory order at maxBytes of canonical JSON, and says so", async () => {
    const files: Record<string, string> = { "package.json": json({ name: "root", workspaces: ["p/*"] }) };
    for (const name of ["a", "b", "c", "d", "e"]) files[`p/${name}/package.json`] = json({ name, scripts: { test: "x".repeat(200) } });
    const w = await world(files);
    const whole = await buildManifests(w.repo, w.commit);
    expect(whole.entries).toHaveLength(6);
    const maxBytes = 800;
    expect(canonicalBytes(whole).length).toBeGreaterThan(maxBytes);
    const cut = await buildManifests(w.repo, w.commit, maxBytes);
    expect(cut.cut).toBe(true);
    expect(cut.entries.length).toBeGreaterThan(1);
    expect(cut.entries).toEqual(whole.entries.slice(0, cut.entries.length));
    expect(canonicalBytes(cut).length).toBeLessThanOrEqual(maxBytes);
    const next = { ...cut, entries: whole.entries.slice(0, cut.entries.length + 1) };
    expect(canonicalBytes(next).length).toBeGreaterThan(maxBytes);
  });

  // Pinned on purpose: entries are whole or absent, so a root entry larger than maxBytes leaves none, and `cut` says so.
  it("a root entry that alone exceeds maxBytes leaves no entries and is cut", async () => {
    const w = await world({ "package.json": json({ name: "root", scripts: { test: "x".repeat(400) } }) });
    expect(await buildManifests(w.repo, w.commit, 200)).toEqual({ status: "ok", entries: [], cut: true });
  });
});
