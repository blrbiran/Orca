import { describe, expect, it } from "vitest";
import { editedSplit } from "../../src/control/requirementDraftEdit.js";
import { readDraft } from "../../src/control/requirementRecords.js";
import { overlapSerialized } from "../../src/control/splitParallel.js";
import { readRequirementView } from "../../src/panel/controlViews.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";

/**
 * Tester #335: a split gave sibling tasks the same broad claim (`src/**`), so the write-set rule (#268) turned an authored
 * diamond into a straight chain -- and said nothing: no parallel candidate (their write sets intersect), no reason, and
 * apply-parallel cannot drop an edge nobody declared. Code now names each pair that runs one after the other only because
 * a broad claim overlaps (a hint, never a refusal), and a person can narrow one claim to the paths inside it the task
 * really writes; the split is re-validated as a model's is, so a real overlap still orders the pair.
 */
const base = VALID_SPLIT.tasks[0]!;
const task = (taskId: string, targetPaths: string[], dependsOn: string[]) => ({ ...base, taskId, title: taskId, targetPaths, checks: ["true"], dependsOn, traces: ["AC1", "AC2"] });
/** The tester's shape: format, then velocity and cycle-time (siblings), then markdown; every task claims src/**. */
const DIAMOND = { tasks: [
  task("format", ["src/**"], []),
  task("velocity", ["src/**", "answer.txt"], ["format"]),
  task("cycle", ["src/**"], ["format"]),
  task("markdown", ["src/**"], ["format", "velocity", "cycle"]),
], notes: "" };

describe("pairs a broad claim serialises (#335)", () => {
  it("names the siblings ordered only by their shared src/** claim, not a pair a declared dependency orders", () => {
    // mutation: skip the declared-reachability test -> format/velocity etc. listed too, red
    expect(overlapSerialized(DIAMOND)).toEqual([{ a: "velocity", b: "cycle", paths: ["src/** ∩ src/**"] }]);
  });

  it("does not name a pair whose only overlap is the same file (that pair must run one after the other)", () => {
    // mutation: count an exact same-file claim as broad -> listed, red
    expect(overlapSerialized({ tasks: [task("a", ["src/x.ts"], []), task("b", ["src/x.ts"], [])], notes: "" })).toEqual([]);
    expect(overlapSerialized({ tasks: [task("a", ["src/**"], []), task("b", ["src/b.ts"], [])], notes: "" })).toEqual([{ a: "a", b: "b", paths: ["src/** ∩ src/b.ts"] }]);
  });

  it("narrow-target-path replaces one claim with paths inside it, and refuses one that is not inside or not claimed", () => {
    const narrowed = editedSplit(DIAMOND, { kind: "narrow-target-path", taskId: "velocity", path: "src/**", to: ["src/velocity.js"] });
    expect((narrowed.output as typeof DIAMOND).tasks[1]!.targetPaths).toEqual(["src/velocity.js", "answer.txt"]);
    expect(narrowed.note).toBe("person edit: narrowed velocity's target path src/** to src/velocity.js");
    // mutation: drop the containment check -> a wider path is accepted, red
    expect(() => editedSplit(DIAMOND, { kind: "narrow-target-path", taskId: "velocity", path: "answer.txt", to: ["src/**"] }))
      .toThrow("draft-edit-not-narrower:velocity:answer.txt:src/**");
    expect(() => editedSplit(DIAMOND, { kind: "narrow-target-path", taskId: "velocity", path: "lib/**", to: ["lib/a.js"] }))
      .toThrow("draft-edit-not-a-target-path:velocity:lib/**");
  });

  it("orca requirement show prints the pair with the command that frees it", async () => {
    const { findCommand } = await import("../../src/commands/registry.js");
    const found = findCommand(["requirement", "show"]);
    if (!("def" in found)) throw new Error("no requirement show row");
    const out = found.def.format({ schema: "orca-requirement-view-v1", drafts: [{ draftNo: 1, layers: [["format"], ["cycle"]], overlapSerialized: [{ a: "velocity", b: "cycle", paths: ["src/** ∩ src/**"] }] }] });
    // mutation: drop the overlap line from the requirement show format -> red
    expect(out).toContain("draft 1 velocity and cycle run one after the other only because their target paths overlap (src/** ∩ src/**); orca requirement narrow-path");
  });

  it("the draft names the pair, and two narrowing edits put the siblings in one layer of the next draft", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: DIAMOND }], startAt: "split" });
    const edit = (draftNo: number, change: Record<string, unknown>) =>
      x.service.editRequirementDraft(x.command("requirement-draft-edit", { draftNo, draftHash: readDraft(x.store, "r", draftNo).draftHash, edit: change }));
    try {
      await x.until(() => readDraft(x.store, "r", 1).state !== "drafting");
      expect(readDraft(x.store, "r", 1).layers).toEqual([["format"], ["cycle"], ["velocity"], ["markdown"]]);
      // mutation: drop overlapSerialized from the requirement view -> undefined, red
      expect(readRequirementView(x.store, "e", "r").drafts[0]).toMatchObject({ overlapSerialized: [{ a: "velocity", b: "cycle", paths: ["src/** ∩ src/**"] }] });
      expect(await edit(1, { kind: "narrow-target-path", taskId: "velocity", path: "src/**", to: ["src/velocity.js"] })).toMatchObject({ result: { kind: "requirement-draft-edited", nextDraftNo: 2 } });
      expect(await edit(2, { kind: "narrow-target-path", taskId: "cycle", path: "src/**", to: ["src/cycle.js"] })).toMatchObject({ result: { kind: "requirement-draft-edited", nextDraftNo: 3 } });
      expect(readDraft(x.store, "r", 3)).toMatchObject({ state: "awaiting-review", layers: [["format"], ["cycle", "velocity"], ["markdown"]] });
      expect(readRequirementView(x.store, "e", "r").drafts.find((d) => d.draftNo === 3)).toMatchObject({ overlapSerialized: [] });
    } finally { await x.dispose(); }
  });
});
