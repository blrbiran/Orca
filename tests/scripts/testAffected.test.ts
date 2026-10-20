import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * scripts/test-affected.mjs (spec 2026-10-20 §4.1, human ruling session f3a75a90): `npm test` runs the tests a change
 * touches, chosen by code, so an agent's default test command stops being the whole suite. A selection that misses a
 * row ships untested code; one that silently selects nothing looks green. Every criterion runs the real script in a
 * throwaway git repository shaped like Orca. Selection criteria use the real vitest (its `related` graph) through a
 * node_modules link; running criteria use a stub vitest and stub typecheck that record what they were given.
 */
const script = resolve("scripts/test-affected.mjs");
const realModules = resolve("node_modules");
const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function tempRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "affected-")));
  roots.push(root);
  return root;
}

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

// The module graph the rows are measured against. tests/b/user.test.ts reaches src/a/util.ts only through
// src/b/user.ts (an importer outside the mirror directory); tests/panel/parity.test.ts imports web/src by value.
const GRAPH: Record<string, string> = {
  "vitest.config.ts": `export default { test: { include: ["tests/**/*.test.ts"] } };\n`,
  "tsconfig.json": "{}\n",
  "src/a/util.ts": "export const a = 1;\n",
  "src/b/user.ts": `import { a } from "../a/util.js";\nexport const b = a + 1;\n`,
  "src/main.ts": "export const m = 1;\n",
  "src/control/webProtocol.ts": "export const p = 1;\n",
  "scripts/tool.mjs": "export const t = 1;\n",
  "tests/a/util.test.ts": T(`import { a } from "../../src/a/util.js";\nvoid a;`),
  "tests/a/other.test.ts": T(""),
  "tests/b/user.test.ts": T(`import { b } from "../../src/b/user.js";\nvoid b;`),
  "tests/c/plain.test.ts": T(""),
  "tests/c/usesHelper.test.ts": T(`import { h } from "../helpers/h.js";\nvoid h;`),
  "tests/helpers/h.ts": "export const h = 1;\n",
  "tests/entry/cli.test.ts": T(""),
  "tests/scripts/s.test.ts": T(""),
  "tests/ledger/validateFile.test.ts": T(""),
  "tests/panel/parity.test.ts": T(`import { w } from "../../web/src/w.js";\nvoid w;`),
  "tests/setup/env.ts": "export {};\n",
  ".decisions/d1.json": "{}\n",
  "skills/x/SKILL.md": "# x\n",
  "docs/readme.md": "# readme\n",
  "web/package.json": `{ "type": "module" }\n`,
  "web/vite.config.ts": `export default { test: { include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"], setupFiles: ["tests/setup.ts"] } };\n`,
  "web/tsconfig.json": "{}\n",
  "web/src/w.ts": "export const w = 1;\n",
  "web/src/lone.ts": "export const l = 1;\n",
  "web/tests/w.test.ts": T(`import { w } from "../src/w.js";\nvoid w;`),
  "web/tests/other.test.tsx": T(`const data = "fixtures/data.json";\nvoid data;`),
  "web/tests/setup.ts": "export {};\n",
  "web/tests/fixtures/data.json": "{}\n",
  // Data read as text: named by a test (its basename in a path built from segments), by a helper, by nothing; a decoy
  // whose name merely ends in the same basename must not be selected.
  "tests/fixtures/m/golden.json": "{}\n",
  "tests/m/cli.test.ts": T(`const golden = ["..", "fixtures", "m", "golden.json"].join("/");\nvoid golden;`),
  "tests/n/decoy.test.ts": T(`const other = "fixtures/hook-golden.json";\nvoid other;`),
  "tests/fixtures/p/rows.jsonl": "{}\n",
  "tests/helpers/fixtureReader.ts": `export const rows = "rows.jsonl";\n`,
  "tests/p/viaHelper.test.ts": T(`import { rows } from "../helpers/fixtureReader.js";\nvoid rows;`),
  "tests/fixtures/orphan.txt": "x\n",
};
const ALL_ROOT = Object.keys(GRAPH).filter((p) => /^tests\/.+\.test\.ts$/.test(p)).map((p) => `root ${p}`).sort();

