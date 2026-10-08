import { z } from "zod";
import { agentSelectionSchema, amountSchema, canonicalTimestampSchema, commandEnvelopeSchema, contextWindowSchema, idSchema, panelPartialSelectionSchema, partialSelectionSchema, safeInteger } from "./schema.js";
import { nonEmptyStoredLabelsSchema, storedLabelsSchema } from "./labels.js";
import { DRAFT_STATES, IDEA_MAX_BYTES, REQUIREMENT_WAITING, ROUND_STATES, draftBodySchema, questionIdSchema, requirementExportSchema, roundBodySchema } from "./requirementSchemas.js";
import { LOOP_PLAN_IDS, loopInputsSchema, loopRecipeSchema, loopSkillsSchema } from "./loopPlans.js";
import { isTimeZone } from "./usageCalendar.js";
import { WORK_ITEM_CATEGORIES } from "./workItemCategory.js";
// Agent selection spec §12 I10 (plan-review P18): the selection/context/partial schemas are T7's, defined once
// in schema.ts; webProtocol.ts re-exports them so every downstream import can come from one wire module.
export { agentSelectionSchema, contextWindowSchema, panelPartialSelectionSchema, partialSelectionSchema } from "./schema.js";

const nonemptyString = z.string().min(1);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const positiveSafeInteger = safeInteger.positive();
const amountDimensionSchema = z.enum(["tokens", "activeMs", "attempts", "sessions"]);

function issue(ctx: z.RefinementCtx, path: PropertyKey[], message: string): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path: path as (string | number)[], message });
}

/** UTF-16 code unit order: the order every sorted set on the wire is checked in. A producer must not use localeCompare. */
export function compareText(left: string, right: string): number {
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
  .object({ worker: panelPartialSelectionSchema.optional(), estimator: panelPartialSelectionSchema.optional(), reconcile: panelPartialSelectionSchema.optional() })
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
  // Ruling review R7: the plan file's half of each level, below the panel's (which keeps the older names).
  "group-plan", "group-reconcile-plan", "task-plan",
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
    phase: z.enum(["estimate", "work", "handoff", "single-call"]),
    /** N1 DR1: what a `single-call` phase claim is for; an estimate's stored envelope has none. */
    purpose: z.enum(["clarify", "split"]).optional(),
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
    // N1 spec §5.1: a `single-call` claim is held to an estimate's rules (the existing issue strings, byte for byte).
    const singleCall = value.phase === "estimate" || value.phase === "single-call";
    const expected = singleCall ? ["estimator"] : value.phase === "handoff" ? ["handoff"] : ["worker", "handoff"];
    if (populated.join("\0") !== expected.join("\0")) issue(ctx, ["profiles"], "dispatch-profile-slot-mismatch");
    if (singleCall && value.claimOrdinal !== null) issue(ctx, ["claimOrdinal"], "estimate-claim-ordinal-must-be-null");
    if (singleCall && Object.values(value.grants.handoff).some((amount) => amount !== 0)) {
      issue(ctx, ["grants", "handoff"], "estimate-handoff-grant-must-be-zero");
    }
    if (!singleCall && value.claimOrdinal === null) {
      issue(ctx, ["claimOrdinal"], "phase-claim-ordinal-required");
    }
    // N1 DR1: a purpose is named exactly when the phase is "single-call"; an estimate's stored envelope has none.
    if ((value.phase === "single-call") !== (value.purpose !== undefined)) issue(ctx, ["purpose"], "single-call-purpose-mismatch");
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
          // Labels and progress spec §2.3: optional, format only, never empty -- a label-free plan's archive bytes and
          // planHash stay what they were. Never `.default([])`: every archive re-parses to its own bytes (queries.ts,
          // executionSnapshot.ts, estimator.ts), and a default would turn every older group recovery-blocked.
          labels: nonEmptyStoredLabelsSchema.optional(),
          // Loop plans spec §3.3 (R12): the recipe a loop task was expanded from, inside the entry planHash covers. Optional
          // and never defaulted, for the reason given for labels above.
          loop: loopRecipeSchema.optional(),
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
    // Syncskill integration spec §10.5: each task's frozen skill set (profile null for a task that named its skills).
    // Optional and never empty: a group without skills has no key, so its snapshot bytes and hash are unchanged.
    skills: z.array(z.object({ taskId: idSchema, profile: nonemptyString.nullable(), names: z.array(nonemptyString).min(1) }).strict()).min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    requireSortedUnique(value.derivedContracts, (contract) => contract.taskId, ctx, ["derivedContracts"]);
    if (value.skills !== undefined) {
      requireSortedUnique(value.skills, (entry) => entry.taskId, ctx, ["skills"]);
      const contracted = new Set(value.derivedContracts.map((contract) => contract.taskId));
      value.skills.forEach((entry, index) => { if (!contracted.has(entry.taskId)) issue(ctx, ["skills", index, "taskId"], "skills-task-unknown"); });
    }
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
  "retry-task",
  "shutdown",
  "set-workspace-mode",
  "set-agent-preferences",
  "proposal-set-agent",
  "set-task-labels",
  "set-task-loop",
  "requirement-open",
  "requirement-answer",
  "requirement-consensus",
  "requirement-draft-feedback",
  "requirement-draft-accept",
  "set-spend-cap",
  "clear-spend-cap",
  "set-usage-calendar",
  "set-integration-scheme",
  "set-group-integration",
  "retry-integration",
  "resolve-integration-conflict",
  "archive-group",
  "unarchive-group",
]);

