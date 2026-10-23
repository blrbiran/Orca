import { describe, expect, it } from "vitest";
import { readRoundsAt } from "../../src/control/requirementRecords.js";
import { SUPERSEDED_NOTE } from "../../src/control/requirementClarify.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { flowMessagePayloadSchema } from "../../src/control/webProtocol.js";
import { answerFlowClarify, flowClarifyConsensus } from "../../src/flow/kinds/clarify.js";
import { appendQueued, loadRun } from "../../src/flow/kernel.js";
import { acceptMessage, consumeAtBoundary } from "../../src/flow/messages.js";
import { EDIT_NO_LONGER_APPLIES, STEP_WAITING } from "../../src/flow/rewind.js";
import { appendMessage, getFlowRun, getHead, listMessages, listPlans } from "../../src/flow/store.js";
import { ROUND_ONE, ROUND_TWO } from "../control/fixtures/requirementOutputs.js";
import { flowWorld } from "./fixtures/flowWorld.js";

/**
 * Gaps spec §9 (G7) and §4.2's rewind row (G2, carried here): an earlier round of a flow clarify step is revised by an
 * `edit` at that round, with `requirement-revise`'s semantics (F §10.3) on the flow host. Rounds are never overwritten.
 * While the step waits on the person the revision is appended to the same execution's rounds; once the step is done a
 * new execution of it takes a copy of the active chain plus the revision, and the step's active output stays the old
 * document until that execution reaches consensus -- only then does the head move and the ordinary plan (trigger
 * `edit`) re-plan what follows. A rewind re-applies a later round revision as a round revision, never drops it.
 */
const BRIEF = {
  yaml: `format: orca-flow-v1
id: t
params:
  idea: {type: longtext, required: true}
workspace: {kind: dir}
steps:
  - {id: brief, kind: clarify, background: prompts/brief.md, sections: [Reader, Purpose]}
  - {id: outline, kind: draft, prompt: prompts/outline.md}
`,
  assets: { "prompts/brief.md": "You are briefing a WeChat article for engineers.\n", "prompts/outline.md": "Outline.\n" },
};
const LINKS = { key: "links", question: "Relative or absolute image links?", recommendedAnswer: "Relative", why: "The file moves with its folder.", dependsOn: [] };
/** A round with one question; `frontierEmpty` decides whether another round may follow it. */
const roundWith = (frontierEmpty: boolean) => ({ ...ROUND_TWO, questions: [LINKS], frontierEmpty });

type World = Awaited<ReturnType<typeof flowWorld>>;
let n = 0;
const rounds = (w: World, groupId: string, seq: number) => readRoundsAt(w.store, { groupId, stepKey: "brief", execSeq: seq });
/** The stored rows of one execution's rounds, byte for byte. */
const raw = (w: World, groupId: string, seq: number) =>
  w.store.db.prepare("SELECT round_no, state, body FROM requirement_rounds WHERE group_id=? AND step_key='brief' AND exec_seq=? ORDER BY round_no").all(groupId, seq)
    .map((row) => ({ roundNo: Number(row.round_no), state: String(row.state), body: String(row.body) }));
const decisionsOf = (w: World, groupId: string, seq: number, roundNo: number) => {
  const result = rounds(w, groupId, seq).find((r) => r.roundNo === roundNo)!.result!;
  return { glossaryDecisions: result.glossary.map((g) => ({ id: g.id, accept: true })), adrDecisions: result.adrs.map((a) => ({ id: a.id, accept: true })) };
};
/** Answer round `roundNo` of the newest execution: every question with its recommended answer, every proposal accepted. */
async function answerRound(w: World, flowRunId: string, groupId: string, seq: number, roundNo: number): Promise<void> {
  const result = rounds(w, groupId, seq).find((r) => r.roundNo === roundNo)!.result!;
  await answerFlowClarify(w.deps, { flowRunId, stepKey: "brief" }, {
    roundNo, answers: result.questions.map((q) => ({ id: q.id, kind: "recommended" as const })), ...decisionsOf(w, groupId, seq, roundNo),
  }, "ann", "cli:test");
  await w.advance();
}
/** A revision of round `roundNo` of execution `seq`'s rows: the first question answered with `text`, the rest as before. */
function revision(w: World, groupId: string, seq: number, roundNo: number, text: string) {
  const result = rounds(w, groupId, seq).find((r) => r.roundNo === roundNo)!.result!;
  return {
    answers: result.questions.map((q, i) => (i === 0 ? { id: q.id, kind: "text" as const, text } : { id: q.id, kind: "recommended" as const })),
    ...decisionsOf(w, groupId, seq, roundNo),
  };
}
const revise = (w: World, flowRunId: string, roundNo: number, body: Record<string, unknown>, stepKey = "brief") =>
  acceptMessage(w.deps, flowRunId, { kind: "edit", target: { kind: "round", stepKey, roundNo }, body, by: "ann", via: "cli:test", requestId: `rev-${(n += 1)}` });
