// Tester follow-up B T3 (#231, #240): the CLI answers a clarification round the way the Web's RoundForm.send does --
// every question not named takes its recommendation, every glossary entry and ADR not named is accepted -- and it does
// not close an open round by consensus (dropping its glossary and ADRs) unless the person says so with --unanswered.
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

const ROUND = {
  roundNo: 2, state: "awaiting-answers",
  result: {
    questions: [{ id: "R2.Q1", recommendedAnswer: "CommonMark" }, { id: "R2.Q2", recommendedAnswer: "As links" }, { id: "R2.Q3", recommendedAnswer: "No" }],
    glossary: [{ id: "R2.G1" }, { id: "R2.G2" }], adrs: [{ id: "R2.ADR1" }],
  },
};
const view = (latest: Record<string, unknown>) => ({
  "GET groups/g-alpha/requirement": { status: 200, body: {
    schema: "orca-requirement-view-v1", summary: { groupId: "g-alpha", commandRevision: 5, requirement: { roundNo: 2, draftNo: null } },
    rounds: [{ roundNo: 1, state: "answered" }, latest], drafts: [],
  } },
});

describe("requirement answer fills what the person did not name (#231)", () => {
  it("unnamed questions take the recommendation, unnamed glossary/ADR ids are accepted, named ones keep the person's choice", async () => {
    const w = await world({}, view(ROUND));
    const out = await cli(["requirement", "answer", "g-alpha", "--answer", "R2.Q2=inline", "--glossary", "R2.G2=reject", "--json"], w.dir);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    // Mutation "no fill" (send only the named ids) -> red: answers has one entry, glossaryDecisions one, adrDecisions none.
    expect(w.posts().map((post) => post.payload)).toEqual([{
      roundNo: 2,
      answers: [{ id: "R2.Q1", kind: "recommended" }, { id: "R2.Q2", kind: "text", text: "inline" }, { id: "R2.Q3", kind: "recommended" }],
      glossaryDecisions: [{ id: "R2.G1", accept: true }, { id: "R2.G2", accept: false }],
      adrDecisions: [{ id: "R2.ADR1", accept: true }],
    }]);
  });

  it("with no flag at all it answers the whole round as the Web's defaults would", async () => {
    const w = await world({}, view(ROUND));
    expect((await cli(["requirement", "answer", "g-alpha", "--json"], w.dir)).code).toBe(0);
    expect(w.posts().map((post) => post.payload)).toEqual([{
      roundNo: 2, answers: ["R2.Q1", "R2.Q2", "R2.Q3"].map((id) => ({ id, kind: "recommended" })),
      glossaryDecisions: [{ id: "R2.G1", accept: true }, { id: "R2.G2", accept: true }], adrDecisions: [{ id: "R2.ADR1", accept: true }],
    }]);
  });

  it("an id the round does not hold is still sent, so the panel names it as extra", async () => {
    const w = await world({}, view(ROUND));
    await cli(["requirement", "answer", "g-alpha", "--answer", "R2.Q9", "--json"], w.dir);
    expect((w.posts()[0]!.payload as { answers: Array<{ id: string }> }).answers.map((a) => a.id)).toEqual(["R2.Q1", "R2.Q2", "R2.Q3", "R2.Q9"]);
  });

  it("the help says unnamed ids take the Web's defaults", async () => {
    const w = await world({}, view(ROUND));
    const out = await cli(["requirement", "answer", "--help"], w.dir);
    expect(out.stdout).toMatch(/not named.*recommend/i);
  });
});

describe("requirement consensus on an open round (#240)", () => {
  it("refuses without --unanswered, naming the open questions and the dropped glossary and ADRs, and sends nothing", async () => {
    const w = await world({}, view(ROUND));
    const out = await cli(["requirement", "consensus", "g-alpha", "--json"], w.dir);
    // Mutation "no check" -> red: exit 0 and one POST.
    expect(out.code).toBe(1);
    expect(out.json().body.error.code).toBe("requirement-round-unanswered");
    expect(out.json().body.error.message).toMatch(/round 2 has 3 unanswered question\(s\).*2 glossary entr.*1 ADR.*--unanswered/);
    expect(w.posts()).toEqual([]);
  });

  it("with --unanswered it closes the round as before", async () => {
    const w = await world({}, view(ROUND));
    const out = await cli(["requirement", "consensus", "g-alpha", "--unanswered", "--json"], w.dir);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    expect(w.posts().map((post) => [post.path, post.payload])).toEqual([["groups/g-alpha/requirement/consensus", { roundNo: 2 }]]);
  });

  it("an answered round needs no --unanswered", async () => {
    const w = await world({}, view({ ...ROUND, state: "answered" }));
    expect((await cli(["requirement", "consensus", "g-alpha", "--json"], w.dir)).code).toBe(0);
    expect(w.posts()).toHaveLength(1);
  });
});

