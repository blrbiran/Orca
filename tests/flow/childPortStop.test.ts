/**
 * Live transcript spec §10.5.1 (plan T2): the driver-backed child port's stop, stop state and resume. A flow stop writes the
 * marker into the child's handoff intent; the state is read back from the child; a resume registers a continuation (a
 * recoverable child) or arms a start (a restartable one) inside one batch transaction.
 */
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveGroupSelections } from "../../src/control/agentFreeze.js";
import { sha256Canonical } from "../../src/control/canonicalJson.js";
import { continuationWakeBody } from "../../src/control/continuation.js";
import { buildFlowStepPlanSource } from "../../src/control/flowStepPlan.js";
import { ORCHESTRATION_ACTOR } from "../../src/control/orchestration.js";
import { applyResumeDispatch, readStopIntent, saveHandoffRequest, type FlowStopMarker } from "../../src/control/stopIntent.js";
import { WebControlService } from "../../src/control/webService.js";
import { createDriverChildPort } from "../../src/flow/childPort.js";
import { FlowRefusal } from "../../src/flow/kernel.js";
import { flowVaultRepoId } from "../../src/flow/groups.js";
import type { FlowChildOpen } from "../../src/flow/kinds/work.js";
import { parentGroupBody } from "../../src/flow/parent.js";
import { insertFlowRun } from "../../src/flow/store.js";
import type { FlowStep } from "../../src/flow/template/schema.js";
import { profileSnapshot, webFixture } from "../control/fixtures/web.js";

const failControl = vi.hoisted(() => ({ resumeBudgetFailureFor: null as string | null }));

// Plan D8: one child's refusal rolls the whole batch back. `group-budget-unavailable` is a claim-time refusal with no
// fixture that reaches it from a registration, so the batch test asks the helper to refuse it and keeps every other call.
vi.mock("../../src/control/continuation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/control/continuation.js")>();
  const { ControlError } = await import("../../src/control/errors.js");
  return {
    ...actual,
    resumeFlowChildInTransaction: (
      store: Parameters<typeof actual.resumeFlowChildInTransaction>[0],
      groupId: string,
      revision: number,
      operatorNote?: Parameters<typeof actual.resumeFlowChildInTransaction>[3],
    ) => {
      if (failControl.resumeBudgetFailureFor === groupId) throw new ControlError("group-budget-unavailable");
      return actual.resumeFlowChildInTransaction(store, groupId, revision, operatorNote);
    },
  };
});

const VAULT_ID = "e".repeat(64);
const BASE = "a".repeat(40);
const ACCEPTED_AT = "2026-10-26T00:00:00.000Z";
const DEADLINE_AT = "2026-10-26T02:00:00.000Z";
const MARKER: FlowStopMarker = { flowRunId: "fr-1", stepKey: "write", seq: 1, reason: "pause" };
const STEP = { id: "write", kind: "work", prompt: "p.md" } as FlowStep;

function controlRootOf(root: string): string {
  const dir = join(root, "flow-control");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  return dir;
}

function childRequest(stepKey = "write", seq = 1): FlowChildOpen {
  const vaultPath = `/vault/${VAULT_ID}.git`;
  return {
    childGroupId: `flow-fr-1-${stepKey}-${seq}`, parentGroupId: "flow-1", flowRunId: "fr-1", stepKey, seq, baseCommit: BASE, vaultPath,
    plan: buildFlowStepPlanSource({ flowRunId: "fr-1", step: { ...STEP, id: stepKey }, seq, baseCommit: BASE, vaultPath, promptEnvelope: "Write.", gates: [], agent: { agent: "codex" } }),
    work: { tokens: 70_000, activeMs: 1, attempts: 1, sessions: 1 }, skills: [], effectRecordId: null,
  };
}

