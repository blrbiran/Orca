export type Amount = { tokens: number; activeMs: number; attempts: number; sessions: number };
export type WorkKind = "budget-estimate" | "task" | "handoff" | "goal-review";
export type ProfileBindingV1 = { profileId: string; profileHash: string };

export type CapabilityViewV1 = {
  usageObservation: "realtime" | "phase-end" | "unavailable";
  budgetEnforcement: "bounded" | "soft" | "unavailable";
  contextObservation: "realtime" | "phase-end" | "unavailable";
  handoffControl: "durable" | "phase-end" | "unavailable";
  handoffExecution: "mechanical-in-run-v1" | "model-assisted-v1" | null;
  contextWindowTokens: number | null;
  requestBoundProof: null | {
    scheme: "adapter-request-bound-v1";
    version: string;
    workDimensions: Array<keyof Amount>;
    handoffDimensions: Array<keyof Amount>;
    evidenceKind: string;
  };
};

export type ControlConfigV1 = {
  schema: "orca-control-config-v1";
  epoch: string;
  repositories: Array<{ repoId: string; displayName: string }>;
  plans: Array<{ planId: string; repoId: string; displayName: string }>;
  profiles: Array<{
    profileId: string;
    profileHash: string;
    allowedWorkKinds: WorkKind[];
    contextTokenizer: null | { tokenizerId: string; tokenizerVersion: string };
    workMaxOutputTokens: number | null;
    declared: CapabilityViewV1;
    observed: CapabilityViewV1;
    observedAt: string;
    probeFailureCode: string | null;
  }>;
  /** null when this panel was started without --estimator-profile/--estimate-mode (ruling R7). */
  defaults: null | { estimatorProfileId: string; estimatorProfileHash: string; estimateMode: "strict" | "soft" };
  /** Ruling R6. The only authority on whether a port is configured; not probeFailureCode. */
  executionPort: "configured" | "unconfigured";
  errorCatalog: Array<{ code: string; status: number }>;
};

export type GroupSummaryV1 = {
  groupId: string;
  state: "draft" | "ready" | "running" | "review" | "done" | "blocked";
  commandRevision: number;
  projectionSeq: number;
  stopMode: null | "pause" | "shutdown" | "handoff";
  stopState: null | "paused" | "handoff-pending" | "handoff-partial" | "handoff-unresolved" | "handoff-complete";
  claimBlocked: boolean;
  recoveryBlockerCount: number;
};

export type ControlSummaryV1 = {
  schema: "orca-control-summary-v1";
  epoch: string;
  changeSeq: number;
  resetRequired: boolean;
  dispatchBlocked: boolean;
  groups: GroupSummaryV1[];
};

