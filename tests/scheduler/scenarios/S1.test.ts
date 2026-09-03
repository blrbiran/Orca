import { describe, expect, it } from "vitest";
import {
  captureStdout,
  makeSandbox,
  orcaIncomingRefs,
  runCli,
  seedDisjointPlan,
  showFileAt,
} from "../sandbox.js";

describe("S1 (spec §10.2: the basic path)", () => {
  it("S1: two tasks with disjoint write sets share a layer, both land, and the round exits 0", async () => {
    const s = await makeSandbox();
    try {
      const p = await seedDisjointPlan(s);
      const { result: rc, stdout } = await captureStdout(() =>
        runCli(["run", p.planPath, "--adapter-config", p.adapterConfig]),
      );
      expect(rc).toBe(0);

      // Both landed, read out of W's tree rather than off disk: a file sitting
      // in the worktree has not been merged into anything.
      expect(await showFileAt(s.targetRepo, p.workBranch, "a.txt")).toBe("a1\n");
      expect(await showFileAt(s.targetRepo, p.workBranch, "b.txt")).toBe("b1\n");

      // "Parallel" measured as behaviour rather than as a printed layer
      // number. Same-layer tasks clone at the SAME base (spec §4.2), so T2's
      // attempt tree cannot contain T1's file. A scheduler that quietly
      // serialised everything — the cheapest way to make every other
      // assertion here pass — would put a.txt in T2's base and redden this.
      const refs = await orcaIncomingRefs(s.targetRepo);
      const t2 = Object.keys(refs).find((id) => id.startsWith("orca-T2-"));
      expect(t2).not.toBeUndefined();
      expect(await showFileAt(s.targetRepo, refs[t2!], "a.txt")).toBeNull();

      // spec §9.4(2): `run` always prints plan's report first, from the same
      // code plan uses. Without this, the two could drift apart with nothing
      // going red — and the drift's direction is the worst one.
      expect(stdout).toContain("layer 0: T1, T2 (parallelism: 2)");
    } finally {
      await s.cleanup();
    }
  }, 180_000);
});
