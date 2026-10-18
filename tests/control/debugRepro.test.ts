import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEBUG_DEFAULT_BUILD_TEST_COMMANDS } from "../../src/control/debugPlan.js";
import { checkReproduction, restoreWorkspace, type ReproVerdict } from "../../src/control/debugRepro.js";
import { driveRecordSchema } from "../../src/control/driveRecord.js";
import { createExecutionDriver, type ExecutionDriver } from "../../src/control/executionDriver.js";
import type { DebugResult } from "../../src/control/reportedDecisions.js";
import { driverHarness, git as hgit } from "./fixtures/driverHarness.js";

// Debug-task design §4.3, §12.8 / plan Task 8: Orca checks that a debug run's added test fails at its base and passes at
// its attempt, in the run's own workspace, and leaves that workspace as it found it.

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8" }).replace(/\n$/, "");

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function tempDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "orca-debug-repro-")));
  dirs.push(dir);
  return dir;
}
function put(repo: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
}

/**
 * A workspace like the driver's: `base`, then the attempt's commit on top. The attempt adds a reproduction test, the fix
 * (`fixed.txt`) and a file that is not a test, and modifies a test that already existed at base. `branch` puts HEAD on a
 * branch instead of detached, so the restore is seen to keep the symbolic ref either way.
 */
async function workspace(opts: { branch?: boolean; attempt?: Record<string, string> } = {}) {
  const repo = join(await tempDir(), "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  put(repo, { "base.txt": "base\n", "tests/old.test.txt": "old\n", ".gitignore": "build/\n" });
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "base");
  const base = git(repo, "rev-parse", "HEAD");
  if (opts.branch) git(repo, "checkout", "-q", "-b", "work"); else git(repo, "checkout", "-q", "--detach");
  put(repo, opts.attempt ?? { "tests/repro.test.txt": "repro\n", "fixed.txt": "fixed\n", "notes.md": "n\n", "tests/old.test.txt": "changed\n" });
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "attempt", "--allow-empty");
  const attemptSha = git(repo, "rev-parse", "HEAD");
  return { repo, base, attemptSha, symbolic: opts.branch ? "refs/heads/work" : "" };
}
const contract = (command: string) => ({ context: { buildTestCommands: [command] } }) as never;

/** The check, then Review Focus 4: HEAD is the attempt, on the same symbolic ref, and `git status` is clean. */
async function checked(w: Awaited<ReturnType<typeof workspace>>, result: DebugResult, command = "true", resultMalformed?: boolean, timeoutMs = 10_000): Promise<ReproVerdict> {
  const verdict = await checkReproduction({ workdir: w.repo, base: w.base, attemptSha: w.attemptSha, result, contract: contract(command), timeoutMs, ...(resultMalformed === undefined ? {} : { resultMalformed }) });
  expect(git(w.repo, "rev-parse", "HEAD")).toBe(w.attemptSha);
  expect(execFileSync("sh", ["-c", "git symbolic-ref -q HEAD || true"], { cwd: w.repo, encoding: "utf8" }).trim()).toBe(w.symbolic);
  expect(git(w.repo, "status", "--porcelain", "--untracked-files=all")).toBe("");
  return verdict;
}

// Red at base (fixed.txt is absent there), green at head.
const REPRO = "test -f tests/repro.test.txt && test -f fixed.txt";