let template = "";
beforeAll(() => {
  template = join(tempRoot(), "repo");
  mkdirSync(template);
  write(template, "package.json", JSON.stringify({ name: "orca-like", type: "module", scripts: { typecheck: "node -e 0" } }) + "\n");
  write(template, ".gitignore", "node_modules\n");
  for (const [rel, text] of Object.entries(GRAPH)) write(template, rel, text);
  git(template, "init", "-q", "-b", "main");
  git(template, "add", "-A");
  git(template, "commit", "-q", "-m", "base");
  symlinkSync(realModules, join(template, "node_modules"));
});

// A fresh copy of the template on a work branch; the change under test is committed there, and main is the base.
function graphRepo(): string {
  const repo = join(tempRoot(), "repo");
  cpSync(template, repo, { recursive: true, verbatimSymlinks: true });
  git(repo, "checkout", "-q", "-b", "work");
  return repo;
}
const commit = (repo: string) => { git(repo, "add", "-A"); git(repo, "commit", "-q", "-m", "change"); };

function affected(repo: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: repo, encoding: "utf8", env: { ...process.env, ...env } });
  return { code: r.status, out: r.stdout + r.stderr };
}

// "  root tests/a/x.test.ts <- reason; reason" => "root tests/a/x.test.ts"
const selected = (out: string) => out.split("\n").filter((l) => /^ {2}(root|web) \S+ <- /.test(l)).map((l) => l.trim().split(" <- ")[0]).sort();

function dry(repo: string, args: string[] = ["--base", "main"]) {
  const r = affected(repo, ["--dry-run", ...args]);
  expect(r.code, r.out).toBe(0);
  return { ...r, files: selected(r.out) };
}

