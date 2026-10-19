#!/usr/bin/env node
// Spec 2026-10-20 §4.1 (human ruling, session f3a75a90): `npm test` runs the tests a change touches, chosen by code
// (CLAUDE.md Rule 5), and says what it chose and why. The whole root suite is `npm run test:all`; the full gate is the
// release gate (`npm run verify`, spec §4.2).
//
//   node scripts/test-affected.mjs [--base <ref>] [--dry-run] [-- <vitest args>]
//
// Changed files = `git diff <base>...HEAD` + staged + unstaged + untracked; <base> defaults to origin/main, else main.
// Every selected file carries its reason; zero selected files is printed as zero, never run as green. A test that
// reaches changed code only through a spawned process outside the mirror directory, or reads a changed file as text not
// in TEXT_READERS, is not selected (accepted, spec §4.1) -- the release gate still runs it.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT_TEST = /^tests\/.+\.test\.ts$/;
const WEB_TEST = /^web\/tests\/.+\.test\.tsx?$/;
// Never fed to `related` (vitest would turn them into a full run silently); they select the whole suite explicitly.
const isRootConfig = (p) =>
  ["package.json", "package-lock.json", "vitest.config.ts"].includes(p) || /^tsconfig[^/]*\.json$/.test(p) || p.startsWith("tests/setup/");
const WEB_CONFIG = new Set(["web/package.json", "web/vite.config.ts", "web/tsconfig.json"]);
// Text read by tests, which no module graph can see. A short explicit table; anything else read as text is a known gap.
const TEXT_READERS = [["skills/", "tests/entry/"], [".decisions/", "tests/ledger/validateFile.test.ts"]];
// vitest flags whose value is a separate argument, so that value is not mistaken for a path or filter.
const VALUE_FLAGS = new Set([
  "--reporter", "--outputFile", "--maxWorkers", "--minWorkers", "-t", "--testNamePattern", "--project", "--shard",
  "--pool", "--environment", "--retry", "--bail", "--testTimeout", "--hookTimeout", "--seed", "--sequence.seed",
  "-c", "--config", "-r", "--root", "--dir", "--exclude", "--mode",
]);

function fail(message) {
  console.error(`test-affected: ${message}`);
  process.exit(1);
}

const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
if (top.status !== 0) fail(`not inside a git repository: ${top.stderr.trim()}`);
const root = top.stdout.trim();
const vitestBin = join(root, "node_modules", ".bin", "vitest");

function git(args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (r.status !== 0) fail(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout;
}

// --- arguments --------------------------------------------------------------------------------------------------
let base;
let dryRun = false;
const vitestArgs = [];
{
  const argv = process.argv.slice(2);
  let forwarded = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (forwarded) vitestArgs.push(a);
    else if (a === "--") forwarded = true;
    else if (a === "--base") {
      base = argv[++i];
      if (!base) fail("--base needs a ref");
    } else if (a === "--dry-run") dryRun = true;
    else vitestArgs.push(a);
  }
}

function namesPathOrFilter(args) {
  for (let i = 0; i < args.length; i += 1) {
    if (!args[i].startsWith("-")) return true;
    if (VALUE_FLAGS.has(args[i])) i += 1;
  }
  return false;
}

// Pass-through: `npm test -- tests/x.test.ts` keeps meaning "run only this".
if (namesPathOrFilter(vitestArgs)) {
  console.log(`test-affected: the arguments name a path or filter; running exactly: vitest run ${vitestArgs.join(" ")}`);
  const r = spawnSync(vitestBin, ["run", ...vitestArgs], { cwd: root, stdio: "inherit" });
  if (r.error) console.error(r.error);
  process.exit(r.status ?? 1);
}

// --- changed paths ----------------------------------------------------------------------------------------------
const hasRef = (ref) => spawnSync("git", ["rev-parse", "--verify", "--quiet", ref], { cwd: root }).status === 0;
if (base === undefined) {
  if (hasRef("refs/remotes/origin/main")) base = "origin/main";
  else if (hasRef("refs/heads/main")) base = "main";
  else fail("neither origin/main nor main exists; pass --base <ref>");
}

