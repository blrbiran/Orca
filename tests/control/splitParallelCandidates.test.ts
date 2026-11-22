import { describe, expect, it } from "vitest";
import { buildSplitPrompt } from "../../src/control/requirementSplit.js";
import { readDraft } from "../../src/control/requirementRecords.js";
import { parallelCandidates } from "../../src/control/splitParallel.js";
import { readRequirementView } from "../../src/panel/controlViews.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";

// Tester #284: splits routinely chained independent modules (dag-core -> graph-cli -> planning-cli -> readme), so a group
// ran its longest wall-clock and each task re-read its predecessor's output; only a person's feedback fanned it out.
// Tester #384 (supersedes #284's rule and follow-up K's prose filters): reading the task's words could not tell an import
// from silence, and a live policy draft listed T3 -> T4a/T4b though the CLI imports the engine. A candidate is now only a
// declared edge whose pair a broad write-set overlap already orders (#268) -- dropping the declaration keeps code's own
// order, so applying it can never move a task in front of what it needs. An edge between disjoint write sets is the
// author's semantic dependency and is never listed.
const base = VALID_SPLIT.tasks[0]!;
const task = (taskId: string, targetPaths: string[], dependsOn: string[], checks = ["true"]) => ({ ...base, taskId, title: taskId, targetPaths, checks, dependsOn, traces: ["AC1", "AC2"] });
/** `core` claims a directory, so code orders core before later and more whether or not the edges are declared. */
const OVERLAP = { tasks: [
  task("core", ["src/**"], []),
  task("later", ["src/later.ts"], ["core"]),
  task("more", ["src/more.ts"], ["core"]),
], notes: "" };

