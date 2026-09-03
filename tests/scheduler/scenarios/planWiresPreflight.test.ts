import { describe, expect, it } from "vitest";
import { RUNTIME_CHECKS } from "../../../src/scheduler/planReport.js";
import { captureStdout, makeSandbox, runCli, seedTwoTaskPlan } from "../sandbox.js";

// Ruling 3 (task-6-brief.md): `orca plan` used to pass a report with zero
// rejections no matter what, so all three runtime checks always printed
// "[not evaluated]" — that was honest while preflight() did not exist yet.
// Once it does, forgetting to wire it in is silent: the CLI still exits 0
// and prints a report that merely looks incomplete rather than wrong.
// Without this criterion nothing catches that regression — exactly the
// unarmed-gate shape this project has shipped before (core.hooksPath).
describe("orca plan wires the real preflight in (spec §9.1(4) / ruling 3)", () => {
  it("prints [pass], not [not evaluated], for the three runtime checks on a plan where they can be evaluated", async () => {
    const s = await makeSandbox();
    try {
      const planPath = await seedTwoTaskPlan(s);
      const { result: rc, stdout } = await captureStdout(() => runCli(["plan", planPath]));
      expect(rc).toBe(0);

      for (const code of RUNTIME_CHECKS) {
        expect(stdout).toContain(`[pass] ${code}`);
        expect(stdout).not.toContain(`[not evaluated] ${code}`);
      }
    } finally {
      await s.cleanup();
    }
  });
});
