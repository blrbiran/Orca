import { describe, expect, it } from "vitest";
import { activeChain, chainRounds } from "../../src/control/clarifyChain.js";
import { renderRequirementDocument } from "../../src/control/requirementDocument.js";
import { readDraft, readRequirementGroup, readRounds } from "../../src/control/requirementRecords.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { ROUND_ONE, VALID_SPLIT } from "./fixtures/requirementOutputs.js";

// Human ruling (tester feedback round 2026-10-28, 「同意你的建议」): a requirement's rounds are numbered by their position on
// the active chain, one numbering across the requirement document, the ids code gives a round's questions, glossary
// entries and decisions, and the split validator's known ids. Before, a round drafted after a revision was "Round 4" in
// the document with ids R4.*, while the panel and the clarify prompt's limits called it round 2 (e236bbe4 residue).
const { classification: _classification, ...LATER } = ROUND_ONE;

describe("rounds numbered by chain position (ruling 2026-10-28)", () => {
  it("numbers the round after a revision by its position: ids, document headings, consensus line and traceable decision", async () => {
    const split = { ...VALID_SPLIT, tasks: [{ ...VALID_SPLIT.tasks[0]!, traces: ["AC1", "R2.ADR1"] }] };
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }, { purpose: "clarify", output: LATER }, { purpose: "clarify", output: LATER }, { purpose: "clarify", output: LATER }, { purpose: "clarify", output: LATER }, { purpose: "split", output: split }] });
    try {
      await x.until(() => x.round(1).state === "awaiting-answers");
      expect(x.service.requirementClassify(x.command("requirement-classify", { scope: "large", clarity: "fair" }))).toMatchObject({ result: { kind: "requirement-classified" } });
      const answers = (roundNo: number, typed?: string) => {
        const result = x.round(roundNo).result!;
        return { roundNo, answers: result.questions.map((q, i) => (i === 0 && typed !== undefined ? { id: q.id, kind: "text", text: typed } : { id: q.id, kind: "recommended" })),
          glossaryDecisions: result.glossary.map((e) => ({ id: e.id, accept: true })), adrDecisions: result.adrs.map((a) => ({ id: a.id, accept: true })) };
      };
      expect(x.service.answerRequirement(x.command("requirement-answer", answers(1)))).toMatchObject({ result: { nextRoundNo: 2 } });
      await x.until(() => x.round(2).state === "awaiting-answers");
      expect(x.service.answerRequirement(x.command("requirement-answer", answers(2)))).toMatchObject({ result: { nextRoundNo: 3 } });
      await x.until(() => x.round(3).state === "awaiting-answers");
      // Revise round 1: row 4 takes position 1, rounds 2 and 3 are set aside, row 5 is drafted at position 2 and row 6 at 3.
      expect(x.service.requirementRevise(x.command("requirement-revise", answers(1, "GitHub-flavoured")))).toMatchObject({ result: { roundNo: 4, revises: 1, nextRoundNo: 5 } });
      await x.until(() => x.round(5).state === "awaiting-answers");
      expect(activeChain(readRounds(x.store, "r")).chain).toEqual([4, 5]);
      const five = x.round(5).result!;
      expect([five.questions.map((q) => q.id), five.glossary.map((e) => e.id), five.adrs.map((a) => a.id)]).toEqual([["R2.Q1", "R2.Q2"], ["R2.G1"], ["R2.ADR1"]]);
      expect(five.questions[1]!.dependsOn).toEqual(["R2.Q1"]);
      expect(x.service.answerRequirement(x.command("requirement-answer", answers(5)))).toMatchObject({ result: { roundNo: 5, nextRoundNo: 6 } });
      await x.until(() => x.round(6).state === "awaiting-answers");
      expect(x.round(6).result!.adrs.map((a) => a.id)).toEqual(["R3.ADR1"]);
      expect(x.service.requirementConsensus(x.command("requirement-consensus", { roundNo: 6 }))).toMatchObject({ result: { kind: "requirement-consensus" } });
      const group = readRequirementGroup(x.store, "r");
      const document = renderRequirementDocument({ groupId: "r", requirement: group.requirement, rounds: chainRounds(readRounds(x.store, "r")), acceptedSplit: null });
      const headings = document.split("\n").filter((line) => line.startsWith("### Round "));
      expect(headings).toEqual(["### Round 1", "### Round 2", "### Round 3"]);
      expect(document).toContain("\n- round: 3\n");
      expect(document).toContain("### R2.ADR1 One file per note");
      // The split's trace of R2.ADR1 is a known id: the draft validates.
      await x.until(() => readDraft(x.store, "r", 1).state !== "drafting");
      expect(readDraft(x.store, "r", 1)).toMatchObject({ state: "awaiting-review", reasons: [] });
    } finally { await x.dispose(); }
  });

  // Review I1 (session a9f9d6de): chain-position ids repeat a superseded row's (row 3 kept R3.*; row 6 is at position 3),
  // so a later round may depend only on the chain's own earlier questions -- one id, one question.
  it("refuses a dependency on a superseded round's question: only the chain's earlier ids are known", async () => {
    const DEP = { ...LATER, questions: LATER.questions.map((q, i) => (i === 0 ? { ...q, dependsOn: ["R3.Q1"] } : q)) };
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }, { purpose: "clarify", output: LATER }, { purpose: "clarify", output: LATER }, { purpose: "clarify", output: LATER }, { purpose: "clarify", output: DEP }, { purpose: "clarify", output: LATER }] });
    try {
      await x.until(() => x.round(1).state === "awaiting-answers");
      x.service.requirementClassify(x.command("requirement-classify", { scope: "large", clarity: "fair" }));
      const answers = (roundNo: number, typed?: string) => {
        const result = x.round(roundNo).result!;
        return { roundNo, answers: result.questions.map((q, i) => (i === 0 && typed !== undefined ? { id: q.id, kind: "text", text: typed } : { id: q.id, kind: "recommended" })),
          glossaryDecisions: result.glossary.map((e) => ({ id: e.id, accept: true })), adrDecisions: result.adrs.map((a) => ({ id: a.id, accept: true })) };
      };
      x.service.answerRequirement(x.command("requirement-answer", answers(1)));
      await x.until(() => x.round(2).state === "awaiting-answers");
      x.service.answerRequirement(x.command("requirement-answer", answers(2)));
      await x.until(() => x.round(3).state === "awaiting-answers");
      expect(x.round(3).result!.questions[0]!.id).toBe("R3.Q1");
      x.service.requirementRevise(x.command("requirement-revise", answers(1, "GitHub-flavoured")));
      await x.until(() => x.round(5).state === "awaiting-answers");
      x.service.answerRequirement(x.command("requirement-answer", answers(5)));
      await x.until(() => x.round(6).state === "awaiting-answers");
      expect(x.round(6).calls[0]).toMatchObject({ outcome: "invalid", reason: "unknown-dependency:format:R3.Q1" });
    } finally { await x.dispose(); }
  });
});
