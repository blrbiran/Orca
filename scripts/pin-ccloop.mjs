#!/usr/bin/env node
// Re-pin ccloop (human ruling 2026-09-29, session 2f65a729: re-pinning is the agent's, and only after the human has
// pushed ccloop -- npm can install nothing GitHub does not have). Run from the Orca root on a clean tree:
//
//   node scripts/pin-ccloop.mjs <the 40-hex ccloop commit>
//
// Installs github:blrbiran/ccloop#<commit>, then runs the checks of the ccloop dependency plan, Task 5 Step 3 with
// items 1-4 of its correction section (docs/superpowers/plans/2026-09-29-ccloop-git-dependency.md), two of them
// generalised from a first pin to a re-pin (see the check names below). Exit 0 only when every check held:
// package.json and package-lock.json are then modified and left for the caller to commit. Exit 1 on any refusal or
// failed check, leaving the tree as the install left it, for inspection.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDefaultE2E } from "./verify-ccloop-pin.mjs";

const repo = process.cwd();
const sha = process.argv[2] ?? "";
const want = `github:blrbiran/ccloop#${sha}`;

const refuse = (why) => {
  console.error(`pin-ccloop: ${why}`);
  process.exit(1);
};
const run = (command, args, cwd = repo) => spawnSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "inherit", "inherit"] });
const capture = (command, args, cwd = repo) => spawnSync(command, args, { cwd, encoding: "utf8" });
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

if (!/^[0-9a-f]{40}$/.test(sha)) refuse(`expected a full 40-hex commit, got ${JSON.stringify(sha)}`);
const status = capture("git", ["status", "--porcelain"]);
if (status.status !== 0 || status.stdout !== "") refuse(`the tree must be clean (git status --porcelain):\n${status.stdout}${status.stderr}`);
if (readJson(join(repo, "package.json")).dependencies?.ccloop === want) refuse(`ccloop is already pinned at ${sha}`);
const committedLock = capture("git", ["show", "HEAD:package-lock.json"]);
if (committedLock.status !== 0) refuse(`cannot read the committed package-lock.json: ${committedLock.stderr}`);
const before = JSON.parse(committedLock.stdout).packages;

if (run("npm", ["install", want]).status !== 0) refuse(`npm install ${want} failed`);

const results = [];
const check = (name, verdict) => {
  const { ok, detail } = typeof verdict === "boolean" ? { ok: verdict, detail: "" } : verdict;
  results.push(ok);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
};
const isBuiltPackage = (dir) =>
  existsSync(dir) && !lstatSync(dir).isSymbolicLink()
  && existsSync(join(dir, "dist", "cli.js")) && (statSync(join(dir, "dist", "cli.js")).mode & 0o111) !== 0
  && existsSync(join(dir, "scripts", "claude-phase-runner.mjs")) && existsSync(join(dir, "scripts", "claude-stream.mjs"));
const hiddenLockPins = (root) => {
  try {
    return readJson(join(root, "node_modules", ".package-lock.json")).packages["node_modules/ccloop"].resolved.endsWith(`#${sha}`);
  } catch {
    return false;
  }
};

// 1) The dependency line is exactly the ruled form.
const dependency = readJson(join(repo, "package.json")).dependencies?.ccloop;
check("package.json pins the commit", { ok: dependency === want, detail: String(dependency) });

// 2) The lock pins the same commit. Plan Task 5 was a first pin, where ccloop's entries could only be added; on a
// re-pin they change, so the rule is: every lock entry that differs is the root's or ccloop's own.
const after = readJson(join(repo, "package-lock.json")).packages;
const ccloopOwn = (key) => key === "" || key === "node_modules/ccloop" || key.startsWith("node_modules/ccloop/");
const differing = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
const resolved = after["node_modules/ccloop"]?.resolved;
check("the lock pins the commit and changes only ccloop", {
  ok: typeof resolved === "string" && resolved.endsWith(`#${sha}`) && differing.every(ccloopOwn),
  detail: JSON.stringify({ resolved, differing }),
});

// 3) Only the two files changed.
const changed = capture("git", ["status", "--porcelain"]).stdout.split("\n").filter(Boolean).sort();
check("only package.json and package-lock.json changed", {
  ok: JSON.stringify(changed) === JSON.stringify([" M package-lock.json", " M package.json"]),
  detail: JSON.stringify(changed),
});

// 4) The installed package is built, carries the runner's scripts, and is a real directory.
check("the installed package is a built real directory", isBuiltPackage(join(repo, "node_modules", "ccloop")));

// 5) The same E2E, against this install (correction 3: the panel criterion needs web/dist).
if (!existsSync(join(repo, "web", "dist", "index.html")) && run("npm", ["run", "build", "--workspace", "web"]).status !== 0) {
  check("web/dist builds", false);
} else {
  const e2e = runDefaultE2E(repo, ["tests/control/ccloopBin.test.ts"]);
  check("the default-resolution E2E passed", { ok: e2e.ok, detail: JSON.stringify(e2e.summary) });
}
check("typecheck", run("npm", ["run", "typecheck"]).status === 0);

// Correction 4: npm ci reproduces the lock. The plan cloned the committed state, which before the commit still holds
// the OLD lock and would reproduce that instead; the clone gets this tree's two files first.
const scratch = mkdtempSync(join(tmpdir(), "cl-"));
const clone = join(scratch, "o");
let ci = false;
if (run("git", ["clone", "-q", "--local", repo, clone], scratch).status === 0) {
  copyFileSync(join(repo, "package.json"), join(clone, "package.json"));
  copyFileSync(join(repo, "package-lock.json"), join(clone, "package-lock.json"));
  ci = run("npm", ["ci"], clone).status === 0 && isBuiltPackage(join(clone, "node_modules", "ccloop")) && hiddenLockPins(clone);
}
rmSync(scratch, { recursive: true, force: true });
check("npm ci reproduces the lock", ci);

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? `pin-ccloop: pinned ${sha}; commit package.json and package-lock.json` : `pin-ccloop: ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
