import { describe, expect, it } from "vitest";
import { readArchivedPlan } from "../../src/control/queries.js";
import { readDraft } from "../../src/control/requirementRecords.js";
import { multiSplitOutputSchema, splitOutputSchema } from "../../src/control/requirementSchemas.js";
import { SPLIT_JSON_SCHEMA, SPLIT_JSON_SCHEMA_MULTI } from "../../src/control/requirementSplit.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";

// Task setup spec §4.2: a split task's optional `setup` is the commands that make its checks runnable in a fresh clone.
// It travels from the model's answer through the stored draft plan and accept into the frozen contract's
// `context.setupCommands`; absent, no key appears anywhere. The multi-directory split has no `setup` (spec §5.4).
const WITH_SETUP = { ...VALID_SPLIT, tasks: [{ ...VALID_SPLIT.tasks[0]!, setup: ["npm ci", "make gen"] }, VALID_SPLIT.tasks[1]!] };

describe("a split task's setup (task setup spec §4.2)", () => {
  // mutation C2-M4: drop `setup` in loopOf -> the contract has no setupCommands -> red
  it("reaches the accepted plan's contract as context.setupCommands, and stays absent where the task gave none", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: WITH_SETUP }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state !== "drafting");
      expect(readDraft(x.store, "r", 1)).toMatchObject({ state: "awaiting-review", reasons: [] });
      const answer = await x.service.acceptRequirementDraft(x.command("requirement-draft-accept", { draftNo: 1, draftHash: readDraft(x.store, "r", 1).draftHash! }));
      expect(answer).toMatchObject({ result: { kind: "requirement-draft-accepted" } });
      const archived = readArchivedPlan(x.store, "r").plan.tasks;
      const task = (taskId: string) => archived.find((entry) => entry.taskId === taskId)!;
      const context = (taskId: string) => (JSON.parse(task(taskId).originalContractCanonicalJson) as { context: Record<string, unknown> }).context;
      expect(context("exporter").setupCommands).toEqual(["npm ci", "make gen"]);
      // The recipe the plan keeps (loop plans spec §3.3) carries it in its inputs, so a re-expansion gives it again.
      expect((task("exporter").loop as { inputs: { setup?: string[] } }).inputs.setup).toEqual(["npm ci", "make gen"]);
      expect(context("images")).not.toHaveProperty("setupCommands");
      expect((task("images").loop as { inputs: object }).inputs).not.toHaveProperty("setup");
    } finally { await x.dispose(); }
  });

  it("is bounded in the split's own schema and offered to the model as an optional key", () => {
    expect(splitOutputSchema.safeParse(WITH_SETUP).success).toBe(true);
    for (const setup of [[], ["a\nb"], ["x".repeat(4097)], Array.from({ length: 9 }, (_, index) => `c${index}`)]) {
      expect(splitOutputSchema.safeParse({ ...VALID_SPLIT, tasks: [{ ...VALID_SPLIT.tasks[0]!, setup }] }).success, JSON.stringify(setup).slice(0, 30)).toBe(false);
    }
    const items = (SPLIT_JSON_SCHEMA as { properties: { tasks: { items: { properties: Record<string, unknown>; required: string[] } } } }).properties.tasks.items;
    expect(items.properties.setup).toEqual({ type: "array", items: { type: "string" } });
    expect(items.required).not.toContain("setup");
  });

  // Review Focus 3: a multi-directory task with setup cannot reach a contract -- its schema refuses the key.
  it("is refused on a multi-directory split's task", () => {
    const multi = { tasks: [{ taskId: "t", title: "t", labels: [], goal: "g", successCondition: "s", writes: [{ dir: "a", targetPaths: ["x"], checks: ["true"] }], dependsOn: [], traces: ["AC1"] }], notes: "" };
    expect(multiSplitOutputSchema.safeParse(multi).success).toBe(true);
    expect(multiSplitOutputSchema.safeParse({ ...multi, tasks: [{ ...multi.tasks[0]!, setup: ["npm ci"] }] }).success).toBe(false);
    const items = (SPLIT_JSON_SCHEMA_MULTI as { properties: { tasks: { items: { properties: Record<string, unknown> } } } }).properties.tasks.items;
    expect(items.properties).not.toHaveProperty("setup");
  });
});
