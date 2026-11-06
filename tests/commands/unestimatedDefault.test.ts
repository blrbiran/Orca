// Session 3cfc2e73 D3 (spec 2026-11-05 §3.3, criterion 16): with no estimate applied, a task's work tokens are the
// unlimited default; group confirm's, group show's and proposal show's human output say so per task and name the path to
// an estimate. Their JSON is unchanged.
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

const LINE = "task t1: tokens: unlimited (default, not estimated)";
// Ruling (session 86352010): 「这次批准改写所有必要的判据。」 Dogfood run 3 F23: an editable proposal (group show, proposal show
// before a confirm) is no longer told to reopen, so the path is matched without the "then" that followed the reopen step;
// the state-specific criteria below pin which form each output prints.
const PATH = "orca group estimate g-alpha, orca group apply-estimate g-alpha, orca group confirm g-alpha";
const REOPEN = "to estimate: before the group starts, reopen its proposal with a proposal edit (orca proposal replace g-alpha --file <ops.json> --if-revision <n>), then " + PATH;
/** Task t1's work tokens: null, with the given provenance (complex-1m-default is what import writes). */
async function unestimated(provenance = "complex-1m-default") {
  const w = await world();
  const work = w.state.view.allocations[0]!;
  (work.amount as { tokens: number | null }).tokens = null;
  work.fieldProvenance.tokens = { provenance, estimateId: null };
  return w;
}

describe("the unestimated default is named (criterion 16)", () => {
  it("confirm's and group show's human output name the unestimated default and the path", async () => {
    const w = await unestimated();
    const confirmed = await cli(["group", "confirm", "g-alpha"], w.dir);
    expect(confirmed.code).toBe(0);
    expect(confirmed.stdout).toContain(LINE);
    expect(confirmed.stdout).toContain(PATH);
    const shown = await cli(["group", "show", "g-alpha"], w.dir);
    expect(shown.stdout).toContain(LINE);
    expect(shown.stdout).toContain(PATH);
  });

  it("proposal show names it too", async () => {
    const w = await unestimated();
    const shown = await cli(["proposal", "show", "g-alpha"], w.dir);
    expect(shown.stdout).toContain(LINE);
    expect(shown.stdout).toContain(PATH);
  });

  it("JSON output is unchanged, and a person's own unlimited tokens are not called a default", async () => {
    const w = await unestimated();
    const json = await cli(["group", "confirm", "g-alpha", "--json"], w.dir);
    expect(json.stdout).not.toContain("not estimated");
    const person = await unestimated("human");
    const confirmed = await cli(["group", "confirm", "g-alpha"], person.dir);
    expect(confirmed.code).toBe(0);
    expect(confirmed.stdout).not.toContain("not estimated");
    expect((await cli(["group", "show", "g-alpha"], person.dir)).stdout).not.toContain("not estimated");
  });
});

// Dogfood run 3 F23 (session 86352010): confirm said "not estimated" while a ready estimate sat unapplied, and its hint told
// an editable proposal to reopen. The lines now follow the state.
describe("the unestimated lines follow the proposal and estimate state (F23)", () => {
  const ready = (w: Awaited<ReturnType<typeof unestimated>>) => {
    (w.state.view as Record<string, unknown>).estimates = [{ estimateId: "est-9", estimateVersion: 1, state: "ready", stale: false,
      output: { schema: "budget-estimate-v1", planHash: w.state.view.plan.planHash, tasks: [], goalReviewReserve: null } }];
  };
  const READY_LINE = "task t1: tokens: unlimited (default; estimate est-9 is ready but not applied)";
  const APPLY = "orca group apply-estimate g-alpha (--dry-run shows what it sets), orca group confirm g-alpha";

  it("an editable proposal with no estimate is told to estimate, not to reopen", async () => {
    const w = await unestimated();
    for (const args of [["group", "show", "g-alpha"], ["proposal", "show", "g-alpha"]]) {
      const out = (await cli(args, w.dir)).stdout;
      // mutation: drop the editable branch (always the reopen path) -> red
      expect(out, args.join(" ")).toContain(`\nto estimate: ${PATH}\n`);
    }
    // mutation: confirm's lines read the pre-confirm proposal as editable (no afterConfirm) -> no reopen step, red
    expect((await cli(["group", "confirm", "g-alpha"], w.dir)).stdout).toContain(`\n${REOPEN}\n`);
  });

  it("a ready estimate that was not applied is named, and the path is apply-estimate", async () => {
    const w = await unestimated();
    ready(w);
    for (const args of [["group", "show", "g-alpha"], ["proposal", "show", "g-alpha"]]) {
      const out = (await cli(args, w.dir)).stdout;
      // mutation: drop the ready branch of the task line (always "not estimated") -> red
      expect(out, args.join(" ")).toContain(READY_LINE);
      expect(out, args.join(" ")).not.toContain("not estimated");
      // mutation: drop the ready branch of the path (always "to estimate") -> red
      expect(out, args.join(" ")).toContain(`\nto apply it: ${APPLY}\n`);
    }
    const confirmed = (await cli(["group", "confirm", "g-alpha"], w.dir)).stdout;
    expect(confirmed).toContain(READY_LINE);
    expect(confirmed).toContain("\nto apply it: before the group starts, reopen its proposal with a proposal edit (orca proposal replace g-alpha --file <ops.json> --if-revision <n>), then " + APPLY + "\n");
  });

  it("an estimate for another plan, or one not ready, leaves the line as not estimated", async () => {
    for (const change of [{ state: "queued" }, { output: { schema: "budget-estimate-v1", planHash: "f".repeat(64), tasks: [], goalReviewReserve: null } }]) {
      const w = await unestimated();
      ready(w);
      Object.assign((w.state.view as unknown as { estimates: object[] }).estimates[0]!, change);
      const out = (await cli(["group", "show", "g-alpha"], w.dir)).stdout;
      expect(out, JSON.stringify(change)).toContain(LINE);
      expect(out, JSON.stringify(change)).toContain(`\nto estimate: ${PATH}\n`);
    }
  });
});
