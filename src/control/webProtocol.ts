import { z } from "zod";
import { agentSelectionSchema, amountSchema, canonicalTimestampSchema, commandEnvelopeSchema, contextWindowSchema, idSchema, partialSelectionSchema, safeInteger } from "./schema.js";
// Agent selection spec §12 I10 (plan-review P18): the selection/context/partial schemas are T7's, defined once
// in schema.ts; webProtocol.ts re-exports them so every downstream import can come from one wire module.
export { agentSelectionSchema, contextWindowSchema, partialSelectionSchema } from "./schema.js";

const nonemptyString = z.string().min(1);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const positiveSafeInteger = safeInteger.positive();
const amountDimensionSchema = z.enum(["tokens", "activeMs", "attempts", "sessions"]);

function issue(ctx: z.RefinementCtx, path: PropertyKey[], message: string): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path: path as (string | number)[], message });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireUnique<T>(values: readonly T[], key: (value: T) => string, ctx: z.RefinementCtx, path: PropertyKey[]): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    const id = key(value);
    if (seen.has(id)) issue(ctx, [...path, index], "duplicate-set-value");
    seen.add(id);
  });
}

function requireSortedUnique<T>(
  values: readonly T[],
  key: (value: T) => string,
  ctx: z.RefinementCtx,
  path: PropertyKey[],
): void {
  requireUnique(values, key, ctx, path);
  for (let index = 1; index < values.length; index += 1) {
    if (compareText(key(values[index - 1]), key(values[index])) >= 0) {
      issue(ctx, [...path, index], "set-not-canonically-sorted");
    }
  }
}

const sortedIdArraySchema = z.array(idSchema).superRefine((values, ctx) => requireSortedUnique(values, String, ctx, []));
const sortedHashArraySchema = z.array(hashSchema).superRefine((values, ctx) => requireSortedUnique(values, String, ctx, []));
const orderedUniqueNonemptyStringsSchema = z
  .array(nonemptyString)
  .min(1)
  .superRefine((values, ctx) => requireUnique(values, String, ctx, []));
const orderedUniqueStringsSchema = z.array(nonemptyString).superRefine((values, ctx) => requireUnique(values, String, ctx, []));
// Agent selection spec §6.2 layer 1: an operator's own defaults document (agentSelection.ts's OperatorPreferences).
// Spec §3 I2: model is opaque to Orca; only ccloop's descriptor judges it (§4.1). Orca bounds length only.
const preferenceModelSchema = z.string().min(1).max(200);
export const operatorPreferencesSchema = z
  .object({
    defaultAgent: idSchema.optional(),
    perAgent: z.record(idSchema, z.object({ model: preferenceModelSchema.optional(), contextWindow: contextWindowSchema.optional() }).strict()),
    estimator: partialSelectionSchema.optional(),
    reconcile: partialSelectionSchema.optional(),
  })
  .strict();
// Agent selection spec §6.2 (W6-20): a group's own selection layers, one per slot; a panel write replaces a whole layer.
export const groupAgentOverridesSchema = z
  .object({ worker: partialSelectionSchema.optional(), estimator: partialSelectionSchema.optional(), reconcile: partialSelectionSchema.optional() })
  .strict();
const sortedDimensionsSchema = z
  .array(amountDimensionSchema)
  .superRefine((values, ctx) => requireSortedUnique(values, String, ctx, []));

export const webWorkKindSchema = z.enum(["budget-estimate", "task", "handoff", "goal-review"]);
export const profileBindingSchema = z.object({ profileId: idSchema, profileHash: hashSchema }).strict();

const requestBoundProofDescriptorSchema = z
  .object({
    scheme: z.literal("adapter-request-bound-v1"),
    version: nonemptyString,
    workDimensions: sortedDimensionsSchema,
    handoffDimensions: sortedDimensionsSchema,
    evidenceKind: nonemptyString,
  })
  .strict();

const tokenizerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("exact"), tokenizerId: nonemptyString, tokenizerVersion: nonemptyString }).strict(),
  z
    .object({
      kind: z.literal("utf8-upper-bound"),
      numerator: positiveSafeInteger,
      denominator: positiveSafeInteger,
      proofRef: nonemptyString,
    })
    .strict(),
]);

export const capabilityViewSchema = z
  .object({
    usageObservation: z.enum(["realtime", "phase-end", "unavailable"]),
    budgetEnforcement: z.enum(["bounded", "soft", "unavailable"]),
    contextObservation: z.enum(["realtime", "phase-end", "unavailable"]),
    handoffControl: z.enum(["durable", "phase-end", "unavailable"]),
    handoffExecution: z.enum(["mechanical-in-run-v1", "model-assisted-v1"]).nullable(),
    contextWindowTokens: positiveSafeInteger.nullable(),
    requestBoundProof: requestBoundProofDescriptorSchema.nullable(),
  })
  .strict();

// Agent selection spec §6.3: where each resolved field came from (agentSelection.ts's ProvenanceSource).
export const provenanceSourceSchema = z.enum([
  "operator", "operator-estimator", "operator-reconcile", "group", "group-estimator", "group-reconcile", "task", "operator-agent", "descriptor",
]);
export const selectionProvenanceSchema = z
  .object({ agent: provenanceSourceSchema, model: provenanceSourceSchema, contextWindow: provenanceSourceSchema })
  .strict();
// Spec §6.4 / §12 I5: one frozen slot -- what was asked, where each field came from, and ccloop's capabilities-v3 answer.
export const frozenSlotSchema = z
  .object({
    partial: partialSelectionSchema,
    provenance: selectionProvenanceSchema,
    selection: agentSelectionSchema,
    configHash: hashSchema,
    timeoutMs: positiveSafeInteger.max(2_147_483_647),
    killGraceMs: safeInteger.max(60_000),
    capabilities: capabilityViewSchema,
  })
  .strict();
// Agent selection spec §6.4 step 4: what confirmation froze onto one task's work item, and what its runs carry.
export const frozenTaskAgentSchema = z
  .object({
    taskId: idSchema,
    agent: agentSelectionSchema,
    agentProvenance: selectionProvenanceSchema,
    configHash: hashSchema,
    timeoutMs: positiveSafeInteger.max(2_147_483_647),
    killGraceMs: safeInteger.max(60_000),
    agentCapabilities: capabilityViewSchema,
  })
  .strict();

const declaredCapabilitiesSchema = capabilityViewSchema.extend({
  handoffExecution: z.enum(["mechanical-in-run-v1", "model-assisted-v1"]),
}).strict();

// Agent selection spec §4.6 / §5: the protocol-2 capabilities payload is gone. `control capabilities`
// answers protocol 3 (a table view, or one selection's resolution whose `capabilities` is this view with
// no protocol tag); those response schemas live with the port that parses them (ccloopPort.ts).

