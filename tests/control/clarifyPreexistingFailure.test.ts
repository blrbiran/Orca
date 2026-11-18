import { describe, expect, it } from "vitest";
import { CLARIFY_INSTRUCTION_MULTI_V1, CLARIFY_INSTRUCTION_V3, CLARIFY_PROMPT_HEAD } from "../../src/control/requirementClarify.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { ROUND_ONE } from "./fixtures/requirementOutputs.js";

/**
 * #341 L1: a requirement that both forbids changing what exists and requires a whole check to pass leaves one thing
 * open -- what to do about a failure already in the repository. The model, not code, spots the two sentences (Rule 5);
 * what code can pin is that the instruction carries the rule, under the section about the person's questions, and that
 * a question the model asks on that basis reaches the frontier like any other.
 */
const PREEXISTING = {
  key: "preexisting", question: "A check already fails in the repository: fix it as an allowed change, or judge the check relative to the base?",
  recommendedAnswer: "Judge the check relative to the base.", why: "The requirement forbids changing existing behaviour.", dependsOn: [],
};

describe("clarify asks how a pre-existing failure is handled (#341 L1)", () => {
  it("the instruction carries the rule inside 'Which questions are the person's', and is version 4", () => {
    expect(CLARIFY_PROMPT_HEAD).toBe("Orca requirement clarification, instruction version 4.");
    const section = CLARIFY_INSTRUCTION_V3.split("## Which questions are the person's")[1]!.split("\n## ")[0]!;
    expect(section).toContain("forbids changing existing behaviour, contracts or documents");
    expect(section).toContain("requires a whole check");
    expect(section).toContain("a failure that already exists in the repository");
    expect(section).toContain("judge the check relative to the base");
    expect(section).toContain("only when both");
    expect(CLARIFY_INSTRUCTION_MULTI_V1).toContain("a failure that already exists in the repository");
  });

  it("a clarify fake that answers with the question surfaces it on the frontier", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: { ...ROUND_ONE, questions: [PREEXISTING] } }] });
    try {
      await x.until(() => x.round(1).state === "awaiting-answers");
      expect(x.round(1).result!.questions).toMatchObject([{ id: "R1.Q1", question: PREEXISTING.question }]);
    } finally { await x.dispose(); }
  });
});
