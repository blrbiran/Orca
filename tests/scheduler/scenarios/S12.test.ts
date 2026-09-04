import { describe, expect, it } from "vitest";
import { allRefShas, captureStreams, makeSandbox, porcelain, runCli, seedRejectablePlan, writeScriptedConfig } from "../sandbox.js";

describe("S12 (spec §2.3 / §4.2: policy other than local-merge)", () => {
  it("S12: rejected as unsupported-policy at exit 1 rather than silently downgraded, before anything touches the target repo", async () => {
    const s = await makeSandbox();
    try {
      const planPath = await seedRejectablePlan(s, { policy: "rebase" });

      const refsBefore = await allRefShas(s.targetRepo);
      const porcelainBefore = await porcelain(s.targetRepo);

      // A real --adapter-config, deliberately: without one, an unrelated
      // guard (`options.adapterConfig === undefined`) also returns exit 1
      // before `checkoutWorkBranch` — the first line that can touch the
      // target repo — is ever reached, so a broken rejection check here
      // would be masked by that guard and this scenario could never fail.
      // Fix round 1's finding.
      const adapterConfig = await writeScriptedConfig(s, "s12", [{}]);
      const { result: rc, stderr } = await captureStreams(() => runCli(["run", planPath, "--adapter-config", adapterConfig]));

      expect(rc).toBe(1);
      // The specific code, not just the exit code: six different checks all
      // exit 1, and a test that only pins the exit code cannot tell its own
      // check from any of the other five.
      expect(stderr).toContain("rejected: unsupported-policy:");

      expect(await allRefShas(s.targetRepo)).toEqual(refsBefore);
      expect(await porcelain(s.targetRepo)).toBe(porcelainBefore);
    } finally {
      await s.cleanup();
    }
  });
});
