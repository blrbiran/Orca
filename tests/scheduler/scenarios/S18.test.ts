import { describe, expect, it } from "vitest";
import { preflight } from "../../../src/scheduler/preflight.js";
import { git, makeSandbox, seedPlan } from "../sandbox.js";

describe("S18 (spec §4.2 runtime preflight)", () => {
  it("S18: an existing workBranch is rejected rather than reused", async () => {
    const s = await makeSandbox();
    try {
      // Ruling 4: reuse would mean merging onto a branch that might already
      // carry someone else's un-landed work, with no record anyone chose
      // that — so an existing branch of the same name must be rejected, not
      // silently reused.
      await git(s.targetRepo, ["branch", "orca/already-exists"]);
      const defaultBranch = (await git(s.targetRepo, ["symbolic-ref", "--short", "HEAD"])).trim();

      const plan = await seedPlan(s, { workBranch: "orca/already-exists" });
      const report = await preflight(plan, defaultBranch);

      expect(report.rejections.map((r) => r.code)).toContain("work-branch-already-exists");
    } finally {
      await s.cleanup();
    }
  });
});
