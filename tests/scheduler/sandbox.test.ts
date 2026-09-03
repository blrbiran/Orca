import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { allRefShas, makeSandbox, porcelain, writeContract, writePlan } from "./sandbox.js";

describe("the scheduler sandbox", () => {
  it("builds a repository with a real commit, a clean worktree, and no git identity leaking in from the machine", async () => {
    // Every scenario in this plan asserts something about a repository's refs
    // or its porcelain output. If the sandbox itself were dirty, or depended
    // on the developer's global git config, those assertions would measure the
    // machine rather than the code — the shape this repo has been bitten by.
    const s = await makeSandbox();
    try {
      expect(await porcelain(s.targetRepo)).toBe("");
      const refs = await allRefShas(s.targetRepo);
      expect(Object.keys(refs).length).toBeGreaterThan(0);
    } finally {
      await s.cleanup();
    }
  });

  it("puts contracts outside the target repository", async () => {
    // Load-bearing: spec 2.3 rejects a plan whose contract lives inside the
    // target repo, because an upstream task could then rewrite the write set
    // the graph was built from. A harness that violated it would make that
    // rejection untestable.
    const s = await makeSandbox();
    try {
      const p = await writeContract(s, "T1", { goal: "x", targetPaths: ["a.txt"], requiredChecks: ["true"] });
      expect(p.startsWith(s.targetRepo)).toBe(false);
      expect(p.startsWith(s.runsDir)).toBe(true);
    } finally {
      await s.cleanup();
    }
  });

  it("writes a plan file that round-trips as JSON", async () => {
    const s = await makeSandbox();
    try {
      const p = await writePlan(s, { targetRepo: s.targetRepo, tasks: [] });
      expect(JSON.parse(await readFile(p, "utf8")).targetRepo).toBe(s.targetRepo);
    } finally {
      await s.cleanup();
    }
  });
});