describe("the split's parallel candidates (#384)", () => {
  it("lists a declared edge whose pair a broad overlap already orders, and no edge between disjoint write sets", () => {
    // mutation: drop the overlap requirement in parallelCandidates -> [] here, red
    expect(parallelCandidates(OVERLAP)).toEqual([{ before: "core", after: "later" }, { before: "core", after: "more" }]);
    // mutation: list every declared edge -> the disjoint edge is listed here, red
    expect(parallelCandidates({ tasks: [task("core", ["src/core.ts"], []), task("later", ["src/later.ts"], ["core"])], notes: "" })).toEqual([]);
  });

  it("does not list two tasks naming the same exact file (they must take turns, and the author sets the turn)", () => {
    // mutation: accept an equal, non-directory conflict -> a -> b listed, red
    expect(parallelCandidates({ tasks: [task("a", ["src/x.ts"], []), task("b", ["src/x.ts"], ["a"])], notes: "" })).toEqual([]);
  });

  it("does not list an edge another dependency path already implies (dropping it would not let the two run at once)", () => {
    // a -> b -> c and a -> c: the direct a -> c is redundant, a -> b is a candidate (a claims the directory).
    // mutation: reachesOtherwise always false -> a -> c listed, red
    const out = { tasks: [task("a", ["src/**"], []), task("b", ["src/b.ts"], ["a"]), task("c", ["src/c.ts"], ["b", "a"])], notes: "" };
    expect(parallelCandidates(out)).toEqual([{ before: "a", after: "b" }]);
  });

  it("does not list an edge whose removal would reverse the pair (code's implicit edge follows the plan's order)", () => {
    // `a` sorts before `z`, so without the declaration the implicit edge runs a -> z: the declaration is the only thing
    // keeping z first, and it is not dropped. mutation: skip keepsOrder -> z -> a listed, red
    expect(parallelCandidates({ tasks: [task("z", ["src/**"], []), task("a", ["src/a.ts"], ["z"])], notes: "" })).toEqual([]);
  });

  it("multi-directory: only a broad overlap in the same directory counts", () => {
    const multi = (taskId: string, writes: Array<{ dir: string; targetPaths: string[]; checks: string[] }>, dependsOn: string[]) =>
      ({ taskId, title: taskId, labels: ["feature"], goal: "g", successCondition: "s", writes, dependsOn, traces: ["AC1"] });
    const output = { tasks: [
      multi("core", [{ dir: "d1", targetPaths: ["lib/**"], checks: ["true"] }], []),
      multi("reads", [{ dir: "d1", targetPaths: ["lib/r.ts"], checks: ["true"] }], ["core"]),
      // The same path in another directory never intersects (writeSet.ts qualifies by directory).
      multi("other", [{ dir: "d2", targetPaths: ["lib/core.ts"], checks: ["true"] }], ["core"]),
    ], notes: "" };
    // mutation: compare unqualified claims -> core -> other listed, red
    expect(parallelCandidates(output)).toEqual([{ before: "core", after: "reads" }]);
  });

  it("an accepted-shape draft carries the candidates on the requirement view, and they add no hand-back reason", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: OVERLAP }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state !== "drafting");
      const draft = readDraft(x.store, "r", 1);
      expect(draft).toMatchObject({ state: "awaiting-review", reasons: [], layers: [["core"], ["later", "more"]] });
      // mutation: drop parallelCandidates from readRequirementView -> undefined, red
      expect(readRequirementView(x.store, "e", "r").drafts[0]).toMatchObject({ reasons: [], parallelCandidates: [{ before: "core", after: "later" }, { before: "core", after: "more" }] });
    } finally { await x.dispose(); }
  });

  it("orca requirement show prints the layers and the candidates, with how to apply them by pair", async () => {
    const { findCommand } = await import("../../src/commands/registry.js");
    const found = findCommand(["requirement", "show"]);
    if (!("def" in found)) throw new Error("no requirement show row");
    const body = { schema: "orca-requirement-view-v1", drafts: [{ draftNo: 2, layers: [["core"], ["a", "b"]], parallelCandidates: [{ before: "a", after: "c" }] }, { draftNo: 1, layers: null }] };
    // mutation: drop the row's format (text only) -> neither line, red
    const out = found.def.format(body);
    expect(out).toContain("draft 2 layers: [core] -> [a, b]");
    expect(out).toContain("draft 2 has dependsOn edges whose pairs their overlapping target paths already order");
    // mutation: drop the selection hint -> the line names no --pair, red
    expect(out).toContain("--pair <before>:<after>");
    expect(out).toContain("a ∥ c");
    expect(out).not.toContain("draft 1 layers");
  });

  // Ruling: 「这次批准改写所有必要的判据」 (human, session 9982cf01, 2026-11-17): #328 made the single-repository split
  // instruction version 6 (V5 plus the optional historyExpectation); the parallel rule must still ride the current call.
  // Ruling: human 「这次批准改写所有必要的判据」 (Orca session ca534c51, 2026-11-18) — the #351 addendum made it version 7; the parallel rule must still ride the current call.
  it("the instruction tells the model to partition first and chain only on real need, in version 7", () => {
    const prompt = buildSplitPrompt({ document: "D.", overview: { canonicalJson: "{}", hash: "b".repeat(64) }, earlierDrafts: [] });
    const multi = buildSplitPrompt({ document: "D.", overview: { canonicalJson: "{}", hash: "b".repeat(64) }, earlierDrafts: [], multi: true });
    const rule = "- First partition the work into independent branches by deliverable and target paths; then add a `dependsOn` edge only where a task truly needs another's output (it reads or builds on files the other writes). Never chain tasks to be safe: independent tasks run in parallel.";
    // mutation: drop PARALLEL_RULE from either instruction -> red
    expect(prompt).toContain(rule);
    expect(multi).toContain(rule);
    // Ruling: human 「这次批准改写所有必要的判据」 (Orca session, 2026-11-23): tester #385 makes the default single-repository
    // instruction version 9; the parallel rule still rides the current call.
    expect(prompt.split("\n", 1)[0]).toBe("Orca requirement split, instruction version 9.");
  });
});
