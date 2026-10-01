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

/** N1 spec §11.2: the requirement line of the summary (webProtocol.ts requirementSummarySchema, field for field). */
export type RequirementSummaryV1 = {
  roundNo: number | null;
  roundState: null | "drafting" | "awaiting-answers" | "answered" | "interrupted" | "failed";
  openQuestions: number;
  draftNo: number | null;
  draftState: null | "drafting" | "awaiting-review" | "accepted" | "rejected" | "invalid" | "interrupted" | "failed";
  waiting: null | "requirement-budget-exhausted" | "requirement-usage-unknown";
  reasonCode: string | null;
  exportState: "not-due" | "pending" | "done" | "conflict";
  used: Amount;
  reserved: Amount;
  limit: Amount;
  usageUnknown: boolean;
};

export type GroupSummaryV1 = {
  groupId: string;
  state: "clarifying" | "draft" | "ready" | "running" | "review" | "done" | "blocked";
  commandRevision: number;
  projectionSeq: number;
  stopMode: null | "pause" | "shutdown" | "handoff";
  stopState: null | "paused" | "handoff-pending" | "handoff-partial" | "handoff-unresolved" | "handoff-complete";
  claimBlocked: boolean;
  recoveryBlockerCount: number;
  /** Labels and progress spec §4.1: tasks done out of the plan's tasks. Optional so literal fixtures need no edit. */
  completion?: { done: number; total: number };
  /** N1 spec §11.2: present on a group that carries a requirement block. */
  requirement?: RequirementSummaryV1;
};

