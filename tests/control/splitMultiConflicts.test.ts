import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Canonical } from "../../src/control/canonicalJson.js";
import { readDraft } from "../../src/control/requirementRecords.js";
import { multiSplitOutputSchema, type DraftBody, type MultiSplitOutput } from "../../src/control/requirementSchemas.js";
import {
  buildSplitPrompt, FEEDBACK_STANDS_RULE, REQUIREMENT_CONFLICTS_RULE, RUNTIME_DATA_RULE, SPLIT_INSTRUCTION_MULTI_V5, SPLIT_INSTRUCTION_MULTI_V6,
  SPLIT_JSON_SCHEMA_MULTI, SPLIT_JSON_SCHEMA_MULTI_V6, SPLIT_JSON_SCHEMA_V7, SPLIT_PROMPT_HEAD_MULTI_V6,
} from "../../src/control/requirementSplit.js";
import { runtimeDataPaths } from "../../src/control/splitImpliedPaths.js";
import { readRequirementView } from "../../src/panel/controlViews.js";
import { multiHarness } from "./fixtures/multiRequirement.js";

/**
 * Multi-directory split instruction version 6 (Orca session 3ba26002, 2026-11-19; human 「同意」 to multi-directory
 * requirementConflicts after the single-repository v7 dogfood, session 543e800e): the multi path reaches parity with
 * single-repository v8 -- requirementConflicts in the answer and the prompt, the person's standing feedback carried across
 * Orca's automatic re-drafts (with the revision boundary), and the runtime-data rule. Multi v5's bytes stay resolvable.
 */
const sha = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
/** SPLIT_INSTRUCTION_MULTI_V5 and SPLIT_JSON_SCHEMA_MULTI at main 2513a80d, before multi v6 (npx tsx, .wt-multisplit.sha.log). */
const PINNED_MULTI = {
  instructionV5: "399c094ae3b132774615ccfbf03116d8364b49d24f24e6e5e23e20402f9baa96",
  schemaV5: "13cedf7b59744947ed05d15991805f0ef4b4c01affcc45d5ad4efa24c93dafd5",
} as const;
const OVERVIEW = { canonicalJson: "{}", hash: "b".repeat(64) };
const FEEDBACK = "Merge the two tasks into one.";
const CONFLICTS = [{ criterion: "AC2", feedback: FEEDBACK, why: "One task cannot keep posts:notes/p1.md and alpha:src/a.ts separate." }];
const MULTI_SPLIT: MultiSplitOutput = {
  notes: "Two tasks.",
  tasks: [
    { taskId: "notes", title: "Write the notes", labels: [], goal: "Document the notes.", successCondition: "README mentions notes.",
      writes: [{ dir: "posts", targetPaths: ["README.md"], checks: ["true"] }], dependsOn: [], traces: ["AC1"] },
    { taskId: "both", title: "Export from both", labels: [], goal: "Export a note.", successCondition: "Both files are written.",
      writes: [{ dir: "posts", targetPaths: ["notes/p1.md"], checks: ["true"] }, { dir: "alpha", targetPaths: ["src/a.ts"], checks: ["true"] }],
      dependsOn: ["notes"], traces: ["AC2"] },
  ],
};
/** Handed back by code: AC2 is traced by no task. */
const UNTRACED: MultiSplitOutput = { ...MULTI_SPLIT, tasks: [{ ...MULTI_SPLIT.tasks[0]!, traces: ["AC1"] }] };
const block = (prompt: string): Record<string, unknown> => {
  const match = /<<<ORCA-DATA earlier-draft [0-9a-f]{16}\n([\s\S]*?)\nORCA-DATA earlier-draft/.exec(prompt);
  if (match === null) throw new Error("no earlier-draft block");
  return JSON.parse(match[1]!) as Record<string, unknown>;
};
const draft = (draftNo: number, state: DraftBody["state"], feedback: string | null, output: MultiSplitOutput = MULTI_SPLIT): DraftBody => ({
  draftNo, state, autoRetry: 0, waiting: null, feedback, output, plan: null, draftHash: null,
  reasons: state === "invalid" ? ["untraced:AC2"] : [], layers: null, implicitEdges: null, impliedPathsAdded: null, reasonCode: null, calls: [],
}) as DraftBody;

