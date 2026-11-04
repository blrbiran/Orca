import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { classifyNpmCommand, npmCommandReason } from "../../src/control/npmCommand.js";
import { buildManifests } from "../../src/control/requirementManifests.js";

// Task setup spec §4.3: a split's npm setup or check command is checked by code against the overview's commit, so a
// check that names a script or workspace that does not exist is handed back before a paid run fails on it. Only the
// exact npm shapes are checked; anything else (a `cd`, an env prefix, `--` arguments, another flag) is never refused.
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const g = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8" }).trim();

describe("classifyNpmCommand", () => {
  it("reads npm test, npm run and npm run-script, with each workspace spelling in any position after the subcommand", () => {
    expect(classifyNpmCommand("npm test")).toEqual({ kind: "npm", parts: [{ script: "test", workspace: null }] });
    expect(classifyNpmCommand("npm run build --workspace web")).toEqual({ kind: "npm", parts: [{ script: "build", workspace: "web" }] });
    expect(classifyNpmCommand("npm run build --workspace=web")).toEqual({ kind: "npm", parts: [{ script: "build", workspace: "web" }] });
    expect(classifyNpmCommand("npm run -w web build")).toEqual({ kind: "npm", parts: [{ script: "build", workspace: "web" }] });
    expect(classifyNpmCommand("npm run-script test:unit -w @orca/web")).toEqual({ kind: "npm", parts: [{ script: "test:unit", workspace: "@orca/web" }] });
    expect(classifyNpmCommand("npm test --workspace web")).toEqual({ kind: "npm", parts: [{ script: "test", workspace: "web" }] });
    expect(classifyNpmCommand("  npm run build&&npm test -w lib ")).toEqual({ kind: "npm", parts: [{ script: "build", workspace: null }, { script: "test", workspace: "lib" }] });
  });

  // mutation C2-M1: check `&&` parts independently -> `cd web && npm test` reads as npm -> red
  it("calls anything else unverifiable, the whole command, whatever its other parts are", () => {
    for (const command of [
      "cd web && npm test", "npm test -- --x", "FOO=1 npm test", "npm run -ws x", "npm run x --if-present",
      "npm test && cd web", "npm test -w a -w b", "npm -w web test", "npm run", "npm run a b", "npm test x", "npm ci",
      "make test", "npm test &&", "npm test || true", "npm test; rm x", "npm run 'x'", "npm test --workspace", "npm test --workspace=",
    ]) expect(classifyNpmCommand(command), command).toEqual({ kind: "unverifiable" });
  });
});

