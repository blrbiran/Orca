import { describe, expect, it } from "vitest";
import { acquireRepoLock } from "../../../src/scheduler/repoLock.js";
import { makeSandbox, refSha } from "../sandbox.js";

describe("S21 (spec §1.2 rule 3 / §10.2)", () => {
  it("S21: a second orca on the same target repo fails loudly and never enters W", async () => {
    const s = await makeSandbox();
    try {
      const first = await acquireRepoLock(s.targetRepo);
      try {
        // Failing loudly is the whole point. A prior-art scheduler (hermes)
        // degrades its lock to a no-op on platforms without fcntl; Rule 12
        // does not allow that, and mkdir has no such degradation mode.
        await expect(acquireRepoLock(s.targetRepo)).rejects.toThrow(/already/i);

        // And it must not have got as far as touching the branch.
        expect(await refSha(s.targetRepo, "refs/heads/orca/w/x")).toBeNull();
      } finally {
        await first.release();
      }
    } finally {
      await s.cleanup();
    }
  });
});
