import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { undoHowIsExecutable } from "../../../src/ledger/undoExecutable.js";
import {
  makeSandbox,
  runCli,
  seedLyingPlanWhoseReconciliationFails,
  seedUnreconcilableLyingPlan,
  showFileAt,
} from "../sandbox.js";
import type { Sandbox } from "../sandbox.js";

/**
 * spec §5.4: the escalation file's path, its exclusion from W, and its
 * undo.how — read straight off disk rather than assumed, since the file's
 * exact name (`<run-id>.md`) is derived from a contract hash this test never
 * computes itself.
 */
async function theEscalationFile(s: Sandbox): Promise<{ path: string; text: string }> {
  const dir = join(s.runsDir, "escalations");
  const names = await readdir(dir);
  expect(names).toHaveLength(1);
  const path = join(dir, names[0]);
  return { path, text: await readFile(path, "utf8") };
}

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

      // spec §5.4: a copy of the escalation, under runsDir — never on W (a
      // code branch), and never inside the target repository at all.
      // Mutation: delete the `writeEscalationFile` call at run.ts's
      // `if (!reconciled.landed)` branch — this criterion goes red on the
      // `readdir` above (`theEscalationFile` throws ENOENT with zero files).
      const { path, text } = await theEscalationFile(s);
      expect(path.startsWith(s.runsDir)).toBe(true);
      expect(path.startsWith(s.targetRepo)).toBe(false);
      expect(text).toContain("T1");
      expect(text).toContain("T2");

      // The real gate every ledger decision is held to (spec §3.8 check 3),
      // applied here even though this file is never validated by it: a
      // second, looser definition of "executable" would be exactly the drift
      // spec §0.1 forbids. Mutation: replace run.ts's `rm -rf ${run.workdir}`
      // with a prose undo.how ("clean up the copy by hand") — this assertion
      // goes red without the file's existence assertion above also failing.
      const how = /- how: `([^`]+)`/.exec(text)?.[1];
      expect(how).not.toBeUndefined();
      expect(undoHowIsExecutable(how!)).toBe(true);
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

      // The same three properties, reached through the OTHER of
      // reconcileAndLand's four failure returns (the reconciliation ran and
      // published an attempt, but the terminal status was not "succeeded") —
      // proving the escalation file is written from the convergence point in
      // run.ts (spec §5.4's own comment there) and not from one specific
      // return statement a narrower fix could have targeted.
      const { path, text } = await theEscalationFile(s);
      expect(path.startsWith(s.runsDir)).toBe(true);
      expect(path.startsWith(s.targetRepo)).toBe(false);
      expect(text).toContain("exhausted");
      const how = /- how: `([^`]+)`/.exec(text)?.[1];
      expect(how).not.toBeUndefined();
      expect(undoHowIsExecutable(how!)).toBe(true);
    } finally {
      await s.cleanup();
    }
  }, 300_000);
});
