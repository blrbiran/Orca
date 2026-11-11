// Budget defaults spec 2026-11-11 §7 items 4 and 5: in a group with no token limit an estimate is each task's expectation,
// not a ceiling. `group show`, `proposal show` and `group confirm` name the expectation instead of "ready but not applied",
// the "to estimate:" hint says an estimate is advisory there, and `group show` puts what a task used beside what was
// expected. Their JSON is unchanged. A finite group's lines are the ones tests/commands/unestimatedDefault.test.ts pins.
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

/** The fake world as a group with no token limit whose task t1 carries the unlimited, unestimated default. */
async function unlimited() {
  const w = await world();
  (w.state.view.ledger.groupLimit as { tokens: number | null }).tokens = null;
  const work = w.state.view.allocations[0]!;
  (work.amount as { tokens: number | null }).tokens = null;
  work.fieldProvenance.tokens = { provenance: "complex-1m-default", estimateId: null };
  return w;
}
const ready = (w: Awaited<ReturnType<typeof unlimited>>) => {
  (w.state.view as Record<string, unknown>).estimates = [{ estimateId: "est-9", estimateVersion: 1, state: "ready", stale: false,
    output: { schema: "budget-estimate-v1", planHash: w.state.view.plan.planHash, tasks: [{ taskId: "t1", work: { tokens: 1000, activeMs: 1, attempts: 1, sessions: 1 } }], goalReviewReserve: null } }];
};
const SHOWS = [["group", "show", "g-alpha"], ["proposal", "show", "g-alpha"]];

describe("an unlimited group names the expectation (§7 item 5; criterion 9)", () => {
  it("a ready estimate is named by what it expects, never as ready but not applied, with no apply path", async () => {
    const w = await unlimited();
    ready(w);
    for (const args of SHOWS) {
      const out = (await cli(args, w.dir)).stdout;
      // mutation: drop the unlimited branch of unestimatedLines -> "ready but not applied", red
      expect(out, args.join(" ")).toContain("task t1: tokens: unlimited (default; expected 1000 tokens from estimate est-9)");
      expect(out, args.join(" ")).not.toContain("ready but not applied");
      expect(out, args.join(" ")).not.toContain("to apply it:");
      expect(out, args.join(" ")).toContain("in a group with no token limit an estimate is advisory: each task's expected tokens, not a ceiling");
    }
    expect((await cli(["group", "show", "g-alpha", "--json"], w.dir)).stdout).not.toContain("advisory");
  });

  it("with no estimate, the to-estimate hint says an estimate is advisory there", async () => {
    const w = await unlimited();
    for (const args of SHOWS) {
      const out = (await cli(args, w.dir)).stdout;
      expect(out, args.join(" ")).toContain("task t1: tokens: unlimited (default, not estimated)");
      expect(out, args.join(" ")).toContain("\nto estimate: orca group estimate g-alpha, orca group confirm g-alpha (in a group with no token limit an estimate is advisory: each task's expected tokens, not a ceiling)\n");
    }
  });
});

describe("group show puts usage beside the expectation (§7 item 4; criterion 7, CLI half)", () => {
  const withExpectation = async (usedTokens: number | null) => {
    const w = await unlimited();
    (w.state.view.workItems[0] as Record<string, unknown>).lineageRunIds = ["run-1"];
    (w.state.view.workItems[0] as Record<string, unknown>).expected = { tokens: 1000, estimateId: "est-9", stale: false, usedTokens };
    return (await cli(["group", "show", "g-alpha"], w.dir)).stdout;
  };
  it("3.2x when the task used 3.2 times its expectation", async () => {
    // mutation: drop expectationLines from formatWithUnestimated -> red
    expect(await withExpectation(3200)).toContain("task t1: used 3200 tokens (×3.2 its estimate); expected 1000 tokens from estimate est-9");
  });
  it("unknown when its usage is unknown", async () => {
    // mutation: print 0 for unknown usage -> red
    expect(await withExpectation(null)).toContain("task t1: used unknown; expected 1000 tokens from estimate est-9");
  });
});
