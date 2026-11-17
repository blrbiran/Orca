#!/usr/bin/env node
// Spec 2026-10-20 §4.1 (human ruling, session f3a75a90): `npm test` runs the tests a change touches, chosen by code
// (CLAUDE.md Rule 5), and says what it chose and why. The whole root suite is `npm run test:all`; the full gate is the
// release gate (`npm run verify`, spec §4.2).
//
//   node scripts/test-affected.mjs [--base <ref>] [--dry-run] [-- <vitest args>]
//
// Changed files = `git diff <base>...HEAD` + staged + unstaged + untracked; <base> defaults to origin/main, else main.
// Every selected file carries its reason; zero selected files is printed as zero, never run as green. A test that
// reaches changed code only through a spawned process outside the mirror directory, or reads a changed file outside
// tests/ and web/tests/ as text not in TEXT_READERS, is not selected (accepted, spec §4.1) -- the release gate still
// runs it. A data file under tests/ or web/tests/ selects the tests and helpers that name it, else the whole suite.
//
// Tiers (spec 2026-10-20 §11, human ruling session 2026-11-17 evening, 「测试精简点头同意」; CLAUDE.md Rule 18):
//   (default) the QUICK tier, per patch set: changed test files, the mirror directory (above MIRROR_MAX test files, only
//             its tests named after the changed module; spec §12), tests that import a changed file
//             directly (distance 1, type-only imports dropped), and the catalogue tables when errors.ts or a locale
//             changes. Files whose recorded duration (vitest's results cache) is >= 30 s, and tests that run the real
//             ccloop, are deferred -- printed with their reason -- unless the file itself changed. A suite with no
//             results cache falls back to the wide selection, said out loud. It is not the merge gate.
//   --wide    the WIDE tier (`npm run test:wide`), once per merge batch into main: the selection above this comment
//             describes, unchanged (transitive importers through vitest's `related`, nothing deferred). Green on a clean
//             tree stamps `git rev-parse HEAD^{tree}` under <git-common-dir>/orca-gate/green/; a wide run on a stamped
//             tree prints that and exits 0 without running, unless --force.
//   --rerun-failed  re-runs only the failed files of the last run's JSON report (<git-dir>/orca-gate/last-run.json),
//             labelled as a re-run, not a gate.
// Every run (not --dry-run) holds a machine-wide lock (/tmp/orca-gate-<uid>.lock, or ORCA_GATE_LOCK), prints `uptime`
// at start and end, and builds web/dist first when a selected test serves the panel and web/dist is missing or stale.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT_TEST = /^tests\/.+\.test\.ts$/;
const WEB_TEST = /^web\/tests\/.+\.test\.tsx?$/;
// Never fed to `related` (vitest would turn them into a full run silently); they select the whole suite explicitly.
// package.json stays whole even when only `scripts` changed: tests spawn `npm run <name>` and read the scripts as text,
// and no code here can prove a script entry is outside every test's reach.
const isRootConfig = (p) =>
  ["package.json", "package-lock.json", "vitest.config.ts"].includes(p) || /^tsconfig[^/]*\.json$/.test(p) || p.startsWith("tests/setup/");
// web/tests/setup.ts is web/vite.config.ts's setupFiles entry: it runs before every web test.
const WEB_CONFIG = new Set(["web/package.json", "web/vite.config.ts", "web/tsconfig.json", "web/tests/setup.ts"]);
// Text read by tests, which no module graph can see. A short explicit table; anything else read as text is a known gap.
const TEXT_READERS = [["skills/", "tests/entry/"], [".decisions/", "tests/ledger/validateFile.test.ts"], ["flows/", "tests/flow/"]];
const CODE = /\.[cm]?[jt]sx?$/;
// A file's relative imports (static and dynamic), each as the repo paths it may name (`.js` written for a `.ts` source).
const RELATIVE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'`](\.{1,2}\/[^"'`]+)["'`]/g;
function directImports(file, text) {
  const out = [];
  for (const [, spec] of text.matchAll(RELATIVE_IMPORT)) {
    const target = relative(root, join(root, file, "..", spec));
    out.push(target, ...[".ts", ".tsx"].map((ext) => target.replace(/\.[cm]?js$/, ext)));
  }
  return out;
}

function fail(message) {
  console.error(`test-affected: ${message}`);
  process.exit(1);
}

const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
if (top.status !== 0) fail(`not inside a git repository: ${top.stderr.trim()}`);
const root = top.stdout.trim();
const vitestBin = join(root, "node_modules", ".bin", "vitest");
const vitestNode = () => import(pathToFileURL(createRequire(join(root, "package.json")).resolve("vitest/node")).href);

