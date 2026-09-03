import { describe, it, expect } from "vitest";
import { allRefShas, makeSandbox, porcelain, runCli, seedTwoTaskPlan } from "../sandbox.js";

describe("S17 (spec 9.2)", () => {
  it("S17: orca plan touches not one byte of the target repository", async () => {
    const s = await makeSandbox();
    try {
      const planPath = await seedTwoTaskPlan(s);
      const refsBefore = await allRefShas(s.targetRepo);
      const porcelainBefore = await porcelain(s.targetRepo);

      const rc = await runCli(["plan", planPath]);
      expect(rc).toBe(0);

      // Measured directly, not via `git diff | wc -c`: that comparison is
      // blind to content changes in untracked files — overwrite one and it
      // reports zero bytes both before and after.
      expect(await allRefShas(s.targetRepo)).toEqual(refsBefore);
      expect(await porcelain(s.targetRepo)).toBe(porcelainBefore);
    } finally {
      await s.cleanup();
    }
  });
});
