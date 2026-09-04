import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allRefShas, makeSandbox, porcelain, runCli, seedRejectablePlan, writeContract } from "../sandbox.js";

// One case per remaining code in spec §2.3's six up-front rejections (S11 and
// S12 cover work-branch-is-default and unsupported-policy in their own
// files): a relative path, a duplicate taskId, a cycle, and a contract file
// living inside the target repo. Each is asserted the same two ways — exit 1,
// and the target repo genuinely untouched — because all six share the exact
// same gate in loadRound/runRound, and this is the property that gate exists
// to protect.
describe("S13 (spec §2.3: the remaining four up-front rejections)", () => {
  it("S13: a relative path is rejected at exit 1, target repo untouched", async () => {
    const s = await makeSandbox();
    try {
      const planPath = await seedRejectablePlan(s, {
        tasks: [{ taskId: "T1", contract: "relative/t1.json", dependsOn: [] }],
      });

      const refsBefore = await allRefShas(s.targetRepo);
      const porcelainBefore = await porcelain(s.targetRepo);

      expect(await runCli(["run", planPath])).toBe(1);

      expect(await allRefShas(s.targetRepo)).toEqual(refsBefore);
      expect(await porcelain(s.targetRepo)).toBe(porcelainBefore);
    } finally {
      await s.cleanup();
    }
  });

  it("S13: a duplicate taskId is rejected at exit 1, target repo untouched", async () => {
    const s = await makeSandbox();
    try {
      const contract = await writeContract(s, "T1", { goal: "write a.txt", targetPaths: ["a.txt"], requiredChecks: ["true"] });
      const planPath = await seedRejectablePlan(s, {
        tasks: [
          { taskId: "T1", contract, dependsOn: [] },
          { taskId: "T1", contract, dependsOn: [] },
        ],
      });

      const refsBefore = await allRefShas(s.targetRepo);
      const porcelainBefore = await porcelain(s.targetRepo);

      expect(await runCli(["run", planPath])).toBe(1);

      expect(await allRefShas(s.targetRepo)).toEqual(refsBefore);
      expect(await porcelain(s.targetRepo)).toBe(porcelainBefore);
    } finally {
      await s.cleanup();
    }
  });

  it("S13: a cycle in dependsOn is rejected at exit 1, target repo untouched", async () => {
    const s = await makeSandbox();
    try {
      const c1 = await writeContract(s, "T1", { goal: "write a.txt", targetPaths: ["a.txt"], requiredChecks: ["true"] });
      const c2 = await writeContract(s, "T2", { goal: "write b.txt", targetPaths: ["b.txt"], requiredChecks: ["true"] });
      const planPath = await seedRejectablePlan(s, {
        tasks: [
          { taskId: "T1", contract: c1, dependsOn: ["T2"] },
          { taskId: "T2", contract: c2, dependsOn: ["T1"] },
        ],
      });

      const refsBefore = await allRefShas(s.targetRepo);
      const porcelainBefore = await porcelain(s.targetRepo);

      expect(await runCli(["run", planPath])).toBe(1);

      expect(await allRefShas(s.targetRepo)).toEqual(refsBefore);
      expect(await porcelain(s.targetRepo)).toBe(porcelainBefore);
    } finally {
      await s.cleanup();
    }
  });

  it("S13: a contract file living inside the target repo is rejected at exit 1, target repo untouched", async () => {
    const s = await makeSandbox();
    try {
      const planPath = await seedRejectablePlan(s, {
        tasks: [{ taskId: "T1", contract: join(s.targetRepo, "t1-contract.json"), dependsOn: [] }],
      });

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
