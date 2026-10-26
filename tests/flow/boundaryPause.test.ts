/**
 * Live transcript spec §10.5.1 (plan T4): a pause taken while a work step runs. The message is applied at once (not at a
 * boundary), recorded as `pauseIntent` on the run, and each running work child is stopped through the child port with a
 * deadline of the contract's per-attempt timeout plus one minute. The execution stays `running`; the run shows `paused`.
 * A resume needs every child's stop complete: a recoverable child registers a continuation, a restartable one is
 * dispatched again; nothing is lifted while a stop is pending, and a budget refusal leaves the intent in place.
 */
import { describe, expect, it } from "vitest";
import type { FlowRunBody } from "../../src/flow/kinds/registry.js";
import { childGroupIdOf, type FlowChildPort } from "../../src/flow/kinds/work.js";
import { acceptMessage, type FlowMessageInput } from "../../src/flow/messages.js";
import { getFlowRun, listMessages } from "../../src/flow/store.js";
import type { ControlStore } from "../../src/control/store.js";
import { fakeChildPort } from "./fixtures/fakeChildPort.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const TIMEOUT_MS = 3_600_000;
const TPL = { t: { yaml: `format: orca-flow-v1
id: t
workspace: {kind: dir}
steps:
  - {id: write, kind: work, prompt: p.md}
`, assets: { "p.md": "Write.\n" } } };

type World = Awaited<ReturnType<typeof flowWorld>>;
const runOf = (w: World, flowRunId: string): FlowRunBody => getFlowRun(w.store, flowRunId)!.body as FlowRunBody;
const stateOf = (w: World, flowRunId: string): string => getFlowRun(w.store, flowRunId)!.state;
const message = (over: Omit<Partial<FlowMessageInput>, "body"> & { body: Record<string, unknown> }): FlowMessageInput =>
  ({ kind: "command", target: { kind: "run" }, by: "ann", via: "web", requestId: `r-${Math.random()}`, ...over });

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

async function paused() {
  const world = await started();
  const accepted = await acceptMessage(world.w.deps, world.flowRunId, message({ body: { command: "pause" }, pauseAuthority: true }));
  expect(accepted.state).toBe("applied");
  return { ...world, pauseSeq: accepted.seq };
}

