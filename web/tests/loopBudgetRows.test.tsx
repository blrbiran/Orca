// @vitest-environment jsdom
/**
 * Loop plans spec §4.3 (C6, Rule 7): a loop task's work budget has one owner, set-task-loop, changed on the task's plan
 * card. The budget editor shows that row read-only and pointing at the card, and never sends proposal-edit for it --
 * a typed edit is not possible there, and a suggestion goes through set-task-loop (human ruling H14, superseding plan
 * ruling R-F14). Every other row stays editable.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BudgetEditor, budgetFieldKey, editedOperations, suggestedOperations } from "../src/BudgetEditor.js";
import type { Amount, CapabilityViewV1, ControlConfigV1, EstimateViewV1, GroupViewV1, LoopPlanViewV1 } from "../src/controlTypes.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const human = { provenance: "human", estimateId: null } as const;
const provenance = { tokens: human, activeMs: human, attempts: human, sessions: human };
const PLAN = "a".repeat(64);
const DURABLE: CapabilityViewV1 = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "realtime", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null };
const config = (observed: CapabilityViewV1, allowedWorkKinds: ControlConfigV1["profiles"][number]["allowedWorkKinds"] = ["task", "budget-estimate", "handoff", "goal-review"]): ControlConfigV1 => ({
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds, contextTokenizer: null, workMaxOutputTokens: 1000, declared: observed, observed, observedAt: "2026-09-29T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
});
// Rewritten under human ruling H18 (2026-10-01) for panel i18n.
const LOOP_PLAN: LoopPlanViewV1 = {
  planId: "bugfix", planVersion: 1, chosenBy: "labels", chosenByLabel: "bug", amended: false, loopVersion: 0,
  inputs: { goal: "fix login", successCondition: "the login test passes", targetPaths: ["src/auth/**"], checks: ["npm test -- --run auth"], nonGoals: [], relevantDocs: [], protectedPaths: [], maxFilesTouched: null },
  maxFiles: 25, hasDiscipline: true,
};
const view: GroupViewV1 = {
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 1,
  summary: { groupId: "g", state: "draft", commandRevision: 3, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1,
  plan: { repoId: "orca", planId: "plan-demo", planHash: PLAN, goal: "Ship", successConditions: ["passes"] },
  proposal: { state: "editable", proposalVersion: 2, planHash: PLAN, budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
  ledger: { groupLimit: amount(90_000), used: amount(0), committedRemaining: amount(3_300), explicitUnallocatedReserve: amount(6_000), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [
    { ownerKind: "task", ownerId: "a", bucket: "work", state: "draft-encumbered", amount: amount(3_000), fieldProvenance: provenance },
    { ownerKind: "task", ownerId: "a", bucket: "handoff", state: "draft-encumbered", amount: amount(300), fieldProvenance: provenance },
    { ownerKind: "task", ownerId: "c", bucket: "work", state: "draft-encumbered", amount: amount(3_000), fieldProvenance: provenance },
    { ownerKind: "task", ownerId: "c", bucket: "handoff", state: "draft-encumbered", amount: amount(300), fieldProvenance: provenance },
  ],
  workItems: [
    { taskId: "a", status: "draft", dependencyTaskIds: [], targetVersion: 1, configHash: null, originalContractHash: "e".repeat(64), derivedContractHash: null, currentRunId: null, pendingRunId: null, lineageRunIds: [], loopPlan: LOOP_PLAN },
    { taskId: "c", status: "draft", dependencyTaskIds: [], targetVersion: 1, configHash: null, originalContractHash: "e".repeat(64), derivedContractHash: null, currentRunId: null, pendingRunId: null, lineageRunIds: [], loopPlan: null },
  ],
  estimates: [], runs: [], checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
};

afterEach(cleanup);

describe("a loop task's work row is the plan card's (spec §4.3)", () => {
  it("shows the loop task's work row read-only, pointing at the card, and leaves every other row editable", () => {
    const { container } = render(<BudgetEditor view={view} config={config(DURABLE)} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.queryByRole("textbox", { name: /^a work tokens/ })).toBeNull();
    expect(container.textContent).toContain("Change it in the plan card");
    expect(screen.getByRole("textbox", { name: /^a handoff tokens/ })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /^c work tokens/ })).toBeTruthy();
  });

  it("points only the loop task's own work row at the card, not another bucket of it nor another owner with its id", () => {
    // Neither row occurs today (final review, B4 MB4-9/10); each reaches the read-only cell, where only the guards keep
    // the hint off it.
    const odd: GroupViewV1 = { ...view, allocations: [
      ...view.allocations,
      { ownerKind: "task", ownerId: "a", bucket: "reserve", state: "draft-encumbered", amount: amount(1), fieldProvenance: provenance },
      { ownerKind: "estimate", ownerId: "a", bucket: "work", state: "draft-encumbered", amount: amount(2), fieldProvenance: provenance },
    ] };
    const { container } = render(<BudgetEditor view={odd} config={config(DURABLE)} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    const hinted = [...container.querySelectorAll("tbody tr")]
      .filter((row) => row.textContent?.includes("Change it in the plan card"))
      .map((row) => [...row.querySelectorAll("td")].slice(0, 2).map((cell) => cell.textContent).join(" / "));
    expect(hinted).toEqual(["task a / work"]);
  });

  it("never turns a draft of the loop task's work row into a proposal-edit operation", () => {
    const key = budgetFieldKey("g", { scope: "task", taskId: "a", allocation: "work", dimension: "tokens" });
    expect(editedOperations(view, { [key]: "5" })).toEqual([]);
    const other = budgetFieldKey("g", { scope: "task", taskId: "c", allocation: "work", dimension: "tokens" });
    expect(editedOperations(view, { [other]: "5" })).toEqual([{ target: { scope: "task", taskId: "c", allocation: "work", dimension: "tokens" }, value: 5, provenance: "human" }]);
  });

  // Rewritten under human ruling H14 (2026-10-01), superseding plan ruling R-F14.
  it("offers an Apply button on the loop task's work row that sends set-task-loop, and still offers the rest", () => {
    // A ready estimate for this plan that suggests 4000 work tokens for both tasks; handoff rows already match it.
    const estimate: EstimateViewV1 = {
      estimateId: "est-1", estimateVersion: 1, state: "ready", profile: { profileId: "all", profileHash: "b".repeat(64) }, mode: "soft",
      requestHash: "c".repeat(64), outputHash: "d".repeat(64), reasonCode: null,
      output: {
        schema: "budget-estimate-v1", planHash: PLAN, goalReviewReserve: amount(0), groupRationale: "two small changes",
        tasks: ["a", "c"].map((taskId) => ({ taskId, complexity: "M" as const, confidence: "high" as const, work: amount(4_000), handoff: amount(300), rationale: "small", assumptions: [] })),
      },
    };
    const advised: GroupViewV1 = { ...view, estimates: [estimate] };
    expect(suggestedOperations(advised, { kind: "all" })).toEqual([
      { target: { scope: "task", taskId: "c", allocation: "work", dimension: "tokens" }, value: 4_000, provenance: "model", estimateId: "est-1" },
      { target: { scope: "task", taskId: "c", allocation: "work", dimension: "activeMs" }, value: 40_000, provenance: "model", estimateId: "est-1" },
    ]);
    const onCommand = vi.fn();
    render(<BudgetEditor view={advised} config={config(DURABLE)} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    fireEvent.click(screen.getByRole("button", { name: "Apply row a work" }));
    // The task's current plan and inputs, the suggested dimensions replaced (attempts and sessions already match), and
    // the estimate named for exactly those dimensions.
    const model = { provenance: "model", estimateId: "est-1" };
    expect(onCommand.mock.calls.map((call) => call[0])).toEqual([{
      verb: "set-task-loop", groupId: "g", taskId: "a", expectedRevision: 3,
      payload: { baseLoopVersion: 0, plan: "bugfix", inputs: LOOP_PLAN.inputs, work: { tokens: 4_000, activeMs: 40_000, attempts: 1 }, workProvenance: { tokens: model, activeMs: model } },
    }]);
    expect(screen.getByRole("button", { name: "Apply row c work" })).toBeTruthy();
  });
});
