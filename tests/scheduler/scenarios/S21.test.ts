import { describe, expect, it } from "vitest";
import { acquireRepoLock } from "../../../src/scheduler/repoLock.js";
import { makeSandbox } from "../sandbox.js";

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

        // Fix round 1, finding 1: this scenario's other half — "and never
        // enters W" — is real but untestable today: `orca run` (and W
        // itself) does not exist until Task 10, which owns adding that
        // assertion once there is something for it to check.
      } finally {
        await first.release();
      }
    } finally {
      await s.cleanup();
    }
  });
});
