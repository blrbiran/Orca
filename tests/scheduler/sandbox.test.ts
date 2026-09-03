import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allRefShas, git, makeSandbox, porcelain, writeContract, writePlan } from "./sandbox.js";

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
      // Load-bearing per fix round 1, finding 1: the two assertions above
      // pass regardless of whose git identity made the commit — a developer's
      // real name and email would satisfy them just as well. This is the one
      // assertion that actually depends on the `-c user.name=` / `-c
      // user.email=` passed into `commit`, so it is the one that would go red
      // if that spread were ever dropped (see M-T1-ID in the task report).
      expect(await git(s.targetRepo, ["log", "-1", "--format=%an <%ae>"])).toBe(
        "orca-test <orca-test@invalid>\n",
      );
    } finally {
      await s.cleanup();
    }
  });

  it("resolves ccloopBin lazily, so construction succeeds even when resolution would fail", async () => {
    // Load-bearing per fix round 1, finding 2: none of this file's other
    // scenarios ever read s.ccloopBin, so a resolver that throws must not
    // stop makeSandbox from returning — otherwise every sandbox on a machine
    // or CI without ccloop's gitignored dist/ build fails for a reason that
    // has nothing to do with the code under test. The injected resolver below
    // always throws, so a pass here means construction genuinely never called
    // it, and reading the property is what triggers the real error.
    const s = await makeSandbox({
      resolveCcloopBin: () => {
        throw new Error("simulated: ccloop bin not found");
      },
    });
    try {
      expect(() => s.ccloopBin).toThrow("simulated: ccloop bin not found");
    } finally {
      await s.cleanup();
    }
  });

  it("lets ORCA_CCLOOP_BIN override the sibling-directory assumption", async () => {
    // Deferred minor carried from Task 1 and landed by Task 8, the first task
    // that actually spawns the binary: until now resolveCcloopBin hard-coded
    // "ccloop is a sibling of Orca" with no way out, so a checkout that keeps
    // the two anywhere else could not run a single spawning scenario. The
    // override is measured against the real resolver, not an injected one —
    // the injection seam bypasses exactly the code this criterion is about.
    const s = await makeSandbox();
    const previous = process.env.ORCA_CCLOOP_BIN;
    try {
      const fake = join(s.root, "fake-ccloop.js");
      await writeFile(fake, "// stands in for ccloop's dist/cli.js\n");
      process.env.ORCA_CCLOOP_BIN = fake;
      expect(s.ccloopBin).toBe(fake);
    } finally {
      if (previous === undefined) delete process.env.ORCA_CCLOOP_BIN;
      else process.env.ORCA_CCLOOP_BIN = previous;
      await s.cleanup();
    }
  });

  it("still names the missing binary when ORCA_CCLOOP_BIN points at nothing", async () => {
    // The override must not become a way to smuggle an opaque ENOENT from
    // spawn back in: an unset build and a mistyped env var are different
    // mistakes, and the error has to say which path it tried and where that
    // path came from.
    const s = await makeSandbox();
    const previous = process.env.ORCA_CCLOOP_BIN;
    try {
      process.env.ORCA_CCLOOP_BIN = join(s.root, "definitely-not-here.js");
      expect(() => s.ccloopBin).toThrow(/ORCA_CCLOOP_BIN/);
    } finally {
      if (previous === undefined) delete process.env.ORCA_CCLOOP_BIN;
      else process.env.ORCA_CCLOOP_BIN = previous;
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