async function world() {
  const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]);
  const binding = { profileId: "all", profileHash: h.frozen.profileHash };
  h.store.db.prepare("INSERT INTO groups(id,revision,graph_version,projection_seq,body) VALUES ('flow-1',0,1,0,?)").run(JSON.stringify(parentGroupBody({
    groupId: "flow-1", flowRunId: "fr-1", projectId: null, workspaceKind: "dir", vaultId: VAULT_ID, repoId: flowVaultRepoId(VAULT_ID), poolTokens: 500_000, at: 1, goal: "flow",
    confirmation: { call: null, children: { budgetMode: "soft", profiles: { estimator: binding, worker: binding, handoff: binding, goalReview: binding }, contextPolicy: { handoffAtContextTokens: 800_000 } } },
  })));
  insertFlowRun(h.store, {
    id: "fr-1", groupId: "flow-1", templateRef: "builtin/x", templateSha256: "t", workspace: { projectId: null, kind: "dir" }, vaultId: VAULT_ID,
    paramsSha256: "p", poolTokens: 500_000, poolDrawn: 70_000, state: "running", revision: 0, body: {},
  });
  const service = new WebControlService(h.deps);
  const port = createDriverChildPort({
    store: h.store, env: { ORCA_VAULT_DIR: h.root, ORCA_CONTROL_DIR: controlRootOf(h.root) }, importDeps: h.deps, confirm: (command) => service.confirm(command as never), admissionGate: h.deps.admissionGate,
    selectionsHash: async (groupId) => (await resolveGroupSelections({ store: h.store, port: h.deps.port }, groupId, ORCHESTRATION_ACTOR)).selectionsHash,
  });
  return { h, port, service };
}

type World = Awaited<ReturnType<typeof world>>;

function groupOf(h: World["h"], id: string): { stopped: boolean; revision: number } {
  return JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(id)!.body)) as { stopped: boolean; revision: number };
}

function workOf(h: World["h"], id: string): { workItemId: string; taskId: string; grant: { work: unknown; handoff: unknown }; currentRunId?: string; status: string } {
  return JSON.parse(String(h.store.db.prepare("SELECT body FROM work_items WHERE group_id=?").get(id)!.body));
}

/** A claimed child run, as the pump leaves one: active, current on the child's one work item. */
function startRun(h: World["h"], childGroupId: string): string {
  const row = h.store.db.prepare("SELECT id,body FROM work_items WHERE group_id=?").get(childGroupId)!;
  const work = JSON.parse(String(row.body)) as { taskId: string; grant: { work: unknown; handoff: unknown } };
  const runId = `run-${childGroupId}`;
  const zero = { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 };
  h.store.db.prepare("INSERT INTO runs VALUES (?,?,?,1,1,?)").run(runId, childGroupId, String(row.id), JSON.stringify({
    runId, groupId: childGroupId, workItemId: String(row.id), taskId: work.taskId, phase: "work", state: "running", recoverable: false, checkpointId: null,
    generation: 1, providerAttemptOrdinal: 0,
    grant: work.grant, remaining: work.grant, cumulative: { work: zero, handoff: zero }, unknown: { work: false, handoff: false }, highWater: 0,
  }));
  h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id=?").run(JSON.stringify({ ...work, status: "running", currentRunId: runId }), childGroupId, String(row.id));
  return runId;
}

/** The handoff request reaching its settled state, and the work item held (the driver's own handoff settlement). */
function completeStop(h: World["h"], childGroupId: string, runId: string, state: "settled-recoverable" | "settled-restartable"): void {
  const runRow = h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!;
  const run = JSON.parse(String(runRow.body)) as { taskId: string };
  const checkpointId = state === "settled-recoverable" ? `cp-${runId}` : null;
  h.store.db.prepare("UPDATE runs SET active=0, body=? WHERE id=?").run(JSON.stringify({ ...JSON.parse(String(runRow.body)), state, recoverable: state === "settled-recoverable", checkpointId }), runId);
  if (checkpointId !== null) {
    const checkpoint = { checkpointId, runId, taskId: run.taskId, result: "partial" };
    h.store.db.prepare("INSERT INTO checkpoints VALUES (?,?,?,?)").run(checkpointId, runId, sha256Canonical(checkpoint), JSON.stringify(checkpoint));
  }
  const workRow = h.store.db.prepare("SELECT id,body FROM work_items WHERE group_id=?").get(childGroupId)!;
  h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id=?").run(JSON.stringify({ ...JSON.parse(String(workRow.body)), status: "held", currentRunId: runId }), childGroupId, String(workRow.id));
  const requestRow = h.store.db.prepare("SELECT body FROM handoff_requests WHERE group_id=? AND run_id=?").get(childGroupId, runId)!;
  saveHandoffRequest(h.store, childGroupId, { ...JSON.parse(String(requestRow.body)), state });
}

async function openChild(w: World, stepKey = "write"): Promise<string> {
  const request = childRequest(stepKey);
  await w.port.open(request);
  return request.childGroupId;
}

