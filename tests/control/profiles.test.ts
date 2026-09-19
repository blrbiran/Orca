import { describe, expect, it } from "vitest";
import type { ExecutionPort, ProfileCapabilityProbe } from "../../src/control/executionPort.js";
import {
  createExecutionProfileRouter,
  intersectCapabilities,
  resolveProfile,
  unavailableCapabilities,
} from "../../src/control/profiles.js";
import type { ExecutionProfileSnapshotV1 } from "../../src/control/webProtocol.js";

const hash = (value: string) => value.repeat(64);

function snapshot(
  resolved: Partial<ExecutionProfileSnapshotV1["resolved"]> = {},
  profile: Partial<ExecutionProfileSnapshotV1["profile"]> = {},
): ExecutionProfileSnapshotV1 {
  return {
    schema: "orca-execution-profile-snapshot-v1",
    profile: {
      profileId: "worker",
      allowedWorkKinds: ["task"],
      adapter: "test-adapter",
      adapterConfigRef: "adapter-config",
      modelPolicyRef: "model-policy",
      contextTokenizer: { tokenizerId: "tok", tokenizerVersion: "1" },
      workMaxOutputTokens: 4096,
      capabilities: {
        usageObservation: "realtime",
        budgetEnforcement: "bounded",
        contextObservation: "realtime",
        handoffControl: "durable",
        handoffExecution: "mechanical-in-run-v1",
        contextWindowTokens: 100_000,
        requestBoundProof: {
          scheme: "adapter-request-bound-v1",
          version: "1",
          workDimensions: ["tokens"],
          handoffDimensions: ["activeMs"],
          evidenceKind: "request-bound-v1",
        },
      },
      estimatorPreflight: null,
      ...profile,
    },
    resolved: {
      adapterConfigContentHash: hash("a"),
      modelPolicyContentHash: hash("b"),
      proofDocumentContentHashes: [hash("c")],
      adapterImplementationHash: hash("d"),
      adapterProtocolVersion: "1",
      tokenizerArtifactHashes: [{ purpose: "context", contentHash: hash("e") }],
      secretValueHashes: [{ name: "/adapter/token", valueHash: hash("f") }],
      ...resolved,
    },
  };
}

function port(probe: ProfileCapabilityProbe | (() => Promise<ProfileCapabilityProbe>)): ExecutionPort {
  const result = typeof probe === "function" ? probe : async () => probe;
  return {
    probeProfileCapabilities: result,
    capabilities: async () => ({
      protocol: 1,
      durableAccept: true,
      ownershipIsolation: true,
      evidenceRetention: true,
      usageObservation: "realtime",
      budgetEnforcement: "bounded",
      requestBoundEvidence: "request-bound-v1",
    }),
    readEvidence: async () => Buffer.alloc(0),
    accept: async () => ({ kind: "unknown" }),
    inspect: async () => ({ kind: "unknown" }),
    requestHandoff: async (_input, request) => ({ kind: "unknown", requestId: request.requestId }),
    collect: async () => ({ events: [], candidate: null, terminal: null }),
  };
}

describe("trusted execution profiles", () => {
  it("changes profileHash when any resolved execution byte changes", () => {
    const a = resolveProfile(snapshot({ adapterImplementationHash: hash("a") }), port(unavailableCapabilities));
    const b = resolveProfile(snapshot({ adapterImplementationHash: hash("b") }), port(unavailableCapabilities));
    expect(a.profileHash).not.toBe(b.profileHash);
  });

  it("routes only an allowlisted work kind with the exact frozen hash", () => {
    const frozen = resolveProfile(snapshot(), port(unavailableCapabilities));
    const router = createExecutionProfileRouter([frozen]);
    expect(router.resolve("task", "worker", frozen.profileHash)).toBe(frozen);
    expect(() => router.resolve("handoff", "worker", frozen.profileHash)).toThrow("profile-changed");
    expect(() => router.resolve("task", "worker", hash("0"))).toThrow("profile-changed");
    expect(() => router.resolve("task", "missing", hash("0"))).toThrow("profile-changed");
  });

  it("rejects forged router entries and refuses to probe a profile from another router", async () => {
    const frozen = resolveProfile(snapshot(), port(unavailableCapabilities));
    expect(() => createExecutionProfileRouter([{ ...frozen, profileHash: hash("0") }])).toThrow("control-profile-invalid");

    const other = resolveProfile(snapshot({ adapterImplementationHash: hash("9") }, { profileId: "other" }), port(unavailableCapabilities));
    const router = createExecutionProfileRouter([frozen]);
    await expect(router.probe(other)).rejects.toThrow("profile-changed");
  });

  it("intersects every ordered capability and keeps proof only on exact descriptor equality", () => {
    const declared = snapshot().profile.capabilities;
    const observed: ProfileCapabilityProbe = {
      usageObservation: "phase-end",
      budgetEnforcement: "soft",
      contextObservation: "phase-end",
      handoffControl: "phase-end",
      handoffExecution: "mechanical-in-run-v1",
      contextWindowTokens: 80_000,
      requestBoundProof: structuredClone(declared.requestBoundProof),
    };
    expect(intersectCapabilities(declared, observed)).toEqual({
      ...observed,
      requestBoundProof: declared.requestBoundProof,
    });

    const mismatched = structuredClone(observed);
    mismatched.requestBoundProof = { ...mismatched.requestBoundProof!, evidenceKind: "other" };
    expect(intersectCapabilities(declared, mismatched).requestBoundProof).toBeNull();
    expect(intersectCapabilities(declared, { ...observed, contextWindowTokens: null }).contextWindowTokens).toBeNull();
    expect(intersectCapabilities(declared, { ...observed, handoffExecution: "model-assisted-v1" }).handoffExecution).toBeNull();
  });

  it("degrades a failed or malformed capability probe to wholly unavailable", async () => {
    const failed = resolveProfile(snapshot(), port(async () => { throw new Error("offline"); }));
    const malformed = resolveProfile(snapshot({ adapterImplementationHash: hash("9") }, { profileId: "malformed" }), port({
      ...unavailableCapabilities,
      usageObservation: "future" as never,
    }));
    const router = createExecutionProfileRouter([failed, malformed]);

    await expect(router.probe(failed)).resolves.toMatchObject({
      observed: unavailableCapabilities,
      probeFailureCode: "control-capability-probe-failed",
    });
    await expect(router.probe(malformed)).resolves.toMatchObject({
      observed: unavailableCapabilities,
      probeFailureCode: "control-capability-probe-failed",
    });
  });

  it("rejects profiles whose context tokenizer or task output limit does not match the declaration", () => {
    expect(() => resolveProfile(snapshot({}, { contextTokenizer: null }), port(unavailableCapabilities))).toThrow("control-profile-invalid");
    expect(() => resolveProfile(snapshot({}, { workMaxOutputTokens: null }), port(unavailableCapabilities))).toThrow("control-profile-invalid");
  });

  it("keeps Codex phase-end and soft", () => {
    expect(() => resolveProfile(snapshot({}, {
      adapter: "codex",
      capabilities: { ...snapshot().profile.capabilities, budgetEnforcement: "bounded" },
    }), port(unavailableCapabilities))).toThrow("control-profile-invalid");
  });
});
