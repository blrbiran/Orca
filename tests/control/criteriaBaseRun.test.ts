import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readArtifact } from "../../src/control/archive.js";
import type { ArtifactRef } from "../../src/control/types.js";
import { runChecksAtBase } from "../../src/control/criteriaProtection.js";
import { createExecutionDriver, type ExecutionDriver } from "../../src/control/executionDriver.js";
import { listFlaggedDecisions } from "../../src/control/flaggedDecisions.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness, git as hgit } from "./fixtures/driverHarness.js";

/**
 * Protect-acceptance-criteria spec 2026-10-21 §4.2 / §7a.1 / §7a.4: an attempt that modified the files defining its checks
 * has the required checks re-run with the base versions of those files over the attempt, in the run's own workspace. The
 * code also meeting the old criteria gives no notice; otherwise "only the modified checks pass" is flagged. The workspace
 * is left exactly as it was found.
 */
const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8" }).replace(/\n$/, "");

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

async function put(repo: string, files: Record<string, string | null>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    if (text === null) { git(repo, "rm", "-q", path); continue; }
    await mkdir(dirname(join(repo, path)), { recursive: true }); await writeFile(join(repo, path), text);
  }
}

/** base, then the attempt on a branch (HEAD symbolic, as the driver's workspace is after commitAttempt). */
async function workspace(base: Record<string, string>, attempt: Record<string, string | null>) {
  const repo = await realpath(await mkdtemp(join(tmpdir(), "orca-criteria-base-")));
  dirs.push(repo);
  git(repo, "init", "-q", "-b", "main");
  await put(repo, base); git(repo, "add", "-A"); git(repo, "commit", "-qm", "base");
  const baseSha = git(repo, "rev-parse", "HEAD");
  git(repo, "checkout", "-q", "-b", "work");
  await put(repo, attempt); git(repo, "add", "-A"); git(repo, "commit", "-qm", "attempt", "--allow-empty");
  return { repo, base: baseSha, attemptSha: git(repo, "rev-parse", "HEAD") };
}

/** The run, then the restore: HEAD back on `work` at the attempt and nothing changed or left behind. */
async function ran(w: Awaited<ReturnType<typeof workspace>>, files: string[], checks: string[], signal?: AbortSignal, setupCommands?: string[]) {
  try {
    return await runChecksAtBase({ workdir: w.repo, base: w.base, attemptSha: w.attemptSha, files, requiredChecks: checks, timeoutMs: 10_000, as: { runId: "run-t" }, ...(signal ? { signal } : {}), ...(setupCommands ? { setupCommands } : {}) });
  } finally {
    expect(git(w.repo, "rev-parse", "HEAD")).toBe(w.attemptSha);
    expect(git(w.repo, "symbolic-ref", "HEAD")).toBe("refs/heads/work");
    expect(git(w.repo, "status", "--porcelain", "--untracked-files=all")).toBe("");
  }
}

const BASE = { "src/value.txt": "4\n", "tests/value.test.txt": "expect 4\n" };
// The check reads the expectation from the test file and compares it with the code's value.
const CHECK = "test \"$(cut -d' ' -f2 tests/value.test.txt)\" = \"$(cat src/value.txt)\"";

