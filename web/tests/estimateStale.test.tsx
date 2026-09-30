// @vitest-environment jsdom
/**
 * W6 (2026-10-01; loop plans spec §5.1): an estimate built before a set-task-loop change was built from contracts that
 * are no longer the tasks'; the server marks it stale and refuses applying it (estimate-stale). The editor says so in
 * one line and offers none of its suggestions, while the rationale stays readable.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BudgetEditor, suggestedOperations } from "../src/BudgetEditor.js";
import type { Amount, ControlConfigV1, EstimateViewV1, GroupViewV1 } from "../src/controlTypes.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const human = { provenance: "human", estimateId: null } as const;
const provenance = { tokens: human, activeMs: human, attempts: human, sessions: human };
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "realtime", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-10-01T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
const PLAN = "a".repeat(64);
const NOTICE = "This estimate predates a plan change; estimate again to update the suggestions";
const estimate = (stale: boolean | undefined): EstimateViewV1 => ({
  estimateId: "est-1", estimateVersion: 1, state: "ready", profile: { profileId: "all", profileHash: "b".repeat(64) }, mode: "soft",
  requestHash: "c".repeat(64), outputHash: "d".repeat(64), reasonCode: null, ...(stale === undefined ? {} : { stale }),
  output: {
    schema: "budget-estimate-v1", planHash: PLAN, goalReviewReserve: amount(2_000), groupRationale: "one small change",
    tasks: [{ taskId: "c", complexity: "M", confidence: "high", work: amount(4_000), handoff: amount(300), rationale: "small", assumptions: [] }],
  },
});
const view = (stale: boolean | undefined): GroupViewV1 => ({
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 1,
  summary: { groupId: "g", state: "draft", commandRevision: 3, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1,
  plan: { repoId: "orca", planId: "plan-demo", planHash: PLAN, goal: "Ship", successConditions: ["passes"] },
  proposal: { state: "editable", proposalVersion: 2, planHash: PLAN, budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
  ledger: { groupLimit: amount(90_000), used: amount(0), committedRemaining: amount(4_300), explicitUnallocatedReserve: amount(6_000), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [
    { ownerKind: "task", ownerId: "c", bucket: "work", state: "draft-encumbered", amount: amount(3_000), fieldProvenance: provenance },
    { ownerKind: "task", ownerId: "c", bucket: "handoff", state: "draft-encumbered", amount: amount(300), fieldProvenance: provenance },
    { ownerKind: "goal-review", ownerId: "g:goal-review", bucket: "review", state: "draft-encumbered", amount: amount(1_000), fieldProvenance: provenance },
  ],
  workItems: [{ taskId: "c", status: "draft", dependencyTaskIds: [], targetVersion: 1, configHash: null, originalContractHash: "e".repeat(64), derivedContractHash: null, currentRunId: null, pendingRunId: null, lineageRunIds: [], loopPlan: null }],
  estimates: [estimate(stale)], runs: [], checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
});

afterEach(cleanup);

describe("a stale estimate's suggestions (W6)", () => {
  it("offers a current estimate's suggestions and no notice", () => {
    for (const stale of [false, undefined]) {
      expect(suggestedOperations(view(stale), { kind: "all" })).toHaveLength(4);
      const { container } = render(<BudgetEditor view={view(stale)} config={config} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
      expect(container.textContent).not.toContain(NOTICE);
      expect(screen.getByRole("button", { name: "Apply all suggestions" })).toBeTruthy();
      cleanup();
    }
  });

  it("says a stale estimate predates a plan change and offers none of its suggestions", () => {
    expect(suggestedOperations(view(true), { kind: "all" })).toEqual([]);
    const onCommand = vi.fn();
    const { container } = render(<BudgetEditor view={view(true)} config={config} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    expect(screen.getByText(NOTICE).tagName).toBe("P");
    expect(screen.queryByRole("button", { name: "Apply all suggestions" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Apply row / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^use \d+ for / })).toBeNull();
    // The model's reasons are still readable; only applying is withdrawn.
    expect(container.textContent).toContain("one small change");
    expect(onCommand).not.toHaveBeenCalled();
  });
});
