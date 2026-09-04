import { describe, expect, it } from "vitest";
import { allRefShas, makeSandbox, porcelain, runCli, seedRejectablePlan } from "../sandbox.js";

describe("S12 (spec §2.3 / §4.2: policy other than local-merge)", () => {
  it("S12: rejected at exit 1 rather than silently downgraded, before anything touches the target repo", async () => {
    const s = await makeSandbox();
    try {
      const planPath = await seedRejectablePlan(s, { policy: "rebase" });

      const refsBefore = await allRefShas(s.targetRepo);
      const porcelainBefore = await porcelain(s.targetRepo);

      expect(await runCli(["run", planPath])).toBe(1);

      expect(await allRefShas(s.targetRepo)).toEqual(refsBefore);
      expect(await porcelain(s.targetRepo)).toBe(porcelainBefore);
    } finally {
      await s.cleanup();
    }
  });
});
