import { describe, expect, it } from "vitest";
import { captureStdout, defaultBranchOf, headOf, makeSandbox, runCli, seedTwoTaskPlan } from "../sandbox.js";

// Final review, Important 7, through the real `orca plan` rather than a
// hand-built fixture: the renderer's own formatting is covered in
// tests/scheduler/planReport.test.ts, and this is the wiring — that the branch
// and sha printed are the ones the round would actually cut W from, read from
// the target repository, not values a caller happened to pass.
//
// This is the shape fix round 1 was burned by once already
// (`emptyRequiredChecksPairs` was a seam nothing in production filled in, so
// its warning could never fire for a real run).
describe("orca plan prints where the work branch starts (spec §9.1)", () => {
  it("names the target repository's checked-out branch and its actual tip sha", async () => {
    const s = await makeSandbox();
    try {
      const planPath = await seedTwoTaskPlan(s);
      // Read from git, not hard-coded: `git init` takes the branch name from
      // init.defaultBranch, so a machine configured for "master" must not fail
      // this for a reason unrelated to the code under test.
      const branch = await defaultBranchOf(s.targetRepo);
      const head = await headOf(s.targetRepo);

      const { result: rc, stdout } = await captureStdout(() => runCli(["plan", planPath]));
      expect(rc).toBe(0);

      // Mutation `M-BASE-WIRING`: pass `base: { branch: "", sha: null }` from
      // renderRound instead of the round's own values — the report still
      // prints a Base line and the criterion above in planReport.test.ts still
      // passes, while this one goes red on the sha.
      expect(stdout).toContain(branch);
      expect(stdout).toContain(head);
    } finally {
      await s.cleanup();
    }
  });
});
