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
  summary: { groupId: "g", state: "running", commandRevision: 6, projectionSeq: 4, stopMode: "handoff", stopState, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1, plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship", successConditions: ["done"] },
  proposal: { state: "confirmed", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null }, profiles: {
    estimator: { profileId: "all", profileHash: "b".repeat(64) }, worker: { profileId: "all", profileHash: "b".repeat(64) },
    handoff: { profileId: "all", profileHash: "b".repeat(64) }, goalReview: { profileId: "all", profileHash: "b".repeat(64) } }, executionSnapshotHash: "c".repeat(64) },
  ledger: { groupLimit: amount(9_000_000), used: amount(20), committedRemaining: amount(3_000_000), explicitUnallocatedReserve: amount(5_999_980), budgetDeficit: amount(0), usageUnknown: false },
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
    render(<ControlGroupView view={view("handoff-complete", [completed, handedOff], [checkpoint("run-a", "a", "complete"), checkpoint("run-b", "b", "partial")])}
      config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    expect(screen.queryByRole("button", { name: "Continue task a" })).toBeNull();
    expect(screen.getByRole("button", { name: "Continue task b" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resume (no continuation)" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue selected tasks (1)" }));
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith({ verb: "resume-from-handoff", groupId: "g", expectedRevision: 6,
      payload: { selections: [{ taskId: "b", predecessorRunId: "run-b", checkpointId: "cp-b" }] } });
  });

  it("offers a resume with no selections when the handoff completed and nothing is continuable", () => {
    const onCommand = vi.fn();
    render(<ControlGroupView view={view("handoff-complete", [completed, run({ runId: "run-c", taskId: "c", state: "settled-restartable" })], [checkpoint("run-a", "a", "complete")])}
      config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    expect(screen.queryByRole("button", { name: /^Continue/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resume (no continuation)" }));
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith({ verb: "resume-from-handoff", groupId: "g", expectedRevision: 6, payload: { selections: [] } });
  });

  it("offers no resume at all while the handoff has not completed", () => {
    for (const stopState of ["handoff-pending", "handoff-partial"] as const) {
      render(<ControlGroupView view={view(stopState, [completed], [checkpoint("run-a", "a", "complete")])}
        config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
      expect(screen.queryByRole("button", { name: "Resume (no continuation)" })).toBeNull();
      expect(screen.queryByRole("button", { name: /^Continue/ })).toBeNull();
      cleanup();
    }
  });
});
