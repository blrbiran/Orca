// @vitest-environment jsdom
/**
 * Tester follow-up F §4 (#173): an estimator profile pinned to an older estimate instruction was named only in the CLI's
 * human output of `group estimate` / `group confirm`. The budget editor, where the estimate is shown, names it too.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BudgetEditor } from "../src/BudgetEditor.js";
import type { Amount, ControlConfigV1, GroupViewV1 } from "../src/controlTypes.js";
import { NEWEST_ESTIMATE_INSTRUCTION } from "../../src/control/estimateInstructionAge.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 2, sessions: 1 });
const human = { provenance: "human", estimateId: null } as const;
const provenance = { tokens: human, activeMs: human, attempts: human, sessions: human };
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "realtime", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config = (version: string | null | undefined): ControlConfigV1 => ({
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{ profileId: "est", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-10-01T00:00:00.000Z", probeFailureCode: null,
    ...(version === undefined ? {} : { estimatorInstructionVersion: version }) }],
  defaults: { estimatorProfileId: "est", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
});
const PLAN = "a".repeat(64);
const view: GroupViewV1 = {
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 1,
  summary: { groupId: "g", repoId: "orca", state: "draft", commandRevision: 3, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1,
  plan: { repoId: "orca", planId: "plan-demo", planHash: PLAN, goal: "Ship", successConditions: ["passes"] },
  proposal: { state: "editable", proposalVersion: 2, planHash: PLAN, budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
  ledger: { groupLimit: amount(90_000), used: amount(0), committedRemaining: amount(4_300), explicitUnallocatedReserve: amount(6_000), budgetDeficit: amount(0), usageUnknown: false, unmeteredRuns: 0 },
  allocations: [{ ownerKind: "task", ownerId: "c", bucket: "work", state: "draft-encumbered", amount: amount(3_000), fieldProvenance: provenance }],
  workItems: [{ taskId: "c", status: "draft", dependencyTaskIds: [], targetVersion: 1, configHash: null, originalContractHash: "e".repeat(64), derivedContractHash: null, currentRunId: null, pendingRunId: null, lineageRunIds: [], loopPlan: null }],
  estimates: [], runs: [], checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
};

afterEach(cleanup);

describe("an older estimate instruction in the budget editor (#173)", () => {
  it("names the estimator profile, its instruction and the newest", () => {
    render(<BudgetEditor view={view} config={config("1")} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.getByTestId("budget-older-instruction").textContent)
      .toBe(`Estimator profile est uses estimate instruction 1; the newest is ${NEWEST_ESTIMATE_INSTRUCTION}. Its estimates follow the older instruction; update the profile's estimatorPreflight.instructionVersion to use the newest.`);
  });

  it.each([["the newest", String(NEWEST_ESTIMATE_INSTRUCTION)], ["no preflight", null], ["an older panel", undefined]] as const)("says nothing under %s", (_label, version) => {
    render(<BudgetEditor view={view} config={config(version)} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.queryByTestId("budget-older-instruction")).toBeNull();
  });
});