describe("selection rows (dry run against the real module graph)", () => {
  it("a changed test file selects that file", () => {
    const repo = graphRepo();
    write(repo, "tests/c/plain.test.ts", T("// changed"));
    commit(repo);
    expect(dry(repo).files).toEqual(["root tests/c/plain.test.ts"]);
  });

  it("a src module selects its importers anywhere (related) plus every test in its mirror directory", () => {
    const repo = graphRepo();
    write(repo, "src/a/util.ts", "export const a = 2;\n");
    commit(repo);
    expect(dry(repo).files).toEqual(["root tests/a/other.test.ts", "root tests/a/util.test.ts", "root tests/b/user.test.ts"]);
  });

  it("a top-level src file mirrors to tests/entry, a script to tests/scripts", () => {
    const repo = graphRepo();
    write(repo, "src/main.ts", "export const m = 2;\n");
    write(repo, "scripts/tool.mjs", "export const t = 2;\n");
    commit(repo);
    expect(dry(repo).files).toEqual(["root tests/entry/cli.test.ts", "root tests/scripts/s.test.ts"]);
  });

  it("a non-test file under tests/ (a helper) selects the tests that import it", () => {
    const repo = graphRepo();
    write(repo, "tests/helpers/h.ts", "export const h = 2;\n");
    commit(repo);
    expect(dry(repo).files).toEqual(["root tests/c/usesHelper.test.ts"]);
  });

  it("a non-test file under tests/<dir>/ that nothing imports selects its mirror directory", () => {
    const repo = graphRepo();
    write(repo, "tests/c/worker.mjs", "export const w = 1;\n");
    commit(repo);
    expect(dry(repo).files).toEqual(["root tests/c/plain.test.ts", "root tests/c/usesHelper.test.ts"]);
  });

  it("a deleted module selects its mirror directory, which still holds the tests that imported it", () => {
    const repo = graphRepo();
    unlinkSync(join(repo, "src/b/user.ts"));
    commit(repo);
    expect(dry(repo).files).toEqual(["root tests/b/user.test.ts"]);
  });

  it("a renamed test file: the path renamed away selects its mirror directory only, the new path selects itself", () => {
    const repo = graphRepo();
    mkdirSync(join(repo, "tests/d"));
    renameSync(join(repo, "tests/c/plain.test.ts"), join(repo, "tests/d/plain.test.ts"));
    commit(repo);
    expect(dry(repo).files).toEqual(["root tests/c/usesHelper.test.ts", "root tests/d/plain.test.ts"]);
  });

  it("a web file selects the web suite's dependants and the root tests that import it, and adds the web typecheck", () => {
    const repo = graphRepo();
    write(repo, "web/src/w.ts", "export const w = 2;\n");
    commit(repo);
    const r = dry(repo);
    expect(r.files).toEqual(["root tests/panel/parity.test.ts", "web web/tests/w.test.ts"]);
    expect(r.out).toContain("typecheck: npm run typecheck ; node_modules/.bin/tsc --noEmit -p web/tsconfig.json\n");
  });

  it("a changed web test selects itself; src/control/webProtocol.ts also adds the web typecheck, a plain src file does not", () => {
    const web = graphRepo();
    write(web, "web/tests/other.test.tsx", T("// changed"));
    commit(web);
    expect(dry(web).files).toEqual(["web web/tests/other.test.tsx"]);
    const protocol = graphRepo();
    write(protocol, "src/control/webProtocol.ts", "export const p = 2;\n");
    commit(protocol);
    expect(dry(protocol).out).toContain("web/tsconfig.json");
    const plain = graphRepo();
    write(plain, "src/b/user.ts", "export const b = 3;\n");
    commit(plain);
    const r = dry(plain);
    expect(r.files).toEqual(["root tests/b/user.test.ts"]);
    expect(r.out).toContain("typecheck: npm run typecheck\n");
  });

  it("text read by tests: skills/** selects tests/entry, .decisions/** selects the ledger file validator", () => {
    const skills = graphRepo();
    write(skills, "skills/x/SKILL.md", "# changed\n");
    commit(skills);
    expect(dry(skills).files).toEqual(["root tests/entry/cli.test.ts"]);
    const ledger = graphRepo();
    write(ledger, ".decisions/d2.json", "{}\n");
    commit(ledger);
    expect(dry(ledger).files).toEqual(["root tests/ledger/validateFile.test.ts"]);
  });

  it("a config file selects the whole suite explicitly: root config the root suite, web config the web suite", () => {
    const root = graphRepo();
    write(root, "package.json", JSON.stringify({ name: "orca-like", type: "module", version: "2.0.0", scripts: { typecheck: "node -e 0" } }) + "\n");
    commit(root);
    expect(dry(root).files).toEqual(ALL_ROOT);
    const setup = graphRepo();
    write(setup, "tests/setup/env.ts", "export const changed = 1;\n");
    commit(setup);
    expect(dry(setup).files).toEqual(ALL_ROOT);
    const web = graphRepo();
    write(web, "web/vite.config.ts", GRAPH["web/vite.config.ts"] + "// changed\n");
    commit(web);
    expect(dry(web).files).toEqual(["web web/tests/other.test.tsx", "web web/tests/w.test.ts"]);
  });

  it("web/tests/setup.ts runs before every web test, so it selects the whole web suite like the web config", () => {
    const repo = graphRepo();
    write(repo, "web/tests/setup.ts", "export const changed = 1;\n");
    commit(repo);
    // The reason is the measure: vitest's `related` happens to answer "everything" for a setup file too, but a config
    // row is never left to `related` (spec §4.1 rules table), so it must be the config row that selected it.
    const r = dry(repo);
    expect(r.files).toEqual(["web web/tests/other.test.tsx", "web web/tests/w.test.ts"]);
    expect(r.out).toContain("  web web/tests/w.test.ts <- web/tests/setup.ts (config: whole web suite)\n");
  });

  it("a data file under tests/ selects the tests that name it, not one whose file name merely ends the same way", () => {
    const repo = graphRepo();
    write(repo, "tests/fixtures/m/golden.json", `{ "changed": 1 }\n`);
    commit(repo);
    const r = dry(repo);
    expect(r.files).toEqual(["root tests/m/cli.test.ts"]);
    expect(r.out).toContain("  root tests/m/cli.test.ts <- tests/fixtures/m/golden.json (named by tests/m/cli.test.ts)\n");
  });

  it("a data file named only by a helper selects the tests that import that helper", () => {
    const repo = graphRepo();
    write(repo, "tests/fixtures/p/rows.jsonl", "{}\n{}\n");
    commit(repo);
    expect(dry(repo).files).toEqual(["root tests/p/viaHelper.test.ts"]);
  });

  it("a data file under web/tests/ selects the web tests that name it", () => {
    const repo = graphRepo();
    write(repo, "web/tests/fixtures/data.json", `{ "changed": 1 }\n`);
    commit(repo);
    expect(dry(repo).files).toEqual(["web web/tests/other.test.tsx"]);
  });

  it("a data file under tests/ that no test or helper names selects the whole suite, loudly, never nothing", () => {
    const repo = graphRepo();
    write(repo, "tests/fixtures/orphan.txt", "changed\n");
    commit(repo);
    const r = dry(repo);
    expect(r.files).toEqual(ALL_ROOT);
    expect(r.out).toContain("test-affected: no test names tests/fixtures/orphan.txt; selecting the whole root suite\n");
  });

  it("a docs-only change selects nothing and says zero, byte for byte", () => {
    const repo = graphRepo();
    write(repo, "docs/readme.md", "# changed\n");
    write(repo, "CHANGELOG.md", "x\n");
    commit(repo);
    const r = dry(repo);
    expect(r.files).toEqual([]);
    expect(r.out).toContain("\ntest-affected: 0 test files selected (no changes against main select any)\n");
    expect(r.out).toContain("changed paths that select no test: CHANGELOG.md, docs/readme.md\n");
  });
});