/** A child stopped by the flow and settled as `state`; returns its group id. */
async function stoppedChild(w: World, stepKey: string, state: "settled-recoverable" | "settled-restartable"): Promise<string> {
  const childGroupId = await openChild(w, stepKey);
  const runId = startRun(w.h, childGroupId);
  w.port.stop(childGroupId, { acceptedAt: ACCEPTED_AT, deadlineAt: DEADLINE_AT, flowStop: { ...MARKER, stepKey } });
  completeStop(w.h, childGroupId, runId, state);
  return childGroupId;
}

const stopMarkerOf = (stepKey: string): FlowStopMarker => ({ ...MARKER, stepKey });

beforeEach(() => { failControl.resumeBudgetFailureFor = null; });

describe("FlowChildPort.attemptTimeoutMs (spec §10.5.1)", () => {
  it("reads the confirmed contract's per-attempt timeout; an unknown child has none", async () => {
    const w = await world(); try {
      const childGroupId = await openChild(w);
      expect(w.port.attemptTimeoutMs(childGroupId)).toBe(10_800_000);
      expect(w.port.attemptTimeoutMs("flow-fr-1-missing-1")).toBe(null);
    } finally { await w.h.dispose(); }
  });
});

describe("FlowChildPort.stop and stopState (spec §10.5.1)", () => {
  it("writes the marker into the child's handoff intent, stops its group, and is idempotent for the same marker", async () => {
    const w = await world(); try {
      const childGroupId = await openChild(w);
      startRun(w.h, childGroupId);
      w.port.stop(childGroupId, { acceptedAt: ACCEPTED_AT, deadlineAt: DEADLINE_AT, flowStop: MARKER });
      expect(readStopIntent(w.h.store, childGroupId)).toMatchObject({ mode: "handoff", state: "handoff-pending", acceptedAt: ACCEPTED_AT, deadlineAt: DEADLINE_AT, flowStop: MARKER });
      expect(groupOf(w.h, childGroupId).stopped).toBe(true);
      const revision = groupOf(w.h, childGroupId).revision;
      w.port.stop(childGroupId, { acceptedAt: ACCEPTED_AT, deadlineAt: DEADLINE_AT, flowStop: MARKER });
      expect(groupOf(w.h, childGroupId).revision).toBe(revision);
      expect(w.h.store.db.prepare("SELECT count(*) AS n FROM stop_intents WHERE group_id=?").get(childGroupId)!.n).toBe(1);
      expect(w.h.store.db.prepare("SELECT count(*) AS n FROM handoff_requests WHERE group_id=?").get(childGroupId)!.n).toBe(1);
    } finally { await w.h.dispose(); }
  });

  it("reads none without an intent, not-complete while the handoff is pending, and foreign for a different marker", async () => {
    const w = await world(); try {
      const childGroupId = await openChild(w);
      expect(w.port.stopState(childGroupId, MARKER)).toEqual({ state: "none" });
      startRun(w.h, childGroupId);
      w.port.stop(childGroupId, { acceptedAt: ACCEPTED_AT, deadlineAt: DEADLINE_AT, flowStop: MARKER });
      expect(w.port.stopState(childGroupId, MARKER)).toEqual({ state: "not-complete", stopState: "handoff-pending" });
      expect(w.port.stopState(childGroupId, { ...MARKER, seq: 2 })).toEqual({ state: "foreign", stopState: "handoff-pending" });
      expect(w.port.stopState(childGroupId, { ...MARKER, reason: "note" })).toEqual({ state: "foreign", stopState: "handoff-pending" });
    } finally { await w.h.dispose(); }
  });

  it("is resumable with recoverable true at handoff-complete when the held run is settled-recoverable with a checkpoint", async () => {
    const w = await world(); try {
      const childGroupId = await stoppedChild(w, "write", "settled-recoverable");
      expect(w.port.stopState(childGroupId, MARKER)).toEqual({ state: "resumable", recoverable: true });
    } finally { await w.h.dispose(); }
  });

  it("is resumable with recoverable false at handoff-complete when the held run is restartable", async () => {
    const w = await world(); try {
      const childGroupId = await stoppedChild(w, "write", "settled-restartable");
      expect(w.port.stopState(childGroupId, MARKER)).toEqual({ state: "resumable", recoverable: false });
    } finally { await w.h.dispose(); }
  });
});

