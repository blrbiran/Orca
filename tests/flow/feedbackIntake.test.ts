/**
 * Gaps spec §4 (G2): feedback on a run. Code locates the passage in the flow head's markdown (never guessing), code
 * bounds the steps that may take it, one `feedback-triage` call classifies; a vague whole-article feedback gets one
 * short clarify round (at most two questions) before anything re-runs; a replacement withdraws the old intake. Only the
 * intake waits for the person -- never the run; a `done` run stays `done` until the intake's plan is made; a rewind
 * reuses the stored intake with no new call. The model is a recording fake: every call is answered by the criterion.
 *
 * World: `draft` writes post.md, `polish` writes post.final.md (the reading file), `notes` is a record, `publish` writes
 * post.html. A feedback on post.final.md may go to `draft` or `polish` (T is bounded at its last writer), never later.
 */
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readRoundsAt } from "../../src/control/requirementRecords.js";
import { answerFeedbackClarify } from "../../src/flow/feedback/intake.js";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { createFlowCallPort } from "../../src/flow/calls.js";
import { acceptMessage } from "../../src/flow/messages.js";
import { getFlowRun, getIntake, listMessages, listPlans } from "../../src/flow/store.js";
import { readFlowList } from "../../src/flow/views.js";
import { fakeChildPort } from "./fixtures/childPort.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const TPL = {
  yaml: `format: orca-flow-v1
id: fb
version: 1
workspace: {kind: dir}
steps:
  - {id: draft, kind: work, prompt: draft.md}
  - {id: polish, kind: work, prompt: polish.md}
  - {id: notes, kind: draft, prompt: notes.md}
  - {id: publish, kind: work, prompt: publish.md}
`,
  assets: { "draft.md": "Write post.md.\n", "polish.md": "Polish it into post.final.md.\n", "notes.md": "Write notes.\n", "publish.md": "Publish it.\n" },
};
const POST = "# Tea\n\nTea slows you down and that is good.\n\nIt is warm in the morning.\n\nIt is warm in the morning.\n";
const FINAL = "# Tea\n\nTea slows you down and that is good.\n\n## Why\n\nEngineers think better with a warm cup.\n\nIt has a ritual everyone shares.\n";

type World = Awaited<ReturnType<typeof flowWorld>> & { children: ReturnType<typeof fakeChildPort> };
const msg = (over: Record<string, unknown>) => ({ by: "ann", via: "cli:test", requestId: `r-${Math.random()}`, ...over }) as Parameters<typeof acceptMessage>[2];
const runState = (w: World, id: string) => getFlowRun(w.store, id)!.state;
const callsOf = (w: World, purpose: string) => w.calls.filter((c) => c.purpose === purpose);
const lastIndex = (w: World, purpose: string) => w.calls.map((c) => c.purpose).lastIndexOf(purpose);
const goalOf = (w: World, id: string) => JSON.parse(w.children.opened.get(id)!.plan.tasks[0]!.originalContractCanonicalJson).objective.goal as string;
const intakeOf = (w: World, id: string, seq: number) => getIntake(w.store, id, seq)!;

async function world(opts: { files?: Record<string, string> } = {}): Promise<World> {
  const children = fakeChildPort();
  const w = await flowWorld({ fb: TPL }, { children: children.port, ...(opts.files === undefined ? {} : { files: opts.files }) });
  return Object.assign(w, { children });
}

/** A run from start to `done`; `upTo` stops it with polish dispatched (running). */
async function run(w: World, finalFiles: Record<string, string> = { "post.final.md": FINAL }, upTo: "polish-running" | "done" = "done"): Promise<string> {
  const { flowRunId } = await w.start({ templateRef: "builtin/fb" });
  await w.advance();
  w.children.land(childGroupIdOf(flowRunId, "draft", 1), { "post.md": POST });
  await w.advance();
  if (upTo === "polish-running") return flowRunId;
  w.children.land(childGroupIdOf(flowRunId, "polish", 1), finalFiles);
  await w.advance();
  await w.answer(lastIndex(w, "flow-draft"), { content: "notes" });
  w.children.land(childGroupIdOf(flowRunId, "publish", 1), { "post.html": "<p>Tea</p>\n" });
  await w.advance();
  expect(runState(w, flowRunId)).toBe("done");
  return flowRunId;
}

