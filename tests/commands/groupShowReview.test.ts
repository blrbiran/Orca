import { describe, expect, it } from "vitest";
import { cli, fakePanel, useFakePanels } from "./fixtures/fakePanel.js";

/** Tester follow-up G spec §3.3, §3.5: `group show` names the requirement review and, when it did not pass, its three exits. */
useFakePanels();

const SUMMARY = { status: 200, body: { schema: "orca-control-summary-v1", groups: [{ groupId: "g-alpha", state: "running", commandRevision: 5 }] } };
const round = (result: string, criteria: unknown[] = []) => ({ roundNo: 1, tip: "a".repeat(40), runId: "run-r", at: 1, result, criteria, summary: "s" });
const panel = (requirementReview: unknown) => fakePanel({ "GET summary": SUMMARY, "GET groups/g-alpha": { status: 200, body: {
  schema: "orca-control-group-v1", summary: { groupId: "g-alpha", repoId: "repo-1", state: "running", commandRevision: 5, requirementReview }, workItems: [], runs: [] } } });

describe("group show names the requirement review (tester follow-up G §3.3)", () => {
  it("a not-passed review names its problem, each criterion, and the three commands in that order", async () => {
    const p = await panel({ state: "not-passed", why: "cannot-judge", problem: "requirement-review-not-passed:cannot-judge", autoFixRounds: 0,
      rounds: [round("cannot-judge", [{ id: "AC1", verdict: "met", evidence: [{ path: "a", line: 1 }], missing: null }, { id: "AC2", verdict: "cannot-judge", evidence: [], missing: null }])] });
    const lines = (await cli(["group", "show", "g-alpha"], p.dir)).stdout.split("\n");
    const at = lines.indexOf("problem: requirement-review-not-passed:cannot-judge");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(lines.slice(at, at + 6)).toEqual([
      "problem: requirement-review-not-passed:cannot-judge",
      "  AC1 met: a",
      "  AC2 cannot-judge: ",
      "next: orca group review-fix g-alpha --goal '<what to fix>'",
      "  or: orca group review-rerun g-alpha --note '<what to look at>'",
      "  or: orca group review-accept g-alpha --note '<why accept as is>'",
    ]);
  });

  it("a passed review is one line; --json is unchanged", async () => {
    const p = await panel({ state: "passed", autoFixRounds: 0, rounds: [round("passed")] });
    const out = (await cli(["group", "show", "g-alpha"], p.dir)).stdout;
    expect(out.split("\n")).toContain(`review: passed on ${"a".repeat(12)} (round 1)`);
    expect(out).not.toContain("review-accept");
    expect((await cli(["group", "show", "g-alpha", "--json"], p.dir)).stdout).not.toContain("review: passed on");
  });
});
