import { describe, expect, it } from "vitest";
import type { ExecutionDriver } from "../../src/control/executionDriver.js";
import { readRunActivity } from "../../src/control/activity.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

// Tester follow-up E §4 (#245): only a failed post-merge check (ruling R2) left anything behind, in the block reason, so a
// person could not tell a landing whose merged tree was re-checked and passed from one that needed no check. Every landing
// through stepD's clean merge now records what happened on the drive (`postMergeCheck`), and a check that ran writes a
// `post-merge-check` activity row in the transaction of the landing (passed) or of the block (failed). Not-needed writes
// the drive field only.

const LANDED = ["landed", "settled"];

// Off-round check: wall-clock deadline, as driverPostMergeCheck.test.ts measures it.
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

type Harness = Awaited<ReturnType<typeof driverHarness>>;
const postMergeRows = (t: Harness, runId: string) => readRunActivity(t.h.store, runId, 200).filter((entry) => entry.kind === "post-merge-check");

describe("post-merge checks leave a record (tester follow-up E §4, #245)", { timeout: 60_000 }, () => {
  it("a failed check records the command, its exit and output tail on the drive and in one activity row beside the block", async () => {
    const check = "echo pair-red-output; test ! -f a || test ! -f b";
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }], { requiredChecks: [check] }); try {
      const ids = [await t.claim(), await t.claim()];
      const driver = t.driver();
      await untilDeadline(driver, () => ids.some((id) => t.body(id).state === "blocked"));
      const second = ids.find((id) => t.body(id).state === "blocked")!, first = ids.find((id) => id !== second)!;
      await untilDeadline(driver, () => LANDED.includes(t.body(first).state));
      const drive = t.body(second).drive;
      const tip = git(t.repo, "rev-parse", "refs/heads/orca/g");
      const record = drive.postMergeCheck;
      expect(record.result).toBe("failed");
      expect(record.why).toBeUndefined();
      expect(record.attemptSha).toBe(drive.attemptSha);
      expect(record.oldTip).toBe(tip);
      // The merge that was checked and never landed: its first parent is the tip, its second the attempt.
      expect(record.mergedSha).not.toBe(tip);
      expect(git(t.repo, "rev-parse", `${record.mergedSha}^1`)).toBe(tip);
      expect(git(t.repo, "rev-parse", `${record.mergedSha}^2`)).toBe(drive.attemptSha);
      expect(record.commands).toHaveLength(1);
      expect(record.commands[0].command).toBe(check);
      expect(record.commands[0].exit).toBe("1");
      expect(Number.isSafeInteger(record.commands[0].ms) && record.commands[0].ms >= 0).toBe(true);
      expect(record.tail).toBe("pair-red-output");
      const rows = postMergeRows(t, second);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.body).toEqual(record);
      expect(rows[0]!.taskId).toBe(t.body(second).taskId);
      // The block and the row are one write: the row is not older than the run-blocked row it explains.
      const blockedRow = readRunActivity(t.h.store, second, 200).find((entry) => entry.kind === "run-blocked")!;
      expect(rows[0]!.seq).toBe(blockedRow.seq + 1);
      // The first landing's merge was onto the tip its attempt was tested on.
      expect(t.body(first).drive.postMergeCheck).toMatchObject({ result: "not-needed", why: "fast-forward", commands: [] });
    } finally { await t.h.dispose(); }
  });

  it("a passed check records every command it ran, lands with the merge it checked, and writes one activity row", async () => {
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }], { requiredChecks: ["test -f base.txt", "true"] }); try {
      const ids = [await t.claim(), await t.claim()];
      const driver = t.driver();
      await untilDeadline(driver, () => ids.every((id) => LANDED.includes(t.body(id).state)) || ids.some((id) => t.body(id).state === "blocked"));
      expect(ids.every((id) => LANDED.includes(t.body(id).state))).toBe(true);
      const [first, second] = [...ids].sort((x, y) => (isAncestor(t.repo, t.body(x).drive.landedCommit, t.body(y).drive.landedCommit) ? -1 : 1));
      const drive = t.body(second!).drive;
      expect(drive.postMergeCheck.result).toBe("passed");
      expect(drive.postMergeCheck.why).toBeUndefined();
      expect(drive.postMergeCheck.tail).toBeUndefined();
      expect(drive.postMergeCheck.mergedSha).toBe(drive.landedCommit);
      expect(drive.postMergeCheck.oldTip).toBe(t.body(first!).drive.landedCommit);
      expect(drive.postMergeCheck.attemptSha).toBe(drive.attemptSha);
      expect(drive.postMergeCheck.commands.map((c: { command: string; exit: string }) => [c.command, c.exit])).toEqual([["test -f base.txt", "0"], ["true", "0"]]);
      const rows = postMergeRows(t, second!);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.body).toEqual(drive.postMergeCheck);
      // Not-needed writes the drive field only.
      expect(t.body(first!).drive.postMergeCheck).toMatchObject({ result: "not-needed", why: "fast-forward" });
      expect(postMergeRows(t, first!)).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  it("a merge onto the tip the attempt was based on records not-needed (fast-forward) and writes no activity row", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      const driver = t.driver();
      await untilDeadline(driver, () => LANDED.includes(t.body(runId).state));
      const drive = t.body(runId).drive;
      expect(drive.postMergeCheck).toEqual({ result: "not-needed", why: "fast-forward", attemptSha: drive.attemptSha, mergedSha: drive.landedCommit, oldTip: drive.base, commands: [] });
      expect(postMergeRows(t, runId)).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  it("a merge onto a tip that moved by a tree-neutral commit records not-needed (tree-equal)", async () => {
    let repo = "";
    let moved = "";
    const t = await driverHarness([{ taskId: "a" }], {
      // While the attempt is collected (its base fixed, D not yet run), orca/g gains a commit that changes no file.
      duringCollect: async () => {
        const base = git(repo, "rev-parse", "refs/heads/orca/g");
        moved = git(repo, "commit-tree", git(repo, "rev-parse", `${base}^{tree}`), "-p", base, "-m", "person: an empty commit");
        git(repo, "update-ref", "refs/heads/orca/g", moved, base);
      },
    });
    repo = t.repo;
    try {
      const runId = await t.claim();
      const driver = t.driver();
      await untilDeadline(driver, () => LANDED.includes(t.body(runId).state) || t.body(runId).state === "blocked");
      expect(moved).not.toBe("");
      expect(moved).not.toBe(t.body(runId).drive.base);
      const drive = t.body(runId).drive;
      expect(LANDED).toContain(t.body(runId).state);
      expect(drive.postMergeCheck).toMatchObject({ result: "not-needed", why: "tree-equal", oldTip: moved, mergedSha: drive.landedCommit, commands: [] });
      expect(postMergeRows(t, runId)).toEqual([]);
    } finally { await t.h.dispose(); }
  });
  // `no-required-checks` and `no-task` have no criterion: a confirmed plan refuses a contract with no required checks
  // (control-plan-rejected:contract-shape) and every driver work run has a task, so neither is reachable from a fixture.
});