describe("checkReproduction (design §12.8)", () => {
  it("red at base and green at head passes", async () => {
    const w = await workspace();
    expect(await checked(w, { reproTests: ["tests/repro.test.txt"], reproCommand: REPRO })).toEqual({ kind: "passed", tests: ["tests/repro.test.txt"], command: REPRO });
  });

  it("green at base fails the attempt", async () => {
    const w = await workspace({ branch: true });
    // The test file alone is enough for this command, and it is applied at base: the bug was never reproduced.
    expect(await checked(w, { reproTests: ["tests/repro.test.txt"], reproCommand: "test -f tests/repro.test.txt" })).toEqual({ kind: "failed", reason: "green-at-base" });
  });

  it("red at head fails", async () => {
    const w = await workspace();
    expect(await checked(w, { reproTests: ["tests/repro.test.txt"], reproCommand: "test -f nowhere.txt" })).toEqual({ kind: "failed", reason: "red-at-head" });
  });

  it("not-expressible skips with its reason, and no command runs", async () => {
    const w = await workspace();
    const marker = join(await tempDir(), "ran");
    const verdict = await checked(w, { reproduction: "not-expressible", reproductionReason: "a style choice", reproCommand: `touch ${marker}` }, `touch ${marker}`);
    expect(verdict).toEqual({ kind: "skipped", reason: "a style choice" });
    expect(existsSync(marker)).toBe(false);
  });

  it("refuses not-expressible without a reason as an invalid result", async () => {
    const w = await workspace();
    expect(await checked(w, { reproduction: "not-expressible" }, REPRO)).toEqual({ kind: "failed", reason: "result-invalid" });
  });

  it("absent reproTests are computed from added test files, and the contract's first command is used", async () => {
    const w = await workspace({ attempt: {
      "tests/repro.test.txt": "r\n", "lib/a.spec.ts": "s\n", "py/test_x.py": "p\n", "go/x_test.go": "g\n", "fixed.txt": "f\n", "src/testing.ts": "no\n",
      "tests/old.test.txt": "modified, not added\n",
    } });
    const verdict = await checked(w, {}, "test -f tests/repro.test.txt && test -f fixed.txt");
    expect(verdict).toEqual({ kind: "passed", tests: ["go/x_test.go", "lib/a.spec.ts", "py/test_x.py", "tests/repro.test.txt"], command: "test -f tests/repro.test.txt && test -f fixed.txt" });
  });

  it("an attempt that added no test fails no-tests, an empty attempt included", async () => {
    const w = await workspace({ attempt: { "fixed.txt": "f\n" } });
    expect(await checked(w, {}, REPRO)).toEqual({ kind: "failed", reason: "no-tests" });
    const empty = await workspace({ attempt: {} });
    expect(empty.attemptSha).not.toBe(empty.base);
    expect(await checked(empty, {}, REPRO)).toEqual({ kind: "failed", reason: "no-tests" });
  });

  it("a malformed result fails result-invalid unless Orca can compute the tests itself", async () => {
    const none = await workspace({ attempt: { "fixed.txt": "f\n" } });
    expect(await checked(none, {}, REPRO, true)).toEqual({ kind: "failed", reason: "result-invalid" });
    const some = await workspace();
    expect(await checked(some, {}, REPRO, true)).toEqual({ kind: "passed", tests: ["tests/repro.test.txt"], command: REPRO });
  });

  it("the placeholder command of a contract with no original does not count", async () => {
    const w = await workspace();
    expect(await checked(w, { reproTests: ["tests/repro.test.txt"] }, DEBUG_DEFAULT_BUILD_TEST_COMMANDS[0])).toEqual({ kind: "failed", reason: "no-command" });
  });

  it("removes what the command left untracked, keeps what was untracked before, and leaves ignored output alone", async () => {
    const w = await workspace({ branch: true });
    writeFileSync(join(w.repo, "keep.txt"), "mine\n");
    const command = `touch stray.txt; mkdir -p build && touch build/out; ${REPRO}`;
    const verdict = await checkReproduction({ workdir: w.repo, base: w.base, attemptSha: w.attemptSha, result: { reproTests: ["tests/repro.test.txt"], reproCommand: command }, contract: contract("true"), timeoutMs: 10_000 });
    expect(verdict.kind).toBe("passed");
    expect(git(w.repo, "rev-parse", "HEAD")).toBe(w.attemptSha);
    expect(git(w.repo, "symbolic-ref", "-q", "HEAD")).toBe("refs/heads/work");
    expect(git(w.repo, "status", "--porcelain", "--untracked-files=all")).toBe("?? keep.txt");
    expect(existsSync(join(w.repo, "stray.txt"))).toBe(false);
    expect(existsSync(join(w.repo, "build", "out"))).toBe(true);
  });

  it("counts a command past its deadline at head as red", async () => {
    const w = await workspace();
    expect(await checked(w, { reproTests: ["tests/repro.test.txt"], reproCommand: "sleep 5" }, "true", undefined, 500)).toEqual({ kind: "failed", reason: "red-at-head" });
  });

  it("counts a command past its deadline at base as not green, so the reproduction holds", async () => {
    const w = await workspace();
    // Quick at head (fixed.txt is there), past the deadline at base (it is not).
    const command = "test -f fixed.txt || sleep 5";
    expect(await checked(w, { reproTests: ["tests/repro.test.txt"], reproCommand: command }, "true", undefined, 500)).toEqual({ kind: "passed", tests: ["tests/repro.test.txt"], command });
  });

  // Fix round 1 (R3): ccloop runs a contract's required checks with its environment inherited unchanged (runLoop.js
  // runRequiredChecks), GIT_* included; Orca's own git children drop those (childEnv), the check's command does not.
  it("runs the command with the environment inherited as ccloop's required checks are", async () => {
    const w = await workspace();
    process.env.GIT_ORCA_REPRO_PROBE = "inherited";
    try {
      const command = `test "$GIT_ORCA_REPRO_PROBE" = inherited && ${REPRO}`;
      expect(await checked(w, { reproTests: ["tests/repro.test.txt"], reproCommand: command })).toEqual({ kind: "passed", tests: ["tests/repro.test.txt"], command });
    } finally { delete process.env.GIT_ORCA_REPRO_PROBE; }
  });

  it("refuses a named test the attempt does not contain before touching the workspace", async () => {
    const w = await workspace();
    expect(await checked(w, { reproTests: ["tests/repro.test.txt", "tests/missing.test.txt"], reproCommand: REPRO })).toEqual({ kind: "failed", reason: "result-invalid" });
  });
});