describe("change sources", () => {
  // No commit on the branch: whatever is selected came from the source under test alone.
  it("a staged-only change is selected", () => {
    const repo = graphRepo();
    write(repo, "tests/c/plain.test.ts", T("// staged"));
    git(repo, "add", "tests/c/plain.test.ts");
    expect(dry(repo).files).toEqual(["root tests/c/plain.test.ts"]);
  });

  it("an unstaged-only change is selected", () => {
    const repo = graphRepo();
    write(repo, "tests/c/plain.test.ts", T("// unstaged"));
    expect(dry(repo).files).toEqual(["root tests/c/plain.test.ts"]);
  });

  it("an untracked-only file is selected", () => {
    const repo = graphRepo();
    write(repo, "tests/c/fresh.test.ts", T(""));
    expect(dry(repo).files).toEqual(["root tests/c/fresh.test.ts"]);
  });
});

describe("base argument", () => {
  it("--base=<ref> is the base, the same as --base <ref>", () => {
    const repo = graphRepo();
    write(repo, "tests/c/plain.test.ts", T("// first"));
    commit(repo);
    write(repo, "tests/a/other.test.ts", T("// second"));
    commit(repo);
    for (const args of [["--base=HEAD~1"], ["--base", "HEAD~1"]]) {
      const r = dry(repo, args);
      expect(r.out).toContain("against HEAD~1 ");
      expect(r.files).toEqual(["root tests/a/other.test.ts"]);
    }
  });

  it("--base= with no ref is refused", () => {
    const r = affected(graphRepo(), ["--dry-run", "--base="]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("--base needs a ref");
  });
});

describe("base default", () => {
  it("compares against origin/main when it exists, so commits only on local main (unpushed) are still changed", () => {
    const repo = join(tempRoot(), "repo");
    cpSync(template, repo, { recursive: true, verbatimSymlinks: true });
    git(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
    write(repo, "tests/c/late.test.ts", T(""));
    commit(repo); // on local main, ahead of origin/main
    const r = dry(repo, []);
    expect(r.out).toContain("against origin/main");
    expect(r.files).toEqual(["root tests/c/late.test.ts"]);
  });

  it("on a branch compares against local main, so an unpushed main commit is not the branch's change", () => {
    const repo = join(tempRoot(), "repo");
    cpSync(template, repo, { recursive: true, verbatimSymlinks: true });
    git(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
    write(repo, "tests/c/onMain.test.ts", T(""));
    commit(repo); // on local main, ahead of origin/main
    git(repo, "checkout", "-q", "-b", "work");
    write(repo, "tests/c/onBranch.test.ts", T(""));
    commit(repo);
    const r = dry(repo, []);
    expect(r.out).toContain("against main ");
    expect(r.files).toEqual(["root tests/c/onBranch.test.ts"]);
  });
});

// Records argv and cwd, writes the JSON result FAKE_VITEST_JSON describes (or none), exits FAKE_VITEST_EXIT.
const FAKE_VITEST = String.raw`#!/usr/bin/env node
const fs = require("fs");
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ tool: "vitest", argv: process.argv.slice(2), cwd: process.cwd() }) + "\n");
const out = process.argv.find((a) => a.startsWith("--outputFile.json="));
if (out && !process.env.FAKE_VITEST_NOJSON) fs.writeFileSync(out.slice("--outputFile.json=".length), process.env.FAKE_VITEST_JSON || JSON.stringify({ testResults: [] }));
process.exit(Number(process.env.FAKE_VITEST_EXIT || 0));
`;
const FAKE_TOOL = (name: string, exitVar: string) => String.raw`#!/usr/bin/env node
require("fs").appendFileSync(process.env.FAKE_LOG, JSON.stringify({ tool: "${name}", argv: process.argv.slice(2) }) + "\n");
process.exit(Number(process.env.${exitVar} || 0));
`;

type Call = { tool: string; argv: string[]; cwd?: string };
function runRepo(): { repo: string; log: string; calls: () => Call[] } {
  const repo = join(tempRoot(), "repo");
  mkdirSync(join(repo, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(repo, "node_modules", ".bin", "vitest"), FAKE_VITEST, { mode: 0o755 });
  // The real package, for vitest's own argument parser (vitest/node parseCLI); the binary stays the stub.
  symlinkSync(join(realModules, "vitest"), join(repo, "node_modules", "vitest"));
  writeFileSync(join(repo, "node_modules", ".bin", "tsc"), FAKE_TOOL("tsc", "FAKE_TSC_EXIT"), { mode: 0o755 });
  write(repo, "typecheck.js", FAKE_TOOL("typecheck", "FAKE_TYPECHECK_EXIT").replace("#!/usr/bin/env node\n", ""));
  write(repo, "package.json", JSON.stringify({ name: "orca-like", type: "commonjs", scripts: { typecheck: "node typecheck.js" } }) + "\n");
  write(repo, ".gitignore", "node_modules\n");
  for (const rel of ["tests/c/plain.test.ts", "web/tests/other.test.tsx", "docs/readme.md"]) write(repo, rel, GRAPH[rel]);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  const log = join(repo, "..", "calls.log");
  return { repo, log, calls: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Call) : []) };
}

describe("pass-through", () => {
  it("npm test is this script, so every plan and agent that says npm test gets the selection; the whole suite is test:all", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts.test).toBe("node scripts/test-affected.mjs");
    expect(pkg.scripts["test:all"]).toBe("vitest run");
  });

  it("a path argument runs exactly vitest run <path>, selecting nothing itself", () => {
    const { repo, log, calls } = runRepo();
    write(repo, "docs/readme.md", "# changed\n");
    const r = affected(repo, ["tests/c/plain.test.ts"], { FAKE_LOG: log });
    expect(r.code, r.out).toBe(0);
    expect(calls()).toEqual([{ tool: "vitest", argv: ["run", "tests/c/plain.test.ts"], cwd: repo }]);
  });

  it("flag-only arguments, a flag's separate value included, are forwarded to the selection's run instead", () => {
    const { repo, log, calls } = runRepo();
    write(repo, "tests/c/plain.test.ts", T("// changed"));
    const r = affected(repo, ["--base", "main", "--", "--run", "--reporter", "dot"], { FAKE_LOG: log });
    expect(r.code, r.out).toBe(0);
    const vitest = calls().filter((c) => c.tool === "vitest");
    expect(vitest.length).toBe(1);
    expect(vitest[0].argv.slice(0, 5)).toEqual(["run", "tests/c/plain.test.ts", "--run", "--reporter", "dot"]);
  });

  it("every vitest option that takes a value keeps its value, so flag-only arguments never fall to pass-through", () => {
    const { repo, log, calls } = runRepo();
    write(repo, "tests/c/plain.test.ts", T("// changed"));
    const flags = ["--maxConcurrency", "3", "--silent", "passed-only", "--coverage.reportsDirectory", "out", "--tagsFilter", "fast", "--outputFile.junit=j.xml"];
    const r = affected(repo, ["--base", "main", "--", ...flags], { FAKE_LOG: log });
    expect(r.code, r.out).toBe(0);
    expect(r.out).not.toContain("arguments name a path or filter");
    const vitest = calls().filter((c) => c.tool === "vitest");
    expect(vitest.length).toBe(1);
    expect(vitest[0].argv.slice(0, 2 + flags.length)).toEqual(["run", "tests/c/plain.test.ts", ...flags]);
  });

  it("a positional after a flag that takes no value is still a path: pass-through", () => {
    const { repo, log, calls } = runRepo();
    const r = affected(repo, ["--", "--run", "tests/c/plain.test.ts"], { FAKE_LOG: log });
    expect(r.code, r.out).toBe(0);
    expect(calls()).toEqual([{ tool: "vitest", argv: ["run", "--run", "tests/c/plain.test.ts"], cwd: repo }]);
  });
});

