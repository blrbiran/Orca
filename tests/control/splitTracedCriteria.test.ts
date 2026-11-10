/**
 * Tester #204 (plan 2026-11-10 tester follow-up B, T4): a task's contract was built from the split's free-text
 * successCondition only, so an acceptance criterion's exact values (`todo/doing/done`) never reached the agent. Expansion
 * -- code, not the instruction -- now appends the full text of every acceptance criterion a task traces to that task's
 * success condition, so the contract the agent runs under carries them verbatim. New splits only: contracts already
 * frozen at accept are stored bytes and are not re-expanded.
 */
import { describe, expect, it } from "vitest";
import { expandLoopTask } from "../../src/control/loopPlans.js";
import { readArchivedPlan } from "../../src/control/queries.js";
import { sha256Canonical } from "../../src/control/canonicalJson.js";
import { readDraft, writeDraft } from "../../src/control/requirementRecords.js";
import type { MultiSplitOutput, SplitOutput } from "../../src/control/requirementSchemas.js";
import { expandMultiSplitDraft, expandSplitDraft } from "../../src/control/requirementSplit.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { multiHarness } from "./fixtures/multiRequirement.js";
import { ROUND_TWO } from "./fixtures/requirementOutputs.js";

const ENUM_AC = "A task's status is one of todo/doing/done and its priority one of low/medium/high; a new task is todo/medium.";
const criteria = [{ id: "AC1", text: "Tasks persist across restarts." }, { id: "AC2", text: ENUM_AC }];
const output: SplitOutput = { notes: "", tasks: [
  { taskId: "T1", title: "Store", labels: ["feature"], goal: "Persist tasks.", successCondition: "Tasks are stored.", targetPaths: ["src/store.js"], checks: ["true"], dependsOn: [], traces: ["AC1"] },
  { taskId: "T2", title: "Model", labels: ["feature"], goal: "Add the task model.", successCondition: "The model has enum constants.", targetPaths: ["src/model.js"], checks: ["true"], dependsOn: ["T1"], traces: ["AC2", "AC1"] },
  { taskId: "T3", title: "Docs", labels: ["docs"], goal: "Document the decision.", successCondition: "README names it.", targetPaths: ["README.md"], checks: ["true"], dependsOn: [], traces: ["R1.ADR1"] },
] };
const ctx = { targetRepo: "/repo", ccloopBin: "/bin/false", runsDir: "/runs", groupId: "r", statement: "Tasks.", acceptanceCriteria: criteria };
const successOf = (contract: unknown): string => (contract as { objective: { successCondition: string } }).objective.successCondition;
/** A multi split over the multi harness's two members, tracing ROUND_TWO's AC1 and AC2. */
const MULTI = { notes: "", tasks: [
  { taskId: "notes", title: "Notes", labels: [], goal: "Document.", successCondition: "README mentions notes.",
    writes: [{ dir: "posts", targetPaths: ["README.md"], checks: ["true"] }], dependsOn: [], traces: ["AC1"] },
  { taskId: "both", title: "Both", labels: [], goal: "Export.", successCondition: "Both files are written.",
    writes: [{ dir: "posts", targetPaths: ["notes/p1.md"], checks: ["true"] }, { dir: "alpha", targetPaths: ["src/a.ts"], checks: ["true"] }], dependsOn: ["notes"], traces: ["AC2"] },
] };

