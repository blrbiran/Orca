import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allocateRunId, deriveRunId } from "../../../src/scheduler/runId.js";
import { makeSandbox } from "../sandbox.js";

describe("S15 (spec §2.1 run-id allocation)", () => {
  it("S15: running the same plan twice allocates a fresh id instead of colliding", async () => {
    // A' section 3.1's guarantee — every agent writes only its own file, so
    // conflicts are structurally impossible — rests entirely on ids not
    // colliding. mkdir's atomicity is the arbiter; no database is introduced.
    const s = await makeSandbox();
    try {
      const bytes = Buffer.from("contract bytes for T1");
      const base = "deadbeefcafe";
      const a = await allocateRunId(s.runsDir, "T1", bytes, base);
      const b = await allocateRunId(s.runsDir, "T1", bytes, base);
      expect(b).not.toBe(a);
      expect(b).toMatch(/-2$/);
    } finally {
      await s.cleanup();
    }
  });

  it("steps past a directory left behind by a crashed earlier run", async () => {
    // EEXIST covers two cases at once: the id was taken this round, and an
    // earlier round died leaving a directory with data in it. The correct
    // move is to step past it, never to reuse or clean up someone else's
    // crashed run directory.
    const s = await makeSandbox();
    try {
      const bytes = Buffer.from("contract bytes for T1");
      const base = "deadbeefcafe";
      const expectedId = deriveRunId("T1", bytes, base);
      await mkdir(join(s.runsDir, expectedId), { recursive: true });
      await writeFile(join(s.runsDir, expectedId, "loop-state.json"), "{}");

      const allocated = await allocateRunId(s.runsDir, "T1", bytes, base);
      expect(allocated).not.toBe(expectedId);
    } finally {
      await s.cleanup();
    }
  });
});
