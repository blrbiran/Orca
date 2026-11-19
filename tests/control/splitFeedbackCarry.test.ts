import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readDraft } from "../../src/control/requirementRecords.js";
import type { DraftBody } from "../../src/control/requirementSchemas.js";
import { buildSplitPrompt, feedbackAfterRedraft, SPLIT_INSTRUCTION_V7, SPLIT_INSTRUCTION_V8 } from "../../src/control/requirementSplit.js";
import { readRequirementView } from "../../src/panel/controlViews.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { INVALID_SPLIT, VALID_SPLIT } from "./fixtures/requirementOutputs.js";

/**
 * Dogfood finding (3) (session 3ba26002), `dogfood-20261119-count-c`: the person's feedback on draft 2 ("Drop the test
 * file test/count.test.js entirely") was answered by draft 3, which reported two requirementConflicts (AC2, R1.ADR1) but
 * was handed back by code (check-write-scope, untraced:AC2). Orca re-drafted automatically: draft 4's `earlier-draft`
 * block was draft 3's tasks and reasons only -- `feedback: null`, no conflicts -- so draft 4 put the test back, reported
 * nothing, and the person was never told their feedback was not taken.
 *
 * Now (instruction version 8) the automatic re-draft's block carries the standing feedback, the draft it was given on and
 * the earlier draft's requirementConflicts; and a valid draft that came from such a re-draft and reports no conflict
 * about the feedback carries `feedbackAfterRedraft` in the requirement view (requirement show and the Web say it).
 */
const sha = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
const FEEDBACK = "Merge the two tasks into one.";
const CONFLICTS = [{ criterion: "AC2", feedback: FEEDBACK, why: "One task cannot keep images separate." }];
const block = (prompt: string): Record<string, unknown> => {
  const match = /<<<ORCA-DATA earlier-draft [0-9a-f]{16}\n([\s\S]*?)\nORCA-DATA earlier-draft/.exec(prompt);
  if (match === null) throw new Error("no earlier-draft block");
  return JSON.parse(match[1]!) as Record<string, unknown>;
};
const draft = (draftNo: number, state: DraftBody["state"], feedback: string | null, extra: Partial<DraftBody> = {}): DraftBody => ({
  draftNo, state, autoRetry: 0, waiting: null, feedback, output: { ...VALID_SPLIT }, plan: null, draftHash: null,
  reasons: state === "invalid" ? ["untraced:AC2"] : [], layers: null, implicitEdges: null, impliedPathsAdded: null, reasonCode: null, calls: [], ...extra,
}) as DraftBody;