describe("a traced acceptance criterion reaches the task's contract (#204)", () => {
  it("appends each traced criterion's full text, in the requirement's order, after the split's own words", () => {
    const plan = expandSplitDraft(output, ctx);
    const loop = (taskId: string) => plan.tasks.find((task) => task.taskId === taskId)!.loop;
    // mutation: drop the traced-criteria suffix in expansion -> "The model has enum constants." alone -> red
    expect(loop("T2").successCondition).toBe(`The model has enum constants.\n\nAcceptance criteria this task traces:\n- AC1: Tasks persist across restarts.\n- AC2: ${ENUM_AC}`);
    expect(loop("T1").successCondition).toBe("Tasks are stored.\n\nAcceptance criteria this task traces:\n- AC1: Tasks persist across restarts.");
    // A task tracing only a decision keeps its words unchanged.
    expect(loop("T3").successCondition).toBe("README names it.");
    // The contract the import derives from the plan's loop carries the exact values.
    const expanded = expandLoopTask("T2", "/repo", loop("T2"), ["feature"]);
    if (!expanded.ok) throw new Error(expanded.reason);
    expect(successOf(expanded.contract)).toContain("todo/doing/done");
    expect(successOf(expanded.contract)).toContain(ENUM_AC);
  });

  it("does the same for a multi split's plan and contracts", () => {
    const multi: MultiSplitOutput = { notes: "", tasks: [{ taskId: "T2", title: "Model", labels: [], goal: "G", successCondition: "S",
      writes: [{ dir: "a", targetPaths: ["src/model.js"], checks: ["true"] }, { dir: "b", targetPaths: ["x.md"], checks: ["true"] }], dependsOn: [], traces: ["AC2"] }] };
    const expanded = expandMultiSplitDraft(multi, { targetRepo: "/a", ccloopBin: "/bin/false", runsDir: "/runs", groupId: "r", statement: "G",
      successConditions: criteria.map((c) => c.text), acceptanceCriteria: criteria, dirs: [{ key: "a", path: "/a" }, { key: "b", path: "/b" }] });
    expect(expanded.reasons).toEqual([]);
    expect(expanded.plan.tasks[0]!.loop.successCondition).toBe(`S\n\nAcceptance criteria this task traces:\n- AC2: ${ENUM_AC}`);
    expect(successOf(expanded.contracts.get("T2"))).toContain(ENUM_AC);
  });

  it("freezes the text into the contract an accepted split archives", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: { ...output, tasks: output.tasks.slice(0, 2).map((task) => ({ ...task, targetPaths: ["src/a.ts"] })) } }],
      startAt: "split", consensus: { statement: "Tasks.", acceptanceCriteria: criteria } });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
      const done = await x.service.acceptRequirementDraft(x.command("requirement-draft-accept", { draftNo: 1, draftHash: readDraft(x.store, "r", 1).draftHash! }));
      if ("error" in done) throw new Error(JSON.stringify(done));
      const archived = readArchivedPlan(x.store, "r").plan.tasks.find((task) => task.taskId === "T2")!;
      expect(successOf(JSON.parse(archived.originalContractCanonicalJson))).toContain(`- AC2: ${ENUM_AC}`);
    } finally { await x.dispose(); }
  });

  it("re-expands a multi split's contracts at accept with the same text", async () => {
    const x = await multiHarness({ answers: [{ purpose: "split", output: MULTI }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
      const expected = `Both files are written.\n\nAcceptance criteria this task traces:\n- AC2: ${ROUND_TWO.acceptanceCriteria[1]!.text}`;
      // The plan the person reviews (the split-time expansion, evaluateMultiSplit).
      // mutation: leave acceptanceCriteria out of evaluateMultiSplit's expansion -> red
      expect((readDraft(x.store, "r", 1).plan as { tasks: Array<{ taskId: string; loop: { successCondition: string } }> }).tasks.find((task) => task.taskId === "both")!.loop.successCondition).toBe(expected);
      const done = await x.service.acceptRequirementDraft(x.command("requirement-draft-accept", { draftNo: 1, draftHash: readDraft(x.store, "r", 1).draftHash! }));
      if ("error" in done) throw new Error(JSON.stringify(done));
      const archived = readArchivedPlan(x.store, "r").plan.tasks.find((task) => task.taskId === "both")!;
      // mutation: leave acceptanceCriteria out of the accept re-expansion -> the frozen contract lacks it -> red
      expect(successOf(JSON.parse(archived.originalContractCanonicalJson))).toBe(expected);
    } finally { await x.dispose(); }
  });

  it("keeps a multi draft expanded before #204 as reviewed: accepted after it, its contracts get no criteria text", async () => {
    const x = await multiHarness({ answers: [{ purpose: "split", output: MULTI }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
      // The draft a pre-#204 expansion stored: each loop's successCondition is the split's own words, hashed as reviewed.
      const draft = readDraft(x.store, "r", 1);
      const old = draft.plan as { tasks: Array<{ taskId: string; loop: { successCondition: string } }> };
      const words = new Map(MULTI.tasks.map((task) => [task.taskId, task.successCondition]));
      const plan = { ...old, tasks: old.tasks.map((task) => ({ ...task, loop: { ...task.loop, successCondition: words.get(task.taskId)! } })) };
      writeDraft(x.store, "r", { ...draft, plan, draftHash: sha256Canonical(plan) });
      const done = await x.service.acceptRequirementDraft(x.command("requirement-draft-accept", { draftNo: 1, draftHash: sha256Canonical(plan) }));
      if ("error" in done) throw new Error(JSON.stringify(done));
      const archived = readArchivedPlan(x.store, "r").plan.tasks;
      // mutation: pass the criteria to the accept re-expansion unconditionally -> the contract gains a suffix its plan lacks -> red
      for (const task of archived) {
        expect(successOf(JSON.parse(task.originalContractCanonicalJson)), task.taskId).toBe(words.get(task.taskId));
      }
    } finally { await x.dispose(); }
  });
});
