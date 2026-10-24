export type BudgetAmount = {tokens:number|null;activeMs:number;attempts:number;sessions:number};
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
  /** Issue 92: why there is no port, when the panel's boot knows; absent otherwise. */
  executionPortReason?: string;
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
  limit: BudgetAmount;
  usageUnknown: boolean;
  /** Final review finding 4: the requirement's call the driver blocked, and why (webProtocol.ts). */
  blockedRun: { runId: string; reason: string | null } | null;
  /** Issue #75: the requirement's slug once a round named one. Optional so literal fixtures need no edit; the server always sends it. */
  slug?: string | null;
  /** Task 10a: the short title the latest clarify round gave; absent while none did. Cards show it before the goal. */
  title?: string;
  /** Issue 91 review fix: present only on a handoff-unresolved stop -- whether recovery-retry can act on it. */
  stopRetryable?: boolean;
};

export type GroupSummaryV1 = {
  groupId: string;
  /** Project filtering spec §4: the group's repository, from its plan or its requirement. */
  repoId: string;
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
  /** Issue-fixes spec §6.2: optional so literal fixtures need no edit; the server always sends each. */
  goal?: string;
  branch?: string;
  counts?: Record<WorkItemCategoryV1, number>;
  updatedAt?: number | null;
  archived?: boolean;
  /** Feedback #53: a start wake is undelivered or a task is executing; a Web-started group stays `ready` meanwhile. */
  executionPending?: boolean;
  /** Debug task plan Task 6: present only on a group a correction opened. Task 13: the mark's facts the group view shows. */
  debug?: {
    correctionId: string; ordinal: number;
    missing?: DebugInputPieceV1[];
    agentFallback?: { reason: string } | null;
    checks?: { from: "original" | "original+named" | "named"; namedBy: "human" | "agent" | null };
    closing?: DebugClosingV1 | null;
  };
  /** Kanban spec 2026-10-20 §4: a board card's facts; the server gives them for every group with a plan. */
  card?: {
    budget: { usedTokens: number; limitTokens: number | null }; pendingDecisions: number; firstFailure: { taskId: string; cause: string } | null;
    /** Checks spec 2026-10-22 §6.6, §7: model-review findings waiting on this group that a review group owns; absent when none. */
    reviewFindings?: { major: number; minor: number };
  };
  /** Kanban spec 2026-10-20 §3.3: the group's direct prerequisites (a person's edges); present only when it has any. */
  dependsOn?: string[];
  /** Kanban spec 2026-10-20 §3.1-§3.4: present only on a group confirmed since start-on-confirm exists. */
  orchestration?: GroupOrchestrationV1;
  /** System debug task spec 2026-10-21 §3.5: present only on a debug group Orca opened itself. */
  systemDebug?: GroupSystemDebugV1;
  /** Dir-requirements spec §9.4: present only on a dir group -- its folder placement record (§8.2 without the journal's from/to). */
  placement?: GroupPlacementV1;
  /** §3.5: tasks of this group the escalation ladder took over; `exhausted` is level 3 (needs you). */
  escalation?: GroupEscalationV1[];
  /** Scheduled flows and groups spec 2026-10-24 §13.3: the schedule that started this group, and why its fire waits. */
  scheduleStart?: { scheduleId: string; name: string; slot: number; waitingReason: string | null };
};
/** Dir-requirements spec §8.2, §9.4: a dir group's placement record as the summary sends it (the journal's from/to stay on the server). */
export type GroupPlacementV1 = {
  workspaceKind: "dir";
  state: "idle" | "folder-changed" | "folder-unwritable" | "folder-missing" | "failed";
  tip: string | null;
  landedTip: string | null;
  pending: null | {
    tip: string; tmp: Array<{ path: string; name: string }>; aside: Array<{ path: string; name: string }>; dirs: string[];
  };
  changed: string[];
  changedTotal: number;
  unwritable: Array<{ path: string; reason: string }>;
  unwritableTotal: number;
  withheld: Array<{ path: string; reason: string; toEntry: string; by?: string; at?: number }>;
  watch: string | null;
  detail: string | null;
  resolution: null | { id: string; action: "take-folder" | "recheck" | "withhold"; by: string; at: number };
  at: number;
};

export type GroupSystemDebugV1 = {
  // Checks spec 2026-10-22 §6.1: a model review and a finding's fix have no single source group.
  source: { kind: "ladder" | "integration-check" | "criteria-review"; groupId: string; taskId: string | null; runId: string | null }
    | { kind: "model-review"; repoId: string; target: string; from: string; to: string; runSeq: number }
    | { kind: "model-review-finding"; repoId: string; reviewGroupId: string; findingId: string };
  stackOn: string | null;
  settled: { state: string; at: number; detail: string | null } | null;
};
export type GroupEscalationV1 = { taskId: string; debugGroupId: string; state: "debugging" | "rerunning" | "exhausted"; reason: string | null };
export type GroupOrchestrationV1 = {
  mode: "run" | "hold";
  state: "held" | "started" | "stopped" | "waiting-prerequisite" | "backoff" | "waiting-slot" | "queued";
  waitingFor: string[];
  refusal: { code: string; count: number; persistent: boolean } | null;
};
/** Kanban spec §3.2: GET /api/control/orchestration. */
export type OrchestrationViewV1 = { schema: "orca-orchestration-v1"; revision: number; maxRunningGroups: number; runningGroups: number };

/** Debug task plan Task 3: a piece of the frozen input that could not be read (src/control/debugInput.ts). */
export type DebugInputPieceV1 = "run" | "base" | "attemptSha" | "objects" | "contract";
/** Debug task plan Task 9: what a debug run's landing did about its correction (src/control/driveRecord.ts closingSchema). */
export type DebugClosingV1 = { state: "written"; relPath: string; fixRunId: string } | { state: "refused"; reason: string }
  | { state: "chose-instead-missing" } | { state: "closed-by-human-first"; commit: string };

/** Debug task plan Task 10: one item of GET /api/control/corrections (src/control/correctionState.ts CorrectionListItemV1). */
export type CorrectionListItemV1 = {
  correction: {
    id: string; projectKey: string; decisionId?: string; runId?: string; pendingId?: string;
    kind: "wrong" | "not_my_taste" | "stale"; chose_instead?: string; because: string; at: string; by: string;
  };
  repoId: string | null;
  debugGroups: Array<{ groupId: string; ordinal: number; live: boolean; state: string }>;
  closed: { state: "open" } | { state: "closed"; ref: string; via: "debug-group" | "by-hand" };
  closing: DebugClosingV1 | null;
  withdrawn: { by: string; at: string } | null;
};
export type CorrectionListV1 = { schema: "orca-correction-list-v1"; corrections: CorrectionListItemV1[] };
/** Debug task plan Tasks 6, 11 (src/control/webProtocol.ts): the open and the manual close. */
export type CorrectionDebugOpenPayloadV1 = { correctionId: string; reopen?: boolean; undoHow?: string; checks?: string[] };
export type CorrectionClosePayloadV1 = { correctionId: string; choseInstead?: string; undoHow: string; undoCost?: string; undoBlastRadius?: string };

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
  /** Clarify caps spec 2026-10-21 §3.1: round 1's judgement; absent on later rounds and on rounds written before it. */
  classification?: RequirementClassificationV1;
};
export type RequirementScopeV1 = "small" | "medium" | "large";
export type RequirementClarityV1 = "clear" | "fair" | "vague";
export type RequirementClassificationV1 = { scope: RequirementScopeV1; scopeReason: string; clarity: RequirementClarityV1; clarityReason: string };
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
  /** Flow engine spec §10.3 (W-76): set on a revision of round `revises` only. */
  revises?: number;
  reason?: string;
  by?: string;
  via?: string;
  exclude?: number[];
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
  reasonCode: null | "split-output-invalid" | "split-validation-exhausted" | "requirement-revised";
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
  ledger: { limit: BudgetAmount; used: Amount; reserved: Amount; usageUnknown: boolean };
  rounds: RoundBodyV1[];
  drafts: DraftViewV1[];
  /** The live document until accept, the frozen text after. */
  document: string;
  /** Clarify caps spec §3.6: code's caps (tier from the person's class, else the model's; unclassified is large). */
  clarify?: {
    classification: RequirementClassificationV1 | null; override: { scope: RequirementScopeV1; clarity: RequirementClarityV1 } | null;
    tier: RequirementScopeV1; roundCap: number; questions: number; glossary: number; adrs: number; stoppedAtCap: boolean; chain: number[];
  };
  /** Epoch ms of the command that started the current drafting step; null when nothing drafts or it is not known. */
  draftingSince?: number | null;
};

export type ControlSummaryV1 = {
  schema: "orca-control-summary-v1";
  epoch: string;
  changeSeq: number;
  resetRequired: boolean;
  dispatchBlocked: boolean;
  groups: GroupSummaryV1[];
  /** Issue 94: groups whose stored body does not parse, by id and parse error; absent when there are none. */
  /** `requirement`: the stored body holds a requirement (true), does not (false), or is not JSON (null). */
  unreadable?: Array<{ groupId: string; reason: string; requirement: boolean | null }>;
};