describe("FlowChildPort.resume (spec §10.5.1, plan D8)", () => {
  it("registers a continuation for a recoverable child, clears the stop, un-stops the group and returns the pending run id", async () => {
    const w = await world(); try {
      const childGroupId = await stoppedChild(w, "write", "settled-recoverable");
      const note = { text: "keep the draft", scope: "next-attempt" as const };
      const result = w.port.resume([{ childGroupId, flowStop: MARKER, operatorNote: note }]);
      expect(result).toEqual([{ childGroupId, pendingRunId: expect.stringMatching(/^run-/) }]);
      expect(readStopIntent(w.h.store, childGroupId)).toBe(null);
      expect(groupOf(w.h, childGroupId).stopped).toBe(false);
      const wake = continuationWakeBody(w.h.store, childGroupId);
      expect(wake?.continuations).toEqual([expect.objectContaining({ taskId: workOf(w.h, childGroupId).taskId, pendingRunId: result[0].pendingRunId, operatorNote: note })]);
      expect(workOf(w.h, childGroupId).status).toBe("continuing");
    } finally { await w.h.dispose(); }
  });

  it("arms a start wake for a restartable child and returns no pending run", async () => {
    const w = await world(); try {
      const childGroupId = await stoppedChild(w, "write", "settled-restartable");
      expect(w.port.resume([{ childGroupId, flowStop: MARKER }])).toEqual([{ childGroupId, pendingRunId: null }]);
      expect(readStopIntent(w.h.store, childGroupId)).toBe(null);
      expect(groupOf(w.h, childGroupId).stopped).toBe(false);
      expect(w.h.store.db.prepare("SELECT kind FROM scheduler_wakes WHERE group_id=?").all(childGroupId).map((row) => String(row.kind))).toEqual(["start"]);
    } finally { await w.h.dispose(); }
  });

  it("refuses a child that is not at handoff-complete, and refuses a foreign marker", async () => {
    const w = await world(); try {
      const childGroupId = await openChild(w);
      startRun(w.h, childGroupId);
      w.port.stop(childGroupId, { acceptedAt: ACCEPTED_AT, deadlineAt: DEADLINE_AT, flowStop: MARKER });
      expect(() => w.port.resume([{ childGroupId, flowStop: MARKER }])).toThrow(expect.objectContaining({ name: "FlowRefusal", code: "flow-pause-stop-incomplete", detail: `${childGroupId}:handoff-pending` }));
      expect(() => w.port.resume([{ childGroupId, flowStop: { ...MARKER, seq: 2 } }])).toThrow(expect.objectContaining({ name: "FlowRefusal", code: "flow-pause-stop-incomplete", detail: `${childGroupId}:foreign` }));
      expect(readStopIntent(w.h.store, childGroupId)!.flowStop).toEqual(MARKER);
    } finally { await w.h.dispose(); }
  });

  it("rolls the whole batch back when a later child refuses (two children, a handoff still pending)", async () => {
    const w = await world(); try {
      const first = await stoppedChild(w, "write", "settled-restartable");
      const second = await openChild(w, "review");
      startRun(w.h, second);
      w.port.stop(second, { acceptedAt: ACCEPTED_AT, deadlineAt: DEADLINE_AT, flowStop: stopMarkerOf("review") });
      let refusal: unknown;
      try { w.port.resume([{ childGroupId: first, flowStop: MARKER }, { childGroupId: second, flowStop: stopMarkerOf("review") }]); }
      catch (error) { refusal = error; }
      expect(refusal).toBeInstanceOf(FlowRefusal);
      expect((refusal as FlowRefusal).code).toBe("flow-pause-stop-incomplete");
      expect((refusal as FlowRefusal).detail).toBe(`${second}:handoff-pending`);
      // Nothing of the first child moved: its intent is still there and no wake was armed.
      expect(readStopIntent(w.h.store, first)!.flowStop).toEqual(MARKER);
      expect(groupOf(w.h, first).stopped).toBe(true);
      expect(w.h.store.db.prepare("SELECT count(*) AS n FROM scheduler_wakes WHERE group_id=?").get(first)!.n).toBe(0);
    } finally { await w.h.dispose(); }
  });

  it("maps a group-budget refusal to a FlowRefusal and rolls the batch back", async () => {
    const w = await world(); try {
      const first = await stoppedChild(w, "write", "settled-restartable");
      const second = await stoppedChild(w, "review", "settled-restartable");
      failControl.resumeBudgetFailureFor = second;
      let refusal: unknown;
      try { w.port.resume([{ childGroupId: first, flowStop: MARKER }, { childGroupId: second, flowStop: stopMarkerOf("review") }]); }
      catch (error) { refusal = error; }
      expect(refusal).toBeInstanceOf(FlowRefusal);
      expect((refusal as FlowRefusal).code).toBe("group-budget-unavailable");
      expect(readStopIntent(w.h.store, first)!.flowStop).toEqual(MARKER);
      expect(groupOf(w.h, first).stopped).toBe(true);
      expect(w.h.store.db.prepare("SELECT count(*) AS n FROM scheduler_wakes WHERE group_id=?").get(first)!.n).toBe(0);
    } finally { await w.h.dispose(); }
  });

  it("leaves the direct resume verbs refused on a flow-placed stop", async () => {
    const w = await world(); try {
      const childGroupId = await stoppedChild(w, "write", "settled-recoverable");
      const result = applyResumeDispatch({ store: w.h.store, profileRouter: w.h.deps.profileRouter }, {
        schema: "orca-raw-command-v1", commandId: "resume-child", actorId: "human", expectedRevision: groupOf(w.h, childGroupId).revision,
        verb: "resume-dispatch", target: { kind: "group", groupId: childGroupId }, payload: {},
      });
      expect(result).toMatchObject({ error: { code: "flow-pause-resume-via-flow" } });
    } finally { await w.h.dispose(); }
  });
});