describe("multi-directory split instruction version 6", () => {
  it("keeps version 5's instruction and schema bytes, and builds them when asked for version 5", () => {
    // mutation: put a v6 sentence in a constant multi v5 shares (REVISION_RULE, EARLIER_DRAFTS) -> red
    expect(sha(SPLIT_INSTRUCTION_MULTI_V5)).toBe(PINNED_MULTI.instructionV5);
    expect(sha256Canonical(SPLIT_JSON_SCHEMA_MULTI)).toBe(PINNED_MULTI.schemaV5);
    const v5 = buildSplitPrompt({ document: "D.", overview: OVERVIEW, earlierDrafts: [draft(1, "rejected", FEEDBACK), draft(2, "invalid", null, { ...UNTRACED, requirementConflicts: CONFLICTS })], multi: true, instructionVersion: 5 });
    expect(v5.startsWith(`${SPLIT_INSTRUCTION_MULTI_V5}\n\n`)).toBe(true);
    // Version 5 never carried the standing feedback; its bytes for an in-flight group stay as they were.
    expect(block(v5)).toEqual({ draftNo: 2, tasks: UNTRACED.tasks, feedback: null, handedBackFor: [expect.stringContaining("untraced:AC2")] });
  });

  it("states the conflicts, standing-feedback and runtime-data rules and the template line, once each", () => {
    expect(SPLIT_PROMPT_HEAD_MULTI_V6).toBe("Orca requirement split (several directories), instruction version 6.");
    expect(SPLIT_INSTRUCTION_MULTI_V6.split("\n", 1)[0]).toBe(SPLIT_PROMPT_HEAD_MULTI_V6);
    // mutation: drop any of the replaces building SPLIT_INSTRUCTION_MULTI_V6 -> red
    expect(SPLIT_INSTRUCTION_MULTI_V6.split(REQUIREMENT_CONFLICTS_RULE).length).toBe(2);
    expect(SPLIT_INSTRUCTION_MULTI_V6).toContain(`${REQUIREMENT_CONFLICTS_RULE} A path in \`why\` names its directory's key first, as \`<key>:<path>\`.\n${FEEDBACK_STANDS_RULE}\n`);
    expect(SPLIT_INSTRUCTION_MULTI_V6).toContain("`feedback` is that feedback, still in force, `feedbackOnDraft` names the draft it was given on");
    expect(SPLIT_INSTRUCTION_MULTI_V6).toContain(RUNTIME_DATA_RULE.replace("in `targetPaths`", "in `writes[].targetPaths`"));
    expect(SPLIT_INSTRUCTION_MULTI_V6).not.toContain(RUNTIME_DATA_RULE);
    expect(SPLIT_INSTRUCTION_MULTI_V6).toContain("  \"requirementConflicts\": optional [ { \"criterion\": an acceptance criterion's id or a short quote, \"feedback\": optional, the feedback words that caused it, \"why\": what in this draft does not meet it } ],\n  \"notes\": anything the person should know about this split");
    // Everything else is version 5's: the multi rules and the writes template.
    expect(SPLIT_INSTRUCTION_MULTI_V6).toContain("\"writes\": [ { \"dir\": a directory key, \"targetPaths\": [ ], \"checks\": [ ] } ]");
    for (const text of [REQUIREMENT_CONFLICTS_RULE, FEEDBACK_STANDS_RULE, "feedbackOnDraft", "requirementConflicts", "writes[].targetPaths`, and do not write checks"]) expect(SPLIT_INSTRUCTION_MULTI_V5).not.toContain(text);
  });

  it("is what a multi prompt is built with by default; a version the multi instruction never had is refused", () => {
    const prompt = buildSplitPrompt({ document: "D.", overview: OVERVIEW, earlierDrafts: [], multi: true });
    // mutation: buildSplitPrompt keeps SPLIT_INSTRUCTION_MULTI_V5 for multi -> red
    expect(prompt.startsWith(`${SPLIT_INSTRUCTION_MULTI_V6}\n\n`)).toBe(true);
    expect(prompt).toContain("<<<ORCA-DATA project-overview ");
    // mutation: map an unknown multi version to version 6 silently -> red
    expect(() => buildSplitPrompt({ document: "D.", overview: OVERVIEW, earlierDrafts: [], multi: true, instructionVersion: 8 })).toThrow(/split-instruction-unknown/);
  });

  it("answers in the multi schema plus requirementConflicts, with the single-repository bounds", () => {
    const tasks = (SPLIT_JSON_SCHEMA_MULTI_V6 as { properties: Record<string, unknown> }).properties;
    // mutation: drop requirementConflicts from SPLIT_JSON_SCHEMA_MULTI_V6 -> red
    expect(tasks.requirementConflicts).toEqual((SPLIT_JSON_SCHEMA_V7 as { properties: Record<string, unknown> }).properties.requirementConflicts);
    expect({ ...tasks, requirementConflicts: undefined }).toEqual({ ...(SPLIT_JSON_SCHEMA_MULTI as { properties: Record<string, unknown> }).properties, requirementConflicts: undefined });
    const conflict = { criterion: "AC1", why: "w" };
    // mutation: leave multiSplitOutputSchema strict without the key -> red
    expect(multiSplitOutputSchema.parse({ ...MULTI_SPLIT, requirementConflicts: [conflict] }).requirementConflicts).toEqual([conflict]);
    expect(multiSplitOutputSchema.safeParse({ ...MULTI_SPLIT, requirementConflicts: Array(8).fill(conflict) }).success).toBe(true);
    // mutation: drop .max(8) on the multi key -> red
    expect(multiSplitOutputSchema.safeParse({ ...MULTI_SPLIT, requirementConflicts: Array(9).fill(conflict) }).success).toBe(false);
    expect(multiSplitOutputSchema.safeParse({ ...MULTI_SPLIT, requirementConflicts: [] }).success).toBe(false);
    // D4: never defaulted, so a multi draft without conflicts parses (and hashes) as before.
    expect(multiSplitOutputSchema.parse(MULTI_SPLIT)).not.toHaveProperty("requirementConflicts");
  });

  it("carries the standing feedback, the draft it was given on and the earlier conflicts; not across a revision", () => {
    const drafts = [draft(1, "rejected", FEEDBACK), draft(2, "invalid", null, { ...UNTRACED, requirementConflicts: CONFLICTS })];
    // mutation: keep the carry single-repository only (`multi !== true` in buildSplitPrompt) -> red
    expect(block(buildSplitPrompt({ document: "D.", overview: OVERVIEW, earlierDrafts: drafts, multi: true })))
      .toEqual({ draftNo: 2, tasks: UNTRACED.tasks, feedback: FEEDBACK, feedbackOnDraft: 1, requirementConflicts: CONFLICTS, handedBackFor: [expect.stringContaining("untraced:AC2")] });
    // Review M1's boundary: feedback given before a revision withdrew the consensus is not carried.
    expect(block(buildSplitPrompt({ document: "D.", overview: OVERVIEW, earlierDrafts: drafts, multi: true, revisionBoundary: 1 })))
      .toEqual({ draftNo: 2, tasks: UNTRACED.tasks, feedback: null, handedBackFor: [expect.stringContaining("untraced:AC2")] });
  });

  it("hints a multi runtime data path with its directory key; a single-repository hint is unchanged", () => {
    const output: MultiSplitOutput = { notes: "", tasks: [{ ...MULTI_SPLIT.tasks[1]!, writes: [{ dir: "posts", targetPaths: ["notes/p1.md"], checks: ["true"] }, { dir: "alpha", targetPaths: ["src/a.ts", ".app/items.json"], checks: ["true"] }] }] };
    // mutation: drop the dir key from a multi entry -> red
    expect(runtimeDataPaths(output, "Items are kept in .app/items.json.")).toEqual([{ taskId: "both", dir: "alpha", path: ".app/items.json" }]);
  });
});

