import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { prepareRange } from "../../src/control/checks/pass.js";
import { cutRange, type RangeGroup } from "../../src/control/checks/range.js";
import { checksRead } from "../../src/control/checks/settings.js";
import { readCheckState, writeCheckState } from "../../src/control/checks/state.js";
import { gitChild } from "../../src/control/integrationGit.js";
import { controlWorkspaceRoots } from "../../src/control/workspace.js";
import { checksWorld, g } from "./fixtures/checksWorld.js";

/**
 * Checks spec 2026-10-22 §5, criterion 4 (integration-check kind; the model review's runs are Task 9): one watermark per
 * (project, kind, target) says "checked up to <commit>". It moves when a run completes, never at its start, never on an
 * error or an interruption -- so a range is never checked twice and never skipped. Turning a check on does not check
 * the whole history: the first evaluation only sets the watermark.
 */
const state = (w: Awaited<ReturnType<typeof checksWorld>>) => readCheckState(w.h.store, "repo", "integration-check", "main");

describe("the check watermark (integration-check kind)", () => {
  it("first evaluation sets W to the target head and runs nothing; a completed run moves W to H; its start does not", async () => {
    const w = await checksWorld(); try {
      w.setProjectChecks({ integrationCheck: { enabled: true, command: "true" } });
      w.land("old"); // a group that landed before the check was ever evaluated
      const head0 = g(w.repo, "rev-parse", "main");
      expect(await w.pass()).toMatchObject({ started: [], initialised: ["repo"] });
      expect(state(w)).toMatchObject({ watermark: head0, lastStartAt: null, runSeq: 0, last: { state: "initialised", to: head0 } });
      await w.commitLand("g1", { "a.txt": "1\n" });
      const head = await w.commitLand("g2", { "b.txt": "2\n" });
      // The start is recorded, the watermark not yet moved (the job has not ended).
      const started = await w.service.checksPass();
      expect(started.started).toEqual(["repo"]);
      expect(state(w)).toMatchObject({ watermark: head0, lastStartAt: w.now(), runSeq: 1, last: { state: "running", from: head0, to: head, groups: ["g1", "g2"] } });
      await w.service.checksSettled();
      expect(state(w)).toMatchObject({ watermark: head, failureStreak: 0, last: { state: "passed", groups: ["g1", "g2"] } });
      // The settings read carries each check's state (spec §4.3, §7: watermark, last run).
      // The model review is on by default (§3), so its own (initialised) state is listed beside it.
      expect(checksRead(w.h.store, "repo").state).toEqual([
        { kind: "integration-check", target: "main", state: state(w) },
        { kind: "model-review", target: "main", state: readCheckState(w.h.store, "repo", "model-review", "main") },
      ]);
      expect(checksRead(w.h.store, null).state).toEqual([]);
      // Nothing new: nothing starts.
      w.advance(7 * 3_600_000);
      expect((await w.pass()).started).toEqual([]);
    } finally { await w.h.dispose(); }
  });

  it("a red run still moves W (a debug group owns the fix); an errored run leaves W and adds to the streak", async () => {
    const w = await checksWorld(); try {
      w.setProjectChecks({ integrationCheck: { enabled: true, command: "false" } });
      await w.pass();
      const head0 = g(w.repo, "rev-parse", "main");
      await w.commitLand("g1", { "a.txt": "1\n" });
      const head1 = await w.commitLand("g2", { "b.txt": "2\n" });
      await w.pass();
      expect(state(w)).toMatchObject({ watermark: head1, last: { state: "failed" } });
      expect(state(w)!.last!.debugGroupIds).toHaveLength(1);
      expect(head0).not.toBe(head1);
      // Errored: the check's worktree cannot be made (its root is a file).
      await w.commitLand("g3", { "c.txt": "3\n" });
      const head3 = await w.commitLand("g4", { "d.txt": "4\n" });
      const roots = controlWorkspaceRoots(w.h.store.stateDir);
      g(w.repo, "worktree", "prune");
      await import("node:fs/promises").then((fs) => fs.rm(roots.workspacesRoot, { recursive: true, force: true }));
      await writeFile(roots.workspacesRoot, "not a directory\n");
      w.advance(7 * 3_600_000);
      await w.pass();
      expect(state(w)).toMatchObject({ watermark: head1, failureStreak: 1, last: { state: "errored", to: head3 } });
    } finally { await w.h.dispose(); }
  });

  it("a run cut off by an Orca stop is forgotten: W stays, the streak does not count it, the next pass starts again", async () => {
    const w = await checksWorld(); try {
      w.setProjectChecks({ integrationCheck: { enabled: true, command: "true" } });
      await w.pass();
      const head0 = g(w.repo, "rev-parse", "main");
      await w.commitLand("g1", { "a.txt": "1\n" });
      const head = await w.commitLand("g2", { "b.txt": "2\n" });
      const s = state(w)!;
      w.h.store.transaction(() => writeCheckState(w.h.store, "repo", "integration-check", "main", { ...s, failureStreak: 1, lastStartAt: w.now() - 3_600_000, runSeq: 1, last: { state: "running", at: w.now() - 3_600_000, from: head0, to: head, groups: ["g1", "g2"], detail: null, reviewGroupId: null, debugGroupIds: [], recordHash: null } }));
      expect((await w.service.checksPass()).started).toEqual(["repo"]);
      // The interruption was recorded before the new start (streak unchanged at 1, W unchanged).
      expect(state(w)).toMatchObject({ watermark: head0, failureStreak: 1, runSeq: 2, last: { state: "running" } });
      await w.service.checksSettled();
      expect(state(w)).toMatchObject({ watermark: head, failureStreak: 0, last: { state: "passed" } });
    } finally { await w.h.dispose(); }
  });

  it("a rewritten target ranges from the merge-base and is marked rebased; an unreadable target is recorded once", async () => {
    const w = await checksWorld(); try {
      w.setProjectChecks({ integrationCheck: { enabled: true, command: "true" } });
      const base = g(w.repo, "rev-parse", "main");
      await w.commitLand("g0", { "z.txt": "0\n" });
      await w.pass(); // W = g0's commit
      // Someone resets main to base and lands two groups on top: W is no longer an ancestor of H.
      g(w.repo, "reset", "-q", "--hard", base);
      await w.commitLand("g1", { "a.txt": "1\n" });
      const head = await w.commitLand("g2", { "b.txt": "2\n" });
      await w.pass();
      expect(state(w)).toMatchObject({ watermark: head, rebased: true, last: { state: "passed", from: base, groups: ["g1", "g2"] } });
      // The target disappears: one errored record, not one per tick.
      g(w.repo, "branch", "-m", "main", "gone");
      await w.pass();
      const first = state(w)!.last!;
      expect(first).toMatchObject({ state: "errored", detail: "target unreadable: main" });
      w.advance(60_000);
      await w.pass();
      expect(state(w)!.last).toEqual(first);
    } finally { await w.h.dispose(); }
  });

  it("a tick on a target whose head is the watermark costs exactly one git call (Review Focus 3)", async () => {
    const w = await checksWorld(); try {
      w.setProjectChecks({ integrationCheck: { enabled: true, command: "true" } });
      await w.commitLand("g1", { "a.txt": "1\n" });
      await w.commitLand("g2", { "b.txt": "2\n" });
      await w.pass();
      const calls: string[][] = [];
      const counting = (repo: string, args: string[]) => { calls.push(args); return gitChild(repo, args); };
      expect(await prepareRange(w.h.store, counting, w.repo, "repo", "integration-check", "main", w.now())).toEqual({ kind: "idle" });
      expect(calls).toEqual([["rev-parse", "--verify", "--quiet", "refs/heads/main^{commit}"]]);
    } finally { await w.h.dispose(); }
  });
});