const briefCalls = (w: World) => w.calls.filter((c) => c.key.stepKey === "brief");
const lastIndex = (w: World) => w.calls.length - 1;
const states = (w: World, flowRunId: string) => w.execs(flowRunId, "brief").map((e) => [e.seq, e.state]);

/** brief done after two rounds (round 2 asks one question and ends the frontier), outline done: the run is done. */
async function doneRun(second = roundWith(true), outlineDone = true) {
  const w = await flowWorld({ t: BRIEF });
  // The person's checklist, so the plan a consensus makes stays proposed and can be read.
  w.deps.rerunReview = () => "review";
  const { flowRunId, groupId } = await w.start({ templateRef: "builtin/t", params: { idea: "Why tea" } });
  await w.advance();
  await w.answer(0, ROUND_ONE);
  await answerRound(w, flowRunId, groupId, 1, 1);
  await w.answer(1, second);
  await answerRound(w, flowRunId, groupId, 1, 2);
  await flowClarifyConsensus(w.deps, { flowRunId, stepKey: "brief" }, "ann", "cli:test");
  await w.advance();
  expect(w.calls[2]).toMatchObject({ purpose: "flow-draft", key: { stepKey: "outline" } });
  if (outlineDone) {
    await w.answer(2, { content: "O1" });
    expect(getFlowRun(w.store, flowRunId)!.state).toBe("done");
  }
  return { w, flowRunId, groupId };
}

