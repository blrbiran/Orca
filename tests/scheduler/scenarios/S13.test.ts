import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  allRefShas,
  captureStreams,
  makeSandbox,
  porcelain,
  runCli,
  seedRejectablePlan,
  writeContract,
  writeScriptedConfig,
} from "../sandbox.js";

// One case per remaining code in spec §2.3's six up-front rejections (S11 and
// S12 cover work-branch-is-default and unsupported-policy in their own
// files): a relative path, a duplicate taskId, a cycle, and a contract file
// living inside the target repo. Each is asserted three ways — exit 1, the
// specific rejection code (from the CLI's own stderr, not just the exit
// code — six different checks all exit 1, so pinning only that cannot tell
// one check from the other five), and the target repo genuinely untouched —
// because all six share the exact same gate in loadRound/runRound, and that
// is the property this file exists to protect.
//
// A real --adapter-config is passed in every case (fix round 1's finding):
// without one, an unrelated guard (`options.adapterConfig === undefined`)
// also returns exit 1 before `checkoutWorkBranch` — the first line that can
// touch the target repo — is ever reached, so a broken rejection check would
// be masked by that guard and none of these six could ever fail.
describe("S13 (spec §2.3: the remaining four up-front rejections)", () => {
  it("S13: a relative path is rejected as relative-path at exit 1, target repo untouched", async () => {
    const s = await makeSandbox();
    try {
      const planPath = await seedRejectablePlan(s, {
        tasks: [{ taskId: "T1", contract: "relative/t1.json", dependsOn: [] }],
      });

      const refsBefore = await allRefShas(s.targetRepo);
      const porcelainBefore = await porcelain(s.targetRepo);

      const adapterConfig = await writeScriptedConfig(s, "s13-relative", [{}]);
      const { result: rc, stderr } = await captureStreams(() => runCli(["run", planPath, "--adapter-config", adapterConfig]));

      expect(rc).toBe(1);
      expect(stderr).toContain("rejected: relative-path:");

      expect(await allRefShas(s.targetRepo)).toEqual(refsBefore);
      expect(await porcelain(s.targetRepo)).toBe(porcelainBefore);
    } finally {
      await s.cleanup();
    }
  });

  it("S13: a duplicate taskId is rejected as duplicate-task-id at exit 1, target repo untouched", async () => {
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

      const adapterConfig = await writeScriptedConfig(s, "s13-dup", [{}]);
      const { result: rc, stderr } = await captureStreams(() => runCli(["run", planPath, "--adapter-config", adapterConfig]));

      expect(rc).toBe(1);
      expect(stderr).toContain("rejected: duplicate-task-id:");

      expect(await allRefShas(s.targetRepo)).toEqual(refsBefore);
      expect(await porcelain(s.targetRepo)).toBe(porcelainBefore);
    } finally {
      await s.cleanup();
    }
  });

  it("S13: a cycle in dependsOn is rejected as cycle at exit 1, target repo untouched", async () => {
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

      const adapterConfig = await writeScriptedConfig(s, "s13-cycle", [{}]);
      const { result: rc, stderr } = await captureStreams(() => runCli(["run", planPath, "--adapter-config", adapterConfig]));

      expect(rc).toBe(1);
      expect(stderr).toContain("rejected: cycle:");

      expect(await allRefShas(s.targetRepo)).toEqual(refsBefore);
      expect(await porcelain(s.targetRepo)).toBe(porcelainBefore);
    } finally {
      await s.cleanup();
    }
  });

  it("S13: a contract file living inside the target repo is rejected as contract-inside-target-repo at exit 1, target repo untouched", async () => {
    const s = await makeSandbox();
    try {
      const planPath = await seedRejectablePlan(s, {
        tasks: [{ taskId: "T1", contract: join(s.targetRepo, "t1-contract.json"), dependsOn: [] }],
      });

      const refsBefore = await allRefShas(s.targetRepo);
      const porcelainBefore = await porcelain(s.targetRepo);

      const adapterConfig = await writeScriptedConfig(s, "s13-inside", [{}]);
      const { result: rc, stderr } = await captureStreams(() => runCli(["run", planPath, "--adapter-config", adapterConfig]));

      expect(rc).toBe(1);
      expect(stderr).toContain("rejected: contract-inside-target-repo:");

      expect(await allRefShas(s.targetRepo)).toEqual(refsBefore);
      expect(await porcelain(s.targetRepo)).toBe(porcelainBefore);
    } finally {
      await s.cleanup();
    }
  });
});