export type FieldProvenanceV1 = { provenance: "complex-1m-default" | "model" | "human" | "system"; estimateId: string | null };
export type AmountProvenanceV1 = { tokens: FieldProvenanceV1; activeMs: FieldProvenanceV1; attempts: FieldProvenanceV1; sessions: FieldProvenanceV1 };
export type AllocationViewV1 = {
  ownerKind: "estimate" | "task" | "goal-review" | "reserve";
  ownerId: string;
  bucket: "work" | "handoff" | "review" | "reserve";
  state: "draft-encumbered" | "confirmed" | "active" | "held" | "continuing" | "retrying" | "terminal" | "unknown";
  amount: BudgetAmount;
  fieldProvenance: AmountProvenanceV1;
};
export type WorkItemViewV1 = {
  /** Absent on older servers: preserve finite draft reservation semantics. */
  tokenAccountingMode?: "finite-legacy" | "optional-v1";
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
  /** Issue-fixes spec §6.1: the server's display category; optional so literal fixtures need no edit. */
  category?: WorkItemCategoryV1;
};
export type RunSkillLockV1 = {
  name: string; source: { name: string; type: string; url: string; branch?: string } | null; resolved_commit: string | null; content_md5: string;
};
export type SettleAcknowledgeV1 = "charge-remaining-grant" | "release-unmetered";
export type SettleUnknownUsagePayloadV1 = { taskId: string; runId: string; generation: number; acknowledge: SettleAcknowledgeV1 };
/** The unlimited work token dimension of an unmetered release is booked as nothing (null), never as 0. */
export type UnmeteredChargeV1 = { work: Omit<Amount, "tokens"> & { tokens: null }; handoff: Amount };
export type UsageSettlementV1 = ({ method: "remaining-grant"; charged: { work: Amount; handoff: Amount } } | { method: "owner-acknowledged-unmetered"; charged: UnmeteredChargeV1 }) & { commandId: string; principal: string; at: number; groupId: string; taskId: string; workItemId: string; runId: string; generation: number; highWater: number; reservationDisposition: "committed" | "released" | "recovered"; report: { artifactId: string; hash: string }; stopProof: { executionId: string; generation: number; isolated: true; source: { artifactId: string; hash: string } }; handoffResolution?: { requestId: string; previousState: "settled-unrecoverable"; previousFailureCode: "usage-unsettled"; checkpointId: string; checkpointHash: string } };
export type RunViewV1 = {
  recoveryOf?:RecoveryOf;savedResultOrdinaryRetry?:boolean;
  unknownUsageSettlement?: { generation: number; highWater: number; remaining: { work: BudgetAmount; handoff: Amount }; allowed: boolean; refusalReason: string | null; acknowledge: SettleAcknowledgeV1; settlement?: UsageSettlementV1 };
  runId: string;
  taskId: string | null;
  estimateId: string | null;
  generation: number;
  state: "starting" | "unknown" | "attempt-unknown" | "attempt-proof-invalid" | "running" | "failed-before-provider" | "settled-recoverable" | "settled-restartable" | "settled-unrecoverable" | "settled-failed" | "collected" | "landed" | "reconciling" | "blocked";
  phase: "estimate" | "work" | "handoff" | "single-call";
  /** N1 DR26: what a `single-call` run of a requirement was for; absent on every other phase. */
  purpose?: "clarify" | "split";
  claimOrdinal: number | null;
  providerAttemptOrdinal: number;
  profile: ProfileBindingV1;
  used: Amount;
  remaining: BudgetAmount;
  /** Tester round 2 §4.2.2: the dimensions in which the run went over its grant; absent from older servers. */
  overGrant?: AmountDimensionV1[];
  /** Tester round 2, web part: the run's grant in its bucket (`remaining` is clamped at 0); absent from older servers. */
  grant?: BudgetAmount;
  tokenRemainingStatus?:"known"|"unlimited"|"unknown";
  failureCode: string | null;
  diagnosis?: { phase: "estimate" | "work" | "handoff" | "single-call"; step: "planning" | "executing" | "verifying" | null; cause: "execution-format-invalid" | "execution-format-ambiguous-or-hidden" | "usage-unsettled" | "unknown"; attempt: number };
  blockedReason?: string | null;
  /** Issue fixes spec §4.2(1), (5): ccloop's reason and the drive record's outcome; optional here so literal fixtures need no edit. */
  stopReason?: string | null;
  outcome?: string | null;
  /** Failure-cause spec 2026-10-21 §5: ccloop's run-level cause; optional so literal fixtures need no edit. */
  failureCause?: { cause: string; phase: "plan" | "execute" | "verify" | null; retries: number; detail: string | null } | null;
  continuable?: boolean;
  evidenceIds: string[];
  /** Board spec 2026-10-03 D4: optional here so literal fixtures need no edit; the server always sends it. */
  git?: { workspaceMode: "worktree" | "clone"; base: string | null; landedCommit: string | null } | null;
  /** Syncskill integration spec §4.6: the skills the run was given (syncskill's lock); absent for a run without skills. */
  skills?: { profile: string | null; lock: RunSkillLockV1[] };
  /** Issue-fixes spec §5.2: wall-clock times (ms); null for a run written before schema 9. Optional so literal fixtures need no edit; the server always sends them. */
  startedAt?: number | null;
  endedAt?: number | null;
  lastActivityAt?: number | null;
  /** Feedback #59: creation position in the group (1-based); `runs` stays in id order. Optional so literal fixtures need no edit; the server always sends it. */
  createdOrdinal?: number;
  /** Debug task plan Task 13: a debug run's reproduce-first check, in progress or skipped with the agent's reason. */
  debugRepro?: { state: "checking" } | { state: "skipped"; reason: string };
  /** Spec 2026-10-15 §6.2: a single call's output bound and, when its observed output went over it, by how much. Read-time only. */
  outputBound?: number;
  outputBoundExceededBy?: number;
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
  state: "queued" | "running" | "start-unknown" | "ready" | "failed" | "interrupted" | "blocked-capability" | "input-too-large" | "withdrawn";
  profile: ProfileBindingV1 | null;
  mode: "strict" | "soft";
  requestHash: string | null;
  outputHash: string | null;
  output: BudgetEstimateV1 | null;
  reasonCode: string | null;
  compatibilityReasonCodes?: string[];
  proposalVersion?: number;
  repairs?: string[];
  origin?: { kind: "auto-retry"; of: string; problems: string[] };
  retriedAs?: string;
  retrySkipped?: string;
  /** W6: built from contracts a plan change has since replaced; its suggestions are not applied. Absent reads as false. */
  stale?: boolean;
};
export type CheckpointViewV1 = { checkpointId: string; taskId: string; runId: string; state: "complete" | "partial" | "unknown"; snapshotHash: string | null; evidenceIds: string[] };
export type HandoffRequestViewV1 = {
  requestId: string;
  runId: string;
  state: "request-pending" | "latched" | "collecting" | "settled-recoverable" | "settled-restartable" | "settled-unrecoverable" | "settled-failed" | "outcome-unknown";
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
    profiles: null | { estimator: ProfileBindingV1 | null; worker: ProfileBindingV1; handoff: ProfileBindingV1; goalReview: ProfileBindingV1 };
    executionSnapshotHash: string | null;
  };
  ledger: { groupLimit: BudgetAmount; used: Amount; committedRemaining: Amount; explicitUnallocatedReserve: BudgetAmount; budgetDeficit: Amount; usageUnknown: boolean; unmeteredRuns: number };
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
  /** Accounts spec §6.3.1 (D9): why this group's next claim waits on a spend cap; absent from older servers. */
  spendCapBlock?: SpendCapBlockV1 | null;
  /** Integration spec §4: the group's integration; absent for keep. */
  integration?: GroupIntegrationViewV1;
  /** Issue-fixes spec §5.2: the group's newest 50 activity rows, newest first. Optional so literal fixtures need no edit. */
  activity?: ActivityEntryV1[];
  /** Tester round 2 §7.3: whether Orca confirms this group on its own; absent reads as not eligible (an older server). */
  autoConfirm?: { eligible: boolean; refusedCode: string | null };
};