function git(args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (r.status !== 0) fail(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout;
}

// --- arguments --------------------------------------------------------------------------------------------------
let base;
let dryRun = false;
let wide = false;
let force = false;
let rerunFailed = false;
const vitestArgs = [];
{
  const argv = process.argv.slice(2);
  let forwarded = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (forwarded) vitestArgs.push(a);
    else if (a === "--") forwarded = true;
    else if (a === "--base" || a.startsWith("--base=")) {
      base = a === "--base" ? argv[++i] : a.slice("--base=".length);
      if (!base) fail("--base needs a ref");
    } else if (a === "--dry-run") dryRun = true;
    else if (a === "--wide") wide = true;
    else if (a === "--force") force = true;
    else if (a === "--rerun-failed") rerunFailed = true;
    else vitestArgs.push(a);
  }
  if (rerunFailed && (wide || dryRun || base !== undefined)) fail("--rerun-failed takes no --wide, --dry-run or --base: it re-runs the last report's failed files");
}

// vitest's own parser decides which arguments are filters, so every option's value (`--maxConcurrency 3`,
// `--silent passed-only`, `--coverage.reportsDirectory out`) is read exactly as `vitest run` itself would read it.
async function namesPathOrFilter(args) {
  if (args.length === 0) return false;
  return (await vitestNode()).parseCLI(["vitest", "run", ...args]).filter.length > 0;
}

// A fixed per-user path, not os.tmpdir(): sessions run with different TMPDIRs and must still see one lock. The tests a
// gate runs get a nested lock of their own (childEnv): a test of this script spawns it again, and with the one path that
// nested run waited on its own parent forever (session 2026-11-17, a wide gate hung on testAffected.test.ts).
const lockPath = process.env.ORCA_GATE_LOCK || join("/tmp", `orca-gate-${process.getuid?.() ?? "user"}.lock`);
const childEnv = { ...process.env, ORCA_GATE_LOCK: `${lockPath}.nested-${process.pid}` };

// Pass-through: `npm test -- tests/x.test.ts` keeps meaning "run only this".
if (await namesPathOrFilter(vitestArgs)) {
  console.log(`test-affected: the arguments name a path or filter; running exactly: vitest run ${vitestArgs.join(" ")}`);
  const r = spawnSync(vitestBin, ["run", ...vitestArgs], { cwd: root, stdio: "inherit", env: childEnv });
  if (r.error) console.error(r.error);
  process.exit(r.status ?? 1);
}

// --- gate machinery: report, stamp, lock, load, web/dist ------------------------------------------------------------
// The report is per worktree (two worktrees must not read each other's failures); the green stamp is per repository (a
// tree gated in a branch worktree is the same tree on main after `merge --ff-only`).
const gitDir = resolve(root, git(["rev-parse", "--git-dir"]).trim());
const reportDir = join(gitDir, "orca-gate");
const lastRunPath = join(reportDir, "last-run.json");
const stampDir = join(resolve(root, git(["rev-parse", "--git-common-dir"]).trim()), "orca-gate", "green");
const treeClean = () => git(["status", "--porcelain", "--untracked-files=all"]).length === 0;
const headTree = () => git(["rev-parse", "HEAD^{tree}"]).trim();

function uptime(when) {
  const r = spawnSync("uptime", { encoding: "utf8" });
  console.log(`test-affected: load at ${when}: ${r.status === 0 ? r.stdout.trim() : "uptime unavailable"}`);
}

// One gate at a time on the machine: parallel gates multiplied the load flakes (docs/handoff/known-load-flakes.md).
// The lock is a file holding the owner's pid; a lock whose pid is dead is stale and taken over. The tests a gate runs
// get their own nested lock path (childEnv above), so a test that runs this script never waits on its parent.
function lockHolder() {
  try { return JSON.parse(readFileSync(lockPath, "utf8")); } catch { return null; }
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}
function releaseLock() {
  if (lockHolder()?.pid === process.pid) rmSync(lockPath, { force: true });
}
async function acquireLock() {
  let announced = false;
  for (;;) {
    try {
      writeFileSync(lockPath, JSON.stringify({ pid: process.pid, root, at: new Date().toISOString() }) + "\n", { flag: "wx", mode: 0o600 });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") fail(`cannot create the gate lock ${lockPath}: ${error.message}`);
    }
    const holder = lockHolder();
    let age = 0;
    try { age = Date.now() - statSync(lockPath).mtimeMs; } catch { continue; } // released between the two calls
    // An unparsable lock younger than 5 s is one being written right now, not a stale one.
    if (holder === null ? age > 5000 : !Number.isInteger(holder.pid) || !alive(holder.pid)) {
      console.log(`test-affected: removing a stale gate lock ${lockPath} (${holder === null ? "unreadable" : `pid ${holder.pid} is not running`})`);
      rmSync(lockPath, { force: true });
      continue;
    }
    if (!announced && holder !== null) {
      console.log(`test-affected: waiting: another gate holds the machine-wide lock ${lockPath} (pid ${holder.pid}, ${holder.root}, since ${holder.at})`);
      announced = true;
    }
    await sleep(2000);
  }
  if (announced) console.log("test-affected: the gate lock is free; running");
  process.on("exit", releaseLock);
  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) process.on(signal, () => process.exit(code));
}

