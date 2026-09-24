import { describe, expect, it } from "vitest";
import { canonicalTimestampSchema, commandEnvelopeSchema } from "../../src/control/schema.js";
import {
  authorityCommandSchema,
  budgetEstimateSchema,
  commandSuccessSchema,
  controlPlanSchema,
  controlSummarySchema,
  dispatchEnvelopeSchema,
  effectiveAuthorityCommandSchema,
  executionProfileSnapshotSchema,
  executionSnapshotSchema,
  groupViewSchema,
  importPlanPayloadSchema,
  rawAuthorityCommandSchema,
  requestBoundProofArtifactSchema,
  resumeFromHandoffPayloadSchema,
} from "../../src/control/webProtocol.js";

const hash = "a".repeat(64);
const amount = { tokens: 1, activeMs: 2, attempts: 3, sessions: 4 };
const provenance = {
  tokens: { provenance: "human", estimateId: null },
  activeMs: { provenance: "human", estimateId: null },
  attempts: { provenance: "human", estimateId: null },
  sessions: { provenance: "human", estimateId: null },
} as const;
const systemProvenance = {
  tokens: { provenance: "system", estimateId: null },
  activeMs: { provenance: "system", estimateId: null },
  attempts: { provenance: "system", estimateId: null },
  sessions: { provenance: "system", estimateId: null },
} as const;

