// #351 addendum (spec docs/superpowers/specs/2026-11-18-split-feedback-conflicts-design.md): the split reports, in an
// optional `requirementConflicts`, where its draft no longer meets what the requirement states explicitly -- because of
// the person's feedback or for any other reason. Code only carries and shows it (Rule 5); a draft without it is
// stored, hashed and shown exactly as before (D4).
import { describe, expect, it } from "vitest";
import { readDraft } from "../../src/control/requirementRecords.js";
import { REQUIREMENT_CONFLICT_BOUNDS, splitOutputSchema } from "../../src/control/requirementSchemas.js";
import {
  buildSplitPrompt, REQUIREMENT_CONFLICTS_RULE, SPLIT_INSTRUCTION_V6, SPLIT_INSTRUCTION_V7, SPLIT_JSON_SCHEMA_V7, SPLIT_JSON_SCHEMA_V9, SPLIT_PROMPT_HEAD_V7, SPLIT_PROMPT_HEAD_V9, withoutEmptySetup,
} from "../../src/control/requirementSplit.js";
import { readRequirementView } from "../../src/panel/controlViews.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";

const CONFLICT = { criterion: "AC4", feedback: "make sla-breach depend on sla-clock", why: "sla-breach and sla-clock no longer run concurrently in Layer 2" };
const TEMPLATE_LINE = "  \"requirementConflicts\": optional [ { \"criterion\": an acceptance criterion's id or a short quote, \"feedback\": optional, the feedback words that caused it, \"why\": what in this draft does not meet it } ],";

describe("the requirementConflicts key (schema, D5)", () => {
  it("parses 1 and 8 entries, and a split without the key parses to an object without it", () => {
    expect(splitOutputSchema.parse({ ...VALID_SPLIT, requirementConflicts: [CONFLICT] }).requirementConflicts).toEqual([CONFLICT]);
    const eight = Array.from({ length: REQUIREMENT_CONFLICT_BOUNDS.entries }, (_, i) => ({ criterion: `AC${i + 1}`, why: "x" }));
    expect(splitOutputSchema.parse({ ...VALID_SPLIT, requirementConflicts: eight }).requirementConflicts).toHaveLength(8);
    // mutation: add .default([]) to the key -> the key appears, red
    expect(Object.hasOwn(splitOutputSchema.parse(VALID_SPLIT), "requirementConflicts")).toBe(false);
  });

  it("refuses 9 entries, an empty why and a 1025-byte why", () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({ criterion: `AC${i + 1}`, why: "x" }));
    // mutation: drop .max(8) -> nine parse, red
    expect(splitOutputSchema.safeParse({ ...VALID_SPLIT, requirementConflicts: nine }).success).toBe(false);
    // mutation: drop the byte refine -> both parse, red
    expect(splitOutputSchema.safeParse({ ...VALID_SPLIT, requirementConflicts: [{ criterion: "AC1", why: "" }] }).success).toBe(false);
    expect(splitOutputSchema.safeParse({ ...VALID_SPLIT, requirementConflicts: [{ criterion: "AC1", why: "é".repeat(512) + "x" }] }).success).toBe(false);
    // The byte cap counts UTF-8 bytes, not characters: 1024 bytes of two-byte characters is the most it takes.
    expect(splitOutputSchema.safeParse({ ...VALID_SPLIT, requirementConflicts: [{ criterion: "AC1", why: "é".repeat(512) }] }).success).toBe(true);
  });
});

describe("the fold before the schema (D4: codex's strict projection writes null for an absent key)", () => {
  it("drops requirementConflicts [] and null, and a feedback that is null", () => {
    // mutation: remove the fold -> [] fails .min(1) and null fails the array, red
    for (const empty of [[], null]) {
      const parsed = splitOutputSchema.safeParse(withoutEmptySetup({ ...VALID_SPLIT, requirementConflicts: empty }));
      expect(parsed.success).toBe(true);
      expect(Object.hasOwn(parsed.success ? parsed.data : {}, "requirementConflicts")).toBe(false);
    }
    const parsed = splitOutputSchema.parse(withoutEmptySetup({ ...VALID_SPLIT, requirementConflicts: [{ criterion: "AC1", feedback: null, why: "y" }] }));
    expect(parsed.requirementConflicts).toEqual([{ criterion: "AC1", why: "y" }]);
  });
});