// A selected test that serves the panel reads web/dist (src/panel/staticFiles.ts refuses with panel-dist-missing when it
// is absent): 138 false reds in one re-run from a new worktree (survey 2026-11-17 §6). Such a test is under tests/panel/
// or web/tests/, or names the panel server entry points, or directly imports a helper that does.
const SERVES_PANEL = /\b(?:createPanelServer|startPanelFromArgs|loadStaticFiles)\b|panel\/server\.js/;
function servesPanel(files) {
  const texts = new Map(listTests("tests", CODE).map((f) => [f, readFileSync(join(root, f), "utf8")]));
  const helpers = new Set([...texts].filter(([f, text]) => !ROOT_TEST.test(f) && SERVES_PANEL.test(text)).map(([f]) => f));
  return files.find((f) => /^(tests\/panel|web\/tests)\//.test(f) ||
    (texts.has(f) && (SERVES_PANEL.test(texts.get(f)) || directImports(f, texts.get(f)).some((t) => helpers.has(t)))));
}
function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) newest = Math.max(newest, statSync(join(entry.parentPath, entry.name)).mtimeMs);
  }
  return newest;
}
function ensureWebDist(files) {
  const needing = servesPanel(files);
  if (!needing) return 0;
  const index = join(root, "web", "dist", "index.html");
  const src = join(root, "web", "src");
  const why = !existsSync(index) ? "web/dist is missing" : existsSync(src) && statSync(index).mtimeMs < newestMtime(src) ? "web/dist is older than web/src" : null;
  if (why === null) return 0;
  let webPkg = {};
  try { webPkg = JSON.parse(readFileSync(join(root, "web", "package.json"), "utf8")); } catch { /* no web workspace */ }
  if (!webPkg.scripts?.build) {
    console.log(`test-affected: ${why} and ${needing} serves the panel, but web/package.json has no build script; not building`);
    return 0;
  }
  console.log(`test-affected: ${why} and ${needing} serves the panel: running npm run build --workspace web first`);
  const r = spawnSync("npm", ["run", "build", "--workspace", "web"], { cwd: root, stdio: "inherit" });
  if (r.error) console.error(r.error);
  return r.status ?? 1;
}

const skipped = [];
const userReporter = vitestArgs.some((a) => a === "--reporter" || a.startsWith("--reporter="));
// vitest's JSON result goes to a known path under the git dir, kept after the run: it is what --rerun-failed reads.
function runVitest(suite, cwd, files) {
  const result = join(reportDir, `last-run.${suite}.json`);
  rmSync(result, { force: true });
  const reporters = [...(userReporter ? [] : ["--reporter=default"]), "--reporter=json", `--outputFile.json=${result}`];
  const r = spawnSync(vitestBin, ["run", ...files, ...vitestArgs, ...reporters], { cwd, stdio: "inherit", env: childEnv });
  if (r.error) console.error(r.error);
  const status = r.status ?? 1;
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
}

// Runs typechecks and the two suites under the lock, writes last-run.json, returns the exit status.
async function runSelection(kind, rootFiles, webFiles, typechecks) {
  mkdirSync(reportDir, { recursive: true, mode: 0o700 });
  await acquireLock();
  uptime("start");
  const statuses = [];
  const built = ensureWebDist([...rootFiles, ...webFiles]);
  if (built !== 0) {
    console.error("test-affected: npm run build --workspace web failed; not running the tests (they would fail on panel-dist-missing)");
    statuses.push(built);
  } else {
    // Type-only imports are invisible to the module graph; the typecheck always runs, even when nothing is selected.
    for (const [cmd, args] of typechecks) {
      const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit" });
      if (r.error) console.error(r.error);
      statuses.push(r.status ?? 1);
    }
  }
  const typecheckStatus = statuses.find((s) => s !== 0) ?? 0;
  const suites = {};
  if (built === 0) {
    if (rootFiles.length) suites.root = { files: rootFiles, status: runVitest("root", root, rootFiles) };
    if (webFiles.length) suites.web = { files: webFiles, status: runVitest("web", join(root, "web"), webFiles.map((f) => relative("web", f))) };
  }
  for (const s of Object.values(suites)) statuses.push(s.status);
  const status = statuses.find((s) => s !== 0) ?? 0;
  writeFileSync(lastRunPath, JSON.stringify({ kind, at: new Date().toISOString(), head: git(["rev-parse", "HEAD"]).trim(), base: base ?? null, status, typecheckStatus, suites }, null, 2) + "\n");
  if (rootFiles.length + webFiles.length) {
    // A skip is reported, not hidden: this is how a missing ORCA_CCLOOP_BIN / ORCA_AGENTS_TABLE shows up.
    console.log(`test-affected: ${skipped.reduce((sum, [, n]) => sum + n, 0)} skipped tests`);
    for (const [file, n] of skipped) console.log(`  ${file}: ${n} skipped`);
  }
  console.log(`test-affected: JSON report: ${lastRunPath} (vitest results beside it: last-run.root.json, last-run.web.json)`);
  uptime("end");
  return status;
}