describe("revise a round of a flow clarify step (G7)", () => {
  it("a done brief: a new execution takes the chain's rows plus the revision; the head moves only at consensus, then a plan", async () => {
    const { w, flowRunId, groupId } = await doneRun(); try {
      const before = raw(w, groupId, 1);
      const callsBefore = w.calls.length;
      const sent = await revise(w, flowRunId, 1, revision(w, groupId, 1, 1, "GitHub-flavoured"));
      expect(sent).toMatchObject({ state: "applied", reason: null });
      // Execution 1's rounds are byte-equal; execution 2 starts from a copy of them plus the revision row.
      expect(raw(w, groupId, 1)).toEqual(before);
      expect(states(w, flowRunId)).toEqual([[1, "done"], [2, "running"]]);
      expect(raw(w, groupId, 2).slice(0, 2)).toEqual(before);
      expect(rounds(w, groupId, 2).map((r) => [r.roundNo, r.state, r.revises ?? null])).toEqual([[1, "answered", null], [2, "answered", null], [3, "answered", 1], [4, "drafting", null]]);
      expect(rounds(w, groupId, 2)[2]).toMatchObject({ by: "ann", via: "cli:test", answers: [{ kind: "text", text: "GitHub-flavoured" }, { kind: "recommended" }] });
      // At most one clarify call: the next round on the revised chain, with the superseded rounds as earlier answers.
      expect(w.calls).toHaveLength(callsBefore + 1);
      expect(w.calls[lastIndex(w)]).toMatchObject({ purpose: "clarify", key: { stepKey: "brief", seq: 2 } });
      expect(w.calls[lastIndex(w)]!.prompt).toContain("GitHub-flavoured");
      expect(w.calls[lastIndex(w)]!.prompt).toContain(SUPERSEDED_NOTE);
      expect(w.calls[lastIndex(w)]!.prompt).toContain(LINKS.question);
      // The active output stays the old document while the revision is in progress.
      expect(getHead(w.store, flowRunId, "brief")).toBe(1);
      await w.answer(lastIndex(w), roundWith(false));
      await answerRound(w, flowRunId, groupId, 2, 4);
      // Chain [3, 4] is at the cap (2): the step waits for the person to agree; still nothing downstream moved.
      expect(w.latest(flowRunId, "brief")).toMatchObject({ seq: 2, state: "needs-person", body: { needsYou: { reason: "clarify-awaiting-consensus", cause: "round-cap" } } });
      expect(getHead(w.store, flowRunId, "brief")).toBe(1);
      expect(w.calls.filter((c) => c.purpose === "flow-draft")).toHaveLength(1);
      expect(listPlans(w.store, flowRunId)).toEqual([]);

      await flowClarifyConsensus(w.deps, { flowRunId, stepKey: "brief" }, "ann", "cli:test");
      await w.advance();
      expect(getHead(w.store, flowRunId, "brief")).toBe(2);
      const doc = JSON.parse(readCanonicalRecord(w.store, w.latest(flowRunId, "brief")!.outputRef!)) as { rounds: Array<{ roundNo: number; questions: Array<{ answer: string | null }> }> };
      expect(doc.rounds.map((r) => r.roundNo)).toEqual([3, 4]);
      expect(doc.rounds[0]!.questions[0]!.answer).toBe("GitHub-flavoured");
      // The ordinary plan follows: trigger `edit` on brief, outline a candidate (re-planned, not re-run silently).
      expect(listPlans(w.store, flowRunId)).toHaveLength(1);
      expect(listPlans(w.store, flowRunId)[0]).toMatchObject({ state: "proposed", candidates: { trigger: "edit", edits: ["brief"], list: [{ stepKey: "outline" }] } });
      expect((listPlans(w.store, flowRunId)[0]!.candidates as { list: Array<{ reasons: string[] }> }).list[0]!.reasons).toContain("upstream-changed:brief");
      expect(w.calls.filter((c) => c.purpose === "flow-draft")).toHaveLength(1);

      // A second revision of the revised execution (chain [3, 4], round 1 not copied): round 1's class still sets the
      // cap (2), so revising round 4 re-advances to "waits for consensus" with no clarify call.
      const callsNow = w.calls.length;
      expect(await revise(w, flowRunId, 4, revision(w, groupId, 2, 4, "Absolute"))).toMatchObject({ state: "applied" });
      expect(rounds(w, groupId, 3).map((r) => [r.roundNo, r.revises ?? null])).toEqual([[3, 1], [4, null], [5, 4]]);
      expect(w.calls).toHaveLength(callsNow);
      expect(w.latest(flowRunId, "brief")).toMatchObject({ seq: 3, state: "needs-person", body: { needsYou: { reason: "clarify-awaiting-consensus", cause: "round-cap" } } });
      expect(getHead(w.store, flowRunId, "brief")).toBe(2);
    } finally { await w.dispose(); }
  });

  it("is refused when it arrives if it cannot hold, and otherwise waits for the boundary while a later step runs", async () => {
    const { w, flowRunId, groupId } = await doneRun(roundWith(true), false); try {
      expect(w.latest(flowRunId, "outline")!.state).toBe("running");
      // Not at a boundary (outline's call is out), yet an unchanged revision is refused at once, by name.
      const asBefore = { answers: rounds(w, groupId, 1)[1]!.result!.questions.map((q) => ({ id: q.id, kind: "recommended" as const })), ...decisionsOf(w, groupId, 1, 2) };
      expect(await revise(w, flowRunId, 2, asBefore)).toMatchObject({ state: "rejected", reason: "revision-unchanged" });
      const waiting = await revise(w, flowRunId, 2, revision(w, groupId, 1, 2, "Absolute"));
      expect(waiting).toMatchObject({ state: "accepted", reason: null });
      expect(states(w, flowRunId)).toEqual([[1, "done"]]);
      await w.answer(2, { content: "O1" });
      expect(listMessages(w.store, flowRunId).find((m) => m.seq === waiting.seq)).toMatchObject({ state: "applied" });
      expect(states(w, flowRunId)).toEqual([[1, "done"], [2, "needs-person"]]);
    } finally { await w.dispose(); }
  });

  it("while the step waits on the person, the revision is appended to the same execution's rounds", async () => {
    const w = await flowWorld({ t: BRIEF }); try {
      const { flowRunId, groupId } = await w.start({ templateRef: "builtin/t", params: { idea: "Why tea" } });
      await w.advance();
      await w.answer(0, ROUND_ONE);
      await answerRound(w, flowRunId, groupId, 1, 1);
      await w.answer(1, roundWith(false));
      expect(rounds(w, groupId, 1).map((r) => r.state)).toEqual(["answered", "awaiting-answers"]);
      const before = raw(w, groupId, 1);
      expect(await revise(w, flowRunId, 1, revision(w, groupId, 1, 1, "GitHub-flavoured"))).toMatchObject({ state: "applied", reason: null });
      // Rounds 1 and 2 are byte-equal: the revision is row 3, never round 1 overwritten.
      expect(raw(w, groupId, 1).slice(0, 2)).toEqual(before);
      expect(states(w, flowRunId)).toEqual([[1, "running"]]);
      expect(rounds(w, groupId, 1).map((r) => [r.roundNo, r.state, r.revises ?? null])).toEqual([[1, "answered", null], [2, "awaiting-answers", null], [3, "answered", 1], [4, "drafting", null]]);
      expect(briefCalls(w)).toHaveLength(3);
      expect(w.calls[lastIndex(w)]).toMatchObject({ purpose: "clarify", key: { stepKey: "brief", seq: 1 } });
      expect(w.calls[lastIndex(w)]!.prompt).toContain("GitHub-flavoured");
      expect(getHead(w.store, flowRunId, "brief")).toBeNull();

      // Only a round on the active chain that is answered, with a payload that differs, is revisable.
      await w.answer(lastIndex(w), roundWith(false));
      const reason = async (roundNo: number, body: Record<string, unknown>, stepKey?: string) => (await revise(w, flowRunId, roundNo, body, stepKey)).reason;
      expect(await reason(1, revision(w, groupId, 1, 1, "CommonMark, after all"))).toBe("flow-round-not-revisable");
      expect(await reason(2, revision(w, groupId, 1, 2, "Absolute"))).toBe("flow-round-not-revisable");
      expect(await reason(4, revision(w, groupId, 1, 4, "Absolute"))).toBe("flow-round-not-revisable");
      expect(await reason(3, revision(w, groupId, 1, 3, "GitHub-flavoured"))).toBe("revision-unchanged");
      expect(await reason(1, revision(w, groupId, 1, 1, "x"), "outline")).toBe("flow-round-not-revisable");
      expect(await reason(3, { answers: [], glossaryDecisions: [], adrDecisions: [] })).toBe("flow-answer-invalid:answers");
      expect(await reason(3, { answers: "all" })).toMatch(/^flow-message-invalid:/);
      expect(rounds(w, groupId, 1)).toHaveLength(4);
      expect(briefCalls(w)).toHaveLength(3);
    } finally { await w.dispose(); }
  });
});

