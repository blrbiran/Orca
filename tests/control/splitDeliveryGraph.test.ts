import { describe, expect, it } from "vitest";
import { buildSplitPrompt, deliveryGraphProblems, explainSplitReason, SPLIT_INSTRUCTION_V8, SPLIT_INSTRUCTION_V9, withoutEmptySetup } from "../../src/control/requirementSplit.js";
import type { SplitOutput } from "../../src/control/requirementSchemas.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";

// Split instruction v9 (spec 2026-11-23-split-instruction-v9-design.md, tester #385): the answer states the delivery
// graph the requirement gave it, and validateSplitDraft keeps the draft to that claim. Code cannot read prose, so the
// checks below are the model against its own `deliveryGraph` -- each a hand-back reason, not a refusal.
const base = VALID_SPLIT.tasks[0]!;
const task = (taskId: string, dependsOn: string[] = [], checks = ["node src/check.js"]) =>
  ({ ...base, taskId, title: taskId, targetPaths: ["src/a.js"], successCondition: "done", checks, dependsOn, traces: ["AC1"] });
const draft = (tasks: ReturnType<typeof task>[], deliveryGraph?: SplitOutput["deliveryGraph"]): SplitOutput =>
  ({ tasks, notes: "", ...(deliveryGraph === undefined ? {} : { deliveryGraph }) });

describe("split instruction v9 head and graph rule (#385)", () => {
  it("the v9 prompt says version 9 and carries the delivery-graph rule; v8's bytes are unchanged", () => {
    const overview = { canonicalJson: "{}", hash: "a".repeat(64) };
    const v9 = buildSplitPrompt({ document: "D.", overview, earlierDrafts: [], instructionVersion: 9 });
    expect(v9.split("\n")[0]).toBe("Orca requirement split, instruction version 9.");
    expect(v9).toContain("deliveryGraph");
    // mutation: pick V8 for instructionVersion 9 -> the head assertion above is red.
    // A version-8 call keeps version 8's bytes: its head is version 8 and it never mentions the graph key.
    const v8 = buildSplitPrompt({ document: "D.", overview, earlierDrafts: [], instructionVersion: 8 });
    expect(v8.split("\n")[0]).toBe("Orca requirement split, instruction version 8.");
    expect(v8.startsWith(SPLIT_INSTRUCTION_V8)).toBe(true);
    expect(v8).not.toContain("deliveryGraph");
    expect(SPLIT_INSTRUCTION_V9).not.toBe(SPLIT_INSTRUCTION_V8);
  });
});

describe("a draft is checked against the delivery graph it claims (#385)", () => {
  it("a draft with no deliveryGraph passes untouched", () => {
    // mutation: flag a draft with no graph -> red
    expect(deliveryGraphProblems(draft([task("a")]))).toEqual([]);
  });

  it("names a task the graph does not claim", () => {
    // mutation: drop the unassigned loop -> red
    const output = draft([task("a"), task("b")], { units: [{ unit: "T1", taskIds: ["a"], dependsOn: [] }], independent: [], finalVerification: null });
    expect(deliveryGraphProblems(output)).toContain("delivery-graph-unit-unassigned:b");
  });

  it("refuses an edge outside the graph's order and accepts one inside it", () => {
    const graph: SplitOutput["deliveryGraph"] = {
      units: [{ unit: "T1", taskIds: ["a"], dependsOn: [] }, { unit: "T2", taskIds: ["b"], dependsOn: [] }],
      independent: [["T1", "T2"]], finalVerification: null,
    };
    // mutation: allow every cross-unit edge -> the first assertion is red ("b" -> "a" leaks).
    expect(deliveryGraphProblems(draft([task("a"), task("b", ["a"])], graph))).toContain("delivery-graph-edge:b:a");
    // An edge the graph orders is fine: T2 follows T1.
    const ordered: SplitOutput["deliveryGraph"] = {
      units: [{ unit: "T1", taskIds: ["a"], dependsOn: [] }, { unit: "T2", taskIds: ["b"], dependsOn: ["T1"] }],
      independent: [], finalVerification: null,
    };
    expect(deliveryGraphProblems(draft([task("a"), task("b", ["a"])], ordered))).toEqual([]);
  });

  it("refuses an edge between units the requirement calls independent", () => {
    const graph: SplitOutput["deliveryGraph"] = {
      units: [{ unit: "T2a", taskIds: ["a"], dependsOn: [] }, { unit: "T2b", taskIds: ["b"], dependsOn: [] }],
      independent: [["T2a", "T2b"]], finalVerification: null,
    };
    // mutation: drop the independence loop -> red
    expect(deliveryGraphProblems(draft([task("a"), task("b", ["a"])], graph))).toContain("delivery-graph-independent:b:a");
  });

  it("requires a wave-k unit to reach wave k-1, not only to avoid its own wave (#501)", () => {
    const graph: SplitOutput["deliveryGraph"] = {
      units: [
        { unit: "L1 schema", taskIds: ["schema"], dependsOn: [] },
        { unit: "L2 apply", taskIds: ["apply"], dependsOn: ["L1 schema"] },
        { unit: "L3 audit", taskIds: ["audit"], dependsOn: ["L1 schema"] },
        { unit: "L3 cli", taskIds: ["cli"], dependsOn: ["L2 apply"] },
      ],
      independent: [["L1 schema"], ["L2 apply"], ["L3 audit", "L3 cli"]], finalVerification: null,
    };
    const output = draft([task("schema"), task("apply", ["schema"]), task("audit", ["schema"]), task("cli", ["apply"])], graph);
    // mutation: drop the wave loop -> the audit unit is accepted beside Layer 2, red
    expect(deliveryGraphProblems(output)).toContain("delivery-graph-layer:audit:L3 audit");
    expect(deliveryGraphProblems(output)).not.toContain("delivery-graph-layer:cli:L3 cli");
  });

  it("a final-verification claim must actually run the suite; the positive shape passes", () => {
    const bad = draft([task("a", [], ["node src/check.js"])], {
      units: [{ unit: "T1", taskIds: ["a"], dependsOn: [] }], independent: [], finalVerification: "a",
    });
    // mutation: accept any finalVerification task -> red
    expect(deliveryGraphProblems(bad)).toContain("delivery-graph-final-verification:a");
    const good = draft([task("a", [], ["npm test"])], {
      units: [{ unit: "T1", taskIds: ["a"], dependsOn: [] }], independent: [], finalVerification: "a",
    });
    expect(deliveryGraphProblems(good)).toEqual([]);
  });

  it.each(["npm test || true", "npm test; exit 0", "grep -q 'npm test' README.md"])("does not count %s as final verification (#536)", (check) => {
    const output = draft([task("a", [], [check])], {
      units: [{ unit: "T1", taskIds: ["a"], dependsOn: [] }], independent: [], finalVerification: "a",
    });
    expect(deliveryGraphProblems(output)).toContain("delivery-graph-final-verification:a");
  });

  it.each(["node --test", "go test ./...", "npm test && true", "npm run test:full"])("recognizes %s without masking a failing suite (#536)", (check) => {
    const output = draft([task("a", [], [check])], {
      units: [{ unit: "T1", taskIds: ["a"], dependsOn: [] }], independent: [], finalVerification: "a",
    });
    expect(deliveryGraphProblems(output)).toEqual([]);
  });
});

