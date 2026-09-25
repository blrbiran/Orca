import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ControlPanel } from "../src/ControlPanel.js";
import { BudgetEditor, budgetFieldKey } from "../src/BudgetEditor.js";
import { RecoveryView } from "../src/RecoveryView.js";
import type { ControlClientState } from "../src/controlState.js";
import type { Amount, ControlConfigV1, GroupViewV1, RecoveryViewV1, ControlSummaryV1 } from "../src/controlTypes.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const provenance = (field: "complex-1m-default" | "model" | "human" | "system", estimateId: string | null = null) => ({
  tokens: { provenance: field, estimateId }, activeMs: { provenance: field, estimateId }, attempts: { provenance: field, estimateId }, sessions: { provenance: field, estimateId },
});

const config: ControlConfigV1 = {
  schema: "orca-control-config-v1",
  epoch: "epoch-a",
  repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{
    profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"],
    contextTokenizer: null, workMaxOutputTokens: 1000,
    declared: { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null },
    observed: { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null },
    observedAt: "2026-09-21T00:00:00.000Z", probeFailureCode: null,
  }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" },
  executionPort: "configured",  // Task 4b fixture: these criteria are not about the port.
  errorCatalog: [{ code: "revision-conflict", status: 409 }],
};

function groupView(over: Partial<GroupViewV1> = {}): GroupViewV1 {
  return {
    schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 4,
    summary: { groupId: "g", state: "running", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
    graphVersion: 1,
    plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship web control", successConditions: ["panel serves"] },
    proposal: { state: "confirmed", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null }, profiles: {
      estimator: { profileId: "all", profileHash: "b".repeat(64) }, worker: { profileId: "all", profileHash: "b".repeat(64) },
      handoff: { profileId: "all", profileHash: "b".repeat(64) }, goalReview: { profileId: "all", profileHash: "b".repeat(64) } }, executionSnapshotHash: "c".repeat(64) },
    ledger: { groupLimit: amount(9_000_000), used: amount(1_000_000), committedRemaining: amount(3_000_000), explicitUnallocatedReserve: amount(5_000_000), budgetDeficit: amount(0), usageUnknown: false },
    allocations: [
      { ownerKind: "task", ownerId: "a", bucket: "work", state: "active", amount: amount(3_000_000), fieldProvenance: provenance("complex-1m-default") },
      { ownerKind: "task", ownerId: "b", bucket: "work", state: "draft-encumbered", amount: amount(2_000_000), fieldProvenance: provenance("model", "est-1") },
      { ownerKind: "goal-review", ownerId: "review", bucket: "review", state: "confirmed", amount: amount(1_000_000), fieldProvenance: provenance("human") },
      { ownerKind: "reserve", ownerId: "reserve", bucket: "reserve", state: "confirmed", amount: amount(5_000_000), fieldProvenance: provenance("system") },
    ],
    workItems: [
      // Seam B (human ruling 2026-09-24, named under ruling 88): targetVersion is one positive safe integer from plan to wire.
      { taskId: "a", status: "active", dependencyTaskIds: [], targetVersion: 1, configHash: "d".repeat(64), originalContractHash: "e".repeat(64), derivedContractHash: "f".repeat(64), currentRunId: "run-a", pendingRunId: null, lineageRunIds: ["run-a"] },
      { taskId: "b", status: "ready", dependencyTaskIds: ["a"], targetVersion: 1, configHash: "d".repeat(64), originalContractHash: "e".repeat(64), derivedContractHash: "f".repeat(64), currentRunId: null, pendingRunId: null, lineageRunIds: [] },
    ],
    estimates: [{ estimateId: "est-1", estimateVersion: 1, state: "ready", profile: { profileId: "all", profileHash: "b".repeat(64) }, mode: "soft", requestHash: "1".repeat(64), outputHash: "2".repeat(64), output: null, reasonCode: null }],
    runs: [{ runId: "run-a", taskId: "a", estimateId: null, generation: 1, state: "running", phase: "work", claimOrdinal: 1, providerAttemptOrdinal: 1, profile: { profileId: "all", profileHash: "b".repeat(64) }, used: amount(1_000_000), remaining: amount(2_000_000), failureCode: null, evidenceIds: ["ev-1"] }],
    checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: ["start-1"],
    ...over,
  };
}

const summary: ControlSummaryV1 = {
  schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq: 4, resetRequired: false, dispatchBlocked: false,
  groups: [{ groupId: "g", state: "running", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 }],
};

const emptyRecovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [] };

function panelProps(over: Partial<Parameters<typeof ControlPanel>[0]> = {}): Parameters<typeof ControlPanel>[0] {
  return {
    config, summary, recovery: emptyRecovery, groups: { g: groupView() }, selected: "g",
    drafts: {}, uncertain: [], refusal: null, refetchRequired: false,
    onSelect: vi.fn(), onCommand: vi.fn(), onDraft: vi.fn(), ...over,
  };
}