export type FieldProvenanceV1 = { provenance: "complex-1m-default" | "model" | "human" | "system"; estimateId: string | null };
export type AmountProvenanceV1 = { tokens: FieldProvenanceV1; activeMs: FieldProvenanceV1; attempts: FieldProvenanceV1; sessions: FieldProvenanceV1 };
export type AllocationViewV1 = {
  ownerKind: "estimate" | "task" | "goal-review" | "reserve";
  ownerId: string;
  bucket: "work" | "handoff" | "review" | "reserve";
  state: "draft-encumbered" | "confirmed" | "active" | "held" | "continuing" | "terminal" | "unknown";
  amount: Amount;
  fieldProvenance: AmountProvenanceV1;
};
export type WorkItemViewV1 = {
  taskId: string;
  status: "draft" | "ready" | "starting" | "start-unknown" | "active" | "held" | "continuing" | "completed" | "blocked";
  dependencyTaskIds: string[];
  targetVersion: number;
  configHash: string;
  originalContractHash: string;
  derivedContractHash: string | null;
  currentRunId: string | null;
  pendingRunId: string | null;
  lineageRunIds: string[];
};
export type RunViewV1 = {
  runId: string;
  taskId: string | null;
  estimateId: string | null;
  generation: number;
  state: "starting" | "unknown" | "attempt-unknown" | "attempt-proof-invalid" | "running" | "failed-before-provider" | "settled-recoverable" | "settled-restartable" | "settled-unrecoverable";
  phase: "estimate" | "work" | "handoff";
  claimOrdinal: number | null;
  providerAttemptOrdinal: number;
  profile: ProfileBindingV1;
  used: Amount;
  remaining: Amount;
  failureCode: string | null;
  evidenceIds: string[];
};
export type BudgetEstimateV1 = {
  schema: "budget-estimate-v1";
  planHash: string;
  tasks: Array<{
    taskId: string;
    complexity: "S" | "M" | "L" | "XL";
    confidence: "low" | "medium" | "high";
    work: Amount;
    handoff: Amount;
    rationale: string;
    assumptions: string[];
  }>;
  goalReviewReserve: Amount;
  groupRationale: string;
};
export type EstimateViewV1 = {
  estimateId: string;
  estimateVersion: number;
  state: "queued" | "running" | "start-unknown" | "ready" | "failed" | "interrupted" | "blocked-capability" | "input-too-large";
  profile: ProfileBindingV1;
  mode: "strict" | "soft";
  requestHash: string | null;
  outputHash: string | null;
  output: BudgetEstimateV1 | null;
  reasonCode: string | null;
};
export type CheckpointViewV1 = { checkpointId: string; taskId: string; runId: string; state: "complete" | "partial" | "unknown"; snapshotHash: string | null; evidenceIds: string[] };
export type HandoffRequestViewV1 = {
  requestId: string;
  runId: string;
  state: "request-pending" | "latched" | "collecting" | "settled-recoverable" | "settled-restartable" | "settled-unrecoverable" | "outcome-unknown";
  deadlineAt: string;
  phaseAttemptOrdinal: number;
  failureCode: string | null;
  evidenceIds: string[];
};
export type GroupViewV1 = {
  schema: "orca-control-group-v1";
  epoch: string;
  changeSeq: number;
  summary: GroupSummaryV1;
  graphVersion: number;
  plan: { repoId: string; planId: string; planHash: string; goal: string; successConditions: string[] };
  proposal: {
    state: "editable" | "confirmed";
    proposalVersion: number;
    planHash: string;
    budgetMode: "strict" | "soft" | null;
    contextPolicy: { handoffAtContextTokens: number | null };
    profiles: null | { estimator: ProfileBindingV1; worker: ProfileBindingV1; handoff: ProfileBindingV1; goalReview: ProfileBindingV1 };
    executionSnapshotHash: string | null;
  };
  ledger: { groupLimit: Amount; used: Amount; committedRemaining: Amount; explicitUnallocatedReserve: Amount; budgetDeficit: Amount; usageUnknown: boolean };
  allocations: AllocationViewV1[];
  workItems: WorkItemViewV1[];
  estimates: EstimateViewV1[];
  runs: RunViewV1[];
  checkpoints: CheckpointViewV1[];
  handoffRequests: HandoffRequestViewV1[];
  stop: null | { mode: "pause" | "shutdown" | "handoff"; state: "paused" | "handoff-pending" | "handoff-partial" | "handoff-unresolved" | "handoff-complete"; frozenRunIds: string[]; acceptedAt: string | null; deadlineAt: string | null };
  recoveryBlockers: Array<{ scope: "global" | "group" | "run"; code: string; runId: string | null; evidenceIds: string[] }>;
  recentCommandIds: string[];
};

export type RecoveryViewV1 = {
  schema: "orca-control-recovery-v1";
  epoch: string;
  dispatchBlocked: boolean;
  blockers: Array<{ scope: "global" | "group" | "run"; groupId: string; runId: string | null; code: string; evidenceIds: string[] }>;
};
export type EvidenceManifestV1 = {
  schema: "orca-run-evidence-v1";
  runId: string;
  entries: Array<{ evidenceId: string; kind: string; sha256: string; byteLength: number; downloadUrl: string }>;
};

export type CommandErrorV1 = { code: string; message: string; commandRevision: number | null; evidenceIds: string[]; retryable: boolean };
export type CommandTargetV1 =
  | { kind: "group"; groupId: string }
  | { kind: "task"; groupId: string; taskId: string }
  | { kind: "run"; groupId: string; runId: string }
  | { kind: "global"; epoch: string };

/** What a mutation POST carries: an id the ledger dedupes on, the revision it expects, and the verb's payload. */
export type CommandEnvelopeV1 = { commandId: string; expectedRevision: number; payload?: unknown };
export type AmountDimensionV1 = "tokens" | "activeMs" | "attempts" | "sessions";
export type ProposalTargetV1 =
  | { scope: "task"; taskId: string; allocation: "work" | "handoff"; dimension: AmountDimensionV1 }
  | { scope: "goal-review"; dimension: AmountDimensionV1 };