// Agent selection spec §6.5 (human ruling "同意删"): profile v2 drops the adapter identity fields -- which agent and
// which model are the frozen selection's now, and capabilities come from ccloop's answer for that selection (spec
// §3 I3), intersected with this declaration per (profile, selection). So the codex-only phase-end/soft rule is gone.
export const executionProfileSnapshotSchema = z
  .object({
    schema: z.literal("orca-execution-profile-snapshot-v2"),
    profile: z
      .object({
        profileId: idSchema,
        allowedWorkKinds: z
          .array(webWorkKindSchema)
          .min(1)
          .superRefine((values, ctx) => requireSortedUnique(values, String, ctx, [])),
        contextTokenizer: z.object({ tokenizerId: nonemptyString, tokenizerVersion: nonemptyString }).strict().nullable(),
        workMaxOutputTokens: positiveSafeInteger.nullable(),
        capabilities: declaredCapabilitiesSchema,
        estimatorPreflight: z
          .object({
            instructionVersion: nonemptyString,
            schemaVersion: z.literal("budget-estimate-v1"),
            maxOutputTokens: positiveSafeInteger,
            framingTokenOverhead: safeInteger,
            tokenizer: tokenizerSchema,
          })
          .strict()
          .nullable(),
      })
      .strict(),
    resolved: z
      .object({
        proofDocumentContentHashes: sortedHashArraySchema,
        tokenizerArtifactHashes: z.array(
          z.object({ purpose: z.enum(["context", "estimator"]), contentHash: hashSchema }).strict(),
        ),
        secretValueHashes: z.array(z.object({ name: nonemptyString, valueHash: hashSchema }).strict()),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const { profile, resolved } = value;
    const observesContext = profile.capabilities.contextObservation !== "unavailable";
    if (observesContext !== (profile.contextTokenizer !== null)) {
      issue(ctx, ["profile", "contextTokenizer"], "context-tokenizer-capability-mismatch");
    }
    const doesTaskWork = profile.allowedWorkKinds.includes("task");
    if (doesTaskWork !== (profile.workMaxOutputTokens !== null)) {
      issue(ctx, ["profile", "workMaxOutputTokens"], "work-output-limit-kind-mismatch");
    }
    requireSortedUnique(resolved.tokenizerArtifactHashes, (entry) => entry.purpose, ctx, ["resolved", "tokenizerArtifactHashes"]);
    requireSortedUnique(resolved.secretValueHashes, (entry) => entry.name, ctx, ["resolved", "secretValueHashes"]);
    const expectedPurposes: string[] = [];
    if (profile.contextTokenizer !== null) expectedPurposes.push("context");
    if (profile.estimatorPreflight?.tokenizer.kind === "exact") expectedPurposes.push("estimator");
    const actualPurposes = resolved.tokenizerArtifactHashes.map((entry) => entry.purpose);
    if (expectedPurposes.join("\0") !== actualPurposes.join("\0")) {
      issue(ctx, ["resolved", "tokenizerArtifactHashes"], "tokenizer-artifact-set-mismatch");
    }
  });

export const requestBoundProofArtifactSchema = z
  .object({
    schema: z.literal("orca-request-bound-proof-v1"),
    phase: z.enum(["estimate", "work", "handoff"]),
    runId: idSchema,
    generation: positiveSafeInteger,
    providerAttemptOrdinal: positiveSafeInteger,
    startEnvelopeHash: hashSchema,
    derivedContractHash: hashSchema,
    profileId: idSchema,
    profileHash: hashSchema,
    proofScheme: z.literal("adapter-request-bound-v1"),
    proofVersion: nonemptyString,
    requestLimits: z
      .object({
        tokens: safeInteger.nullable(),
        activeMs: safeInteger.nullable(),
        attempts: safeInteger.nullable(),
        sessions: safeInteger.nullable(),
      })
      .strict(),
    boundedDimensions: sortedDimensionsSchema,
    evidenceKind: nonemptyString,
    providerStartForbiddenUntilVerified: z.literal(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    const bounded = new Set(value.boundedDimensions);
    (["tokens", "activeMs", "attempts", "sessions"] as const).forEach((dimension) => {
      if (bounded.has(dimension) !== (value.requestLimits[dimension] !== null)) {
        issue(ctx, ["requestLimits", dimension], "request-limit-dimension-mismatch");
      }
    });
    if (value.requestLimits.attempts !== null && value.requestLimits.attempts !== 1) {
      issue(ctx, ["requestLimits", "attempts"], "request-attempt-limit-must-be-one");
    }
    if (value.requestLimits.sessions !== null && ![0, 1].includes(value.requestLimits.sessions)) {
      issue(ctx, ["requestLimits", "sessions"], "request-session-limit-must-be-zero-or-one");
    }
  });

const proofPhaseSchema = z.enum(["estimate", "work", "handoff"]);

export const proofAcceptedRecordSchema = z
  .object({
    schema: z.literal("orca-proof-accepted-v1"),
    runId: idSchema,
    generation: positiveSafeInteger,
    phase: proofPhaseSchema,
    providerAttemptOrdinal: positiveSafeInteger,
    artifactHash: hashSchema,
    dispatchEnvelopeHash: hashSchema,
    acceptedAt: canonicalTimestampSchema,
  })
  .strict();
export type ProofAcceptedRecordV1 = z.infer<typeof proofAcceptedRecordSchema>;

export const providerStartMarkerSchema = z
  .object({
    schema: z.literal("orca-provider-start-v1"),
    runId: idSchema,
    generation: positiveSafeInteger,
    phase: proofPhaseSchema,
    artifactHash: hashSchema.nullable(),
    dispatchEnvelopeHash: hashSchema,
    providerAttemptOrdinal: positiveSafeInteger,
    startedAt: canonicalTimestampSchema,
  })
  .strict();
export type ProviderStartMarkerV1 = z.infer<typeof providerStartMarkerSchema>;

export const noProviderStartProofSchema = z
  .object({
    schema: z.literal("orca-no-provider-start-v1"),
    runId: idSchema,
    generation: positiveSafeInteger,
    phase: proofPhaseSchema,
    providerAttemptOrdinal: positiveSafeInteger,
    artifactHash: hashSchema.nullable(),
    dispatchEnvelopeHash: hashSchema,
    adapterExecutionId: nonemptyString,
    providerInvoked: z.literal(false),
    terminalObservationHash: hashSchema,
    stopProofHash: hashSchema,
    observedAt: canonicalTimestampSchema,
  })
  .strict();
export type NoProviderStartProofV1 = z.infer<typeof noProviderStartProofSchema>;

export const adapterTerminalObservationSchema = z
  .object({
    schema: z.literal("orca-adapter-terminal-observation-v1"),
    adapterExecutionId: nonemptyString,
    runId: idSchema,
    generation: positiveSafeInteger,
    phase: proofPhaseSchema,
    providerAttemptOrdinal: positiveSafeInteger,
    state: z.literal("exited-before-provider"),
    exitCode: z.number().int().nullable(),
    signal: z.string().nullable(),
    finalJournalHash: hashSchema,
    observedAt: canonicalTimestampSchema,
  })
  .strict();
export type AdapterTerminalObservationV1 = z.infer<typeof adapterTerminalObservationSchema>;

export const adapterStopProofSchema = z
  .object({
    schema: z.literal("orca-adapter-stop-proof-v1"),
    adapterExecutionId: nonemptyString,
    runId: idSchema,
    generation: positiveSafeInteger,
    phase: proofPhaseSchema,
    providerAttemptOrdinal: positiveSafeInteger,
    providerStartMarkerPresent: z.literal(false),
    processGroupStopped: z.literal(true),
    finalJournalHash: hashSchema,
    stoppedAt: canonicalTimestampSchema,
  })
  .strict();
export type AdapterStopProofV1 = z.infer<typeof adapterStopProofSchema>;

// workerSessionOrdinal must equal 1 and sequence must be the next accepted value; those
// cross-record checks live in the observation handler so they surface as `context-observation-invalid`.
export const contextObservationSchema = z
  .object({
    schema: z.literal("orca-context-observation-v1"),
    runId: idSchema,
    generation: positiveSafeInteger,
    workerSessionOrdinal: safeInteger,
    sequence: positiveSafeInteger,
    occupiedInputTokens: safeInteger,
    requestMaxOutputTokens: positiveSafeInteger,
    tokenizerId: nonemptyString,
    tokenizerVersion: nonemptyString,
    observedAt: canonicalTimestampSchema,
  })
  .strict();
export type ContextObservationV1 = z.infer<typeof contextObservationSchema>;

export const dispatchEnvelopeSchema = z
  .object({
    schema: z.literal("orca-dispatch-envelope-v1"),
    phase: z.enum(["estimate", "work", "handoff"]),
    groupId: idSchema,
    workItemId: idSchema,
    runId: idSchema,
    generation: positiveSafeInteger,
    claimIdentity: nonemptyString,
    ownerTokenHash: hashSchema,
    continuationIntentId: idSchema.nullable(),
    claimOrdinal: positiveSafeInteger.nullable(),
    derivedContractHash: hashSchema,
    grants: z.object({ work: amountSchema, handoff: amountSchema }).strict(),
    profiles: z
      .object({ estimator: profileBindingSchema.nullable(), worker: profileBindingSchema.nullable(), handoff: profileBindingSchema.nullable() })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const populated = (Object.entries(value.profiles) as ["estimator" | "worker" | "handoff", unknown][])
      .filter(([, binding]) => binding !== null)
      .map(([slot]) => slot);
    const expected = value.phase === "estimate" ? ["estimator"] : value.phase === "handoff" ? ["handoff"] : ["worker", "handoff"];
    if (populated.join("\0") !== expected.join("\0")) issue(ctx, ["profiles"], "dispatch-profile-slot-mismatch");
    if (value.phase === "estimate" && value.claimOrdinal !== null) issue(ctx, ["claimOrdinal"], "estimate-claim-ordinal-must-be-null");
    if (value.phase === "estimate" && Object.values(value.grants.handoff).some((amount) => amount !== 0)) {
      issue(ctx, ["grants", "handoff"], "estimate-handoff-grant-must-be-zero");
    }
    if (value.phase !== "estimate" && value.claimOrdinal === null) {
      issue(ctx, ["claimOrdinal"], "phase-claim-ordinal-required");
    }
    if (value.phase !== "work" && value.continuationIntentId !== null) {
      issue(ctx, ["continuationIntentId"], "continuation-only-valid-for-work");
    }
  });

const effectiveEstimatorCapabilitiesSchema = z
  .object({
    contextWindowTokens: positiveSafeInteger,
    usageObservation: z.enum(["realtime", "phase-end", "unavailable"]),
    budgetEnforcement: z.enum(["bounded", "soft", "unavailable"]),
    contextObservation: z.enum(["realtime", "phase-end", "unavailable"]),
  })
  .strict();

export const estimateExecutionContractSchema = z
  .object({
    schema: z.literal("orca-estimate-execution-contract-v1"),
    requestHash: hashSchema,
    grant: amountSchema,
    profile: profileBindingSchema,
    estimatorCapabilities: effectiveEstimatorCapabilitiesSchema,
    instructionVersion: nonemptyString,
    responseSchemaVersion: z.literal("budget-estimate-v1"),
    tokenizer: tokenizerSchema,
    framingTokenOverhead: safeInteger,
    maxOutputTokens: positiveSafeInteger,
  })
  .strict();

export const controlPlanSchema = z
  .object({
    schema: z.literal("orca-control-plan-v1"),
    repoId: idSchema,
    planId: idSchema,
    goal: nonemptyString,
    successConditions: orderedUniqueNonemptyStringsSchema,
    // Agent selection spec §6.2: the plan's group layers; absent keys stay absent. Controller ruling R7: a plan
    // names no estimator selection (the import-time estimator slot is the operator's; a group's comes from the panel).
    agent: partialSelectionSchema.optional(),
    reconcileAgent: partialSelectionSchema.optional(),
    tasks: z.array(
      z
        .object({
          taskId: idSchema,
          dependencyTaskIds: sortedIdArraySchema,
          targetVersion: positiveSafeInteger,
          // Agent selection spec §6.2 / §12 I3: a plan carries no configHash; confirmation freezes ccloop's.
          agent: partialSelectionSchema.optional(),
          originalContractHash: hashSchema,
          originalContractCanonicalJson: nonemptyString,
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((value, ctx) => requireSortedUnique(value.tasks, (task) => task.taskId, ctx, ["tasks"]));

export const fieldProvenanceSchema = z
  .object({ provenance: z.enum(["complex-1m-default", "model", "human", "system"]), estimateId: idSchema.nullable() })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.provenance === "model") !== (value.estimateId !== null)) issue(ctx, ["estimateId"], "estimate-provenance-mismatch");
  });

export const amountProvenanceSchema = z
  .object({
    tokens: fieldProvenanceSchema,
    activeMs: fieldProvenanceSchema,
    attempts: fieldProvenanceSchema,
    sessions: fieldProvenanceSchema,
  })
  .strict();

const executionAllocationSchema = z
  .object({
    ownerKind: z.enum(["task", "goal-review", "reserve"]),
    ownerId: nonemptyString,
    bucket: z.enum(["work", "handoff", "review", "reserve"]),
    amount: amountSchema,
    fieldProvenance: amountProvenanceSchema,
  })
  .strict();

export const executionSnapshotSchema = z
  .object({
    schema: z.literal("orca-execution-snapshot-v2"),
    groupId: idSchema,
    planHash: hashSchema,
    graphVersion: positiveSafeInteger,
    proposalVersion: positiveSafeInteger,
    groupLimit: amountSchema,
    budgetMode: z.enum(["strict", "soft"]),
    contextPolicy: z.object({ handoffAtContextTokens: positiveSafeInteger.nullable() }).strict(),
    profiles: z
      .object({ estimator: profileBindingSchema, worker: profileBindingSchema, handoff: profileBindingSchema, goalReview: profileBindingSchema })
      .strict(),
    allocations: z.array(executionAllocationSchema),
    derivedContracts: z.array(z.object({ taskId: idSchema, derivedContractHash: hashSchema }).strict()),
    // Agent selection spec §6.4 step 4 (§12 I3): each task's frozen selection and the group's reconcile slot.
    agents: z.object({ tasks: z.array(frozenTaskAgentSchema), reconcile: frozenSlotSchema }).strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    requireSortedUnique(value.derivedContracts, (contract) => contract.taskId, ctx, ["derivedContracts"]);
    requireSortedUnique(value.agents.tasks, (task) => task.taskId, ctx, ["agents", "tasks"]);
    if (value.agents.tasks.map((task) => task.taskId).join("\0") !== value.derivedContracts.map((contract) => contract.taskId).join("\0")) {
      issue(ctx, ["agents", "tasks"], "agent-task-set-mismatch");
    }
    requireSortedUnique(
      value.allocations,
      (allocation) => `${allocation.ownerKind}\0${allocation.ownerId}\0${allocation.bucket}`,
      ctx,
      ["allocations"],
    );
    const taskIds = new Set(value.derivedContracts.map((contract) => contract.taskId));
    const seenTaskBuckets = new Set<string>();
    let goalReviews = 0;
    let reserves = 0;
    value.allocations.forEach((allocation, index) => {
      const provenanceValues = Object.values(allocation.fieldProvenance).map((field) => field.provenance);
      if (allocation.ownerKind === "task") {
        if (!taskIds.has(allocation.ownerId) || !["work", "handoff"].includes(allocation.bucket)) {
          issue(ctx, ["allocations", index], "invalid-task-allocation");
        }
        if (provenanceValues.includes("system")) issue(ctx, ["allocations", index, "fieldProvenance"], "invalid-editable-provenance");
        seenTaskBuckets.add(`${allocation.ownerId}\0${allocation.bucket}`);
      } else if (allocation.ownerKind === "goal-review") {
        goalReviews += 1;
        if (allocation.ownerId !== `${value.groupId}:goal-review` || allocation.bucket !== "review") {
          issue(ctx, ["allocations", index], "invalid-goal-review-allocation");
        }
        if (provenanceValues.includes("system")) issue(ctx, ["allocations", index, "fieldProvenance"], "invalid-editable-provenance");
      } else {
        reserves += 1;
        if (allocation.ownerId !== `${value.groupId}:reserve` || allocation.bucket !== "reserve") {
          issue(ctx, ["allocations", index], "invalid-reserve-allocation");
        }
        if (provenanceValues.some((provenance) => provenance !== "system")) {
          issue(ctx, ["allocations", index, "fieldProvenance"], "invalid-system-provenance");
        }
      }
    });
    for (const taskId of taskIds) {
      for (const bucket of ["work", "handoff"]) {
        if (!seenTaskBuckets.has(`${taskId}\0${bucket}`)) issue(ctx, ["allocations"], "missing-task-allocation");
      }
    }
    if (goalReviews !== 1) issue(ctx, ["allocations"], "goal-review-allocation-count");
    if (reserves !== 1) issue(ctx, ["allocations"], "reserve-allocation-count");
  });

export const budgetEstimateRequestSchema = z
  .object({
    schema: z.literal("budget-estimate-request-v1"),
    planHash: hashSchema,
    planSnapshotCanonicalJson: nonemptyString,
    estimatorProfile: profileBindingSchema,
    estimatorCapabilities: effectiveEstimatorCapabilitiesSchema,
    responseSchemaVersion: z.literal("budget-estimate-v1"),
    instructionVersion: nonemptyString,
  })
  .strict();

export const budgetEstimateSchema = z
  .object({
    schema: z.literal("budget-estimate-v1"),
    planHash: hashSchema,
    tasks: z.array(
      z
        .object({
          taskId: idSchema,
          complexity: z.enum(["S", "M", "L", "XL"]),
          confidence: z.enum(["low", "medium", "high"]),
          work: amountSchema,
          handoff: amountSchema,
          rationale: nonemptyString,
          assumptions: orderedUniqueNonemptyStringsSchema,
        })
        .strict(),
    ),
    goalReviewReserve: amountSchema,
    groupRationale: nonemptyString,
  })
  .strict()
  .superRefine((value, ctx) => requireSortedUnique(value.tasks, (task) => task.taskId, ctx, ["tasks"]));

export const commandVerbSchema = z.enum([
  "import-plan",
  "proposal-edit",
  "estimate",
  "confirm",
  "start",
  "pause-dispatch",
  "handoff-stop",
  "resume-dispatch",
  "resume-from-handoff",
  "set-limit",
  "continue-task",
  "recovery-retry",
  "shutdown",
  "set-workspace-mode",
  "set-agent-preferences",
  "proposal-set-agent",
]);

const repositoryCommandTargetSchema = z.object({ kind: z.literal("repository"), repoId: idSchema }).strict();
// Agent selection spec §6.2 / §12 I10: an operator-scoped setting, keyed like the actor that sets it.
const operatorCommandTargetSchema = z.object({ kind: z.literal("operator"), operatorId: nonemptyString }).strict();

export const commandTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("group"), groupId: idSchema }).strict(),
  z.object({ kind: z.literal("task"), groupId: idSchema, taskId: idSchema }).strict(),
  z.object({ kind: z.literal("run"), groupId: idSchema, runId: idSchema }).strict(),
  z.object({ kind: z.literal("global"), epoch: nonemptyString }).strict(),
  repositoryCommandTargetSchema,
  operatorCommandTargetSchema,
]);