const repositoryCommandTargetSchema = z.object({ kind: z.literal("repository"), repoId: idSchema }).strict();
// Agent selection spec §6.2 / §12 I10: an operator-scoped setting, keyed like the actor that sets it.
const operatorCommandTargetSchema = z.object({ kind: z.literal("operator"), operatorId: nonemptyString }).strict();
// Accounts spec §6.1, D5: the spend settings (caps and the usage calendar) are one scope with one revision.
const spendCommandTargetSchema = z.object({ kind: z.literal("spend") }).strict();

export const commandTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("group"), groupId: idSchema }).strict(),
  z.object({ kind: z.literal("task"), groupId: idSchema, taskId: idSchema }).strict(),
  z.object({ kind: z.literal("run"), groupId: idSchema, runId: idSchema }).strict(),
  z.object({ kind: z.literal("global"), epoch: nonemptyString }).strict(),
  repositoryCommandTargetSchema,
  operatorCommandTargetSchema,
  spendCommandTargetSchema,
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
// Issue fixes spec §4.2(2): start a task again whose current run ccloop ended failed. Group target; the task is named here.
export const retryTaskPayloadSchema = z.object({ taskId: idSchema }).strict();

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
    // Ruling review R7: the panel's own layer, whose null fields mask the plan's; null clears the panel layer.
    partial: panelPartialSelectionSchema.nullable(),
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
    // Integration spec §3.2 (ruling R2): the group's integration.schemeHash the owner saw; present exactly when the
    // group's scheme is not keep. Absent adds no bytes, so a keep group's confirm hashes as before.
    integrationHash: hashSchema.optional(),
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
/** A git commit id, SHA-1 or SHA-256 (the drive record's own pattern). */
export const commitShaSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
export const setWorkspaceModePayloadSchema = z.object({ workspaceMode: workspaceModeSchema }).strict();
// Integration spec §3 (ruling R1: no `rebase`). Names are checked outside the transaction (§3.3), so an invalid one is
// refused as integration-invalid naming the check rather than as a payload that does not parse.
const integrationTriggerSchema = z.enum(["task", "group"]);
const integrationMethodSchema = z.enum(["merge", "squash"]);
export const integrationSchemeSchema = z.discriminatedUnion("delivery", [
  z.object({ delivery: z.literal("keep") }).strict(),
  z.object({ delivery: z.literal("local"), trigger: integrationTriggerSchema, method: integrationMethodSchema, target: z.string() }).strict(),
  z.object({ delivery: z.literal("push-target"), trigger: integrationTriggerSchema, method: integrationMethodSchema, target: z.string(), remote: z.string() }).strict(),
  z.object({ delivery: z.enum(["push-branch", "github-pr"]), trigger: integrationTriggerSchema, target: z.string(), remote: z.string() }).strict(),
]);
export const setIntegrationSchemePayloadSchema = z.object({ integration: integrationSchemeSchema }).strict();
// Integration spec §3.1: the group's copy, the same body shape as the repository default's.
export const setGroupIntegrationPayloadSchema = z.object({ integration: integrationSchemeSchema }).strict();
// Controller ruling W6-8: the envelope's expectedRevision (checked against agent_preferences.revision) is the only one.
export const setAgentPreferencesPayloadSchema = z.object({ preferences: operatorPreferencesSchema }).strict();
// Accounts spec §6.1: a cap's amount. Its own instance (not the shared positiveSafeInteger), so the human-only criterion
// (C19) can find every field that carries it.
export const spendTokensSchema = safeInteger.positive();
export const spendScopeSchema = z.string().refine((scope) => scope === "all" || (scope.startsWith("repo:") && idSchema.safeParse(scope.slice(5)).success), "spend-scope-invalid");
export const spendPeriodSchema = z.enum(["total", "week", "month"]);
/** Accounts spec §6.3.1, D9: why a group's claim waits (spend_cap_blocks); projected on views, never a command outcome. */
export const spendCapBlockSchema = z.object({ code: z.literal("spend-cap-reached"), scope: spendScopeSchema, period: spendPeriodSchema, capTokens: spendTokensSchema, grantTokens: safeInteger.positive() }).strict();
export const setSpendCapPayloadSchema = z.object({ scope: spendScopeSchema, period: spendPeriodSchema, tokens: spendTokensSchema }).strict();
export const clearSpendCapPayloadSchema = z.object({ scope: spendScopeSchema, period: spendPeriodSchema }).strict();
// Spec §5.2: an IANA zone this runtime's Intl knows, or the setter is refused by name; weekStart 1 = Monday .. 7 = Sunday.
export const setUsageCalendarPayloadSchema = z
  .object({ timeZone: nonemptyString.refine(isTimeZone, "time-zone-invalid"), weekStart: z.number().int().min(1).max(7) })
  .strict();
// Labels and progress spec §3.1 (§8 R8, R16): shape only -- a list of strings, or null to drop the operator layer. The
// vocabulary, prefix, NFC and the 16-label cap are checked in apply, so a refusal is ledgered and names the label. The
// raw cap (64) only bounds the request: 16 is counted after deduplication (R15; plan finding F2).
export const setTaskLabelsPayloadSchema = z
  .object({ labels: z.array(z.string()).max(64).nullable(), baseLabelsVersion: safeInteger })
  .strict();