describe("an automatic re-draft keeps the person's feedback (dogfood finding 3)", () => {
  it("carries the feedback, the draft it was given on and the earlier draft's conflicts into the next prompt, end to end", async () => {
    const answered = { ...INVALID_SPLIT, requirementConflicts: CONFLICTS };
    const x = await requirementHarness({ answers: [{ purpose: "split", output: VALID_SPLIT }, { purpose: "split", output: answered }, { purpose: "split", output: VALID_SPLIT }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
      expect(await x.service.requirementDraftFeedback(x.command("requirement-draft-feedback", { draftNo: 1, feedback: FEEDBACK }))).toMatchObject({ result: { kind: "requirement-draft-rejected" } });
      const state = (n: number) => { try { return readDraft(x.store, "r", n).state; } catch { return "none"; } };
      await x.until(() => state(3) === "awaiting-review");
      expect([1, 2, 3].map(state)).toEqual(["rejected", "invalid", "awaiting-review"]);
      const prompts = x.fake.calls.accept.map((envelope) => (envelope.work as { prompt: string }).prompt);
      expect(prompts).toHaveLength(3);
      // Draft 2 answered the feedback directly: its block is draft 1 with the feedback, as before.
      expect(block(prompts[1]!)).toMatchObject({ draftNo: 1, feedback: FEEDBACK });
      // mutation: drop the standing-feedback lookup in buildSplitPrompt -> feedback null, no feedbackOnDraft -> red
      // mutation: drop requirementConflicts from the block -> red
      expect(block(prompts[2]!)).toEqual({ draftNo: 2, tasks: INVALID_SPLIT.tasks, feedback: FEEDBACK, feedbackOnDraft: 1, requirementConflicts: CONFLICTS,
        handedBackFor: readDraft(x.store, "r", 2).reasons.map((reason) => expect.stringContaining(reason)) });
      expect(prompts[2]!.startsWith("Orca requirement split, instruction version 8.")).toBe(true);
      // Draft 3 reports no conflict about the feedback, so the view says so.
      const view = readRequirementView(x.store, "e", "r");
      // mutation: drop feedbackAfterRedraft from the view -> red
      expect(view.drafts[2]).toMatchObject({ feedbackAfterRedraft: { feedbackDraftNo: 1, feedback: FEEDBACK, redrafts: [2], conflictsBefore: ["AC2"] } });
      expect(view.drafts[1]).not.toHaveProperty("feedbackAfterRedraft");
      const { findCommand } = await import("../../src/commands/registry.js");
      const found = findCommand(["requirement", "show"]);
      if (!("def" in found)) throw new Error("no requirement show row");
      // mutation: drop the requirement show line -> red
      expect(found.def.format(view)).toContain(`draft 3 was re-drafted by Orca after code handed back draft 2, which answered your feedback on draft 1 ("${FEEDBACK}"); draft 3 reports no conflict with that feedback, so check that it still follows it; draft 2 had reported that following it breaks AC2. If it does not, send the feedback again: orca requirement feedback <group> --text "..."`);
    } finally { await x.dispose(); }
  });

  it("finds the standing feedback only across Orca's own re-drafts", () => {
    // Directly after the feedback: the model saw it, nothing to say.
    expect(feedbackAfterRedraft([draft(1, "rejected", FEEDBACK), draft(2, "awaiting-review", null)], 2)).toBeNull();
    // After one re-draft, with a conflict reported before: said, with the criteria.
    // A conflict the re-draft reported without quoting feedback is not about the feedback, so it is not named.
    // mutation: drop the `feedback` filter on conflictsBefore -> AC9 named -> red
    const unrelated = { criterion: "AC9", why: "Not about the feedback." };
    expect(feedbackAfterRedraft([draft(1, "rejected", FEEDBACK), draft(2, "invalid", null, { output: { ...INVALID_SPLIT, requirementConflicts: [...CONFLICTS, unrelated] } }), draft(3, "awaiting-review", null)], 3))
      .toEqual({ feedbackDraftNo: 1, feedback: FEEDBACK, redrafts: [2], conflictsBefore: ["AC2"] });
    // Across two re-drafts (a failed call between), with no conflict reported before.
    expect(feedbackAfterRedraft([draft(1, "rejected", FEEDBACK), draft(2, "invalid", null), draft(3, "failed", null, { output: null }), draft(4, "awaiting-review", null)], 4))
      .toEqual({ feedbackDraftNo: 1, feedback: FEEDBACK, redrafts: [2, 3], conflictsBefore: [] });
    // The draft reports a conflict about the feedback itself: the person is told by that report.
    expect(feedbackAfterRedraft([draft(1, "rejected", FEEDBACK), draft(2, "invalid", null), draft(3, "awaiting-review", null, { output: { ...VALID_SPLIT, requirementConflicts: CONFLICTS } })], 3)).toBeNull();
    // A revision of the requirement (rejected with no feedback) or no feedback at all: nothing.
    expect(feedbackAfterRedraft([draft(1, "rejected", null), draft(2, "invalid", null), draft(3, "awaiting-review", null)], 3)).toBeNull();
    expect(feedbackAfterRedraft([draft(1, "invalid", null), draft(2, "awaiting-review", null)], 2)).toBeNull();
  });

  it("keeps the version 7 bytes as they were, and version 8 asks the model to keep following the feedback", () => {
    // Pinned before this change (session 3ba26002, sha256 of SPLIT_INSTRUCTION_V7 and of a v7 prompt over a re-draft chain).
    expect(sha(SPLIT_INSTRUCTION_V7)).toBe("a6d33a2fbc56e017897095ad87baad8634c92f34dc891e825df141564c85c671");
    const chain = [draft(1, "rejected", "Drop the tests."), draft(2, "invalid", null, { output: { notes: "", tasks: [{ taskId: "t", title: "t", labels: [], goal: "g", successCondition: "s", targetPaths: ["a.js"], checks: ["true"], dependsOn: [], traces: ["AC1"] }], requirementConflicts: [{ criterion: "AC2", feedback: "Drop the tests.", why: "w" }] } })];
    expect(sha(buildSplitPrompt({ document: "D.", overview: { canonicalJson: "{}", hash: "c".repeat(64) }, earlierDrafts: chain, instructionVersion: 7 })))
      .toBe("bba4ab8fb17fc86a143146df0dfcdf39a3425c578cadad2c7452309601ccf0ff");
    expect(SPLIT_INSTRUCTION_V8.split("\n", 1)[0]).toBe("Orca requirement split, instruction version 8.");
    expect(SPLIT_INSTRUCTION_V8).toContain("The person's feedback stays in force until a draft is accepted");
    expect(SPLIT_INSTRUCTION_V8).toContain("`feedbackOnDraft`");
  });
});
