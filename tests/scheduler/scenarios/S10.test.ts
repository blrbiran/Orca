import { describe, expect, it } from "vitest";
import { makeSandbox, orcaIncomingRefs, runChecksOnBranch, runCli, seedDisjointPlan, showFileAt } from "../sandbox.js";

// The union of both sides' requiredChecks (spec §3.5), read back as plain
// idempotent verification commands against the branch's final content —
// deliberately NOT the writeFileCheck commands the contracts themselves ran
// (those also double as the mechanism that produces the content, since the
// scripted adapter touches no files itself; re-running them here would just
// re-write the same bytes and always exit 0, proving nothing).
const UNION_CHECKS = ['test "$(cat a.txt)" = a1', 'test "$(cat b.txt)" = b1'];

/**
 * Whether T2's own attempt tree — the tree ccloop published for T2's run,
 * before landing ever touches it — already contains a.txt. Isolation (every
 * task clones into its own copy) makes this the one externally observable
 * difference between running two DISJOINT tasks in parallel and running them
 * with --serial: nothing about the final, landed content can tell the two
 * orderings apart (that is what "the parallelism is an optimisation" means),
 * but what each task's clone started FROM can.
 */
async function t2StartedAfterT1Landed(repo: string): Promise<boolean> {
  const refs = await orcaIncomingRefs(repo);
  const entry = Object.entries(refs).find(([runId]) => runId.includes("-T2-"));
  if (!entry) throw new Error("orca: T2 published no refs/orca/<run-id> ref to inspect");
  const [, sha] = entry;
  return (await showFileAt(repo, sha, "a.txt")) !== null;
}

describe("S10 (spec §3.5: --serial turns parallelism off; results must still be correct)", () => {
  it("parallel: T1 and T2 both land, passing the union of both requiredChecks, and T2's clone did not see T1's work", async () => {
    const s = await makeSandbox();
    try {
      const p = await seedDisjointPlan(s);
      expect(await runCli(["run", p.planPath, "--adapter-config", p.adapterConfig])).toBe(0);
      expect(await runChecksOnBranch(s.targetRepo, p.workBranch, UNION_CHECKS)).toBe(0);
      // The parallel signature: both tasks cloned from the SAME pre-round
      // layer base, before either had landed.
      expect(await t2StartedAfterT1Landed(s.targetRepo)).toBe(false);
    } finally {
      await s.cleanup();
    }
  }, 60_000);

  it("S10: --serial also lands both, passing the same union of requiredChecks — not byte-identical to the parallel run, but equally correct", async () => {
    // Not byte-identical to the run above: the two orderings legitimately
    // produce different content, because an implicit edge (or, as here, plain
    // layer membership once --serial flattens it) has no natural direction.
    // What has to hold is that the result still passes both sides' checks —
    // that is what "the parallelism is an optimisation" means operationally.
    const s = await makeSandbox();
    try {
      const p = await seedDisjointPlan(s);
      expect(await runCli(["run", p.planPath, "--adapter-config", p.adapterConfig, "--serial"])).toBe(0);
      expect(await runChecksOnBranch(s.targetRepo, p.workBranch, UNION_CHECKS)).toBe(0);
      // The serial signature, and the one assertion M-SERIAL has to redden:
      // with parallelism genuinely off, T2 is cloned only after T1 has
      // already landed, so T2's own attempt tree contains T1's file even
      // though T2 never wrote it itself.
      expect(await t2StartedAfterT1Landed(s.targetRepo)).toBe(true);
    } finally {
      await s.cleanup();
    }
  }, 60_000);
});
