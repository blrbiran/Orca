// @vitest-environment jsdom
/**
 * Tester follow-up F §4 (#162): an estimate's `attempts: 1` is applied as 2 (the shared transform's floor). The budget
 * editor says so beside the suggestions, and its "use" button for the field offers the raised value.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BudgetEditor } from "../src/BudgetEditor.js";
import type { Amount, ControlConfigV1, GroupViewV1 } from "../src/controlTypes.js";

const amount = (tokens: number | null, attempts: number): Amount => ({ tokens, activeMs: 10, attempts, sessions: 1 }) as Amount;
const human = { provenance: "human", estimateId: null } as const;
const provenance = { tokens: human, activeMs: human, attempts: human, sessions: human };
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "realtime", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{ profileId: "est", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-10-01T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "est", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
const PLAN = "a".repeat(64);
const view = (estimated: number, groupTokens: number | null): GroupViewV1 => ({
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 1,
  summary: { groupId: "g", repoId: "orca", state: "draft", commandRevision: 3, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1,
  plan: { repoId: "orca", planId: "plan-demo", planHash: PLAN, goal: "Ship", successConditions: ["passes"] },
  proposal: { state: "editable", proposalVersion: 2, planHash: PLAN, budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
  ledger: { groupLimit: amount(groupTokens, 10), used: amount(0, 0), committedRemaining: amount(0, 0), explicitUnallocatedReserve: amount(0, 0), budgetDeficit: amount(0, 0), usageUnknown: false, unmeteredRuns: 0 },
  allocations: [
    { ownerKind: "task", ownerId: "c", bucket: "work", state: "draft-encumbered", amount: amount(3_000, 1), fieldProvenance: provenance },
    { ownerKind: "task", ownerId: "c", bucket: "handoff", state: "draft-encumbered", amount: amount(300, 1), fieldProvenance: provenance },
  ],
  workItems: [{ taskId: "c", status: "draft", dependencyTaskIds: [], targetVersion: 1, configHash: null, originalContractHash: "e".repeat(64), derivedContractHash: null, currentRunId: null, pendingRunId: null, lineageRunIds: [], loopPlan: null }],
  estimates: [{ estimateId: "est-1", estimateVersion: 1, state: "ready", profile: { profileId: "est", profileHash: "b".repeat(64) }, mode: "soft", requestHash: "c".repeat(64), outputHash: "d".repeat(64), reasonCode: null,
    output: { schema: "budget-estimate-v1", planHash: PLAN, goalReviewReserve: amount(1, 1), groupRationale: "r",
      tasks: [{ taskId: "c", complexity: "M", confidence: "high", work: amount(3_000, estimated), handoff: amount(300, 1), rationale: "r", assumptions: [] }] } }],
  runs: [], checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
} as unknown as GroupViewV1);

afterEach(cleanup);

describe("an estimate's work attempts below 2 is applied raised, and the editor says so (#162)", () => {
  it("names the task, the estimate's number and the applied one; the field's button offers 2", () => {
    render(<BudgetEditor view={view(1, 90_000)} config={config} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.getByTestId("budget-attempts-raised-c").textContent).toBe("Task c: the estimate said 1 work attempt(s); applying it sets 2, as an applied estimate sets at least 2.");
    expect(screen.getByRole("button", { name: "use 2 for c work attempts" })).toBeTruthy();
  });

  it("says nothing for an estimate of 2 or more, or in a group with no token limit (the estimate is advisory there)", () => {
    render(<BudgetEditor view={view(3, 90_000)} config={config} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.queryByTestId("budget-attempts-raised-c")).toBeNull();
    cleanup();
    render(<BudgetEditor view={view(1, null)} config={config} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.queryByTestId("budget-attempts-raised-c")).toBeNull();
  });
});