// --- --rerun-failed ----------------------------------------------------------------------------------------------
if (rerunFailed) {
  if (!existsSync(lastRunPath)) fail(`--rerun-failed: no report of a last run at ${lastRunPath}; run npm test or npm run test:wide first`);
  const last = JSON.parse(readFileSync(lastRunPath, "utf8"));
  const failed = { root: [], web: [] };
  for (const [suite, entry] of Object.entries(last.suites ?? {})) {
    if (entry.status === 0) continue;
    const result = join(reportDir, `last-run.${suite}.json`);
    if (!existsSync(result)) fail(`--rerun-failed: the last run's ${suite} suite failed but left no vitest JSON at ${result}; cannot tell which files failed`);
    const reported = JSON.parse(readFileSync(result, "utf8")).testResults ?? [];
    const seen = new Set(reported.map((t) => relative(root, t.name)));
    failed[suite].push(...reported.filter((t) => t.status === "failed").map((t) => relative(root, t.name)));
    // A file the run selected but vitest never reported (a worker crash) failed as far as anyone can tell.
    failed[suite].push(...entry.files.filter((f) => !seen.has(f)));
  }
  console.log(`test-affected: --rerun-failed: a re-run of failed files, not a gate (last run: ${last.kind}, ${last.at}, HEAD ${last.head})`);
  if (last.typecheckStatus !== 0) console.log("test-affected: the last run's typecheck failed; a re-run does not repeat it: run npm run typecheck");
  const files = { root: [...new Set(failed.root)].sort(), web: [...new Set(failed.web)].sort() };
  for (const suite of ["root", "web"]) for (const f of files[suite]) console.log(`  rerun ${suite} ${f}`);
  console.log(`test-affected: ${files.root.length + files.web.length} failed files to re-run (${files.root.length} root, ${files.web.length} web)`);
  if (files.root.length + files.web.length === 0) process.exit(last.typecheckStatus === 0 ? 0 : 1);
  const status = await runSelection("rerun-failed", files.root, files.web, []);
  console.log(`test-affected: that was a re-run of failed files, not a gate (exit ${status})`);
  process.exit(status);
}

// --- the green stamp ---------------------------------------------------------------------------------------------
// Checked before any selection work: an identical tree is never gated twice (session 2026-11-17 evening ruling).
const startClean = !dryRun && wide && treeClean();
const startTree = startClean ? headTree() : null;
if (startTree && existsSync(join(stampDir, startTree))) {
  const stamp = readFileSync(join(stampDir, startTree), "utf8").trim();
  if (!force) {
    console.log(`test-affected: tree ${startTree} was already gated green by a wide run (${stamp}); not running it again. --force runs it anyway`);
    process.exit(0);
  }
  console.log(`test-affected: tree ${startTree} was already gated green (${stamp}); --force: running it again`);
}