// W5: one work dimension of set-task-loop taken from an estimate (the estimate names where it came from).
const modelProvenanceSchema = z.object({ provenance: z.literal("model"), estimateId: idSchema }).strict();
// Loop plans spec §5.2 (Drafter finding F3): the task is the target; sessions is not here -- it is never mapped into the
// contract and is carried over unchanged (R10). Shape only: the plan id and the path shapes are judged in apply, so a
// refusal is ledgered and named (loop-plan-invalid).
export const setTaskLoopPayloadSchema = z
  .object({
    baseLoopVersion: safeInteger,
    plan: nonemptyString,
    inputs: loopInputsSchema,
    work: z.object({ tokens: positiveSafeInteger, activeMs: positiveSafeInteger, attempts: positiveSafeInteger }).strict(),
    // W5: the work dimensions taken from an estimate's suggestion for this task, checked like proposal-edit's model
    // fields; a dimension absent here that changes is the person's own.
    workProvenance: z.object({ tokens: modelProvenanceSchema.optional(), activeMs: modelProvenanceSchema.optional(), attempts: modelProvenanceSchema.optional() }).strict().optional(),
    // Syncskill integration spec §10.4: the task's skill set, the full desired state like `inputs` -- absent removes it.
    skills: loopSkillsSchema.optional(),
  })
  .strict();

// N1 spec §11.1: the five requirement commands. Shape only; every transition is decided in apply and ledgered.
const answerInputSchema = z.discriminatedUnion("kind", [
  z.object({ id: questionIdSchema, kind: z.literal("recommended") }).strict(),
  z.object({ id: questionIdSchema, kind: z.literal("text"), text: nonemptyString.max(8 * 1024) }).strict(),
]);
const decisionInputSchema = z.object({ id: nonemptyString, accept: z.boolean() }).strict();
const ideaSchema = nonemptyString.refine((idea) => Buffer.byteLength(idea, "utf8") <= IDEA_MAX_BYTES, "idea-too-large");
export const requirementOpenPayloadSchema = z.object({
  groupId: idSchema, repoId: idSchema, idea: ideaSchema, limit: amountSchema.optional(), agent: panelPartialSelectionSchema.optional(), contentLanguage: z.enum(["en", "zh"]).optional(),
}).strict();
const effectiveRequirementOpenPayloadSchema = z.object({
  groupId: idSchema, repoId: idSchema, idea: ideaSchema, limit: amountSchema, agent: panelPartialSelectionSchema.nullable(), contentLanguage: z.enum(["en", "zh"]),
}).strict();
export const requirementAnswerPayloadSchema = z.object({
  roundNo: positiveSafeInteger, answers: z.array(answerInputSchema), glossaryDecisions: z.array(decisionInputSchema), adrDecisions: z.array(decisionInputSchema),
}).strict();
export const requirementConsensusPayloadSchema = z.object({ roundNo: positiveSafeInteger }).strict();
export const requirementDraftFeedbackPayloadSchema = z.object({
  draftNo: positiveSafeInteger, feedback: nonemptyString.refine((text) => Buffer.byteLength(text, "utf8") <= IDEA_MAX_BYTES, "feedback-too-large"),
}).strict();
export const requirementDraftAcceptPayloadSchema = z.object({ draftNo: positiveSafeInteger, draftHash: hashSchema }).strict();

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
  z.object({ ...rawCommandFields, verb: z.literal("retry-task"), target: groupCommandTargetSchema, payload: retryTaskPayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("shutdown"), target: globalCommandTargetSchema, payload: shutdownPayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("set-workspace-mode"), target: repositoryCommandTargetSchema, payload: setWorkspaceModePayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("set-integration-scheme"), target: repositoryCommandTargetSchema, payload: setIntegrationSchemePayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("set-group-integration"), target: groupCommandTargetSchema, payload: setGroupIntegrationPayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("retry-integration"), target: groupCommandTargetSchema, payload: emptyPayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("resolve-integration-conflict"), target: groupCommandTargetSchema, payload: emptyPayloadSchema }).strict(),
  // Issue-fixes spec §6.3: archive and unarchive, group target, empty payload.
  z.object({ ...rawCommandFields, verb: z.literal("archive-group"), target: groupCommandTargetSchema, payload: emptyPayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("unarchive-group"), target: groupCommandTargetSchema, payload: emptyPayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("set-agent-preferences"), target: operatorCommandTargetSchema, payload: setAgentPreferencesPayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("set-task-labels"), target: taskCommandTargetSchema, payload: setTaskLabelsPayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("set-task-loop"), target: taskCommandTargetSchema, payload: setTaskLoopPayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("requirement-open"), target: groupCommandTargetSchema, payload: requirementOpenPayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("requirement-answer"), target: groupCommandTargetSchema, payload: requirementAnswerPayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("requirement-consensus"), target: groupCommandTargetSchema, payload: requirementConsensusPayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("requirement-draft-feedback"), target: groupCommandTargetSchema, payload: requirementDraftFeedbackPayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("requirement-draft-accept"), target: groupCommandTargetSchema, payload: requirementDraftAcceptPayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("set-spend-cap"), target: spendCommandTargetSchema, payload: setSpendCapPayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("clear-spend-cap"), target: spendCommandTargetSchema, payload: clearSpendCapPayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("set-usage-calendar"), target: spendCommandTargetSchema, payload: setUsageCalendarPayloadSchema }).strict(),
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
  z.object({ ...effectiveCommandFields, verb: z.literal("retry-task"), target: groupCommandTargetSchema, payload: retryTaskPayloadSchema }).strict(),
  z.object({ ...effectiveCommandFields, verb: z.literal("shutdown"), target: globalCommandTargetSchema, payload: shutdownPayloadSchema }).strict(),
  z.object({ ...effectiveCommandFields, verb: z.literal("set-workspace-mode"), target: repositoryCommandTargetSchema, payload: setWorkspaceModePayloadSchema }).strict(),
  z.object({ ...effectiveCommandFields, verb: z.literal("set-integration-scheme"), target: repositoryCommandTargetSchema, payload: setIntegrationSchemePayloadSchema }).strict(),
  z.object({ ...effectiveCommandFields, verb: z.literal("set-group-integration"), target: groupCommandTargetSchema, payload: setGroupIntegrationPayloadSchema }).strict(),
  z.object({ ...effectiveCommandFields, verb: z.literal("retry-integration"), target: groupCommandTargetSchema, payload: emptyPayloadSchema }).strict(),
  z.object({ ...effectiveCommandFields, verb: z.literal("resolve-integration-conflict"), target: groupCommandTargetSchema, payload: emptyPayloadSchema }).strict(),
  // Issue-fixes spec §6.3: archive and unarchive, group target, empty payload.
  z.object({ ...effectiveCommandFields, verb: z.literal("archive-group"), target: groupCommandTargetSchema, payload: emptyPayloadSchema }).strict(),
  z.object({ ...effectiveCommandFields, verb: z.literal("unarchive-group"), target: groupCommandTargetSchema, payload: emptyPayloadSchema }).strict(),
  z.object({ ...effectiveCommandFields, verb: z.literal("set-agent-preferences"), target: operatorCommandTargetSchema, payload: setAgentPreferencesPayloadSchema }).strict(),
  z.object({ ...effectiveCommandFields, verb: z.literal("set-task-labels"), target: taskCommandTargetSchema, payload: setTaskLabelsPayloadSchema }).strict(),
  z.object({ ...effectiveCommandFields, verb: z.literal("set-task-loop"), target: taskCommandTargetSchema, payload: setTaskLoopPayloadSchema }).strict(),
  z.object({ ...effectiveCommandFields, verb: z.literal("requirement-open"), target: groupCommandTargetSchema, payload: effectiveRequirementOpenPayloadSchema }).strict(),
  z.object({ ...effectiveCommandFields, verb: z.literal("requirement-answer"), target: groupCommandTargetSchema, payload: requirementAnswerPayloadSchema }).strict(),
  z.object({ ...effectiveCommandFields, verb: z.literal("requirement-consensus"), target: groupCommandTargetSchema, payload: requirementConsensusPayloadSchema }).strict(),
  z.object({ ...effectiveCommandFields, verb: z.literal("requirement-draft-feedback"), target: groupCommandTargetSchema, payload: requirementDraftFeedbackPayloadSchema }).strict(),
  z.object({ ...effectiveCommandFields, verb: z.literal("requirement-draft-accept"), target: groupCommandTargetSchema, payload: requirementDraftAcceptPayloadSchema }).strict(),
  z.object({ ...effectiveCommandFields, verb: z.literal("set-spend-cap"), target: spendCommandTargetSchema, payload: setSpendCapPayloadSchema }).strict(),
  z.object({ ...effectiveCommandFields, verb: z.literal("clear-spend-cap"), target: spendCommandTargetSchema, payload: clearSpendCapPayloadSchema }).strict(),
  z.object({ ...effectiveCommandFields, verb: z.literal("set-usage-calendar"), target: spendCommandTargetSchema, payload: setUsageCalendarPayloadSchema }).strict(),
]);

