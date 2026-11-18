import { describe, expect, it } from "vitest";
import { readDraft } from "../../src/control/requirementRecords.js";
import { readRequirementView } from "../../src/panel/controlViews.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";

/**
 * Tester #353 (c) (plan 2026-11-18 tester batch D, D6; human ruling 「同意」: implied paths go back to a hint, one-click
 * `add-implied-path` kept; reverses #265's auto-add): a success condition that names a sibling's file only to say it is
 * NOT used -- the deps-dogfood shape, "does not import src/deps-report.js" -- had that file added to the task's
 * targetPaths, so the two write sets met and two independent tasks ran one after the other. A path a success condition
 * names is now suggested (with the command that adds it), never added by the split itself.
 */
const base = VALID_SPLIT.tasks[0]!;
const task = (taskId: string, targetPaths: string[], successCondition: string) =>
  ({ ...base, taskId, title: taskId, targetPaths, successCondition, checks: ["true"], dependsOn: [], traces: ["AC1", "AC2"] });
const DEPS_DOGFOOD = { tasks: [
  task("graph", ["src/deps-graph.js"], "src/deps-graph.js prints the graph and does not import src/deps-report.js."),
  task("report", ["src/deps-report.js"], "src/deps-report.js prints the report."),
], notes: "" };

describe("a path a success condition names is suggested, not added (#353 c)", () => {
  it("the deps-dogfood shape: targetPaths unchanged, the two tasks run in parallel, the hint names the add command", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: DEPS_DOGFOOD }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state !== "drafting");
      const draft = readDraft(x.store, "r", 1);
      // mutation: evaluateSplit applies the implied paths again -> graph writes src/deps-report.js, the layers serialise; red here.
      expect((draft.output as typeof DEPS_DOGFOOD).tasks.map((t) => [t.taskId, t.targetPaths])).toEqual([["graph", ["src/deps-graph.js"]], ["report", ["src/deps-report.js"]]]);
      expect(draft).toMatchObject({ state: "awaiting-review", reasons: [], layers: [["graph", "report"]] });
      expect(draft.implicitEdges ?? []).toEqual([]);
      expect(draft.impliedPathsAdded ?? []).toEqual([]);
      expect(readRequirementView(x.store, "e", "r").drafts[0]).toMatchObject({ impliedPathsOutsideTargets: [{ taskId: "graph", path: "src/deps-report.js", writers: ["report"] }] });
      const { findCommand } = await import("../../src/commands/registry.js");
      const found = findCommand(["requirement", "show"]);
      if (!("def" in found)) throw new Error("no requirement show row");
      expect(found.def.format(readRequirementView(x.store, "e", "r"))).toContain("(orca requirement add-implied-path <group> --task graph --path src/deps-report.js)");
    } finally { await x.dispose(); }
  });

  it("add-implied-path still gives the task the file, and the next draft orders the two writers", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: DEPS_DOGFOOD }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state !== "drafting");
      const edited = await x.service.editRequirementDraft(x.command("requirement-draft-edit", { draftNo: 1, draftHash: readDraft(x.store, "r", 1).draftHash,
        edit: { kind: "add-implied-path", taskId: "graph", path: "src/deps-report.js" } }));
      expect(edited).toMatchObject({ result: { kind: "requirement-draft-edited", draftNo: 1, nextDraftNo: 2 } });
      const next = readDraft(x.store, "r", 2);
      expect((next.output as typeof DEPS_DOGFOOD).tasks.find((t) => t.taskId === "graph")!.targetPaths).toEqual(["src/deps-graph.js", "src/deps-report.js"]);
      expect(next.implicitEdges).toHaveLength(1);
    } finally { await x.dispose(); }
  });
});
