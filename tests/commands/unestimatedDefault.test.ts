// Session 3cfc2e73 D3 (spec 2026-11-05 §3.3, criterion 16): with no estimate applied, a task's work tokens are the
// unlimited default; group confirm's, group show's and proposal show's human output say so per task and name the path to
// an estimate. Their JSON is unchanged.
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

const LINE = "task t1: tokens: unlimited (default, not estimated)";
const PATH = "then orca group estimate g-alpha, orca group apply-estimate g-alpha, orca group confirm g-alpha";
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
