// @vitest-environment jsdom
/**
 * Backlog #11(b) (2026-09-29; Orca handoff §9.1): handoffControl and handoffExecution decide whether work bound to a
 * profile can be dispatched at all (webDispatch.ts probeBlocksDispatch, budget.ts assertCapabilities), yet a refused
 * dispatch showed only claim-capability-unavailable. The editor names the two values for every profile they refuse.
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
  ledger: { groupLimit: amount(90_000), used: amount(0), committedRemaining: amount(3_300), explicitUnallocatedReserve: amount(6_000), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [
    { ownerKind: "task", ownerId: "a", bucket: "work", state: "draft-encumbered", amount: amount(3_000), fieldProvenance: provenance },
    { ownerKind: "task", ownerId: "a", bucket: "handoff", state: "draft-encumbered", amount: amount(300), fieldProvenance: provenance },
  ],
  workItems: [{ taskId: "a", status: "draft", dependencyTaskIds: [], targetVersion: 1, configHash: null, originalContractHash: "e".repeat(64), derivedContractHash: null, currentRunId: null, pendingRunId: null, lineageRunIds: [] }],
  estimates: [], runs: [], checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
};
const text = (c: ControlConfigV1): string => {
  const shown = render(<BudgetEditor view={view} config={c} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />).container.textContent ?? "";
  cleanup();
  return shown;
};

afterEach(cleanup);

describe("the budget editor names handoff capabilities that refuse dispatch (backlog #11(b))", () => {
  it("names each task or handoff profile whose handoff control or execution refuses dispatch, and nothing otherwise", () => {
    expect(text(config(DURABLE))).not.toContain("handoff control");
    expect(text(config({ ...DURABLE, handoffControl: "phase-end" }))).toContain(
      "profile all: handoff control phase-end · handoff execution mechanical-in-run-v1 · work bound to it is not dispatched (claim-capability-unavailable)",
    );
    expect(text(config({ ...DURABLE, handoffExecution: null }))).toContain(
      "profile all: handoff control durable · handoff execution none · work bound to it is not dispatched (claim-capability-unavailable)",
    );
    // An estimator-only profile carries no task or handoff work, so its handoff capabilities refuse nothing.
    expect(text(config({ ...DURABLE, handoffControl: "unavailable" }, ["budget-estimate"]))).not.toContain("handoff control");
  });
});
