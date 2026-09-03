import { describe, expect, it } from "vitest";
import { acquireRepoLock } from "../../../src/scheduler/repoLock.js";
import { defaultBranchOf, makeSandbox, refSha, runCli, seedDisjointPlan } from "../sandbox.js";

describe("S21 (spec §1.2 rule 3 / §10.2)", () => {
  it("S21: a second orca on the same target repo fails loudly", async () => {
    const s = await makeSandbox();
    try {
      const first = await acquireRepoLock(s.targetRepo);
      try {
        // Failing loudly is the whole point. A prior-art scheduler (hermes)
        // degrades its lock to a no-op on platforms without fcntl; Rule 12
        // does not allow that, and mkdir has no such degradation mode.
        await expect(acquireRepoLock(s.targetRepo)).rejects.toThrow(/already/i);
      } finally {
        await first.release();
      }
    } finally {
      await s.cleanup();
    }
  });

  it("S21: with the lock held, a second orca run never enters W", async () => {
    // The half Task 6 could not make real: back then nothing in this
    // repository could enter W, so an assertion that a second orca did not
    // enter it could never have gone red. `orca run` exists now, so it can.
    const s = await makeSandbox();
    try {
      const p = await seedDisjointPlan(s);
      const defaultBranch = await defaultBranchOf(s.targetRepo);
      const held = await acquireRepoLock(s.targetRepo);
      try {
        const rc = await runCli(["run", p.planPath, "--adapter-config", p.adapterConfig]);

        // First, and deliberately ahead of the exit code: this is the
        // assertion `M-LOCK` has to redden. A run that got past the lock
        // would create W here, and §10.3 warns that a red on an earlier
        // assertion says nothing about a later one.
        expect(await refSha(s.targetRepo, `refs/heads/${p.workBranch}`)).toBeNull();
        // The target repo is also still where the person left it — the
        // checkout in §4.2.1 is the other thing a second orca must not do.
        expect(await defaultBranchOf(s.targetRepo)).toBe(defaultBranch);
        expect(rc).not.toBe(0);
      } finally {
        await held.release();
      }

      // The positive control, without which the three assertions above are
      // satisfied by an `orca run` that does not work at all — which is
      // exactly what they did before this task existed. The SAME plan, once
      // the lock is gone, does enter W. So the refusal above was the lock's
      // doing and nothing else's.
      expect(await runCli(["run", p.planPath, "--adapter-config", p.adapterConfig])).toBe(0);
      expect(await refSha(s.targetRepo, `refs/heads/${p.workBranch}`)).not.toBeNull();
    } finally {
      await s.cleanup();
    }
  }, 180_000);
});