// `--name-status -z`: a status token, then one path, or two for a rename/copy (both kept: the old path is gone).
function nameStatusPaths(out) {
  const tokens = out.split("\0");
  const paths = [];
  for (let i = 0; i < tokens.length - 1; ) {
    const status = tokens[i++];
    paths.push(tokens[i++]);
    if (status.startsWith("R") || status.startsWith("C")) paths.push(tokens[i++]);
  }
  return paths;
}

const changed = [...new Set([
  ...nameStatusPaths(git(["diff", "--name-status", "-z", "-M", `${base}...HEAD`])),
  ...nameStatusPaths(git(["diff", "--name-status", "-z", "-M", "--cached"])),
  ...nameStatusPaths(git(["diff", "--name-status", "-z", "-M"])),
  ...git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean),
])].sort();

// --- rules ------------------------------------------------------------------------------------------------------
function listTests(rel, pattern) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return [];
  if (!statSync(abs).isDirectory()) return pattern.test(rel) ? [rel] : [];
  const out = [];
  for (const entry of readdirSync(abs, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = relative(root, join(entry.parentPath, entry.name));
    if (pattern.test(file)) out.push(file);
  }
  return out;
}

// src/<dir>/... and tests/<dir>/... => tests/<dir>/; top-level src/*.ts => tests/entry/; scripts/... => tests/scripts/.
function mirror(p) {
  const parts = p.split("/");
  if (parts[0] === "scripts") return "tests/scripts/";
  if (parts[0] === "src") return parts.length === 2 ? "tests/entry/" : `tests/${parts[1]}/`;
  return parts.length > 2 ? `tests/${parts[1]}/` : null;
}

const selection = { root: new Map(), web: new Map() };
const selecting = new Set();
function select(suite, files, reason, path) {
  for (const file of files) {
    if (!selection[suite].has(file)) selection[suite].set(file, []);
    selection[suite].get(file).push(reason);
    selecting.add(path);
  }
}

const relatedRoot = [];
const relatedWeb = [];
let webTypecheck = false;
for (const p of changed) {
  if (p.startsWith("web/") || p === "src/control/webProtocol.ts") webTypecheck = true;
  const present = existsSync(join(root, p));
  if (isRootConfig(p)) select("root", listTests("tests", ROOT_TEST), `${p} (config: whole suite)`, p);
  else if (WEB_CONFIG.has(p)) select("web", listTests("web/tests", WEB_TEST), `${p} (config: whole web suite)`, p);
  else if (/^(src|tests|scripts)\//.test(p)) {
    const dir = mirror(p);
    // A deleted or renamed-away module has no importers left in the graph: its mirror directory only.
    if (!present) { if (dir) select("root", listTests(dir, ROOT_TEST), `${p} (gone: mirror ${dir})`, p); }
    else if (ROOT_TEST.test(p)) select("root", [p], `${p} (changed test)`, p);
    else {
      relatedRoot.push(p);
      if (dir) select("root", listTests(dir, ROOT_TEST), `${p} (mirror ${dir})`, p);
    }
  } else if (/^web\/(src|tests)\//.test(p)) {
    // A gone web module selects nothing by graph; the web typecheck (always run for web/**) covers its importers.
    if (present && WEB_TEST.test(p)) select("web", [p], `${p} (changed test)`, p);
    else if (present) {
      relatedWeb.push(p);
      relatedRoot.push(p); // root tests import web/src by value (tests/panel/webParity.test.ts)
    }
  } else {
    const reader = TEXT_READERS.find(([prefix]) => p.startsWith(prefix));
    if (reader) select("root", listTests(reader[1], ROOT_TEST), `${p} (read as text by ${reader[1]})`, p);
  }
}

