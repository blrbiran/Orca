/**
 * Live transcript spec §10.5.2 (plan T5): the operator note. A `note` command aimed at one running work step is taken
 * mid-run: its shape and target are checked when it arrives (no running child → `flow-note-no-running-work`; the joined
 * text over 4096 UTF-8 bytes → `flow-note-too-large`), person authority is enforced when it is applied, and it is
 * recorded on the receiving execution's body as `operatorNotes` -- never in `ranOnInputs`. A run already waiting on a
 * pause records only; otherwise the accept sets a `noteIntent` (the delivery stop it owes is T6's).
 */
import { describe, expect, it } from "vitest";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import type { ControlStore } from "../../src/control/store.js";
import { advanceRun, appendQueued, loadRun, ranOnInputsOf } from "../../src/flow/kernel.js";
import type { ExecutionBody, FlowRunBody } from "../../src/flow/kinds/registry.js";
import { childGroupIdOf, type FlowChildPort } from "../../src/flow/kinds/work.js";
import { acceptMessage, type FlowMessageInput } from "../../src/flow/messages.js";
import { appendMessage, getFlowRun, listExecutions, listMessages } from "../../src/flow/store.js";
import { fakeChildPort } from "./fixtures/fakeChildPort.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const TIMEOUT_MS = 3_600_000;
const TPL = { t: { yaml: `format: orca-flow-v1
id: t
workspace: {kind: dir}
steps:
  - {id: write, kind: work, prompt: p.md}
`, assets: { "p.md": "Write.\n" } } };
const TARGET = { kind: "step", stepKey: "write" } as const;

type World = Awaited<ReturnType<typeof flowWorld>>;
const runOf = (w: World, flowRunId: string): FlowRunBody => getFlowRun(w.store, flowRunId)!.body as FlowRunBody;
const stateOf = (w: World, flowRunId: string): string => getFlowRun(w.store, flowRunId)!.state;
const notesOf = (w: World, flowRunId: string, seq = 1) => (w.latest(flowRunId, "write")!.body as ExecutionBody).operatorNotes ?? [];
const message = (over: Omit<Partial<FlowMessageInput>, "body"> & { body: Record<string, unknown> }): FlowMessageInput =>
  ({ kind: "command", target: { kind: "run" }, by: "ann", via: "web", requestId: `r-${Math.random()}`, ...over });
const note = (text: string, scope: "next-attempt" | "remaining-attempts" = "next-attempt", personAuthority = true): FlowMessageInput =>
  message({ target: TARGET, body: { command: "note", text, scope }, ...(personAuthority ? { personAuthority: true } : {}) });

/**
 * The T2 fake records calls but opens no child group; `step_executions.child_group_id` and the pool draw reference
 * `groups`, so the test binds it to the world's store and writes the child row its `open` stands for.
 */
function boundPort(child: ReturnType<typeof fakeChildPort>, store: ControlStore): FlowChildPort {
  return {
    ...child.port,
    async open(request) {
      await child.port.open(request);
      store.db.prepare("INSERT INTO groups(id,revision,graph_version,projection_seq,body) VALUES (?,0,1,0,?) ON CONFLICT(id) DO NOTHING")
        .run(request.childGroupId, JSON.stringify({ groupId: request.childGroupId, flow: { role: "child" } }));
    },
  };
}

async function world() {
  const child = fakeChildPort({ timeoutMs: TIMEOUT_MS });
  const w = await flowWorld(TPL, { children: (store) => boundPort(child, store), files: { "notes.txt": "n\n" } });
  return { w, child };
}

/** Start the run and advance it so the work step's child is open and running. */
async function started() {
  const { w, child } = await world();
  const { flowRunId } = await w.start({ templateRef: "builtin/t" });
  await w.advance();
  const childGroupId = childGroupIdOf(flowRunId, "write", 1);
  expect(w.latest(flowRunId, "write")).toMatchObject({ state: "running", childGroupId });
  return { w, child, flowRunId, childGroupId };
}

