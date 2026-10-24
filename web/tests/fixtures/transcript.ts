/**
 * Live transcript web criteria: one group with one running run, copied from web/tests/evidenceLink.test.tsx's fixture
 * (the group view and config a ControlGroupView renders with).
 */
import type { Amount, ControlConfigV1, GroupViewV1 } from "../../src/controlTypes.js";

export const RUN = "run-a";
const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const provenance = {
  tokens: { provenance: "human" as const, estimateId: null }, activeMs: { provenance: "human" as const, estimateId: null },
  attempts: { provenance: "human" as const, estimateId: null }, sessions: { provenance: "human" as const, estimateId: null },
};

export const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a",
  repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{
    profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task"],
    contextTokenizer: null, workMaxOutputTokens: 1000,
    declared: { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null },
    observed: { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null },
    observedAt: "2026-09-21T00:00:00.000Z", probeFailureCode: null,
  }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" },
  executionPort: "configured",  // Task 4b fixture: these criteria are not about the port.
  errorCatalog: [{ code: "unauthorized", status: 401 }],
};

export const view: GroupViewV1 = {
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 4, graphVersion: 1,
  summary: { groupId: "g", repoId: "orca", state: "running", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 1 },
  plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship web control", successConditions: ["panel serves"] },
  proposal: { state: "confirmed", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null }, profiles: {
    estimator: { profileId: "all", profileHash: "b".repeat(64) }, worker: { profileId: "all", profileHash: "b".repeat(64) },
    handoff: { profileId: "all", profileHash: "b".repeat(64) }, goalReview: { profileId: "all", profileHash: "b".repeat(64) } }, executionSnapshotHash: "c".repeat(64) },
  ledger: { groupLimit: amount(9_000_000), used: amount(1_000_000), committedRemaining: amount(3_000_000), explicitUnallocatedReserve: amount(5_000_000), budgetDeficit: amount(0), usageUnknown: false, unmeteredRuns: 0 },
  allocations: [{ ownerKind: "task", ownerId: "a", bucket: "work", state: "active", amount: amount(3_000_000), fieldProvenance: provenance }],
  // Seam B (human ruling 2026-09-24, named under ruling 88): targetVersion is one positive safe integer from plan to wire.
  workItems: [{ taskId: "a", status: "active", dependencyTaskIds: [], targetVersion: 1, configHash: "d".repeat(64), originalContractHash: "e".repeat(64), derivedContractHash: "f".repeat(64), currentRunId: RUN, pendingRunId: null, lineageRunIds: [RUN] }],
  estimates: [],
  runs: [{ runId: RUN, taskId: "a", estimateId: null, generation: 1, state: "running", phase: "work", claimOrdinal: 1, providerAttemptOrdinal: 1, profile: { profileId: "all", profileHash: "b".repeat(64) }, used: amount(1_000_000), remaining: amount(2_000_000), failureCode: null, evidenceIds: ["ev-1"] }],
  checkpoints: [], handoffRequests: [], stop: null,
  recoveryBlockers: [{ scope: "run", code: "attempt-outcome-unknown", runId: RUN, evidenceIds: ["ev-1"] }],
  recentCommandIds: [],
};
