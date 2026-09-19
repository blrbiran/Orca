import { describe, expect, it } from "vitest";
import { canonicalTimestampSchema, commandEnvelopeSchema } from "../../src/control/schema.js";
import {
  budgetEstimateSchema,
  controlPlanSchema,
  controlSummarySchema,
  executionProfileSnapshotSchema,
  executionSnapshotSchema,
  importPlanPayloadSchema,
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
          targetVersion: "v1",
          configHash: hash,
          originalContractHash: hash,
          originalContractCanonicalJson: '{"schema":"orca-task-contract-v1"}',
        },
        {
          taskId: "b",
          dependencyTaskIds: ["a"],
          targetVersion: "v1",
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