describe("split instruction version 7 (D3)", () => {
  it("the default prompt is v7 with the conflicts rule after the revision rule and the template line before notes", () => {
    const prompt = buildSplitPrompt({ document: "D.", overview: { canonicalJson: "{}", hash: "c".repeat(64) }, earlierDrafts: [] });
    // Ruling: human 「这次批准改写所有必要的判据」 (Orca session, 2026-11-23): tester #385 makes a new single-directory split call
    // send instruction version 9; this criterion now encodes: the default prompt is the newest version, which keeps v7's
    // conflicts rule and template line.
    expect(prompt.split("\n", 1)[0]).toBe(SPLIT_PROMPT_HEAD_V9);
    expect(SPLIT_PROMPT_HEAD_V7).toBe("Orca requirement split, instruction version 7.");
    // mutation: drop either replace -> red
    expect(prompt).toContain(`\n${REQUIREMENT_CONFLICTS_RULE}\n`);
    // Ruling: human 「这次批准改写所有必要的判据」 (Orca session, 2026-11-23): v9 inserts its deliveryGraph template line
    // before notes; the conflicts template line still sits just above it, so both are read in order.
    expect(prompt).toContain(`${TEMPLATE_LINE}\n  "deliveryGraph": optional {`);
    expect(prompt).toContain(`\n  "notes": anything the person should know about this split`);
    const lines = prompt.split("\n");
    expect(lines[lines.findIndex((line) => line.startsWith("- When `earlier-draft` is present, revise that draft")) + 1]).toBe(REQUIREMENT_CONFLICTS_RULE);
    expect(REQUIREMENT_CONFLICTS_RULE.startsWith("- Feedback does not change the agreed requirement.")).toBe(true);
    expect(REQUIREMENT_CONFLICTS_RULE.endsWith("When there is none, omit the key.")).toBe(true);
    expect((SPLIT_JSON_SCHEMA_V7 as { properties: Record<string, unknown> }).properties.requirementConflicts).toEqual({
      type: "array", items: { type: "object", additionalProperties: false, required: ["criterion", "why"], properties: { criterion: { type: "string" }, feedback: { type: "string" }, why: { type: "string" } } },
    });
    expect(SPLIT_INSTRUCTION_V7.length).toBeGreaterThan(SPLIT_INSTRUCTION_V6.length);
  });

  // V6's bytes are pinned with the other prompt pins (multiDirOverview.test.ts PINNED.splitInstructionV6).
  it("version 6 has neither the rule nor the template line", () => {
    const v6 = buildSplitPrompt({ document: "D.", overview: { canonicalJson: "{}", hash: "c".repeat(64) }, earlierDrafts: [], instructionVersion: 6 });
    expect(v6.split("\n", 1)[0]).toBe("Orca requirement split, instruction version 6.");
    expect(v6).not.toContain("requirementConflicts");
    expect(v6).not.toContain("Feedback does not change the agreed requirement");
    // mutation: put the sentence in the shared REVISION_RULE instead -> red here and on PINNED.splitInstructionV6
    expect(SPLIT_INSTRUCTION_V6).not.toContain(REQUIREMENT_CONFLICTS_RULE);
  });
});

describe("a v7 answer with a conflict, after feedback (harness)", () => {
  it("is stored in draft.output and hashed as the same answer without it; a draft without conflicts has no key, stored or viewed", async () => {
    const withConflict = { ...VALID_SPLIT, requirementConflicts: [CONFLICT] };
    const x = await requirementHarness({ answers: [{ purpose: "split", output: VALID_SPLIT }, { purpose: "split", output: withConflict }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
      // mutation: default the key to [] -> both red (D4: a draft without conflicts stores and shows no key)
      expect(Object.hasOwn(readDraft(x.store, "r", 1).output!, "requirementConflicts")).toBe(false);
      expect(JSON.stringify(readRequirementView(x.store, "e", "r").drafts.find((draft) => draft.draftNo === 1)!.output)).not.toContain("requirementConflicts");
      expect(x.service.requirementDraftFeedback(x.command("requirement-draft-feedback", { draftNo: 1, feedback: CONFLICT.feedback }))).toMatchObject({ result: { nextDraftNo: 2 } });
      await x.until(() => readDraft(x.store, "r", 2).state === "awaiting-review");
      const second = x.fake.calls.accept[1]!;
      // mutation: prepare still sends SPLIT_JSON_SCHEMA_V6 -> red
      expect(second.work.kind === "single-call" && second.work.responseSchema).toEqual(SPLIT_JSON_SCHEMA_V9);
      // Ruling: human 「这次批准改写所有必要的判据」 (Orca session, 2026-11-23): tester #385 makes a new single-directory split
      // call send instruction version 9 (V7's conflicts schema plus the optional deliveryGraph).
      expect(second.work.kind === "single-call" && second.work.prompt.startsWith(SPLIT_PROMPT_HEAD_V9)).toBe(true);
      const draft = readDraft(x.store, "r", 2);
      expect((draft.output as { requirementConflicts?: unknown }).requirementConflicts).toEqual([CONFLICT]);
      // mutation: hash the output (or anything carrying the key) instead of the plan -> red
      expect(draft.draftHash).toBe(readDraft(x.store, "r", 1).draftHash);
    } finally { await x.dispose(); }
  });
});

// Spec D6 (controller ruling): code cannot tell whether a person's edit resolved a conflict, so the edited draft keeps it.
describe("a draft edit carries the conflicts over", () => {
  it("apply-parallel on a draft with a conflict makes a next draft whose output still has them", async () => {
    const base = VALID_SPLIT.tasks[0]!;
    const task = (taskId: string, targetPaths: string[], dependsOn: string[]) => ({ ...base, taskId, title: taskId, targetPaths, checks: ["true"], dependsOn, traces: ["AC1", "AC2"] });
    // Tester #384 (2026-11-20): a candidate is a declared edge a broad target-path claim also orders; a disjoint pair is
    // the author's semantic dependency and is never listed. The fixture claims src/** so the pair stays a candidate.
    const chain = { tasks: [task("core", ["src/**"], []), task("later", ["src/later.ts"], ["core"])], notes: "", requirementConflicts: [CONFLICT] };
    const x = await requirementHarness({ answers: [{ purpose: "split", output: chain }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
      expect(readRequirementView(x.store, "e", "r").drafts[0]).toMatchObject({ parallelCandidates: [{ before: "core", after: "later" }] });
      expect(await x.service.editRequirementDraft(x.command("requirement-draft-edit", { draftNo: 1, draftHash: readDraft(x.store, "r", 1).draftHash, edit: { kind: "apply-parallel-candidates", pairs: [{ before: "core", after: "later" }] } })))
        .toMatchObject({ result: { kind: "requirement-draft-edited", nextDraftNo: 2 } });
      const next = readDraft(x.store, "r", 2);
      expect(next.state).toBe("awaiting-review");
      // mutation: drop the key in the edit path -> red
      expect((next.output as { requirementConflicts?: unknown }).requirementConflicts).toEqual([CONFLICT]);
    } finally { await x.dispose(); }
  });
});