const feedback = (w: World, flowRunId: string, body: Record<string, unknown>, target: Record<string, unknown> = { kind: "run" }) =>
  acceptMessage(w.deps, flowRunId, msg({ kind: "feedback", target, body }));

describe("feedback intake (gaps §4, G2)", { timeout: 60_000 }, () => {
  it("anchored run-level feedback on a done run: triage bounded at the last writer, the run stays done until the plan, the location reaches the prompt", async () => {
    const w = await world(); try {
      const id = await run(w);
      const sent = await feedback(w, id, { text: "too sweet", anchors: [{ quote: "Engineers think better with a warm cup." }] });
      expect(sent.state).toBe("accepted");
      // Located in the reading file; triage is out, and the run is still done (anti-goal 4, §4.2).
      expect(intakeOf(w, id, sent.seq)).toMatchObject({ state: "triaging", body: { results: [{ located: { file: "post.final.md", paragraph: 2, headingPath: ["Tea", "Why"] } }] } });
      expect(runState(w, id)).toBe("done");
      const triage = w.calls.at(-1)!;
      expect(triage).toMatchObject({ purpose: "feedback-triage", key: { flowRunId: id, stepKey: "@feedback", seq: sent.seq } });
      expect(triage.prompt).toContain("- draft (work)");
      expect(triage.prompt).toContain("- polish (work)");
      // T is bounded at post.final.md's last writer: nothing after polish may take it.
      expect(triage.prompt).not.toContain("- notes (");
      expect(triage.prompt).not.toContain("- publish (");
      expect(triage.prompt).toContain("Engineers think better with a warm cup.");
      expect(readFlowList(w.store).runs[0]!.state).toBe("done");
      // The answer is judged; the pump (advanceFlowRuns) takes the ready intake at the boundary: one plan, now running.
      await w.answer(w.calls.length - 1, { targets: [{ stepKey: "polish", why: "polish owns the tone" }] });
      expect(intakeOf(w, id, sent.seq)).toMatchObject({ state: "planned", body: { planNo: 1, targets: [{ stepKey: "polish" }] } });
      expect(listMessages(w.store, id).find((m) => m.seq === sent.seq)!.state).toBe("applied");
      expect(runState(w, id)).toBe("running");
      expect((listPlans(w.store, id)[0]!.candidates as { list: unknown[] }).list[0]).toEqual({ stepKey: "polish", reasons: ["feedback"] });
      await w.answer(lastIndex(w, "rerun-proposal"), { skips: [] });
      const goal = goalOf(w, childGroupIdOf(id, "polish", 2));
      expect(goal).toContain("too sweet");
      expect(goal).toContain("Where: in `post.final.md`, paragraph 2 under «Tea › Why»: «Engineers think better with a warm cup.»");
    } finally { await w.dispose(); }
  });

  it("a target outside T is invalid and retried; exhausted, the last writer alone takes it, flagged", async () => {
    const w = await world(); try {
      const id = await run(w);
      const sent = await feedback(w, id, { text: "too sweet", anchors: [{ quote: "Engineers think better with a warm cup." }] });
      for (let i = 0; i < 3; i += 1) await w.answer(w.calls.length - 1, { targets: [{ stepKey: "publish", why: "it is the last" }] });
      expect(callsOf(w, "feedback-triage")).toHaveLength(3);
      expect(callsOf(w, "feedback-triage")[1]!.prompt).toContain("target-not-candidate:publish");
      expect(intakeOf(w, id, sent.seq)).toMatchObject({ state: "planned", body: { targets: [{ stepKey: "polish" }], flags: ["triage-defaulted"] } });
    } finally { await w.dispose(); }
  });

  it("anchored feedback answered vague is invalid (vague is only for whole-article feedback)", async () => {
    const w = await world(); try {
      const id = await run(w);
      const sent = await feedback(w, id, { text: "too sweet", anchors: [{ quote: "Engineers think better with a warm cup." }] });
      await w.answer(w.calls.length - 1, { targets: [{ stepKey: "polish", why: "tone" }], clarity: "vague" });
      expect(callsOf(w, "feedback-triage")).toHaveLength(2);
      expect(callsOf(w, "clarify")).toHaveLength(0);
      expect(callsOf(w, "feedback-triage")[1]!.prompt).toContain("vague-not-allowed");
      expect(intakeOf(w, id, sent.seq).state).toBe("triaging");
    } finally { await w.dispose(); }
  });

  it("a quote in two paragraphs asks back with both hits; picking hit 2 replaces the intake and locates it there", async () => {
    const w = await world(); try {
      const id = await run(w);
      const sent = await feedback(w, id, { text: "repetitive", anchors: [{ quote: "It is warm in the morning." }] }, { kind: "step", stepKey: "draft" });
      const asked = intakeOf(w, id, sent.seq);
      expect(asked.state).toBe("needs-location");
      expect(asked.body.results).toEqual([{ anchor: { quote: "It is warm in the morning." }, more: 0, hits: [
        { file: "post.md", paragraph: 2, headingPath: ["Tea"], excerpt: "It is warm in the morning." },
        { file: "post.md", paragraph: 3, headingPath: ["Tea"], excerpt: "It is warm in the morning." },
      ] }]);
      expect(callsOf(w, "feedback-triage")).toHaveLength(0);
      expect(readFlowList(w.store).runs[0]).toMatchObject({ state: "done", needsYou: 1 });
      const picked = await feedback(w, id, { text: "repetitive", replaces: sent.seq, hit: 2 }, { kind: "step", stepKey: "draft" });
      expect(picked.state).toBe("applied");
      expect(intakeOf(w, id, sent.seq).state).toBe("withdrawn");
      expect(listMessages(w.store, id).find((m) => m.seq === sent.seq)!.state).toBe("excluded");
      // Step-targeted and located: no triage, planned at once.
      expect(intakeOf(w, id, picked.seq)).toMatchObject({ state: "planned", body: { results: [{ located: { file: "post.md", paragraph: 3 } }], targets: [{ stepKey: "draft" }] } });
      expect(callsOf(w, "feedback-triage")).toHaveLength(0);
      expect(listPlans(w.store, id)[0]!.candidates).toMatchObject({ feedback: { draft: [expect.stringContaining("paragraph 3")] } });
    } finally { await w.dispose(); }
  });

  it("a replacement of an intake whose plan already ran is refused flow-feedback-already-applied", async () => {
    const w = await world(); try {
      const id = await run(w);
      const sent = await feedback(w, id, { text: "repetitive", anchors: [{ quote: "Tea slows you down and that is good." }] }, { kind: "step", stepKey: "draft" });
      expect(intakeOf(w, id, sent.seq).state).toBe("planned");
      await w.answer(lastIndex(w, "rerun-proposal"), { skips: [{ stepKey: "polish", reason: "x" }, { stepKey: "publish", reason: "x" }] });
      w.children.land(childGroupIdOf(id, "draft", 2), { "post.md": POST.replace("good", "fine") });
      await w.advance();
      await w.answer(lastIndex(w, "flow-draft"), { content: "notes 2" });
      expect(listPlans(w.store, id)[0]!.state).toBe("done");
      const again = await feedback(w, id, { text: "x", replaces: sent.seq }, { kind: "step", stepKey: "draft" });
      expect(again).toMatchObject({ state: "rejected", reason: "flow-feedback-already-applied" });
    } finally { await w.dispose(); }
  });

  it("while an intake waits on the person (needs-location, then clarifying) the run's queued steps still start", async () => {
    const w = await world(); try {
      const id = await run(w, undefined, "polish-running");
      const where = await feedback(w, id, { text: "repetitive", anchors: [{ quote: "It is warm in the morning." }] });
      expect(intakeOf(w, id, where.seq).state).toBe("needs-location");
      const vague = await feedback(w, id, { text: "something feels off" });
      await w.answer(w.calls.length - 1, { targets: [{ stepKey: "draft", why: "the base" }], clarity: "vague" });
      await w.answer(w.calls.length - 1, { slug: "fb", statement: "## What feels wrong\nx\n## Where\ny\n## What it should become\nz", acceptanceCriteria: [], questions: [{ key: "q1", question: "Which part?", recommendedAnswer: "The start", why: "focus", dependsOn: [] }], frontierEmpty: false, openBranches: [], glossary: [], adrs: [] });
      expect(intakeOf(w, id, vague.seq).state).toBe("clarifying");
      // The polish child lands: notes is a queued step of the run and starts while both intakes wait.
      w.children.land(childGroupIdOf(id, "polish", 1), { "post.final.md": FINAL });
      await w.advance();
      expect(w.latest(id, "notes")).toMatchObject({ state: "running" });
      expect(runState(w, id)).toBe("running");
    } finally { await w.dispose(); }
  });

  it("whole-article vague: one clarify round at ('@feedback', seq), a third question is invalid, the answers make a restated second triage and a plan", async () => {
    const w = await world(); try {
      const id = await run(w);
      const sent = await feedback(w, id, { text: "something feels off" });
      const first = w.calls.at(-1)!;
      expect(first.purpose).toBe("feedback-triage");
      expect(first.prompt).toContain("## The article as the person reads it (`post.final.md`)");
      expect(first.prompt).toContain("\"vague\"");
      await w.answer(w.calls.length - 1, { targets: [{ stepKey: "polish", why: "tone" }], clarity: "vague" });
      expect(intakeOf(w, id, sent.seq)).toMatchObject({ state: "clarifying", body: { triage: { clarity: "vague" } } });
      const clarify = w.calls.at(-1)!;
      expect(clarify).toMatchObject({ purpose: "clarify", key: { flowRunId: id, stepKey: "@feedback", seq: sent.seq } });
      expect(clarify.prompt).toContain("Limits: round 1 of at most 1; in this round at most 2 questions, 0 glossary entries and 0 decisions.");
      const key = { groupId: getFlowRun(w.store, id)!.groupId, stepKey: "@feedback", execSeq: sent.seq };
      expect(readRoundsAt(w.store, key)).toMatchObject([{ roundNo: 1, state: "drafting" }]);
      const q = (n: number) => ({ key: `q${n}`, question: `Question ${n}?`, recommendedAnswer: `Answer ${n}`, why: "w", dependsOn: [] });
      const round = (questions: unknown[]) => ({ slug: "fb", statement: "## What feels wrong\nx\n## Where\ny\n## What it should become\nz", acceptanceCriteria: [], questions, frontierEmpty: false, openBranches: [], glossary: [], adrs: [] });
      await w.answer(w.calls.length - 1, round([q(1), q(2), q(3)]));
      expect(readRoundsAt(w.store, key)[0]).toMatchObject({ state: "drafting", retries: 1, lastInvalidReason: "cap:questions:3>2" });
      expect(callsOf(w, "clarify")).toHaveLength(2);
      await w.answer(w.calls.length - 1, round([q(1), q(2)]));
      expect(readRoundsAt(w.store, key)[0]).toMatchObject({ state: "awaiting-answers" });
      // The intake waits on the person; the run is done and shows it under needs-you.
      expect(readFlowList(w.store).runs[0]).toMatchObject({ state: "done", needsYou: 1 });
      const triages = callsOf(w, "feedback-triage").length;
      await answerFeedbackClarify(w.deps, { flowRunId: id, messageSeq: sent.seq }, { roundNo: 1, answers: [{ id: "R1.Q1", kind: "text", text: "The intro" }, { id: "R1.Q2", kind: "recommended" }] }, "ann", "cli:test");
      const second = w.calls.at(-1)!;
      expect(callsOf(w, "feedback-triage")).toHaveLength(triages + 1);
      expect(second.prompt).toContain("- Q: Question 1?\n  A: The intro");
      expect(second.prompt).toContain("Write `restated`");
      await w.answer(w.calls.length - 1, { targets: [{ stepKey: "polish", why: "tone" }] });
      expect(second.prompt).not.toContain("restated-missing");
      expect(callsOf(w, "feedback-triage").at(-1)!.prompt).toContain("restated-missing");
      await w.answer(w.calls.length - 1, { targets: [{ stepKey: "polish", why: "tone" }], restated: "Cut the intro to one line." });
      expect(intakeOf(w, id, sent.seq)).toMatchObject({ state: "planned", body: { restated: "Cut the intro to one line.", qa: [{ question: "Question 1?", answer: "The intro" }, { question: "Question 2?", answer: "Answer 2" }] } });
      // Three kinds of call at most: triage, the round (and its retry), the second triage (and its retry).
      expect(intakeOf(w, id, sent.seq).body.calls.map((c) => c.purpose)).toEqual(["feedback-triage", "clarify", "clarify", "feedback-triage", "feedback-triage"]);
      await w.answer(lastIndex(w, "rerun-proposal"), { skips: [] });
      expect(goalOf(w, childGroupIdOf(id, "polish", 2))).toContain("Restated: Cut the intro to one line.");
    } finally { await w.dispose(); }
  });

  it("a clarify call exhausted on invalid answers goes on as asIs, flagged clarify-skipped; the second triage may not answer vague", async () => {
    const w = await world(); try {
      const id = await run(w);
      const sent = await feedback(w, id, { text: "something feels off" });
      await w.answer(w.calls.length - 1, { targets: [{ stepKey: "polish", why: "tone" }], clarity: "vague" });
      for (let i = 0; i < 3; i += 1) await w.answer(w.calls.length - 1, { not: "a round" });
      expect(callsOf(w, "clarify")).toHaveLength(3);
      expect(intakeOf(w, id, sent.seq)).toMatchObject({ state: "restating", body: { asIs: true, flags: ["clarify-skipped"] } });
      const second = w.calls.at(-1)!;
      expect(second.purpose).toBe("feedback-triage");
      expect(second.prompt).toContain("`clarity` may only be \"concrete\" or left out");
      await w.answer(w.calls.length - 1, { targets: [{ stepKey: "polish", why: "tone" }] });
      expect(intakeOf(w, id, sent.seq).state).toBe("planned");
    } finally { await w.dispose(); }
  });

  it("a run whose last step settles while an intake is still triaging is not done until the intake is planned", async () => {
    const w = await world(); try {
      const { flowRunId: id } = await w.start({ templateRef: "builtin/fb" });
      await w.advance();
      w.children.land(childGroupIdOf(id, "draft", 1), { "post.md": POST });
      await w.advance();
      w.children.land(childGroupIdOf(id, "polish", 1), { "post.final.md": FINAL });
      await w.advance();
      await w.answer(lastIndex(w, "flow-draft"), { content: "notes" });
      const sent = await feedback(w, id, { text: "too sweet", anchors: [{ quote: "Engineers think better with a warm cup." }] });
      expect(intakeOf(w, id, sent.seq).state).toBe("triaging");
      w.children.land(childGroupIdOf(id, "publish", 1), { "post.html": "<p>Tea</p>\n" });
      await w.advance();
      expect(w.latest(id, "publish")).toMatchObject({ state: "done" });
      expect(runState(w, id)).toBe("running");
    } finally { await w.dispose(); }
  });

  it("an asIs replacement closes the round: the old intake is withdrawn, its message excluded, and the new triage may not answer vague", async () => {
    const w = await world(); try {
      const id = await run(w);
      const sent = await feedback(w, id, { text: "something feels off" });
      await w.answer(w.calls.length - 1, { targets: [{ stepKey: "polish", why: "tone" }], clarity: "vague" });
      expect(intakeOf(w, id, sent.seq).state).toBe("clarifying");
      const asIs = await feedback(w, id, { text: "something feels off", replaces: sent.seq, asIs: true });
      expect(intakeOf(w, id, sent.seq).state).toBe("withdrawn");
      expect(listMessages(w.store, id).find((m) => m.seq === sent.seq)!.state).toBe("excluded");
      await expect(answerFeedbackClarify(w.deps, { flowRunId: id, messageSeq: sent.seq }, "consensus", "ann", "cli:test")).rejects.toThrow(/flow-ask-closed/);
      const triage = w.calls.at(-1)!;
      expect(triage).toMatchObject({ purpose: "feedback-triage", key: { seq: asIs.seq } });
      expect(triage.prompt).not.toContain("\"vague\" when");
      await w.answer(w.calls.length - 1, { targets: [{ stepKey: "polish", why: "tone" }], clarity: "vague" });
      expect(callsOf(w, "feedback-triage").at(-1)!.prompt).toContain("vague-not-allowed");
      expect(intakeOf(w, id, asIs.seq).state).toBe("triaging");
    } finally { await w.dispose(); }
  });

  it("rewind past an applied intake reuses its location and targets with no new triage or clarify call", async () => {
    const w = await world(); try {
      const id = await run(w);
      const sent = await feedback(w, id, { text: "too sweet", anchors: [{ quote: "Engineers think better with a warm cup." }] });
      await w.answer(w.calls.length - 1, { targets: [{ stepKey: "polish", why: "tone" }] });
      await w.answer(lastIndex(w, "rerun-proposal"), { skips: [{ stepKey: "notes", reason: "x" }, { stepKey: "publish", reason: "x" }] });
      w.children.land(childGroupIdOf(id, "polish", 2), { "post.final.md": FINAL.replace("ritual", "habit") });
      await w.advance();
      expect(runState(w, id)).toBe("done");
      const before = { triage: callsOf(w, "feedback-triage").length, clarify: callsOf(w, "clarify").length };
      // Rewinding `notes` to "not run" re-applies everything said after notes first ran: this feedback.
      await acceptMessage(w.deps, id, msg({ kind: "command", target: { kind: "run" }, body: { command: "rewind", toStep: "notes" } }));
      expect({ triage: callsOf(w, "feedback-triage").length, clarify: callsOf(w, "clarify").length }).toEqual(before);
      const requeued = listMessages(w.store, id).find((m) => (m.body as { reappliedFrom?: number }).reappliedFrom === sent.seq)!;
      expect(intakeOf(w, id, requeued.seq)).toMatchObject({ state: "planned", body: { reusedFrom: sent.seq, targets: [{ stepKey: "polish" }], results: [{ located: { file: "post.final.md", paragraph: 2 } }] } });
      expect(listPlans(w.store, id).at(-1)!.candidates).toMatchObject({ feedback: { polish: [expect.stringContaining("Where: in `post.final.md`, paragraph 2")] } });
    } finally { await w.dispose(); }
  });

  it("a ready intake whose anchor no longer locates goes back to needs-location instead of planning", async () => {
    const w = await world(); try {
      const id = await run(w);
      const sent = await feedback(w, id, { text: "too sweet", anchors: [{ quote: "Engineers think better with a warm cup." }] });
      // Meanwhile the person rewrites that passage in their folder; drift is taken at the next boundary.
      writeFileSync(join(w.folder, "post.final.md"), FINAL.replace("Engineers think better with a warm cup.", "A warm cup helps."));
      await w.answer(w.calls.length - 1, { targets: [{ stepKey: "polish", why: "tone" }] });
      expect(intakeOf(w, id, sent.seq).state).toBe("needs-location");
      expect(listMessages(w.store, id).find((m) => m.seq === sent.seq)!.state).toBe("accepted");
      expect(listPlans(w.store, id).every((p) => (p.candidates as { trigger: string }).trigger !== "feedback")).toBe(true);
    } finally { await w.dispose(); }
  });

  it("locates against the flow head after drift removed the reading file from the folder", async () => {
    const w = await world(); try {
      const id = await run(w);
      rmSync(join(w.folder, "post.final.md"));
      const sent = await feedback(w, id, { text: "too sweet", anchors: [{ quote: "Tea slows you down and that is good." }] });
      // The drift is taken first: post.final.md is gone from the head, so the quote is only in post.md (draft wrote it).
      expect(intakeOf(w, id, sent.seq).body.results).toEqual([{ anchor: { quote: "Tea slows you down and that is good." }, located: { file: "post.md", paragraph: 1, headingPath: ["Tea"], excerpt: "Tea slows you down and that is good." } }]);
      const triage = callsOf(w, "feedback-triage").at(-1)!;
      expect(triage.prompt).toContain("- draft (work)");
      expect(triage.prompt).not.toContain("- polish (");
    } finally { await w.dispose(); }
  });

  it("an ordinal on an ambiguous reading file lists the candidate files even when none has that paragraph", async () => {
    const w = await world(); try {
      const id = await run(w, { "post.final.md": FINAL, "post.alt.md": "# Alt\n\nOne.\n" });
      const sent = await feedback(w, id, { text: "第九段 is too long" });
      expect(intakeOf(w, id, sent.seq)).toMatchObject({ state: "needs-location", body: { anchors: [{ paragraph: 9 }], results: [{ hits: [] }], ambiguousFiles: ["post.alt.md", "post.final.md"] } });
      const whole = await feedback(w, id, { text: "something feels off" });
      expect(intakeOf(w, id, whole.seq)).toMatchObject({ state: "needs-location", body: { ambiguousFiles: ["post.alt.md", "post.final.md"] } });
    } finally { await w.dispose(); }
  });

  it("a file the person imported and no step touched is not searched", async () => {
    const w = await world({ files: { "ideas.md": "# Ideas\n\nOnly the person wrote this sentence.\n" } }); try {
      const id = await run(w);
      const sent = await feedback(w, id, { text: "x", anchors: [{ quote: "Only the person wrote this sentence." }] });
      expect(intakeOf(w, id, sent.seq)).toMatchObject({ state: "needs-location", body: { results: [{ hits: [] }], searchSet: [{ path: "post.final.md", writerKey: "polish" }, { path: "post.md", writerKey: "draft" }] } });
    } finally { await w.dispose(); }
  });

  it("no step may take it: the intake fails flow-feedback-no-target, visible on its message", async () => {
    const w = await world(); try {
      const id = await run(w);
      for (const stepKey of ["draft", "polish", "notes", "publish"]) await acceptMessage(w.deps, id, msg({ kind: "command", target: { kind: "step", stepKey }, body: { command: "skip" } }));
      const sent = await feedback(w, id, { text: "something feels off" });
      expect(intakeOf(w, id, sent.seq)).toMatchObject({ state: "failed", body: { flags: ["flow-feedback-no-target"] } });
      expect(listMessages(w.store, id).find((m) => m.seq === sent.seq)).toMatchObject({ state: "rejected", reason: "flow-feedback-no-target" });
      expect(callsOf(w, "feedback-triage")).toHaveLength(0);
    } finally { await w.dispose(); }
  });

  it("an intake's call the parent cannot fund settles through the pump into the code default", async () => {
    const w = await world(); try {
      const id = await run(w);
      w.deps.calls = createFlowCallPort({ store: w.store, now: w.deps.now });
      const sent = await feedback(w, id, { text: "too sweet", anchors: [{ quote: "Engineers think better with a warm cup." }] });
      // The production port claimed it: no confirmed parent profile, so the result is a final failure on the intake.
      await w.advance();
      expect(intakeOf(w, id, sent.seq)).toMatchObject({ state: "planned", body: { targets: [{ stepKey: "polish" }], flags: ["triage-defaulted"] } });
    } finally { await w.dispose(); }
  });

  it("a stop withdraws the run's open intakes", async () => {
    const w = await world(); try {
      const id = await run(w);
      const sent = await feedback(w, id, { text: "repetitive", anchors: [{ quote: "It is warm in the morning." }] });
      expect(intakeOf(w, id, sent.seq).state).toBe("needs-location");
      await acceptMessage(w.deps, id, msg({ kind: "command", target: { kind: "run" }, body: { command: "stop" } }));
      expect(intakeOf(w, id, sent.seq).state).toBe("withdrawn");
      expect(listMessages(w.store, id).find((m) => m.seq === sent.seq)!.state).toBe("excluded");
    } finally { await w.dispose(); }
  });

  it("refuses malformed feedback fields by name", async () => {
    const w = await world(); try {
      const id = await run(w);
      expect(await feedback(w, id, { text: "x", anchors: [{}] })).toMatchObject({ state: "rejected", reason: "flow-message-invalid:anchors" });
      expect(await feedback(w, id, { text: "x", hit: 1 })).toMatchObject({ state: "rejected", reason: "flow-message-invalid:hit needs replaces" });
      expect(await feedback(w, id, { text: "x", replaces: 99 })).toMatchObject({ state: "rejected", reason: "flow-message-invalid:replaces" });
      expect(await feedback(w, id, { text: "x", attachments: [`${"a".repeat(64)}.png`] })).toMatchObject({ state: "rejected", reason: `flow-attachment-invalid:${"a".repeat(64)}.png` });
      // A plain step feedback with no anchor behaves as before: no intake.
      const plain = await feedback(w, id, { text: "shorter" }, { kind: "step", stepKey: "polish" });
      expect(getIntake(w.store, id, plain.seq)).toBeNull();
    } finally { await w.dispose(); }
  });
});