describe("Web control protocol", () => {
  it("accepts only canonical UTC millisecond timestamps", () => {
    expect(canonicalTimestampSchema.parse("2026-09-20T12:34:56.789Z")).toBe("2026-09-20T12:34:56.789Z");
    for (const bad of [
      "2026-09-20T12:34:56Z",
      "2026-09-20T12:34:56.789+00:00",
      "2026-02-30T12:34:56.789Z",
      "2026-09-20T12:34:60.000Z",
      "0000-01-01T00:00:00.000Z",
    ]) {
      expect(canonicalTimestampSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("keeps command envelopes closed", () => {
    expect(commandEnvelopeSchema.parse({ commandId: "cmd-1", expectedRevision: 0, payload: {} })).toEqual({
      commandId: "cmd-1",
      expectedRevision: 0,
      payload: {},
    });
    expect(
      commandEnvelopeSchema.safeParse({ commandId: "cmd-1", expectedRevision: 0, payload: {}, by: "browser" }).success,
    ).toBe(false);
    expect(commandEnvelopeSchema.safeParse({ commandId: "cmd-1", expectedRevision: 0 }).success).toBe(false);
  });

  it("couples command verbs to closed raw payloads and explicit effective defaults", () => {
    const operation = {
      target: { scope: "task", taskId: "a", allocation: "work", dimension: "tokens" },
      value: 10,
      provenance: "human",
    } as const;
    const common = {
      commandId: "cmd-1",
      expectedRevision: 1,
      actorId: "operator",
      verb: "proposal-edit",
      target: { kind: "group", groupId: "g" },
    } as const;
    const raw = {
      ...common,
      schema: "orca-raw-command-v1",
      payload: { baseProposalVersion: 1, operations: [operation] },
    } as const;
    const effective = {
      ...common,
      schema: "orca-authority-command-v1",
      payload: { baseProposalVersion: 1, operations: [{ ...operation, estimateId: null }], proposedGroupLimit: null },
    } as const;

    expect(rawAuthorityCommandSchema.parse(raw)).toEqual(raw);
    // Duplicate targets are shape-valid; the command ledger owns durable 422 rejection.
    expect(rawAuthorityCommandSchema.safeParse({ ...raw, payload: { ...raw.payload, operations: [operation, operation] } }).success).toBe(true);
    expect(effectiveAuthorityCommandSchema.parse(effective)).toEqual(effective);
    expect(authorityCommandSchema.parse(raw)).toEqual(raw);
    expect(authorityCommandSchema.parse(effective)).toEqual(effective);
    expect(
      rawAuthorityCommandSchema.safeParse({ ...raw, payload: { ...raw.payload, executablePath: "/tmp/agent" } }).success,
    ).toBe(false);
    expect(
      effectiveAuthorityCommandSchema.safeParse({
        ...effective,
        payload: { baseProposalVersion: 1, operations: [operation] },
      }).success,
    ).toBe(false);
    expect(
      rawAuthorityCommandSchema.safeParse({ ...raw, verb: "start", payload: { command: "rm -rf" } }).success,
    ).toBe(false);
  });

  it("validates normalized plans and rejects unsorted or duplicate sets", () => {
    const plan = {
      schema: "orca-control-plan-v1",
      repoId: "repo",
      planId: "plan",
      goal: "ship",
      successConditions: ["checks pass"],
      tasks: [
        {
          taskId: "a",
          dependencyTaskIds: [],
          // Seam B (human ruling 2026-09-24, named under ruling 88): targetVersion is one positive safe integer from plan to wire.
          targetVersion: 1,
          configHash: hash,
          originalContractHash: hash,
          originalContractCanonicalJson: '{"schema":"orca-task-contract-v1"}',
        },
        {
          taskId: "b",
          dependencyTaskIds: ["a"],
          // Seam B (human ruling 2026-09-24, named under ruling 88): targetVersion is one positive safe integer from plan to wire.
          targetVersion: 1,
          configHash: hash,
          originalContractHash: hash,
          originalContractCanonicalJson: '{"schema":"orca-task-contract-v1"}',
        },
      ],
    };
    expect(controlPlanSchema.parse(plan)).toEqual(plan);
    expect(controlPlanSchema.safeParse({ ...plan, successConditions: ["same", "same"] }).success).toBe(false);
    expect(controlPlanSchema.safeParse({ ...plan, tasks: [...plan.tasks].reverse() }).success).toBe(false);
    expect(
      controlPlanSchema.safeParse({ ...plan, tasks: [plan.tasks[0], { ...plan.tasks[1], dependencyTaskIds: ["a", "a"] }] })
        .success,
    ).toBe(false);
  });

  it("accepts an explicit Codex phase-end plus soft profile snapshot", () => {
    const snapshot = {
      schema: "orca-execution-profile-snapshot-v1",
      profile: {
        profileId: "codex-worker",
        allowedWorkKinds: ["task"],
        adapter: "codex",
        adapterConfigRef: "adapter-config",
        modelPolicyRef: "model-policy",
        contextTokenizer: { tokenizerId: "tok", tokenizerVersion: "1" },
        workMaxOutputTokens: 4096,
        capabilities: {
          usageObservation: "phase-end",
          budgetEnforcement: "soft",
          contextObservation: "phase-end",
          handoffControl: "durable",
          handoffExecution: "mechanical-in-run-v1",
          contextWindowTokens: 200_000,
          requestBoundProof: null,
        },
        estimatorPreflight: null,
      },
      resolved: {
        adapterConfigContentHash: hash,
        modelPolicyContentHash: hash,
        proofDocumentContentHashes: [],
        adapterImplementationHash: hash,
        adapterProtocolVersion: "1",
        tokenizerArtifactHashes: [{ purpose: "context", contentHash: hash }],
        secretValueHashes: [],
      },
    };
    expect(executionProfileSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(
      executionProfileSnapshotSchema.safeParse({
        ...snapshot,
        profile: { ...snapshot.profile, estimatorPreflight: undefined },
      }).success,
    ).toBe(false);
    expect(
      executionProfileSnapshotSchema.safeParse({
        ...snapshot,
        profile: { ...snapshot.profile, allowedWorkKinds: ["task", "task"] },
      }).success,
    ).toBe(false);
    expect(
      executionProfileSnapshotSchema.safeParse({
        ...snapshot,
        profile: {
          ...snapshot.profile,
          capabilities: { ...snapshot.profile.capabilities, usageObservation: "realtime" },
        },
      }).success,
    ).toBe(false);
    expect(
      executionProfileSnapshotSchema.safeParse({
        ...snapshot,
        profile: {
          ...snapshot.profile,
          capabilities: { ...snapshot.profile.capabilities, budgetEnforcement: "bounded" },
        },
      }).success,
    ).toBe(false);
  });

  it("enforces dispatch phase grants and proof attempt/session maxima", () => {
    const zero = { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 };
    const binding = { profileId: "p", profileHash: hash };
    const estimateEnvelope = {
      schema: "orca-dispatch-envelope-v1",
      phase: "estimate",
      groupId: "g",
      workItemId: "estimate",
      runId: "r",
      generation: 1,
      claimIdentity: "estimate:g:e",
      ownerTokenHash: hash,
      continuationIntentId: null,
      claimOrdinal: null,
      derivedContractHash: hash,
      grants: { work: amount, handoff: zero },
      profiles: { estimator: binding, worker: null, handoff: null },
    } as const;
    expect(dispatchEnvelopeSchema.parse(estimateEnvelope)).toEqual(estimateEnvelope);
    expect(
      dispatchEnvelopeSchema.safeParse({ ...estimateEnvelope, grants: { ...estimateEnvelope.grants, handoff: amount } }).success,
    ).toBe(false);

    const workEnvelope = {
      ...estimateEnvelope,
      phase: "work",
      claimOrdinal: 1,
      profiles: { estimator: null, worker: binding, handoff: binding },
    } as const;
    expect(dispatchEnvelopeSchema.parse(workEnvelope)).toEqual(workEnvelope);
    expect(dispatchEnvelopeSchema.safeParse({ ...workEnvelope, claimOrdinal: null }).success).toBe(false);
    expect(
      dispatchEnvelopeSchema.safeParse({
        ...workEnvelope,
        phase: "handoff",
        continuationIntentId: null,
        profiles: { estimator: null, worker: null, handoff: binding },
        claimOrdinal: null,
      }).success,
    ).toBe(false);

    const proof = {
      schema: "orca-request-bound-proof-v1",
      phase: "work",
      runId: "r",
      generation: 1,
      providerAttemptOrdinal: 1,
      startEnvelopeHash: hash,
      derivedContractHash: hash,
      profileId: "p",
      profileHash: hash,
      proofScheme: "adapter-request-bound-v1",
      proofVersion: "1",
      requestLimits: { tokens: null, activeMs: null, attempts: 1, sessions: 0 },
      boundedDimensions: ["attempts", "sessions"],
      evidenceKind: "proof",
      providerStartForbiddenUntilVerified: true,
    } as const;
    expect(requestBoundProofArtifactSchema.parse(proof)).toEqual(proof);
    expect(
      requestBoundProofArtifactSchema.safeParse({
        ...proof,
        requestLimits: { ...proof.requestLimits, attempts: 2 },
      }).success,
    ).toBe(false);
    expect(
      requestBoundProofArtifactSchema.safeParse({
        ...proof,
        requestLimits: { ...proof.requestLimits, sessions: 2 },
      }).success,
    ).toBe(false);
  });

  it("validates a complete, canonically ordered execution snapshot", () => {
    const binding = { profileId: "p", profileHash: hash };
    const snapshot = {
      schema: "orca-execution-snapshot-v1",
      groupId: "g",
      planHash: hash,
      graphVersion: 1,
      proposalVersion: 1,
      groupLimit: amount,
      budgetMode: "soft",
      contextPolicy: { handoffAtContextTokens: null },
      profiles: { estimator: binding, worker: binding, handoff: binding, goalReview: binding },
      allocations: [
        { ownerKind: "goal-review", ownerId: "g:goal-review", bucket: "review", amount, fieldProvenance: provenance },
        { ownerKind: "reserve", ownerId: "g:reserve", bucket: "reserve", amount, fieldProvenance: systemProvenance },
        { ownerKind: "task", ownerId: "a", bucket: "handoff", amount, fieldProvenance: provenance },
        { ownerKind: "task", ownerId: "a", bucket: "work", amount, fieldProvenance: provenance },
      ],
      derivedContracts: [{ taskId: "a", derivedContractHash: hash }],
    };
    expect(executionSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(executionSnapshotSchema.safeParse({ ...snapshot, allocations: [...snapshot.allocations].reverse() }).success).toBe(false);
    expect(executionSnapshotSchema.safeParse({ ...snapshot, allocations: snapshot.allocations.slice(0, -1) }).success).toBe(false);
    expect(
      executionSnapshotSchema.safeParse({
        ...snapshot,
        allocations: snapshot.allocations.map((row) =>
          row.ownerKind === "reserve" ? { ...row, fieldProvenance: provenance } : row,
        ),
      }).success,
    ).toBe(false);
  });

  it("closes mutation payloads and preserves selection order while rejecting duplicate task selections", () => {
    expect(importPlanPayloadSchema.safeParse({ groupId: "g", repoId: "r", planId: "p", path: "/tmp/x" }).success).toBe(
      false,
    );
    const selection = { taskId: "a", predecessorRunId: "r1", checkpointId: "c1" };
    expect(resumeFromHandoffPayloadSchema.parse({ selections: [selection] })).toEqual({ selections: [selection] });
    expect(resumeFromHandoffPayloadSchema.safeParse({ selections: [selection, selection] }).success).toBe(false);
  });

  it("validates closed, sorted read DTOs", () => {
    const group = {
      groupId: "a",
      state: "draft",
      commandRevision: 1,
      projectionSeq: 1,
      stopMode: null,
      stopState: null,
      claimBlocked: false,
      recoveryBlockerCount: 0,
    };
    const summary = {
      schema: "orca-control-summary-v1",
      epoch: "epoch",
      changeSeq: 1,
      resetRequired: true,
      dispatchBlocked: false,
      groups: [group],
    };
    expect(controlSummarySchema.parse(summary)).toEqual(summary);
    expect(controlSummarySchema.safeParse({ ...summary, groups: [{ ...group, groupId: "b" }, group] }).success).toBe(false);
  });

  it("enforces canonical group allocation ownership and command revision nullability", () => {
    const allocation = (ownerKind: "goal-review" | "reserve" | "task", ownerId: string, bucket: "review" | "reserve" | "handoff" | "work") => ({
      ownerKind,
      ownerId,
      bucket,
      state: "draft-encumbered" as const,
      amount,
      fieldProvenance: ownerKind === "reserve" ? systemProvenance : provenance,
    });
    const group = {
      schema: "orca-control-group-v1",
      epoch: "epoch",
      changeSeq: 1,
      summary: {
        groupId: "g",
        state: "draft",
        commandRevision: 1,
        projectionSeq: 1,
        stopMode: null,
        stopState: null,
        claimBlocked: false,
        recoveryBlockerCount: 0,
      },
      graphVersion: 1,
      plan: { repoId: "repo", planId: "plan", planHash: hash, goal: "ship", successConditions: ["pass"] },
      proposal: {
        state: "editable",
        proposalVersion: 1,
        planHash: hash,
        budgetMode: null,
        contextPolicy: { handoffAtContextTokens: null },
        profiles: null,
        executionSnapshotHash: null,
      },
      ledger: {
        groupLimit: amount,
        used: amount,
        committedRemaining: amount,
        explicitUnallocatedReserve: amount,
        budgetDeficit: amount,
        usageUnknown: false,
      },
      allocations: [
        allocation("goal-review", "g:goal-review", "review"),
        allocation("reserve", "g:reserve", "reserve"),
        allocation("task", "a", "handoff"),
        allocation("task", "a", "work"),
      ],
      workItems: [
        {
          taskId: "a",
          status: "draft",
          dependencyTaskIds: [],
          // Seam B (human ruling 2026-09-24, named under ruling 88): targetVersion is one positive safe integer from plan to wire.
          targetVersion: 1,
          configHash: hash,
          originalContractHash: hash,
          derivedContractHash: null,
          currentRunId: null,
          pendingRunId: null,
          lineageRunIds: [],
        },
      ],
      estimates: [],
      runs: [],
      checkpoints: [],
      handoffRequests: [],
      stop: null,
      recoveryBlockers: [],
      recentCommandIds: [],
    } as const;
    expect(groupViewSchema.parse(group)).toEqual(group);
    for (const badAllocation of [
      allocation("task", "missing", "work"),
      allocation("goal-review", "wrong:goal-review", "review"),
      allocation("reserve", "g:reserve", "work"),
    ]) {
      expect(groupViewSchema.safeParse({ ...group, allocations: [badAllocation] }).success).toBe(false);
    }

    const browserSuccess = {
      schema: "orca-command-success-v1",
      commandId: "cmd",
      actorId: "operator",
      verb: "start",
      target: { kind: "group", groupId: "g" },
      commandRevision: 2,
      projectionSeq: 2,
      effectivePayloadHash: hash,
      authorityCommandHash: hash,
      result: { kind: "scheduled", operation: "start", wakeId: "wake:g" },
    } as const;
    expect(commandSuccessSchema.parse(browserSuccess)).toEqual(browserSuccess);
    expect(commandSuccessSchema.safeParse({ ...browserSuccess, commandRevision: null, projectionSeq: null }).success).toBe(false);
    expect(commandSuccessSchema.safeParse({ ...browserSuccess, commandRevision: null }).success).toBe(false);
    expect(commandSuccessSchema.safeParse({ ...browserSuccess, projectionSeq: null }).success).toBe(false);

    const shutdownSuccess = {
      ...browserSuccess,
      verb: "shutdown",
      target: { kind: "global", epoch: "epoch" },
      commandRevision: null,
      projectionSeq: null,
      result: { kind: "shutdown", groups: [] },
    } as const;
    expect(commandSuccessSchema.parse(shutdownSuccess)).toEqual(shutdownSuccess);
    expect(commandSuccessSchema.safeParse({ ...shutdownSuccess, commandRevision: 1, projectionSeq: 1 }).success).toBe(false);
    expect(commandSuccessSchema.safeParse({ ...shutdownSuccess, commandRevision: 1 }).success).toBe(false);
    expect(commandSuccessSchema.safeParse({ ...shutdownSuccess, projectionSeq: 1 }).success).toBe(false);
  });

  it("requires sorted estimate tasks and duplicate-free assumptions", () => {
    const estimate = {
      schema: "budget-estimate-v1",
      planHash: hash,
      tasks: [
        { taskId: "a", complexity: "S", confidence: "high", work: amount, handoff: amount, rationale: "r", assumptions: ["x"] },
        { taskId: "b", complexity: "M", confidence: "medium", work: amount, handoff: amount, rationale: "r", assumptions: ["y"] },
      ],
      goalReviewReserve: amount,
      groupRationale: "r",
    };
    expect(budgetEstimateSchema.parse(estimate)).toEqual(estimate);
    expect(budgetEstimateSchema.safeParse({ ...estimate, tasks: [...estimate.tasks].reverse() }).success).toBe(false);
    expect(
      budgetEstimateSchema.safeParse({ ...estimate, tasks: [{ ...estimate.tasks[0], assumptions: ["x", "x"] }, estimate.tasks[1]] })
        .success,
    ).toBe(false);
  });
});