function refineCommandIdentity(
  value: z.infer<typeof rawAuthorityCommandVariants> | z.infer<typeof effectiveAuthorityCommandVariants>,
  ctx: z.RefinementCtx,
): void {
  if (value.verb === "import-plan" && value.target.groupId !== value.payload.groupId) {
    issue(ctx, ["target", "groupId"], "command-target-payload-mismatch");
  }
  if (value.verb === "requirement-open" && value.target.groupId !== value.payload.groupId) {
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

// N1 spec §11.2: the requirement line of the summary, on the existing 2-second changeSeq pull. Tool-reported numbers only.
export const requirementSummarySchema = z.object({
  roundNo: positiveSafeInteger.nullable(), roundState: z.enum(ROUND_STATES).nullable(), openQuestions: safeInteger,
  draftNo: positiveSafeInteger.nullable(), draftState: z.enum(DRAFT_STATES).nullable(),
  waiting: z.enum(REQUIREMENT_WAITING).nullable(), reasonCode: nonemptyString.nullable(),
  exportState: z.enum(["not-due", "pending", "done", "conflict"]),
  used: amountSchema, reserved: amountSchema, limit: amountSchema, usageUnknown: z.boolean(),
  // Final review finding 4: the requirement's call blocked by the driver, and why; the group view refuses a clarifying
  // group (DR25), so this is where its reason and its run-scoped recovery-retry are shown.
  blockedRun: z.object({ runId: idSchema, reason: nonemptyString.nullable() }).strict().nullable(),
}).strict();
export type RequirementSummaryV1 = z.infer<typeof requirementSummarySchema>;

export const groupSummarySchema = z
  .object({
    groupId: idSchema,
    repoId: idSchema,
    state: z.enum(["clarifying", "draft", "ready", "running", "review", "done", "blocked"]),
    commandRevision: positiveSafeInteger,
    projectionSeq: positiveSafeInteger,
    stopMode: z.enum(["pause", "shutdown", "handoff"]).nullable(),
    stopState: z.enum(["paused", "handoff-pending", "handoff-partial", "handoff-unresolved", "handoff-complete"]).nullable(),
    claimBlocked: z.boolean(),
    recoveryBlockerCount: safeInteger,
    // Labels and progress spec §4.1 (§8 R14, R19): tasks done out of the plan's tasks. Optional on the wire so older
    // fixtures still parse; the server always gives it. The group view's `summary` is this same object (finding F7).
    completion: z.object({ done: safeInteger, total: safeInteger }).strict().optional(),
    // N1 spec §11.2: present on every group that carries a requirement block (a clarifying group, or the one it became).
    requirement: requirementSummarySchema.optional(),
    // Issue-fixes spec §6.2: optional on the wire so older fixtures parse; the server always gives every one. `goal` is the
    // plan's goal, or a clarifying group's idea; `branch` is orca/<groupId>; `counts` are §6.1's categories over the plan's
    // tasks (a work item that cannot be read is in no count); `updatedAt` is the `at` of the group's newest activity row,
    // null before the first; `archived` says whether the body carries an archive mark (§6.3).
    goal: nonemptyString.optional(),
    branch: nonemptyString.optional(),
    counts: z.object({ idle: safeInteger, running: safeInteger, waiting: safeInteger, blocked: safeInteger, done: safeInteger }).strict().optional(),
    updatedAt: safeInteger.nullable().optional(),
    archived: z.boolean().optional(),
  })
  .strict();

/** N1 spec §11.2: one requirement in full, for the Requirements section. Model content is passed as written. */
export const requirementViewSchema = z.object({
  schema: z.literal("orca-requirement-view-v1"), epoch: nonemptyString, changeSeq: safeInteger, summary: groupSummarySchema,
  requirement: z.object({
    requirementId: z.string().regex(/^[a-f0-9]{32}$/), repoId: idSchema, slug: nonemptyString.nullable(), contentLanguage: z.enum(["en", "zh"]),
    createdOn: nonemptyString, idea: nonemptyString,
    consensus: z.object({ roundNo: positiveSafeInteger, at: canonicalTimestampSchema, openBranches: z.array(nonemptyString), openQuestions: z.array(nonemptyString) }).strict().nullable(),
    acceptedDraftNo: positiveSafeInteger.nullable(), document: z.object({ sha256: hashSchema, frozenAt: canonicalTimestampSchema }).strict().nullable(),
    export: requirementExportSchema,
  }).strict(),
  ledger: z.object({ limit: amountSchema, used: amountSchema, reserved: amountSchema, usageUnknown: z.boolean() }).strict(),
  rounds: z.array(roundBodySchema),
  drafts: z.array(draftBodySchema.omit({ plan: true })),
  document: z.string(),
  spendCapBlock: spendCapBlockSchema.nullable().optional(),
}).strict();
export type RequirementViewV1 = z.infer<typeof requirementViewSchema>;

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

// Labels and progress spec §4.1 (§8 R10, R11, R18; plan finding F6): the current run's progress. Step, attempt and
// lastTransitionAt are ccloop's, null until it reported any; tokens are the run's booked tokens out of its grant, null
// when unknown or overrun -- never 0 for "unknown".
export const workItemProgressSchema = z
  .object({
    runId: idSchema,
    step: z.enum(["queued", "plan", "execute", "verify", "succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"]).nullable(),
    attempt: z.object({ current: safeInteger, max: safeInteger }).strict().nullable(),
    tokens: z.object({ used: safeInteger, grant: safeInteger }).strict().nullable(),
    lastTransitionAt: nonemptyString.nullable(),
  })
  .strict();

// Loop plans spec §4.1, panel i18n spec §3.1: a loop task's plan as the fields the panel builds its words from -- the
// effective recipe, the expanded contract's file cap and whether the plan version has a discipline line; no English
// sentence travels. chosenByLabel is the plan file's label that chose it (spec §2.4); loopVersion is what set-task-loop
// must name.
export const loopPlanViewSchema = z
  .object({
    planId: z.enum(LOOP_PLAN_IDS),
    planVersion: positiveSafeInteger,
    chosenBy: z.enum(["explicit", "labels"]),
    chosenByLabel: nonemptyString.nullable(),
    amended: z.boolean(),
    loopVersion: safeInteger,
    inputs: loopInputsSchema,
    maxFiles: positiveSafeInteger,
    hasDiscipline: z.boolean(),
    // Syncskill integration spec §10.4: the recipe's skill set, absent when it has none; the card sends it back unchanged.
    skills: loopSkillsSchema.optional(),
    // Syncskill integration spec §4.6: the names the task's skill set froze to at confirm; absent before that.
    frozenSkillNames: z.array(nonemptyString).min(1).optional(),
  })
  .strict();

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
    // Labels and progress spec §2.5, §4.1 (§8 R19): the task's effective labels, where they came from, and the version a
    // set-task-labels must name. Optional on the wire; the server always gives them.
    labels: storedLabelsSchema.optional(),
    labelsProvenance: z.enum(["plan", "operator"]).optional(),
    labelsVersion: safeInteger.optional(),
    // §8 R19: optional on the wire, always given by the server; null when the task has no current run.
    progress: workItemProgressSchema.nullable().optional(),
    // Loop plans spec §4.1: null for a hand-written contract. Optional on the wire like labels; the server always gives it.
    loopPlan: loopPlanViewSchema.nullable().optional(),
    // Loop plans spec §4.1 (Drafter finding F4): the effective contract's goal and success condition.
    objective: z.object({ goal: nonemptyString, successCondition: nonemptyString }).strict().optional(),
    // Issue-fixes spec §6.1: the item's display category, computed once on the server. Optional on the wire like labels;
    // the server always gives it.
    category: z.enum(WORK_ITEM_CATEGORIES).optional(),
  })
  .strict();