describe("restoreWorkspace (fix round 1, minor b)", () => {
  it("still removes what was left untracked when the checkout fails, and answers the checkout's failure", async () => {
    const w = await workspace();
    git(w.repo, "checkout", "-q", "--detach", w.base);
    writeFileSync(join(w.repo, "stray.txt"), "s\n");
    // A leftover index lock makes `git checkout` fail; `git clean` does not take it.
    writeFileSync(join(w.repo, ".git", "index.lock"), "");
    const failure = await restoreWorkspace(w.repo, w.attemptSha, { headRef: null, untrackedBefore: [] });
    expect(failure?.message).toMatch(/^debug-repro-git:checkout: .*index\.lock/);
    expect(existsSync(join(w.repo, "stray.txt"))).toBe(false);
  });
});

describe("drive.debugRepro (driveRecordSchema)", () => {
  it("parses a drive record from before the field, as null", () => {
    const old = {
      workspaceMode: "worktree", sourceDir: "/x/state.runs/r", workspacePath: "/x/state.workspaces/r", targetRepo: null,
      prepared: false, base: null, envelopeHash: null, inspectUnknown: 0, outcome: null, attemptSha: null, landedCommit: null,
      reconcile: null, blockedAt: null, blockedReason: null, cleanedUp: false,
    };
    expect(driveRecordSchema.parse(old).debugRepro).toBe(null);
    expect(driveRecordSchema.parse({ ...old, debugRepro: { state: "skipped", reason: "r" } }).debugRepro).toEqual({ state: "skipped", reason: "r" });
  });
});

const MARK = {
  correctionId: "c1", ordinal: 1, inputHash: "a".repeat(64), missing: [], agentFallback: null, undoHow: null, closing: null,
  checks: { from: "original", namedBy: null },
};