describe("runChecksAtBase (spec §4.2)", () => {
  it("passes when the attempt's code also meets the base version of a changed test", async () => {
    // A refactor of the test (same expectation, new wording) with code that still gives 4.
    const w = await workspace(BASE, { "tests/value.test.txt": "expect 4 # reworded\n" });
    expect(await ran(w, ["tests/value.test.txt"], [CHECK])).toEqual({ kind: "base-passed" });
  });

  it("fails with the command when only the changed test passes (code and test moved together)", async () => {
    const w = await workspace(BASE, { "src/value.txt": "5\n", "tests/value.test.txt": "expect 5\n" });
    expect(await ran(w, ["tests/value.test.txt"], ["true", CHECK])).toEqual({ kind: "base-failed", command: CHECK });
  });

  it("puts a deleted check file back for the run and removes it again afterwards", async () => {
    const w = await workspace({ ...BASE, "check.sh": "exit 0\n" }, { "check.sh": null });
    expect(await ran(w, ["check.sh"], ["sh check.sh"])).toEqual({ kind: "base-passed" });
    expect(existsSync(join(w.repo, "check.sh"))).toBe(false);
  });

  it("reverts only the scripts object of a package.json, keeping the attempt's other fields", async () => {
    const before = { name: "x", version: "1.0.0", scripts: { t: "base" } };
    const after = { name: "x", version: "2.0.0", extra: true, scripts: { t: "attempt" } };
    const w = await workspace({ "package.json": JSON.stringify(before) }, { "package.json": JSON.stringify(after) });
    const check = "node -e \"const p=require('./package.json');process.exit(p.scripts.t==='base'&&p.extra===true&&p.version==='2.0.0'?0:1)\"";
    expect(await ran(w, ["package.json"], [check])).toEqual({ kind: "base-passed" });
    expect(JSON.parse(readFileSync(join(w.repo, "package.json"), "utf8"))).toEqual(after);
  });

  it("leaves a file the attempt added (it has no base version)", async () => {
    const w = await workspace(BASE, { "tests/new.test.txt": "expect 4\n", "tests/value.test.txt": "expect 4 # reworded\n" });
    expect(await ran(w, ["tests/new.test.txt", "tests/value.test.txt"], ["test -f tests/new.test.txt"])).toEqual({ kind: "base-passed" });
  });

  // Task setup spec 2026-11-04 §4.6: the re-run's directory has only what the task's setup installs, so setup runs first.
  it("base run runs setup before checks", async () => {
    const w = await workspace({ ...BASE, ".gitignore": "build/\n" }, { "tests/value.test.txt": "expect 4 # reworded\n" });
    // The setup leaves an ignored marker; the check needs it. Mutation A4-M1 (skip setup) -> base-failed, red.
    const setup = ["mkdir -p build", "touch build/installed"];
    expect(await ran(w, ["tests/value.test.txt"], [`test -f build/installed && ${CHECK}`], undefined, setup)).toEqual({ kind: "base-passed" });
    // Ruling: 2026-11-04 session af2ceee1, human 「这次批准改写所有必要的判据」: the final-review fix wave (I2) has the restore
    // remove the ignored paths Orca's setup installed (they were archived with the workspace), so `build/` is gone afterwards.
    // Mutation I2-M1 (the restore keeps new ignored paths) -> true, red.
    expect(existsSync(join(w.repo, "build"))).toBe(false);
  });

  // Final-review fix wave (I2): only what appeared during the run is removed; an ignored path already there stays, and
  // without setup the restore leaves ignored paths alone as it always did.
  it("with setup, the restore removes only ignored paths that appeared; without setup it removes none", async () => {
    const w = await workspace({ ...BASE, ".gitignore": "build/\nnode_modules/\n" }, { "tests/value.test.txt": "expect 4 # reworded\n" });
    await mkdir(join(w.repo, "build"), { recursive: true }); await writeFile(join(w.repo, "build", "kept"), "x");
    const install = "mkdir -p node_modules/x build && touch node_modules/x/index.js build/new";
    expect(await ran(w, ["tests/value.test.txt"], [CHECK], undefined, [install])).toEqual({ kind: "base-passed" });
    // Mutation I2-M2 (clean every ignored path, not only new ones) -> build/kept gone, red.
    expect([existsSync(join(w.repo, "node_modules")), existsSync(join(w.repo, "build", "kept"))]).toEqual([false, true]);
    // `build/` was there before, so what setup added inside it stays (scoped to new top-level ignored paths only).
    expect(existsSync(join(w.repo, "build", "new"))).toBe(true);
    // Without setup: a check that writes an ignored path keeps it (no `ignoredBefore`, behaviour unchanged).
    expect(await ran(w, ["tests/value.test.txt"], [`mkdir -p node_modules/y && ${CHECK}`])).toEqual({ kind: "base-passed" });
    // Mutation I2-M3 (record ignoredBefore with no setup) -> false, red.
    expect(existsSync(join(w.repo, "node_modules", "y"))).toBe(true);
  });

  it("a failing setup is base-setup-failed, not base-failed", async () => {
    const w = await workspace(BASE, { "tests/value.test.txt": "expect 4 # reworded\n" });
    const seen = join(w.repo, "..", `${w.repo.split("/").pop()!}-checked`);
    dirs.push(seen);
    // Mutation A4-M2 (report it as base-failed) -> red; the check after a failed setup never runs.
    expect(await ran(w, ["tests/value.test.txt"], [`touch '${seen}'`], undefined, ["true", "exit 7"])).toEqual({ kind: "base-setup-failed", command: "exit 7" });
    expect(existsSync(seen)).toBe(false);
  });

  it("restores the workspace and rethrows when the run is aborted", async () => {
    const w = await workspace(BASE, { "tests/value.test.txt": "expect 4 # reworded\n" });
    const controller = new AbortController();
    const running = ran(w, ["tests/value.test.txt"], ["sleep 5"], controller.signal);
    setTimeout(() => controller.abort(), 200);
    await expect(running).rejects.toBeDefined();
  });
});