describe("the panel's answer-set refusal reaches the person with the ids it names (#231)", () => {
  it("prints the missing and extra ids the panel listed", async () => {
    const message = "group-state-invalid:answers:missing=R2.Q3;extra=R2.Q9";
    const w = await world({}, { ...view(ROUND), "POST groups/g-alpha/requirement/answer": { status: 409, body: { error: { code: "group-state-invalid", message, commandRevision: 5, evidenceIds: [], retryable: false } } } });
    const out = await cli(["requirement", "answer", "g-alpha", "--answer", "R2.Q9"], w.dir);
    expect(out.code).toBe(2);
    expect(out.stderr).toMatch(/missing R2\.Q3/);
  });
});

// Tester follow-up E §7 (#251): `requirement answer --finish` answers the round and closes clarification in one command
// (payload `finish: true`; a plain answer keeps its bytes). A plain answer that queued the next round says so and names
// --finish, and a consensus the panel refuses because that round is drafting names the round and --finish.
describe("requirement answer --finish, and saying that a plain answer drafts the next round (#251)", () => {
  const answered = (result: Record<string, unknown>) => ({ "POST groups/g-alpha/requirement/answer": { status: 200, body: { commandId: "c", commandRevision: 6, result: { kind: "requirement-answered", roundNo: 2, ...result } } } });

  it("--finish sends finish: true beside the filled answers", async () => {
    const w = await world({}, view(ROUND));
    expect((await cli(["requirement", "answer", "g-alpha", "--finish", "--json"], w.dir)).code).toBe(0);
    expect(w.posts().map((post) => post.payload)).toEqual([{
      roundNo: 2, answers: ["R2.Q1", "R2.Q2", "R2.Q3"].map((id) => ({ id, kind: "recommended" })),
      glossaryDecisions: [{ id: "R2.G1", accept: true }, { id: "R2.G2", accept: true }], adrDecisions: [{ id: "R2.ADR1", accept: true }], finish: true,
    }]);
  });

  it("a plain answer that queued a round says it is drafting and names --finish; a finishing one says clarification closed", async () => {
    const next = await world({}, { ...view(ROUND), ...answered({ nextRoundNo: 3, wakeId: "w" }) });
    const plain = await cli(["requirement", "answer", "g-alpha"], next.dir);
    expect(plain.code, plain.stderr).toBe(0);
    expect(plain.stdout).toContain("round 3 is now drafting; use --finish to stop after a round");
    const done = await world({}, { ...view(ROUND), ...answered({ nextRoundNo: null, wakeId: "w", finished: true }) });
    const finished = await cli(["requirement", "answer", "g-alpha", "--finish"], done.dir);
    expect(finished.stdout).toContain("clarification closed at round 2 with these answers; draft 1 is drafting");
    expect(finished.stdout).not.toContain("--finish");
    const stopped = await world({}, { ...view(ROUND), ...answered({ nextRoundNo: null, wakeId: null }) });
    expect((await cli(["requirement", "answer", "g-alpha"], stopped.dir)).stdout).not.toContain("drafting");
  });

  it("a consensus refused because the latest round is drafting names that round and --finish", async () => {
    const refusal = { "POST groups/g-alpha/requirement/consensus": { status: 409, body: { error: { code: "group-state-invalid", message: "group-state-invalid:round-state", commandRevision: 5, evidenceIds: [], retryable: false } } } };
    const w = await world({}, { ...view({ roundNo: 2, state: "drafting", result: null }), ...refusal });
    const out = await cli(["requirement", "consensus", "g-alpha"], w.dir);
    expect(out.code).toBe(2);
    expect(out.stderr).toContain("orca: round 2 is drafting (the round your last answer queued); wait for it and agree then, or answer with --finish next time to stop clarifying after a round\n");
    const answeredRound = await world({}, { ...view({ ...ROUND, state: "answered" }), ...refusal });
    expect((await cli(["requirement", "consensus", "g-alpha"], answeredRound.dir)).stderr).not.toContain("--finish");
  });
});