describe("stepC runs the check only for a debug group's run (plan Task 8)", () => {
  // The fixture contract's only check is `true`, so a reported reproCommand is what makes base and head differ.
  const task = (taskId: string) => ({ taskId, targetPaths: [taskId, "tests"] });
  const files = (id: string) => ({ [id]: `${id}\n`, [`tests/${id}.test.txt`]: "t\n" });
  async function debugHarness(debug: (id: string) => unknown, over: { files?: (id: string) => Record<string, string>; tasks?: string[] } = {}) {
    const t = await driverHarness((over.tasks ?? ["a"]).map(task), { files: over.files ?? files, debug });
    const row = t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!;
    t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...JSON.parse(String(row.body)), debug: MARK }));
    return t;
  }
  /** Fix round 1 (R1): the check runs off the round, so a criterion waits on the clock as well as on rounds. */
  async function settle(driver: ExecutionDriver, predicate: () => boolean, ms = 15_000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error("the driver did not reach the expected state in time");
      await driver.round();
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  const workdirOf = (drive: { sourceDir: string }) => join(drive.sourceDir, "repo");

  it("a failed check blocks the debug run at C and does not land", async () => {
    const t = await debugHarness(() => ({}));
    const driver = t.driver();
    try {
      const runId = await t.claim();
      await settle(driver, () => t.body(runId).state === "blocked");
      const drive = t.body(runId).drive;
      expect(drive.blockedAt).toBe("C");
      expect(drive.blockedReason).toBe("debug-repro:green-at-base");
      expect(drive.outcome).toBe("repro-failed");
      expect(drive.landedCommit).toBe(null);
      expect(drive.debugRepro).toBe(null);
      // The group branch is still where A2 made it, at the run's base: nothing landed.
      expect(hgit(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(drive.base);
      expect(hgit(workdirOf(drive), "rev-parse", "HEAD")).toBe(drive.attemptSha);
      expect(hgit(workdirOf(drive), "status", "--porcelain")).toBe("");
    } finally { await driver.stop(); await t.h.dispose(); }
  });

  it("an empty attempt of a debug run fails no-tests instead of settling", async () => {
    const t = await debugHarness(() => ({ reproCommand: "test -f a" }), { files: () => ({}) });
    const driver = t.driver();
    try {
      const runId = await t.claim();
      await settle(driver, () => t.body(runId).state === "blocked");
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "C", blockedReason: "debug-repro:no-tests", outcome: "repro-failed" });
    } finally { await driver.stop(); await t.h.dispose(); }
  });

  it("a debug run that reproduced lands", async () => {
    const t = await debugHarness(() => ({ reproCommand: "test -f a" }));
    const driver = t.driver();
    try {
      const runId = await t.claim();
      await settle(driver, () => t.body(runId).state === "landed");
      const drive = t.body(runId).drive;
      expect(hgit(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(drive.landedCommit);
      expect(drive.debugRepro).toBe(null);
    } finally { await driver.stop(); await t.h.dispose(); }
  });

  it("a not-expressible debug run lands and records the skip with its reason", async () => {
    const t = await debugHarness(() => ({ reproduction: "not-expressible", reproductionReason: "a naming taste" }));
    const driver = t.driver();
    try {
      const runId = await t.claim();
      await settle(driver, () => t.body(runId).state === "landed");
      expect(t.body(runId).drive.debugRepro).toEqual({ state: "skipped", reason: "a naming taste" });
    } finally { await driver.stop(); await t.h.dispose(); }
  });

  it("a malformed debug value with no test to compute blocks with result-invalid", async () => {
    const t = await debugHarness(() => "x", { files: () => ({ a: "a\n" }) });
    const driver = t.driver();
    try {
      const runId = await t.claim();
      await settle(driver, () => t.body(runId).state === "blocked");
      expect(t.body(runId).drive.blockedReason).toBe("debug-repro:result-invalid");
    } finally { await driver.stop(); await t.h.dispose(); }
  });

  it("a non-debug run is never checked", async () => {
    let calls = 0;
    const t = await driverHarness([task("a")], { files });
    try {
      const runId = await t.claim();
      const driver = createExecutionDriver({ ...t.deps, checkReproduction: async () => { calls += 1; return { kind: "passed", tests: [], command: "true" }; } });
      await t.until(driver, () => t.body(runId).state === "landed");
      expect(calls).toBe(0);
    } finally { await t.h.dispose(); }
  });

  // Fix round 1 (R1): the check is not awaited by the round.
  it("other runs advance while a debug check is pending", async () => {
    const release = join(await tempDir(), "release");
    const t = await debugHarness((id) => ({ reproCommand: id === "a" ? `while [ ! -f ${release} ]; do sleep 0.05; done; test -f a` : `test -f ${id}` }), { tasks: ["a", "b"] });
    const driver = t.driver();
    try {
      const a = await t.claim();
      await settle(driver, () => t.body(a).drive?.debugRepro?.state === "checking");
      const b = await t.claim();
      await settle(driver, () => t.body(b).state === "landed", 10_000);
      expect(t.body(a).state).toBe("accepted");
      expect(t.body(a).drive.debugRepro.state).toBe("checking");
      writeFileSync(release, "");
      await settle(driver, () => t.body(a).state === "landed");
    } finally { writeFileSync(release, ""); await driver.stop(); await t.h.dispose(); }
  });

  it("stop() returns promptly while a check runs, kills its command and leaves the marker", async () => {
    const dir = await tempDir();
    const pidFile = join(dir, "pid");
    const t = await debugHarness(() => ({ reproCommand: `echo $$ > ${pidFile}; sleep 30` }));
    const driver = t.driver();
    try {
      const runId = await t.claim();
      await settle(driver, () => existsSync(pidFile) && readFileSync(pidFile, "utf8").trim() !== "");
      const pid = Number(readFileSync(pidFile, "utf8").trim());
      const started = Date.now();
      await driver.stop();
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(t.body(runId).state).toBe("accepted");
      expect(t.body(runId).drive.debugRepro.state).toBe("checking");
      const gone = async (): Promise<boolean> => { try { process.kill(pid, 0); return false; } catch { return true; } };
      const deadline = Date.now() + 3_000;
      while (!(await gone()) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
      expect(await gone()).toBe(true);
    } finally { await driver.stop(); await t.h.dispose(); }
  });

  it("persists the marker before the check starts touching the workspace", async () => {
    const seen: unknown[] = [];
    const t = await debugHarness(() => ({ reproCommand: "test -f a" }));
    const driver = createExecutionDriver({ ...t.deps, checkReproduction: async (input) => {
      const drive = t.body(runIdOf()).drive;
      seen.push(drive.debugRepro);
      // Nothing has been checked out yet: HEAD is the attempt.
      expect(hgit(input.workdir, "rev-parse", "HEAD")).toBe(input.attemptSha);
      return { kind: "passed", tests: [], command: "test -f a" };
    } });
    let runId = "";
    const runIdOf = () => runId;
    try {
      runId = await t.claim();
      await settle(driver, () => t.body(runId).state === "landed");
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ state: "checking", attemptSha: t.body(runId).drive.attemptSha, headRef: null, untrackedBefore: [], empty: false });
    } finally { await driver.stop(); await t.h.dispose(); }
  });

  it("a restart finding the marker restores the workspace and checks again, with no new attempt commit", async () => {
    const t = await debugHarness(() => ({ reproCommand: "test -f a" }));
    // The first driver's check never finishes: it stands for a process that died mid-check.
    const first = createExecutionDriver({ ...t.deps, checkReproduction: () => new Promise(() => undefined) });
    const second = t.driver();
    try {
      const runId = await t.claim();
      await settle(first, () => t.body(runId).drive?.debugRepro?.state === "checking");
      await first.stop();
      const marker = t.body(runId).drive.debugRepro;
      const workdir = workdirOf(t.body(runId).drive);
      // Left as a death in the middle of the check leaves it: at base, with the test applied and a stray file.
      hgit(workdir, "checkout", "-q", "--force", "--detach", t.body(runId).drive.base);
      hgit(workdir, "checkout", "-q", marker.attemptSha, "--", "tests/a.test.txt");
      writeFileSync(join(workdir, "stray.txt"), "s\n");
      await settle(second, () => t.body(runId).state !== "accepted" || t.body(runId).drive.attemptSha !== null);
      // Read before the state: a new attempt commit is the failure this criterion exists for.
      expect(t.body(runId).drive.attemptSha).toBe(marker.attemptSha);
      await settle(second, () => t.body(runId).state === "landed");
      const drive = t.body(runId).drive;
      expect(hgit(t.repo, "rev-parse", `${drive.landedCommit}^2`)).toBe(marker.attemptSha);
      expect(hgit(t.repo, "show", `${drive.landedCommit}:a`)).toBe("a");
    } finally { await first.stop(); await second.stop(); await t.h.dispose(); }
  });
});
