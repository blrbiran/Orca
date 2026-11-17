import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * The quick tier and the gate around it (spec 2026-10-20 §11; human ruling session 2026-11-17 evening, 「测试精简点头同意」).
 * Per patch set `npm test` runs a cheap selection and defers the heavy files by name; once per merge batch
 * `npm run test:wide` runs today's selection; an identical tree is never gated twice; a red run re-runs only its failed
 * files, labelled; one gate runs at a time; web/dist is built before the panel tests that need it. Each criterion runs
 * the real script in a throwaway repository with a stub vitest and typecheck that record what they were given; the
 * vitest results cache is a file the fixture writes, never the real one.
 */
const script = resolve("scripts/test-affected.mjs");
const realModules = resolve("node_modules");
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); }, 120_000);

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}
function write(repo: string, rel: string, text: string): void {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), text);
}
const T = (body: string) => `import { expect, it } from "vitest";\n${body}\nit("t", () => expect(1).toBe(1));\n`;

const FAKE_VITEST = String.raw`#!/usr/bin/env node
const fs = require("fs");
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ tool: "vitest", argv: process.argv.slice(2), cwd: process.cwd(), lock: process.env.ORCA_GATE_LOCK }) + "\n");
const out = process.argv.find((a) => a.startsWith("--outputFile.json="));
if (out) fs.writeFileSync(out.slice("--outputFile.json=".length), process.env.FAKE_VITEST_JSON || JSON.stringify({ testResults: [] }));
process.exit(Number(process.env.FAKE_VITEST_EXIT || 0));
`;
const RECORD = (tool: string) => `require("fs").appendFileSync(process.env.FAKE_LOG, JSON.stringify({ tool: "${tool}" }) + "\\n");\n`;

// tests/a/util.test.ts imports src/a/util.ts (distance 1); tests/b/user.test.ts reaches it only through src/b/user.ts
// (distance 2); tests/c/typeOnly.test.ts imports only its types; heavy.test.ts is slow on record; world.test.ts imports
// the real ccloop world; tests/panel/refusalCoverage.test.ts imports nothing errors.ts touches (the #328 ② shape).
const FILES: Record<string, string> = {
  "vitest.config.ts": `export default { test: { include: ["tests/**/*.test.ts"] } };\n`,
  "src/a/util.ts": "export const a = 1;\nexport type A = number;\n",
  "src/b/user.ts": `import { a } from "../a/util.js";\nexport const b = a + 1;\n`,
  "src/control/errors.ts": `export const CODES = ["x"];\n`,
  "tests/a/util.test.ts": T(`import { a } from "../../src/a/util.js";\nvoid a;`),
  "tests/b/user.test.ts": T(`import { b } from "../../src/b/user.js";\nvoid b;`),
  "tests/c/typeOnly.test.ts": T(`import type { A } from "../../src/a/util.js";\nconst n: A = 1;\nvoid n;`),
  "tests/c/heavy.test.ts": T(`import { a } from "../../src/a/util.js";\nvoid a;`),
  "tests/c/world.test.ts": T(`import { a } from "../../src/a/util.js";\nimport { w } from "../control/fixtures/ccloopWorld.js";\nvoid a; void w;`),
  "tests/control/fixtures/ccloopWorld.ts": "export const w = 1;\n",
  "tests/c/plain.test.ts": T(""),
  "tests/panel/refusalCoverage.test.ts": T(""),
};
const CACHE: Record<string, number> = { "tests/a/util.test.ts": 120, "tests/c/heavy.test.ts": 45_000, "tests/c/plain.test.ts": 80 };