export const emptyPayloadSchema = z.object({}).strict();
export const importPlanPayloadSchema = z
  .object({
    groupId: idSchema,
    repoId: idSchema,
    planId: idSchema,
    estimatorProfileId: idSchema.optional(),
    estimatorProfileHash: hashSchema.optional(),
    estimateMode: z.enum(["strict", "soft"]).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.estimatorProfileId === undefined) !== (value.estimatorProfileHash === undefined)) {
      issue(ctx, ["estimatorProfileHash"], "estimator-profile-id-hash-pair-required");
    }
  });
export const handoffStopPayloadSchema = z.object({ handoffDeadlineAt: canonicalTimestampSchema.optional() }).strict();
export const resumeFromHandoffPayloadSchema = z
  .object({
    selections: z.array(z.object({ taskId: idSchema, predecessorRunId: idSchema, checkpointId: idSchema }).strict()),
  })
  .strict()
  .superRefine((value, ctx) => requireUnique(value.selections, (selection) => selection.taskId, ctx, ["selections"]));
export const continueTaskPayloadSchema = z.object({ predecessorRunId: idSchema, checkpointId: idSchema }).strict();
export const recoveryRetryPayloadSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("run"), runId: idSchema }).strict(),
  z.object({ scope: z.literal("group"), groupId: idSchema }).strict(),
]);