export type SpendPeriodV1 = "total" | "week" | "month";
/** Accounts spec §6.3.1: `scope` is `all` or `repo:<repoId>`; projected on a group view, never a command outcome. */
export type SpendCapBlockV1 = { code: "spend-cap-reached"; scope: string; period: SpendPeriodV1; capTokens: number; grantTokens: number };
export type SetSpendCapPayloadV1 = { scope: string; period: SpendPeriodV1; tokens: number };
export type ClearSpendCapPayloadV1 = { scope: string; period: SpendPeriodV1 };
/** weekStart 1 = Monday .. 7 = Sunday. */
export type SetUsageCalendarPayloadV1 = { timeZone: string; weekStart: number };
/** Accounts spec §6.2: one cap that applies to the view's scope, with what it leaves (headroom is not clamped). */
export type CapStatusV1 = {
  scope: string; period: SpendPeriodV1; tokens: number; updatedAt: number; updatedBy: string;
  used: number; committed: number; headroom: number; from: number | null; to: number | null;
};
/** Accounts spec §5.3: GET /api/control/usage. A null model or group key is the unattributed bucket. */
export type UsageViewV1 = {
  schema: "orca-usage-view-v1";
  scope: string;
  from: number | null;
  to: number | null;
  now: number;
  calendar: { timeZone: string; weekStart: number };
  spendRevision: number;
  headline: { total: number; week: number; month: number };
  range: {
    tokens: number;
    byModel: Array<{ model: string | null; input: number; output: number; cacheRead: number; cacheWrite: number; tokens: number }>;
    groups: Array<{ key: string | null; tokens: number }>;
  };
  counts: { unattributedRows: number; breakdownMismatchRows: number; unknownUsageRuns: number };
  caps: CapStatusV1[];
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
/** Issue-fixes spec §5.2: one row of Orca's activity record. */
export type ActivityKindV1 = "usage-settled" | "command" | "run-claimed" | "run-started" | "phase" | "run-blocked" | "run-resumed" | "run-settled" | "task-retried" | "integration" | "stop" | "stop-cleared" | "archived" | "unarchived" | "correction-closed" | "debug-open-failed";
export type ActivityEntryV1 = { seq: number; groupId: string; taskId: string | null; runId: string | null; at: number; kind: ActivityKindV1; body: Record<string, unknown> };
/** GET /api/control/runs/:runId/activity -- the run's newest 200 rows, newest first. */
export type RunActivityV1 = { schema: "orca-run-activity-v1"; runId: string; entries: ActivityEntryV1[] };

export type CommandErrorV1 = { code: string; message: string; commandRevision: number | null; evidenceIds: string[]; retryable: boolean };
export type CommandTargetV1 =
  | { kind: "group"; groupId: string }
  | { kind: "task"; groupId: string; taskId: string }
  | { kind: "run"; groupId: string; runId: string }
  | { kind: "global"; epoch: string }
  | { kind: "repository"; repoId: string }
  | { kind: "operator"; operatorId: string }
  | { kind: "spend" }
  | { kind: "corrections" }
  | { kind: "orchestration" }
  | { kind: "flows" }
  // Scheduled flows and groups plan B2: the plan library scope and a schedule's own scope.
  | { kind: "plan-library" }
  | { kind: "schedule"; scheduleId: string };

/** What a mutation POST carries: an id the ledger dedupes on, the revision it expects, and the verb's payload. */
export type CommandEnvelopeV1 = { commandId: string; expectedRevision: number; payload?: unknown };
export type AmountDimensionV1 = "tokens" | "activeMs" | "attempts" | "sessions";
export type ProposalTargetV1 =
  | { scope: "task"; taskId: string; allocation: "work" | "handoff"; dimension: AmountDimensionV1 }
  | { scope: "goal-review"; dimension: AmountDimensionV1 };
export type ProposalOperationV1 = {
  target: ProposalTargetV1;
  value: number|null;
  provenance: "complex-1m-default" | "model" | "human";
  estimateId?: string;
};
export type ProposalEditPayloadV1 = { baseProposalVersion: number; operations: ProposalOperationV1[]; proposedGroupLimit?: BudgetAmount };
export type EstimatePayloadV1 = { proposalVersion: number; estimatorProfileId: string; estimatorProfileHash: string; estimateMode: "strict" | "soft" };
export type ConfirmPayloadV1 = {
  planHash: string;
  proposalVersion: number;
  budgetMode: "strict" | "soft";
  profileIds: { estimator: string | null; worker: string; handoff: string; goalReview: string };
  profileHashes: { estimator: string | null; worker: string; handoff: string; goalReview: string };
  contextPolicy: { handoffAtContextTokens: number | null };
  /** Agent selection spec §6.4 step 3: the hash of the selections the operator saw. */
  selectionsHash: string;
  /** Integration spec §3.2: the group's integration.schemeHash the owner saw; only for a non-keep scheme. */
  integrationHash?: string;
  /** Kanban spec §3.1: "Confirm only, don't run yet"; absent is "Confirm and run". */
  hold?: true;
};
export type SetLimitPayloadV1 = { limit: BudgetAmount };
export type ImportPlanPayloadV1 = {
  groupId: string;
  repoId: string;
  /** Scheduled flows and groups spec §5.5: exactly one of a registered plan and a pinned library version. */
  planId?: string;
  libraryEntry?: { entryId: string; sha256: string };
  /** Only with libraryEntry: the new group's token limit (null = unlimited) and its scheme (null = keep). */
  tokenLimit?: number | null;
  integration?: IntegrationSchemeV1 | null;
  estimatorProfileId?: string;
  estimatorProfileHash?: string;
  estimateMode?: "strict" | "soft";
};
export type HandoffStopPayloadV1 = { handoffDeadlineAt?: string };
export type ContinuationSelectionV1 = { taskId: string; predecessorRunId: string; checkpointId: string };
export type ResumeFromHandoffPayloadV1 = { selections: ContinuationSelectionV1[] };
export type ContinueTaskPayloadV1 = { predecessorRunId: string; checkpointId: string };
export type RecoveryRetryPayloadV1 = { scope: "run"; runId: string } | { scope: "group"; groupId: string };
/** CLI v2 spec §14 R2: `runId` is the run the person saw failing; the panel refuses task-run-moved once it is not current. */
export type RetryTaskPayloadV1 = { taskId: string; runId?: string };
/** N1 spec §11.1: the five requirement commands (src/control/webProtocol.ts, field for field). */
export type RequirementOpenPayloadV1 = {
  groupId: string;
  repoId: string;
  idea: string;
  limit?: BudgetAmount;
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
  | "group-plan" | "group-primary" | "group-reconcile-plan" | "task-plan";
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
  verb: "import-plan" | "proposal-edit" | "estimate" | "confirm" | "start" | "pause-dispatch" | "handoff-stop" | "resume-dispatch" | "resume-from-handoff" | "set-limit" | "continue-task" | "recovery-retry" | "retry-task" | "verify-saved-result" | "settle-unknown-usage" | "shutdown" | "set-workspace-mode" | "set-agent-preferences" | "apply-agent-update" | "proposal-set-agent" | "set-task-labels" | "set-task-loop"
    | "requirement-open" | "requirement-answer" | "requirement-consensus" | "requirement-draft-feedback" | "requirement-draft-accept" | "requirement-clarify-more" | "requirement-classify" | "requirement-revise"
    | "set-spend-cap" | "clear-spend-cap" | "set-usage-calendar" | "set-integration-scheme" | "set-criteria-review" | "set-group-integration" | "retry-integration" | "resolve-integration-conflict"
    | "archive-group" | "unarchive-group" | "approve-pending-decision" | "reject-pending-decision" | "ratify-flagged-decision" | "set-orchestration-settings" | "add-group-dependency" | "remove-group-dependency" | "correction-debug-open" | "system-debug-open"
    | "correction-record" | "correction-close" | "correction-withdraw"
    | "set-check-settings" | "set-scheduled-check" | "set-check-locks" | "run-check-now" | "resume-check"
    | "set-flow-settings" | "set-flow-locks"
    | "flow-start" | "flow-message" | "flow-plan" | "flow-rerun" | "flow-answer" | "flow-effect" | "flow-pool" | "flow-plan-step"
    | "resolve-folder-change"
    | "plan-library-save" | "plan-library-import" | "plan-library-archive"
    | "schedule-set" | "schedule-enable" | "schedule-remove" | "schedule-resume" | "schedule-from-group";
  target: CommandTargetV1;
  commandRevision: number | null;
  projectionSeq: number | null;
  effectivePayloadHash: string;
  authorityCommandHash: string;
  result:
    | {kind:"saved-result-verification-started";taskId:string;runId:string;recoveryOf:RecoveryOf}

    | { kind: "usage-settled"; taskId: string; runId: string; generation: number; charged: { work: Omit<Amount, "tokens"> & { tokens: number | null }; handoff: Amount }; at: number; method: "remaining-grant" | "owner-acknowledged-unmetered" }
    | { kind: "imported"; groupId: string; estimateId: string; estimateState: "queued" | "blocked-capability" | "input-too-large"; estimateReasonCode: string | null }
    | { kind: "proposal-edited"; proposalVersion: number }
    | { kind: "estimate-created"; estimateId: string; estimateVersion: number; estimateState: "queued" | "blocked-capability" | "input-too-large"; reasonCode: string | null; wakeId: string | null }
    | { kind: "confirmed"; executionSnapshotHash: string }
    | { kind: "scheduled"; operation: "start" | "resume-dispatch"; wakeId: string }
    | { kind: "resumed"; operation: "resume-dispatch" }
    | { kind: "paused"; stopMode: "pause" }
    | { kind: "handoff-stopped"; stopRevision: number; acceptedAt: string; handoffDeadlineAt: string; frozenRunIds: string[]; requestIds: string[] }
    | { kind: "resumed-from-handoff"; wakeId: string; pendingRuns: Array<{ taskId: string; continuationIntentId: string; pendingRunId: string; claimOrdinal: number }> }
    | { kind: "limit-set"; limit: BudgetAmount }
    | { kind: "workspace-mode-set"; repoId: string; workspaceMode: "worktree" | "clone" }
    | { kind: "integration-scheme-set"; repoId: string; integration: IntegrationSchemeV1 }
    // A retired verb's stored answer (checks spec §4.4): still readable from the command history.
    | { kind: "integration-check-set"; repoId: string; integrationCheck: { enabled: boolean; command: string | null } }
    | { kind: "check-settings-set"; repoId: string | null; checks: ChecksLayerV1 }
    | { kind: "scheduled-check-set"; repoId: string | null; scheduled: ScheduledCheckV1[] }
    | { kind: "check-locks-set"; locks: CheckLockV1[] }
    // Flow engine spec §11.2: the flow settings layer written (repoId null = global) and the global lock list.
    | { kind: "flow-settings-set"; repoId: string | null; flows: FlowsLayerV1 }
    | { kind: "flow-locks-set"; locks: FlowLockV1[] }
    // Flow engine spec §14.2: what each flow verb did.
    | { kind: "flow-started"; flowRunId: string; groupId: string }
    | { kind: "flow-message-stored"; flowRunId: string; seq: number; state: "accepted" | "applied" | "rejected" | "excluded"; reason: string | null; deduped: boolean; held?: string[]; release?: string }
    | { kind: "flow-plan-made"; flowRunId: string; planNo: number }
    | { kind: "flow-plan-run"; flowRunId: string; planNo: number }
    | { kind: "flow-plan-discarded"; flowRunId: string; planNo: number }
    | { kind: "flow-answered"; flowRunId: string; stepKey: string; answer: "ask" | "needs" | "clarify" | "consensus" }
    | { kind: "flow-effect-done"; recordId: string; action: "confirm" | "enact" | "discard"; state: "running" | "restaged" | "discarded"; replacedBy?: string }
    | { kind: "flow-pool-raised"; flowRunId: string; poolTokens: number }
    // Scheduled flows and groups spec §5.3, §5.6: a library save or import, and an archive.
    | { kind: "plan-library-saved"; entryId: string; version: number; sha256: string; appended: boolean }
    | { kind: "plan-library-archived"; entryId: string }
    // Scheduled flows and groups spec §6, §11.1: a schedule's writes.
    | { kind: "schedule-set"; scheduleId: string }
    | { kind: "schedule-enabled"; scheduleId: string; enabled: boolean }
    | { kind: "schedule-removed"; scheduleId: string }
    | { kind: "schedule-resumed"; scheduleId: string }
    // Gaps spec §4.6, §5.5: a feedback intake's clarify round answered; a step of the running plan answered.
    | { kind: "flow-feedback-answered"; flowRunId: string; messageSeq: number; answer: "clarify" | "consensus" }
    | { kind: "flow-plan-step-applied"; flowRunId: string; planNo: number; stepKey: string; choice: "run" | "accept-unchanged" }
    | { kind: "check-run-requested"; repoId: string; checkKind: CheckKindV1; targets: string[] }
    | { kind: "check-resumed"; repoId: string; checkKind: CheckKindV1; targets: string[] }
    | { kind: "criteria-review-set"; repoId: string; enabled: boolean }
    | { kind: "group-integration-set"; groupId: string; integration: IntegrationSchemeV1 }
    | { kind: "integration-retried"; groupId: string }
    | { kind: "integration-resolution-started"; groupId: string }
    | { kind: "folder-change-resolved"; groupId: string; action: "take-folder" | "recheck" | "withhold" }
    | { kind: "archived"; groupId: string; at: number }
    | { kind: "unarchived"; groupId: string }
    | { kind: "pending-decision-approved"; pendingId: string; decisionId: string }
    | { kind: "pending-decision-rejected"; pendingId: string; correctionId: string }
    | { kind: "flagged-decision-ratified"; decisionId: string }
    | { kind: "debug-group-opened"; groupId: string; correctionId: string; created: boolean }
    | { kind: "system-debug-opened"; groupId: string; created: boolean }
    | { kind: "correction-recorded"; correctionId: string }
    | { kind: "correction-closed"; correctionId: string; relPath: string; alreadyClosed: boolean }
    | { kind: "correction-withdrawn"; correctionId: string; review: "written" | "duplicate" | "skipped"; debugGroups: Array<{ groupId: string; state: "archived" | "started: left running" }> }
    | { kind: "agent-preferences-set"; operatorId: string; revision: number }
    | { kind: "agent-installations-updated"; operatorId: string; revision: number; beforeHash: string; afterHash: string }
    | { kind: "spend-cap-set"; revision: number }
    | { kind: "spend-cap-cleared"; revision: number }
    | { kind: "usage-calendar-set"; revision: number }
    | { kind: "orchestration-settings-set"; maxRunningGroups: number; revision: number }
    | { kind: "group-dependency-added"; groupId: string; dependsOn: string }
    | { kind: "group-dependency-removed"; groupId: string; dependsOn: string }
    | { kind: "task-labels-set"; taskId: string; labelsVersion: number }
    | { kind: "task-loop-set"; taskId: string; loopVersion: number; proposalVersion: number }
    | { kind: "task-continuing"; continuationIntentId: string; pendingRunId: string; claimOrdinal: number; wakeId: string }
    | { kind: "task-retried"; taskId: string; fromRunId: string }
    | { kind: "recovery-observed"; resolved: boolean; blockerCodes: string[]; evidenceIds: string[]; wakeIds: string[] }
    | { kind: "requirement-opened"; groupId: string; requirementId: string; roundNo: 1; wakeId: string }
    | { kind: "requirement-answered"; roundNo: number; nextRoundNo: number | null; wakeId: string | null }
    | { kind: "requirement-consensus"; roundNo: number; draftNo: number; wakeId: string }
    | { kind: "requirement-draft-rejected"; draftNo: number; nextDraftNo: number; wakeId: string }
    | { kind: "requirement-clarify-more"; roundNo: number; nextRoundNo: number; wakeId: string }
    | { kind: "requirement-classified"; scope: RequirementScopeV1; clarity: RequirementClarityV1 }
    | { kind: "requirement-revised"; roundNo: number; revises: number; consensusWithdrawn: boolean; nextRoundNo: number | null; wakeId: string | null }
    | { kind: "requirement-draft-accepted"; draftNo: number; estimateId: string; estimateState: "queued" | "blocked-capability" | "input-too-large"; documentSha256: string; exportWakeId: string }
    | { kind: "shutdown"; groups: Array<{ groupId: string; disposition: "created" | "strengthened-pause" | "preserved-pause" | "preserved-handoff" | "preserved-shutdown" | "blocked-inconsistent" | "skipped-driver-owned" | "unchanged-idle"; changed: boolean; commandRevision: number; projectionSeq: number; frozenRunIds: string[]; requestIds: string[]; blockerCode: string | null }> };
};
export type CommandLookupV1 = { schema: "orca-command-lookup-v1"; originalStatus: number; body: CommandSuccessV1 | { error: CommandErrorV1 } };
export type RepositoryWorkspaceV1 = { schema: "orca-repository-workspace-v1"; repoId: string; workspaceMode: "worktree" | "clone"; revision: number };
// Integration spec §3: mirrors of src/control/webProtocol.ts integrationSchemeSchema and repositoryIntegrationSchema.
export type IntegrationSchemeV1 =
  | { delivery: "keep" }
  | { delivery: "local"; trigger: "task" | "group"; method: "merge" | "squash"; target: string }
  | { delivery: "push-target"; trigger: "task" | "group"; method: "merge" | "squash"; target: string; remote: string }
  | { delivery: "push-branch" | "github-pr"; trigger: "task" | "group"; target: string; remote: string };
export type GroupIntegrationViewV1 = {
  scheme: IntegrationSchemeV1; schemeHash: string; frozen: boolean; state: "idle" | "blocked" | "conflict" | "resolving"; reason: string | null;
  lastIntegrated: string | null; integratedCommit: string | null; pr: { url: string; number: number; ready: boolean } | null;
};
/** `suggestedTarget` (controller ruling, Task 7): origin's HEAD branch, else the current branch, else null; never stored. */
export type RepositoryIntegrationV1 = { schema: "orca-repository-integration-v1"; repoId: string; integration: IntegrationSchemeV1; revision: number; suggestedTarget: string | null };
// Checks spec 2026-10-22 §2.2, §2.4, §4.1: a trigger, a scheduled check and one settings layer's `checks` field.
export type CheckKindV1 = "integration-check" | "model-review";
export type CheckConditionV1 =
  | { kind: "landed-groups"; min: number } | { kind: "conflict-reconciled" } | { kind: "overlapping-files"; minGroups: number }
  | { kind: "queue-idle" } | { kind: "since-last"; ms: number } | { kind: "schedule"; cron: string };
export type CheckTriggerV1 = { all: Array<{ any: CheckConditionV1[] }> };
export type ScheduledCheckV1 = { id: string; kind: CheckKindV1; cron: string; enabled: boolean; params: Record<string, never> };
export type CheckLockV1 = "integrationCheck.command" | "modelReview.budgetTokens";
/** Flow engine spec §11.2: a layer's `flows` (the global one alone carries `locks`). */
export type FlowLevelSettingV1 = "apply-flag" | "confirm" | "stage-only" | "follow-template";
export type FlowLockV1 = "effects.local" | "effects.cost" | "effects.external" | "effects.irreversible" | "allowedSkillSources" | "budgets.tokensPerRun";
export type FlowsLayerV1 = {
  effects?: { local?: FlowLevelSettingV1; cost?: FlowLevelSettingV1; external?: FlowLevelSettingV1; irreversible?: FlowLevelSettingV1 };
  rerunReview?: "auto" | "review";
  rerunAskTimeoutSeconds?: number;
  roles?: Record<string, { agent: string; model?: string }>;
  allowedSkillSources?: string[];
  budgets?: { tokensPerRun?: number };
  /** Gaps spec §8.2: presets per template and param. */
  paramDefaults?: Record<string, Record<string, string | number | boolean>>;
  locks?: FlowLockV1[];
};
export type ChecksLayerV1 = {
  integrationCheck?: { enabled?: boolean; trigger?: CheckTriggerV1; command?: string | null };
  modelReview?: { enabled?: boolean; trigger?: CheckTriggerV1; budgetTokens?: number; maxGroupsPerReview?: number };
  scheduled?: ScheduledCheckV1[];
  locks?: CheckLockV1[];
};
// Checks spec §4.3: GET /api/control/checks[?repoId=] (src/control/checks/settings.ts checksReadSchema), each field with
// the layer it came from and whether a global lock binds it; `revision` is the layer's, `nextSlots` by scheduled-check id.
export type CheckSourceV1 = "project" | "global" | "builtin";
// `overriddenByLock`: the project's own value a global lock ignores (§4.2), present only then.
export type CheckSourcedV1<T> = { value: T; source: CheckSourceV1; lockedBy: "global" | null; overriddenByLock?: T };
export type CheckLastStateV1 = "running" | "passed" | "failed" | "completed" | "errored" | "initialised" | "skipped" | "migrated";
export type CheckStateV1 = {
  watermark: string | null; lastStartAt: number | null; lastSlot: Record<string, number>; runSeq: number; failureStreak: number; paused: boolean;
  pendingRun: { commandId: string; at: number } | null; rebased: boolean;
  last: { state: CheckLastStateV1; at: number; from: string | null; to: string | null; groups: string[]; detail: string | null; reviewGroupId: string | null; debugGroupIds: string[]; recordHash: string | null } | null;
};
export type ChecksReadV1 = {
  schema: "orca-checks-v1"; repoId: string | null;
  kinds: {
    "integration-check": { enabled: CheckSourcedV1<boolean>; trigger: CheckSourcedV1<CheckTriggerV1>; command: CheckSourcedV1<string | null> };
    "model-review": { enabled: CheckSourcedV1<boolean>; trigger: CheckSourcedV1<CheckTriggerV1>; budgetTokens: CheckSourcedV1<number>; maxGroupsPerReview: CheckSourcedV1<number> };
  };
  scheduled: Array<CheckSourcedV1<ScheduledCheckV1> & { scope: "project" | "global" }>;
  locks: CheckLockV1[];
  state: Array<{ kind: CheckKindV1; target: string; state: CheckStateV1 }>;
  revision: number;
  nextSlots: Record<string, number[]>;
};
/** Spec §6.5, §7: GET /api/control/checks/reviews/:reviewGroupId -- the review's record and its dismissals. */
export type ReviewFindingV1 = {
  id: string; category: "contract-drift" | "duplication" | "uncovered-behaviour"; severity: "major" | "minor"; title: string; explanation: string;
  evidence: Array<{ groupId: string; path: string; line: number; note: string }>; suggestedFix: string;
};
export type ReviewRecordV1 = {
  schema: "orca-model-review-record-v1"; reviewGroupId: string; runId: string; range: { target: string; from: string; to: string }; groups: string[];
  valid: ReviewFindingV1[]; dropped: Array<{ findingId: string; reason: string }>;
  routed: Array<{ findingId: string; severity: string; debugGroupId: string | null; detail: string | null }>;
  dismissals: Array<{ decisionId: string; by: string | null; at: string | null; note: string | null }>;
};
/** Control run decisions plan Task 8: GET /api/control/groups/:groupId/decisions, a group's decisions read from refs. */
export type DecisionWhereV1 = "working-tree" | "target" | "group-branch";
/**
 * Reported-decisions spec 2026-10-20 §6: each entry's grade. The server always sends it; optional here so the literal
 * fixtures need no edit, and an absent value reads as major (web/src/MinorToggle.tsx).
 */
export type DecisionImportanceV1 = "major" | "minor";
/** Kanban spec 2026-10-20 §9a: a landed decision Orca flagged for a person; `corrected` is derived from the corrections. */
export type DecisionFlagV1 = { state: "flagged" | "ratified" | "corrected"; source: string; reason: string; evidence: string[] };
export type GroupDecisionsViewV1 = {
  schema: "orca-group-decisions-v1"; groupId: string; projectKey: string | null; pendingCount: number;
  /** Optional so older literal fixtures parse; the server always sends it. */
  flaggedCount?: number;
  /** Flags not on any listed run's landed lines (an integration conflict an agent resolved); optional like flaggedCount. */
  groupFlags?: Array<DecisionFlagV1 & { decisionId: string; severity?: "major" | "minor"; ownerGroupId?: string }>;
  tasks: Array<{
    taskId: string;
    runs: Array<{
      runId: string; settled: boolean; reported: "absent" | "array" | "malformed" | "unreadable";
      decisions: Array<{ id: string; where: DecisionWhereV1; question: string; chose: string; kind: string; scope: string; importance?: DecisionImportanceV1; flag?: DecisionFlagV1 | null }>;
      pending: Array<{ pendingId: string; reason: string; question: string | null; chose: string | null; undoHow: string | null; state: "pending" | "approved" | "rejected"; importance?: DecisionImportanceV1 }>;
      unlanded: Array<{ entryIndex: number; question: string | null; chose: string | null; importance?: DecisionImportanceV1 }>;
    }>;
  }>;
};
/** Integration spec §3.1: set-group-integration's payload, the same body shape as the repository default's. */
export type SetGroupIntegrationPayloadV1 = { integration: IntegrationSchemeV1 };

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
  /** Checks spec 2026-10-22 §6.1: the agent the model review runs on; absent is defaultAgent. */
  review?: PartialSelectionV1;
};
export type AgentInstallationV1 = { id: string; kind: string; defaults: { model: string; contextWindow: ContextWindowV1 }; contextOptions: ContextWindowV1[]; version: string };
export type AgentsViewV1 = { schema: "orca-agents-view-v1"; installations: AgentInstallationV1[] };
/** Agent version auto-refresh spec 2026-10-20 §3.3: POST /api/control/agents/refresh-versions, per installation. */
export type AgentVersionRefreshV1 = { schema: "orca-agent-version-refresh-v1"; rows: Array<{ id: string; recorded: string; observed: string | null; outcome: "updated" | "unchanged" | "unavailable" }> };
/** Spec 2026-10-15 §5 (R3): GET /api/control/agents/:installation/models -- ccloop's ccloop-models-v1 under Orca's schema tag. */
export type AgentModelsViewV1 = {
  schema: "orca-agent-models-v1"; installation: string; kind: string; source: "cache" | "probe" | "none"; observedAt: string | null;
  models: Array<{ model: string; contextWindowTokens: number | null; maxOutputTokens: number | null; singleCallExecution: "v1" | "v1-soft" | null }>;
};
/** One installation's model list as the selection editor shows it: being read, read, or ccloop's code and detail. */
export type ModelListState = { state: "loading" } | { state: "ready"; view: AgentModelsViewV1 } | { state: "unavailable"; code: string; detail: string };
export type AgentPreferencesViewV1 = { schema: "orca-agent-preferences-v1"; operatorId: string; revision: number; preferences: OperatorPreferencesV1 };
export type AgentInstallationObservationV1 = {
  schema: "orca-agent-detection-observation-v1"; baseTableHash: string; observedAt: string;
  installed: Array<{ id: string; kind: string; command: string[]; recordedVersion: string; observedVersion: string | null; realpath: string | null; status: "current" | "changed" | "unavailable" }>;
};
export type AgentInstallationPreviewV1 = Omit<AgentInstallationObservationV1, "schema"> & {
  schema: "orca-agent-detection-preview-v1"; previewId: string;
  changes: Array<{ changeId: string; kind: "version" | "path" | "addition"; installationId: string; command: string[]; realpath: string; version: string; installation?: Record<string, unknown>; unavailableReason?: string }>;
};
export type AgentInstallationStateV1 = { schema: "orca-agent-installation-state-v1"; revision: number; pending: boolean;
  pendingCommand: null | { schema: "orca-raw-command-v1"; commandId: string; expectedRevision: number; actorId: string; verb: "apply-agent-update"; target: { kind: "operator"; operatorId: string }; payload: { previewId: string; baseTableHash: string; acceptedChangeIds: string[] } };
  observation: AgentInstallationObservationV1 | null; preview: AgentInstallationPreviewV1 | null; failureCode: string | null };
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
  rolePreviews?: { worker: SlotOutcomeV1; estimator: SlotOutcomeV1 };
  selectionsHash: string | null;
};
/** Plan-review P5 (W6-8): the revision travels in the envelope's expectedRevision only. */
export type SetAgentPreferencesPayloadV1 = { preferences: OperatorPreferencesV1 };

