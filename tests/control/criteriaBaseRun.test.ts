import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
async function ran(w: Awaited<ReturnType<typeof workspace>>, files: string[], checks: string[], signal?: AbortSignal) {
  try {
    return await runChecksAtBase({ workdir: w.repo, base: w.base, attemptSha: w.attemptSha, files, requiredChecks: checks, timeoutMs: 10_000, ...(signal ? { signal } : {}) });
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
