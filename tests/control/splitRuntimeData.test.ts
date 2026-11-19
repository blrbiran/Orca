import { describe, expect, it } from "vitest";
import { readDraft } from "../../src/control/requirementRecords.js";
import type { SplitOutput } from "../../src/control/requirementSchemas.js";
import { RUNTIME_DATA_RULE, SPLIT_INSTRUCTION_MULTI_V5, SPLIT_INSTRUCTION_V7, SPLIT_INSTRUCTION_V8 } from "../../src/control/requirementSplit.js";
import { runtimeDataPaths } from "../../src/control/splitImpliedPaths.js";
import { readRequirementView } from "../../src/panel/controlViews.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { ROUND_TWO, VALID_SPLIT } from "./fixtures/requirementOutputs.js";

/**
 * Tester #362 (session 3ba26002): the requirement said incidents are kept in `.orca/incidents.json`; the split put that
 * path in `incident-cli`'s targetPaths and the delivery committed `{"version":1,"incidents":[]}`. Split instruction
 * version 8 states that such a runtime data file is not a deliverable unless the requirement asks to commit seed data,
 * and the requirement view hints (never refuses) on an exact data-file target under a dot-directory that the requirement
 * names, with the command that drops it.
 */
const task = (taskId: string, targetPaths: string[]): SplitOutput["tasks"][number] =>
  ({ taskId, title: taskId, labels: [], goal: "g", successCondition: "s", targetPaths, checks: ["true"], dependsOn: [], traces: ["AC1"] });
const output = (...tasks: SplitOutput["tasks"]): SplitOutput => ({ tasks, notes: "" });
const DOCUMENT = "Statement: incidents are kept in `.orca/incidents.json`, and the CLI reads `config/app.json` and `.orca/notes.md`.";

describe("a runtime data path in a task's targetPaths (#362)", () => {
  it("hints the tester's shape: an exact data file under a dot-directory that the requirement names", () => {
    // mutation: runtimeDataPaths returns [] -> red
    expect(runtimeDataPaths(output(task("incident-cli", ["src/incident-cli.js", "test/incident-cli.test.js", ".orca/incidents.json"])), DOCUMENT))
      .toEqual([{ taskId: "incident-cli", path: ".orca/incidents.json" }]);
  });

  it("does not hint a path the requirement does not name, a non-data file, a file outside a dot-directory, or a glob", () => {
    expect(runtimeDataPaths(output(task("a", [".orca/other.json"])), DOCUMENT)).toEqual([]);
    // mutation: drop the data-extension test -> .orca/notes.md hinted -> red
    expect(runtimeDataPaths(output(task("a", [".orca/notes.md"])), DOCUMENT)).toEqual([]);
    // mutation: drop the dot-directory test -> config/app.json hinted -> red
    expect(runtimeDataPaths(output(task("a", ["config/app.json"])), DOCUMENT)).toEqual([]);
    expect(runtimeDataPaths(output(task("a", [".orca/**"])), DOCUMENT)).toEqual([]);
    // A longer path that only contains the named one is not it.
    expect(runtimeDataPaths(output(task("a", ["x/.orca/incidents.json"])), DOCUMENT)).toEqual([]);
  });

  it("states the rule in split instruction version 8 only (older versions keep their bytes)", () => {
    // mutation: drop the RUNTIME_DATA_RULE replace from SPLIT_INSTRUCTION_V8 -> red
    expect(SPLIT_INSTRUCTION_V8.split(RUNTIME_DATA_RULE).length).toBe(2);
    expect(SPLIT_INSTRUCTION_V7).not.toContain(RUNTIME_DATA_RULE);
    expect(SPLIT_INSTRUCTION_MULTI_V5).not.toContain(RUNTIME_DATA_RULE);
  });

  it("the requirement view and requirement show carry the hint and the drop-path command", async () => {
    const split = { ...VALID_SPLIT, tasks: [{ ...VALID_SPLIT.tasks[0]!, targetPaths: ["src/export.ts", "answer.txt", ".orca/notes.json"] }, VALID_SPLIT.tasks[1]!] };
    const x = await requirementHarness({ answers: [{ purpose: "split", output: split }], startAt: "split",
      consensus: { statement: `${ROUND_TWO.statement} Exported notes are listed in .orca/notes.json.`, acceptanceCriteria: ROUND_TWO.acceptanceCriteria } });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state !== "drafting");
      expect(readDraft(x.store, "r", 1).state).toBe("awaiting-review");
      const view = readRequirementView(x.store, "e", "r");
      // mutation: drop runtimeDataPaths from the view -> red
      expect(view.drafts[0]).toMatchObject({ runtimeDataPaths: [{ taskId: "exporter", path: ".orca/notes.json" }] });
      const { findCommand } = await import("../../src/commands/registry.js");
      const found = findCommand(["requirement", "show"]);
      if (!("def" in found)) throw new Error("no requirement show row");
      // mutation: drop the requirement show line -> red
      // Review M7 (session 3ba26002): the hint is conditional -- "if that is where the program keeps its data".
      expect(found.def.format(view)).toContain("draft 1 exporter lists .orca/notes.json, a data file the requirement names, as a target path; if that is where the program keeps its data (not seed data the requirement asks to commit), drop it: orca requirement drop-path <group> --task exporter --path .orca/notes.json");
    } finally { await x.dispose(); }
  });
});
