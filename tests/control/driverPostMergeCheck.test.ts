import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ExecutionDriver } from "../../src/control/executionDriver.js";
import { resumeBlockedDriverRun } from "../../src/control/driveRecord.js";
import { postMergeCheckPathOf } from "../../src/control/workspace.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

// Ruling R2 (#241, plan 2026-11-10 tester follow-up B, T6): a task's required checks passed on its attempt's tree. When it
// lands by a clean merge onto a group tip it was not tested against, the merged tree is new -- the tester's case was two
// parallel tasks, each green alone, that broke two tests together while the group reached done. The checks run again on
// the merged tree before orca/<group> moves; a red keeps the ref where it was and blocks the run at D by the command.
// The synthetic ccloop runs no checks, so every invocation a criterion records here is Orca's own.

const LANDED = ["landed", "settled"];

// The check runs off the driver round (as the reproduce-first and multi-directory checks do), so its progress is
// wall-clock time, not rounds: rounds 50 ms apart up to a deadline (driverReconcile.test.ts's measured reason).
async function untilDeadline(driver: ExecutionDriver, predicate: () => boolean, deadlineMs = 20_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (!predicate() && Date.now() < deadline) {
    await driver.round();
    if (!predicate()) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!predicate()) throw new Error("the driver did not reach the expected state before the deadline");
}

const isAncestor = (repo: string, commit: string, of: string): boolean => {
  try { git(repo, "merge-base", "--is-ancestor", commit, of); return true; } catch { return false; }
};

describe("R2: a clean merge onto an untested tip re-runs the task's checks (#241)", { timeout: 60_000 }, () => {
  it("blocks the second of two tasks green alone but red together by the failing command, the ref unmoved; recovery retry lands it once the branch is fixed", async () => {
    // Green on a's tree alone and on b's alone; red on a tree holding both, unless a person added `fixed`.
    const check = "test ! -f a || test ! -f b || test -f fixed";
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }], { requiredChecks: [check] }); try {
      const ids = [await t.claim(), await t.claim()];
      const driver = t.driver();
      await untilDeadline(driver, () => ids.some((id) => t.body(id).state === "blocked") || ids.every((id) => LANDED.includes(t.body(id).state)));
      const blocked = ids.filter((id) => t.body(id).state === "blocked");
      expect(blocked).toHaveLength(1);
      const second = blocked[0]!, first = ids.find((id) => id !== second)!;
      await untilDeadline(driver, () => LANDED.includes(t.body(first).state));
      const drive = t.body(second).drive;
      expect(drive.blockedAt).toBe("D");
      expect(drive.blockedReason.split("\n")[0]).toBe(`post-merge-check-failed:${check}`);
      expect(drive.blockedReason).toContain("exited 1");
      // The way out is named on the block: a person fixes the group branch, then recovery retry lands again.
      expect(drive.blockedReason).toContain(`orca recovery retry --run ${second}`);
      expect(drive.landedCommit).toBeNull();
      const tip = git(t.repo, "rev-parse", "refs/heads/orca/g");
      expect(tip).toBe(t.body(first).drive.landedCommit);
      expect(isAncestor(t.repo, drive.attemptSha, tip)).toBe(false);
      // More rounds change nothing: the block holds and the ref stays.
      for (let i = 0; i < 3; i += 1) await driver.round();
      expect(t.body(second).state).toBe("blocked");
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(tip);
      expect(existsSync(postMergeCheckPathOf(t.deps.roots, second))).toBe(false);
      expect(git(t.repo, "worktree", "list", "--porcelain")).not.toContain(postMergeCheckPathOf(t.deps.roots, second));

      // A person's fix on orca/g, then recovery retry (resumeBlockedDriverRun is what it does to a driver run blocked at D).
      const fix = join(t.h.root, "fix");
      git(t.repo, "worktree", "add", "-q", fix, "orca/g");
      writeFileSync(join(fix, "fixed"), "fixed\n");
      git(fix, "add", "fixed");
      git(fix, "commit", "-qm", "person: fix the pair");
      git(t.repo, "worktree", "remove", fix);
      const fixedTip = git(t.repo, "rev-parse", "refs/heads/orca/g");
      expect(resumeBlockedDriverRun(t.h.store, second)).toBe(true);
      await untilDeadline(driver, () => LANDED.includes(t.body(second).state) || t.body(second).state === "blocked");
      expect(LANDED).toContain(t.body(second).state);
      expect(git(t.repo, "rev-parse", `${t.body(second).drive.landedCommit}^1`)).toBe(fixedTip);
    } finally { await t.h.dispose(); }
  });

  it("runs the checks once, in its own scratch worktree, for a clean merge onto a moved tip, and that merge lands when they pass", async () => {
    const log = join(mkdtempSync(join(tmpdir(), "orca-r2-")), "calls");
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }], { requiredChecks: [`echo "$PWD" >> '${log}'; test -f base.txt`] }); try {
      const ids = [await t.claim(), await t.claim()];
      const driver = t.driver();
      await untilDeadline(driver, () => ids.every((id) => LANDED.includes(t.body(id).state)) || ids.some((id) => t.body(id).state === "blocked"));
      expect(ids.map((id) => t.body(id).state).every((state) => LANDED.includes(state))).toBe(true);
      const [first, second] = [...ids].sort((x, y) => (isAncestor(t.repo, t.body(x).drive.landedCommit, t.body(y).drive.landedCommit) ? -1 : 1));
      expect(git(t.repo, "rev-parse", `${t.body(second!).drive.landedCommit}^1`)).toBe(t.body(first!).drive.landedCommit);
      // One invocation: the second landing's, in its post-merge worktree; the first landed by a fast-forward-equivalent merge.
      const calls = readFileSync(log, "utf8").trim().split("\n");
      expect(calls.map((path) => basename(path))).toEqual([basename(postMergeCheckPathOf(t.deps.roots, second!))]);
      expect(git(t.repo, "show", "refs/heads/orca/g:a")).toBe("a");
      expect(git(t.repo, "show", "refs/heads/orca/g:b")).toBe("b");
    } finally { await t.h.dispose(); }
  });

  it("runs no extra check when the landing merges onto the tip the attempt was tested on", async () => {
    const log = join(mkdtempSync(join(tmpdir(), "orca-r2-")), "calls");
    const t = await driverHarness([{ taskId: "a" }], { requiredChecks: [`echo "$PWD" >> '${log}'; true`] }); try {
      const runId = await t.claim();
      const driver = t.driver();
      await untilDeadline(driver, () => LANDED.includes(t.body(runId).state));
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(t.body(runId).drive.landedCommit);
      expect(existsSync(log)).toBe(false);
    } finally { await t.h.dispose(); }
  });
});