const proposalTargetSchema = z.discriminatedUnion("scope", [
  z
    .object({ scope: z.literal("task"), taskId: idSchema, allocation: z.enum(["work", "handoff"]), dimension: amountDimensionSchema })
    .strict(),
  z.object({ scope: z.literal("goal-review"), dimension: amountDimensionSchema }).strict(),
]);

const proposalOperationSchema = z
  .object({
    target: proposalTargetSchema,
    value: safeInteger,
    provenance: z.enum(["complex-1m-default", "model", "human"]),
    estimateId: idSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.provenance === "model") !== (value.estimateId !== undefined)) issue(ctx, ["estimateId"], "estimate-provenance-mismatch");
  });

export const proposalEditPayloadSchema = z
  .object({ baseProposalVersion: positiveSafeInteger, operations: z.array(proposalOperationSchema), proposedGroupLimit: amountSchema.optional() })
  .strict();

// Agent selection spec §6.2 (W6-6/W6-20): replace one selection layer of the proposal, or clear it with null.
export const proposalSetAgentPayloadSchema = z
  .object({
    baseProposalVersion: positiveSafeInteger,
    scope: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("group"), slot: z.enum(["worker", "estimator", "reconcile"]) }).strict(),
      z.object({ kind: z.literal("task"), taskId: idSchema }).strict(),
    ]),
    partial: partialSelectionSchema.nullable(),
  })
  .strict();

export const reestimatePayloadSchema = z
  .object({ proposalVersion: positiveSafeInteger, estimatorProfileId: idSchema, estimatorProfileHash: hashSchema, estimateMode: z.enum(["strict", "soft"]) })
  .strict();
export const confirmPayloadSchema = z
  .object({
    planHash: hashSchema,
    proposalVersion: positiveSafeInteger,
    budgetMode: z.enum(["strict", "soft"]),
    profileIds: z.object({ estimator: idSchema, worker: idSchema, handoff: idSchema, goalReview: idSchema }).strict(),
    profileHashes: z.object({ estimator: hashSchema, worker: hashSchema, handoff: hashSchema, goalReview: hashSchema }).strict(),
    contextPolicy: z.object({ handoffAtContextTokens: positiveSafeInteger.nullable() }).strict(),
    // Agent selection spec §6.4 step 3 (§12 C4): the hash of the selections the operator saw; refused as
    // agent-selection-changed when what confirmation resolves is not that.
    selectionsHash: hashSchema,
  })
  .strict();
export const setLimitPayloadSchema = z.object({ limit: amountSchema }).strict();

const effectiveImportPlanPayloadSchema = z
  .object({
    groupId: idSchema,
    repoId: idSchema,
    planId: idSchema,
    estimatorProfileId: idSchema,
    estimatorProfileHash: hashSchema,
    estimateMode: z.enum(["strict", "soft"]),
  })
  .strict();
const effectiveProposalOperationSchema = z
  .object({
    target: proposalTargetSchema,
    value: safeInteger,
    provenance: z.enum(["complex-1m-default", "model", "human"]),
    estimateId: idSchema.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.provenance === "model") !== (value.estimateId !== null)) issue(ctx, ["estimateId"], "estimate-provenance-mismatch");
  });
