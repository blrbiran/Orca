// @vitest-environment jsdom
/**
 * Retry work top-up spec 2026-11-06 §2 "The board", criterion T14 (its Web half; the view half is
 * tests/control/retryTopUp.test.ts): the budget editor lists every top-up of a task, `+<amount>, by <by>, at <at>`, so a
 * run's grant above the confirmed allocation is never unexplained. Fixture as budgetHandoffCapability.test.tsx's.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BudgetEditor } from "../src/BudgetEditor.js";
import type { Amount, CapabilityViewV1, ControlConfigV1, GroupViewV1 } from "../src/controlTypes.js";

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
const view: GroupViewV1 = {
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 1,
  summary: { groupId: "g", repoId: "orca", state: "draft", commandRevision: 3, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1,
  plan: { repoId: "orca", planId: "plan-demo", planHash: PLAN, goal: "Ship", successConditions: ["passes"] },
  proposal: { state: "editable", proposalVersion: 2, planHash: PLAN, budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
  ledger: { groupLimit: amount(90_000), used: amount(0), committedRemaining: amount(3_300), explicitUnallocatedReserve: amount(6_000), budgetDeficit: amount(0), usageUnknown: false, unmeteredRuns: 0 },
  allocations: [
    { ownerKind: "task", ownerId: "a", bucket: "work", state: "draft-encumbered", amount: amount(3_000), fieldProvenance: provenance },
    { ownerKind: "task", ownerId: "a", bucket: "handoff", state: "draft-encumbered", amount: amount(300), fieldProvenance: provenance },
  ],
  workItems: [{ taskId: "a", status: "draft", dependencyTaskIds: [], targetVersion: 1, configHash: null, originalContractHash: "e".repeat(64), derivedContractHash: null, currentRunId: null, pendingRunId: null, lineageRunIds: [],
    topUps: [{ amount: { tokens: 0, activeMs: 0, attempts: 2, sessions: 0 }, by: "user:u-owner", at: Date.UTC(2026, 10, 6, 9, 0, 0), fromRunId: "run-1" }] }],
  estimates: [], runs: [], checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
};
afterEach(cleanup);

describe("the budget editor lists a task's top-ups (T14)", () => {
  it("shows the amount, who and when, and nothing for a task without one", () => {
    const shown = render(<BudgetEditor view={view} config={config(DURABLE)} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />).container.textContent ?? "";
    expect(shown).toContain("+attempts 2, by user:u-owner, at 2026-11-06T09:00:00.000Z");
    cleanup();
    const none = { ...view, workItems: view.workItems.map(({ topUps: _topUps, ...item }) => item) };
    expect(render(<BudgetEditor view={none} config={config(DURABLE)} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />).container.textContent ?? "").not.toContain("by user:u-owner");
  });
});
