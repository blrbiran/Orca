import { describe, expect, it } from "vitest";
import { buildClarifyPrompt, classifyClarifyOutput } from "../../src/control/requirementClarify.js";
import { clarifyLimits, readRequirementGroup, saveRequirementGroup, writeRound } from "../../src/control/requirementRecords.js";
import { CLARIFY_CAPS, clarifyTier, type ClassPair } from "../../src/control/requirementSchemas.js";
import { readRequirementView } from "../../src/panel/controlViews.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { CLASSIFICATION, ROUND_ONE, ROUND_TWO } from "./fixtures/requirementOutputs.js";

// Clarify caps spec 2026-10-21. The tester's requirement ran ten rounds and 129 items to review: the person tires and
// accepts every recommendation, so clarification stops meaning anything. Code, not the model, holds a round to caps that
// follow the requirement's size (§3.2), stops at the round cap (§3.3), and lets the person ask for exactly one more round.

const ctx = { roundNo: 1, requirementId: "0123456789abcdef0123456789abcdef", earlierQuestionIds: [] as string[] };
const SMALL_CLEAR = { scope: "small", scopeReason: "One flag.", clarity: "clear", clarityReason: "Stated in full." } as const;
const LARGE = { ...SMALL_CLEAR, scope: "large" } as const;
const question = (i: number) => ({ ...ROUND_ONE.questions[0]!, key: `k${i}`, dependsOn: [] });
const term = (i: number) => ({ term: `t${i}`, definition: "d" });
const adr = (i: number) => ({ ...ROUND_ONE.adrs[0]!, title: `a${i}` });
const many = <T,>(n: number, of: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => of(i));
const reasonOf = (out: ReturnType<typeof classifyClarifyOutput>) => (out.ok ? "ok" : out.reason);