export const effectiveProposalEditPayloadSchema = z
  .object({
    baseProposalVersion: positiveSafeInteger,
    operations: z.array(effectiveProposalOperationSchema),
    proposedGroupLimit: amountSchema.nullable(),
  })
  .strict();
export const effectiveHandoffStopPayloadSchema = z.object({ handoffDeadlineAt: canonicalTimestampSchema }).strict();
export const shutdownPayloadSchema = z
  .object({ shutdownAcceptedAt: canonicalTimestampSchema, shutdownDeadlineAt: canonicalTimestampSchema })
  .strict();
export const workspaceModeSchema = z.enum(["worktree", "clone"]);
export const setWorkspaceModePayloadSchema = z.object({ workspaceMode: workspaceModeSchema }).strict();
// Controller ruling W6-8: the envelope's expectedRevision (checked against agent_preferences.revision) is the only one.
export const setAgentPreferencesPayloadSchema = z.object({ preferences: operatorPreferencesSchema }).strict();

const groupCommandTargetSchema = z.object({ kind: z.literal("group"), groupId: idSchema }).strict();
const taskCommandTargetSchema = z.object({ kind: z.literal("task"), groupId: idSchema, taskId: idSchema }).strict();
const globalCommandTargetSchema = z.object({ kind: z.literal("global"), epoch: nonemptyString }).strict();
const rawCommandFields = {
  schema: z.literal("orca-raw-command-v1"),
  commandId: idSchema,
  expectedRevision: safeInteger,
  actorId: nonemptyString,
} as const;
const effectiveCommandFields = {
  schema: z.literal("orca-authority-command-v1"),
  commandId: idSchema,
  expectedRevision: safeInteger,
  actorId: nonemptyString,
} as const;

const rawAuthorityCommandVariants = z.discriminatedUnion("verb", [
  z.object({ ...rawCommandFields, verb: z.literal("import-plan"), target: groupCommandTargetSchema, payload: importPlanPayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("proposal-edit"), target: groupCommandTargetSchema, payload: proposalEditPayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("proposal-set-agent"), target: groupCommandTargetSchema, payload: proposalSetAgentPayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("estimate"), target: groupCommandTargetSchema, payload: reestimatePayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("confirm"), target: groupCommandTargetSchema, payload: confirmPayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("start"), target: groupCommandTargetSchema, payload: emptyPayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("pause-dispatch"), target: groupCommandTargetSchema, payload: emptyPayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("handoff-stop"), target: groupCommandTargetSchema, payload: handoffStopPayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("resume-dispatch"), target: groupCommandTargetSchema, payload: emptyPayloadSchema }).strict(),
  z
    .object({ ...rawCommandFields, verb: z.literal("resume-from-handoff"), target: groupCommandTargetSchema, payload: resumeFromHandoffPayloadSchema })
    .strict(),
  z.object({ ...rawCommandFields, verb: z.literal("set-limit"), target: groupCommandTargetSchema, payload: setLimitPayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("continue-task"), target: taskCommandTargetSchema, payload: continueTaskPayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("recovery-retry"), target: commandTargetSchema, payload: recoveryRetryPayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("shutdown"), target: globalCommandTargetSchema, payload: shutdownPayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("set-workspace-mode"), target: repositoryCommandTargetSchema, payload: setWorkspaceModePayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("set-agent-preferences"), target: operatorCommandTargetSchema, payload: setAgentPreferencesPayloadSchema }).strict(),
]);

const effectiveAuthorityCommandVariants = z.discriminatedUnion("verb", [
  z
    .object({ ...effectiveCommandFields, verb: z.literal("import-plan"), target: groupCommandTargetSchema, payload: effectiveImportPlanPayloadSchema })
    .strict(),
  z
    .object({ ...effectiveCommandFields, verb: z.literal("proposal-edit"), target: groupCommandTargetSchema, payload: effectiveProposalEditPayloadSchema })
    .strict(),
  z.object({ ...effectiveCommandFields, verb: z.literal("proposal-set-agent"), target: groupCommandTargetSchema, payload: proposalSetAgentPayloadSchema }).strict(),
  z.object({ ...effectiveCommandFields, verb: z.literal("estimate"), target: groupCommandTargetSchema, payload: reestimatePayloadSchema }).strict(),
  z.object({ ...effectiveCommandFields, verb: z.literal("confirm"), target: groupCommandTargetSchema, payload: confirmPayloadSchema }).strict(),
  z.object({ ...effectiveCommandFields, verb: z.literal("start"), target: groupCommandTargetSchema, payload: emptyPayloadSchema }).strict(),
  z.object({ ...effectiveCommandFields, verb: z.literal("pause-dispatch"), target: groupCommandTargetSchema, payload: emptyPayloadSchema }).strict(),
  z
    .object({ ...effectiveCommandFields, verb: z.literal("handoff-stop"), target: groupCommandTargetSchema, payload: effectiveHandoffStopPayloadSchema })
    .strict(),
  z.object({ ...effectiveCommandFields, verb: z.literal("resume-dispatch"), target: groupCommandTargetSchema, payload: emptyPayloadSchema }).strict(),
  z
    .object({
      ...effectiveCommandFields,
      verb: z.literal("resume-from-handoff"),
      target: groupCommandTargetSchema,
      payload: resumeFromHandoffPayloadSchema,
    })
    .strict(),
  z.object({ ...effectiveCommandFields, verb: z.literal("set-limit"), target: groupCommandTargetSchema, payload: setLimitPayloadSchema }).strict(),
  z
    .object({ ...effectiveCommandFields, verb: z.literal("continue-task"), target: taskCommandTargetSchema, payload: continueTaskPayloadSchema })
    .strict(),
  z
    .object({ ...effectiveCommandFields, verb: z.literal("recovery-retry"), target: commandTargetSchema, payload: recoveryRetryPayloadSchema })
    .strict(),
  z.object({ ...effectiveCommandFields, verb: z.literal("shutdown"), target: globalCommandTargetSchema, payload: shutdownPayloadSchema }).strict(),
  z.object({ ...effectiveCommandFields, verb: z.literal("set-workspace-mode"), target: repositoryCommandTargetSchema, payload: setWorkspaceModePayloadSchema }).strict(),
  z.object({ ...effectiveCommandFields, verb: z.literal("set-agent-preferences"), target: operatorCommandTargetSchema, payload: setAgentPreferencesPayloadSchema }).strict(),
]);

function refineCommandIdentity(
  value: z.infer<typeof rawAuthorityCommandVariants> | z.infer<typeof effectiveAuthorityCommandVariants>,
  ctx: z.RefinementCtx,
): void {
  if (value.verb === "import-plan" && value.target.groupId !== value.payload.groupId) {
    issue(ctx, ["target", "groupId"], "command-target-payload-mismatch");
  }
  if (value.verb === "recovery-retry") {
    if (value.payload.scope === "run") {
      if (value.target.kind !== "run" || value.target.runId !== value.payload.runId) {
        issue(ctx, ["target"], "command-target-payload-mismatch");
      }
    } else if (value.target.kind !== "group" || value.target.groupId !== value.payload.groupId) {
      issue(ctx, ["target"], "command-target-payload-mismatch");
    }
  }
}

export const rawAuthorityCommandSchema = rawAuthorityCommandVariants.superRefine(refineCommandIdentity);
export const effectiveAuthorityCommandSchema = effectiveAuthorityCommandVariants.superRefine(refineCommandIdentity);
export const authorityCommandSchema = z.union([rawAuthorityCommandSchema, effectiveAuthorityCommandSchema]);

