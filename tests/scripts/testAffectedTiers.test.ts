import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * The tiers and the gate around them (spec 2026-10-20 §11; human ruling session 2026-11-17 evening, 「测试精简点头同意」;
 * rewritten for the human's 2026-11-24 ruling, spec 2026-11-24-test-time-analysis.md §2-§3, 「同意你的建议」).
 * `npm test` runs the changed part -- per patch set AND per merge into main -- and defers the heavy files by name;
 * `npm run test:full` runs everything and only when the human asks or at release; there is no wide tier any more (its
 * transitive selection was the whole suite in practice: 918 of ~938 files for an 8-path batch). An identical tree is never
 * fully run twice; a red run re-runs only its failed files, labelled; one gate runs at a time; web/dist is built before the
 * panel tests that need it. Each criterion runs the real script in a throwaway repository with a stub vitest and
 * typecheck that record what they were given; the vitest results cache is a file the fixture writes, never the real one.
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

describe("npm test (the changed part, per patch set and per merge)", () => {
  it("selects the mirror directory and direct importers, not the transitive or type-only ones, and names test:full for the rest", () => {
    const { repo, run } = tierRepo();
    write(repo, "src/a/util.ts", "export const a = 2;\nexport type A = number;\n");
    commit(repo);
    const r = run(["--dry-run", "--base", "main"]);
    expect(r.code, r.out).toBe(0);
    // mutation: call `related` instead of directImporters -> tests/b/user.test.ts (distance 2) and the type-only importer appear.
    expect(rows(r.out, "selected")).toEqual(["root tests/a/util.test.ts"]);
    expect(r.out).toContain("  root tests/a/util.test.ts <- src/a/util.ts (mirror tests/a/); src/a/util.ts (imported directly)\n");
    // Ruling 2026-11-24: npm test is also the merge gate, so it no longer tells anyone to run a wider tier at a merge.
    expect(r.out).toContain("test-affected: npm test: the changed part (per patch set and per merge into main); npm run test:full runs everything, at release or when the human asks");
    expect(r.out).not.toContain("test:wide");
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
    expect(r.out).toContain("test-affected: 2 test files deferred to npm run test:full");
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

  // Ruling 2026-11-24: a missing results cache used to fall back to the transitive (wide) selection -- the whole suite in
  // practice, on every fresh worktree. It now selects the same changed part; only the by-duration deferral is lost.
  it("with no results cache the selection is still the changed part; only slow files cannot be deferred, and it says so", () => {
    const { repo, run } = tierRepo(null);
    write(repo, "src/a/util.ts", "export const a = 2;\nexport type A = number;\n");
    commit(repo);
    const r = run(["--dry-run", "--base", "main"]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("no vitest results cache for the root suite (node_modules/.vite/vitest/*/results.json): files slow on record cannot be deferred; the selection is unchanged");
    // mutation: fall back to the transitive selection without a cache -> tests/b/user.test.ts (distance 2) is a row.
    expect(rows(r.out, "selected")).toEqual(["root tests/a/util.test.ts", "root tests/c/heavy.test.ts"]);
    // mutation: drop the real-ccloop deferral when there is no cache -> world.test.ts is a selected row.
    expect(rows(r.out, "deferred")).toEqual(["root tests/c/world.test.ts"]);
  });
});

// A large mirror directory (human ruling 2026-11-18, 「同意」, session 4389b15f): tests/control holds ~470 test files, and
// one changed src/control file selected all of them in the quick tier (374-494 files, 408-508 s per run, measured
// 2026-11-18), queueing ten agents behind the machine-wide lock. Above 60 test files the quick tier selects, from that
// directory, only the tests named after the changed module; direct importers anywhere are selected as before. tests/big
// below has 61 fillers plus the files that should be picked; tests/c (4 files) is a small directory.
const FILLERS = Object.fromEntries(Array.from({ length: 61 }, (_, i) => [`tests/big/filler${String(i).padStart(2, "0")}.test.ts`, T("")]));
const BIG: Record<string, string> = {
  ...FILLERS,
  "src/big/fooBar.ts": "export const f = 1;\n",
  "tests/big/fooBar.test.ts": T(""),
  "tests/big/nested/fooBarEdge.test.ts": T(""),
  "tests/big/user.test.ts": T(`import { f } from "../../src/big/fooBar.js";\nvoid f;`),
  "tests/big/fixtures/unnamed.json": "{}\n",
  "src/c/thing.ts": "export const t = 1;\n",
};
const BIG_PICKED = ["root tests/big/fooBar.test.ts", "root tests/big/nested/fooBarEdge.test.ts", "root tests/big/user.test.ts"];

describe("a large mirror directory in the quick tier", () => {
  it("a changed module in a directory of more than 60 tests selects its name matches and direct importers, not the directory", () => {
    const { repo, run } = tierRepo(CACHE, BIG);
    write(repo, "src/big/fooBar.ts", "export const f = 2;\n");
    commit(repo);
    const r = run(["--dry-run", "--base", "main"]);
    expect(r.code, r.out).toBe(0);
    // mutation: select the whole mirror for a large directory too -> the 61 fillers are selected rows.
    expect(rows(r.out, "selected")).toEqual(BIG_PICKED);
    // mutation: drop the name filter (or match nothing) -> fooBar.test.ts loses its name-match reason.
    expect(r.out).toContain("  root tests/big/fooBar.test.ts <- src/big/fooBar.ts (name match in tests/big/: 64 tests > 60, not the whole mirror)\n");
    expect(r.out).toContain("  root tests/big/user.test.ts <- src/big/fooBar.ts (imported directly)\n");
  });

  it("a deleted module in a large directory selects its name matches and the tests that still import it", () => {
    const { repo, run } = tierRepo(CACHE, BIG);
    rmSync(join(repo, "src/big/fooBar.ts"));
    commit(repo);
    const r = run(["--dry-run", "--base", "main"]);
    expect(r.code, r.out).toBe(0);
    // mutation: do not feed the gone path to the direct-importer scan -> user.test.ts (its broken importer) is missing.
    expect(rows(r.out, "selected")).toEqual(BIG_PICKED);
  });

  it("a data file in a large directory that no test names falls back to that directory, not to the whole suite", () => {
    const { repo, run } = tierRepo(CACHE, BIG);
    write(repo, "tests/big/fixtures/unnamed.json", "{ \"changed\": true }\n");
    commit(repo);
    const r = run(["--dry-run", "--base", "main"]);
    expect(r.code, r.out).toBe(0);
    // mutation: drop the mirror fallback for narrowed data -> the whole-suite fallback selects tests/a and tests/c too.
    const picked = rows(r.out, "selected");
    expect(picked.length, r.out).toBe(64);
    expect(picked.every((row) => row.startsWith("root tests/big/")), r.out).toBe(true);
    expect(r.out).toContain("no test names tests/big/fixtures/unnamed.json; selecting its mirror directory tests/big/");
  });

  it("a small mirror directory is still selected whole", () => {
    const { repo, run } = tierRepo(CACHE, BIG);
    write(repo, "src/c/thing.ts", "export const t = 2;\n");
    commit(repo);
    const r = run(["--dry-run", "--base", "main"]);
    expect(r.code, r.out).toBe(0);
    // mutation: narrow every mirror directory -> nothing in tests/c is named "thing", so nothing is selected or deferred.
    expect(rows(r.out, "selected")).toEqual(["root tests/c/plain.test.ts", "root tests/c/typeOnly.test.ts"]);
    expect(rows(r.out, "deferred")).toEqual(["root tests/c/heavy.test.ts", "root tests/c/world.test.ts"]);
    expect(r.out).toContain("  root tests/c/plain.test.ts <- src/c/thing.ts (mirror tests/c/)\n");
  });

  it("with no results cache a large mirror directory is narrowed too", () => {
    const { repo, run } = tierRepo(null, BIG);
    write(repo, "src/big/fooBar.ts", "export const f = 2;\n");
    commit(repo);
    const r = run(["--dry-run", "--base", "main"]);
    expect(r.code, r.out).toBe(0);
    // mutation: narrow only when a results cache exists (the old `!quick.root ||`) -> 64 rows instead of 3.
    expect(rows(r.out, "selected")).toEqual(BIG_PICKED);
  });
});

describe("npm run test:full (everything; at release or when the human asks)", () => {
  it("selects every root and web test file and defers nothing, whatever changed", () => {
    const { repo, run } = tierRepo(CACHE, BIG);
    write(repo, "src/big/fooBar.ts", "export const f = 2;\n");
    commit(repo);
    const r = run(["--dry-run", "--full", "--base", "main"]);
    expect(r.code, r.out).toBe(0);
    // mutation: let --full run the changed-part selection -> 3 rows instead of every test file.
    expect(rows(r.out, "selected").length, r.out).toBe(64 + 7);
    // mutation: keep the deferral loop for --full -> heavy and world are deferred rows.
    expect(rows(r.out, "deferred")).toEqual([]);
    expect(r.out).toContain("test-affected: npm run test:full: every test file");
  });

  it("refuses the removed --wide flag and names what replaced it", () => {
    const { run, calls } = tierRepo();
    const r = run(["--wide", "--base", "main"]);
    // mutation: keep accepting --wide -> exit 0 and a run.
    expect(r.code).toBe(1);
    expect(r.out).toContain("--wide is gone (human ruling 2026-11-24): npm test is the merge gate; npm run test:full runs everything");
    expect(calls()).toEqual([]);
  });

  it("package.json names the tiers: npm test is this script, test:full is this script with --full, test:wide is gone", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts.test).toBe("node scripts/test-affected.mjs");
    expect(pkg.scripts["test:full"]).toBe("node scripts/test-affected.mjs --full");
    // mutation: leave test:wide (or the old root-only test:all) in package.json -> a second "everything" name survives.
    expect(pkg.scripts["test:wide"]).toBeUndefined();
    expect(pkg.scripts["test:all"]).toBeUndefined();
  });
});

describe("the full run's green stamp (never run an identical tree fully twice)", () => {
  it("a green full run on a clean tree stamps it; the next full run on that tree runs nothing; --force runs it", () => {
    const { repo, run, calls } = tierRepo();
    write(repo, "tests/c/plain.test.ts", T("// changed"));
    commit(repo);
    const first = run(["--full", "--base", "main"]);
    expect(first.code, first.out).toBe(0);
    const tree = git(repo, "rev-parse", "HEAD^{tree}").trim();
    expect(existsSync(join(repo, ".git", "orca-gate", "green", tree)), first.out).toBe(true);
    const ran = calls().length;
    const second = run(["--full", "--base", "main"]);
    expect(second.code).toBe(0);
    // mutation: skip the stamp check -> typecheck and vitest are called again.
    expect(second.out).toContain(`tree ${tree} was already run green in full`);
    expect(calls().length).toBe(ran);
    const forced = run(["--full", "--force", "--base", "main"]);
    expect(forced.code, forced.out).toBe(0);
    expect(calls().filter((c) => c.tool === "vitest").length).toBe(2);
  });

  it("a dirty worktree is not stamped: its tree hash is not what ran", () => {
    const { repo, run } = tierRepo();
    write(repo, "tests/c/plain.test.ts", T("// uncommitted"));
    const r = run(["--full", "--base", "main"]);
    expect(r.code, r.out).toBe(0);
    // mutation: stamp regardless of cleanliness -> the green directory exists.
    expect(existsSync(join(repo, ".git", "orca-gate", "green"))).toBe(false);
    expect(r.out).toContain("no stamp");
  });

  it("an npm test run never stamps", () => {
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
