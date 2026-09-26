// @vitest-environment jsdom
/**
 * Agent selection spec §6.4 step 3 (§12 C4), plan W5-M9 / review P11: a confirmation carries the hash of the
 * selections the operator saw. Until the panel has previewed them (plan T15 wires the preview) the Confirm button
 * must send nothing -- a confirmation without a selectionsHash would be refused by the server anyway, and sending
 * one bound to no preview is exactly what the hash exists to prevent.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BudgetEditor } from "../src/BudgetEditor.js";
import type { Amount, ControlConfigV1, GroupViewV1 } from "../src/controlTypes.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const provenance = { tokens: { provenance: "human", estimateId: null }, activeMs: { provenance: "human", estimateId: null }, attempts: { provenance: "human", estimateId: null }, sessions: { provenance: "human", estimateId: null } } as const;
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-09-26T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
const view: GroupViewV1 = {
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 1,
  summary: { groupId: "g", state: "draft", commandRevision: 3, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1,
  plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship", successConditions: ["passes"] },
  proposal: { state: "editable", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
  ledger: { groupLimit: amount(9_000), used: amount(0), committedRemaining: amount(3_000), explicitUnallocatedReserve: amount(6_000), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [{ ownerKind: "task", ownerId: "a", bucket: "work", state: "draft-encumbered", amount: amount(3_000), fieldProvenance: provenance }],
  workItems: [{ taskId: "a", status: "draft", dependencyTaskIds: [], targetVersion: 1, configHash: null, originalContractHash: "e".repeat(64), derivedContractHash: null, currentRunId: null, pendingRunId: null, lineageRunIds: [] }],
  estimates: [], runs: [], checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
};

afterEach(cleanup);

describe("confirming needs the previewed selectionsHash (agent selection spec §6.4 step 3)", () => {
  it("does not send a confirmation when no selectionsHash was previewed", () => {
    const onCommand = vi.fn();
    render(<BudgetEditor view={view} config={config} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm budget" }));
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("sends the previewed selectionsHash with the confirmation", () => {
    const onCommand = vi.fn();
    render(<BudgetEditor view={view} config={config} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} selectionsHash={"9".repeat(64)} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm budget" }));
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand.mock.calls[0]![0]).toMatchObject({ verb: "confirm", groupId: "g", payload: { selectionsHash: "9".repeat(64), proposalVersion: 2 } });
  });
});
