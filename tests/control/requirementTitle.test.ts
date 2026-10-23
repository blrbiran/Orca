import { describe, expect, it } from "vitest";
import { buildClarifyPrompt, CLARIFY_JSON_SCHEMA, classifyClarifyOutput } from "../../src/control/requirementClarify.js";
import { readRequirementGroup } from "../../src/control/requirementRecords.js";
import { readGroupSummary } from "../../src/panel/controlViews.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { ROUND_ONE } from "./fixtures/requirementOutputs.js";

/**
 * Flow gaps Task 10a (human request, session 0e13a9b7): the clarify call names the requirement with a short title in the
 * same call, so the overview, board and task cards can show it instead of a 1200-character goal. A bad title is dropped,
 * never a reason to discard (and pay again for) the whole answer; the latest round that gave one is the title.
 */
const ctx = { roundNo: 1, requirementId: "0123456789abcdef0123456789abcdef", earlierQuestionIds: [] as string[] };
const FORTY_ZH = "导出笔记为标准文件格式并保留图片链接功能".repeat(2); // 40 code points
const resultOf = (value: unknown, roundNo = 1) => {
  const out = classifyClarifyOutput(value, { ...ctx, roundNo });
  if (!out.ok) throw new Error(`refused: ${out.reason}`);
  return out.result;
};

describe("the clarify answer's title (Task 10a)", () => {
  it("keeps a title of up to 40 characters, trimmed, in any round", () => {
    expect(Array.from(FORTY_ZH)).toHaveLength(40);
    expect(resultOf({ ...ROUND_ONE, title: "  Markdown export  " }).title).toBe("Markdown export");
    expect(resultOf({ ...ROUND_ONE, title: FORTY_ZH }).title).toBe(FORTY_ZH);
    const { classification: _class, ...noClass } = ROUND_ONE;
    expect(resultOf({ ...noClass, title: "Round two title" }, 2).title).toBe("Round two title");
  });

  // Mutation "over-long title refused instead of dropped": each of these must still be a valid answer, with no title.
  it.each([
    ["one character over 40", `${FORTY_ZH}多`],
    ["empty", ""],
    ["blank", "   "],
    ["two lines", "Markdown\nexport"],
    ["not a string", 42],
  ])("drops a title that is %s, keeping the answer", (_name, title) => {
    const result = resultOf({ ...ROUND_ONE, title });
    expect(result).not.toHaveProperty("title");
    expect(result.slug).toBe("markdown-export");
  });

  it("has no title when the answer gives none", () => {
    expect(resultOf(ROUND_ONE)).not.toHaveProperty("title");
  });

  it("asks for the title in the same call: the schema allows it and the instruction names its limits", () => {
    expect((CLARIFY_JSON_SCHEMA as { properties: Record<string, unknown>; required: string[] }).properties.title).toEqual({ type: "string" });
    expect((CLARIFY_JSON_SCHEMA as { required: string[] }).required).not.toContain("title");
    const prompt = buildClarifyPrompt({ idea: "x", contentLanguage: "zh", overview: { canonicalJson: "{}", hash: "f".repeat(64) }, earlier: [], retryReason: null, limits: { roundNo: 1, classification: null, roundCap: 3 } });
    expect(prompt.startsWith("Orca requirement clarification, instruction version 3.")).toBe(true);
    expect(prompt).toContain("\"title\": optional, in any round: a short title naming what the work delivers, in the language the `Write in:` line names, at most 40 characters; a longer one is ignored, not a reason to discard the answer,");
  });
});

describe("the requirement keeps the latest round's title, and the group summary carries it (Task 10a)", () => {
  const twoRounds = async (first: unknown, second: unknown) => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: first }, { purpose: "clarify", output: second }] });
    await x.until(() => x.round(1).state === "awaiting-answers");
    const afterOne = { title: readRequirementGroup(x.store, "r").requirement.title, summary: readGroupSummary(x.store, "r").requirement?.title };
    const result = x.round(1).result!;
    expect(x.service.answerRequirement(x.command("requirement-answer", {
      roundNo: 1, answers: result.questions.map((q) => ({ id: q.id, kind: "recommended" as const })),
      glossaryDecisions: result.glossary.map((entry) => ({ id: entry.id, accept: true })), adrDecisions: result.adrs.map((adr) => ({ id: adr.id, accept: false })),
    }))).toMatchObject({ result: { nextRoundNo: 2 } });
    await x.until(() => x.round(2).state === "awaiting-answers");
    return { x, afterOne };
  };
  // Round 2 still asks a question, so it stays a clarify round the person must answer (no consensus closes it).
  const { slug: _slug, classification: _class, ...roundOneRest } = ROUND_ONE;
  const roundTwo = { ...roundOneRest, questions: [ROUND_ONE.questions[0]!] };

  it("a later round's title replaces an earlier one, on the requirement and in the summary", async () => {
    const { x, afterOne } = await twoRounds({ ...ROUND_ONE, title: "Markdown export" }, { ...roundTwo, title: "CommonMark export" });
    try {
      expect(afterOne).toEqual({ title: "Markdown export", summary: "Markdown export" });
      expect(readRequirementGroup(x.store, "r").requirement.title).toBe("CommonMark export");
      expect(readGroupSummary(x.store, "r").requirement?.title).toBe("CommonMark export");
      expect(x.round(2).result?.title).toBe("CommonMark export");
    } finally { await x.dispose(); }
  });

  it("a later round without a title (or with a dropped one) keeps the earlier title", async () => {
    const { x } = await twoRounds({ ...ROUND_ONE, title: "Markdown export" }, { ...roundTwo, title: "x".repeat(41) });
    try {
      expect(readRequirementGroup(x.store, "r").requirement.title).toBe("Markdown export");
      expect(readGroupSummary(x.store, "r").requirement?.title).toBe("Markdown export");
    } finally { await x.dispose(); }
  });

  it("a requirement no round titled has no title in its summary", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }] });
    try {
      await x.until(() => x.round(1).state === "awaiting-answers");
      expect(readRequirementGroup(x.store, "r").requirement).not.toHaveProperty("title");
      expect(readGroupSummary(x.store, "r").requirement).not.toHaveProperty("title");
    } finally { await x.dispose(); }
  });
});