describe("the fake child port fixture", () => {
  // Ruling: human approved rewriting all necessary criteria, Orca session 7753e97d, 2026-10-27. The fixture now refuses
  // what the driver port refuses (review finding 6); the old case resumed a landed child, which the real port never does.
  it("models landing, stop states and resume outcomes for T4–T6 as the driver port does", async () => {
    const { fakeChildPort } = await import("./fixtures/fakeChildPort.js");
    const fake = fakeChildPort();
    const marker = stopMarkerOf("write");
    expect(await fake.port.status("child")).toEqual({ state: "running" });
    expect(fake.port.attemptTimeoutMs("child")).toBe(3_600_000);
    fake.port.stop("child", { acceptedAt: ACCEPTED_AT, deadlineAt: DEADLINE_AT, flowStop: marker });
    expect(fake.port.stopState("child", marker)).toEqual({ state: "not-complete", stopState: "handoff-pending" });
    // applyFlowHandoffStop: the same marker again is a no-op, any other marker is refused.
    fake.port.stop("child", { acceptedAt: ACCEPTED_AT, deadlineAt: DEADLINE_AT, flowStop: marker });
    expect(() => fake.port.stop("child", { acceptedAt: ACCEPTED_AT, deadlineAt: DEADLINE_AT, flowStop: { ...marker, reason: "note" } }))
      .toThrow(expect.objectContaining({ code: "stop-mode-conflict" }));
    expect(fake.stops).toHaveLength(1);
    expect(() => fake.port.resume([{ childGroupId: "child", flowStop: marker }])).toThrow(expect.objectContaining({ code: "flow-pause-stop-incomplete", detail: "child:handoff-pending" }));
    fake.completeStop("child", { recoverable: false });
    fake.failResume("child", "continuation-budget-unavailable");
    expect(() => fake.port.resume([{ childGroupId: "child", flowStop: marker }])).toThrow(expect.objectContaining({ code: "continuation-budget-unavailable" }));
    fake.clearResumeFailure("child");
    // A throw in the flow's record lifts nothing.
    expect(() => fake.port.resume([{ childGroupId: "child", flowStop: marker }], () => { throw new Error("crash"); })).toThrow("crash");
    expect(fake.port.stopState("child", marker)).toEqual({ state: "resumable", recoverable: false });
    let recorded: unknown = null;
    expect(fake.port.resume([{ childGroupId: "child", flowStop: marker }], (resumed) => { recorded = resumed; })).toEqual([{ childGroupId: "child", pendingRunId: null }]);
    expect(recorded).toEqual([{ childGroupId: "child", pendingRunId: null }]);
    // resumeFlowChildInTransaction deletes the stop row it lifts.
    expect(fake.port.stopState("child", marker)).toEqual({ state: "none" });
    expect(fake.resumes).toHaveLength(1);
    // A settled child: its stop freezes nothing (complete at once) and it can never be continued.
    fake.land("other", "c".repeat(40));
    expect(await fake.port.status("other")).toEqual({ state: "landed", commit: "c".repeat(40), spentTokens: 0 });
    fake.port.stop("other", { acceptedAt: ACCEPTED_AT, deadlineAt: DEADLINE_AT, flowStop: marker });
    expect(fake.port.stopState("other", marker)).toEqual({ state: "resumable", recoverable: false });
    expect(() => fake.port.resume([{ childGroupId: "other", flowStop: marker }])).toThrow(expect.objectContaining({ code: "flow-pause-resume-failed", detail: "continuation-predecessor-unrecoverable" }));
  });
});
