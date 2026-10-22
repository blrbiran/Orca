/**
 * Gaps spec §5.1-§5.4, §5.6, §17 G3 (fake clock): the re-run proposal may mark a candidate `unsure`. Under `auto` (the
 * built-in default) such a step becomes a pending question with a deadline (askedAt + `flows.rerunAskTimeoutSeconds`,
 * project > global > 300 s, resolved when asked); everything else in the plan runs at once except the steps after the
 * pending one in template order (they depend on it -- phase 1 has no read sets), while its `parallelWith` sibling runs.
 * At the deadline the answer is "accept as unchanged" by orca-auto -- never "run" -- with one minor decision. Nothing
 * else times out: an effect's confirm card keeps waiting however old it is. A newer plan carries a still-pending
 * question over with a FRESH deadline.
 */
import { describe, expect, it } from "vitest";
import { orchestrationRevision, writeOrchestrationSettings } from "../../src/control/orchestration.js";
import { writeRepositorySettingsBody } from "../../src/control/workspaceSettings.js";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { acceptMessage } from "../../src/flow/messages.js";
import { planStep } from "../../src/flow/planStep.js";
import { runPlan } from "../../src/flow/rerun.js";
import { getFlowRun, listEffects, listPlans } from "../../src/flow/store.js";
import { fakeChildPort } from "./fixtures/childPort.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const TPL = { t: { yaml: `format: orca-flow-v1
id: t
workspace: {kind: dir}
effects:
  wechat-draft: {class: external}
steps:
  - {id: voice, kind: draft, prompt: voice.md}
  - {id: article, kind: draft, prompt: article.md}
  - {id: cover, kind: draft, prompt: cover.md, parallelWith: article}
  - {id: to-draft-box, kind: work, prompt: box.md, effect: wechat-draft}