describe("pause and resume while a work step runs (§10.5.1)", () => {
  it("pause is applied at once: the child is stopped with reason pause and the contract deadline; the execution stays running", async () => {
    const { w, child, flowRunId, childGroupId } = await started(); try {
      const accepted = await acceptMessage(w.deps, flowRunId, message({ body: { command: "pause" }, pauseAuthority: true }));
      expect(accepted.state).toBe("applied");
      expect(stateOf(w, flowRunId)).toBe("paused");
      expect(w.latest(flowRunId, "write")).toMatchObject({ state: "running", childGroupId });
      expect(child.stops).toHaveLength(1);
      const stop = child.stops[0]!;
      expect(stop).toMatchObject({ childGroupId, flowStop: { flowRunId, stepKey: "write", seq: 1, reason: "pause" } });
      expect(Date.parse(stop.deadlineAt) - Date.parse(stop.acceptedAt)).toBe(TIMEOUT_MS + 60_000);
      expect(runOf(w, flowRunId).pauseIntent).toEqual({
        messageSeq: accepted.seq, at: stop.acceptedAt,
        steps: [{ stepKey: "write", seq: 1, childGroupId, acceptedAt: stop.acceptedAt, deadlineAt: stop.deadlineAt }],
      });
    } finally { await w.dispose(); }
  });

  it("pause with an unknown attempt timeout is refused at accept with the step named; the run stays running", async () => {
    const child = fakeChildPort({ timeoutMs: null });
    const w = await flowWorld(TPL, { children: (store) => boundPort(child, store), files: { "notes.txt": "n\n" } });
    try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t" });
      await w.advance();
      expect(w.latest(flowRunId, "write")).toMatchObject({ state: "running" });
      const rejected = await acceptMessage(w.deps, flowRunId, message({ body: { command: "pause" }, pauseAuthority: true }));
      expect(rejected).toMatchObject({ state: "rejected", reason: "flow-pause-timeout-unknown:write" });
      expect(stateOf(w, flowRunId)).toBe("running");
      expect(runOf(w, flowRunId).pauseIntent).toBeUndefined();
      expect(child.stops).toHaveLength(0);
    } finally { await w.dispose(); }
  });

  it("resume while the stop is pending is refused flow-pause-stop-incomplete; the run stays paused with its intent", async () => {
    const { w, flowRunId, pauseSeq } = await paused(); try {
      const rejected = await acceptMessage(w.deps, flowRunId, message({ body: { command: "resume" }, personAuthority: true }));
      expect(rejected.state).toBe("rejected");
      expect(rejected.reason).toBe("flow-pause-stop-incomplete:write:handoff-pending");
      expect(stateOf(w, flowRunId)).toBe("paused");
      expect(runOf(w, flowRunId).pauseIntent!.messageSeq).toBe(pauseSeq);
    } finally { await w.dispose(); }
  });

  it("resume of a complete recoverable stop registers one continuation and moves the run to running", async () => {
    const { w, child, flowRunId, childGroupId } = await paused(); try {
      child.completeStop(childGroupId, { recoverable: true });
      const applied = await acceptMessage(w.deps, flowRunId, message({ body: { command: "resume" }, personAuthority: true }));
      expect(applied.state).toBe("applied");
      expect(stateOf(w, flowRunId)).toBe("running");
      expect(runOf(w, flowRunId).pauseIntent).toBeUndefined();
      expect(child.resumes).toHaveLength(1);
      expect(child.resumes[0]!.children).toEqual([{ childGroupId, flowStop: { flowRunId, stepKey: "write", seq: 1, reason: "pause" } }]);
      expect(child.resumes[0]!.result).toEqual([{ childGroupId, pendingRunId: `run-${childGroupId}` }]);
    } finally { await w.dispose(); }
  });

  it("resume of a complete restartable stop dispatches again (no continuation) and moves the run to running", async () => {
    const { w, child, flowRunId, childGroupId } = await paused(); try {
      child.completeStop(childGroupId, { recoverable: false });
      const applied = await acceptMessage(w.deps, flowRunId, message({ body: { command: "resume" }, personAuthority: true }));
      expect(applied.state).toBe("applied");
      expect(stateOf(w, flowRunId)).toBe("running");
      expect(runOf(w, flowRunId).pauseIntent).toBeUndefined();
      expect(child.resumes[0]!.result).toEqual([{ childGroupId, pendingRunId: null }]);
    } finally { await w.dispose(); }
  });

  it("pause without pause authority is refused flow-command-needs-person; the run stays running", async () => {
    const { w, child, flowRunId } = await started(); try {
      const rejected = await acceptMessage(w.deps, flowRunId, message({ body: { command: "pause" } }));
      expect(rejected).toMatchObject({ state: "rejected", reason: "flow-command-needs-person:pause" });
      expect(stateOf(w, flowRunId)).toBe("running");
      expect(child.stops).toHaveLength(0);
    } finally { await w.dispose(); }
  });

  it("resume without person authority is refused flow-command-needs-person; the run stays paused", async () => {
    const { w, flowRunId } = await paused(); try {
      const rejected = await acceptMessage(w.deps, flowRunId, message({ body: { command: "resume" } }));
      expect(rejected).toMatchObject({ state: "rejected", reason: "flow-command-needs-person:resume" });
      expect(stateOf(w, flowRunId)).toBe("paused");
      expect(runOf(w, flowRunId).pauseIntent).toBeDefined();
    } finally { await w.dispose(); }
  });

  it("a budget refusal rejects the resume, leaves the run paused and keeps the intent for a later pass", async () => {
    const { w, child, flowRunId, childGroupId, pauseSeq } = await paused(); try {
      child.completeStop(childGroupId, { recoverable: true });
      child.failResume(childGroupId, "group-budget-unavailable");
      const rejected = await acceptMessage(w.deps, flowRunId, message({ body: { command: "resume" }, personAuthority: true }));
      expect(rejected).toMatchObject({ state: "rejected", reason: `group-budget-unavailable:${childGroupId}` });
      expect(stateOf(w, flowRunId)).toBe("paused");
      expect(runOf(w, flowRunId).pauseIntent!.messageSeq).toBe(pauseSeq);
    } finally { await w.dispose(); }
  });

  it("pause before any execution starts pauses the run without an intent or a stop", async () => {
    const { w, child } = await world(); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t" });
      const accepted = await acceptMessage(w.deps, flowRunId, message({ body: { command: "pause" }, pauseAuthority: true }));
      expect(accepted.state).toBe("applied");
      expect(stateOf(w, flowRunId)).toBe("paused");
      expect(runOf(w, flowRunId).pauseIntent).toBeUndefined();
      expect(child.stops).toHaveLength(0);
      expect(w.execs(flowRunId)).toHaveLength(0);
    } finally { await w.dispose(); }
  });

  it("a stop message is still not taken mid-run: it waits for the boundary", async () => {
    const { w, child, flowRunId, childGroupId } = await started(); try {
      const stored = await acceptMessage(w.deps, flowRunId, message({ body: { command: "stop" } }));
      expect(stored.state).toBe("accepted");
      expect(stateOf(w, flowRunId)).toBe("running");
      expect(listMessages(w.store, flowRunId).filter((m) => (m.body as { command?: string }).command === "stop").map((m) => m.state)).toEqual(["accepted"]);
      child.land(childGroupId);
      await w.advance();
      expect(stateOf(w, flowRunId)).toBe("stopped");
      expect(listMessages(w.store, flowRunId).find((m) => (m.body as { command?: string }).command === "stop")!.state).toBe("applied");
    } finally { await w.dispose(); }
  });
});
