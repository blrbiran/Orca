import { describe, expect, it } from "vitest";
import { activeChain } from "../../src/control/clarifyChain.js";
import { readRequirementGroup, readRounds, saveRequirementGroup } from "../../src/control/requirementRecords.js";
import { readRequirementView } from "../../src/panel/controlViews.js";
import { requirementHarness, type QueuedAnswer } from "./fixtures/requirementHarness.js";
import { ROUND_ONE, VALID_SPLIT } from "./fixtures/requirementOutputs.js";

/**
 * Flow engine spec §10.3 (Issue #76, W-76; criterion C10): a person revises an answered clarify round. Nothing they
 * answered is overwritten (the revision is a new row), the requirement re-advances from the revised round (a reached
 * consensus is withdrawn, a draft built on it is closed), the caps count the active chain -- not round numbers -- and
 * the next round sees the superseded answers as answers that may still apply, unless the person excluded them.
 */
type X = Awaited<ReturnType<typeof requirementHarness>>;
const { classification: _classification, ...LATER } = ROUND_ONE;
// ROUND_ONE's understanding has one criterion (AC1): a split tracing only it.
const SPLIT = { ...VALID_SPLIT, tasks: [VALID_SPLIT.tasks[0]!] };
const answersFor = (x: X, roundNo: number, typed: Record<number, string> = {}) => {
  const result = x.round(roundNo).result!;
  return {
    roundNo,
    answers: result.questions.map((q, i) => (typed[i] === undefined ? { id: q.id, kind: "recommended" } : { id: q.id, kind: "text", text: typed[i] })),
    glossaryDecisions: result.glossary.map((e) => ({ id: e.id, accept: true })), adrDecisions: result.adrs.map((a) => ({ id: a.id, accept: true })),
  };
};
const rows = (x: X) => x.store.db.prepare("SELECT round_no, state, body FROM requirement_rounds WHERE group_id='r' ORDER BY round_no").all();
const prompts = (x: X) => [...new Map(x.fake.calls.accept.map((e) => [e.claim.runId, (e.work as { prompt: string }).prompt])).values()];

/** Three answered rounds under a large class (cap 3); round 3's second answer is typed "Third answer". */
async function threeRounds(extra: QueuedAnswer[]) {
  const x = await requirementHarness({ answers: [{ purpose: "clarify", output: ROUND_ONE }, { purpose: "clarify", output: LATER }, { purpose: "clarify", output: LATER }, ...extra] });
  await x.until(() => x.round(1).state === "awaiting-answers");
  expect(x.service.requirementClassify(x.command("requirement-classify", { scope: "large", clarity: "fair" }))).toMatchObject({ result: { kind: "requirement-classified" } });
  for (const n of [1, 2, 3]) {
    if (n > 1) await x.until(() => x.round(n).state === "awaiting-answers");
    expect(x.service.answerRequirement(x.command("requirement-answer", answersFor(x, n, n === 3 ? { 1: "Third answer" } : {})))).toMatchObject({ result: { roundNo: n, nextRoundNo: n === 3 ? null : n + 1 } });
  }
  return x;
}

