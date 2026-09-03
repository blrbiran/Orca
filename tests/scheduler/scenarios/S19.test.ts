import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { preflight } from "../../../src/scheduler/preflight.js";
import { git, makeSandbox, seedPlan } from "../sandbox.js";

describe("S19 (spec §4.2 runtime preflight)", () => {
  it("S19: a base that is not a real commit is rejected", async () => {
    // Ruling 7: the base is the default branch's HEAD (spec §4.2), derived
    // at runtime rather than a plan-file field — a repository with zero
    // commits at all is the honest fixture, since its default branch is
    // unborn and does not resolve to any commit yet. Built by hand rather
    // than via makeSandbox, which always seeds an initial commit.
    const emptyRepo = await mkdtemp(join(tmpdir(), "orca-sched-emptyrepo-"));
    try {
      await git(emptyRepo, ["init"]);
      const defaultBranch = (await git(emptyRepo, ["symbolic-ref", "--short", "HEAD"])).trim();

      const s = await makeSandbox(); // only used for runsDir/ccloopBin plumbing that seedPlan needs
      try {
        const plan = await seedPlan(s, { targetRepo: emptyRepo });
        const report = await preflight(plan, defaultBranch);

        expect(report.rejections.map((r) => r.code)).toContain("base-not-a-commit");
      } finally {
        await s.cleanup();
      }
    } finally {
      await rm(emptyRepo, { recursive: true, force: true });
    }
  });
});