/** Labels and progress spec §2.1: G11's system words -- a mirror of src/control/labels.ts, compared by webParity (finding F1). */
export const WEB_SYSTEM_LABELS = ["feature", "bug", "refactor", "test", "doc", "design", "investigate", "perf", "security", "chore"] as const;
export const CUSTOM_LABEL_PREFIX = "custom:";

/** Issue-fixes spec §6.1: the server's categories in its table's order (webParity.test.ts pins the list). */
export const WEB_WORK_ITEM_CATEGORIES = ["idle", "running", "waiting", "blocked", "done"] as const;
export type WorkItemCategoryV1 = (typeof WEB_WORK_ITEM_CATEGORIES)[number];
/** Spec §4.1 (§8 R10, R11, R18): the current run's step, attempt and tokens; null fields are "not reported" or "unknown". */
export type WorkItemProgressV1 = {
  runId: string;
  step: "queued" | "plan" | "execute" | "verify" | "succeeded" | "blocked_waiting_human" | "exhausted" | "cancelled" | "failed" | null;
  attempt: { current: number; max: number } | null;
  tokens: { used: number; grant: number|null } | null;
  lastTransitionAt: string | null;
};
/** Spec §3.1 (§8 R16): replace the task's operator labels, or null to go back to the plan's. */
export type SetTaskLabelsPayloadV1 = { labels: string[] | null; baseLabelsVersion: number };
/** Loop plans spec §2.2: the built-in plans (mirrors src/control/loopPlans.ts LOOP_PLAN_IDS). */
export type LoopPlanIdV1 = "standard" | "bugfix" | "refactor" | "design" | "investigate";
/** Loop plans spec §3.2: a recipe's inputs, every optional field filled. */
export type LoopInputsV1 = { goal: string; successCondition: string; targetPaths: string[]; checks: string[]; nonGoals: string[]; relevantDocs: string[]; protectedPaths: string[]; maxFilesTouched: number | null };
/** Syncskill integration spec §10.4: a loop task's skill set -- a syncskill profile, or explicit names. */
export type LoopSkillsV1 = { profile: string } | { names: string[] };
/** Loop plans spec §4.1, panel i18n spec §3.1: the fields a loop task's card is built from; no English sentence travels. */
export type LoopPlanViewV1 = {
  planId: LoopPlanIdV1; planVersion: number; chosenBy: "explicit" | "labels"; chosenByLabel: string | null;
  amended: boolean; loopVersion: number; inputs: LoopInputsV1; maxFiles: number; hasDiscipline: boolean;
  /** Absent when the recipe has none. */
  skills?: LoopSkillsV1;
  /** Syncskill integration spec §4.6: the names the skill set froze to at confirm; absent before that. */
  frozenSkillNames?: string[];
};
/** Loop plans spec §5.2: change a loop task's plan, inputs and work budget (sessions is carried over). */
export type SetTaskLoopPayloadV1 = {
  baseLoopVersion: number; plan: string; inputs: LoopInputsV1; work: { tokens: number|null; activeMs: number; attempts: number };
  /** W5: the work dimensions taken from an estimate's suggestion; the server re-checks each against it. */
  workProvenance?: Partial<Record<"tokens" | "activeMs" | "attempts", { provenance: "model"; estimateId: string }>>;
  /** Syncskill integration spec §10.4: the full desired skill set, like inputs -- absent removes the task's skills. */
  skills?: LoopSkillsV1;
};
/**
 * Loop plans spec §2.2, panel i18n spec §3.1: the plans a person can pick, at their current registry version (the
 * picker's words are keyed by version) -- a mirror of src/control/loopPlans.ts, compared by tests/panel/taskLoopApi.test.ts.
 */