export const controlConfigSchema = z
  .object({
    schema: z.literal("orca-control-config-v1"),
    epoch: nonemptyString,
    repositories: z.array(z.object({ repoId: idSchema, displayName: nonemptyString }).strict()),
    plans: z.array(z.object({ planId: idSchema, repoId: idSchema, displayName: nonemptyString }).strict()),
    profiles: z.array(
      z
        .object({
          profileId: idSchema,
          profileHash: hashSchema,
          allowedWorkKinds: z.array(webWorkKindSchema).superRefine((values, ctx) => requireSortedUnique(values, String, ctx, [])),
          contextTokenizer: z.object({ tokenizerId: nonemptyString, tokenizerVersion: nonemptyString }).strict().nullable(),
          workMaxOutputTokens: positiveSafeInteger.nullable(),
          declared: capabilityViewSchema,
          observed: capabilityViewSchema,
          observedAt: canonicalTimestampSchema,
          probeFailureCode: nonemptyString.nullable(),
        })
        .strict(),
    ),
    // Assembly spec §10 (ruling R7): null is "no estimator was configured on this process", which
    // is a state the panel serves rather than a state it refuses to boot in.
    defaults: z
      .object({ estimatorProfileId: idSchema, estimatorProfileHash: hashSchema, estimateMode: z.enum(["strict", "soft"]) })
      .strict()
      .nullable(),
    // Assembly spec §9.2 (ruling R6). Per process, for the life of the epoch. Deliberately NOT
    // inferable from `profiles[].probeFailureCode`, which answers a per-profile, per-probe question
    // -- see §9.3: letting one stand in for the other blends two facts of different sizes.
    executionPort: z.enum(["configured", "unconfigured"]),
    errorCatalog: z.array(z.object({ code: nonemptyString, status: safeInteger }).strict()),
  })
  .strict()
  .superRefine((value, ctx) => {
    requireSortedUnique(value.repositories, (entry) => entry.repoId, ctx, ["repositories"]);
    requireSortedUnique(value.plans, (entry) => entry.planId, ctx, ["plans"]);
    requireSortedUnique(value.profiles, (entry) => entry.profileId, ctx, ["profiles"]);
    requireSortedUnique(value.errorCatalog, (entry) => entry.code, ctx, ["errorCatalog"]);
  });

export const groupSummarySchema = z
  .object({
    groupId: idSchema,
    state: z.enum(["draft", "ready", "running", "review", "done", "blocked"]),
    commandRevision: positiveSafeInteger,
    projectionSeq: positiveSafeInteger,
    stopMode: z.enum(["pause", "shutdown", "handoff"]).nullable(),
    stopState: z.enum(["paused", "handoff-pending", "handoff-partial", "handoff-unresolved", "handoff-complete"]).nullable(),
    claimBlocked: z.boolean(),
    recoveryBlockerCount: safeInteger,
  })
  .strict();

export const controlSummarySchema = z
  .object({
    schema: z.literal("orca-control-summary-v1"),
    epoch: nonemptyString,
    changeSeq: safeInteger,
    resetRequired: z.boolean(),
    dispatchBlocked: z.boolean(),
    groups: z.array(groupSummarySchema),
  })
  .strict()
  .superRefine((value, ctx) => requireSortedUnique(value.groups, (group) => group.groupId, ctx, ["groups"]));

export const allocationViewSchema = z
  .object({
    ownerKind: z.enum(["estimate", "task", "goal-review", "reserve"]),
    ownerId: nonemptyString,
    bucket: z.enum(["work", "handoff", "review", "reserve"]),
    state: z.enum(["draft-encumbered", "confirmed", "active", "held", "continuing", "terminal", "unknown"]),
    amount: amountSchema,
    fieldProvenance: amountProvenanceSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const provenanceValues = Object.values(value.fieldProvenance).map((field) => field.provenance);
    const systemOwned = value.ownerKind === "estimate" || value.ownerKind === "reserve";
    if (systemOwned && provenanceValues.some((provenance) => provenance !== "system")) {
      issue(ctx, ["fieldProvenance"], "invalid-system-provenance");
    }
    if (!systemOwned && provenanceValues.includes("system")) {
      issue(ctx, ["fieldProvenance"], "invalid-editable-provenance");
    }
  });

export const workItemViewSchema = z
  .object({
    taskId: idSchema,
    status: z.enum(["draft", "ready", "starting", "start-unknown", "active", "held", "continuing", "completed", "blocked"]),
    dependencyTaskIds: sortedIdArraySchema,
    targetVersion: positiveSafeInteger,
    // Agent selection spec §6.2 / §12 I3 (W6-9): null until confirmation freezes a selection onto the work item.
    configHash: hashSchema.nullable(),
    agent: agentSelectionSchema.nullable(),
    agentProvenance: selectionProvenanceSchema.nullable(),
    originalContractHash: hashSchema,
    derivedContractHash: hashSchema.nullable(),
    currentRunId: idSchema.nullable(),
    pendingRunId: idSchema.nullable(),
    lineageRunIds: sortedIdArraySchema,
  })
  .strict();

export const runViewSchema = z
  .object({
    runId: idSchema,
    taskId: idSchema.nullable(),
    estimateId: idSchema.nullable(),
    generation: positiveSafeInteger,
    state: z.enum([
      "starting",
      "unknown",
      "attempt-unknown",
      "attempt-proof-invalid",
      "running",
      "failed-before-provider",
      "settled-recoverable",
      "settled-restartable",
      "settled-unrecoverable",
      "collected",
      "landed",
      "reconciling",
      "blocked",
    ]),
    phase: z.enum(["estimate", "work", "handoff"]),
    claimOrdinal: positiveSafeInteger.nullable(),
    providerAttemptOrdinal: safeInteger,
    profile: profileBindingSchema,
    used: amountSchema,
    remaining: amountSchema,
    failureCode: nonemptyString.nullable(),
    blockedReason: nonemptyString.nullable(),
    continuable: z.boolean(),
    evidenceIds: sortedIdArraySchema,
  })
  .strict();

export const estimateViewSchema = z
  .object({
    estimateId: idSchema,
    estimateVersion: positiveSafeInteger,
    state: z.enum(["queued", "running", "start-unknown", "ready", "failed", "interrupted", "blocked-capability", "input-too-large"]),
    profile: profileBindingSchema,
    mode: z.enum(["strict", "soft"]),
    requestHash: hashSchema.nullable(),
    outputHash: hashSchema.nullable(),
    output: budgetEstimateSchema.nullable(),
    reasonCode: nonemptyString.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ready = value.state === "ready";
    if (ready !== (value.outputHash !== null && value.output !== null)) issue(ctx, ["output"], "estimate-output-state-mismatch");
  });

export const checkpointViewSchema = z
  .object({
    checkpointId: idSchema,
    taskId: idSchema,
    runId: idSchema,
    state: z.enum(["complete", "partial", "unknown"]),
    snapshotHash: hashSchema.nullable(),
    evidenceIds: sortedIdArraySchema,
  })
  .strict();

export const handoffRequestViewSchema = z
  .object({
    requestId: idSchema,
    runId: idSchema,
    state: z.enum([
      "request-pending",
      "latched",
      "collecting",
      "settled-recoverable",
      "settled-restartable",
      "settled-unrecoverable",
      "outcome-unknown",
    ]),
    deadlineAt: canonicalTimestampSchema,
    phaseAttemptOrdinal: positiveSafeInteger,
    failureCode: nonemptyString.nullable(),
    evidenceIds: sortedIdArraySchema,
  })
  .strict();

const recoveryBlockerSchema = z
  .object({ scope: z.enum(["global", "group", "run"]), code: nonemptyString, runId: idSchema.nullable(), evidenceIds: sortedIdArraySchema })
  .strict();

