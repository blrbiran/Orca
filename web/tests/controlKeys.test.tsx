// @vitest-environment jsdom
/**
 * Plan A final review finding 2: what the person set on one group (its label filter, its open task) or on one task (the
 * system label chosen, the custom label typed) is that group's or that task's alone -- switching to another group or
 * task starts it fresh, so the same task id in two groups never opens the other group's detail.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { ControlPanel } from "../src/ControlPanel.js";
import type { Amount, ControlConfigV1, ControlSummaryV1, GroupViewV1, RecoveryViewV1, WorkItemViewV1 } from "../src/controlTypes.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-09-29T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
const workItem = (over: Partial<WorkItemViewV1>): WorkItemViewV1 => ({
  taskId: "a", status: "active", dependencyTaskIds: [], targetVersion: 1, configHash: "d".repeat(64), originalContractHash: "e".repeat(64),
  derivedContractHash: "f".repeat(64), currentRunId: null, pendingRunId: null, lineageRunIds: [], labels: [], labelsVersion: 0, ...over,
});
const view = (groupId: string, workItems: WorkItemViewV1[]): GroupViewV1 => ({
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 4,
  summary: { groupId, state: "running", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1, plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship", successConditions: ["done"] },
  proposal: { state: "confirmed", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null }, profiles: {
    estimator: { profileId: "all", profileHash: "b".repeat(64) }, worker: { profileId: "all", profileHash: "b".repeat(64) },
    handoff: { profileId: "all", profileHash: "b".repeat(64) }, goalReview: { profileId: "all", profileHash: "b".repeat(64) } }, executionSnapshotHash: "c".repeat(64) },
  ledger: { groupLimit: amount(9_000_000), used: amount(10), committedRemaining: amount(3_000_000), explicitUnallocatedReserve: amount(5_999_990), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [], workItems, estimates: [], runs: [], checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
});
const recovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [] };

afterEach(cleanup);

describe("per-group and per-task view state does not leak (final review finding 2)", () => {
  it("opens another group with no task open and no label checked, though it has a task with the same id", () => {
    const groups = { g: view("g", [workItem({ labels: ["bug"] })]), h: view("h", [workItem({ labels: ["bug", "perf"] })]) };
    const summary: ControlSummaryV1 = {
      schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq: 4, resetRequired: false, dispatchBlocked: false,
      groups: [groups.g.summary, groups.h.summary],
    };
    const panel = (selected: string) => (
      <ControlPanel config={config} summary={summary} recovery={recovery} groups={groups} selected={selected} drafts={{}} uncertain={[]} refusal={null} refetchRequired={false} onSelect={vi.fn()} onDraft={vi.fn()} onCommand={vi.fn()} />
    );
    const { rerender } = render(panel("g"));
    fireEvent.click(screen.getByRole("checkbox", { name: "bug" }));
    fireEvent.click(screen.getByRole("button", { name: "a" }));
    expect(screen.getByRole("region", { name: "Task a" })).toBeTruthy();
    rerender(panel("h"));
    expect(screen.queryByRole("region", { name: "Task a" })).toBeNull();
    expect((screen.getByRole("checkbox", { name: "bug" }) as HTMLInputElement).checked).toBe(false);
  });

  it("opens another task with the editor's own choices reset", () => {
    render(<ControlGroupView view={view("g", [workItem({ taskId: "a" }), workItem({ taskId: "b" })])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "a" }));
    fireEvent.change(screen.getByRole("combobox", { name: "System label" }), { target: { value: "perf" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Custom label" }), { target: { value: "half typed" } });
    fireEvent.click(screen.getByRole("button", { name: "b" })); // straight from a to b, the detail never closes
    expect(screen.getByRole("region", { name: "Task b" })).toBeTruthy();
    expect((screen.getByRole("combobox", { name: "System label" }) as HTMLSelectElement).value).toBe("feature");
    expect((screen.getByRole("textbox", { name: "Custom label" }) as HTMLInputElement).value).toBe("");
  });
});