export const WEB_LOOP_PLANS: ReadonlyArray<{ planId: LoopPlanIdV1; version: number }> = [
  { planId: "standard", version: 3 },
  { planId: "bugfix", version: 3 },
  { planId: "refactor", version: 3 },
  { planId: "design", version: 3 },
  { planId: "investigate", version: 3 },
];

// Read-only overview mirrors the strict server DTO. These destinations carry no command payload.
export type OverviewDestinationV1 =
  | { kind: "requirement"; groupId: string; region: "answers" | "draft" | "problem" }
  | { kind: "group"; groupId: string; region: "preparation" | "dispatch" | "problem" | "integration" | "results"; taskId: string | null; runId: string | null }
  | { kind: "recovery" };
export interface OverviewStepV1 {
  key: string; groupId: string | null; repoId: string | null; taskId: string | null; runId: string | null;
  kind: "requirement-answer" | "requirement-review" | "requirement-attention" | "budget-review" | "start-review" | "task-attention" | "stop-review" | "recovery-review" | "integration-review";
  reason: string; ownerRequired: boolean; destination: OverviewDestinationV1;
}
export interface OverviewIssueV1 { groupId: string | null; repoId: string | null; reason: string }
export interface OverviewV1 { schema: "orca-control-overview-v1"; epoch: string; changeSeq: number; groups: GroupSummaryV1[]; steps: OverviewStepV1[]; issues: OverviewIssueV1[] }