/** N1 spec §4.2 and §7: a round's records (src/control/requirementSchemas.ts roundBodySchema, field for field). */
export type RequirementCallRecordV1 = {
  runId: string;
  overviewHash: string | null;
  commit: string | null;
  usage: Amount | null;
  outcome: "valid" | "invalid" | "failed" | "interrupted";
  reason: string | null;
};
export type ClarifyResultV1 = {
  slug: string | null;
  statement: string;
  acceptanceCriteria: Array<{ id: string; text: string }>;
  questions: Array<{ id: string; key: string; question: string; recommendedAnswer: string; why: string; dependsOn: string[] }>;
  frontierEmpty: boolean;
  openBranches: string[];
  glossary: Array<{ id: string; term: string; definition: string }>;
  adrs: Array<{ id: string; title: string; context: string; decision: string; consequences: string }>;
};
export type RoundBodyV1 = {
  roundNo: number;
  state: "drafting" | "awaiting-answers" | "answered" | "interrupted" | "failed";
  retries: number;
  lastInvalidReason: string | null;
  waiting: null | "requirement-budget-exhausted" | "requirement-usage-unknown";
  result: ClarifyResultV1 | null;
  answers: Array<{ id: string; kind: "recommended" | "text"; text: string }> | null;
  glossaryDecisions: RequirementDecisionInputV1[] | null;
  adrDecisions: RequirementDecisionInputV1[] | null;
  answeredAt: string | null;
  closedByConsensus: boolean;
  reasonCode: null | "clarify-output-invalid";
  calls: RequirementCallRecordV1[];
};
export type SplitTaskV1 = {
  taskId: string;
  title: string;
  labels: string[];
  loopPlan?: string;
  goal: string;
  successCondition: string;
  targetPaths: string[];
  checks: string[];
  dependsOn: string[];
  traces: string[];
};
/** N1 spec §8: a draft as the requirement view shows it -- the stored plan is left out (draftBodySchema without `plan`). */
export type DraftViewV1 = {
  draftNo: number;
  state: "drafting" | "awaiting-review" | "accepted" | "rejected" | "invalid" | "interrupted" | "failed";
  autoRetry: number;
  waiting: null | "requirement-budget-exhausted" | "requirement-usage-unknown";
  feedback: string | null;
  output: { tasks: SplitTaskV1[]; notes: string } | null;
  draftHash: string | null;
  reasons: string[];
  layers: string[][] | null;
  implicitEdges: Array<{ from: string; to: string; conflicts: Array<{ a: string; b: string }> }> | null;
  reasonCode: null | "split-output-invalid" | "split-validation-exhausted";
  calls: RequirementCallRecordV1[];
};
/** N1 spec §11.2: one requirement in full (src/control/webProtocol.ts requirementViewSchema, field for field). */
export type RequirementViewV1 = {
  schema: "orca-requirement-view-v1";
  epoch: string;
  changeSeq: number;
  summary: GroupSummaryV1;
  requirement: {
    requirementId: string;
    repoId: string;
    slug: string | null;
    contentLanguage: "en" | "zh";
    createdOn: string;
    idea: string;
    consensus: null | { roundNo: number; at: string; openBranches: string[]; openQuestions: string[] };
    acceptedDraftNo: number | null;
    document: null | { sha256: string; frozenAt: string };
    /** Task 11: a blocked export is "conflict"; the summary's reasonCode tells a path block from a branch conflict. */
    export: { state: "not-due" | "pending" | "done" | "conflict"; path: string | null; commit: string | null; parent: string | null; detail: string | null };
  };
  ledger: { limit: Amount; used: Amount; reserved: Amount; usageUnknown: boolean };
  rounds: RoundBodyV1[];
  drafts: DraftViewV1[];
  /** The live document until accept, the frozen text after. */
  document: string;
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
  // Agent selection spec §6.2 / §12 I3 (W6-9): null until confirmation freezes a selection. `agent` and
  // `agentProvenance` are optional on the Web side only, like `blockedReason`, so literal fixtures need no edit;
  // webParity.test.ts normalises an absent value to null in the web-to-server direction.
  configHash: string | null;
  agent?: { agent: string; model: string; contextWindow: ContextWindowV1 } | null;
  agentProvenance?: { agent: ProvenanceSourceV1; model: ProvenanceSourceV1; contextWindow: ProvenanceSourceV1 } | null;
  originalContractHash: string;
  derivedContractHash: string | null;
  currentRunId: string | null;
  pendingRunId: string | null;
  lineageRunIds: string[];
  // Labels and progress spec §4.1 (§8 R19): optional here so literal fixtures need no edit; the server always sends them.
  labels?: string[];
  labelsProvenance?: "plan" | "operator";
  labelsVersion?: number;
  progress?: WorkItemProgressV1 | null;
  // Loop plans spec §4.1: optional here so literal fixtures need no edit; the server always sends both.
  loopPlan?: LoopPlanViewV1 | null;
  objective?: { goal: string; successCondition: string };
};
export type RunViewV1 = {
  runId: string;
  taskId: string | null;
  estimateId: string | null;
  generation: number;
  state: "starting" | "unknown" | "attempt-unknown" | "attempt-proof-invalid" | "running" | "failed-before-provider" | "settled-recoverable" | "settled-restartable" | "settled-unrecoverable" | "collected" | "landed" | "reconciling" | "blocked";
  phase: "estimate" | "work" | "handoff" | "single-call";
  /** N1 DR26: what a `single-call` run of a requirement was for; absent on every other phase. */
  purpose?: "clarify" | "split";
  claimOrdinal: number | null;
  providerAttemptOrdinal: number;
  profile: ProfileBindingV1;
  used: Amount;
  remaining: Amount;
  failureCode: string | null;
  blockedReason?: string | null;
  continuable?: boolean;
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
  /** W6: built from contracts a plan change has since replaced; its suggestions are not applied. Absent reads as false. */
  stale?: boolean;
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
  /** Wave 3 M-5: the group's frozen reconcile selection. Optional here only so literal fixtures need no edit; absent reads as null. */
  agents?: { reconcile: FrozenSlotV1 | null };
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
  | { kind: "global"; epoch: string }
  | { kind: "repository"; repoId: string }
  | { kind: "operator"; operatorId: string };

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
  /** Agent selection spec §6.4 step 3: the hash of the selections the operator saw. */
  selectionsHash: string;
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
/** N1 spec §11.1: the five requirement commands (src/control/webProtocol.ts, field for field). */
export type RequirementOpenPayloadV1 = {
  groupId: string;
  repoId: string;
  idea: string;
  limit?: Amount;
  agent?: PanelPartialSelectionV1;
  contentLanguage?: "en" | "zh";
};
export type RequirementAnswerInputV1 = { id: string; kind: "recommended" } | { id: string; kind: "text"; text: string };
export type RequirementDecisionInputV1 = { id: string; accept: boolean };
export type RequirementAnswerPayloadV1 = {
  roundNo: number;
  answers: RequirementAnswerInputV1[];
  glossaryDecisions: RequirementDecisionInputV1[];
  adrDecisions: RequirementDecisionInputV1[];
};
export type RequirementConsensusPayloadV1 = { roundNo: number };
export type RequirementDraftFeedbackPayloadV1 = { draftNo: number; feedback: string };
export type RequirementDraftAcceptPayloadV1 = { draftNo: number; draftHash: string };
/** Agent selection spec §3: model and context window are opaque here; ccloop's descriptor judges them. */
export type ContextWindowV1 = "agent-default" | number;
/** Spec §6.3: where a resolved selection field came from. */
export type ProvenanceSourceV1 =
  | "operator" | "operator-estimator" | "operator-reconcile" | "group" | "group-estimator" | "group-reconcile" | "task" | "operator-agent" | "descriptor"
  // Ruling review R7: the plan file's half of each level, below the panel's.
  | "group-plan" | "group-reconcile-plan" | "task-plan";
export type PartialSelectionV1 = { agent?: string; model?: string; contextWindow?: ContextWindowV1 };
/** Ruling review R7: a panel layer; a null field masks the plan's value for that field at the same level. */
export type PanelPartialSelectionV1 = { agent?: string | null; model?: string | null; contextWindow?: ContextWindowV1 | null };
/** Spec §6.2 (W6-20, R7): replace the panel's own layer of one level, or clear it with null. */
export type ProposalSetAgentPayloadV1 = {
  baseProposalVersion: number;
  scope: { kind: "group"; slot: "worker" | "estimator" | "reconcile" } | { kind: "task"; taskId: string };
  partial: PanelPartialSelectionV1 | null;
};

export type CommandSuccessV1 = {
  schema: "orca-command-success-v1";
  commandId: string;
  actorId: string;
  verb: "import-plan" | "proposal-edit" | "estimate" | "confirm" | "start" | "pause-dispatch" | "handoff-stop" | "resume-dispatch" | "resume-from-handoff" | "set-limit" | "continue-task" | "recovery-retry" | "shutdown" | "set-workspace-mode" | "set-agent-preferences" | "proposal-set-agent" | "set-task-labels" | "set-task-loop"
    | "requirement-open" | "requirement-answer" | "requirement-consensus" | "requirement-draft-feedback" | "requirement-draft-accept";
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
    | { kind: "workspace-mode-set"; repoId: string; workspaceMode: "worktree" | "clone" }
    | { kind: "agent-preferences-set"; operatorId: string; revision: number }
    | { kind: "task-labels-set"; taskId: string; labelsVersion: number }
    | { kind: "task-loop-set"; taskId: string; loopVersion: number; proposalVersion: number }
    | { kind: "task-continuing"; continuationIntentId: string; pendingRunId: string; claimOrdinal: number; wakeId: string }
    | { kind: "recovery-observed"; resolved: boolean; blockerCodes: string[]; evidenceIds: string[]; wakeIds: string[] }
    | { kind: "requirement-opened"; groupId: string; requirementId: string; roundNo: 1; wakeId: string }
    | { kind: "requirement-answered"; roundNo: number; nextRoundNo: number | null; wakeId: string | null }
    | { kind: "requirement-consensus"; roundNo: number; draftNo: number; wakeId: string }
    | { kind: "requirement-draft-rejected"; draftNo: number; nextDraftNo: number; wakeId: string }
    | { kind: "requirement-draft-accepted"; draftNo: number; estimateId: string; estimateState: "queued" | "blocked-capability" | "input-too-large"; documentSha256: string; exportWakeId: string }
    | { kind: "shutdown"; groups: Array<{ groupId: string; disposition: "created" | "strengthened-pause" | "preserved-pause" | "preserved-handoff" | "preserved-shutdown" | "blocked-inconsistent" | "skipped-driver-owned"; changed: boolean; commandRevision: number; projectionSeq: number; frozenRunIds: string[]; requestIds: string[]; blockerCode: string | null }> };
};
export type CommandLookupV1 = { schema: "orca-command-lookup-v1"; originalStatus: number; body: CommandSuccessV1 | { error: CommandErrorV1 } };
export type RepositoryWorkspaceV1 = { schema: "orca-repository-workspace-v1"; repoId: string; workspaceMode: "worktree" | "clone"; revision: number };

// Agent selection spec §6.8 (plan T14): the agent UI's reads and its preferences command, mirrors of
// src/control/webProtocol.ts checked both ways in tests/panel/webParity.test.ts.
export type AgentSelectionV1 = { agent: string; model: string; contextWindow: ContextWindowV1 };
export type SelectionProvenanceV1 = { agent: ProvenanceSourceV1; model: ProvenanceSourceV1; contextWindow: ProvenanceSourceV1 };
export type AgentSlotV1 = "worker" | "estimator" | "reconcile";
export type GroupAgentOverridesV1 = { worker?: PanelPartialSelectionV1; estimator?: PanelPartialSelectionV1; reconcile?: PanelPartialSelectionV1 };
export type OperatorPreferencesV1 = {
  defaultAgent?: string;
  perAgent: Record<string, { model?: string; contextWindow?: ContextWindowV1 }>;
  estimator?: PartialSelectionV1;
  reconcile?: PartialSelectionV1;
};
export type AgentInstallationV1 = { id: string; kind: string; defaults: { model: string; contextWindow: ContextWindowV1 }; contextOptions: ContextWindowV1[]; version: string };
export type AgentsViewV1 = { schema: "orca-agents-view-v1"; installations: AgentInstallationV1[] };
export type AgentPreferencesViewV1 = { schema: "orca-agent-preferences-v1"; operatorId: string; revision: number; preferences: OperatorPreferencesV1 };
export type FrozenSlotV1 = {
  partial: PartialSelectionV1; provenance: SelectionProvenanceV1;
  selection: AgentSelectionV1; configHash: string; timeoutMs: number; killGraceMs: number; capabilities: CapabilityViewV1;
};
export type SlotOutcomeV1 = { kind: "resolved"; frozen: FrozenSlotV1 } | { kind: "rejected"; code: string } | { kind: "unavailable"; code: string };
/** W6-1/W6-2: the confirm's own resolution; `selectionsHash` is null exactly when some slot did not resolve. */
export type AgentSelectionPreviewV1 = {
  schema: "orca-agent-selection-preview-v1";
  groupId: string;
  proposalVersion: number;
  groupOverrides: GroupAgentOverridesV1;
  taskOverrides: Record<string, PanelPartialSelectionV1 | null>;
  /** Ruling review R7: the plan file's own layers, below the panel's. */
  planLayers: { group: { worker?: PartialSelectionV1; reconcile?: PartialSelectionV1 }; tasks: Record<string, PartialSelectionV1 | null> };
  slots: Array<{ key: string; slot: "worker" | "reconcile"; taskId: string | null; outcome: SlotOutcomeV1 }>;
  selectionsHash: string | null;
};
/** Plan-review P5 (W6-8): the revision travels in the envelope's expectedRevision only. */
export type SetAgentPreferencesPayloadV1 = { preferences: OperatorPreferencesV1 };

/** Labels and progress spec §2.1: G11's system words -- a mirror of src/control/labels.ts, compared by webParity (finding F1). */
export const WEB_SYSTEM_LABELS = ["feature", "bug", "refactor", "test", "doc", "design", "investigate", "perf", "security", "chore"] as const;
export const CUSTOM_LABEL_PREFIX = "custom:";
/** Spec §4.1 (§8 R10, R11, R18): the current run's step, attempt and tokens; null fields are "not reported" or "unknown". */
export type WorkItemProgressV1 = {
  runId: string;
  step: "queued" | "plan" | "execute" | "verify" | "succeeded" | "blocked_waiting_human" | "exhausted" | "cancelled" | "failed" | null;
  attempt: { current: number; max: number } | null;
  tokens: { used: number; grant: number } | null;
  lastTransitionAt: string | null;
};
/** Spec §3.1 (§8 R16): replace the task's operator labels, or null to go back to the plan's. */
export type SetTaskLabelsPayloadV1 = { labels: string[] | null; baseLabelsVersion: number };
/** Loop plans spec §2.2: the built-in plans (mirrors src/control/loopPlans.ts LOOP_PLAN_IDS). */
export type LoopPlanIdV1 = "standard" | "bugfix" | "refactor" | "design" | "investigate";
/** Loop plans spec §3.2: a recipe's inputs, every optional field filled. */
export type LoopInputsV1 = { goal: string; successCondition: string; targetPaths: string[]; checks: string[]; nonGoals: string[]; relevantDocs: string[]; protectedPaths: string[]; maxFilesTouched: number | null };
/** Loop plans spec §4.1, panel i18n spec §3.1: the fields a loop task's card is built from; no English sentence travels. */
export type LoopPlanViewV1 = {
  planId: LoopPlanIdV1; planVersion: number; chosenBy: "explicit" | "labels"; chosenByLabel: string | null;
  amended: boolean; loopVersion: number; inputs: LoopInputsV1; maxFiles: number; hasDiscipline: boolean;
};
/** Loop plans spec §5.2: change a loop task's plan, inputs and work budget (sessions is carried over). */
export type SetTaskLoopPayloadV1 = {
  baseLoopVersion: number; plan: string; inputs: LoopInputsV1; work: { tokens: number; activeMs: number; attempts: number };
  /** W5: the work dimensions taken from an estimate's suggestion; the server re-checks each against it. */
  workProvenance?: Partial<Record<"tokens" | "activeMs" | "attempts", { provenance: "model"; estimateId: string }>>;
};
/**
 * Loop plans spec §2.2, panel i18n spec §3.1: the plans a person can pick, at their current registry version (the
 * picker's words are keyed by version) -- a mirror of src/control/loopPlans.ts, compared by tests/panel/taskLoopApi.test.ts.
 */
export const WEB_LOOP_PLANS: ReadonlyArray<{ planId: LoopPlanIdV1; version: number }> = [
  { planId: "standard", version: 2 },
  { planId: "bugfix", version: 2 },
  { planId: "refactor", version: 2 },
  { planId: "design", version: 2 },
  { planId: "investigate", version: 2 },
];