describe("npmCommandReason against the overview's commit", () => {
  let root = "", repo = "", commit = "";
  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "orca-npm-command-")));
    repo = join(root, "repo");
    // `big` workspaces push the manifests view past its 32 KiB cut, so `packages/zz` is in the commit but not in manifests.
    const big = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`packages/a${index}/package.json`, json({ name: `a${index}`, scripts: { build: "x".repeat(4000) } })]));
    const files: Record<string, string> = {
      "package.json": json({ name: "root", private: true, workspaces: ["web", "packages/*"], scripts: { build: "tsc" } }),
      "web/package.json": json({ name: "@orca/web", scripts: { build: "vite build" } }),
      "packages/lib/package.json": json({ name: "lib", scripts: { test: "vitest" } }),
      "packages/zz/package.json": json({ name: "zz", scripts: { test: "vitest" } }),
      "stray/package.json": json({ name: "stray", scripts: { test: "vitest" } }),
      ...big,
    };
    await mkdir(repo);
    g(repo, "init", "-q", "-b", "main");
    for (const [path, content] of Object.entries(files)) { await mkdir(join(repo, path, ".."), { recursive: true }); await writeFile(join(repo, path), content); }
    g(repo, "add", "-A"); g(repo, "commit", "-qm", "base");
    commit = g(repo, "rev-parse", "HEAD");
    // An uncommitted edit: the root gains `test` on disk only. The task starts from the commit, which has no `test`.
    await writeFile(join(repo, "package.json"), json({ name: "root", private: true, workspaces: ["web", "packages/*"], scripts: { build: "tsc", test: "vitest" } }));
  });
  afterAll(async () => { await rm(root, { recursive: true, force: true }); });
  const reason = (command: string) => npmCommandReason(repo, commit, command);

  it("refuses a script the package does not have, read from the commit and not the disk", async () => {
    expect(await reason("npm test")).toBe('command:npm test: the root package.json has no script "test"');
    expect(await reason("npm test --workspace web")).toBe('command:npm test --workspace web: workspace web (web/package.json) has no script "test"');
    expect(await reason("npm run build && npm run lint -w packages/lib")).toBe('command:npm run build && npm run lint -w packages/lib: workspace packages/lib (packages/lib/package.json) has no script "lint"');
    expect(await reason("npm run build")).toBeNull();
    expect(await reason("npm run build -w web")).toBeNull();
  });

  it("refuses a workspace the root package.json does not list, by path or by name", async () => {
    expect(await reason("npm test -w nope")).toBe('command:npm test -w nope: "nope" is not a workspace of the root package.json');
    expect(await reason("npm test -w stray")).toBe('command:npm test -w stray: "stray" is not a workspace of the root package.json');
    expect(await reason("npm test -w packages/lib")).toBeNull();
  });

  // mutation C2-M3: accept workspaces by path only -> `-w @orca/web` and `-w lib` refused -> red
  it("accepts a workspace named by its package name (Review Focus 1)", async () => {
    expect(await reason("npm run build -w @orca/web")).toBeNull();
    expect(await reason("npm test --workspace=lib")).toBeNull();
    expect(await reason("npm test -w @orca/web")).toBe('command:npm test -w @orca/web: workspace @orca/web (web/package.json) has no script "test"');
  });

  // mutation C2-M2: look the script up in manifests instead of the commit -> `packages/zz` is past the cut -> red
  it("reads the commit itself, so a cut manifests view does not matter", async () => {
    const manifests = await buildManifests(repo, commit);
    expect(manifests.cut).toBe(true);
    expect(manifests.entries.some((entry) => entry.dir === "packages/zz")).toBe(false);
    expect(await reason("npm test -w packages/zz")).toBeNull();
    expect(await reason("npm test -w zz")).toBeNull();
  });

  // mutation C2-M1: check `&&` parts independently -> the root has no `test`, so `cd web && npm test` is refused -> red
  it("never refuses an unverifiable command, even when an npm part of it would be refused alone", async () => {
    for (const command of ["cd web && npm test", "npm test -- --x", "FOO=1 npm test", "npm run -ws x", "npm run x --if-present"]) {
      expect(await reason(command), command).toBeNull();
    }
  });

  // Fix round 1 (controller ruling): code refuses only what npm would refuse.
  // mutation C2-M5: drop the `-w .` exemption -> refused as not a workspace -> red
  it("leaves `-w .` (the root) unverifiable", async () => {
    expect(await reason("npm test -w .")).toBeNull();
    expect(await reason("npm test --workspace=./")).toBeNull();
  });

  // mutation C2-M6: drop the parent-directory exemption -> refused as not a workspace -> red
  it("leaves `-w <dir>` for a directory holding workspaces unverifiable, and still refuses a mere string prefix", async () => {
    expect(await reason("npm test -w packages")).toBeNull();
    expect(await reason("npm run nothing -w packages/")).toBeNull();
    expect(await reason("npm test -w pack")).toBe('command:npm test -w pack: "pack" is not a workspace of the root package.json');
  });

  // mutation C2-M7: drop the `env` exemption -> `the root package.json has no script "env"` -> red
  it("does not look up npm's built-in `npm run env`, but still checks the other parts", async () => {
    expect(await reason("npm run env")).toBeNull();
    expect(await reason("npm run env -w web")).toBeNull();
    expect(await reason("npm run env && npm test")).toBe('command:npm run env && npm test: the root package.json has no script "test"');
  });

  // Fails open: a commit code cannot read leaves the command unverifiable (the `path:` checks name such a commit).
  it("leaves a command unverifiable when the commit's tree cannot be read", async () => {
    expect(await npmCommandReason(repo, "0".repeat(40), "npm test")).toBeNull();
  });

  it("uses the tree it is given instead of reading it again", async () => {
    expect(await npmCommandReason(repo, commit, "npm test", [])).toBe("command:npm test: there is no package.json at the root");
  });

  // mutation C2-M8: treat an unparseable package.json as one with no scripts -> refused -> red
  it("leaves a command unverifiable when the package.json it needs does not parse", async () => {
    const broken = join(root, "broken");
    await mkdir(join(broken, "web"), { recursive: true });
    g(broken, "init", "-q", "-b", "main");
    await writeFile(join(broken, "package.json"), json({ name: "root", workspaces: ["web"] }));
    await writeFile(join(broken, "web", "package.json"), "{ not json");
    g(broken, "add", "-A"); g(broken, "commit", "-qm", "base");
    const brokenCommit = g(broken, "rev-parse", "HEAD");
    expect(await npmCommandReason(broken, brokenCommit, "npm test -w web")).toBeNull();
    expect(await npmCommandReason(broken, brokenCommit, "npm test -w @x/web")).toBeNull();
    expect(await npmCommandReason(broken, brokenCommit, "npm test")).toBe('command:npm test: the root package.json has no script "test"');
    await writeFile(join(broken, "package.json"), "{ not json"); g(broken, "add", "-A"); g(broken, "commit", "-qm", "root breaks");
    expect(await npmCommandReason(broken, g(broken, "rev-parse", "HEAD"), "npm test")).toBeNull();
  });

  it("names a root with no package.json", async () => {
    const bare = join(root, "bare");
    await mkdir(bare);
    g(bare, "init", "-q", "-b", "main"); await writeFile(join(bare, "README.md"), "r"); g(bare, "add", "-A"); g(bare, "commit", "-qm", "base");
    expect(await npmCommandReason(bare, g(bare, "rev-parse", "HEAD"), "npm test")).toBe("command:npm test: there is no package.json at the root");
  });
});