describe("a multi group's split, end to end (multi v6)", () => {
  it("sends v6 and its schema, stores the conflicts, carries the feedback into Orca's re-draft and says so in the view", async () => {
    const answered = { ...UNTRACED, requirementConflicts: CONFLICTS };
    const x = await multiHarness({ answers: [{ purpose: "split", output: MULTI_SPLIT }, { purpose: "split", output: answered }, { purpose: "split", output: { ...MULTI_SPLIT, requirementConflicts: [] } }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
      const envelope = x.fake.calls.accept[0]! as { work: { prompt: string; responseSchema: unknown } };
      // mutation: SPLIT_HANDLER.prepare still sends SPLIT_JSON_SCHEMA_MULTI -> red
      expect(envelope.work.responseSchema).toEqual(SPLIT_JSON_SCHEMA_MULTI_V6);
      expect(envelope.work.prompt.startsWith(`${SPLIT_PROMPT_HEAD_MULTI_V6}\n`)).toBe(true);
      expect(await x.service.requirementDraftFeedback(x.command("requirement-draft-feedback", { draftNo: 1, feedback: FEEDBACK }))).toMatchObject({ result: { kind: "requirement-draft-rejected" } });
      const state = (n: number) => { try { return readDraft(x.store, "r", n).state; } catch { return "none"; } };
      await x.until(() => state(3) !== "none" && state(3) !== "drafting");
      expect([1, 2, 3].map(state)).toEqual(["rejected", "invalid", "awaiting-review"]);
      expect(readDraft(x.store, "r", 2).output).toMatchObject({ requirementConflicts: CONFLICTS });
      // mutation: evaluateMultiSplit parses without the conflicts fold -> `[]` fails .min(1), draft 3 invalid -> red
      expect(readDraft(x.store, "r", 3).output).not.toHaveProperty("requirementConflicts");
      const prompts = x.fake.calls.accept.map((call) => (call.work as { prompt: string }).prompt);
      expect(block(prompts[2]!)).toMatchObject({ draftNo: 2, feedback: FEEDBACK, feedbackOnDraft: 1, requirementConflicts: CONFLICTS });
      const view = readRequirementView(x.store, "e", "r");
      expect(view.drafts[2]).toMatchObject({ feedbackAfterRedraft: { feedbackDraftNo: 1, feedback: FEEDBACK, redrafts: [2], conflictsBefore: ["AC2"] } });
      const { findCommand } = await import("../../src/commands/registry.js");
      const found = findCommand(["requirement", "show"]);
      if (!("def" in found)) throw new Error("no requirement show row");
      expect(found.def.format({ ...view, drafts: [{ ...view.drafts[1]!, layers: [] }] })).toContain(`draft 2 requirement-conflict: AC2 -- ${CONFLICTS[0]!.why} (feedback: "${FEEDBACK}")`);
    } finally { await x.dispose(); }
  });

  it("requirement show names a multi runtime data path by directory and drops it by path", async () => {
    const { findCommand } = await import("../../src/commands/registry.js");
    const found = findCommand(["requirement", "show"]);
    if (!("def" in found)) throw new Error("no requirement show row");
    const body = { requirement: { requirementId: "q", consensus: null }, rounds: [], drafts: [{ draftNo: 1, state: "awaiting-review", layers: [["both"]], output: { tasks: [], notes: "" },
      runtimeDataPaths: [{ taskId: "both", dir: "alpha", path: ".app/items.json" }] }] };
    // mutation: print the multi entry without its directory key -> red
    expect(found.def.format(body)).toContain("draft 1 both lists alpha:.app/items.json, a data file the requirement names, as a target path; if that is where the program keeps its data (not seed data the requirement asks to commit), drop it: orca requirement drop-path <group> --task both --path .app/items.json");
  });
});