describe("the driver re-runs a modified check at base before landing (spec §7a.1)", () => {
  const TEST = "expect 4\n";
  async function landing(files: Record<string, string>, checks: string[]) {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["tests/**", "src/**", "a"] }], { files: () => files, requiredChecks: checks });
    await mkdir(join(t.repo, "tests"), { recursive: true }); await mkdir(join(t.repo, "src"), { recursive: true });
    await writeFile(join(t.repo, "tests", "value.test.txt"), TEST); await writeFile(join(t.repo, "src", "value.txt"), "4\n");
    hgit(t.repo, "add", "tests", "src"); hgit(t.repo, "commit", "-qm", "checks");
    const runId = await t.claim();
    return { t, runId };
  }
  /** The re-run is off the driver round (as debugRepro.test.ts's settle): a criterion waits on the clock as well as on rounds. */
  async function settle(driver: ExecutionDriver, predicate: () => boolean, ms = 30_000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error("the driver did not reach the expected state in time");
      await driver.round();
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  const land = async (t: Awaited<ReturnType<typeof landing>>["t"], runId: string, driver = t.driver()) =>
    settle(driver, () => t.body(runId).drive?.landedCommit != null || t.body(runId).state === "blocked");
  const ledgerOf = (t: Awaited<ReturnType<typeof landing>>["t"], runId: string): string => {
    const tree = hgit(t.repo, "ls-tree", "-r", "--name-only", "refs/heads/orca/g");
    return tree.includes(`.decisions/${runId}.jsonl`) ? hgit(t.repo, "show", `refs/heads/orca/g:.decisions/${runId}.jsonl`) : "";
  };

  it("says nothing when the code also passes the base version of the changed test", async () => {
    const { t, runId } = await landing({ "tests/value.test.txt": "expect 4 # reworded\n" }, [CHECK]); try {
      await land(t, runId);
      expect(t.body(runId).drive.landedCommit).not.toBeNull();
      expect(t.body(runId).drive.criteriaBase).toEqual({ result: "passed" });
      expect(listFlaggedDecisions(t.h.store, "g")).toEqual([]);
      expect(ledgerOf(t, runId)).not.toContain("orca-criteria");
    } finally { await t.h.dispose(); }
  });

  it("lands and flags when only the changed test passes, naming the base run", async () => {
    const { t, runId } = await landing({ "src/value.txt": "5\n", "tests/value.test.txt": "expect 5\n" }, [CHECK]); try {
      await land(t, runId);
      expect(t.body(runId).drive.landedCommit).not.toBeNull();
      expect(t.body(runId).drive.criteriaBase).toEqual({ result: "failed", command: CHECK });
      expect(listFlaggedDecisions(t.h.store, "g")).toEqual([expect.objectContaining({ decisionId: `${runId}/orca-criteria`, source: "test-change", state: "flagged" })]);
      const decision = JSON.parse(ledgerOf(t, runId).split("\n").find((line) => line.includes("orca-criteria"))!) as { evidence: string[] };
      expect(decision.evidence).toContain(`base-run-failed: ${CHECK}`);
    } finally { await t.h.dispose(); }
  });

  // CLI v2 spec §15.3-§15.4 (review I1, session b37f7ce9): the re-run executes the agent's required checks in the panel's
  // environment, so each runs as the run Orca dispatched: its marker and the panel's empty person directory.
  it("runs the base re-run's checks with the run's marker and the empty person directory", async () => {
    const out = await realpath(await mkdtemp(join(tmpdir(), "orca-criteria-marker-")));
    const person = join(out, "dispatched-person"), seen = join(out, "seen.txt");
    const check = `printf '%s %s\\n' "\${ORCA_DISPATCHED_RUN-unset}" "\${ORCA_PERSON_DIR-unset}" >> '${seen}'; ${CHECK}`;
    const { t, runId } = await landing({ "tests/value.test.txt": "expect 4 # reworded\n" }, [check]); try {
      await land(t, runId, createExecutionDriver({ ...t.deps, dispatchedPersonDir: person }));
      expect(t.body(runId).drive.criteriaBase).toEqual({ result: "passed" });
      // Mutation "runChecksAtBase without the dispatched env": `unset unset` -> red.
      expect(readFileSync(seen, "utf8")).toBe(`${runId} ${person}\n`);
    } finally { await t.h.dispose(); await rm(out, { recursive: true, force: true }); }
  });

  // Task setup spec 2026-11-04 §4.6: the driver hands the contract's setup to the re-run; a setup that fails there is the
  // base run's own could-not-run result, named as the base-run-failed text with the command shown as `setup: <cmd>`.
  it("a base re-run whose setup fails lands and flags, naming the setup command", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["tests/**", "src/**", "a"], contextExtra: { setupCommands: ["exit 3"] } }],
      { files: () => ({ "tests/value.test.txt": "expect 4 # reworded\n" }), requiredChecks: [CHECK] });
    try {
      await mkdir(join(t.repo, "tests"), { recursive: true }); await mkdir(join(t.repo, "src"), { recursive: true });
      await writeFile(join(t.repo, "tests", "value.test.txt"), TEST); await writeFile(join(t.repo, "src", "value.txt"), "4\n");
      hgit(t.repo, "add", "tests", "src"); hgit(t.repo, "commit", "-qm", "checks");
      const runId = await t.claim();
      await land(t, runId);
      expect(t.body(runId).drive.landedCommit).not.toBeNull();
      // Without the setup the checks would pass at base (the reworded test): the failure is the setup's.
      expect(t.body(runId).drive.criteriaBase).toEqual({ result: "failed", command: "setup: exit 3" });
      const decision = JSON.parse(ledgerOf(t, runId).split("\n").find((line) => line.includes("orca-criteria"))!) as { evidence: string[] };
      expect(decision.evidence).toContain("base-run-failed: setup: exit 3");
    } finally { await t.h.dispose(); }
  });

  // A4 fix round 1: a file only a setup command names defines the checks at C and at the landing alike. The base version
  // of the setup script fails (`exit 1`), the attempt's passes: C classifies the edit `modified` and re-runs at base, where
  // the reverted setup fails, and the landing (criteriaFlagOf) classifies it the same way and flags it.
  const SETUP = "sh scripts/setup.sh";
  async function setupLanding(baseScript: string) {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["scripts/**", "a"], contextExtra: { setupCommands: [SETUP] } }],
      { files: () => ({ "scripts/setup.sh": "exit 0\n" }), requiredChecks: ["true"] });
    await mkdir(join(t.repo, "scripts"), { recursive: true });
    await writeFile(join(t.repo, "scripts", "setup.sh"), baseScript);
    hgit(t.repo, "add", "scripts"); hgit(t.repo, "commit", "-qm", "setup script");
    return { t, runId: await t.claim() };
  }

  it("an attempt that edits only a setup-named script is classified at C and flagged at the landing", async () => {
    const { t, runId } = await setupLanding("exit 1\n"); try {
      await land(t, runId);
      expect(t.body(runId).drive.landedCommit).not.toBeNull();
      // C classified it `modified` (mutation "stepC drops setup" -> no re-run, null): the re-run's setup failed at base.
      expect(t.body(runId).drive.criteriaBase).toEqual({ result: "failed", command: `setup: ${SETUP}` });
      // Mutation "criteriaFlagOf drops setup" -> the landing sees no check-defining change, no flag: red.
      expect(listFlaggedDecisions(t.h.store, "g")).toEqual([expect.objectContaining({ decisionId: `${runId}/orca-criteria`, source: "test-change", state: "flagged" })]);
      const decision = JSON.parse(ledgerOf(t, runId).split("\n").find((line) => line.includes("orca-criteria"))!) as { evidence: string[] };
      expect(decision.evidence).toEqual(expect.arrayContaining([`base-run-failed: setup: ${SETUP}`, "changed: scripts/setup.sh"]));
    } finally { await t.h.dispose(); }
  });

  // Final-review fix wave (I2): Orca's own setup in the base re-run installs into the run's workspace, which archiveRun
  // snapshots; the restore removes it, so neither the workspace nor the archived snapshot tree holds node_modules.
  it("a base re-run's setup output is neither left in the workspace nor archived", async () => {
    const install = "mkdir -p node_modules/x && touch node_modules/x/index.js";
    const t = await driverHarness([{ taskId: "a", targetPaths: ["tests/**", "src/**", "a"], contextExtra: { setupCommands: [install] } }],
      { files: () => ({ "tests/value.test.txt": "expect 4 # reworded\n" }), requiredChecks: [CHECK] });
    try {
      await mkdir(join(t.repo, "tests"), { recursive: true }); await mkdir(join(t.repo, "src"), { recursive: true });
      await writeFile(join(t.repo, "tests", "value.test.txt"), TEST); await writeFile(join(t.repo, "src", "value.txt"), "4\n");
      await writeFile(join(t.repo, ".gitignore"), "node_modules/\n");
      hgit(t.repo, "add", "tests", "src", ".gitignore"); hgit(t.repo, "commit", "-qm", "checks");
      const runId = await t.claim();
      const driver = t.driver();
      await land(t, runId, driver);
      expect(t.body(runId).drive.criteriaBase).toEqual({ result: "passed" });
      // Mutation I2-M4 (the driver's snapshot drops the setup commands) -> node_modules stays, red.
      expect(existsSync(join(t.body(runId).drive.sourceDir, "repo", "node_modules"))).toBe(false);
      await settle(driver, () => t.body(runId).state === "settled");
      const row = t.h.store.db.prepare("SELECT body FROM outbox WHERE kind='archive' AND json_extract(body,'$.runId')=? ORDER BY rowid DESC").get(runId);
      const snapshot = JSON.parse((await readArtifact(t.h.store, (JSON.parse(String(row!.body)) as { snapshot: ArtifactRef }).snapshot)).toString("utf8")) as { tree: Array<{ path: string }> };
      const tree = snapshot.tree.map((entry) => entry.path);
      expect(tree).toContain("src/value.txt");
      expect(tree.filter((path) => path.includes("node_modules"))).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  it("a restart while that re-run is in flight recomputes its files with the setup commands", async () => {
    // Flake fix (A4): the restart happens at a point the test controls, and each wait is on a state, never a duration.
    // The base version of the setup script marks that it started and then blocks until it is killed; once `gate`
    // exists it fails at once, so the resumed re-run ends as soon as it reaches the setup.
    const out = await realpath(await mkdtemp(join(tmpdir(), "orca-criteria-restart-")));
    const started = join(out, "started"), gate = join(out, "gate");
    const until = async (what: string, predicate: () => boolean): Promise<void> => {
      const deadline = Date.now() + 30_000;
      while (!predicate()) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };
    const { t, runId } = await setupLanding(`if [ -e '${gate}' ]; then exit 1; fi; : > '${started}'; sleep 600; exit 1\n`); try {
      const first = t.driver();
      await settle(first, () => t.body(runId).drive?.debugRepro?.state === "checking");
      expect(t.body(runId).drive.debugRepro.check).toBe("criteria-base");
      // The first re-run is inside its setup: the base version of scripts/setup.sh is checked out in the workspace.
      await until("the first re-run's setup to start", () => existsSync(started));
      const repo = join(t.body(runId).drive.sourceDir, "repo");
      expect(hgit(repo, "status", "--porcelain")).not.toBe("");
      await writeFile(gate, "");
      await first.stop();
      // stop() kills the setup but does not wait for the aborted re-run's restore; the restore is what puts the attempt's
      // scripts/setup.sh back, so the workspace being clean (and unlocked) is the state that says it finished.
      await until("the aborted re-run's restore", () => !existsSync(join(repo, ".git", "index.lock")) && hgit(repo, "status", "--porcelain") === "");
      await land(t, runId, createExecutionDriver(t.deps));
      expect({ state: t.body(runId).state, blocked: t.body(runId).drive.blockedReason }).toEqual({ state: "landed", blocked: null });
      // Mutation "the resume path's classifyCriteriaChange drops setup" -> no file reverted, the attempt's setup passes,
      // base-passed: red.
      expect(t.body(runId).drive.criteriaBase).toEqual({ result: "failed", command: `setup: ${SETUP}` });
    } finally { await t.h.dispose(); await rm(out, { recursive: true, force: true }); }
  });

  it("does not re-run a weakening (it is flagged whatever the base says)", async () => {
    const { t, runId } = await landing({ "tests/value.test.txt": "it.skip('value', () => {});\n" }, [CHECK]); try {
      await land(t, runId);
      expect(t.body(runId).drive.landedCommit).not.toBeNull();
      expect(t.body(runId).drive.criteriaBase).toBeNull();
      expect(listFlaggedDecisions(t.h.store, "g")).toEqual([expect.objectContaining({ decisionId: `${runId}/orca-criteria`, state: "flagged" })]);
    } finally { await t.h.dispose(); }
  });

  it("a restart while the re-run is in flight restores the workspace and runs it again", async () => {
    const slow = `sleep 2 && ${CHECK}`;
    const { t, runId } = await landing({ "tests/value.test.txt": "expect 4 # reworded\n" }, [slow]); try {
      const first = t.driver();
      await settle(first, () => t.body(runId).drive?.debugRepro?.state === "checking");
      expect(t.body(runId).drive.debugRepro.check).toBe("criteria-base");
      // Not a reproduce-first check: the panel's run view does not show it as one.
      expect(readControlGroup(t.h.store, "epoch", "g").runs.find((run) => run.runId === runId)!.debugRepro).toBeUndefined();
      await first.stop();
      // stop() aborts the re-run but does not wait for its own restore (as for the reproduce-first check); a real restart is
      // a new process, so the criterion waits for the aborted run to put the workspace back before the next driver starts.
      const repo = join(t.body(runId).drive.sourceDir, "repo"), deadline = Date.now() + 15_000;
      while ((existsSync(join(repo, ".git", "index.lock")) || hgit(repo, "status", "--porcelain") !== "") && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
      await land(t, runId, createExecutionDriver(t.deps));
      expect({ state: t.body(runId).state, blocked: t.body(runId).drive.blockedReason }).toEqual({ state: "landed", blocked: null });
      expect(t.body(runId).drive.criteriaBase).toEqual({ result: "passed" });
      expect(t.body(runId).drive.debugRepro).toBeNull();
      expect(listFlaggedDecisions(t.h.store, "g")).toEqual([]);
    } finally { await t.h.dispose(); }
  });
});