// --- changed paths ----------------------------------------------------------------------------------------------
const hasRef = (ref) => spawnSync("git", ["rev-parse", "--verify", "--quiet", ref], { cwd: root }).status === 0;
// On a branch other than main the work is what the branch adds to local main, so an unpushed main commit (a repin's
// lockfile) does not select the whole suite on every branch cut from it; on main itself the base is origin/main, so
// push and installing the panel service still see the commits they are about to ship.
const branch = spawnSync("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
if (base === undefined) {
  if (branch !== "main" && hasRef("refs/heads/main")) base = "main";
  else if (hasRef("refs/remotes/origin/main")) base = "origin/main";
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

// Data read as text from tests/ or web/tests/: the suite's test files and helpers that name it, by its basename as a
// whole quoted name or path segment ("golden.json", ".../golden.json", not "hook-golden.json"). Paths are mostly built
// from segments (join(here, "..", "fixtures", "golden.json")), so the basename is what a source reliably contains.
const sources = new Map();
function namedBy(suite, p) {
  const dir = suite === "web" ? "web/tests" : "tests";
  if (!sources.has(dir)) {
    sources.set(dir, listTests(dir, CODE).map((f) => [f, readFileSync(join(root, f), "utf8")]));
  }
  const name = p.slice(p.lastIndexOf("/") + 1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const token = new RegExp(`["'\`/]${name}["'\`]`);
  return sources.get(dir).filter(([f, text]) => f !== p && token.test(text)).map(([f]) => f);
}

// A ccloop repin (plan 2026-11-10-tester-followup-b T9, ruling R6): when package.json differs from the merge base only in
// dependencies.ccloop and package-lock.json only in its root entry's ccloop line and ccloop's own entries (the shape
// scripts/pin-ccloop.mjs checks), the two files select only the tests that run the real ccloop instead of the whole suite.
// Any other difference keeps them whole-suite config.
// Tester follow-up I (2026-11-13, human: 「点头改」): "run the real ccloop" is decided by code, not by naming ccloop. The
// real binary enters a test only as the value of process.env.ORCA_CCLOOP_BIN, so a file reads it (an assignment or a
// delete is not a read), or imports, directly, a helper under tests/ or web/tests/ that reads it (ccloopWorld's
// realBinary, the scheduler sandbox). Naming ccloop selected ~500 files: shared fixtures carry a fake `ccloopBin` field and
// the module graph is transitive, so every importer of web.ts or driverHarness.ts ran on a repin.
const READS_REAL_CCLOOP = /(?<!delete\s+)\bprocess\.env\.ORCA_CCLOOP_BIN\b(?!\s*=(?!=))/;
const realCcloop = new Map();
function realCcloopTests(suite) {
  if (!realCcloop.has(suite)) {
    const [dir, pattern] = suite === "web" ? ["web/tests", WEB_TEST] : ["tests", ROOT_TEST];
    const texts = listTests(dir, CODE).map((f) => [f, readFileSync(join(root, f), "utf8")]);
    const readers = new Set(texts.filter(([, text]) => READS_REAL_CCLOOP.test(text)).map(([f]) => f));
    const rows = [];
    for (const [f, text] of texts) {
      if (!pattern.test(f)) continue;
      const via = readers.has(f) ? null : directImports(f, text).find((target) => readers.has(target));
      if (readers.has(f)) rows.push([f, "reads ORCA_CCLOOP_BIN"]);
      else if (via) rows.push([f, `imports ${via}, which reads ORCA_CCLOOP_BIN`]);
    }
    realCcloop.set(suite, rows);
  }
  return realCcloop.get(suite);
}
const ccloopOwn = (key) => key === "node_modules/ccloop" || key.startsWith("node_modules/ccloop/");
function withoutCcloop(manifest) {
  const copy = structuredClone(manifest ?? {});
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) delete copy[field]?.ccloop;
  return copy;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function ccloopPinOnly() {
  const mergeBase = spawnSync("git", ["merge-base", base, "HEAD"], { cwd: root, encoding: "utf8" });
  if (mergeBase.status !== 0) return false;
  const at = (path) => {
    const r = spawnSync("git", ["show", `${mergeBase.stdout.trim()}:${path}`], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });
    return r.status === 0 ? JSON.parse(r.stdout) : null;
  };
  try {
    const [pkgBefore, lockBefore] = [at("package.json"), at("package-lock.json")];
    const pkgNow = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const lockNow = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
    if (!pkgBefore || !lockBefore || !same(withoutCcloop(pkgBefore), withoutCcloop(pkgNow))) return false;
    const { packages: before = {}, ...lockRestBefore } = lockBefore;
    const { packages: after = {}, ...lockRestNow } = lockNow;
    if (!same(lockRestBefore, lockRestNow)) return false;
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].every((key) =>
      ccloopOwn(key) || (key === "" ? same(withoutCcloop(before[key]), withoutCcloop(after[key])) : same(before[key], after[key])));
  } catch {
    return false;
  }
}
const PIN_FILES = new Set(["package.json", "package-lock.json"]);
const pinOnly = changed.some((p) => PIN_FILES.has(p)) && ccloopPinOnly();

// The tier is known before the rules run: a large mirror directory is narrowed in a quick root suite only.
const durations = { root: wide ? null : recordedDurations("root"), web: wide ? null : recordedDurations("web") };
const quick = { root: durations.root !== null, web: durations.web !== null };

// [file whose importers to find, the changed path it stands for]
const relatedRoot = [];
const relatedWeb = [];
const dataFiles = [];
let webTypecheck = false;

// A large mirror directory in the quick tier (spec 2026-10-20 §12; human ruling 2026-11-18, 「同意」, session 4389b15f):
// one src/control change selected tests/control whole, 374-494 files and 408-508 s per run, while the whole wide tier
// is 799 files. Above MIRROR_MAX test files the mirror selects only the tests named after the changed module (its
// basename as a file-name prefix, anywhere in the directory); the direct importers, changed tests, data and catalogue
// rows still apply. A gone module also selects the tests that still import it. The wide tier selects the whole mirror.
const MIRROR_MAX = 60;
const narrowed = new Map(); // changed path -> the large mirror directory it did not select whole
function selectMirror(p, dir, label) {
  const tests = listTests(dir, ROOT_TEST);
  if (!quick.root || tests.length <= MIRROR_MAX) return select("root", tests, `${p} (${label}${dir})`, p);
  narrowed.set(p, dir);
  const stem = p.slice(p.lastIndexOf("/") + 1).replace(/(\.test)?\.[^.]+$/, "");
  const named = stem ? tests.filter((f) => f.slice(f.lastIndexOf("/") + 1).startsWith(stem)) : [];
  select("root", named, `${p} (name match in ${dir}: ${tests.length} tests > ${MIRROR_MAX}, not the whole mirror)`, p);
}
for (const p of changed) {
  if (p.startsWith("web/") || p === "src/control/webProtocol.ts") webTypecheck = true;
  const present = existsSync(join(root, p));
  if (pinOnly && PIN_FILES.has(p)) {
    for (const suite of ["root", "web"]) {
      for (const [f, why] of realCcloopTests(suite)) select(suite, [f], `${p} (ccloop pin only: ${why})`, p);
    }
  } else if (isRootConfig(p)) select("root", listTests("tests", ROOT_TEST), `${p} (config: whole suite)`, p);
  else if (WEB_CONFIG.has(p)) select("web", listTests("web/tests", WEB_TEST), `${p} (config: whole web suite)`, p);
  else if (/^(src|tests|scripts)\//.test(p)) {
    const dir = mirror(p);
    if (p.startsWith("tests/") && !CODE.test(p)) dataFiles.push(["root", p]);
    // A deleted or renamed-away module has no importers left in the graph: its mirror directory only (narrowed: above).
    if (!present) {
      if (dir) selectMirror(p, dir, "gone: mirror ");
      if (narrowed.has(p)) relatedRoot.push([p, p]); // quick tier only: the text scan still finds its importers
    } else if (ROOT_TEST.test(p)) select("root", [p], `${p} (changed test)`, p);
    else {
      relatedRoot.push([p, p]);
      if (dir) selectMirror(p, dir, "mirror ");
    }
  } else if (/^web\/(src|tests)\//.test(p)) {
    // Data read as text: a web/tests fixture, or a web/src non-code file such as styles.css (tests read it by name).
    if (!CODE.test(p)) dataFiles.push(["web", p]);
    // A gone web module selects nothing by graph; the web typecheck (always run for web/**) covers its importers.
    if (present && WEB_TEST.test(p)) select("web", [p], `${p} (changed test)`, p);
    else if (present) {
      relatedWeb.push([p, p]);
      relatedRoot.push([p, p]); // root tests import web/src by value (tests/panel/webParity.test.ts)
    }
  } else {
    const reader = TEXT_READERS.find(([prefix]) => p.startsWith(prefix));
    if (reader) select("root", listTests(reader[1], ROOT_TEST), `${p} (read as text by ${reader[1]})`, p);
  }
}
for (const [suite, p] of dataFiles) {
  const pattern = suite === "web" ? WEB_TEST : ROOT_TEST;
  for (const f of namedBy(suite, p)) {
    if (pattern.test(f)) select(suite, [f], `${p} (named by ${f})`, p);
    else (suite === "web" ? relatedWeb : relatedRoot).push([f, p]); // a helper names it: the tests that import the helper
  }
}

// vitest's `related`, through its node API: the test files that statically import a changed file, transitively.
async function related(projectRoot, suite, pairs) {
  if (pairs.length === 0) return;
  const { createVitest } = await vitestNode();
  const configFile = join(projectRoot, suite === "web" ? "vite.config.ts" : "vitest.config.ts");
  const ctx = await createVitest("test", { root: projectRoot, config: configFile, watch: false });
  try {
    for (const [file, p] of pairs) {
      ctx.config.related = [join(root, file)];
      const specs = await ctx.getRelevantTestSpecifications();
      select(suite, specs.map((s) => relative(root, s.moduleId)), file === p ? `${p} (imported)` : `${p} (named by ${file}, imported)`, p);
    }
  } finally {
    await ctx.close();
  }
}

// --- quick tier: direct importers, catalogue tables, deferral ---------------------------------------------------
// vitest's results cache (node_modules/.vite/vitest/<hash>/results.json: [["<project>:<path>", { duration }]]) is the
// only record of what a file costs. A suite without one cannot tell heavy files from light ones: it is selected wide.
const SLOW_MS = 30_000;
function recordedDurations(suite) {
  const dir = join(root, ...(suite === "web" ? ["web"] : []), "node_modules", ".vite", "vitest");
  const durations = new Map();
  if (!existsSync(dir)) return null;
  for (const hash of readdirSync(dir)) {
    const file = join(dir, hash, "results.json");
    if (!existsSync(file)) continue;
    let results;
    try { results = JSON.parse(readFileSync(file, "utf8")).results ?? []; } catch { continue; }
    for (const [key, value] of Array.isArray(results) ? results : Object.entries(results)) {
      const path = (suite === "web" ? "web/" : "") + key.slice(key.indexOf(":") + 1);
      if (typeof value?.duration === "number") durations.set(path, Math.max(durations.get(path) ?? 0, value.duration));
    }
  }
  return durations.size ? durations : null;
}
// Type-only imports cannot break at run time (the typecheck covers them), so they do not make a direct importer.
const TYPE_ONLY = /\b(?:import|export)\s+type\s+(?:\{[^}]*\}|\*(?:\s+as\s+\w+)?|\w+)\s*from\s*["'`][^"'`]+["'`]/g;
function directImporters(suite, pairs) {
  if (pairs.length === 0) return;
  const [dir, pattern] = suite === "web" ? ["web/tests", WEB_TEST] : ["tests", ROOT_TEST];
  const imports = listTests(dir, pattern).map((f) => {
    const out = new Set(directImports(f, readFileSync(join(root, f), "utf8").replace(TYPE_ONLY, "")));
    for (const t of [...out]) for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) out.add(t + ext);
    return [f, out];
  });
  for (const [file, p] of pairs) {
    const files = imports.filter(([, out]) => out.has(file)).map(([f]) => f);
    select(suite, files, file === p ? `${p} (imported directly)` : `${p} (named by ${file}, imported directly)`, p);
  }
}

// The catalogue tables a code or a translation joins: an added error code or locale key is checked here, and #328 ②
// (refusalCoverage, distance 2 from errors.ts) is what a direct-importer selection alone misses.
const CATALOGUE_SOURCES = /^(src\/control\/errors\.ts|web\/src\/locales\/[^/]+\.ts)$/;
const CATALOGUE_TESTS = [
  ["root", "tests/panel/refusalCoverage.test.ts"], ["root", "tests/control/errorClassification.test.ts"],
  ["root", "tests/metrics/noteCodes.test.ts"], ["root", "tests/entry/skill.test.ts"], ["web", "web/tests/i18nKeys.test.ts"],
];

for (const [suite, pairs, projectRoot] of [["root", relatedRoot, root], ["web", relatedWeb, join(root, "web")]]) {
  if (quick[suite]) directImporters(suite, pairs);
  else await related(projectRoot, suite, pairs);
}
for (const p of changed.filter((p) => CATALOGUE_SOURCES.test(p))) {
  for (const [suite, f] of CATALOGUE_TESTS) if (quick[suite] && existsSync(join(root, f))) select(suite, [f], `${p} (catalogue table)`, p);
}
// A data file nothing names or imports may still be read by a test (a directory listing, a computed name): the whole
// suite, said out loud, rather than nothing (Rule 12).
const fallback = [];
for (const [suite, p] of dataFiles) {
  if (selecting.has(p)) continue;
  if (narrowed.has(p)) { // what the whole mirror selected before the narrowing, not the whole suite
    fallback.push(`test-affected: no test names ${p}; selecting its mirror directory ${narrowed.get(p)}`);
    select(suite, listTests(narrowed.get(p), ROOT_TEST), `${p} (data no test names: mirror ${narrowed.get(p)})`, p);
    continue;
  }
  fallback.push(`test-affected: no test names ${p}; selecting the whole ${suite} suite`);
  select(suite, suite === "web" ? listTests("web/tests", WEB_TEST) : listTests("tests", ROOT_TEST), `${p} (data no test names: whole ${suite} suite)`, p);
}

// The real-ccloop E2E files: tests that import a ccloop world (tests/control/fixtures/ccloopWorld.ts, or a world built on
// it such as tests/flow/fixtures/flowCcloopWorld.ts) directly. Not the pin rule's "reads ORCA_CCLOOP_BIN": that also
// takes in tests/scheduler/ through sandbox.ts, a light suite (verify:scheduler measured 23.8 s, spec §1).
const CCLOOP_WORLD = /(^|\/)(ccloopWorld|flowCcloopWorld)\.ts$/;
function ccloopWorldTests(suite) {
  const [dir, pattern] = suite === "web" ? ["web/tests", WEB_TEST] : ["tests", ROOT_TEST];
  const rows = [];
  for (const f of listTests(dir, pattern)) {
    const world = directImports(f, readFileSync(join(root, f), "utf8")).find((t) => CCLOOP_WORLD.test(t) && existsSync(join(root, t))); // a quoted fixture is not an import
    if (world) rows.push([f, `imports ${world}`]);
  }
  return rows;
}

// Deferred: in a quick suite, a selected file that is slow on record or runs the real ccloop, unless it changed itself.
const deferred = [];
const unknownCost = { root: 0, web: 0 };
for (const suite of ["root", "web"]) {
  if (!quick[suite]) continue;
  const real = new Map(ccloopWorldTests(suite));
  for (const file of [...selection[suite].keys()]) {
    if (changed.includes(file)) continue;
    const ms = durations[suite].get(file);
    if (ms === undefined) unknownCost[suite] += 1;
    const why = real.has(file) ? `runs the real ccloop (${real.get(file)})` : ms !== undefined && ms >= SLOW_MS ? `recorded ${(ms / 1000).toFixed(1)} s >= ${SLOW_MS / 1000} s` : null;
    if (why === null) continue;
    deferred.push([suite, file, why, selection[suite].get(file)]);
    selection[suite].delete(file);
  }
}

// --- report the selection ---------------------------------------------------------------------------------------
const rootFiles = [...selection.root.keys()].sort();
const webFiles = [...selection.web.keys()].sort();
const tier = wide ? "wide" : quick.root || quick.web ? "quick" : "quick-fallback-wide";
if (wide) console.log("test-affected: WIDE tier (npm run test:wide): the merge gate, run once per merge batch into main");
else {
  console.log("test-affected: QUICK tier (npm test): per patch set; this is NOT the merge gate -- run npm run test:wide once per merge batch into main");
  for (const suite of ["root", "web"]) {
    if (!quick[suite]) console.log(`test-affected: no vitest results cache for the ${suite} suite (${suite === "web" ? "web/" : ""}node_modules/.vite/vitest/*/results.json): its selection falls back to the wide one`);
  }
}
console.log(`test-affected: ${changed.length} changed paths against ${base} (committed since the merge base, staged, unstaged, untracked)`);
if (pinOnly) {
  console.log("test-affected: package.json and package-lock.json differ only in the ccloop pin: they select only the tests " +
    "that run the real ccloop (read ORCA_CCLOOP_BIN, or import a helper that does); other changed paths select as usual");
}
for (const [suite, files] of [["root", rootFiles], ["web", webFiles]]) {
  for (const file of files) console.log(`  ${suite} ${file} <- ${selection[suite].get(file).join("; ")}`);
}
for (const line of fallback) console.log(line);
for (const [suite, file, why, reasons] of deferred.sort((a, b) => a[1].localeCompare(b[1]))) {
  console.log(`  deferred ${suite} ${file}: ${why} <- ${reasons.join("; ")}`);
}
const idle = changed.filter((p) => !selecting.has(p));
if (idle.length) console.log(`test-affected: changed paths that select no test: ${idle.join(", ")}`);
const empty = rootFiles.length + webFiles.length === 0;
if (empty) console.log(`test-affected: 0 test files selected (no changes against ${base} select any)`);
else console.log(`test-affected: ${rootFiles.length + webFiles.length} test files selected (${rootFiles.length} root, ${webFiles.length} web)`);
if (!wide) {
  console.log(`test-affected: ${deferred.length} test files deferred to the wide tier (listed above as "deferred"; npm run test:wide runs them)`);
  const unknown = unknownCost.root + unknownCost.web;
  if (unknown) console.log(`test-affected: ${unknown} selected files have no recorded duration in the results cache: run, cost unknown`);
}
const typechecks = [["npm", ["run", "typecheck"]]];
if (webTypecheck) typechecks.push([join(root, "node_modules", ".bin", "tsc"), ["--noEmit", "-p", "web/tsconfig.json"]]);
console.log(`test-affected: typecheck: ${typechecks.map(([cmd, args]) => [cmd === "npm" ? cmd : relative(root, cmd), ...args].join(" ")).join(" ; ")}`);
if (dryRun) process.exit(0);

// --- run --------------------------------------------------------------------------------------------------------
const status = await runSelection(tier, rootFiles, webFiles, typechecks);
if (!wide) console.log(`test-affected: that was the quick tier (exit ${status}), not the merge gate; ${deferred.length} files were deferred to npm run test:wide`);
// The stamp is the tree the run started on, and only if the worktree was clean then and is still that tree and clean now.
if (wide && status === 0 && startTree && treeClean() && headTree() === startTree) {
  mkdirSync(stampDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(stampDir, startTree), `${new Date().toISOString()} head ${git(["rev-parse", "HEAD"]).trim()} base ${base}\n`);
  console.log(`test-affected: wide run green on a clean tree: stamped ${startTree}; a wide run on this tree will not run again`);
} else if (wide && status === 0) console.log("test-affected: wide run green, but the worktree was not clean (or changed during the run): no stamp");
process.exit(status);