describe("the class decides the caps (spec §3.2)", () => {
  it("maps small and clear to small, large or vague to large, anything else to medium, and an unclassified one to large", () => {
    const tier = (scope: ClassPair["scope"], clarity: ClassPair["clarity"]) => clarifyTier({ scope, clarity });
    expect([tier("small", "clear"), tier("small", "fair"), tier("medium", "clear"), tier("medium", "fair")]).toEqual(["small", "medium", "medium", "medium"]);
    expect([tier("large", "clear"), tier("small", "vague"), tier("medium", "vague"), clarifyTier(null)]).toEqual(["large", "large", "large", "large"]);
    // The table the human approved: a small, clear requirement gets one round of three questions.
    expect(CLARIFY_CAPS).toEqual({
      small: { rounds: 1, questions: 3, glossary: 2, adrs: 1 }, medium: { rounds: 2, questions: 5, glossary: 4, adrs: 2 }, large: { rounds: 3, questions: 5, glossary: 5, adrs: 3 },
    });
  });

  it("refuses a round-1 answer over its own class's caps, and takes the same answer under a wider class", () => {
    const four = { ...ROUND_ONE, questions: many(4, question) };
    expect(reasonOf(classifyClarifyOutput({ ...four, classification: SMALL_CLEAR }, ctx))).toBe("cap:questions:4>3");
    expect(reasonOf(classifyClarifyOutput({ ...four, classification: CLASSIFICATION }, ctx))).toBe("ok");
    expect(reasonOf(classifyClarifyOutput({ ...ROUND_ONE, glossary: many(3, term), classification: SMALL_CLEAR }, ctx))).toBe("cap:glossary:3>2");
    expect(reasonOf(classifyClarifyOutput({ ...ROUND_ONE, glossary: many(3, term), classification: CLASSIFICATION }, ctx))).toBe("ok");
    expect(reasonOf(classifyClarifyOutput({ ...ROUND_ONE, adrs: many(3, adr), classification: CLASSIFICATION }, ctx))).toBe("cap:adrs:3>2");
    expect(reasonOf(classifyClarifyOutput({ ...ROUND_ONE, adrs: many(3, adr), classification: LARGE }, ctx))).toBe("ok");
    expect(reasonOf(classifyClarifyOutput({ ...ROUND_ONE, glossary: many(5, term), classification: LARGE }, ctx))).toBe("ok");
    expect(reasonOf(classifyClarifyOutput({ ...ROUND_ONE, glossary: many(6, term), classification: LARGE }, ctx))).toBe("cap:glossary:6>5");
  });

  it("holds a later round to the class known before it, and the person's class over the model's in round 1", () => {
    const four = { ...ROUND_TWO, questions: many(4, question), frontierEmpty: false };
    const round2 = { ...ctx, roundNo: 2 };
    expect(reasonOf(classifyClarifyOutput(four, { ...round2, classification: { scope: "small", clarity: "clear" } }))).toBe("cap:questions:4>3");
    expect(reasonOf(classifyClarifyOutput(four, { ...round2, classification: { scope: "medium", clarity: "fair" } }))).toBe("ok");
    // Unclassified (a record from before this change) is the large tier.
    expect(reasonOf(classifyClarifyOutput({ ...four, adrs: many(3, adr) }, { ...round2, classification: null }))).toBe("ok");
    // The person said small and clear before round 1 came back: the model's "large" does not widen the caps.
    expect(reasonOf(classifyClarifyOutput({ ...ROUND_ONE, questions: many(4, question), classification: LARGE }, { ...ctx, classification: { scope: "small", clarity: "clear" } }))).toBe("cap:questions:4>3");
  });

  it("requires the classification in round 1 only, keeps it as written there, and drops it from later rounds", () => {
    const { classification: _c, ...unclassified } = ROUND_ONE;
    expect(reasonOf(classifyClarifyOutput(unclassified, ctx))).toBe("classification-missing");
    expect(classifyClarifyOutput(ROUND_ONE, ctx)).toMatchObject({ ok: true, result: { classification: CLASSIFICATION } });
    const later = classifyClarifyOutput(ROUND_ONE, { ...ctx, roundNo: 2, classification: null });
    expect(later.ok && "classification" in later.result).toBe(false);
  });

  it("tells the model this round's caps, and the table in round 1 before anyone judged", () => {
    const overview = { canonicalJson: "{}", hash: "f".repeat(64) };
    const base = { idea: "x", contentLanguage: "en" as const, overview, earlier: [], retryReason: null };
    expect(buildClarifyPrompt({ ...base, limits: { roundNo: 2, classification: { scope: "small", clarity: "clear" }, roundCap: 2 } }))
      .toContain("Limits: round 2 of at most 2; in this round at most 3 questions, 2 glossary entries and 1 decisions.");
    const first = buildClarifyPrompt({ ...base, limits: { roundNo: 1, classification: null, roundCap: 3 } });
    expect(first).toContain("Limits: round 1; the class you write decides this round's limits");
    expect(first).toContain("- small scope and clear: 1 round; per round at most 3 questions, 2 glossary entries and 1 decisions.");
    expect(first).toContain("the agent that carries out the work decides those");
  });
});

const recommendedAll = (x: Awaited<ReturnType<typeof requirementHarness>>, roundNo: number) => {
  const result = x.round(roundNo).result!;
  return { roundNo, answers: result.questions.map((q) => ({ id: q.id, kind: "recommended" })), glossaryDecisions: result.glossary.map((e) => ({ id: e.id, accept: true })), adrDecisions: result.adrs.map((a) => ({ id: a.id, accept: true })) };
};
const SMALL_ROUND = { ...ROUND_ONE, classification: SMALL_CLEAR };

