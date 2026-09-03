import { describe, expect, it } from "vitest";
import { defaultBranchOf, makeSandbox, refSha, runCli, seedDisjointPlan, showFileAt } from "../sandbox.js";

describe("S14 (spec §4.5)", () => {
  it("S14: a whole run leaves the default branch's ref byte-identical", async () => {
    // Asserted as behaviour, not as a source scan. "the word push must not
    // appear in src" is brittle — comments, strings and variable names all
    // trip it — and, worse, passing it does not mean the running code leaves
    // the branch alone. Nothing but comparing the ref before and after a real
    // round measures the thing §4.5 actually forbids.
    const s = await makeSandbox();
    try {
      const p = await seedDisjointPlan(s);
      const defaultBranch = await defaultBranchOf(s.targetRepo);
      const before = await refSha(s.targetRepo, `refs/heads/${defaultBranch}`);

      const rc = await runCli(["run", p.planPath, "--adapter-config", p.adapterConfig]);

      // First, because §10.3's warning is that an earlier assertion going red
      // short-circuits and tells you nothing about this one. This is the
      // assertion `M-MAIN` has to redden.
      expect(await refSha(s.targetRepo, `refs/heads/${defaultBranch}`)).toBe(before);

      // The other half, without which the assertion above is satisfied by a
      // run that crashed before it did anything: the round really did run,
      // really did land both tasks, and really did move a branch — just not
      // that one.
      expect(rc).toBe(0);
      const wTip = await refSha(s.targetRepo, `refs/heads/${p.workBranch}`);
      expect(wTip).not.toBeNull();
      expect(wTip).not.toBe(before);
      expect(await showFileAt(s.targetRepo, p.workBranch, "a.txt")).toBe("a1\n");
      expect(await showFileAt(s.targetRepo, p.workBranch, "b.txt")).toBe("b1\n");
    } finally {
      await s.cleanup();
    }
  }, 180_000);
});
