import { describe, expect, it } from "vitest";
// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): adapted to the agent selection wire -- the ExecutionPort surface is resolveAgent/listAgents, claims and work items carry a frozen `agent`, envelopes are protocol 2, the reconcile table is `agentsTablePath`; what the criterion encodes is unchanged.
import type { ExecutionPort } from "../../src/control/executionPort.js";
import type { PartialSelection } from "../../src/control/agentSelection.js";
import {
  createExecutionProfileRouter,
  intersectCapabilities,
  resolveProfile,
  unavailableCapabilities,
} from "../../src/control/profiles.js";
// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): adapted to the agent selection wire -- the ExecutionPort surface is resolveAgent/listAgents, claims and work items carry a frozen `agent`, envelopes are protocol 2, the reconcile table is `agentsTablePath`; what the criterion encodes is unchanged.
import type { CapabilityViewV1, ExecutionProfileSnapshotV1 } from "../../src/control/webProtocol.js";

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

// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the probe is a
// resolution of the selection asked about (capabilities protocol 3); `asked` records every selection it was given.
const asked: PartialSelection[] = [];
function port(probe: CapabilityViewV1 | (() => Promise<CapabilityViewV1>)): ExecutionPort {
  const result = typeof probe === "function" ? probe : async () => probe;
  return {
    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): adapted to the agent selection wire -- the ExecutionPort surface is resolveAgent/listAgents, claims and work items carry a frozen `agent`, envelopes are protocol 2, the reconcile table is `agentsTablePath`; what the criterion encodes is unchanged.
    resolveAgent: async (partial) => {
      asked.push(partial);
      return { selection: { agent: "codex", model: "fixture-model", contextWindow: "agent-default", ...partial }, configHash: hash("c"), timeoutMs: 1, killGraceMs: 0, capabilities: await result() };
    },
    listAgents: async () => ({ installations: [{ id: "codex", kind: "codex", defaults: { model: "fixture-model", contextWindow: "agent-default" as const }, contextOptions: ["agent-default" as const], version: "0.0.0-fixture" }] }),
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
    const owned = router.resolve("task", "worker", frozen.profileHash);
    expect(owned.profileHash).toBe(frozen.profileHash);
    expect(owned).not.toBe(frozen);
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

  it("owns immutable snapshot and port method bindings after construction", async () => {
    let first = 0;
    const mutablePort = port(async () => { first += 1; return unavailableCapabilities; });
    const frozen = resolveProfile(snapshot(), mutablePort);
    const router = createExecutionProfileRouter([frozen]);
    const owned = router.resolve("task", "worker", frozen.profileHash);
    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): adapted to the agent selection wire -- the ExecutionPort surface is resolveAgent/listAgents, claims and work items carry a frozen `agent`, envelopes are protocol 2, the reconcile table is `agentsTablePath`; what the criterion encodes is unchanged.
    mutablePort.resolveAgent = async () => { throw new Error("the replaced method was called"); };
    mutablePort.accept = async () => ({ kind: "accepted", executionId: "mutated", configHash: hash("0") });

    await router.probe(owned);
    expect(first).toBe(1);
    await expect(owned.port.accept({} as never)).resolves.toEqual({ kind: "unknown" });
    expect(owned).not.toBe(frozen);
  });

  it("preserves the original receiver for captured port methods", async () => {
    class ReceiverPort implements ExecutionPort {
      #accepts = 0;
      // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the two capability
      // methods are the resolution and the table view now; unused by this criterion's assertions.
      resolveAgent = async () => ({ selection: { agent: "codex", model: "m", contextWindow: "agent-default" as const }, configHash: hash("c"), timeoutMs: 1, killGraceMs: 0, capabilities: snapshot().profile.capabilities });
      listAgents = async () => ({ installations: [] });
      readEvidence = async () => Buffer.alloc(0);
      async accept() { this.#accepts += 1; return { kind: "accepted" as const, executionId: `receiver-${this.#accepts}`, configHash: hash("a") }; }
      inspect = async () => ({ kind: "unknown" as const });
      requestHandoff = async (_input: never, request: { requestId: string }) => ({ kind: "unknown" as const, requestId: request.requestId });
      collect = async () => ({ events: [], candidate: null, terminal: null });
    }
    const supplied = new ReceiverPort();
    const frozen = resolveProfile(snapshot(), supplied);
    const router = createExecutionProfileRouter([frozen]);
    const owned = router.resolve("task", "worker", frozen.profileHash);
    const mutable: ExecutionPort = supplied;
    mutable.accept = async () => ({ kind: "unknown" });

    await expect(owned.port.accept({} as never)).resolves.toMatchObject({ kind: "accepted", executionId: "receiver-1" });
  });

  it("intersects every ordered capability and keeps proof only on exact descriptor equality", () => {
    const declared = snapshot().profile.capabilities;
    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): adapted to the agent selection wire -- the ExecutionPort surface is resolveAgent/listAgents, claims and work items carry a frozen `agent`, envelopes are protocol 2, the reconcile table is `agentsTablePath`; what the criterion encodes is unchanged.
    const observed: CapabilityViewV1 = {
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

    await expect(router.probe(router.resolve("task", "worker", failed.profileHash))).resolves.toMatchObject({
      observed: unavailableCapabilities,
      probeFailureCode: "control-capability-probe-failed",
    });
    await expect(router.probe(router.resolve("task", "malformed", malformed.profileHash))).resolves.toMatchObject({
      observed: unavailableCapabilities,
      probeFailureCode: "control-capability-probe-failed",
    });
  });

  it("probes exactly the selection it is asked about (agent selection spec §6.4)", async () => {
    const frozen = resolveProfile(snapshot(), port(snapshot().profile.capabilities));
    const router = createExecutionProfileRouter([frozen]);
    asked.length = 0;
    const observed = await router.probe(router.resolve("task", "worker", frozen.profileHash), { agent: "claude", model: "claude-opus-5-5", contextWindow: 1_000_000 });
    expect(asked).toEqual([{ agent: "claude", model: "claude-opus-5-5", contextWindow: 1_000_000 }]);
    expect(observed.probeFailureCode).toBeNull();
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