describe("running and exit", () => {
  const changeTest = (repo: string) => write(repo, "tests/c/plain.test.ts", T("// changed"));

  it("a failing typecheck fails the run even when vitest passes", () => {
    const { repo, log, calls } = runRepo();
    changeTest(repo);
    const r = affected(repo, ["--base", "main"], { FAKE_LOG: log, FAKE_TYPECHECK_EXIT: "1" });
    expect(r.code).not.toBe(0);
    expect(calls().map((c) => c.tool)).toEqual(["typecheck", "vitest"]);
  });

  it("a failing vitest fails the run even when the typecheck passes", () => {
    const { repo, log } = runRepo();
    changeTest(repo);
    const r = affected(repo, ["--base", "main"], { FAKE_LOG: log, FAKE_VITEST_EXIT: "1" });
    expect(r.code).not.toBe(0);
  });

  it("a vitest that leaves no JSON result does not count as green: its skips are unknown", () => {
    const { repo, log } = runRepo();
    changeTest(repo);
    const r = affected(repo, ["--base", "main"], { FAKE_LOG: log, FAKE_VITEST_NOJSON: "1" });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("vitest wrote no JSON result");
  });

  it("an empty selection never invokes vitest, prints the zero line, and still runs the typecheck", () => {
    const { repo, log, calls } = runRepo();
    write(repo, "docs/readme.md", "# changed\n");
    const r = affected(repo, ["--base", "main"], { FAKE_LOG: log, FAKE_TYPECHECK_EXIT: "1" });
    expect(r.out).toContain("\ntest-affected: 0 test files selected (no changes against main select any)\n");
    expect(calls().map((c) => c.tool)).toEqual(["typecheck"]);
    expect(r.code).not.toBe(0);
  });

  it("web tests run from the web workspace with web-relative paths, after the root and web typechecks", () => {
    const { repo, log, calls } = runRepo();
    write(repo, "web/tests/other.test.tsx", T("// changed"));
    const r = affected(repo, ["--base", "main"], { FAKE_LOG: log });
    expect(r.code, r.out).toBe(0);
    const seen = calls();
    expect(seen.map((c) => c.tool)).toEqual(["typecheck", "tsc", "vitest"]);
    expect(seen[1].argv).toEqual(["--noEmit", "-p", "web/tsconfig.json"]);
    expect(seen[2].cwd).toBe(join(repo, "web"));
    expect(seen[2].argv[1]).toBe("tests/other.test.tsx");
  });
});

describe("skip report", () => {
  it("a selected file that skips tests is named with its count", () => {
    const { repo, log } = runRepo();
    write(repo, "tests/c/plain.test.ts", T("// changed"));
    const json = JSON.stringify({
      testResults: [{ name: join(repo, "tests/c/plain.test.ts"), assertionResults: [{ status: "passed" }, { status: "skipped" }, { status: "skipped" }, { status: "todo" }] }],
    });
    const r = affected(repo, ["--base", "main"], { FAKE_LOG: log, FAKE_VITEST_JSON: json });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("test-affected: 3 skipped tests\n  tests/c/plain.test.ts: 3 skipped\n");
  });
});