// Issue-fixes spec §5.2 (ruling H5): one row of Orca's activity record as the views show it (src/control/activity.ts).
export const activityKindSchema = z.enum([
  "command", "run-claimed", "run-started", "phase", "run-blocked", "run-resumed", "run-settled", "task-retried", "integration", "stop", "stop-cleared", "archived", "unarchived",
]);
export const activityEntrySchema = z
  .object({
    seq: positiveSafeInteger, groupId: idSchema, taskId: idSchema.nullable(), runId: idSchema.nullable(), at: safeInteger,
    kind: activityKindSchema, body: z.record(z.unknown()),
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
      "settled-failed",
      "collected",
      "landed",
      "reconciling",
      "blocked",
    ]),
    phase: z.enum(["estimate", "work", "handoff", "single-call"]),
    // N1 DR26: what a `single-call` run of a requirement was for; absent on every other phase.
    purpose: z.enum(["clarify", "split"]).optional(),
    claimOrdinal: positiveSafeInteger.nullable(),
    providerAttemptOrdinal: safeInteger,
    profile: profileBindingSchema,
    used: amountSchema,
    remaining: amountSchema,
    failureCode: nonemptyString.nullable(),
    blockedReason: nonemptyString.nullable(),
    // Issue fixes spec §4.2(1), (5): ccloop's own reason for the terminal it reported, and the drive record's outcome (the
    // Retry-task button keys on it). Optional on the wire like `git`; the server always gives both, null when absent.
    stopReason: nonemptyString.nullable().optional(),
    outcome: nonemptyString.nullable().optional(),
    continuable: z.boolean(),
    evidenceIds: sortedIdArraySchema,
    // Board spec 2026-10-03 D4: the git facts the run's drive record holds -- the workspace mode it ran in, the work
    // branch commit it started from, the commit that landed it. null for a run without a drive record. Optional on the
    // wire so older fixtures still parse; the server always gives it.
    git: z
      .object({ workspaceMode: workspaceModeSchema, base: commitShaSchema.nullable(), landedCommit: commitShaSchema.nullable() })
      .strict()
      .nullable()
      .optional(),
    // Syncskill integration spec §4.6: the skills the run was given (syncskill's lock; the snapshot's local path is not shown).
    skills: z
      .object({
        profile: nonemptyString.nullable(),
        lock: z.array(z.object({
          name: z.string(),
          source: z.object({ name: z.string(), type: z.string(), url: z.string(), branch: z.string().optional() }).strict().nullable(),
          resolved_commit: z.string().nullable(),
          content_md5: z.string(),
        }).strict()),
      })
      .strict()
      .optional(),
    // Issue-fixes spec §5.2: wall-clock times (ms) -- started when A1 reserved the first attempt, ended when it first
    // landed or settled, and the time of its newest activity row. null for a run written before schema 9. Optional on
    // the wire so older fixtures still parse; the server always gives them.
    startedAt: safeInteger.nullable().optional(),
    endedAt: safeInteger.nullable().optional(),
    lastActivityAt: safeInteger.nullable().optional(),
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
    // W6: built from contracts a set-task-loop change has since replaced; its suggestions are no longer applied. Always
    // set by the projection; optional only so the Web mirror's literal fixtures need no edit (webParity.test.ts).
    stale: z.boolean().optional(),
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

