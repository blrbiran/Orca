// @vitest-environment jsdom
/**
 * Execution driver final review I5 (controller ruling, 2026-09-25): spec §2.3's only manual remedy for a run the
 * driver blocked is the run-scope `recovery-retry`. The driver records the block on the run (`blockedReason`), not
 * as a recovery blocker, so the group view itself has to offer the command -- otherwise the person reads
 * "blocked — terminal:failed" with nothing to press.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { TaskDetail } from "../src/TaskDetail.js";
import { controlCommandPath } from "../src/controlApi.js";
import type { Amount, ControlConfigV1, GroupViewV1, RunViewV1, WorkItemViewV1 } from "../src/controlTypes.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-09-25T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
const run = (over: Partial<RunViewV1>): RunViewV1 => ({
  runId: "run-a", taskId: "a", estimateId: null, generation: 1, state: "running", phase: "work", claimOrdinal: 1, providerAttemptOrdinal: 1,
  profile: { profileId: "all", profileHash: "b".repeat(64) }, used: amount(10), remaining: amount(90), failureCode: null, evidenceIds: [], ...over,
});
const view = (runs: RunViewV1[]): GroupViewV1 => ({
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 4,
  summary: { groupId: "g", repoId: "orca", state: "running", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1, plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship", successConditions: ["done"] },
  proposal: { state: "confirmed", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null }, profiles: {
    estimator: { profileId: "all", profileHash: "b".repeat(64) }, worker: { profileId: "all", profileHash: "b".repeat(64) },
    handoff: { profileId: "all", profileHash: "b".repeat(64) }, goalReview: { profileId: "all", profileHash: "b".repeat(64) } }, executionSnapshotHash: "c".repeat(64) },
  ledger: { groupLimit: amount(9_000_000), used: amount(10), committedRemaining: amount(3_000_000), explicitUnallocatedReserve: amount(5_999_990), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [], workItems: [], estimates: [], runs, checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
});

afterEach(cleanup);

describe("retrying a run the execution driver blocked (final review I5)", () => {
  it("offers a Retry for the blocked run that sends a run-scope recovery-retry naming that run", () => {
    const onCommand = vi.fn();
    render(<ControlGroupView view={view([run({ runId: "run-b", taskId: "b", state: "blocked", blockedReason: "reconcile-terminal:failed" }), run({})])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    const buttons = screen.getAllByRole("button", { name: /^Retry run/ });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]!);
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith({ verb: "recovery-retry", groupId: "g", expectedRevision: 6, payload: { scope: "run", runId: "run-b" } });
  });

  it("offers no Retry for a run with no driver block, blocked or not", () => {
    render(<ControlGroupView view={view([run({}), run({ runId: "run-c", taskId: "c", state: "blocked", blockedReason: null })])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.queryAllByRole("button", { name: /^Retry run/ })).toHaveLength(0);
  });
});

// Issue fixes spec §4.2(5): a run ccloop ended failed is retried as a task; a settled-failed run explains itself and offers nothing.
const FAILED = { state: "blocked" as const, blockedReason: "terminal:failed", outcome: "failed", stopReason: "Error: codex-result-invalid: /runs/r/attempt-1" };
describe("retrying a task whose run ccloop ended failed (issue fixes spec §4.2(5))", () => {
  it("offers Retry task, not Retry run, and explains ccloop's reason beside the raw reason", () => {
    const onCommand = vi.fn();
    render(<ControlGroupView view={view([run(FAILED)])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    expect(screen.queryAllByRole("button", { name: /^Retry run/ })).toHaveLength(0);
    expect(screen.getByText(/did not answer in the required JSON format/)).toBeTruthy();
    expect(screen.getByText("Error: codex-result-invalid: /runs/r/attempt-1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry task a" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "retry-task", groupId: "g", expectedRevision: 6, payload: { taskId: "a" } });
    expect(controlCommandPath({ verb: "retry-task", groupId: "g", expectedRevision: 6, payload: { taskId: "a" } })).toBe("/api/control/groups/g/retry-task");
  });

  it("keeps Retry run for a blocked run whose ccloop run succeeded (out of bounds)", () => {
    render(<ControlGroupView view={view([run({ state: "blocked", blockedReason: "out-of-bounds:x", outcome: "succeeded", stopReason: null })])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: /^Retry run/ })).toHaveLength(1);
    expect(screen.queryAllByRole("button", { name: /^Retry task/ })).toHaveLength(0);
  });

  it("explains a settled-failed run's reason and offers no button", () => {
    render(<ControlGroupView view={view([run({ ...FAILED, state: "settled-failed", stopReason: "Error: codex-event-error" })])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.getByText(/reported an error/)).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: /^Retry (run|task)/ })).toHaveLength(0);
  });

  it("shows the task's run number and Retry task in the task detail", () => {
    const onCommand = vi.fn();
    const item: WorkItemViewV1 = { taskId: "a", status: "active", dependencyTaskIds: [], targetVersion: 1, configHash: "d".repeat(64), originalContractHash: "e".repeat(64),
      derivedContractHash: "f".repeat(64), currentRunId: "run-2", pendingRunId: null, lineageRunIds: ["run-1", "run-2"] };
    const runs = [run({ runId: "run-1", state: "settled-failed", outcome: "failed", blockedReason: "terminal:failed" }), run({ runId: "run-2", ...FAILED })];
    render(<TaskDetail view={{ ...view(runs), workItems: [item] }} item={item} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    expect(screen.getByText("Run 2 of this task")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry task a" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "retry-task", groupId: "g", expectedRevision: 6, payload: { taskId: "a" } });
  });
});
