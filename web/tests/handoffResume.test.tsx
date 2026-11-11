// @vitest-environment jsdom
/**
 * Handoff delivery spec §13.1 C-4 and I-4 (human ruling 2026-09-25, an online contract change): the panel
 * offers continuation only for runs the server marks `continuable` -- a normally completed task also
 * displays `settled-recoverable` and must not be continued -- and a handoff-complete group with nothing to
 * continue gets a resume with no selections, its only way back to dispatch.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { Amount, CheckpointViewV1, ControlConfigV1, GroupViewV1, RunViewV1 } from "../src/controlTypes.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-09-25T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
const run = (over: Partial<RunViewV1>): RunViewV1 => ({
  runId: "run-a", taskId: "a", estimateId: null, generation: 1, state: "settled-recoverable", phase: "work", claimOrdinal: 1, providerAttemptOrdinal: 1,
  profile: { profileId: "all", profileHash: "b".repeat(64) }, used: amount(10), remaining: amount(90), failureCode: null, evidenceIds: [], ...over,
});
const checkpoint = (runId: string, taskId: string, state: CheckpointViewV1["state"]): CheckpointViewV1 =>
  ({ checkpointId: `cp-${taskId}`, taskId, runId, state, snapshotHash: "9".repeat(64), evidenceIds: [] });
const view = (stopState: "handoff-pending" | "handoff-partial" | "handoff-complete", runs: RunViewV1[], checkpoints: CheckpointViewV1[]): GroupViewV1 => ({
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 4,
  summary: { groupId: "g", repoId: "orca", state: "running", commandRevision: 6, projectionSeq: 4, stopMode: "handoff", stopState, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1, plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship", successConditions: ["done"] },
  proposal: { state: "confirmed", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null }, profiles: {
    estimator: { profileId: "all", profileHash: "b".repeat(64) }, worker: { profileId: "all", profileHash: "b".repeat(64) },
    handoff: { profileId: "all", profileHash: "b".repeat(64) }, goalReview: { profileId: "all", profileHash: "b".repeat(64) } }, executionSnapshotHash: "c".repeat(64) },
  ledger: { groupLimit: amount(9_000_000), used: amount(20), committedRemaining: amount(3_000_000), explicitUnallocatedReserve: amount(5_999_980), budgetDeficit: amount(0), usageUnknown: false, unmeteredRuns: 0 },
  allocations: [], workItems: [], estimates: [], runs, checkpoints, handoffRequests: [],
  stop: { mode: "handoff", state: stopState, frozenRunIds: runs.map((entry) => entry.runId), acceptedAt: "2026-09-25T00:00:00.000Z", deadlineAt: "2026-09-25T00:30:00.000Z" },
  recoveryBlockers: [], recentCommandIds: [],
});
// One task finished normally before the stop reached it; the other was handed off with a partial checkpoint.
const completed = run({ runId: "run-a", taskId: "a", continuable: false });
const handedOff = run({ runId: "run-b", taskId: "b", continuable: true });

afterEach(cleanup);

describe("continuing after a handoff-stop (handoff delivery C-4, I-4)", () => {
  it("offers only the handed-off task, and the batch command carries only its selection", () => {
    const onCommand = vi.fn();
    render(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "dispatch", taskId: null, runId: null }} view={view("handoff-complete", [completed, handedOff], [checkpoint("run-a", "a", "complete"), checkpoint("run-b", "b", "partial")])}
      config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    // Issue-fixes ruling (Part C flag 2): continue-task is refused under any stop intent, so no single-task
    // continuation is offered while the handoff-stop is still in place -- only the batch resume.
    expect(screen.queryByRole("button", { name: /^Continue task/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue selected tasks (1)" }));
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith({ verb: "resume-from-handoff", groupId: "g", expectedRevision: 6,
      payload: { selections: [{ taskId: "b", predecessorRunId: "run-b", checkpointId: "cp-b" }] } });
  });

  // Issue-fixes ruling (C3 follow-up): a plain resume is offered beside the batch continuation, so a person can leave
  // the stop without continuing every held task and then continue them one by one once no stop intent remains.
  it("offers a resume with no selections beside the batch continuation when tasks are continuable", () => {
    const onCommand = vi.fn();
    render(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "dispatch", taskId: null, runId: null }} view={view("handoff-complete", [completed, handedOff], [checkpoint("run-a", "a", "complete"), checkpoint("run-b", "b", "partial")])}
      config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    expect(screen.getByRole("button", { name: "Continue selected tasks (1)" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resume (no continuation)" }));
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith({ verb: "resume-from-handoff", groupId: "g", expectedRevision: 6, payload: { selections: [] } });
  });

  it("offers a single task's continuation only once the group has no stop intent, and only for the handed-off task", () => {
    const onCommand = vi.fn();
    const stopped = view("handoff-complete", [completed, handedOff], [checkpoint("run-a", "a", "complete"), checkpoint("run-b", "b", "partial")]);
    const resumed: GroupViewV1 = { ...stopped, summary: { ...stopped.summary, stopMode: null, stopState: null }, stop: null };
    render(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "dispatch", taskId: null, runId: null }} view={resumed} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    expect(screen.queryByRole("button", { name: "Continue task a" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Continue selected/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue task b" }));
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith({ verb: "continue-task", groupId: "g", taskId: "b", expectedRevision: 6,
      payload: { predecessorRunId: "run-b", checkpointId: "cp-b" } });
  });

  it("offers a resume with no selections when the handoff completed and nothing is continuable", () => {
    const onCommand = vi.fn();
    render(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "dispatch", taskId: null, runId: null }} view={view("handoff-complete", [completed, run({ runId: "run-c", taskId: "c", state: "settled-restartable" })], [checkpoint("run-a", "a", "complete")])}
      config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    expect(screen.queryByRole("button", { name: /^Continue/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resume (no continuation)" }));
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith({ verb: "resume-from-handoff", groupId: "g", expectedRevision: 6, payload: { selections: [] } });
  });

  it("offers no resume at all while the handoff has not completed", () => {
    for (const stopState of ["handoff-pending", "handoff-partial"] as const) {
      render(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "dispatch", taskId: null, runId: null }} view={view(stopState, [completed], [checkpoint("run-a", "a", "complete")])}
        config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
      expect(screen.queryByRole("button", { name: "Resume (no continuation)" })).toBeNull();
      expect(screen.queryByRole("button", { name: /^Continue/ })).toBeNull();
      cleanup();
    }
  });
});

// #226 (ii) (tester follow-up C, 2026-11-11): the person can tell a continued task's agent something. The note rides the
// continuation the buttons already send; the continued run reads it at its next plan and execute (never mid-turn).
describe("a note for the continued work (#226 ii)", () => {
  const stopped = (): GroupViewV1 => view("handoff-complete", [completed, handedOff], [checkpoint("run-a", "a", "complete"), checkpoint("run-b", "b", "partial")]);
  const mount = (value: GroupViewV1, onCommand = vi.fn()) => {
    render(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "dispatch", taskId: null, runId: null }} view={value} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    return onCommand;
  };
  const noteBox = (): HTMLElement => screen.getByRole("textbox", { name: "Note for the continued run (optional)" });

  it("the batch continuation carries the typed note on every selection, and an empty note adds nothing", () => {
    // mutation: selections() leaves the note out -> the payload has no operatorNote -> red
    const onCommand = mount(stopped());
    fireEvent.change(noteBox(), { target: { value: "  run only test/queue.test.js first  " } });
    fireEvent.click(screen.getByRole("button", { name: "Continue selected tasks (1)" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "resume-from-handoff", groupId: "g", expectedRevision: 6,
      payload: { selections: [{ taskId: "b", predecessorRunId: "run-b", checkpointId: "cp-b", operatorNote: { text: "run only test/queue.test.js first", scope: "next-attempt" } }] } });
    expect((noteBox() as HTMLTextAreaElement).value, "sent, so cleared").toBe("");
  });

  it("a single task's continuation carries it too; with no note the payload is today's", () => {
    // mutation: continue-task's payload skips withNote -> no operatorNote -> red at the first check
    const value = stopped();
    const resumed: GroupViewV1 = { ...value, summary: { ...value.summary, stopMode: null, stopState: null }, stop: null };
    const onCommand = mount(resumed);
    fireEvent.change(noteBox(), { target: { value: "keep the public API" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue task b" }));
    expect(onCommand).toHaveBeenLastCalledWith({ verb: "continue-task", groupId: "g", taskId: "b", expectedRevision: 6,
      payload: { predecessorRunId: "run-b", checkpointId: "cp-b", operatorNote: { text: "keep the public API", scope: "next-attempt" } } });
    fireEvent.click(screen.getByRole("button", { name: "Continue task b" }));
    expect(onCommand).toHaveBeenLastCalledWith({ verb: "continue-task", groupId: "g", taskId: "b", expectedRevision: 6,
      payload: { predecessorRunId: "run-b", checkpointId: "cp-b" } });
  });

  it("a note over 4096 bytes disables the continuations and says why", () => {
    const onCommand = mount(stopped());
    fireEvent.change(noteBox(), { target: { value: "字".repeat(1366) } });
    expect(screen.getByText("The note is longer than 4096 bytes; shorten it.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Continue selected tasks (1)" }) as HTMLButtonElement).disabled).toBe(true);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("is not offered when nothing is continuable", () => {
    mount(view("handoff-complete", [completed], [checkpoint("run-a", "a", "complete")]));
    expect(screen.queryByRole("textbox", { name: "Note for the continued run (optional)" })).toBeNull();
  });
});