describe("the flow-message verb carries a round target (§9: access any, like requirement-revise)", () => {
  it("accepts an edit at a round and nothing but a step key and a round number in it", () => {
    const runId = "fr-00000000-0000-4000-8000-000000000000";
    const body = { answers: [], glossaryDecisions: [], adrDecisions: [] };
    expect(flowMessagePayloadSchema.safeParse({ runId, kind: "edit", target: { kind: "round", stepKey: "brief", roundNo: 1 }, body }).success).toBe(true);
    expect(flowMessagePayloadSchema.safeParse({ runId, kind: "edit", target: { kind: "round", stepKey: "brief", roundNo: 0 }, body }).success).toBe(false);
    expect(flowMessagePayloadSchema.safeParse({ runId, kind: "edit", target: { kind: "round", stepKey: "brief", roundNo: 1, seq: 2 }, body }).success).toBe(false);
  });
});

describe("rewind re-applies a later round revision (G2, §4.2)", () => {
  /** Revision A of round 2 makes execution 2 (agreed); then `later` is revised on execution 2's chain and agreed (execution 3). */
  async function twoRevisions(later: { roundNo: number; text: string }) {
    const { w, flowRunId, groupId } = await doneRun();
    expect(await revise(w, flowRunId, 2, revision(w, groupId, 1, 2, "Absolute"))).toMatchObject({ state: "applied" });
    expect(states(w, flowRunId)).toEqual([[1, "done"], [2, "needs-person"]]);
    await flowClarifyConsensus(w.deps, { flowRunId, stepKey: "brief" }, "ann", "cli:test");
    await w.advance();
    expect(getHead(w.store, flowRunId, "brief")).toBe(2);
    const b = await revise(w, flowRunId, later.roundNo, revision(w, groupId, 2, later.roundNo, later.text));
    expect(b).toMatchObject({ state: "applied" });
    if (w.latest(flowRunId, "brief")!.state === "running") {
      await w.answer(lastIndex(w), roundWith(true));
      const latest = rounds(w, groupId, 3).at(-1)!;
      await answerRound(w, flowRunId, groupId, 3, latest.roundNo);
    }
    await flowClarifyConsensus(w.deps, { flowRunId, stepKey: "brief" }, "ann", "cli:test");
    await w.advance();
    expect(getHead(w.store, flowRunId, "brief")).toBe(3);
    return { w, flowRunId, groupId, laterSeq: b.seq };
  }
  const rewindToFirst = (w: World, flowRunId: string) =>
    acceptMessage(w.deps, flowRunId, { kind: "command", target: { kind: "run" }, body: { command: "rewind", toStep: "brief", toSeq: 1 }, by: "ann", via: "cli:test", requestId: `rw-${(n += 1)}` });

  it("rewinding brief to execution 1 re-applies the revision made after it as a round revision on that chain", async () => {
    const { w, flowRunId, groupId, laterSeq } = await twoRevisions({ roundNo: 1, text: "GitHub-flavoured" }); try {
      const callsBefore = briefCalls(w).length;
      await rewindToFirst(w, flowRunId);
      const requeued = listMessages(w.store, flowRunId).filter((m) => (m.body as { reappliedFrom?: number }).reappliedFrom === laterSeq);
      expect(requeued).toHaveLength(1);
      expect(requeued[0]).toMatchObject({ kind: "edit", target: "round", state: "applied", reason: null });
      // Execution 4 is execution 1's chain plus the revision; revision A (made before the rewound point) is not in it.
      expect(states(w, flowRunId)).toEqual([[1, "done"], [2, "done"], [3, "done"], [4, "running"]]);
      expect(raw(w, groupId, 4).slice(0, 2)).toEqual(raw(w, groupId, 1));
      expect(rounds(w, groupId, 4).map((r) => [r.roundNo, r.state, r.revises ?? null])).toEqual([[1, "answered", null], [2, "answered", null], [3, "answered", 1], [4, "drafting", null]]);
      expect(rounds(w, groupId, 4)[2]!.answers![0]).toMatchObject({ kind: "text", text: "GitHub-flavoured" });
      expect(JSON.stringify(rounds(w, groupId, 4))).not.toContain("Absolute");
      expect(briefCalls(w)).toHaveLength(callsBefore + 1);
      expect(briefCalls(w).at(-1)).toMatchObject({ purpose: "clarify", key: { seq: 4 } });
      expect(getHead(w.store, flowRunId, "brief")).toBe(1);
    } finally { await w.dispose(); }
  });

  it("a re-applied revision whose round is not on the new chain becomes feedback on the step, flagged red", async () => {
    // Revision C revises round 3 -- revision A's row, which execution 1 does not have.
    const { w, flowRunId, groupId, laterSeq } = await twoRevisions({ roundNo: 3, text: "Inline" }); try {
      await rewindToFirst(w, flowRunId);
      const requeued = listMessages(w.store, flowRunId).find((m) => (m.body as { reappliedFrom?: number }).reappliedFrom === laterSeq)!;
      expect(requeued).toMatchObject({ state: "applied", reason: EDIT_NO_LONGER_APPLIES });
      const feedback = listMessages(w.store, flowRunId).find((m) => m.kind === "feedback" && (m.body as { fromEdit?: number }).fromEdit === laterSeq)!;
      expect(feedback).toMatchObject({ target: "step", body: { target: { kind: "step", stepKey: "brief" } } });
      expect((feedback.body as { text: string }).text).toContain("Inline");
      expect((w.execs(flowRunId, "brief").find((e) => e.seq === 1)!.body as { flags?: string[] }).flags).toContain(EDIT_NO_LONGER_APPLIES);
      expect(rounds(w, groupId, 4)).toEqual([]);
    } finally { await w.dispose(); }
  });
});