describe("requirement-revise (spec §10.3, C10)", () => {
  it("appends a revision row, leaves rounds 1-3 byte-equal, and queues one call: a chain of 2 under cap 3 although round_no is 4", async () => {
    const x = await threeRounds([{ purpose: "clarify", output: LATER }]);
    try {
      const before = rows(x);
      const revised = x.service.requirementRevise(x.command("requirement-revise", { ...answersFor(x, 2, { 0: "GitHub-flavoured" }), reason: "we publish on GitHub" }));
      expect(revised).toMatchObject({ result: { kind: "requirement-revised", roundNo: 4, revises: 2, consensusWithdrawn: false, nextRoundNo: 5 } });
      expect(rows(x).slice(0, 3)).toEqual(before);
      const four = x.round(4);
      expect(four).toMatchObject({ state: "answered", revises: 2, reason: "we publish on GitHub", by: "human", result: x.round(2).result });
      expect(four.answers![0]).toEqual({ id: x.round(2).result!.questions[0]!.id, kind: "text", text: "GitHub-flavoured" });
      expect(activeChain(readRounds(x.store, "r"))).toEqual({ chain: [1, 4, 5], superseded: [2, 3] });
      expect(readRequirementView(x.store, "e", "r").clarify).toMatchObject({ chain: [1, 4, 5], stoppedAtCap: false });
      // The next round is drafted on the chain: numbered by its position, the superseded answers offered as recommended.
      await x.until(() => x.round(5).state === "awaiting-answers");
      const prompt = prompts(x).at(-1)!;
      expect(prompt).toContain("Limits: round 3 of at most 3;");
      expect(prompt).toContain("Earlier answers that may still apply");
      expect(prompt).toMatch(/superseded-rounds[^]*"answer":"Third answer"/);
      // Round 3 is no longer on the requirement's path: it is not among the chain's rounds.
      expect(prompt.slice(prompt.indexOf("<<<ORCA-DATA rounds"), prompt.indexOf("Earlier answers"))).not.toContain("Third answer");
    } finally { await x.dispose(); }
  });

  it("an excluded round's answers are not carried into the next round", async () => {
    const x = await threeRounds([{ purpose: "clarify", output: LATER }]);
    try {
      expect(x.service.requirementRevise(x.command("requirement-revise", { ...answersFor(x, 2, { 0: "GitHub-flavoured" }), exclude: [3] }))).toMatchObject({ result: { nextRoundNo: 5 } });
      expect(x.round(4).exclude).toEqual([3]);
      await x.until(() => x.round(5).state === "awaiting-answers");
      const prompt = prompts(x).at(-1)!;
      expect(prompt).toContain("superseded-rounds");
      expect(prompt).not.toContain("Third answer");
      // Only rounds this revision leaves off the chain may be excluded.
      expect(x.service.requirementRevise(x.command("requirement-revise", { ...answersFor(x, 5, { 0: "x" }), exclude: [1] }))).toMatchObject({ error: { code: "group-state-invalid" } });
    } finally { await x.dispose(); }
  });

  it("withdraws a reached consensus and closes the draft awaiting review as requirement-revised", async () => {
    const x = await threeRounds([{ purpose: "split", output: SPLIT }]);
    try {
      expect(x.service.requirementConsensus(x.command("requirement-consensus", { roundNo: 3 }))).toMatchObject({ result: { kind: "requirement-consensus" } });
      await x.until(() => x.store.db.prepare("SELECT state FROM requirement_drafts WHERE group_id='r' AND draft_no=1").get()!.state === "awaiting-review");
      // At the cap the revision itself queues no call: chain [1, 2, 4] is 3 long.
      expect(x.service.requirementRevise(x.command("requirement-revise", answersFor(x, 3, { 0: "changed" })))).toMatchObject({ result: { revises: 3, consensusWithdrawn: true, nextRoundNo: null } });
      const block = readRequirementGroup(x.store, "r").requirement;
      expect(block.consensus).toBeNull();
      expect(block.consensusWithdrawn).toMatchObject({ by: "human", revisedRound: 3 });
      const draft = JSON.parse(String(x.store.db.prepare("SELECT body FROM requirement_drafts WHERE group_id='r' AND draft_no=1").get()!.body));
      expect(draft).toMatchObject({ state: "rejected", reasonCode: "requirement-revised" });
    } finally { await x.dispose(); }
  });

  it("refuses identical answers (revision-unchanged), a round off the chain, and any revision after a draft was accepted", async () => {
    const x = await threeRounds([]);
    try {
      expect(x.service.requirementRevise(x.command("requirement-revise", answersFor(x, 2)))).toMatchObject({ error: { code: "revision-unchanged" } });
      expect(x.service.requirementRevise(x.command("requirement-revise", answersFor(x, 2, { 0: "y" })))).toMatchObject({ result: { roundNo: 4 } });
      // Round 3 is superseded now.
      expect(x.service.requirementRevise(x.command("requirement-revise", answersFor(x, 3, { 0: "z" })))).toMatchObject({ error: { code: "group-state-invalid" } });
      const group = readRequirementGroup(x.store, "r");
      x.store.transaction(() => saveRequirementGroup(x.store, { ...group, requirement: { ...group.requirement, acceptedDraftNo: 1 } }));
      expect(x.service.requirementRevise(x.command("requirement-revise", answersFor(x, 1, { 0: "w" })))).toMatchObject({ error: { code: "requirement-already-accepted" } });
    } finally { await x.dispose(); }
  });
});