describe("a codex split's required-nullable deliveryGraph is folded before the strict schema (#385)", () => {
  it("drops a null or empty-units deliveryGraph, and keeps a real one", () => {
    // #358: codex's strict projection makes an optional key required-nullable, so the model answers `"deliveryGraph": null`
    // when it names no units. The strict schema would refuse the whole call; the fold folds it away.
    // mutation: return raw for a null graph -> the first assertion is red (the key survives).
    const base = { tasks: VALID_SPLIT.tasks, notes: "" };
    expect(Object.hasOwn(withoutEmptySetup({ ...base, deliveryGraph: null }) as object, "deliveryGraph")).toBe(false);
    expect(Object.hasOwn(withoutEmptySetup({ ...base, deliveryGraph: { units: [], independent: [], finalVerification: null } }) as object, "deliveryGraph")).toBe(false);
    const real = { units: [{ unit: "T1", taskIds: [VALID_SPLIT.tasks[0]!.taskId], dependsOn: [] }], independent: [], finalVerification: null };
    expect(withoutEmptySetup({ ...base, deliveryGraph: real })).toMatchObject({ deliveryGraph: real });
  });
});

describe("declared unit order (#534 #548)", () => {
  it("requires each task to follow each declared predecessor unit even without independent groups", () => {
    const graph = { units: [
      { unit: "schema", taskIds: ["schema"], dependsOn: [] },
      { unit: "apply", taskIds: ["first", "second"], dependsOn: ["schema"] },
    ], independent: [], finalVerification: null };
    expect(deliveryGraphProblems(draft([task("schema"), task("first", ["schema"]), task("second")], graph)))
      .toEqual(["delivery-graph-task-order:second:schema"]);
    expect(deliveryGraphProblems(draft([task("schema"), task("first", ["schema"]), task("second", ["first"])], graph)))
      .toEqual([]);
  });

  it("waits for all tasks in a predecessor unit", () => {
    const graph = { units: [
      { unit: "schema", taskIds: ["core", "migration"], dependsOn: [] },
      { unit: "apply", taskIds: ["apply"], dependsOn: ["schema"] },
    ], independent: [], finalVerification: null };
    expect(deliveryGraphProblems(draft([task("core"), task("migration"), task("apply", ["core"])], graph)))
      .toContain("delivery-graph-task-order:apply:schema");
  });

  it.each([[], [{ unit: "schema", taskIds: [], dependsOn: [] }]])("rejects a predecessor without a task (%j)", (...units) => {
    const output = draft([task("apply")], { units: [
      ...units, { unit: "apply", taskIds: ["apply"], dependsOn: ["schema"] },
    ], independent: [], finalVerification: null });
    expect(deliveryGraphProblems(output)).toContain("delivery-graph-predecessor-without-tasks:apply:schema");
  });

  it("rejects transitive dependencies within the first independent group", () => {
    const output = draft([task("a"), task("b", ["a"]), task("c", ["b"])], {
      units: [
        { unit: "one", taskIds: ["a"], dependsOn: [] },
        { unit: "two", taskIds: ["b"], dependsOn: ["one"] },
        { unit: "three", taskIds: ["c"], dependsOn: ["two"] },
      ], independent: [["one", "three"]], finalVerification: null,
    });
    expect(deliveryGraphProblems(output)).toEqual(["delivery-graph-independent-order:three:one"]);
  });

  it("keeps numbered unit names as labels", () => {
    expect(deliveryGraphProblems(draft([task("a"), task("b")], { units: [
      { unit: "Stage 1", taskIds: ["a"], dependsOn: [] },
      { unit: "Stage 2", taskIds: ["b"], dependsOn: [] },
    ], independent: [], finalVerification: null }))).toEqual([]);
  });

  it("explains how to repair a missing unit edge and a wave mismatch (#515 #551)", () => {
    expect(explainSplitReason("delivery-graph-task-order:second:schema")).toContain("task `second`");
    expect(explainSplitReason("delivery-graph-edge:second:first")).toContain("dependsOn");
    expect(explainSplitReason("delivery-graph-layer:apply:Stage 2")).toContain("previous wave");
  });
});