const PRE = {
  yaml: `format: orca-flow-v1
id: t
params:
  idea: {type: longtext, required: true}
workspace: {kind: dir}
steps:
  - {id: pre, kind: draft, prompt: prompts/pre.md}
  - {id: brief, kind: clarify, background: prompts/brief.md, sections: [Reader, Purpose]}
  - {id: outline, kind: draft, prompt: prompts/outline.md}
`,
  assets: { "prompts/pre.md": "Notes.\n", "prompts/brief.md": "You are briefing a WeChat article for engineers.\n", "prompts/outline.md": "Outline.\n" },
};
const rewindBrief = (w: World, flowRunId: string, toSeq: number) =>
  acceptMessage(w.deps, flowRunId, { kind: "command", target: { kind: "run" }, body: { command: "rewind", toStep: "brief", toSeq }, by: "ann", via: "cli:test", requestId: `rw-${(n += 1)}` });

describe("Task 7 review fix round 1", () => {
  // Review Important 1: a waiting revision would later move the head past the rewind (its consensus) and catch the
  // revisions the rewind queues again; the rewind is refused until the person settles it.
  it("refuses a rewind of a step whose newer execution still waits on the person (flow-step-waiting)", async () => {
    const { w, flowRunId, groupId } = await doneRun(); try {
      expect(await revise(w, flowRunId, 2, revision(w, groupId, 1, 2, "Absolute"))).toMatchObject({ state: "applied" });
      expect(states(w, flowRunId)).toEqual([[1, "done"], [2, "needs-person"]]);
      const sent = await rewindBrief(w, flowRunId, 1);
      expect(sent).toMatchObject({ state: "rejected", reason: STEP_WAITING });
      expect(getHead(w.store, flowRunId, "brief")).toBe(1);
      expect(states(w, flowRunId)).toEqual([[1, "done"], [2, "needs-person"]]);
      expect(listMessages(w.store, flowRunId).filter((m) => (m.body as { reappliedFrom?: unknown }).reappliedFrom !== undefined)).toEqual([]);
      // Agreed first, the same rewind is taken.
      await flowClarifyConsensus(w.deps, { flowRunId, stepKey: "brief" }, "ann", "cli:test");
      expect(await rewindBrief(w, flowRunId, 1)).toMatchObject({ state: "applied" });
      expect(getHead(w.store, flowRunId, "brief")).toBe(1);
    } finally { await w.dispose(); }
  });

  it("a round takes only an edit: feedback or a command there is a missing target", async () => {
    const { w, flowRunId } = await doneRun(); try {
      const at = (kind: "feedback" | "command", body: Record<string, unknown>) =>
        acceptMessage(w.deps, flowRunId, { kind, target: { kind: "round", stepKey: "brief", roundNo: 1 }, body, by: "ann", via: "cli:test", requestId: `t-${(n += 1)}` });
      expect(await at("feedback", { text: "the format question was wrong" })).toMatchObject({ state: "rejected", reason: "flow-message-target-missing" });
      expect(await at("command", { command: "retry" })).toMatchObject({ state: "rejected", reason: "flow-message-target-missing" });
    } finally { await w.dispose(); }
  });

  it("exclude names only rounds the revision leaves off the chain; an excluded round is not carried into the prompt", async () => {
    const { w, flowRunId, groupId } = await doneRun(); try {
      // Revising round 2 leaves round 1 on the chain: it cannot be excluded.
      expect(await revise(w, flowRunId, 2, { ...revision(w, groupId, 1, 2, "Absolute"), exclude: [1] })).toMatchObject({ state: "rejected", reason: "flow-message-invalid:exclude" });
      expect(w.execs(flowRunId, "brief")).toHaveLength(1);
      // Revising round 1 supersedes rounds 1 and 2; round 2 excluded, its question is not offered as an earlier answer.
      expect(await revise(w, flowRunId, 1, { ...revision(w, groupId, 1, 1, "GitHub-flavoured"), exclude: [2] })).toMatchObject({ state: "applied" });
      expect(rounds(w, groupId, 2)[2]).toMatchObject({ revises: 1, exclude: [2] });
      const prompt = w.calls[lastIndex(w)]!.prompt;
      expect(w.calls[lastIndex(w)]).toMatchObject({ purpose: "clarify", key: { stepKey: "brief", seq: 2 } });
      expect(prompt).toContain(SUPERSEDED_NOTE);
      expect(prompt).not.toContain(LINKS.question);
    } finally { await w.dispose(); }
  });

  it("a re-applied revision already in effect is refused revision-unchanged, not turned into feedback", async () => {
    const { w, flowRunId, groupId } = await doneRun(); try {
      const result = rounds(w, groupId, 1)[1]!.result!;
      const asBefore = { answers: result.questions.map((q) => ({ id: q.id, kind: "recommended" as const })), ...decisionsOf(w, groupId, 1, 2) };
      // As a rewind queues it again (rewind.ts): the stored body with `reappliedFrom`.
      const queued = w.store.transaction(() => appendMessage(w.store, {
        flowRunId, requestId: "rewind:test", kind: "edit", target: "round", body: { ...asBefore, target: { kind: "round", stepKey: "brief", roundNo: 2 }, reappliedFrom: 99 },
        by: "ann", via: "cli:test", state: "accepted", reason: null, at: w.deps.now(),
      }));
      await consumeAtBoundary(w.deps, flowRunId);
      expect(listMessages(w.store, flowRunId).find((m) => m.seq === queued.row.seq)).toMatchObject({ state: "rejected", reason: "revision-unchanged" });
      expect(listMessages(w.store, flowRunId).filter((m) => m.kind === "feedback")).toEqual([]);
      expect((w.execs(flowRunId, "brief")[0]!.body as { flags?: string[] }).flags ?? []).not.toContain(EDIT_NO_LONGER_APPLIES);
    } finally { await w.dispose(); }
  });

  it("a done step with a newer execution queued is not revised beside it (checked at the boundary)", async () => {
    const { w, flowRunId, groupId } = await doneRun(); try {
      w.store.transaction(() => appendQueued(w.deps, loadRun(w.store, flowRunId), "brief", 2, ["test"], {}, "ann", "cli:test", w.deps.now()));
      const sent = await revise(w, flowRunId, 1, revision(w, groupId, 1, 1, "GitHub-flavoured"));
      expect(sent).toMatchObject({ state: "rejected", reason: "flow-round-not-revisable" });
      expect(w.execs(flowRunId, "brief").map((e) => e.seq)).toEqual([1, 2]);
      expect(rounds(w, groupId, 3)).toEqual([]);
    } finally { await w.dispose(); }
  });

  // Review Minors 1 and 2: the revision execution starts through the kernel's own start path. A clarify step is never
  // held by a defer (§6.3 holds external/irreversible effect steps only), so it is not parked; it records what it stood on.
  it("a revision execution starts as any queued one: not parked by a deferred upstream, its basis and inputs recorded", async () => {
    const w = await flowWorld({ t: PRE }); try {
      w.deps.rerunReview = () => "review";
      const { flowRunId, groupId } = await w.start({ templateRef: "builtin/t", params: { idea: "Why tea" } });
      await w.advance();
      await w.answer(0, { content: "P1" });
      await w.answer(1, ROUND_ONE);
      await answerRound(w, flowRunId, groupId, 1, 1);
      await w.answer(2, roundWith(true));
      await answerRound(w, flowRunId, groupId, 1, 2);
      await flowClarifyConsensus(w.deps, { flowRunId, stepKey: "brief" }, "ann", "cli:test");
      await w.advance();
      await w.answer(3, { content: "O1" });
      const firstInputs = (w.execs(flowRunId, "brief")[0]!.body as { ranOnInputs: { earlier: Array<{ stepKey: string; outputHash: string | null }> } }).ranOnInputs;
      expect(firstInputs.earlier[0]).toMatchObject({ stepKey: "pre" });
      expect(firstInputs.earlier[0]!.outputHash).not.toBeNull();
      expect(await acceptMessage(w.deps, flowRunId, { kind: "command", target: { kind: "step", stepKey: "pre" }, body: { command: "defer" }, by: "ann", via: "cli:test", requestId: `d-${(n += 1)}` })).toMatchObject({ state: "applied" });
      expect(await revise(w, flowRunId, 2, revision(w, groupId, 1, 2, "Absolute"))).toMatchObject({ state: "applied" });
      const second = w.latest(flowRunId, "brief")!;
      expect(second).toMatchObject({ seq: 2, state: "needs-person", body: { basis: { pre: 1 }, needsYou: { reason: "clarify-awaiting-consensus" } } });
      expect((second.body as { ranOnInputs: { earlier: unknown[] } }).ranOnInputs.earlier).toEqual([{ stepKey: "pre", outputHash: null, projection: null }]);
    } finally { await w.dispose(); }
  });
});