const groupIntegrationViewSchema = z
  .object({
    scheme: integrationSchemeSchema,
    schemeHash: hashSchema,
    frozen: z.boolean(),
    state: z.enum(["idle", "blocked", "conflict", "resolving"]),
    reason: z.string().nullable(),
    lastIntegrated: commitShaSchema.nullable(),
    integratedCommit: commitShaSchema.nullable(),
    pr: z.object({ url: z.string(), number: safeInteger, ready: z.boolean() }).strict().nullable(),
  })
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
    // Wave 3 M-5 (agent selection spec §6.1, §6.4 step 4): the group's frozen reconcile selection, from the confirmed
    // snapshot; null until confirmation.
    agents: z.object({ reconcile: frozenSlotSchema.nullable() }).strict(),
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
    spendCapBlock: spendCapBlockSchema.nullable().optional(),
    // Integration spec §4: the group's integration as an owner sees it; absent for keep (ruling R5).
    integration: groupIntegrationViewSchema.optional(),
    // Issue-fixes spec §5.2 Reads: the group's newest 50 activity rows, newest first. Optional on the wire so older
    // fixtures still parse; the server always gives it.
    activity: z.array(activityEntrySchema).optional(),
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

// Issue-fixes spec §5.2 Reads: GET /api/control/runs/:runId/activity -- the run's newest 200 rows, newest first.
export const runActivitySchema = z
  .object({ schema: z.literal("orca-run-activity-v1"), runId: idSchema, entries: z.array(activityEntrySchema) })
  .strict();

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
  z.object({ kind: z.literal("integration-scheme-set"), repoId: idSchema, integration: integrationSchemeSchema }).strict(),
  z.object({ kind: z.literal("group-integration-set"), groupId: idSchema, integration: integrationSchemeSchema }).strict(),
  z.object({ kind: z.literal("integration-retried"), groupId: idSchema }).strict(),
  z.object({ kind: z.literal("integration-resolution-started"), groupId: idSchema }).strict(),
  // Issue-fixes spec §6.3: `at` is the archive mark's time (ms since the epoch).
  z.object({ kind: z.literal("archived"), groupId: idSchema, at: safeInteger }).strict(),
  z.object({ kind: z.literal("unarchived"), groupId: idSchema }).strict(),
  z.object({ kind: z.literal("agent-preferences-set"), operatorId: nonemptyString, revision: positiveSafeInteger }).strict(),
  z.object({ kind: z.literal("spend-cap-set"), revision: positiveSafeInteger }).strict(),
  z.object({ kind: z.literal("spend-cap-cleared"), revision: positiveSafeInteger }).strict(),
  z.object({ kind: z.literal("usage-calendar-set"), revision: positiveSafeInteger }).strict(),
  z.object({ kind: z.literal("task-labels-set"), taskId: idSchema, labelsVersion: positiveSafeInteger }).strict(),
  z.object({ kind: z.literal("task-loop-set"), taskId: idSchema, loopVersion: positiveSafeInteger, proposalVersion: positiveSafeInteger }).strict(),
  z
    .object({
      kind: z.literal("task-continuing"),
      continuationIntentId: idSchema,
      pendingRunId: idSchema,
      claimOrdinal: positiveSafeInteger,
      wakeId: nonemptyString,
    })
    .strict(),
  z.object({ kind: z.literal("task-retried"), taskId: idSchema, fromRunId: idSchema }).strict(),
  z
    .object({
      kind: z.literal("recovery-observed"),
      resolved: z.boolean(),
      blockerCodes: z.array(nonemptyString).superRefine((values, ctx) => requireSortedUnique(values, String, ctx, [])),
      evidenceIds: sortedIdArraySchema,
      wakeIds: z.array(nonemptyString).superRefine((values, ctx) => requireSortedUnique(values, String, ctx, [])),
    })
    .strict(),
  // N1 spec §11.1: the requirement commands' results.
  z.object({ kind: z.literal("requirement-opened"), groupId: idSchema, requirementId: z.string().regex(/^[a-f0-9]{32}$/), roundNo: z.literal(1), wakeId: nonemptyString }).strict(),
  z.object({ kind: z.literal("requirement-answered"), roundNo: positiveSafeInteger, nextRoundNo: positiveSafeInteger.nullable(), wakeId: nonemptyString.nullable() }).strict(),
  z.object({ kind: z.literal("requirement-consensus"), roundNo: positiveSafeInteger, draftNo: positiveSafeInteger, wakeId: nonemptyString }).strict(),
  z.object({ kind: z.literal("requirement-draft-rejected"), draftNo: positiveSafeInteger, nextDraftNo: positiveSafeInteger, wakeId: nonemptyString }).strict(),
  z
    .object({
      kind: z.literal("requirement-draft-accepted"),
      draftNo: positiveSafeInteger,
      estimateId: idSchema,
      estimateState: z.enum(["queued", "blocked-capability", "input-too-large"]),
      documentSha256: hashSchema,
      exportWakeId: nonemptyString,
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
              "unchanged-idle",
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
    const projectionless = isShutdown || value.verb === "set-workspace-mode" || value.verb === "set-integration-scheme" || value.verb === "set-agent-preferences"
      || value.verb === "set-spend-cap" || value.verb === "clear-spend-cap" || value.verb === "set-usage-calendar";
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
export type RetryTaskPayload = z.infer<typeof retryTaskPayloadSchema>;
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
export type WorkItemProgressV1 = z.infer<typeof workItemProgressSchema>;
export type RunViewV1 = z.infer<typeof runViewSchema>;
export type EstimateViewV1 = z.infer<typeof estimateViewSchema>;
export type CheckpointViewV1 = z.infer<typeof checkpointViewSchema>;
export type HandoffRequestViewV1 = z.infer<typeof handoffRequestViewSchema>;
export type GroupViewV1 = z.infer<typeof groupViewSchema>;
export type RecoveryViewV1 = z.infer<typeof recoveryViewSchema>;
export type EvidenceManifestV1 = z.infer<typeof evidenceManifestSchema>;
export type ActivityEntryV1 = z.infer<typeof activityEntrySchema>;
export type RunActivityV1 = z.infer<typeof runActivitySchema>;
export type CommandErrorV1 = z.infer<typeof commandErrorSchema>;
export type CommandErrorBodyV1 = z.infer<typeof commandErrorBodySchema>;
export type CommandSuccessV1 = z.infer<typeof commandSuccessSchema>;
export type CommandLookupV1 = z.infer<typeof commandLookupSchema>;

export const repositoryWorkspaceSchema = z
  .object({ schema: z.literal("orca-repository-workspace-v1"), repoId: idSchema, workspaceMode: workspaceModeSchema, revision: safeInteger })
  .strict();
export type RepositoryWorkspaceV1 = z.infer<typeof repositoryWorkspaceSchema>;
// Integration spec §3.4: the repository default's own read; the workspace read above keeps its shape.
export const repositoryIntegrationSchema = z
  // suggestedTarget (controller ruling, Task 7): the target the panel pre-fills for a repository with no scheme yet.
  .object({ schema: z.literal("orca-repository-integration-v1"), repoId: idSchema, integration: integrationSchemeSchema, revision: safeInteger, suggestedTarget: z.string().nullable() })
  .strict();
export type RepositoryIntegrationV1 = z.infer<typeof repositoryIntegrationSchema>;
export type SetIntegrationSchemePayload = z.infer<typeof setIntegrationSchemePayloadSchema>;
export type SetGroupIntegrationPayload = z.infer<typeof setGroupIntegrationPayloadSchema>;
export type SetWorkspaceModePayload = z.infer<typeof setWorkspaceModePayloadSchema>;
export type SetAgentPreferencesPayload = z.infer<typeof setAgentPreferencesPayloadSchema>;
export type ProposalSetAgentPayload = z.infer<typeof proposalSetAgentPayloadSchema>;
export type SetTaskLabelsPayload = z.infer<typeof setTaskLabelsPayloadSchema>;
export type SetTaskLoopPayload = z.infer<typeof setTaskLoopPayloadSchema>;
export type RequirementOpenPayload = z.infer<typeof requirementOpenPayloadSchema>;
export type RequirementAnswerPayload = z.infer<typeof requirementAnswerPayloadSchema>;
export type RequirementConsensusPayload = z.infer<typeof requirementConsensusPayloadSchema>;
export type RequirementDraftFeedbackPayload = z.infer<typeof requirementDraftFeedbackPayloadSchema>;
export type RequirementDraftAcceptPayload = z.infer<typeof requirementDraftAcceptPayloadSchema>;

// Agent selection spec §6.8 (plan T14): the three reads the panel's agent UI is built on. The component schemas
// (contextWindowSchema, partialSelectionSchema, operatorPreferencesSchema, groupAgentOverridesSchema,
// frozenSlotSchema) are T7-T11's; these only compose them into what one GET answers.
export const agentsViewSchema = z
  .object({
    schema: z.literal("orca-agents-view-v1"),
    installations: z.array(
      z
        .object({
          id: idSchema,
          kind: nonemptyString,
          defaults: z.object({ model: nonemptyString, contextWindow: contextWindowSchema }).strict(),
          contextOptions: z.array(contextWindowSchema).min(1),
          version: nonemptyString,
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((value, ctx) => requireSortedUnique(value.installations, (entry) => entry.id, ctx, ["installations"]));

export const agentPreferencesViewSchema = z
  .object({ schema: z.literal("orca-agent-preferences-v1"), operatorId: nonemptyString, revision: safeInteger, preferences: operatorPreferencesSchema })
  .strict();

const slotOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("resolved"), frozen: frozenSlotSchema }).strict(),
  z.object({ kind: z.literal("rejected"), code: nonemptyString }).strict(),
  // Wave 3 ruling I-1: ccloop could not be asked about this slot just now (a transient failure); not confirmable.
  z.object({ kind: z.literal("unavailable"), code: nonemptyString }).strict(),
]);

/**
 * W6-1/W6-2: the confirm's own resolution (agentFreeze.ts resolveGroupSelections), as the panel shows it. A slot's
 * key is `task:<taskId>` or `reconcile`; the hash exists exactly when every slot resolved, because a confirm can only
 * bind to a resolution it could freeze whole (spec §6.4 step 2).
 */
export const agentSelectionPreviewSchema = z
  .object({
    schema: z.literal("orca-agent-selection-preview-v1"),
    groupId: idSchema,
    proposalVersion: positiveSafeInteger,
    groupOverrides: groupAgentOverridesSchema,
    taskOverrides: z.record(idSchema, panelPartialSelectionSchema.nullable()),
    // Ruling review R7: the plan file's layers, shown under the panel's (the plan's half of each level).
    planLayers: z.object({
      group: z.object({ worker: partialSelectionSchema.optional(), reconcile: partialSelectionSchema.optional() }).strict(),
      tasks: z.record(idSchema, partialSelectionSchema.nullable()),
    }).strict(),
    slots: z.array(
      z.object({ key: nonemptyString, slot: z.enum(["worker", "reconcile"]), taskId: idSchema.nullable(), outcome: slotOutcomeSchema }).strict(),
    ),
    selectionsHash: hashSchema.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    requireSortedUnique(value.slots, (entry) => entry.key, ctx, ["slots"]);
    value.slots.forEach((entry, index) => {
      if ((entry.slot === "worker") !== (entry.taskId !== null)) issue(ctx, ["slots", index, "taskId"], "slot-task-mismatch");
      if (entry.key !== (entry.taskId === null ? "reconcile" : `task:${entry.taskId}`)) issue(ctx, ["slots", index, "key"], "slot-key-mismatch");
    });
    const unresolved = value.slots.some((entry) => entry.outcome.kind !== "resolved");
    if (unresolved !== (value.selectionsHash === null)) issue(ctx, ["selectionsHash"], "selections-hash-rejection-mismatch");
  });

export type AgentsViewV1 = z.infer<typeof agentsViewSchema>;
export type AgentPreferencesViewV1 = z.infer<typeof agentPreferencesViewSchema>;
export type AgentSelectionPreviewV1 = z.infer<typeof agentSelectionPreviewSchema>;

// Accounts spec §5: GET /api/control/usage. Spec §6.2: each cap that applies to the view's scope, with what it leaves.
const capStatusSchema = z
  .object({
    scope: z.string().regex(/^(?:all|repo:[a-zA-Z0-9][a-zA-Z0-9_.-]*)$/), period: spendPeriodSchema, tokens: spendTokensSchema,
    updatedAt: safeInteger, updatedBy: nonemptyString, used: safeInteger, committed: safeInteger,
    // Not clamped: a cap lowered below what was used or promised shows how far over it is.
    headroom: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
    from: safeInteger.nullable(), to: safeInteger.nullable(),
  })
  .strict();
const usageModelEntrySchema = z
  .object({ model: nonemptyString.nullable(), input: safeInteger, output: safeInteger, cacheRead: safeInteger, cacheWrite: safeInteger, tokens: safeInteger })
  .strict();
export const usageViewSchema = z
  .object({
    schema: z.literal("orca-usage-view-v1"),
    scope: z.string().regex(/^(?:all|repo:[a-zA-Z0-9][a-zA-Z0-9_.-]*)$/),
    from: safeInteger.nullable(),
    to: safeInteger.nullable(),
    now: safeInteger,
    calendar: z.object({ timeZone: nonemptyString, weekStart: z.number().int().min(1).max(7) }).strict(),
    spendRevision: safeInteger,
    headline: z.object({ total: safeInteger, week: safeInteger, month: safeInteger }).strict(),
    range: z
      .object({
        tokens: safeInteger,
        byModel: z.array(usageModelEntrySchema),
        groups: z.array(z.object({ key: nonemptyString.nullable(), tokens: safeInteger }).strict()),
      })
      .strict(),
    counts: z.object({ unattributedRows: safeInteger, breakdownMismatchRows: safeInteger, unknownUsageRuns: safeInteger }).strict(),
    caps: z.array(capStatusSchema),
  })
  .strict();
export type UsageViewV1 = z.infer<typeof usageViewSchema>;