export interface ResultExplanationContentV1 {
    schema: 'task-result-v1';
    goal: string;
    completedWork: string[];
    conclusions: string[];
    outputs: Array<{
        path: string;
        label: string;
    }>;
    limitations: string[];
}
export interface ResultExplanationV1 {
    status: 'available' | 'missing' | 'invalid' | 'unavailable';
    reason: string | null;
    content: ResultExplanationContentV1 | null;
}
export type ResultVerificationV1 = 'not-run' | 'in-progress' | 'passed' | 'failed' | 'unavailable';
export type ResultOutputStatusV1 = 'available' | 'missing' | 'deleted' | 'symlink' | 'binary' | 'too-large' | 'changed' | 'unsafe' | 'unavailable';
export interface ResultOutputMetadataV1 {
    outputId: string;
    path: string;
    label: string;
    origin: 'reported' | 'changed';
    status: ResultOutputStatusV1;
    byteLength: number | null;
}
export interface ResultOutputV1 {
    schema: 'orca-result-output-v1';
    runId: string;
    groupId: string;
    attempt: number;
    outputId: string;
    path: string;
    status: ResultOutputStatusV1;
    byteLength: number | null;
    content: string | null;
    downloadUrl: string | null;
}
export interface ResultAttemptV1 {
    attempt: number;
    current: boolean;
    revision: number;
    snapshotRevision: number | null;
    execution: 'complete' | 'partial' | 'unavailable';
    verification: ResultVerificationV1;
    explanation: ResultExplanationV1;
    outputs: ResultOutputMetadataV1[];
    observations: Array<{
        revision: number;
        stage: 'execution' | 'verification';
        verification: ResultVerificationV1;
    }>;
}
export type ResultRunViewV1 = RunViewV1 & {
    blockedReason: string | null;
    continuable: boolean;
};
export interface RunResultsV1 {
    schema: 'orca-run-results-v1';
    epoch: string;
    changeSeq: number;
    runId: string;
    groupId: string;
    taskId: string | null;
    generation: number;
    executionId: string | null;
    run: ResultRunViewV1;
    currentAttempt: number | null;
    captureRevision: number;
    source: {
        status: 'available' | 'missing' | 'unsupported' | 'stale' | 'unavailable';
        reason: string | null;
    };
    availability: 'available' | 'partial' | 'missing' | 'unavailable';
    currentExplanation: ResultExplanationV1;
    attempts: ResultAttemptV1[];
}
export interface GroupResultsV1 {
    schema: 'orca-group-results-v1';
    epoch: string;
    changeSeq: number;
    groupId: string;
    goal: string;
    successConditions: string[];
    status: GroupSummaryV1['state'];
    review: {
        runs: ResultRunViewV1[];
    };
    delivery: NonNullable<GroupViewV1['integration']> | null;
    tasks: Array<{
        taskId: string;
        status: WorkItemViewV1['status'];
        currentRunId: string | null;
        pendingRunId: string | null;
        lineageRunIds: string[];
        availability: 'available' | 'partial' | 'missing' | 'unavailable' | 'not-produced';
        runs: RunResultsV1[];
    }>;
    coverage: {
        total: number;
        available: number;
        partial: number;
        missing: number;
        unavailable: number;
        notProduced: number;
    };
}

