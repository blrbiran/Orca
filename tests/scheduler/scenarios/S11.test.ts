import { describe, expect, it } from "vitest";
import { allRefShas, defaultBranchOf, makeSandbox, porcelain, runCli, seedRejectablePlan } from "../sandbox.js";

describe("S11 (spec §2.3 / §4.2: workBranch == default branch)", () => {
  it("S11: rejected at exit 1, before anything touches the target repo", async () => {
    const s = await makeSandbox();
    try {
      const defaultBranch = await defaultBranchOf(s.targetRepo);
      const planPath = await seedRejectablePlan(s, { workBranch: defaultBranch });

      const refsBefore = await allRefShas(s.targetRepo);
      const porcelainBefore = await porcelain(s.targetRepo);

      // No --adapter-config: loadPlan's rejection fires before that flag is
      // ever checked, so a well-formed run invocation is not needed to prove
      // this — see runRound's own ordering.
      expect(await runCli(["run", planPath])).toBe(1);

      expect(await allRefShas(s.targetRepo)).toEqual(refsBefore);
      expect(await porcelain(s.targetRepo)).toBe(porcelainBefore);
    } finally {
      await s.cleanup();
    }
  });
});