describe("operator note (§10.5.2)", () => {
  it("a note is applied at once: recorded on the body and a noteIntent with the contract deadline", async () => {
    const { w, child, flowRunId, childGroupId } = await started(); try {
      const accepted = await acceptMessage(w.deps, flowRunId, note("please also update the changelog"));
      expect(accepted.state).toBe("applied");
      expect(stateOf(w, flowRunId)).toBe("running");
      expect(w.latest(flowRunId, "write")!.state).toBe("running");
      const recorded = notesOf(w, flowRunId);
      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({ seq: accepted.seq, by: "ann", text: "please also update the changelog", scope: "next-attempt" });
      expect(recorded[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      const intent = runOf(w, flowRunId).noteIntent!;
      expect(Object.keys(intent)).toEqual(["steps"]);
      const step = intent.steps[0]!;
      expect(step).toMatchObject({ stepKey: "write", seq: 1, childGroupId, acceptedAt: recorded[0]!.at });
      expect(Object.keys(step).sort()).toEqual(["acceptedAt", "childGroupId", "deadlineAt", "seq", "stepKey"]);
      expect(Date.parse(step.deadlineAt) - Date.parse(step.acceptedAt)).toBe(TIMEOUT_MS + 60_000);
      // T6: the accept's own pass issues the delivery stop, the same boundary a pause uses.
      expect(child.stops).toMatchObject([{ childGroupId, flowStop: { flowRunId, stepKey: "write", seq: 1, reason: "note" } }]);
    } finally { await w.dispose(); }
  });

  it("a note to a step with no running work child is refused flow-note-no-running-work", async () => {
    const { w, child } = await world(); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t" });
      expect(w.execs(flowRunId)).toHaveLength(0);
      const rejected = await acceptMessage(w.deps, flowRunId, note("hello"));
      expect(rejected).toMatchObject({ state: "rejected", reason: "flow-note-no-running-work" });
      expect(runOf(w, flowRunId).noteIntent).toBeUndefined();
      expect(listMessages(w.store, flowRunId).map((m) => m.state)).toEqual(["rejected"]);
      expect(child.stops).toHaveLength(0);
    } finally { await w.dispose(); }
  });

  it("a note with an unknown attempt timeout is refused at accept with the step named; nothing is recorded", async () => {
    const child = fakeChildPort({ timeoutMs: null });
    const w = await flowWorld(TPL, { children: (store) => boundPort(child, store), files: { "notes.txt": "n\n" } });
    try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t" });
      await w.advance();
      expect(w.latest(flowRunId, "write")).toMatchObject({ state: "running" });
      const rejected = await acceptMessage(w.deps, flowRunId, note("hello"));
      expect(rejected).toMatchObject({ state: "rejected", reason: "flow-pause-timeout-unknown:write" });
      expect(notesOf(w, flowRunId)).toHaveLength(0);
      expect(runOf(w, flowRunId).noteIntent).toBeUndefined();
      expect(child.stops).toHaveLength(0);
    } finally { await w.dispose(); }
  });

  it("two notes whose joined text passes 4096 bytes: the second is refused flow-note-too-large", async () => {
    const { w, flowRunId } = await started(); try {
      const first = await acceptMessage(w.deps, flowRunId, note("x".repeat(3000)));
      expect(first.state).toBe("applied");
      const second = await acceptMessage(w.deps, flowRunId, note("x".repeat(3000)));
      expect(second).toMatchObject({ state: "rejected", reason: "flow-note-too-large" });
      expect(notesOf(w, flowRunId)).toHaveLength(1);
    } finally { await w.dispose(); }
  });

  it("the joined cap is checked again when a note is applied, not only when it arrives", async () => {
    const { w, flowRunId } = await started(); try {
      await acceptMessage(w.deps, flowRunId, note("x".repeat(3000)));
      appendMessage(w.store, {
        flowRunId, requestId: "arrived-before-the-first-note", kind: "command", target: "step",
        body: { command: "note", text: "y".repeat(3000), scope: "next-attempt", personAuthority: true, target: TARGET },
        by: "ann", via: "web", state: "accepted", reason: null, at: w.deps.now(),
      });
      await w.advance();
      expect(listMessages(w.store, flowRunId).at(-1)).toMatchObject({ state: "rejected", reason: "flow-note-too-large" });
      expect(notesOf(w, flowRunId)).toHaveLength(1);
    } finally { await w.dispose(); }
  });

  it("the joined cap is measured in UTF-8 bytes, not JS string length", async () => {
    const { w, flowRunId } = await started(); try {
      // Each note passes its own 4096-byte shape; the join (3900 CJK bytes + \n + 400) is 4301 bytes but 1701 JS units.
      const first = await acceptMessage(w.deps, flowRunId, note("更".repeat(1300)));
      expect(first.state).toBe("applied");
      const second = await acceptMessage(w.deps, flowRunId, note("x".repeat(400)));
      expect(second).toMatchObject({ state: "rejected", reason: "flow-note-too-large" });
      expect(notesOf(w, flowRunId)).toHaveLength(1);
    } finally { await w.dispose(); }
  });

  it("a note without person authority is refused when it is applied and records nothing", async () => {
    const { w, flowRunId } = await started(); try {
      const rejected = await acceptMessage(w.deps, flowRunId, note("hello", "next-attempt", false));
      expect(rejected.state).toBe("rejected");
      expect(rejected.reason).toMatch(/^flow-command-needs-person/);
      expect(notesOf(w, flowRunId)).toHaveLength(0);
      expect(runOf(w, flowRunId).noteIntent).toBeUndefined();
    } finally { await w.dispose(); }
  });

  it("a note never enters ranOnInputs: identical bytes before and after", async () => {
    const { w, flowRunId } = await started(); try {
      const before = ranOnInputsOf(w.store, loadRun(w.store, flowRunId), "write");
      const beforeBytes = canonicalBytes(before);
      const beforeHash = sha256Canonical(before);
      const text = "please also update the changelog";
      const accepted = await acceptMessage(w.deps, flowRunId, note(text));
      expect(accepted.state).toBe("applied");
      const after = ranOnInputsOf(w.store, loadRun(w.store, flowRunId), "write");
      expect(canonicalBytes(after).equals(beforeBytes)).toBe(true);
      expect(sha256Canonical(after)).toBe(beforeHash);
      const body = w.latest(flowRunId, "write")!.body as ExecutionBody;
      expect(JSON.stringify(body.ranOnInputs)).not.toContain(text);
      expect(notesOf(w, flowRunId).map((entry) => entry.text)).toEqual([text]);
    } finally { await w.dispose(); }
  });

  it("a new execution of the step starts with no notes", async () => {
    const { w, flowRunId } = await started(); try {
      await acceptMessage(w.deps, flowRunId, note("please also update the changelog"));
      expect(notesOf(w, flowRunId)).toHaveLength(1);
      appendQueued(w.deps, loadRun(w.store, flowRunId), "write", 2, ["retry"], {}, "ann", "web", w.deps.now());
      const next = listExecutions(w.store, flowRunId).find((e) => e.stepKey === "write" && e.seq === 2)!;
      expect(next.state).toBe("queued");
      expect((next.body as ExecutionBody).operatorNotes).toBeUndefined();
    } finally { await w.dispose(); }
  });

  it("a note accepted while the run is paused is recorded on the body and sets no noteIntent", async () => {
    const { w, flowRunId } = await started(); try {
      const paused = await acceptMessage(w.deps, flowRunId, message({ body: { command: "pause" }, pauseAuthority: true }));
      expect(paused.state).toBe("applied");
      expect(stateOf(w, flowRunId)).toBe("paused");
      const accepted = await acceptMessage(w.deps, flowRunId, note("one more thing", "remaining-attempts"));
      expect(accepted.state).toBe("applied");
      expect(notesOf(w, flowRunId)).toMatchObject([{ seq: accepted.seq, text: "one more thing", scope: "remaining-attempts" }]);
      expect(runOf(w, flowRunId).noteIntent).toBeUndefined();
      expect(runOf(w, flowRunId).pauseIntent!.steps).toHaveLength(1);
    } finally { await w.dispose(); }
  });

  it("a note stop completes and the resume delivers it through a continuation carrying the joined note", async () => {
    const { w, child, flowRunId, childGroupId } = await started(); try {
      const text = "please also update the changelog";
      const accepted = await acceptMessage(w.deps, flowRunId, note(text));
      expect(accepted.state).toBe("applied");
      const intent = runOf(w, flowRunId).noteIntent!;
      expect(intent.steps).toHaveLength(1);
      await w.advance();
      expect(child.stops).toHaveLength(1);
      expect(child.stops[0]).toMatchObject({
        childGroupId, acceptedAt: intent.steps[0]!.acceptedAt, deadlineAt: intent.steps[0]!.deadlineAt,
        flowStop: { flowRunId, stepKey: "write", seq: 1, reason: "note" },
      });
      child.completeStop(childGroupId);
      await w.advance();
      expect(child.resumes).toHaveLength(1);
      expect(child.resumes[0]!.children).toEqual([{
        childGroupId, flowStop: { flowRunId, stepKey: "write", seq: 1, reason: "note" },
        operatorNote: { text, scope: "next-attempt" },
      }]);
      expect(child.resumes[0]!.result).toEqual([{ childGroupId, pendingRunId: `run-${childGroupId}` }]);
      expect(runOf(w, flowRunId).noteIntent).toBeUndefined();
      expect(stateOf(w, flowRunId)).toBe("running");
      expect(w.latest(flowRunId, "write")!.state).toBe("running");
      expect(notesOf(w, flowRunId)[0]).toMatchObject({ text, scope: "next-attempt", deliveredTo: [`run-${childGroupId}`] });
    } finally { await w.dispose(); }
  });

  it("two notes join in message order and a remaining-attempts note wins the scope", async () => {
    const { w, child, flowRunId, childGroupId } = await started(); try {
      const first = await acceptMessage(w.deps, flowRunId, note("first"));
      const second = await acceptMessage(w.deps, flowRunId, note("second", "remaining-attempts"));
      expect([first.state, second.state]).toEqual(["applied", "applied"]);
      expect(runOf(w, flowRunId).noteIntent!.steps).toHaveLength(1);
      child.completeStop(childGroupId);
      await w.advance();
      expect(child.resumes).toHaveLength(1);
      expect(child.resumes[0]!.children[0]!.operatorNote).toEqual({ text: "first\nsecond", scope: "remaining-attempts" });
    } finally { await w.dispose(); }
  });

  it("a delivered next-attempt note is not re-sent; a remaining-attempts note is", async () => {
    const { w, child, flowRunId, childGroupId } = await started(); try {
      await acceptMessage(w.deps, flowRunId, note("one-off"));
      await acceptMessage(w.deps, flowRunId, note("keep me", "remaining-attempts"));
      child.completeStop(childGroupId);
      await w.advance();
      expect(child.resumes[0]!.children[0]!.operatorNote).toEqual({ text: "one-off\nkeep me", scope: "remaining-attempts" });
      const accepted = await acceptMessage(w.deps, flowRunId, note("and this"));
      expect(accepted.state).toBe("applied");
      await w.advance();
      expect(child.resumes).toHaveLength(2);
      expect(child.resumes[1]!.children[0]!.operatorNote).toEqual({ text: "keep me\nand this", scope: "remaining-attempts" });
    } finally { await w.dispose(); }
  });

  it("a restartable note resume continues with no continuation and consumes the note", async () => {
    const { w, child, flowRunId, childGroupId } = await started(); try {
      const accepted = await acceptMessage(w.deps, flowRunId, note("one-off"));
      expect(accepted.state).toBe("applied");
      child.completeStop(childGroupId, { recoverable: false });
      await w.advance();
      expect(child.resumes).toHaveLength(1);
      expect(child.resumes[0]!.result).toEqual([{ childGroupId, pendingRunId: null }]);
      expect(runOf(w, flowRunId).noteIntent).toBeUndefined();
      expect(stateOf(w, flowRunId)).toBe("running");
      const recorded = notesOf(w, flowRunId)[0]!;
      expect(recorded.deliveredTo).toBeUndefined();
      expect(recorded.consumedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    } finally { await w.dispose(); }
  });

  it("a restartable note resume consumes only the next-attempt note; a remaining-attempts note stays pending", async () => {
    const { w, child, flowRunId, childGroupId } = await started(); try {
      await acceptMessage(w.deps, flowRunId, note("one-off"));
      await acceptMessage(w.deps, flowRunId, note("keep me", "remaining-attempts"));
      child.completeStop(childGroupId, { recoverable: false });
      await w.advance();
      expect(child.resumes).toHaveLength(1);
      const [oneOff, keep] = notesOf(w, flowRunId);
      expect(oneOff!.consumedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(keep).toMatchObject({ text: "keep me", scope: "remaining-attempts" });
      expect(keep!.consumedAt).toBeUndefined();
      expect(keep!.deliveredTo).toBeUndefined();
    } finally { await w.dispose(); }
  });

  it("a budget refusal keeps the intent and its error, and the next pass delivers", async () => {
    const { w, child, flowRunId, childGroupId } = await started(); try {
      await acceptMessage(w.deps, flowRunId, note("please retry"));
      child.completeStop(childGroupId);
      child.failResume(childGroupId, "continuation-budget-unavailable");
      await advanceRun(w.deps, flowRunId);
      expect(runOf(w, flowRunId).noteIntent!.steps).toHaveLength(1);
      expect(runOf(w, flowRunId).lastError!.message).toMatch(/^continuation-budget-unavailable:/);
      expect(child.resumes).toHaveLength(0);
      expect(notesOf(w, flowRunId)[0]!.deliveredTo).toBeUndefined();
      child.clearResumeFailure(childGroupId);
      await advanceRun(w.deps, flowRunId);
      expect(runOf(w, flowRunId).noteIntent).toBeUndefined();
      expect(child.resumes).toHaveLength(1);
      expect(notesOf(w, flowRunId)[0]!.deliveredTo).toEqual([`run-${childGroupId}`]);
    } finally { await w.dispose(); }
  });

  it("a pump pass keeps the diagnostic it recorded until the next pass starts", async () => {
    const { w, child, flowRunId, childGroupId } = await started(); try {
      await acceptMessage(w.deps, flowRunId, note("please retry"));
      child.completeStop(childGroupId);
      child.failResume(childGroupId, "continuation-budget-unavailable");
      await w.advance();
      expect(runOf(w, flowRunId).lastError!.message).toMatch(/^continuation-budget-unavailable:flow-/);
      expect(runOf(w, flowRunId).noteIntent!.steps).toHaveLength(1);
      child.clearResumeFailure(childGroupId);
      await w.advance();
      expect(runOf(w, flowRunId).lastError).toBeUndefined();
      expect(runOf(w, flowRunId).noteIntent).toBeUndefined();
    } finally { await w.dispose(); }
  });

  it("a note recorded during a pause is delivered by the resume message", async () => {
    const { w, child, flowRunId, childGroupId } = await started(); try {
      const paused = await acceptMessage(w.deps, flowRunId, message({ body: { command: "pause" }, pauseAuthority: true }));
      expect(paused.state).toBe("applied");
      const accepted = await acceptMessage(w.deps, flowRunId, note("after the pause"));
      expect(accepted.state).toBe("applied");
      expect(runOf(w, flowRunId).noteIntent).toBeUndefined();
      child.completeStop(childGroupId);
      const resumed = await acceptMessage(w.deps, flowRunId, message({ body: { command: "resume" }, personAuthority: true }));
      expect(resumed.state).toBe("applied");
      expect(child.resumes).toHaveLength(1);
      expect(child.resumes[0]!.children[0]).toEqual({
        childGroupId, flowStop: { flowRunId, stepKey: "write", seq: 1, reason: "pause" },
        operatorNote: { text: "after the pause", scope: "next-attempt" },
      });
      expect(runOf(w, flowRunId).pauseIntent).toBeUndefined();
      expect(stateOf(w, flowRunId)).toBe("running");
      expect(notesOf(w, flowRunId)[0]!.deliveredTo).toEqual([`run-${childGroupId}`]);
    } finally { await w.dispose(); }
  });
});