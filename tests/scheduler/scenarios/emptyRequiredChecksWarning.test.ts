import { describe, expect, it } from "vitest";
import { captureStdout, makeSandbox, runCli, writeContract, writePlan } from "../sandbox.js";

describe("orca plan warns about an empty requiredChecks union (spec 5.3 / 9.1(6), fix round 1 finding 2)", () => {
  it("prints the escalation warning through the real plan path, not a hand-built fixture", async () => {
    // ccloop's own contract schema requires requiredChecks.min(1)
    // (ccloop/src/contract/schema.ts), so a contract ccloop itself would
    // accept can never produce an empty union — this warning would be dead
    // code if that were the only way in. It is reachable anyway because
    // subsystem C reads contract files as opaque, unvalidated JSON (see
    // writeSetOf/requiredChecksUnion's own comments); writeContract's
    // requiredChecks: [] below is deliberately the malformed shape ccloop
    // would reject at spawn time — catching it here, at plan time, is the
    // whole point of the warning.
    const s = await makeSandbox();
    try {
      const c1 = await writeContract(s, "T1", {
        goal: "write shared/a.txt",
        targetPaths: ["shared/a.txt"],
        requiredChecks: [],
      });
      const c2 = await writeContract(s, "T2", {
        goal: "also write shared/a.txt",
        targetPaths: ["shared/a.txt"],
        requiredChecks: [],
      });
      const planPath = await writePlan(s, {
        targetRepo: s.targetRepo,
        ccloopBin: `${s.root}/unused-ccloop-cli.js`,
        runsDir: s.runsDir,
        workBranch: "orca/empty-checks-scenario-branch",
        policy: "local-merge",
        ledgerMode: "in-repo",
        tasks: [
          { taskId: "T1", contract: c1, dependsOn: [] },
          { taskId: "T2", contract: c2, dependsOn: [] },
        ],
      });

      const { result: rc, stdout } = await captureStdout(() => runCli(["plan", planPath]));
      expect(rc).toBe(0);
      expect(stdout).toContain("T1 x T2");
      expect(stdout).toContain("would escalate");
    } finally {
      await s.cleanup();
    }
  });
});