export const groupViewSchema = z
  .object({
    schema: z.literal("orca-control-group-v1"),
    epoch: nonemptyString,
    changeSeq: safeInteger,
    summary: groupSummarySchema,
    graphVersion: positiveSafeInteger,
    plan: z
      .object({ repoId: idSchema, planId: idSchema, planHash: hashSchema, goal: nonemptyString, successConditions: orderedUniqueNonemptyStringsSchema })
      .strict(),
    proposal: z
      .object({
        state: z.enum(["editable", "confirmed"]),
        proposalVersion: positiveSafeInteger,
        planHash: hashSchema,
        budgetMode: z.enum(["strict", "soft"]).nullable(),
        contextPolicy: z.object({ handoffAtContextTokens: positiveSafeInteger.nullable() }).strict(),
        profiles: z
          .object({ estimator: profileBindingSchema, worker: profileBindingSchema, handoff: profileBindingSchema, goalReview: profileBindingSchema })
          .strict()
          .nullable(),
        executionSnapshotHash: hashSchema.nullable(),
      })
      .strict(),
    ledger: z
      .object({
        groupLimit: amountSchema,
        used: amountSchema,
        committedRemaining: amountSchema,
        explicitUnallocatedReserve: amountSchema,
        budgetDeficit: amountSchema,
        usageUnknown: z.boolean(),
      })
      .strict(),
    allocations: z.array(allocationViewSchema),
    workItems: z.array(workItemViewSchema),
    estimates: z.array(estimateViewSchema),
    runs: z.array(runViewSchema),
    checkpoints: z.array(checkpointViewSchema),
    handoffRequests: z.array(handoffRequestViewSchema),
    stop: z
      .object({
        mode: z.enum(["pause", "shutdown", "handoff"]),
        state: z.enum(["paused", "handoff-pending", "handoff-partial", "handoff-unresolved", "handoff-complete"]),
        frozenRunIds: sortedIdArraySchema,
        acceptedAt: canonicalTimestampSchema.nullable(),
        deadlineAt: canonicalTimestampSchema.nullable(),
      })
      .strict()
      .nullable(),
    recoveryBlockers: z.array(recoveryBlockerSchema),
    recentCommandIds: sortedIdArraySchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    requireSortedUnique(value.allocations, (entry) => `${entry.ownerKind}\0${entry.ownerId}\0${entry.bucket}`, ctx, ["allocations"]);
    requireSortedUnique(value.workItems, (entry) => entry.taskId, ctx, ["workItems"]);
    requireSortedUnique(value.estimates, (entry) => entry.estimateId, ctx, ["estimates"]);
    requireSortedUnique(value.runs, (entry) => entry.runId, ctx, ["runs"]);
    requireSortedUnique(value.checkpoints, (entry) => entry.checkpointId, ctx, ["checkpoints"]);
    requireSortedUnique(value.handoffRequests, (entry) => entry.requestId, ctx, ["handoffRequests"]);
    requireSortedUnique(value.recoveryBlockers, (entry) => `${entry.scope}\0${entry.runId ?? ""}\0${entry.code}`, ctx, ["recoveryBlockers"]);
    const taskIds = new Set(value.workItems.map((entry) => entry.taskId));
    const estimateIds = new Set(value.estimates.map((entry) => entry.estimateId));
    value.allocations.forEach((allocation, index) => {
      if (allocation.ownerKind === "task") {
        if (!taskIds.has(allocation.ownerId) || !["work", "handoff"].includes(allocation.bucket)) {
          issue(ctx, ["allocations", index], "invalid-task-allocation");
        }
      } else if (allocation.ownerKind === "estimate") {
        if (!estimateIds.has(allocation.ownerId) || allocation.bucket !== "work") {
          issue(ctx, ["allocations", index], "invalid-estimate-allocation");
        }
      } else if (allocation.ownerKind === "goal-review") {
        if (allocation.ownerId !== `${value.summary.groupId}:goal-review` || allocation.bucket !== "review") {
          issue(ctx, ["allocations", index], "invalid-goal-review-allocation");
        }
      } else if (allocation.ownerId !== `${value.summary.groupId}:reserve` || allocation.bucket !== "reserve") {
        issue(ctx, ["allocations", index], "invalid-reserve-allocation");
      }
    });
    const confirmed = value.proposal.state === "confirmed";
    if (confirmed !== (value.proposal.profiles !== null && value.proposal.executionSnapshotHash !== null)) {
      issue(ctx, ["proposal"], "proposal-snapshot-state-mismatch");
    }
  });

const recoveryViewBlockerSchema = recoveryBlockerSchema.extend({ groupId: idSchema }).strict();
export const recoveryViewSchema = z
  .object({
    schema: z.literal("orca-control-recovery-v1"),
    epoch: nonemptyString,
    dispatchBlocked: z.boolean(),
    blockers: z.array(recoveryViewBlockerSchema),
  })
  .strict()
  .superRefine((value, ctx) =>
    requireSortedUnique(
      value.blockers,
      (entry) => `${entry.scope}\0${entry.groupId}\0${entry.runId ?? ""}\0${entry.code}`,
      ctx,
      ["blockers"],
    ),
  );

export const evidenceManifestSchema = z
  .object({
    schema: z.literal("orca-run-evidence-v1"),
    runId: idSchema,
    entries: z.array(
      z.object({ evidenceId: idSchema, kind: nonemptyString, sha256: hashSchema, byteLength: safeInteger, downloadUrl: nonemptyString }).strict(),
    ),
  })
  .strict()
  .superRefine((value, ctx) => requireSortedUnique(value.entries, (entry) => entry.evidenceId, ctx, ["entries"]));

export const commandErrorSchema = z
  .object({ code: nonemptyString, message: nonemptyString, commandRevision: safeInteger.nullable(), evidenceIds: sortedIdArraySchema, retryable: z.boolean() })
  .strict();
export const commandErrorBodySchema = z.object({ error: commandErrorSchema }).strict();

const commandResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("imported"),
      groupId: idSchema,
      estimateId: idSchema,
      estimateState: z.enum(["queued", "blocked-capability", "input-too-large"]),
      estimateReasonCode: nonemptyString.nullable(),
    })
    .strict(),
  z.object({ kind: z.literal("proposal-edited"), proposalVersion: positiveSafeInteger }).strict(),
  z
    .object({
      kind: z.literal("estimate-created"),
      estimateId: idSchema,
      estimateVersion: positiveSafeInteger,
      estimateState: z.enum(["queued", "blocked-capability", "input-too-large"]),
      reasonCode: nonemptyString.nullable(),
      wakeId: nonemptyString.nullable(),
    })
    .strict(),
  z.object({ kind: z.literal("confirmed"), executionSnapshotHash: hashSchema }).strict(),
  z.object({ kind: z.literal("scheduled"), operation: z.enum(["start", "resume-dispatch"]), wakeId: nonemptyString }).strict(),
  z.object({ kind: z.literal("paused"), stopMode: z.literal("pause") }).strict(),
  z
    .object({
      kind: z.literal("handoff-stopped"),
      stopRevision: positiveSafeInteger,
      acceptedAt: canonicalTimestampSchema,
      handoffDeadlineAt: canonicalTimestampSchema,
      frozenRunIds: sortedIdArraySchema,
      requestIds: sortedIdArraySchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("resumed-from-handoff"),
      wakeId: nonemptyString,
      pendingRuns: z.array(
        z.object({ taskId: idSchema, continuationIntentId: idSchema, pendingRunId: idSchema, claimOrdinal: positiveSafeInteger }).strict(),
      ),
    })
    .strict(),
  z.object({ kind: z.literal("limit-set"), limit: amountSchema }).strict(),
  z.object({ kind: z.literal("workspace-mode-set"), repoId: idSchema, workspaceMode: workspaceModeSchema }).strict(),
  z.object({ kind: z.literal("agent-preferences-set"), operatorId: nonemptyString, revision: positiveSafeInteger }).strict(),
  z
    .object({
      kind: z.literal("task-continuing"),
      continuationIntentId: idSchema,
      pendingRunId: idSchema,
      claimOrdinal: positiveSafeInteger,
      wakeId: nonemptyString,
    })
    .strict(),
  z
    .object({
      kind: z.literal("recovery-observed"),
      resolved: z.boolean(),
      blockerCodes: z.array(nonemptyString).superRefine((values, ctx) => requireSortedUnique(values, String, ctx, [])),
      evidenceIds: sortedIdArraySchema,
      wakeIds: z.array(nonemptyString).superRefine((values, ctx) => requireSortedUnique(values, String, ctx, [])),
    })
    .strict(),
  z
    .object({
      kind: z.literal("shutdown"),
      groups: z.array(
        z
          .object({
            groupId: idSchema,
            disposition: z.enum([
              "created",
              "strengthened-pause",
              "preserved-pause",
              "preserved-handoff",
              "preserved-shutdown",
              "blocked-inconsistent",
              "skipped-driver-owned",
            ]),
            changed: z.boolean(),
            commandRevision: positiveSafeInteger,
            projectionSeq: positiveSafeInteger,
            frozenRunIds: sortedIdArraySchema,
            requestIds: sortedIdArraySchema,
            blockerCode: nonemptyString.nullable(),
          })
          .strict(),
      ).superRefine((values, ctx) => requireSortedUnique(values, (entry) => entry.groupId, ctx, [])),
    })
    .strict(),
]);