describe("stopping at the round cap, and one more round (spec §3.3)", () => {
  it("drafts no round after the cap round, grants exactly one more on request, and stops again after it", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: SMALL_ROUND }, { purpose: "clarify", output: ROUND_ONE }] });
    try {
      await x.until(() => x.round(1).state === "awaiting-answers");
      // Not stopped yet: the round still awaits answers.
      expect(x.service.requirementClarifyMore(x.command("requirement-clarify-more", { roundNo: 1 }))).toMatchObject({ error: { code: "group-state-invalid" } });
      expect(x.service.answerRequirement(x.command("requirement-answer", recommendedAll(x, 1)))).toMatchObject({ result: { nextRoundNo: null, wakeId: null } });
      expect(readRequirementView(x.store, "e", "r").clarify).toMatchObject({ tier: "small", roundCap: 1, questions: 3, stoppedAtCap: true });
      expect(x.service.requirementClarifyMore(x.command("requirement-clarify-more", { roundNo: 1 }))).toMatchObject({ result: { kind: "requirement-clarify-more", roundNo: 1, nextRoundNo: 2 } });
      expect(x.round(2).state).toBe("drafting");
      // Issue #87 (spec §3.6): the drafting step is timed from the command that asked for it.
      const asked = x.store.db.prepare("SELECT at,body FROM activity WHERE group_id='r' AND kind='command' ORDER BY seq DESC LIMIT 1").get()!;
      expect(JSON.parse(String(asked.body))).toMatchObject({ verb: "requirement-clarify-more" });
      expect(readRequirementView(x.store, "e", "r").draftingSince).toBe(Number(asked.at));
      await x.until(() => x.round(2).state === "awaiting-answers");
      expect(readRequirementView(x.store, "e", "r").draftingSince).toBeNull();
      expect(x.service.answerRequirement(x.command("requirement-answer", recommendedAll(x, 2)))).toMatchObject({ result: { nextRoundNo: null } });
      expect(readRequirementView(x.store, "e", "r").clarify).toMatchObject({ roundCap: 2, stoppedAtCap: true });
      expect(x.store.db.prepare("SELECT COUNT(*) AS n FROM requirement_rounds WHERE group_id='r'").get()!.n).toBe(2);
      // Consensus is reachable from the stop, as from an empty frontier.
      expect(x.service.requirementConsensus(x.command("requirement-consensus", { roundNo: 2 }))).toMatchObject({ result: { kind: "requirement-consensus" } });
      expect(x.service.requirementClarifyMore(x.command("requirement-clarify-more", { roundNo: 2 }))).toMatchObject({ error: { code: "group-state-invalid" } });
    } finally { await x.dispose(); }
  });

  it("takes the person's class over the model's: a wider class lifts the cap, and the model's judgement stays on round 1", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "clarify", output: SMALL_ROUND }] });
    try {
      await x.until(() => x.round(1).state === "awaiting-answers");
      expect(x.service.requirementClassify(x.command("requirement-classify", { scope: "medium", clarity: "fair" }))).toMatchObject({ result: { kind: "requirement-classified", scope: "medium", clarity: "fair" } });
      expect(x.service.requirementClassify(x.command("requirement-classify", { scope: "medium", clarity: "fair" }))).toMatchObject({ error: { code: "no-op-command" } });
      expect(x.service.answerRequirement(x.command("requirement-answer", recommendedAll(x, 1)))).toMatchObject({ result: { nextRoundNo: 2 } });
      const view = readRequirementView(x.store, "e", "r");
      expect(view.clarify).toMatchObject({ classification: SMALL_CLEAR, override: { scope: "medium", clarity: "fair" }, tier: "medium", roundCap: 2 });
    } finally { await x.dispose(); }
  });
});

describe("records from before the caps (spec §3.4)", () => {
  it("reads a block and a round 1 without a class as unclassified, held to the large tier", async () => {
    const x = await requirementHarness({ answers: [] });
    try {
      const classified = classifyClarifyOutput(ROUND_ONE, ctx);
      if (!classified.ok) throw new Error(classified.reason);
      const { classification: _c, ...result } = classified.result;
      writeRound(x.store, "r", { ...x.round(1), state: "awaiting-answers", result });
      const group = readRequirementGroup(x.store, "r");
      expect("classOverride" in group.requirement || "roundsGranted" in group.requirement).toBe(false);
      saveRequirementGroup(x.store, group);
      expect(clarifyLimits(x.store, readRequirementGroup(x.store, "r"))).toMatchObject({ classification: null, override: null, tier: "large", roundCap: 3 });
      expect(readRequirementView(x.store, "e", "r").clarify).toMatchObject({ classification: null, tier: "large", roundCap: 3, stoppedAtCap: false });
    } finally { await x.dispose(); }
  });
});
