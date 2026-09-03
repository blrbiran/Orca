import { describe, expect, it } from "vitest";
import { validateLine } from "../../../src/ledger/validateLine.js";
import {
  captureStdout,
  makeSandbox,
  orcaIncomingRefs,
  readLedgerOnBranch,
  runCli,
  seedIntersectingPlan,
  showFileAt,
} from "../sandbox.js";

describe("S2 (spec §2.4 / §8.1)", () => {
  it("S2: two tasks with intersecting write sets run serially and the ordering lands in the ledger", async () => {
    const s = await makeSandbox();
    try {
      const p = await seedIntersectingPlan(s);
      const { result: rc, stdout } = await captureStdout(() =>
        runCli(["run", p.planPath, "--adapter-config", p.adapterConfig]),
      );
      expect(rc).toBe(0);

      // "Serial" measured as behaviour: T2's attempt tree contains T1's file,
      // which is only possible if T2 cloned from a W that T1 had already
      // landed on (spec §4.2's rolling HEAD). A scheduler that ignored the
      // implicit edge and ran both in one layer would give T2 a base without
      // src/t1.txt in it.
      const refs = await orcaIncomingRefs(s.targetRepo);
      const t2 = Object.keys(refs).find((id) => id.startsWith("orca-T2-"));
      expect(t2).not.toBeUndefined();
      expect(await showFileAt(s.targetRepo, refs[t2!], "src/t1.txt")).toBe("t1\n");

      // Read back through the real validator, from the real file on W —
      // hand-made fixtures are what let .strict() reject seven real decisions
      // while thirty-four criteria stayed green.
      const lines = await readLedgerOnBranch(s.targetRepo, p.workBranch);
      // `every` on an empty array is true, so the count comes first: an
      // orchestrator that wrote nothing at all would otherwise pass the two
      // assertions below without writing a single decision.
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.every((l) => validateLine(l).verdict === "ok")).toBe(true);
      expect(lines.some((l) => (JSON.parse(l) as { kind?: string }).kind === "scheduling")).toBe(true);

      expect(stdout).toContain("layer 0: T1 (parallelism: 1)");
      expect(stdout).toContain("layer 1: T2 (parallelism: 1)");
    } finally {
      await s.cleanup();
    }
  }, 180_000);
});