export const commandSuccessSchema = z
  .object({
    schema: z.literal("orca-command-success-v1"),
    commandId: idSchema,
    actorId: nonemptyString,
    verb: commandVerbSchema,
    target: commandTargetSchema,
    commandRevision: safeInteger.nullable(),
    projectionSeq: safeInteger.nullable(),
    effectivePayloadHash: hashSchema,
    authorityCommandHash: hashSchema,
    result: commandResultSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const isShutdown = value.verb === "shutdown";
    // Execution driver spec §3.2: a repository-scoped command has its setting's revision and no group
    // projection.
    const projectionless = isShutdown || value.verb === "set-workspace-mode" || value.verb === "set-agent-preferences";
    if (isShutdown ? value.commandRevision !== null : value.commandRevision === null) {
      issue(ctx, ["commandRevision"], "command-revision-nullability-mismatch");
    }
    if (projectionless ? value.projectionSeq !== null : value.projectionSeq === null) {
      issue(ctx, ["projectionSeq"], "command-revision-nullability-mismatch");
    }
  });

export const commandLookupSchema = z
  .object({ schema: z.literal("orca-command-lookup-v1"), originalStatus: safeInteger, body: z.union([commandSuccessSchema, commandErrorBodySchema]) })
  .strict();

export { canonicalTimestampSchema, commandEnvelopeSchema };

export type WebWorkKindV1 = z.infer<typeof webWorkKindSchema>;
export type ExecutionProfileSnapshotV1 = z.infer<typeof executionProfileSnapshotSchema>;
export type RequestBoundProofArtifactV1 = z.infer<typeof requestBoundProofArtifactSchema>;
export type ProfileBindingV1 = z.infer<typeof profileBindingSchema>;
export type DispatchEnvelopeV1 = z.infer<typeof dispatchEnvelopeSchema>;
export type EstimateExecutionContractV1 = z.infer<typeof estimateExecutionContractSchema>;
export type ControlPlanV1 = z.infer<typeof controlPlanSchema>;
export type ExecutionSnapshotV1 = z.infer<typeof executionSnapshotSchema>;
export type BudgetEstimateRequestV1 = z.infer<typeof budgetEstimateRequestSchema>;
export type BudgetEstimateV1 = z.infer<typeof budgetEstimateSchema>;
export type CommandVerbV1 = z.infer<typeof commandVerbSchema>;
export type CommandTargetV1 = z.infer<typeof commandTargetSchema>;
export type AuthorityCommandV1 = z.infer<typeof authorityCommandSchema>;
export type RawAuthorityCommandV1 = z.infer<typeof rawAuthorityCommandSchema>;
export type EffectiveAuthorityCommandV1 = z.infer<typeof effectiveAuthorityCommandSchema>;
export type CommandEnvelopeV1 = z.infer<typeof commandEnvelopeSchema>;
export type EmptyPayload = z.infer<typeof emptyPayloadSchema>;
export type ImportPlanPayload = z.infer<typeof importPlanPayloadSchema>;
export type HandoffStopPayload = z.infer<typeof handoffStopPayloadSchema>;
export type ResumeFromHandoffPayload = z.infer<typeof resumeFromHandoffPayloadSchema>;
export type ContinueTaskPayload = z.infer<typeof continueTaskPayloadSchema>;
export type RecoveryRetryPayload = z.infer<typeof recoveryRetryPayloadSchema>;
export type ProposalEditPayload = z.infer<typeof proposalEditPayloadSchema>;
export type EffectiveProposalEditPayload = z.infer<typeof effectiveProposalEditPayloadSchema>;
export type ReestimatePayload = z.infer<typeof reestimatePayloadSchema>;
export type ConfirmPayload = z.infer<typeof confirmPayloadSchema>;
export type SetLimitPayload = z.infer<typeof setLimitPayloadSchema>;
export type CapabilityViewV1 = z.infer<typeof capabilityViewSchema>;
export type ControlConfigV1 = z.infer<typeof controlConfigSchema>;
export type GroupSummaryV1 = z.infer<typeof groupSummarySchema>;
export type ControlSummaryV1 = z.infer<typeof controlSummarySchema>;
export type FieldProvenanceV1 = z.infer<typeof fieldProvenanceSchema>;
export type AmountProvenanceV1 = z.infer<typeof amountProvenanceSchema>;
export type AllocationViewV1 = z.infer<typeof allocationViewSchema>;
export type WorkItemViewV1 = z.infer<typeof workItemViewSchema>;
export type RunViewV1 = z.infer<typeof runViewSchema>;
export type EstimateViewV1 = z.infer<typeof estimateViewSchema>;
export type CheckpointViewV1 = z.infer<typeof checkpointViewSchema>;
export type HandoffRequestViewV1 = z.infer<typeof handoffRequestViewSchema>;
export type GroupViewV1 = z.infer<typeof groupViewSchema>;
export type RecoveryViewV1 = z.infer<typeof recoveryViewSchema>;
export type EvidenceManifestV1 = z.infer<typeof evidenceManifestSchema>;
export type CommandErrorV1 = z.infer<typeof commandErrorSchema>;
export type CommandErrorBodyV1 = z.infer<typeof commandErrorBodySchema>;
export type CommandSuccessV1 = z.infer<typeof commandSuccessSchema>;
export type CommandLookupV1 = z.infer<typeof commandLookupSchema>;

export const repositoryWorkspaceSchema = z
  .object({ schema: z.literal("orca-repository-workspace-v1"), repoId: idSchema, workspaceMode: workspaceModeSchema, revision: safeInteger })
  .strict();
export type RepositoryWorkspaceV1 = z.infer<typeof repositoryWorkspaceSchema>;
export type SetWorkspaceModePayload = z.infer<typeof setWorkspaceModePayloadSchema>;
export type SetAgentPreferencesPayload = z.infer<typeof setAgentPreferencesPayloadSchema>;
export type ProposalSetAgentPayload = z.infer<typeof proposalSetAgentPayloadSchema>;
