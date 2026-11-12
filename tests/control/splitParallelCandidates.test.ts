import { describe, expect, it } from "vitest";
import { buildSplitPrompt } from "../../src/control/requirementSplit.js";
import { readDraft } from "../../src/control/requirementRecords.js";
import { parallelCandidates } from "../../src/control/splitParallel.js";
import { readRequirementView } from "../../src/panel/controlViews.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";

// Tester #284: splits routinely chained independent modules (dag-core -> graph-cli -> planning-cli -> readme), so a group
// ran its longest wall-clock and each task re-read its predecessor's output; only a person's feedback fanned it out.
// The instruction now says to partition first and chain only on real need, and code lists, as a hint that never refuses
// a draft, each declared edge it sees no reason for.
const base = VALID_SPLIT.tasks[0]!;
const task = (taskId: string, targetPaths: string[], dependsOn: string[], checks = ["true"]) => ({ ...base, taskId, title: taskId, targetPaths, checks, dependsOn, traces: ["AC1", "AC2"] });
/** A core, then a chain of three tasks with disjoint writes; `a` checks a file core writes, so core -> a is real. */
const CHAIN = { tasks: [
  task("core", ["src/core.ts"], []),
  task("a", ["src/a.ts"], ["core"], ["grep -q core ./src/core.ts"]),
  task("b", ["src/b.ts"], ["a"]),
  task("c", ["src/c.ts"], ["b"]),
], notes: "" };

describe("the split's parallel candidates (#284)", () => {
  it("a chain of disjoint-write tasks lists each edge; an edge whose later task checks the earlier's file does not", () => {
    // mutation: drop the check-reference test in parallelCandidates -> core ∥ a listed, red
    expect(parallelCandidates(CHAIN)).toEqual([{ before: "a", after: "b" }, { before: "b", after: "c" }]);
  });

  it("a pair whose write sets intersect is not listed (a directory claim containing the other's file)", () => {
    // mutation: drop the write-set intersect test -> a ∥ b listed, red
    expect(parallelCandidates({ tasks: [task("a", ["src/**"], []), task("b", ["src/b.ts"], ["a"])], notes: "" })).toEqual([]);
  });

  it("an edge another dependency path already implies is not listed (dropping it would not let the two run at once)", () => {
    // a -> b -> c and a -> c: the direct a -> c is redundant, the others are candidates.
    // mutation: reachesOtherwise always false -> a ∥ c listed, red
    const out = { tasks: [task("a", ["src/a.ts"], []), task("b", ["src/b.ts"], ["a"]), task("c", ["src/c.ts"], ["b", "a"])], notes: "" };
    expect(parallelCandidates(out)).toEqual([{ before: "a", after: "b" }, { before: "b", after: "c" }]);
  });

  it("multi-directory writes: a check in one directory names a file the earlier task writes in that directory only", () => {
    const multi = (taskId: string, writes: Array<{ dir: string; targetPaths: string[]; checks: string[] }>, dependsOn: string[]) =>
      ({ taskId, title: taskId, labels: ["feature"], goal: "g", successCondition: "s", writes, dependsOn, traces: ["AC1"] });
    const output = { tasks: [
      multi("core", [{ dir: "d1", targetPaths: ["lib/core.ts"], checks: ["true"] }], []),
      multi("reads", [{ dir: "d1", targetPaths: ["lib/r.ts"], checks: ["cat lib/core.ts"] }], ["core"]),
      multi("other", [{ dir: "d2", targetPaths: ["lib/core.ts"], checks: ["cat lib/core.ts"] }], ["core"]),
    ], notes: "" };
    expect(parallelCandidates(output)).toEqual([{ before: "core", after: "other" }]);
  });

  it("an accepted-shape draft carries the candidates on the requirement view, and they add no hand-back reason", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: CHAIN }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state !== "drafting");
      const draft = readDraft(x.store, "r", 1);
      expect(draft).toMatchObject({ state: "awaiting-review", reasons: [], layers: [["core"], ["a"], ["b"], ["c"]] });
      // mutation: drop parallelCandidates from readRequirementView -> undefined, red
      expect(readRequirementView(x.store, "e", "r").drafts[0]).toMatchObject({ reasons: [], parallelCandidates: [{ before: "a", after: "b" }, { before: "b", after: "c" }] });
    } finally { await x.dispose(); }
  });

  it("orca requirement show prints the layers and the candidates", async () => {
    const { findCommand } = await import("../../src/commands/registry.js");
    const found = findCommand(["requirement", "show"]);
    if (!("def" in found)) throw new Error("no requirement show row");
    const body = { schema: "orca-requirement-view-v1", drafts: [{ draftNo: 2, layers: [["core"], ["a", "b"]], parallelCandidates: [{ before: "a", after: "c" }] }, { draftNo: 1, layers: null }] };
    // mutation: drop the row's format (text only) -> neither line, red
    const out = found.def.format(body);
    expect(out).toContain("draft 2 layers: [core] -> [a, b]");
    expect(out).toContain("draft 2 could run in parallel");
    expect(out).toContain("a ∥ c");
    expect(out).not.toContain("draft 1 layers");
  });

  it("the instruction tells the model to partition first and chain only on real need, in version 5", () => {
    const prompt = buildSplitPrompt({ document: "D.", overview: { canonicalJson: "{}", hash: "b".repeat(64) }, earlierDrafts: [] });
    const multi = buildSplitPrompt({ document: "D.", overview: { canonicalJson: "{}", hash: "b".repeat(64) }, earlierDrafts: [], multi: true });
    const rule = "- First partition the work into independent branches by deliverable and target paths; then add a `dependsOn` edge only where a task truly needs another's output (it reads or builds on files the other writes). Never chain tasks to be safe: independent tasks run in parallel.";
    // mutation: drop PARALLEL_RULE from either instruction -> red
    expect(prompt).toContain(rule);
    expect(multi).toContain(rule);
    expect(prompt.split("\n", 1)[0]).toBe("Orca requirement split, instruction version 5.");
  });
});
