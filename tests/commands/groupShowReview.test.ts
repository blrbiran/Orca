import { describe, expect, it } from "vitest";
import { cli, fakePanel, useFakePanels } from "./fixtures/fakePanel.js";
import { reviewLines } from "../../src/commands/domains/verbs.js";

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

  // Tester #343: criteria no change to files can meet get no fix task; what answers them is a new plan draft or a person's call.
  it("a review no change to files can meet names a new plan draft and the person's answers, not review-fix", async () => {
    const p = await panel({ state: "not-passed", why: "not-fixable-by-work", problem: "requirement-review-not-passed:not-fixable-by-work", autoFixRounds: 0,
      rounds: [{ ...round("not-met", [{ id: "AC1", verdict: "not-met", evidence: [{ path: "plan", line: null }], missing: "every task names files", fixableBy: "plan" },
        { id: "AC2", verdict: "not-met", evidence: [{ path: "README.md", line: 1 }], missing: "the person must pick one", fixableBy: "person" }]), leftToPerson: ["AC1", "AC2"] }] });
    const lines = (await cli(["group", "show", "g-alpha"], p.dir)).stdout.split("\n");
    const at = lines.indexOf("problem: requirement-review-not-passed:not-fixable-by-work");
    expect(at).toBeGreaterThanOrEqual(0);
    // mutation: drop the not-fixable-by-work branch in reviewLines -> the generic review-fix lines, red
    expect(lines.slice(at, at + 8)).toEqual([
      "problem: requirement-review-not-passed:not-fixable-by-work",
      "review: s",
      "  AC1 not-met: every task names files",
      "  AC2 not-met: the person must pick one",
      "left to a person (no change to files can meet them): AC1 (plan), AC2 (person)",
      "next: orca requirement feedback g-alpha --text '<what to change in the plan>'  (AC1: a new draft of the plan)",
      "  or: orca group review-accept g-alpha --note '<why accept as is>'  (AC2: only a person can decide)",
      "  or: orca group review-rerun g-alpha --note '<what to look at>'",
    ]);
    expect(lines).not.toContain("next: orca group review-fix g-alpha --goal '<what to fix>'");
  });

  it("a fixing review names the criteria its fix task does not cover (#343)", async () => {
    const p = await panel({ state: "fixing", autoFixRounds: 1,
      rounds: [{ ...round("not-met", [{ id: "AC1", verdict: "not-met", evidence: [{ path: "a", line: 1 }], missing: "a", fixableBy: "work" },
        { id: "AC2", verdict: "not-met", evidence: [{ path: "plan", line: null }], missing: "b", fixableBy: "plan" }]), fixTaskId: "review-fix-1", leftToPerson: ["AC2"] }] });
    const lines = (await cli(["group", "show", "g-alpha"], p.dir)).stdout.split("\n");
    const at = lines.indexOf("review: fixing (task review-fix-1, round 1)");
    // mutation: drop leftLine from the fixing branch -> red
    expect(lines.slice(at, at + 2)).toEqual(["review: fixing (task review-fix-1, round 1)", "left to a person (no change to files can meet them): AC2 (plan)"]);
  });

  it("a passed review is one line; --json is unchanged", async () => {
    const p = await panel({ state: "passed", autoFixRounds: 0, rounds: [round("passed")] });
    const out = (await cli(["group", "show", "g-alpha"], p.dir)).stdout;
    expect(out.split("\n")).toContain(`review: passed on ${"a".repeat(12)} (round 1)`);
    expect(out).not.toContain("review-accept");
    expect((await cli(["group", "show", "g-alpha", "--json"], p.dir)).stdout).not.toContain("review: passed on");
  });

  // Tester #377: a criterion red only because the group's base was red too passed relative; show and brief name it.
  it("a passed review names each relative pass, in group show and group brief (#377)", async () => {
    const review = { state: "passed", autoFixRounds: 0, rounds: [{ ...round("passed", [{ id: "AC9", verdict: "not-met", evidence: [{ path: "orca:acceptance", line: null }], missing: "npm test exits 1", fixableBy: "work" }]),
      relativePass: [{ criterionId: "AC9", command: "npm test", tipExits: ["1", "1"], baseExits: ["1", "1"] }] }] };
    const expected = [`review: passed on ${"a".repeat(12)} (round 1)`,
      "  AC9 relative pass: `npm test` exited 1, 1 on this tip and 1, 1 at the group's base -- red before the group; not counted as not met"];
    const p = await panel(review);
    const shown = (await cli(["group", "show", "g-alpha"], p.dir)).stdout.split("\n");
    // mutation: drop relativePassLines from the passed branch of reviewLines -> red
    expect(shown.slice(shown.indexOf(expected[0]!), shown.indexOf(expected[0]!) + 2)).toEqual(expected);
    const b = await fakePanel({ "GET summary": SUMMARY, "GET groups/g-alpha/brief": { status: 200, body: { schema: "orca-group-brief-v1", groupId: "g-alpha", repoId: "repo-1", state: "done", commandRevision: 5, requirementReview: review } } });
    const brief = (await cli(["group", "brief", "g-alpha"], b.dir)).stdout.split("\n");
    expect(brief.slice(brief.indexOf(expected[0]!), brief.indexOf(expected[0]!) + 2)).toEqual(expected);
  });

  // Review of #377 (M4): a relative pass is named in every branch that prints a round -- fixing and both not-passed shapes.
  describe("the relative-pass line in the fixing and not-passed branches (#377 review M4)", () => {
    const relative = { criterionId: "AC9", command: "npm test", tipExits: ["1", "1"], baseExits: ["1", "1"] };
    const line = "  AC9 relative pass: `npm test` exited 1, 1 on this tip and 1, 1 at the group's base -- red before the group; not counted as not met";
    const ac9 = { id: "AC9", verdict: "not-met", evidence: [{ path: "orca:acceptance", line: null }], missing: "npm test exits 1", fixableBy: "work" };
    it("fixing", () => {
      const lines = reviewLines("g", <Parameters<typeof reviewLines>[1]>{ state: "fixing", autoFixRounds: 1, rounds: [{ ...round("not-met", [
        { id: "AC1", verdict: "not-met", evidence: [{ path: "a", line: 1 }], missing: "a", fixableBy: "work" }, ac9]), fixTaskId: "review-fix-1", relativePass: [relative] }] });
      // mutation: drop relativePassLines from the fixing branch -> red
      expect(lines).toEqual(["review: fixing (task review-fix-1, round 1)", line]);
    });
    it("not passed, not fixable by work", () => {
      const lines = reviewLines("g", <Parameters<typeof reviewLines>[1]>{ state: "not-passed", why: "not-fixable-by-work", autoFixRounds: 0, rounds: [{ ...round("not-met", [
        { id: "AC1", verdict: "not-met", evidence: [{ path: "plan", line: null }], missing: "plan", fixableBy: "plan" }, ac9]), leftToPerson: ["AC1"], relativePass: [relative] }] });
      // mutation: drop relativePassLines from the not-fixable-by-work branch -> red
      expect(lines.slice(2, 5)).toEqual(["  AC1 not-met: plan", "  AC9 not-met: npm test exits 1", line]);
    });
    it("not passed, any other why", () => {
      const lines = reviewLines("g", <Parameters<typeof reviewLines>[1]>{ state: "not-passed", why: "rounds-exhausted", autoFixRounds: 2, rounds: [{ ...round("not-met", [
        { id: "AC1", verdict: "not-met", evidence: [{ path: "a", line: 1 }], missing: "a", fixableBy: "work" }, ac9]), relativePass: [relative] }] });
      // mutation: drop relativePassLines from the last branch -> red
      expect(lines.slice(0, 5)).toEqual(["problem: requirement-review-not-passed:rounds-exhausted", "review: s", "  AC1 not-met: a", "  AC9 not-met: npm test exits 1", line]);
    });
  });
});