type Call = { tool: string; argv?: string[]; cwd?: string };
function tierRepo(cache: Record<string, number> | null = CACHE, base: Record<string, string> = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "tiers-")));
  roots.push(dir);
  const repo = join(dir, "repo");
  mkdirSync(join(repo, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(repo, "node_modules", ".bin", "vitest"), FAKE_VITEST, { mode: 0o755 });
  // The real package for vitest's argument parser and `related`; the binary stays the stub, the cache is the fixture's.
  symlinkSync(join(realModules, "vitest"), join(repo, "node_modules", "vitest"));
  if (cache) {
    write(repo, "node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json",
      JSON.stringify({ version: "5.0.3", results: Object.entries(cache).map(([p, ms]) => [`:${p}`, { duration: ms, failed: false }]) }));
  }
  write(repo, "typecheck.js", RECORD("typecheck"));
  write(repo, "package.json", JSON.stringify({ name: "orca-like", type: "commonjs", scripts: { typecheck: "node typecheck.js" } }) + "\n");
  write(repo, ".gitignore", "node_modules\n");
  for (const [rel, text] of Object.entries({ ...FILES, ...base })) write(repo, rel, text);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  git(repo, "checkout", "-q", "-b", "work");
  const log = join(dir, "calls.log");
  const lock = join(dir, "gate.lock");
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Call) : []);
  const run = (args: string[], env: Record<string, string> = {}) => {
    const r = spawnSync(process.execPath, [script, ...args], { cwd: repo, encoding: "utf8", env: { ...process.env, FAKE_LOG: log, ORCA_GATE_LOCK: lock, ...env } });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  return { repo, log, lock, calls, run };
}
const commit = (repo: string) => { git(repo, "add", "-A"); git(repo, "commit", "-q", "-m", "change"); };
const rows = (out: string, kind: "selected" | "deferred") => out.split("\n")
  .filter((l) => (kind === "selected" ? /^ {2}(root|web) \S+ <- / : /^ {2}deferred (root|web) \S+: /).test(l))
  .map((l) => l.trim().replace(/^deferred /, "").split(/ <- |: /)[0]).sort();

