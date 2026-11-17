import { describe, expect, it } from "vitest";
import { cli, fakePanel, useFakePanels } from "./fixtures/fakePanel.js";

/** Tester follow-up G spec §3.3, §3.5: `group show` names the requirement review and, when it did not pass, its three exits. */
useFakePanels();

const SUMMARY = { status: 200, body: { schema: "orca-control-summary-v1", groups: [{ groupId: "g-alpha", state: "running", commandRevision: 5 }] } };
const round = (result: string, criteria: unknown[] = []) => ({ roundNo: 1, tip: "a".repeat(40), runId: "run-r", at: 1, result, criteria, summary: "s" });
const panel = (requirementReview: unknown) => fakePanel({ "GET summary": SUMMARY, "GET groups/g-alpha": { status: 200, body: {
  schema: "orca-control-group-v1", summary: { groupId: "g-alpha", repoId: "repo-1", state: "running", commandRevision: 5, requirementReview }, workItems: [], runs: [] } } });

describe("group show names the requirement review (tester follow-up G §3.3)", () => {
  // Ruling: human 2026-11-16 「这次批准改写所有必要的判据」. This now includes the persisted review summary so a CLI user sees why automatic repair stopped.
  it("a not-passed review names its problem, summary, criteria, and three commands in that order", async () => {
    const p = await panel({ state: "not-passed", why: "cannot-judge", problem: "requirement-review-not-passed:cannot-judge", autoFixRounds: 0,
      rounds: [round("cannot-judge", [{ id: "AC1", verdict: "met", evidence: [{ path: "a", line: 1 }], missing: null }, { id: "AC2", verdict: "cannot-judge", evidence: [], missing: null }])] });
    const lines = (await cli(["group", "show", "g-alpha"], p.dir)).stdout.split("\n");
    const at = lines.indexOf("problem: requirement-review-not-passed:cannot-judge");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(lines.slice(at, at + 7)).toEqual([
      "problem: requirement-review-not-passed:cannot-judge",
      "review: s",
      "  AC1 met: a",
      "  AC2 cannot-judge: ",
      "next: orca group review-fix g-alpha --goal '<what to fix>'",
      "  or: orca group review-rerun g-alpha --note '<what to look at>'",
      "  or: orca group review-accept g-alpha --note '<why accept as is>'",
    ]);
  });

  it("names the reported human-check conflict before suggesting a manual review action (#322)", async () => {
    const summary = "check conflict reported for AC1: npm test; the person's no-repair restriction and the check cannot both pass. No automatic fix.";
    const p = await panel({ state: "not-passed", why: "cannot-judge", problem: "requirement-review-not-passed:cannot-judge", autoFixRounds: 0,
      rounds: [{ ...round("not-met", [{ id: "AC1", verdict: "not-met", evidence: [{ path: "README.md", line: 1 }], missing: "revert the old repair" }]), summary }] });
    const lines = (await cli(["group", "show", "g-alpha"], p.dir)).stdout.split("\n");
    const at = lines.indexOf("problem: requirement-review-not-passed:cannot-judge");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(lines.slice(at, at + 3)).toEqual(["problem: requirement-review-not-passed:cannot-judge", `review: ${summary}`, "  AC1 not-met: revert the old repair"]);
    expect(lines).toContain("  or: orca group review-rerun g-alpha --note '<what to look at>'");
  });

  it("prints a recorded check conflict as its three facts (#340)", async () => {
    const p = await panel({ state: "not-passed", why: "check-conflict", problem: "requirement-review-not-passed:check-conflict", autoFixRounds: 0,
      rounds: [{ ...round("not-met", [{ id: "AC1", verdict: "not-met", evidence: [{ path: "README.md", line: 1 }], missing: "revert" }]),
        checkConflict: { criterionId: "AC1", requiredCheck: "npm test", because: "only add" } }] });
    const lines = (await cli(["group", "show", "g-alpha"], p.dir)).stdout.split("\n");
    // mutation: drop the conflict lines from reviewLines -> red
    const at = lines.indexOf("conflict: criterion AC1");
    expect(at).toBeGreaterThan(0);
    expect(lines.slice(at, at + 3)).toEqual(["conflict: criterion AC1", "  required check: npm test", "  because: only add"]);
  });

  it("a passed review is one line; --json is unchanged", async () => {
    const p = await panel({ state: "passed", autoFixRounds: 0, rounds: [round("passed")] });
    const out = (await cli(["group", "show", "g-alpha"], p.dir)).stdout;
    expect(out.split("\n")).toContain(`review: passed on ${"a".repeat(12)} (round 1)`);
    expect(out).not.toContain("review-accept");
    expect((await cli(["group", "show", "g-alpha", "--json"], p.dir)).stdout).not.toContain("review: passed on");
  });
});
