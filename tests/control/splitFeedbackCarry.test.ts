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
      // Ruling: human 「这次批准改写所有必要的判据」 (Orca session, 2026-11-23): tester #385 makes a new single-repository
      // split call send instruction version 9; the carried-feedback block above is unchanged from v8's.
      expect(prompts[2]!.startsWith("Orca requirement split, instruction version 9.")).toBe(true);
      // Draft 3 reports no conflict about the feedback, so the view says so.
      const view = readRequirementView(x.store, "e", "r");
      // mutation: drop feedbackAfterRedraft from the view -> red
      expect(view.drafts[2]).toMatchObject({ feedbackAfterRedraft: { feedbackDraftNo: 1, feedback: FEEDBACK, redrafts: [2], conflictsBefore: ["AC2"] } });
      expect(view.drafts[1]).not.toHaveProperty("feedbackAfterRedraft");
      const { findCommand } = await import("../../src/commands/registry.js");
      const found = findCommand(["requirement", "show"]);
      if (!("def" in found)) throw new Error("no requirement show row");
      // mutation: drop the requirement show line -> red
      // Review M4: the first re-drafted draft is the one that answered the feedback.
      expect(found.def.format(view)).toContain(`draft 3 came from Orca re-drafting draft 2, which answered your feedback on draft 1 ("${FEEDBACK}"); draft 3 reports no conflict with that feedback, so check that it still follows it; draft 2 had reported that following it breaks AC2. If it does not, send the feedback again: orca requirement feedback <group> --text "..."`);
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
    // Review M2: a rejection without feedback between the feedback and the draft ends the walk.
    // mutation: keep walking past a no-feedback rejection -> draft 1's feedback found -> red
    expect(feedbackAfterRedraft([draft(1, "rejected", FEEDBACK), draft(2, "rejected", null), draft(3, "invalid", null), draft(4, "awaiting-review", null)], 4)).toBeNull();
    // Review M1: a revision of the requirement that left an ended draft in place (its consensus withdrawn after draft 2)
    // ends the walk too: feedback given on the old requirement is not carried.
    const acrossRevision = [draft(1, "rejected", FEEDBACK), draft(2, "failed", null, { output: null }), draft(3, "invalid", null), draft(4, "awaiting-review", null)];
    expect(feedbackAfterRedraft(acrossRevision, 4)).toMatchObject({ feedbackDraftNo: 1, redrafts: [2, 3] });
    // mutation: ignore the revision boundary in standingFeedback -> red
    expect(feedbackAfterRedraft(acrossRevision, 4, 2)).toBeNull();
    // A revision of the requirement (rejected with no feedback) or no feedback at all: nothing.
    expect(feedbackAfterRedraft([draft(1, "rejected", null), draft(2, "invalid", null), draft(3, "awaiting-review", null)], 3)).toBeNull();
    expect(feedbackAfterRedraft([draft(1, "invalid", null), draft(2, "awaiting-review", null)], 2)).toBeNull();
  });

  it("sends the revised draft's conflicts only with carried feedback, and carries none across a requirement revision (review M5, M1)", () => {
    const ov = { canonicalJson: "{}", hash: "c".repeat(64) };
    // The person's own feedback draft carries its feedback as always, and no conflicts key (review M5).
    // mutation: send conflicts whenever the revised draft has them -> requirementConflicts present -> red
    expect(block(buildSplitPrompt({ document: "D.", overview: ov, earlierDrafts: [draft(1, "rejected", FEEDBACK, { output: { ...VALID_SPLIT, requirementConflicts: CONFLICTS } })] })))
      .toEqual({ draftNo: 1, tasks: VALID_SPLIT.tasks, feedback: FEEDBACK, handedBackFor: [] });
    const chain = [draft(1, "rejected", FEEDBACK), draft(2, "invalid", null, { output: { ...INVALID_SPLIT, requirementConflicts: CONFLICTS } })];
    expect(block(buildSplitPrompt({ document: "D.", overview: ov, earlierDrafts: chain }))).toMatchObject({ feedback: FEEDBACK, feedbackOnDraft: 1, requirementConflicts: CONFLICTS });
    // mutation: buildSplitPrompt ignores revisionBoundary -> feedback carried -> red
    const across = block(buildSplitPrompt({ document: "D.", overview: ov, earlierDrafts: chain, revisionBoundary: 1 }));
    expect(across).toMatchObject({ draftNo: 2, feedback: null });
    expect(across).not.toHaveProperty("feedbackOnDraft");
    expect(across).not.toHaveProperty("requirementConflicts");
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

describe("the re-draft note's boundaries in the requirement view (review M1, M3)", () => {
  it("is shown only on the draft awaiting review, and not across a requirement revision recorded on consensusWithdrawn", async () => {
    const { readRequirementGroup, saveRequirementGroup } = await import("../../src/control/requirementRecords.js");
    const x = await requirementHarness({ answers: [{ purpose: "split", output: VALID_SPLIT }, { purpose: "split", output: { ...INVALID_SPLIT, requirementConflicts: CONFLICTS } }, { purpose: "split", output: VALID_SPLIT }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
      await x.service.requirementDraftFeedback(x.command("requirement-draft-feedback", { draftNo: 1, feedback: FEEDBACK }));
      await x.until(() => { try { return readDraft(x.store, "r", 3).state === "awaiting-review"; } catch { return false; } });
      expect(readRequirementView(x.store, "e", "r").drafts[2]).toHaveProperty("feedbackAfterRedraft");
      // Review M3: once the draft is no longer awaiting review (here: accepted state written directly), no note.
      // mutation: drop the awaiting-review condition in the view -> note still there -> red
      const { writeDraft } = await import("../../src/control/requirementRecords.js");
      writeDraft(x.store, "r", { ...readDraft(x.store, "r", 3), state: "rejected", feedback: "Another change." });
      expect(readRequirementView(x.store, "e", "r").drafts[2]).not.toHaveProperty("feedbackAfterRedraft");
      expect(readRequirementView(x.store, "e", "r").drafts[2]).not.toHaveProperty("runtimeDataPaths");
      writeDraft(x.store, "r", { ...readDraft(x.store, "r", 3), state: "awaiting-review", feedback: null });
      // Review M1: a revision that withdrew the consensus after draft 2 is a boundary for the view.
      const group = readRequirementGroup(x.store, "r");
      group.requirement = { ...group.requirement, consensusWithdrawn: { at: "2026-11-19T00:00:00.000Z", by: "human", revisedRound: 1, lastDraftNo: 2 } };
      saveRequirementGroup(x.store, group);
      // mutation: the view passes no boundary -> note still there -> red
      expect(readRequirementView(x.store, "e", "r").drafts[2]).not.toHaveProperty("feedbackAfterRedraft");
    } finally { await x.dispose(); }
  });
});

describe("the review fixes' wiring (review M1 prepare, M4 wording)", () => {
  it("the split call's prepare passes the revision boundary: feedback on a draft before it is not carried", async () => {
    const { readRequirementGroup, saveRequirementGroup } = await import("../../src/control/requirementRecords.js");
    const x = await requirementHarness({ answers: [{ purpose: "split", output: VALID_SPLIT }, { purpose: "split", output: { ...INVALID_SPLIT, requirementConflicts: CONFLICTS } }, { purpose: "split", output: VALID_SPLIT }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
      await x.service.requirementDraftFeedback(x.command("requirement-draft-feedback", { draftNo: 1, feedback: FEEDBACK }));
      // As a revision that withdrew a consensus while draft 1 was the latest would record it.
      const group = readRequirementGroup(x.store, "r");
      group.requirement = { ...group.requirement, consensusWithdrawn: { at: "2026-11-19T00:00:00.000Z", by: "human", revisedRound: 1, lastDraftNo: 1 } };
      saveRequirementGroup(x.store, group);
      await x.until(() => { try { return readDraft(x.store, "r", 3).state === "awaiting-review"; } catch { return false; } });
      const prompts = x.fake.calls.accept.map((envelope) => (envelope.work as { prompt: string }).prompt);
      // mutation: prepare passes no revisionBoundary -> draft 1's feedback carried into draft 3's block -> red
      expect(block(prompts[2]!)).toMatchObject({ draftNo: 2, feedback: null });
      expect(block(prompts[2]!)).not.toHaveProperty("feedbackOnDraft");
    } finally { await x.dispose(); }
  });

  it("requirement show names the first re-drafted draft as the one that answered the feedback, then the later ones", async () => {
    const { findCommand } = await import("../../src/commands/registry.js");
    const found = findCommand(["requirement", "show"]);
    if (!("def" in found)) throw new Error("no requirement show row");
    const body = { drafts: [{ draftNo: 4, layers: null, feedbackAfterRedraft: { feedbackDraftNo: 1, feedback: FEEDBACK, redrafts: [2, 3], conflictsBefore: [] } }] };
    // mutation: name the last re-drafted draft instead of the first -> red
    expect(found.def.format(body)).toContain(`draft 4 came from Orca re-drafting draft 2, which answered your feedback on draft 1 ("${FEEDBACK}") (then re-drafting draft 3); draft 4 reports no conflict with that feedback, so check that it still follows it. If it does not, send the feedback again`);
  });
});