// vitest's `related`, through its node API: the test files that statically import a changed file, transitively.
async function related(projectRoot, suite, paths) {
  if (paths.length === 0) return;
  const require = createRequire(join(root, "package.json"));
  const { createVitest } = await import(pathToFileURL(require.resolve("vitest/node")).href);
  const configFile = join(projectRoot, suite === "web" ? "vite.config.ts" : "vitest.config.ts");
  const ctx = await createVitest("test", { root: projectRoot, config: configFile, watch: false });
  try {
    for (const p of paths) {
      ctx.config.related = [join(root, p)];
      const specs = await ctx.getRelevantTestSpecifications();
      select(suite, specs.map((s) => relative(root, s.moduleId)), `${p} (imported)`, p);
    }
  } finally {
    await ctx.close();
  }
}
await related(root, "root", relatedRoot);
await related(join(root, "web"), "web", relatedWeb);

// --- report the selection ---------------------------------------------------------------------------------------
const rootFiles = [...selection.root.keys()].sort();
const webFiles = [...selection.web.keys()].sort();
console.log(`test-affected: ${changed.length} changed paths against ${base} (committed since the merge base, staged, unstaged, untracked)`);
for (const [suite, files] of [["root", rootFiles], ["web", webFiles]]) {
  for (const file of files) console.log(`  ${suite} ${file} <- ${selection[suite].get(file).join("; ")}`);
}
const idle = changed.filter((p) => !selecting.has(p));
if (idle.length) console.log(`test-affected: changed paths that select no test: ${idle.join(", ")}`);
const empty = rootFiles.length + webFiles.length === 0;
if (empty) console.log(`test-affected: 0 test files selected (no changes against ${base} select any)`);
else console.log(`test-affected: ${rootFiles.length + webFiles.length} test files selected (${rootFiles.length} root, ${webFiles.length} web)`);
const typechecks = [["npm", ["run", "typecheck"]]];
if (webTypecheck) typechecks.push([join(root, "node_modules", ".bin", "tsc"), ["--noEmit", "-p", "web/tsconfig.json"]]);
console.log(`test-affected: typecheck: ${typechecks.map(([cmd, args]) => [relative(root, cmd) || cmd, ...args].join(" ")).join(" ; ")}`);
if (dryRun) process.exit(0);

// --- run --------------------------------------------------------------------------------------------------------
// Type-only imports are invisible to the module graph; the typecheck always runs, even when nothing is selected.
const statuses = [];
for (const [cmd, args] of typechecks) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit" });
  if (r.error) console.error(r.error);
  statuses.push(r.status ?? 1);
}

const skipped = [];
const userReporter = vitestArgs.some((a) => a === "--reporter" || a.startsWith("--reporter="));
function runVitest(cwd, files) {
  const scratch = mkdtempSync(join(tmpdir(), "test-affected-"));
  const result = join(scratch, "result.json");
  try {
    const reporters = [...(userReporter ? [] : ["--reporter=default"]), "--reporter=json", `--outputFile.json=${result}`];
    const r = spawnSync(vitestBin, ["run", ...files, ...vitestArgs, ...reporters], { cwd, stdio: "inherit" });
    if (r.error) console.error(r.error);
    let status = r.status ?? 1;
    if (!existsSync(result)) {
      // Without the result the skips cannot be reported, so the run cannot count as green (Rule 12).
      console.error(`test-affected: vitest wrote no JSON result in ${relative(root, cwd) || "."}; skips unknown`);
      return status || 1;
    }
    for (const file of JSON.parse(readFileSync(result, "utf8")).testResults ?? []) {
      const n = (file.assertionResults ?? []).filter((t) => t.status === "skipped" || t.status === "todo").length;
      if (n) skipped.push([relative(root, file.name), n]);
    }
    return status;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
if (rootFiles.length) statuses.push(runVitest(root, rootFiles));
if (webFiles.length) statuses.push(runVitest(join(root, "web"), webFiles.map((f) => relative("web", f))));

if (!empty) {
  // A skip is reported, not hidden: this is how a missing ORCA_CCLOOP_BIN / ORCA_AGENTS_TABLE shows up.
  console.log(`test-affected: ${skipped.reduce((sum, [, n]) => sum + n, 0)} skipped tests`);
  for (const [file, n] of skipped) console.log(`  ${file}: ${n} skipped`);
}
process.exit(statuses.find((s) => s !== 0) ?? 0);