`, assets: { "voice.md": "Voice.\n", "article.md": "Article.\n", "cover.md": "Cover.\n", "box.md": "Box.\n" } } };
const Q = "Does the warmer voice change what the cover should show?";
const T0 = 50_000_000;
const MIN = 60_000;

interface Pending { stepKey: string; question: string; askedAt: number; deadline: number; answer: null | Record<string, unknown> }
interface Chosen { steps: string[]; pending?: Pending[]; accepted?: Array<Record<string, unknown>> }

/** A finished run (the draft box applied), then the external effect set to `confirm` for what follows. */
async function finished(opts: { projectId?: string } = {}) {
  const children = fakeChildPort();
  const w = await flowWorld(TPL, { children: children.port });
  const clock = { now: T0 };
  w.deps.now = () => clock.now;
  const { flowRunId } = await w.start({ templateRef: "builtin/t", ...(opts.projectId === undefined ? {} : { projectId: opts.projectId }) });
  await w.advance();
  const call = (stepKey: string, seq: number) => w.calls.findIndex((c) => c.key.stepKey === stepKey && c.key.seq === seq);
  await w.answer(call("voice", 1), { content: "voice 1" });
  await w.answer(call("article", 1), { content: "article 1" });
  await w.answer(call("cover", 1), { content: "cover 1" });
  children.land(childGroupIdOf(flowRunId, "to-draft-box", 1), { "sent.json": "{}\n" }, { flow: { effect: { remoteId: "media-1" } } });
  await w.advance();
  expect(getFlowRun(w.store, flowRunId)!.state).toBe("done");
  w.store.transaction(() => writeOrchestrationSettings(w.store, { maxRunningGroups: 3, flows: { effects: { external: "confirm" } } }, orchestrationRevision(w.store) + 1));
  const feedback = (stepKey: string, text: string, requestId: string) =>
    acceptMessage(w.deps, flowRunId, { kind: "feedback", target: { kind: "step", stepKey }, body: { text }, by: "ann", via: "cli:test", requestId });
  const proposalCall = () => w.calls.map((c) => c.purpose).lastIndexOf("rerun-proposal");
  const plan = (planNo: number) => listPlans(w.store, flowRunId).find((p) => p.planNo === planNo)!;
  const decisions = () => (w.store.db.prepare("SELECT grade, step_key, body, \"by\" FROM flow_decisions WHERE flow_run_id=? ORDER BY seq").all(flowRunId) as Array<{ grade: string; step_key: string; body: string; by: string }>)
    .map((r) => ({ grade: r.grade, stepKey: r.step_key, by: r.by, body: JSON.parse(r.body) as Record<string, unknown> }));
  return { w, children, clock, flowRunId, call, feedback, proposalCall, plan, decisions };
}

/** Feedback on voice; the proposal marks cover unsure; voice and article (cover's parallel sibling) re-run. */
async function coverPending(opts: { projectId?: string } = {}) {
  const world = await finished(opts);
  const { w, clock, call, feedback, proposalCall, plan } = world;
  await feedback("voice", "warmer", "fb-1");
  await w.answer(proposalCall(), { skips: [], unsure: [{ stepKey: "cover", question: Q }] });
  expect(plan(1).state).toBe("running");
  expect(call("voice", 2)).toBeGreaterThan(-1);
  clock.now = T0 + 1_000;
  await w.answer(call("voice", 2), { content: "voice 2" });
  await w.answer(call("article", 2), { content: "article 2" });
  return world;
}

describe("unsure candidates become pending questions (§5.2, §5.4)", () => {
  it("cover pending with deadline = now + 300 s; the step before it and its parallel sibling run; to-draft-box waits", async () => {
    const { w, flowRunId, call, plan } = await coverPending(); try {
      const chosen = plan(1).chosen as Chosen;
      // Only the step the model listed is a question; the others run (absence is never uncertainty).
      expect(chosen.pending).toEqual([{ stepKey: "cover", question: Q, askedAt: T0, deadline: T0 + 300_000, answer: null }]);
      expect(chosen.steps).toEqual(["voice", "article", "to-draft-box"]);
      expect(w.latest(flowRunId, "voice")).toMatchObject({ seq: 2, state: "done" });
      expect(w.latest(flowRunId, "article")).toMatchObject({ seq: 2, state: "done" });
      expect(call("cover", 2)).toBe(-1);
      expect(w.execs(flowRunId, "cover")).toHaveLength(1);
      // to-draft-box depends on cover in this template: it waits while the question is open.
      expect(w.execs(flowRunId, "to-draft-box")).toHaveLength(1);
      expect(getFlowRun(w.store, flowRunId)!.state).toBe("running");
    } finally { await w.dispose(); }
  });

  it("at the deadline: accept-unchanged by orca-auto, one minor decision, cover carried forward, to-draft-box proceeds to its card", async () => {
    const { w, clock, flowRunId, call, plan, decisions } = await coverPending(); try {
      clock.now = T0 + 300_000 - 1;
      await w.advance();
      expect((plan(1).chosen as Chosen).pending![0]!.answer).toBeNull();
      expect(w.execs(flowRunId, "to-draft-box")).toHaveLength(1);
      clock.now = T0 + 300_000;
      await w.advance();
      expect((plan(1).chosen as Chosen).pending![0]!.answer).toEqual({ choice: "accept-unchanged", by: "orca-auto", via: "orca", at: T0 + 300_000, source: "timeout" });
      expect(decisions()).toEqual([{ grade: "minor", stepKey: "cover", by: "orca-auto", body: { kind: "rerun-unsure-timeout", planNo: 1, stepKey: "cover", question: Q, deadline: T0 + 300_000 } }]);
      // Not re-run: no new cover call; a carried-forward execution keeps cover's output and records what it stands for now.
      expect(call("cover", 2)).toBe(-1);
      const carried = w.latest(flowRunId, "cover")!;
      expect(carried).toMatchObject({ seq: 2, state: "skipped", planNo: 1 });
      expect(carried.body).toMatchObject({ carriedForward: 1, acceptedUnchanged: { by: "orca-auto", via: "orca", source: "timeout" } });
      expect((carried.body as { ranOnInputs?: { earlier: Array<{ stepKey: string }> } }).ranOnInputs?.earlier.map((e) => e.stepKey)).toEqual(["voice"]);
      // to-draft-box went on, to its effect's confirm card (the timeout never runs an external effect).
      expect(w.latest(flowRunId, "to-draft-box")).toMatchObject({ seq: 2, state: "needs-person" });
      expect((w.latest(flowRunId, "to-draft-box")!.body as { ask?: { kind: string } }).ask?.kind).toBe("effect-confirm");
    } finally { await w.dispose(); }
  });

  it("an effect confirm card older than the timeout is still waiting (only pending questions time out)", async () => {
    const { w, clock, flowRunId, decisions } = await coverPending(); try {
      clock.now = T0 + 300_000;
      await w.advance();
      const record = listEffects(w.store, flowRunId).at(-1)!;
      expect(record.state).toBe("staged");
      clock.now = T0 + 300_000 + 24 * 60 * MIN;
      await w.advance();
      await w.advance();
      expect(w.latest(flowRunId, "to-draft-box")).toMatchObject({ seq: 2, state: "needs-person" });
      expect(listEffects(w.store, flowRunId).find((r) => r.id === record.id)!.state).toBe("staged");
      expect(decisions()).toHaveLength(1);
    } finally { await w.dispose(); }
  });

  it("resolves an overdue pending question once after a restart", async () => {
    const { w, clock, flowRunId, decisions } = await coverPending(); try {
      // The panel was down past the deadline: no pass ran. The next passes resolve it exactly once.
      clock.now = T0 + 300_000 + 45 * MIN;
      await w.advance();
      await w.advance();
      expect(decisions().filter((d) => d.body.kind === "rerun-unsure-timeout")).toHaveLength(1);
      expect(w.execs(flowRunId, "cover").filter((e) => (e.body as { acceptedUnchanged?: unknown }).acceptedUnchanged !== undefined)).toHaveLength(1);
    } finally { await w.dispose(); }
  });

  it("include (flow-plan-step run): cover runs, and the answer is the person's", async () => {
    const { w, clock, flowRunId, call, plan } = await coverPending(); try {
      clock.now = T0 + 2 * MIN;
      expect(await planStep(w.deps, { flowRunId, planNo: 1, stepKey: "cover", choice: "run", by: "ann", via: "cli:test" })).toEqual({ result: "flow-plan-step-applied" });
      const chosen = plan(1).chosen as Chosen;
      expect(chosen.pending![0]!.answer).toEqual({ choice: "run", by: "ann", via: "cli:test", at: T0 + 2 * MIN, source: "person" });
      expect(chosen.steps).toEqual(["voice", "article", "cover", "to-draft-box"]);
      expect(call("cover", 2)).toBeGreaterThan(-1);
      // A later deadline does nothing to an answered question.
      clock.now = T0 + 10 * MIN;
      await w.advance();
      expect(w.store.db.prepare("SELECT count(*) AS n FROM flow_decisions WHERE flow_run_id=?").get(flowRunId)!.n).toBe(0);
    } finally { await w.dispose(); }
  });
});

describe("the timeout setting (§5.3): project > global > 300 s, resolved when asked", () => {
  it("project 600 over global 120 ⇒ 600; a run without a project takes the global 120", async () => {
    const world = await finished({ projectId: "repo" });
    const { w, clock, feedback, proposalCall, plan, flowRunId } = world; try {
      w.store.transaction(() => {
        writeOrchestrationSettings(w.store, { maxRunningGroups: 3, flows: { effects: { external: "confirm" }, rerunAskTimeoutSeconds: 120 } }, orchestrationRevision(w.store) + 1);
        writeRepositorySettingsBody(w.store, "repo", { workspaceMode: "worktree", revision: 1, flows: { rerunAskTimeoutSeconds: 600 } });
      });
      await feedback("voice", "warmer", "fb-1");
      await w.answer(proposalCall(), { skips: [], unsure: [{ stepKey: "cover", question: Q }] });
      expect((plan(1).chosen as Chosen).pending![0]).toMatchObject({ askedAt: T0, deadline: T0 + 600_000 });
      // Changing the setting later moves no existing deadline.
      w.store.transaction(() => writeRepositorySettingsBody(w.store, "repo", { workspaceMode: "worktree", revision: 2, flows: { rerunAskTimeoutSeconds: 30 } }));
      clock.now = T0 + 60_000;
      await w.advance();
      expect((plan(1).chosen as Chosen).pending![0]).toMatchObject({ deadline: T0 + 600_000, answer: null });
      expect(getFlowRun(w.store, flowRunId)!.state).toBe("running");
    } finally { await w.dispose(); }
    const other = await finished();
    try {
      other.w.store.transaction(() => writeOrchestrationSettings(other.w.store, { maxRunningGroups: 3, flows: { effects: { external: "confirm" }, rerunAskTimeoutSeconds: 120 } }, orchestrationRevision(other.w.store) + 1));
      await other.feedback("voice", "warmer", "fb-1");
      await other.w.answer(other.proposalCall(), { skips: [], unsure: [{ stepKey: "cover", question: Q }] });
      expect((other.plan(1).chosen as Chosen).pending![0]).toMatchObject({ askedAt: T0, deadline: T0 + 120_000 });
    } finally { await other.w.dispose(); }
  });
});

describe("code bounds what may be unsure (§5.1): an invalid mark takes the retry path", () => {
  it("unsure on the feedback-targeted step is invalid: the proposal is asked again, nothing is pending", async () => {
    const { w, feedback, proposalCall, plan } = await finished(); try {
      await feedback("voice", "warmer", "fb-1");
      const first = proposalCall();
      await w.answer(first, { skips: [], unsure: [{ stepKey: "voice", question: Q }] });
      expect(proposalCall()).toBeGreaterThan(first);
      expect(w.calls[proposalCall()]!.prompt).toContain("voice has feedback or fill; it may not be unsure");
      expect(plan(1)).toMatchObject({ state: "proposed", chosen: null });
    } finally { await w.dispose(); }
  });

  it("unsure on a never-succeeded step is invalid", async () => {
    const children = fakeChildPort();
    const w = await flowWorld(TPL, { children: children.port }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t" });
      await w.advance();
      const call = (stepKey: string) => w.calls.findIndex((c) => c.key.stepKey === stepKey);
      for (const key of ["voice", "article", "cover"]) await w.answer(call(key), { content: `${key} 1` });
      children.fail(childGroupIdOf(flowRunId, "to-draft-box", 1), "no draft box");
      await w.advance();
      expect(w.latest(flowRunId, "to-draft-box")).toMatchObject({ state: "failed" });
      await acceptMessage(w.deps, flowRunId, { kind: "feedback", target: { kind: "step", stepKey: "voice" }, body: { text: "warmer" }, by: "ann", via: "cli:test", requestId: "fb-1" });
      const first = w.calls.map((c) => c.purpose).lastIndexOf("rerun-proposal");
      await w.answer(first, { skips: [], unsure: [{ stepKey: "to-draft-box", question: Q }] });
      const again = w.calls.map((c) => c.purpose).lastIndexOf("rerun-proposal");
      expect(again).toBeGreaterThan(first);
      expect(w.calls[again]!.prompt).toContain("to-draft-box never succeeded; there is no output to keep");
    } finally { await w.dispose(); }
  });

  it("the proposal prompt tells the model when to mark a step unsure", async () => {
    const { w, feedback, proposalCall } = await finished(); try {
      await feedback("voice", "warmer", "fb-1");
      const prompt = w.calls[proposalCall()]!.prompt;
      expect(prompt).toContain("\"unsure\"");
      expect(prompt).toMatch(/mark .*unsure.* only when/i);
    } finally { await w.dispose(); }
  });
});

describe("under rerunReview: review nothing has a deadline (§5.2)", () => {
  it("the plan waits for the person; the unsure mark is shown, ticked, with no pending item; time does nothing", async () => {
    const { w, clock, flowRunId, feedback, proposalCall, plan, decisions, call } = await finished(); try {
      w.deps.rerunReview = () => "review";
      await feedback("voice", "warmer", "fb-1");
      await w.answer(proposalCall(), { skips: [], unsure: [{ stepKey: "cover", question: Q }] });
      expect(plan(1)).toMatchObject({ state: "proposed", chosen: null, proposal: { unsure: [{ stepKey: "cover", question: Q }] } });
      clock.now = T0 + 24 * 60 * MIN;
      await w.advance();
      expect(plan(1).state).toBe("proposed");
      expect(decisions()).toEqual([]);
      await runPlan(w.deps, flowRunId, 1, {}, "ann", "cli:test");
      const chosen = plan(1).chosen as Chosen;
      expect(chosen.steps).toEqual(["voice", "article", "cover", "to-draft-box"]);
      expect(chosen.pending ?? []).toEqual([]);
      expect(call("voice", 2)).toBeGreaterThan(-1);
    } finally { await w.dispose(); }
  });
});

describe("a newer plan replaces an open one (§5.6): a pending question carries over with a fresh deadline", () => {
  it.each([
    ["not skipped by the new proposal: the old question", { skips: [] }, Q],
    ["marked unsure again: the new proposal's question", { skips: [], unsure: [{ stepKey: "cover", question: "Still keep the cover?" }] }, "Still keep the cover?"],
  ])("%s", async (_name, proposal, question) => {
    const { w, clock, flowRunId, feedback, proposalCall, plan } = await coverPending(); try {
      clock.now = T0 + 200_000;
      await feedback("voice", "cooler after all", "fb-2");
      expect(plan(1).state).toBe("abandoned");
      // The abandoned plan keeps its record: the question was never answered.
      expect((plan(1).chosen as Chosen).pending).toEqual([{ stepKey: "cover", question: Q, askedAt: T0, deadline: T0 + 300_000, answer: null }]);
      await w.answer(proposalCall(), proposal);
      const chosen = plan(2).chosen as Chosen;
      expect(chosen.pending).toEqual([{ stepKey: "cover", question, askedAt: T0 + 200_000, deadline: T0 + 200_000 + 300_000, answer: null }]);
      expect(chosen.steps).not.toContain("cover");
      // The old deadline (T0 + 300 s) passing does nothing: only the fresh one counts.
      clock.now = T0 + 300_000 + 1;
      await w.advance();
      expect((plan(2).chosen as Chosen).pending![0]!.answer).toBeNull();
      expect(w.execs(flowRunId, "cover")).toHaveLength(1);
    } finally { await w.dispose(); }
  });

  it("a skip in the new proposal does not keep the old question", async () => {
    const { w, clock, feedback, proposalCall, plan } = await coverPending(); try {
      clock.now = T0 + 200_000;
      await feedback("voice", "cooler after all", "fb-2");
      await w.answer(proposalCall(), { skips: [{ stepKey: "cover", reason: "the cover does not show the voice" }] });
      expect((plan(2).chosen as Chosen).pending ?? []).toEqual([]);
      expect((plan(2).chosen as Chosen).steps).not.toContain("cover");
    } finally { await w.dispose(); }
  });
});
