import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { materialiseConflict, rebuildMergeCommit, synthesizeReconcileContract } from "../../src/scheduler/reconcile.js";
import type { PlanTask } from "../../src/scheduler/planFile.js";
import { contractObject, git, makeSandbox, seedConflictingCopy } from "./sandbox.js";

const side = (taskId: string): PlanTask => ({ taskId, contract: `/outside/${taskId}.json`, dependsOn: [] });

describe("spec 5.2: materialising a conflict and synthesizing its reconciliation contract", () => {
  it("materialises the conflict as a commit, because a fresh worktree cannot show it", async () => {
    // ccloop opens a clean detached worktree, and conflict state lives in the
    // index, not in any commit -- so an agent spawned the ordinary way sees
    // nothing to reconcile. Committing the conflicted tree turns the markers
    // into ordinary text the agent can read.
    const s = await makeSandbox();
    try {
      const f = await seedConflictingCopy(s);
      const c = await materialiseConflict(f.copyPath, f.wTip, f.incomingRef);

      // Read out of the commit, not off disk: a marker sitting in the working
      // tree is exactly the state ccloop's fresh worktree would NOT show, so
      // asserting on the file would pass for an implementation that never
      // committed anything.
      expect(await git(f.copyPath, ["show", `${c.conflictCommit}:${f.path}`])).toContain("<<<<<<<");
      expect(c.conflictedPaths).toEqual([f.path]);
    } finally {
      await s.cleanup();
    }
  });

  it("enumerates one block per conflicting region, with each side's lines kept apart", async () => {
    // spec 5.1 splits the work four ways and gives "enumerate the conflict
    // blocks" to code, because the model's job is to classify each block and
    // the human's is to take the semantic leftovers -- neither can act on a
    // blob of file text. One region cannot tell "enumerate them" apart from
    // "return the first one", so the fixture conflicts in two places.
    const s = await makeSandbox();
    try {
      const f = await seedConflictingCopy(s);
      const c = await materialiseConflict(f.copyPath, f.wTip, f.incomingRef);

      expect(c.blocks.map((b) => b.path)).toEqual([f.path, f.path]);
      // "ours" is W's tip, which the merge checked out first; "theirs" is the
      // incoming attempt. Getting these the wrong way round would hand the
      // reconciler a contract that attributes each side's intent to the other.
      expect(c.blocks.map((b) => b.ours)).toEqual([["two-target"], ["nine-target"]]);
      expect(c.blocks.map((b) => b.theirs)).toEqual([["two-copy"], ["nine-copy"]]);
      expect(c.blocks[0].startLine).toBeLessThan(c.blocks[1].startLine);
    } finally {
      await s.cleanup();
    }
  });

  it("writes the synthesized contract into runsDir, outside the target repo", async () => {
    // Which is why it needs no exception to section 2.3's up-front rejection.
    const s = await makeSandbox();
    try {
      const f = await seedConflictingCopy(s);
      const conflict = await materialiseConflict(f.copyPath, f.wTip, f.incomingRef);
      const contracts = new Map<string, unknown>([
        ["T1", await contractObject(s, "T1", { goal: "rename the helper", targetPaths: [f.path], requiredChecks: ["true"] })],
        ["T2", await contractObject(s, "T2", { goal: "inline the helper", targetPaths: [f.path], requiredChecks: ["false"] })],
      ]);

      const r = await synthesizeReconcileContract(side("T1"), side("T2"), contracts, s.runsDir, conflict);

      expect("path" in r && r.path.startsWith(s.runsDir)).toBe(true);
      const written = JSON.parse(await readFile((r as { path: string }).path, "utf8")) as {
        objective: { goal: string };
        context: { repoPath: string; targetPaths: string[] };
        verification: { requiredChecks: string[] };
      };
      // The reconciliation runs in the copy, never in the person's repository
      // (spec 4.2.1), and it runs against the two sides' checks together
      // (5.1's third row) -- both are facts about the file, so both are read
      // back out of the file.
      expect(written.context.repoPath).toBe(f.copyPath);
      expect(written.context.targetPaths).toEqual([f.path]);
      expect(written.verification.requiredChecks.sort()).toEqual(["false", "true"]);
      expect(written.objective.goal).toContain("rename the helper");
      expect(written.objective.goal).toContain("inline the helper");
    } finally {
      await s.cleanup();
    }
  });

  it("keeps the contract inside runsDir even when a taskId is shaped like a path escape", async () => {
    // The placement above is the whole reason 2.3 needs no exception for this
    // file, and taskId is a free string out of a plan file: a "../.." in it
    // would otherwise put a contract wherever the plan's author aimed it,
    // including back inside targetRepo.
    //
    // 🔴 Three levels of "..", measured rather than guessed. Two is not enough
    // and this criterion shipped decorative with it: the filename starts
    // "contract-reconcile-", so path.join's first ".." only pops that segment
    // back off and the result lands in runsDir either way. Mutation M-SLUG
    // (replace the sanitiser with the identity function) passed against the
    // two-level version and fails against this one.
    const s = await makeSandbox();
    try {
      const f = await seedConflictingCopy(s);
      const conflict = await materialiseConflict(f.copyPath, f.wTip, f.incomingRef);
      const escape = "../../../escape";
      const contracts = new Map<string, unknown>([
        [escape, await contractObject(s, "T1", { goal: "one side", targetPaths: [f.path], requiredChecks: ["true"] })],
        ["T2", await contractObject(s, "T2", { goal: "other side", targetPaths: [f.path], requiredChecks: ["true"] })],
      ]);

      const r = await synthesizeReconcileContract(side(escape), side("T2"), contracts, s.runsDir, conflict);

      expect("path" in r && r.path.startsWith(s.runsDir)).toBe(true);
      expect((r as { path: string }).path).not.toContain("..");
    } finally {
      await s.cleanup();
    }
  });
});

describe("spec 5.2 step 4: rebuilding the merge commit", () => {
  it("rebuilds a merge commit whose two parents are exactly the W tip and the incoming ref", async () => {
    // Hand-constructing git history is the most fragile step in this design, so
    // the criterion measures the object that comes out rather than the sequence
    // of commands that made it.
    const s = await makeSandbox();
    try {
      const f = await seedConflictingCopy(s);
      const conflict = await materialiseConflict(f.copyPath, f.wTip, f.incomingRef);
      // Any tree in the copy would do; the conflict commit's is the one a real
      // reconciliation starts from, and using a tree that is NOT the tree of
      // either parent is what makes the third assertion able to fail.
      const tree = (await git(f.copyPath, ["rev-parse", `${conflict.conflictCommit}^{tree}`])).trim();

      const sha = await rebuildMergeCommit(f.copyPath, f.wTip, f.incomingRef, tree, "merge");

      const parents = (await git(f.copyPath, ["rev-list", "--parents", "-n", "1", sha]))
        .trim()
        .split(" ")
        .slice(1);
      // Order matters and is asserted as an ordered list: `ours` in every
      // later three-way merge, and `git log --first-parent` on W, both read
      // parent 1. Swapping the two would attribute W's own history to the
      // incoming task.
      expect(parents).toEqual([f.wTip, (await git(f.copyPath, ["rev-parse", f.incomingRef])).trim()]);
      expect((await git(f.copyPath, ["rev-parse", `${sha}^{tree}`])).trim()).toBe(tree);
    } finally {
      await s.cleanup();
    }
  });
});
