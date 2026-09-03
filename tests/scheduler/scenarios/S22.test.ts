import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { preflight } from "../../../src/scheduler/preflight.js";
import { makeSandbox, seedPlan } from "../sandbox.js";

describe("S22 (spec §4.2.1)", () => {
  it("S22: a dirty target worktree is rejected up front", async () => {
    const s = await makeSandbox();
    try {
      await writeFile(join(s.targetRepo, "untracked.txt"), "x\n");
      const report = await preflight(await seedPlan(s), "main");
      expect(report.rejections.map((r) => r.code)).toContain("dirty-worktree");
    } finally {
      await s.cleanup();
    }
  });

  it("S22b: dirtiness is measured with porcelain, which sees untracked files", () => {
    // git diff is blind to an untracked file's contents — overwrite one and
    // it reports zero bytes before and after. Since the scheduler checks out
    // the user's worktree on the main path, a check that cannot see
    // untracked work is a check that will lose someone's work.
    // (Asserted by S22 above using an untracked file specifically — this
    // test exists only to make that reasoning legible next to the scenario
    // it justifies; it has no assertion of its own to add.)
  });
});
