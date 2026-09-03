import { describe, expect, it } from "vitest";
import { preflight } from "../../src/scheduler/preflight.js";
import { git, makeSandbox, seedPlan } from "./sandbox.js";

describe("preflight", () => {
  it("reports zero rejections for a plan whose target repo is clean, whose workBranch is new, and whose base is a real commit", async () => {
    const s = await makeSandbox();
    try {
      const defaultBranch = (await git(s.targetRepo, ["symbolic-ref", "--short", "HEAD"])).trim();
      const plan = await seedPlan(s);
      const report = await preflight(plan, defaultBranch);
      expect(report.rejections).toEqual([]);
    } finally {
      await s.cleanup();
    }
  });
});