/**
 * Checks spec §5.2 (a cut range moves W to the last included group's commit, the rest is the next range): a group off
 * the target's first-parent history sorts last, so a cut can leave it out although its commit is an ancestor of the new
 * `to` -- W would then pass it and it would never be reviewed. The cut keeps every such group.
 */
describe("cutting a range to maxGroupsPerReview", () => {
  const group = (groupId: string, integratedCommit: string) => ({ groupId, integratedCommit, target: "main", paths: [] }) as unknown as RangeGroup;
  // Ancestry: a <- b <- c on the chain; x (off the chain) is an ancestor of b; y is not.
  const ancestors: Record<string, string[]> = { b: ["a", "x"], c: ["a", "b", "x"] };
  const git = async (_repo: string, args: string[]) => ({ code: args[0] === "merge-base" && args[1] === "--is-ancestor" && (ancestors[args[3]!] ?? []).includes(args[2]!) ? 0 : 1, stdout: "", stderr: "" });
  const range = { from: "w", to: "H", rebased: false, groups: [group("ga", "a"), group("gb", "b"), group("gc", "c"), group("gx", "x"), group("gy", "y")] };

  it("keeps an excluded group whose commit is an ancestor of the new to; leaves out the rest", async () => {
    const cut = await cutRange(git, "/repo", range, 2);
    expect(cut).toEqual({ to: "b", groups: [range.groups[0], range.groups[1], range.groups[3]] });
  });

  it("an uncut range is returned whole, to = H", async () => {
    expect(await cutRange(git, "/repo", range, 5)).toEqual({ to: "H", groups: range.groups });
  });
});

