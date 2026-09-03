import { describe, expect, it } from "vitest";
import {
  makeSandbox,
  runCli,
  seedLyingPlanWhoseReconciliationFails,
  seedUnreconcilableLyingPlan,
  showFileAt,
} from "../sandbox.js";

// Task 12 fix round 1, finding 2. S3 measures the reconciliation that WORKS;
// these two measure the two ways it can fail to work, each of which was an
// escalation branch with no criterion. Both are spec 5.4's shape -- stop at the
// merge point, exit 3, keep the copy -- reached by two different conditions,
// and the point of separating them is that a mutation deleting one must not be
// caught by the other.
describe("S3's escalations (spec 5.1 third row / 5.4)", () => {
  it("refuses to land a reconciliation that still has conflict markers in it", async () => {
    // The hole neither task's requiredChecks can see. Both tasks create
    // shared.txt only if it is missing -- an ordinary shape -- so in the
    // reconciliation worktree, where it is present as the conflicted text,
    // every required check is a no-op and reports success. ccloop therefore
    // says `succeeded` over a tree full of conflict markers, and the only
    // thing standing between that tree and W is markersRemaining.
    // Mutation `M-MARKERS-CALL`.
    const s = await makeSandbox();
    try {
      const p = await seedUnreconcilableLyingPlan(s);
      const rc = await runCli(["run", p.planPath, "--adapter-config", p.adapterConfig]);

      expect(rc).toBe(3);
      // W carries T1's landing and nothing of T2's: the escalation happened
      // instead of a landing, not as well as one.
      expect(await showFileAt(s.targetRepo, p.workBranch, "a.txt")).toBe("a1\n");
      expect(await showFileAt(s.targetRepo, p.workBranch, "b.txt")).toBeNull();
      // The whole point. Without the check this is the conflicted text.
      expect(await showFileAt(s.targetRepo, p.workBranch, "shared.txt")).toBe("t1\n");
    } finally {
      await s.cleanup();
    }
  }, 300_000);

  it("refuses to land when the reconciliation run itself did not succeed", async () => {
    // T2's last required check passes in its own attempt worktree (which
    // clones at the layer base, before T1 landed) and fails in the
    // reconciliation's (whose base is the conflict commit, which already has
    // T1's file). maxAttempts is pinned to 1 in the synthesized contract, so
    // the rejected verification is terminal.
    //
    // ⚠️ The two checks BEFORE it still run, so the reconciled tree has no
    // markers left in it: this criterion is reddened by deleting the terminal
    // status guard and by nothing else. Mutation `M-RECONOUTCOME`.
    const s = await makeSandbox();
    try {
      const p = await seedLyingPlanWhoseReconciliationFails(s);
      const rc = await runCli(["run", p.planPath, "--adapter-config", p.adapterConfig]);

      expect(rc).toBe(3);
      expect(await showFileAt(s.targetRepo, p.workBranch, "a.txt")).toBe("a1\n");
      expect(await showFileAt(s.targetRepo, p.workBranch, "b.txt")).toBeNull();
      expect(await showFileAt(s.targetRepo, p.workBranch, "shared.txt")).toBe("t1\n");
    } finally {
      await s.cleanup();
    }
  }, 300_000);
});