export type RecoveryOf={sourceRunId:string;sourceAttempt:number;capsuleHash:string;snapshotHash:string;normalizedExecutionHash:string};
export type SavedResultEligibilityV1={status:"unavailable";reason:string}|{status:"eligible";authorityKind:"execution-format-failure-v1"|"legacy-published-candidate-v1";sourceIdentity:{groupId:string;workItemId:string;taskId:string;runId:string;generation:number;graphVersion:number;targetVersion:number;executionId:string;envelopeHash:string};rawExecutionTokens:number;recoveryOf:RecoveryOf;limitation:"published-candidate-only; current membership and settled accounting require controller admission"};

/**
 * Flow engine spec §11.2, §14.1 (plan Task 16): the flow reads the Web renders. FlowSettingsReadV1 and FlowListV1 are
 * paired with the server's (tests/panel/webParity.test.ts); the run view and the journal are plain JSON the server builds
 * from its store (src/flow/views.ts, typed `unknown` there), so their copies here name only what the run page reads.
 */
export const WEB_FLOW_EFFECT_CLASSES = ["local", "cost", "external", "irreversible"] as const;
export type FlowEffectClassV1 = (typeof WEB_FLOW_EFFECT_CLASSES)[number];
export type FlowLevelV1 = "apply-flag" | "confirm" | "stage-only";
export const WEB_FLOW_LOCKABLE_PATHS = ["effects.local", "effects.cost", "effects.external", "effects.irreversible", "allowedSkillSources", "budgets.tokensPerRun"] as const;
export type FlowLockablePathV1 = (typeof WEB_FLOW_LOCKABLE_PATHS)[number];
export type FlowSourcedV1<T> = { value: T; source: "project" | "global" | "builtin"; lockedBy: "global" | null; overriddenByLock?: T };
export type FlowSettingsReadV1 = {
  effects: Record<FlowEffectClassV1, FlowSourcedV1<FlowLevelSettingV1>>;
  rerunReview: FlowSourcedV1<"auto" | "review">;
  rerunAskTimeoutSeconds: FlowSourcedV1<number>;
  roles: FlowSourcedV1<Record<string, { agent: string; model?: string }>>;
  allowedSkillSources: FlowSourcedV1<string[] | null>;
  budgets: { tokensPerRun: FlowSourcedV1<number> };
  paramDefaults: Record<string, Record<string, FlowSourcedV1<string | number | boolean>>>;
  locks: FlowLockablePathV1[];
};
export type FlowListV1 = {
  schema: "orca-flow-list-v1";
  runs: Array<{ flowRunId: string; groupId: string; templateRef: string; state: string; poolTokens: number; poolDrawn: number; projectId: string | null; dir: string | null; needsYou: number; scheduled: FlowRunScheduledV1 | null }>;
};
/** Scheduled flows and groups spec §13.3: the schedule that started a run, and its slot. */
export type FlowRunScheduledV1 = { scheduleId: string; name: string; slot: number };
/** Gaps spec §8.4 (plan Task 10-B): the start dialog's reads, paired with src/flow/startForm.ts (webParity.test.ts). */
export type FlowParamTypeV1 = "text" | "longtext" | "enum" | "bool" | "int" | "path" | "slug" | "image";
export type FlowTemplateParamV1 = { id: string; type: FlowParamTypeV1; required: boolean; options?: string[]; default?: string | number | boolean; derive?: "slug-of-idea" | "today" };
export type FlowTemplatesV1 = {
  schema: "orca-flow-templates-v1";
  templates: Array<{ id: string; version: number | null; title: { en?: string; zh?: string } | null; params: FlowTemplateParamV1[]; excludes: string[] }>;
};
export type FlowFolderImagesV1 = { schema: "orca-flow-folder-images-v1"; dir: string; files: string[]; truncated: boolean; limit: number };
export type FlowToolRuleStatusV1 = "enforced" | "detected" | "recorded-only" | "refused";
export type FlowToolRulesReportV1 = {
  schema: "ccloop-tool-rules-report-v1"; agentKind: "claude" | "codex" | "omp"; baseline: string;
  rules: Array<{
    rule: { kind: "commands-closed" } | { kind: "exact" | "prefix"; value: string } | { kind: "network"; value: boolean } | { kind: "secretEnv"; name: string };
    status: FlowToolRuleStatusV1; reason: string | null; phases: Array<"plan" | "execute" | "verify">; present?: boolean;
  }>;
};
/** What a waiting step asks: an `ask` form, an effect's confirm card, or an agent's question / confirmation request. */
export type FlowAskV1 =
  | { kind: "ask"; form: Record<string, { type: string; options?: string[]; default?: string | number | boolean; required?: boolean }>; candidates: Record<string, string[]>; defaults: Record<string, string | number | boolean>; freeText: boolean }
  | { kind: "effect-confirm"; recordId: string; stepKey: string; effectKind: string; class: string; policy: FlowResolvedLevelV1; summary: string }
  | { kind: "input"; question: string; candidates: string[]; unclassed?: boolean }
  | { kind: "confirmation"; what: string; payloadSummary: string; unclassed?: boolean }
  | { kind: "clarify-round"; roundNo: number };
export type FlowResolvedLevelV1 = { value: FlowLevelV1; source: "project" | "global" | "template" | "builtin" | "schedule"; lockedBy: "global" | null; overriddenByLock?: FlowLevelV1 };
export type FlowExecutionViewV1 = {
  seq: number; state: string; reasons: string[]; planNo: number | null; childGroupId: string | null; by: string; via: string;
  flags: string[]; failure: string | null;
  output: { kind: "commit" | "artifact" | "none"; ref: string | null; hash: string | null } | null;
  toolRules: FlowToolRulesReportV1 | null; ask: FlowAskV1 | null; needsYou: { reason?: string } | null;
  reported: { candidates?: Record<string, { items: string[]; recommended: number }>; effect?: { remoteId: string; url?: string } } | null;
  warnings: string[]; effectRecordId: string | null;
  spend: FlowSpendV1;
};
/**
 * Gaps spec §10 (src/flow/spend.ts): the tool-reported tokens of an execution, step, intake, plan or run. `tokens` null
 * means the tool gave no number (never 0); a sum over a mix keeps the known part with `unknownReason` "partial: …". No
 * tool reports money. A `legacy:<step>#<seq>` run id names no run record.
 */