export type ProposalOperationV1 = {
  target: ProposalTargetV1;
  value: number;
  provenance: "complex-1m-default" | "model" | "human";
  estimateId?: string;
};
export type ProposalEditPayloadV1 = { baseProposalVersion: number; operations: ProposalOperationV1[]; proposedGroupLimit?: Amount };
export type EstimatePayloadV1 = { proposalVersion: number; estimatorProfileId: string; estimatorProfileHash: string; estimateMode: "strict" | "soft" };
export type ConfirmPayloadV1 = {
  planHash: string;
  proposalVersion: number;
  budgetMode: "strict" | "soft";
  profileIds: { estimator: string; worker: string; handoff: string; goalReview: string };
  profileHashes: { estimator: string; worker: string; handoff: string; goalReview: string };
  contextPolicy: { handoffAtContextTokens: number | null };
};
export type SetLimitPayloadV1 = { limit: Amount };
export type ImportPlanPayloadV1 = {
  groupId: string;
  repoId: string;
  planId: string;
  estimatorProfileId?: string;
  estimatorProfileHash?: string;
  estimateMode?: "strict" | "soft";
};
export type HandoffStopPayloadV1 = { handoffDeadlineAt?: string };
export type ContinuationSelectionV1 = { taskId: string; predecessorRunId: string; checkpointId: string };
export type ResumeFromHandoffPayloadV1 = { selections: ContinuationSelectionV1[] };
export type ContinueTaskPayloadV1 = { predecessorRunId: string; checkpointId: string };
export type RecoveryRetryPayloadV1 = { scope: "run"; runId: string } | { scope: "group"; groupId: string };

export type CommandSuccessV1 = {
  schema: "orca-command-success-v1";
  commandId: string;
  actorId: string;
  verb: "import-plan" | "proposal-edit" | "estimate" | "confirm" | "start" | "pause-dispatch" | "handoff-stop" | "resume-dispatch" | "resume-from-handoff" | "set-limit" | "continue-task" | "recovery-retry" | "shutdown";
  target: CommandTargetV1;
  commandRevision: number | null;
  projectionSeq: number | null;
  effectivePayloadHash: string;
  authorityCommandHash: string;
  result:
    | { kind: "imported"; groupId: string; estimateId: string; estimateState: "queued" | "blocked-capability" | "input-too-large"; estimateReasonCode: string | null }
    | { kind: "proposal-edited"; proposalVersion: number }
    | { kind: "estimate-created"; estimateId: string; estimateVersion: number; estimateState: "queued" | "blocked-capability" | "input-too-large"; reasonCode: string | null; wakeId: string | null }
    | { kind: "confirmed"; executionSnapshotHash: string }
    | { kind: "scheduled"; operation: "start" | "resume-dispatch"; wakeId: string }
    | { kind: "paused"; stopMode: "pause" }
    | { kind: "handoff-stopped"; stopRevision: number; acceptedAt: string; handoffDeadlineAt: string; frozenRunIds: string[]; requestIds: string[] }
    | { kind: "resumed-from-handoff"; wakeId: string; pendingRuns: Array<{ taskId: string; continuationIntentId: string; pendingRunId: string; claimOrdinal: number }> }
    | { kind: "limit-set"; limit: Amount }
    | { kind: "task-continuing"; continuationIntentId: string; pendingRunId: string; claimOrdinal: number; wakeId: string }
    | { kind: "recovery-observed"; resolved: boolean; blockerCodes: string[]; evidenceIds: string[]; wakeIds: string[] }
    | { kind: "shutdown"; groups: Array<{ groupId: string; disposition: "created" | "strengthened-pause" | "preserved-pause" | "preserved-handoff" | "preserved-shutdown" | "blocked-inconsistent"; changed: boolean; commandRevision: number; projectionSeq: number; frozenRunIds: string[]; requestIds: string[]; blockerCode: string | null }> };
};
export type CommandLookupV1 = { schema: "orca-command-lookup-v1"; originalStatus: number; body: CommandSuccessV1 | { error: CommandErrorV1 } };