describe("the quick tier (npm test, per patch set)", () => {
  it("selects the mirror directory and direct importers, not the transitive or type-only ones, and says it is not the merge gate", () => {
    const { repo, run } = tierRepo();
    write(repo, "src/a/util.ts", "export const a = 2;\nexport type A = number;\n");
    commit(repo);
    const r = run(["--dry-run", "--base", "main"]);
    expect(r.code, r.out).toBe(0);
    // mutation: call `related` instead of directImporters -> tests/b/user.test.ts (distance 2) and the type-only importer appear.
    expect(rows(r.out, "selected")).toEqual(["root tests/a/util.test.ts"]);
    expect(r.out).toContain("  root tests/a/util.test.ts <- src/a/util.ts (mirror tests/a/); src/a/util.ts (imported directly)\n");
    expect(r.out).toContain("QUICK tier (npm test): per patch set; this is NOT the merge gate -- run npm run test:wide once per merge batch into main");
  });

  it("defers a file slow on record and a real-ccloop world test, each printed with its reason", () => {
    const { repo, run } = tierRepo();
    write(repo, "src/a/util.ts", "export const a = 2;\nexport type A = number;\n");
    commit(repo);
    const r = run(["--dry-run", "--base", "main"]);
    // mutation: drop the deferral loop -> heavy and world are selected rows instead.
    expect(rows(r.out, "deferred")).toEqual(["root tests/c/heavy.test.ts", "root tests/c/world.test.ts"]);
    expect(r.out).toContain("  deferred root tests/c/heavy.test.ts: recorded 45.0 s >= 30 s <- src/a/util.ts (imported directly)\n");
    expect(r.out).toContain("  deferred root tests/c/world.test.ts: runs the real ccloop (imports tests/control/fixtures/ccloopWorld.ts) <- src/a/util.ts (imported directly)\n");
    expect(r.out).toContain("test-affected: 2 test files deferred to the wide tier");
  });

  it("never defers a slow file that itself changed", () => {
    const { repo, run } = tierRepo();
    write(repo, "tests/c/heavy.test.ts", T("// changed"));
    commit(repo);
    const r = run(["--dry-run", "--base", "main"]);
    // mutation: drop the `changed.includes(file)` exemption -> heavy is deferred and nothing is selected.
    expect(rows(r.out, "selected")).toEqual(["root tests/c/heavy.test.ts"]);
    expect(rows(r.out, "deferred")).toEqual([]);
  });

  it("errors.ts selects the catalogue tables even when they do not import it (#328 ②)", () => {
    const { repo, run } = tierRepo();
    write(repo, "src/control/errors.ts", `export const CODES = ["x", "y"];\n`);
    commit(repo);
    const r = run(["--dry-run", "--base", "main"]);
    // mutation: drop the catalogue loop -> refusalCoverage is not selected.
    expect(r.out).toContain("  root tests/panel/refusalCoverage.test.ts <- src/control/errors.ts (catalogue table)\n");
  });

  it("with no results cache the selection is the wide one, and the output says so", () => {
    const { repo, run } = tierRepo(null);
    write(repo, "src/a/util.ts", "export const a = 2;\nexport type A = number;\n");
    commit(repo);
    const r = run(["--dry-run", "--base", "main"]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("no vitest results cache for the root suite (node_modules/.vite/vitest/*/results.json): its selection falls back to the wide one");
    // mutation: treat a missing cache as an empty one -> the quick selection (no b/user, heavy and world not run).
    expect(rows(r.out, "selected")).toContain("root tests/b/user.test.ts");
    expect(rows(r.out, "deferred")).toEqual([]);
  });
});

describe("the wide tier's green stamp (never gate an identical tree twice)", () => {
  it("a green wide run on a clean tree stamps it; the next wide run on that tree runs nothing; --force runs it", () => {
    const { repo, run, calls } = tierRepo();
    write(repo, "tests/c/plain.test.ts", T("// changed"));
    commit(repo);
    const first = run(["--wide", "--base", "main"]);
    expect(first.code, first.out).toBe(0);
    const tree = git(repo, "rev-parse", "HEAD^{tree}").trim();
    expect(existsSync(join(repo, ".git", "orca-gate", "green", tree)), first.out).toBe(true);
    const ran = calls().length;
    const second = run(["--wide", "--base", "main"]);
    expect(second.code).toBe(0);
    // mutation: skip the stamp check -> typecheck and vitest are called again.
    expect(second.out).toContain(`tree ${tree} was already gated green by a wide run`);
    expect(calls().length).toBe(ran);
    const forced = run(["--wide", "--force", "--base", "main"]);
    expect(forced.code, forced.out).toBe(0);
    expect(calls().filter((c) => c.tool === "vitest").length).toBe(2);
  });

  it("a dirty worktree is not stamped: its tree hash is not what ran", () => {
    const { repo, run } = tierRepo();
    write(repo, "tests/c/plain.test.ts", T("// uncommitted"));
    const r = run(["--wide", "--base", "main"]);
    expect(r.code, r.out).toBe(0);
    // mutation: stamp regardless of cleanliness -> the green directory exists.
    expect(existsSync(join(repo, ".git", "orca-gate", "green"))).toBe(false);
    expect(r.out).toContain("no stamp");
  });

  it("a quick run never stamps", () => {
    const { repo, run } = tierRepo();
    write(repo, "tests/c/plain.test.ts", T("// changed"));
    commit(repo);
    expect(run(["--base", "main"]).code).toBe(0);
    expect(existsSync(join(repo, ".git", "orca-gate", "green"))).toBe(false);
  });
});

describe("--rerun-failed", () => {
  it("re-runs only the last report's failed files, labelled as a re-run and not a gate", () => {
    const { repo, run, calls } = tierRepo();
    write(repo, "tests/c/plain.test.ts", T("// changed"));
    write(repo, "tests/a/util.test.ts", T("// changed"));
    commit(repo);
    const report = JSON.stringify({ testResults: [
      { name: join(repo, "tests/a/util.test.ts"), status: "failed", assertionResults: [] },
      { name: join(repo, "tests/c/plain.test.ts"), status: "passed", assertionResults: [] },
    ] });
    const first = run(["--base", "main"], { FAKE_VITEST_JSON: report, FAKE_VITEST_EXIT: "1" });
    expect(first.code).not.toBe(0);
    expect(first.out).toContain(`JSON report: ${join(realpathSync(repo), ".git", "orca-gate", "last-run.json")}`);
    const before = calls().length;
    const again = run(["--rerun-failed"]);
    expect(again.code, again.out).toBe(0);
    const added = calls().slice(before);
    // mutation: re-run every file of the last run -> plain.test.ts is in the argv too.
    expect(added.map((c) => c.tool)).toEqual(["vitest"]);
    expect(added[0].argv!.filter((a) => a.endsWith(".test.ts"))).toEqual(["tests/a/util.test.ts"]);
    expect(again.out).toContain("--rerun-failed: a re-run of failed files, not a gate");
    expect(again.out).toContain("that was a re-run of failed files, not a gate (exit 0)");
  });

  it("without a previous report it refuses instead of running anything", () => {
    const { run, calls } = tierRepo();
    const r = run(["--rerun-failed"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("--rerun-failed: no report of a last run");
    expect(calls()).toEqual([]);
  });
});

describe("one gate at a time on the machine, with the load printed", () => {
  it("waits while a live process holds the lock, then runs; prints uptime at start and end", () => {
    const { repo, run, lock } = tierRepo();
    write(repo, "tests/c/plain.test.ts", T("// changed"));
    // The holder must not be this worker's child: blocked in spawnSync, the worker could not reap it, and a zombie answers
    // kill(pid, 0) as alive forever. A backgrounded sleep whose shell exits is reparented and reaped by the system.
    const pid = Number(spawnSync("sh", ["-c", "sleep 3 >/dev/null 2>&1 & echo $!"], { encoding: "utf8" }).stdout.trim());
    writeFileSync(lock, JSON.stringify({ pid, root: "/elsewhere", at: "earlier" }) + "\n");
    const r = run(["--base", "main"]);
    expect(r.code, r.out).toBe(0);
    // mutation: treat every holder as dead -> no "waiting" line; the run would overlap the other gate.
    const waiting = r.out.indexOf(`waiting: another gate holds the machine-wide lock ${lock} (pid ${pid}`);
    expect(waiting, r.out).toBeGreaterThanOrEqual(0);
    expect(r.out.indexOf("load at start: ")).toBeGreaterThan(waiting);
    expect(r.out).toContain("test-affected: load at end: ");
    expect(existsSync(lock)).toBe(false);
  }, 30_000);

  // Controller, session 2026-11-17: a test of this script runs inside a gate and spawns the script again; with one fixed
  // lock path that nested run waited on its own parent forever (a real wide gate hung 39 min on testAffected.test.ts).
  // The tests a gate runs get their own nested lock; the outer lock stays the one machine-wide path.
  it("gives the tests it runs a lock of their own, so a gate started by a test never waits on this one", () => {
    const { repo, run, lock, calls } = tierRepo();
    write(repo, "tests/c/plain.test.ts", T("// changed"));
    const r = run(["--base", "main"]);
    expect(r.code, r.out).toBe(0);
    const vitest = calls().filter((c: { tool: string }) => c.tool === "vitest") as Array<{ lock?: string }>;
    expect(vitest.length, r.out).toBeGreaterThan(0);
    // mutation: spawn vitest with the parent's environment -> the child sees the outer lock path, red
    for (const call of vitest) { expect(call.lock).toBeDefined(); expect(call.lock).not.toBe(lock); }
  }, 30_000);

  it("takes over a lock whose pid is dead", () => {
    const { repo, run, lock } = tierRepo();
    write(repo, "tests/c/plain.test.ts", T("// changed"));
    writeFileSync(lock, JSON.stringify({ pid: 2 ** 22, root: "/elsewhere", at: "earlier" }) + "\n");
    const r = run(["--base", "main"]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain(`removing a stale gate lock ${lock} (pid ${2 ** 22} is not running)`);
    expect(r.out).not.toContain("waiting:");
  });
});

describe("web/dist before the panel tests", () => {
  // The web workspace is part of the base commit: only the panel test changes on the branch.
  function webRepo() {
    const t = tierRepo(CACHE, {
      "package.json": JSON.stringify({ name: "orca-like", type: "commonjs", workspaces: ["web"], scripts: { typecheck: "node typecheck.js" } }) + "\n",
      "web/package.json": JSON.stringify({ name: "w", scripts: { build: "node ../build.js" } }) + "\n",
      "build.js": `${RECORD("build")}require("fs").mkdirSync("dist", { recursive: true });\nrequire("fs").writeFileSync("dist/index.html", "x");\n`,
      "web/src/app.ts": "export const app = 1;\n",
      ".gitignore": "node_modules\nweb/dist\n",
    });
    write(t.repo, "tests/panel/refusalCoverage.test.ts", T("// changed"));
    return t;
  }

  it("builds web/dist first when a selected panel test needs it and it is missing", () => {
    const { run, calls } = webRepo();
    const r = run(["--base", "main"]);
    expect(r.code, r.out).toBe(0);
    // mutation: drop the ensureWebDist call -> no build before the typecheck.
    expect(calls().map((c) => c.tool)).toEqual(["build", "typecheck", "vitest"]);
    expect(r.out).toContain("web/dist is missing and tests/panel/refusalCoverage.test.ts serves the panel: running npm run build --workspace web first");
  });

  it("rebuilds when web/dist is older than web/src, and not when it is newer", () => {
    const { repo, run, calls } = webRepo();
    write(repo, "web/dist/index.html", "x");
    const old = new Date(Date.now() - 3600_000);
    utimesSync(join(repo, "web/dist/index.html"), old, old);
    expect(run(["--base", "main"]).out).toContain("web/dist is older than web/src");
    const n = calls().length;
    expect(run(["--base", "main"]).code).toBe(0);
    expect(calls().slice(n).map((c) => c.tool)).toEqual(["typecheck", "vitest"]);
  });
});