export type FlowSpendV1 = { tokens: number | null; unknownReason: string | null; usd: null; usdReason: string; runs: Array<{ runId: string; purpose: string; tokens: number | null }> };
/** Gaps spec §6 (marks.ts): a step's standing skip or defer, with a defer's effect choices. */
export type FlowMarkV1 = { kind: "skip" | "defer"; messageSeq: number; effects: Record<string, "proceed" | "wait"> };
/** Gaps spec §5.2-§5.5 (rerun.ts): an unsure step's question, and a step accepted as unchanged. */
export type FlowPendingAnswerV1 = { choice: "run" | "accept-unchanged"; by: string; via: string; at: number; source: "person" | "timeout" | "carried"; fromPlan?: number };
export type FlowPendingItemV1 = { stepKey: string; question: string; askedAt: number; deadline: number; answer: FlowPendingAnswerV1 | null; closed?: string };
export type FlowAcceptedItemV1 = { stepKey: string; seq: number; by: string; via: string; at: number; source: "person" | "timeout" | "carried"; fromPlan?: number };
/** Gaps spec §4 (views.ts `intakes`): one feedback intake -- where its quote was found, which steps take it, its clarify round. */
export type FlowAnchorV1 = { quote?: string; heading?: string; paragraph?: number };
export type FlowHitV1 = { file: string; paragraph: number; headingPath: string[]; excerpt: string };
export type FlowIntakeV1 = {
  messageSeq: number;
  state: "locating" | "needs-location" | "triaging" | "clarifying" | "restating" | "ready" | "planned" | "withdrawn" | "failed";
  text: string; stepKey: string | null; anchors: FlowAnchorV1[];
  results: Array<{ anchor: FlowAnchorV1; located: FlowHitV1 } | { anchor: FlowAnchorV1; hits: FlowHitV1[]; more: number }>;
  ambiguousFiles: string[]; targets: Array<{ stepKey: string; why: string }>; restated: string | null; flags: string[]; planNo: number | null;
  asIs: boolean; attachments: string[];
  clarify: { roundNo: number; questions: Array<{ id: string; question: string; recommendedAnswer: string }> } | null;
  spend: FlowSpendV1;
};
export type FlowPlanV1 = {
  flowRunId: string; planNo: number; state: "proposed" | "chosen" | "running" | "done" | "abandoned";
  candidates: { list: Array<{ stepKey: string; reasons: string[] }>; feedback: Record<string, string[]>; edits: string[]; trigger: string };
  proposal: { retries: number; lastInvalid: string | null; skips: Array<{ stepKey: string; reason: string }> | null; unsure?: Array<{ stepKey: string; question: string }> | null; exhausted: string | null } | null;
  chosen: { steps: string[]; skips: string[]; added: string[]; pending?: FlowPendingItemV1[]; accepted?: FlowAcceptedItemV1[] } | null; by: string; via: string;
  spend: FlowSpendV1;
};
export type FlowEffectV1 = {
  id: string; flowRunId: string; stepKey: string; seq: number; effectKind: string; class: string; level: string; policy: FlowResolvedLevelV1;
  state: "staged" | "confirmed" | "applied" | "discarded" | "failed"; payloadHash: string; remoteRef: string | null; by: string; via: string; createdAt: number; updatedAt: number;
};
export type FlowRunViewV1 = {
  schema: "orca-flow-run-view-v1"; flowRunId: string; groupId: string; templateRef: string; state: string; params: Record<string, string | number | boolean>;
  poolTokens: number; poolDrawn: number; by: string; via: string; dir: string | null;
  /** Scheduled flows and groups spec §13.3: the schedule that started this run; null for a hand start. */
  scheduled: FlowRunScheduledV1 | null;
  template: { id: string; version: number | null; title: { en?: string; zh?: string } | null };
  steps: Array<{
    stepKey: string; kind: string; head: number | null; executor: "agent" | "person" | "either" | null; parallelWith: string | null;
    effect: { kind: string; class: string | null } | null;
    latest: FlowExecutionViewV1 | null; executions: FlowExecutionViewV1[];
    clarify: { rounds: RoundBodyV1[]; chain: number[] } | null;
    /** Gaps spec §9: a newer execution still working on a revision of this clarify step (`clarify` is the active one's). */
    clarifyRevision: { seq: number; state: string; rounds: RoundBodyV1[]; chain: number[] } | null;
    /** Gaps spec §6: the step's standing mark, the deferred steps holding it, the effect steps a defer of it would hold. */
    mark: FlowMarkV1 | null; heldBy: string[]; deferHolds: string[];
    /** Gaps spec §8.4: the params its `when` reads. */
    whenParams: Array<{ id: string; type: string | null }>;
    spend: FlowSpendV1;
  }>;
  openAsks: Array<{ stepKey: string; seq: number; ask: FlowAskV1 }>;
  plans: FlowPlanV1[];
  intakes: FlowIntakeV1[];
  spend: FlowSpendV1;
  effects: FlowEffectV1[];
  decisions: Array<{ seq: number; grade: "major" | "minor"; stepKey: string | null; body: Record<string, unknown>; by: string }>;
};
export type FlowMessageV1 = {
  flowRunId: string; seq: number; requestId: string; kind: string; target: string; body: Record<string, unknown>;
  by: string; via: string; state: "accepted" | "applied" | "rejected" | "excluded"; reason: string | null; at: number;
};
export type FlowJournalV1 = { schema: "orca-flow-journal-v1"; flowRunId: string; messages: FlowMessageV1[] };

/** Live transcript spec §12.3: one call of a run's transcripts listing (src/agentTranscript/listing.ts). No path, ever. */
export interface TranscriptCallV1 { attempt: number; phase: string; seq: number; runtime: "claude" | "codex" | "omp" | null; recorded: boolean; bytes: number; final: boolean; truncatedAt: number | null }
/** GET /api/control/runs/:runId/transcripts. `available: false` -- the ccloop records no transcripts (`reason`). */
export interface RunTranscriptsV1 { schema: "orca-run-transcripts-v1"; runId: string; available: boolean; reason?: string; calls: TranscriptCallV1[] }
/** A served field: its redacted head, its full length in code units, and whether expanding shows more. */
export interface TranscriptFieldV1 { text: string; length: number; more: boolean }
/** One normalized event (spec §5.1, §10.3); `at`/`i` address it for expanding. */
export interface TranscriptEventV1 {
  at: number; i: number;
  kind: "message" | "tool_call" | "tool_result" | "file_change" | "thinking" | "result" | "notice" | "unknown";
  meta?: Record<string, string>; num?: Record<string, number>; flag?: Record<string, boolean>; fields?: Record<string, TranscriptFieldV1>;
}
/** GET …/transcripts/:attempt/:phase/:seq -- a window (≤ 200 events, ≤ 4 MiB read); `start`/`end` continue it. */
export interface TranscriptWindowV1 {
  schema: "orca-transcript-window-v1"; runId: string; attempt: number; phase: string; seq: number; runtime: string;
  source: "run" | "archive"; final: boolean; truncatedAt: number | null; events: TranscriptEventV1[]; start: number; end: number; indexedEnd: number; counted: number;
}
/** GET …/expand -- one page (65 536 code units) of an event's field, or of an oversized line's decoded text. */
export interface TranscriptPageV1 { schema: "orca-transcript-page-v1"; at: number; text: string; page: number; pages: number; length: number }

// Scheduled flows and groups spec 2026-10-24 §6, §13.1: mirrors of src/control/schedules/views.ts and model.ts.
export type ScheduleStartV1 =
  | { kind: "flow"; template: string; params: Record<string, string | number | boolean>; clarify?: "skip"; unattended?: boolean; pool?: number }
  | { kind: "group"; entryId: string; sha256: string; tokenLimit: number | null; integration: IntegrationSchemeV1 | null };
export type ScheduleFireOutcomeV1 = "starting" | "started" | "waiting" | "skipped" | "failed";
export type ScheduleFireViewV1 = {
  seq: number; slot: number; at: number; lateMs: number | null; missed: number; outcome: ScheduleFireOutcomeV1;
  reason: string | null; commandId: string | null; flowRunId: string | null; groupId: string | null;
  creditedTo: string | null; confirm: Record<string, unknown> | null; by: string; via: string;
};
export type ScheduleViewV1 = {
  id: string; projectId: string; name: string; kind: "flow" | "group"; cron: string; enabled: boolean;
  start: ScheduleStartV1; removed: boolean; revision: number;
  createdBy: string; createdVia: string; createdAt: number;
  updatedBy: string; updatedVia: string; updatedAt: number;
  enabledBy: string; enabledVia: string; enabledAt: number;
  lastSlot: number | null; tz: string | null; failureStreak: number; paused: boolean; pausedReason: string | null;
  nextSlots: number[]; lastFire: ScheduleFireViewV1 | null; newerVersion: string | null;
};
export type SchedulesViewV1 = { schema: "orca-schedules-v1"; repoId: string; schedules: ScheduleViewV1[] };
export type ScheduleDetailV1 = { schema: "orca-schedule-v1" } & ScheduleViewV1;
export type ScheduleFiresViewV1 = { schema: "orca-schedule-fires-v1"; scheduleId: string; fires: ScheduleFireViewV1[] };
// §5.3, §13.3: mirrors of src/control/planLibrary/views.ts and store.ts.
export type LibraryOriginV1 =
  | { kind: "group"; groupId: string; planHash: string }
  | { kind: "requirement-draft"; groupId: string; draftNo: number; draftHash: string }
  | { kind: "import"; fileName: string; fileSha256: string; format: "orca-plan-v1" | "scheduler-plan-file" };
export type PlanLibraryVersionV1 = { version: number; sha256: string; by: string; via: string; at: number; origin: LibraryOriginV1 };
export type PlanLibraryEntryV1 = {
  entryId: string; projectId: string; name: string; state: "active" | "archived";
  createdBy: string; createdVia: string; createdAt: number;
  archivedBy?: string | null; archivedVia?: string | null; archivedAt?: number | null;
  head: PlanLibraryVersionV1 | null; versionCount: number; usedBy: string[];
};
export type PlanLibraryListViewV1 = { schema: "orca-plan-library-v1"; repoId: string; entries: PlanLibraryEntryV1[] };
export type PlanLibraryEntryViewV1 = { schema: "orca-plan-library-entry-v1" } & PlanLibraryEntryV1 & { versions: PlanLibraryVersionV1[] };
export type ScheduleSetPayloadV1 =
  | { projectId: string; name: string; cron: string; enabled: boolean; start: ScheduleStartV1 }
  | { set: { name?: string; cron?: string; start?: ScheduleStartV1 } };
export type ScheduleFromGroupPayloadV1 = { scheduleId: string; name: string; cron: string; enabled: boolean; tokenLimit?: number | null };
export type PlanLibraryImportPayloadV1 = {
  projectId: string; name: string; entryId?: string; doc: unknown;
  provenance: { fileName: string; fileSha256: string; format: "orca-plan-v1" | "scheduler-plan-file" };
};