const emptyDrafts: ControlClientState["drafts"] = {};

describe("ControlPanel", () => {
  it("shows the group list, its state, and the confirmed profiles and limits", () => {
    const html = renderToStaticMarkup(<ControlPanel {...panelProps()} />);
    expect(html).toContain("g");
    expect(html).toContain("running");
    expect(html).toContain("soft");
    expect(html).toContain("9000000");
    expect(html).toContain("b".repeat(64).slice(0, 12));
  });

  it("offers pause and handoff stop while dispatch is live, and never an immediate kill", () => {
    const html = renderToStaticMarkup(<ControlPanel {...panelProps()} />);
    expect(html).toContain("Pause dispatch");
    expect(html).toContain("Handoff stop");
    expect(html.toLowerCase()).not.toContain("kill");
  });

  it("shows a paused group with resume-dispatch instead of a handoff continuation", () => {
    const view = groupView({ stop: { mode: "pause", state: "paused", frozenRunIds: ["run-a"], acceptedAt: "2026-09-21T00:00:00.000Z", deadlineAt: null },
      summary: { ...summary.groups[0], state: "running", stopMode: "pause", stopState: "paused" } });
    const html = renderToStaticMarkup(<ControlPanel {...panelProps({ groups: { g: view }, summary: { ...summary, groups: [view.summary] } })} />);
    expect(html).toContain("paused");
    expect(html).toContain("Resume dispatch");
  });

  // Handoff delivery (human ruling 2026-09-25, spec §12: this slice may rewrite criteria; ruling 88 (b)(c)): the batch continuation is offered only for a run the server marks continuable (a handoff left a partial checkpoint), never for a normally completed run that also displays settled-recoverable.
  it("shows handoff progress as pending/partial/unresolved and offers the batch continuation once requests settle", () => {
    const view = groupView({
      summary: { ...summary.groups[0], stopMode: "handoff", stopState: "handoff-unresolved" },
      stop: { mode: "handoff", state: "handoff-unresolved", frozenRunIds: ["run-a"], acceptedAt: "2026-09-21T00:00:00.000Z", deadlineAt: "2026-09-21T00:30:00.000Z" },
      handoffRequests: [{ requestId: "handoff-1", runId: "run-a", state: "outcome-unknown", deadlineAt: "2026-09-21T00:30:00.000Z", phaseAttemptOrdinal: 1, failureCode: null, evidenceIds: ["ev-2"] }],
      recoveryBlockers: [{ scope: "run", code: "handoff-outcome-unknown", runId: "run-a", evidenceIds: ["ev-2"] }],
    });
    const html = renderToStaticMarkup(<ControlPanel {...panelProps({ groups: { g: view }, summary: { ...summary, groups: [view.summary] }, recovery: { ...emptyRecovery, blockers: [{ scope: "run", groupId: "g", runId: "run-a", code: "handoff-outcome-unknown", evidenceIds: ["ev-2"] }] } })} />);
    expect(html).toContain("handoff-unresolved");
    expect(html).toContain("outcome-unknown");
    expect(html).toContain("2026-09-21T00:30:00.000Z");
    expect(html).not.toContain("Resume dispatch");
    const settled = groupView({ ...view, stop: { ...view.stop!, state: "handoff-complete" },
      summary: { ...view.summary, stopState: "handoff-complete" },
      workItems: [{ ...view.workItems[0], status: "held", currentRunId: null }],
      checkpoints: [{ checkpointId: "cp-1", taskId: "a", runId: "run-a", state: "partial", snapshotHash: "9".repeat(64), evidenceIds: ["ev-1"] }],
      runs: [{ ...view.runs[0], state: "settled-recoverable", continuable: true }], handoffRequests: [], recoveryBlockers: [] });
    const settledHtml = renderToStaticMarkup(<ControlPanel {...panelProps({ groups: { g: settled }, summary: { ...summary, groups: [settled.summary] } })} />);
    expect(settledHtml).toContain("Continue selected tasks (1)");
    expect(settledHtml).toContain("Continue task a");
    expect(settledHtml).toContain("settled-recoverable");
    // The same settled run finished normally: it still displays settled-recoverable, but it is not continuable.
    const completed = groupView({ ...settled, workItems: [{ ...view.workItems[0], status: "completed", currentRunId: "run-a" }],
      checkpoints: [{ ...settled.checkpoints[0], state: "complete" }], runs: [{ ...settled.runs[0], continuable: false }] });
    const completedHtml = renderToStaticMarkup(<ControlPanel {...panelProps({ groups: { g: completed }, summary: { ...summary, groups: [completed.summary] } })} />);
    expect(completedHtml).toContain("settled-recoverable");
    expect(completedHtml).not.toContain("Continue selected tasks");
    expect(completedHtml).not.toContain("Continue task a");
  });

  it("names an uncertain command and a dispatch block instead of guessing an outcome", () => {
    const html = renderToStaticMarkup(<ControlPanel {...panelProps({
      uncertain: [{ groupId: "g", commandId: "start-2" }],
      summary: { ...summary, dispatchBlocked: true },
      recovery: { ...emptyRecovery, dispatchBlocked: true, blockers: [{ scope: "global", groupId: "", runId: null, code: "attempt-outcome-unknown", evidenceIds: [] }] },
    })} />);
    expect(html).toContain("start-2");
    expect(html).toContain("dispatch blocked");
    expect(html).toContain("attempt-outcome-unknown");
  });

  it("renders the server's typed error code and revision verbatim", () => {
    const html = renderToStaticMarkup(<ControlPanel {...panelProps({ refusal: { status: 409, code: "revision-conflict", message: "expectedRevision is stale", commandRevision: 8 } })} />);
    expect(html).toContain("revision-conflict");
    expect(html).toContain("409");
    expect(html).toContain("8");
  });

  it("keeps an unsaved draft visible where its field lives", () => {
    const key = budgetFieldKey("g", { scope: "task", taskId: "b", allocation: "work", dimension: "tokens" });
    const html = renderToStaticMarkup(<ControlPanel {...panelProps({ drafts: { [key]: "2500000" } })} />);
    expect(html).toContain(`value="2500000"`);
  });

  it("links run evidence and reports a projection refetch is needed", () => {
    const html = renderToStaticMarkup(<ControlPanel {...panelProps({ refetchRequired: true })} />);
    // This used to assert the manifest URL inside an `href`, which pinned the dead link:
    // `/api/control/*` answers to the `x-orca-token` header, so no href can load it. The
    // evidence control's real behaviour is judged in web/tests/evidenceLink.test.tsx.
    // Ruling (human, 2026-09-22): this rewrite of an existing criterion is ratified -- an
    // implementer may not change a judgement, so it was put up for approval and approved.
    expect(html).toContain(">evidence</button>");
    expect(html).toContain("projection refetch required");
  });
});

describe("BudgetEditor", () => {
  it("labels complex-1m defaults, model advice and human edits distinctly", () => {
    const html = renderToStaticMarkup(<BudgetEditor view={groupView()} config={config} drafts={emptyDrafts} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(html).toContain("complex-1m default");
    expect(html).toContain("model est-1");
    expect(html).toContain("human");
    expect(html).toContain("3000000");
    expect(html).toContain("2000000");
  });

  it("submits proposal edits and the confirmation as commands, never as local state", () => {
    const onCommand = vi.fn();
    const html = renderToStaticMarkup(<BudgetEditor view={groupView()} config={config} drafts={emptyDrafts} onDraft={vi.fn()} onCommand={onCommand} />);
    expect(html).toContain("Save proposal");
    expect(html).toContain("Confirm budget");
    expect(html).toContain("Re-estimate");
  });

  it("shows that a confirmed proposal is frozen against edits", () => {
    const html = renderToStaticMarkup(<BudgetEditor view={groupView({ proposal: { ...groupView().proposal, state: "confirmed" } })} config={config} drafts={emptyDrafts} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(html).toContain("confirmed");
    expect(html).not.toContain("snapshot pending");
  });
});

describe("RecoveryView", () => {
  it("lists blockers by scope with their evidence and a retry per target", () => {
    const html = renderToStaticMarkup(<RecoveryView recovery={{ ...emptyRecovery, dispatchBlocked: true, blockers: [
      { scope: "group", groupId: "g", runId: null, code: "cleanup-pending", evidenceIds: ["ev-3"] },
      { scope: "run", groupId: "g", runId: "run-a", code: "attempt-outcome-unknown", evidenceIds: ["ev-4"] },
    ] }} group={groupView({ recoveryBlockers: [{ scope: "run", code: "attempt-outcome-unknown", runId: "run-a", evidenceIds: ["ev-4"] }] })} onCommand={vi.fn()} />);
    expect(html).toContain("cleanup-pending");
    expect(html).toContain("run-a");
    expect(html).toContain("ev-3");
    expect(html).toContain("Retry recovery");
    expect(html).toContain("dispatch blocked");
  });

  it("stays silent when nothing blocks recovery", () => {
    const html = renderToStaticMarkup(<RecoveryView recovery={emptyRecovery} group={groupView()} onCommand={vi.fn()} />);
    expect(html).toContain("No recovery blockers");
  });
});
