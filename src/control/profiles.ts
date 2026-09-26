import { ControlError, type KnownControlErrorCode } from "./errors.js";
import type { ExecutionPort } from "./executionPort.js";
import type { AgentResolution, PartialSelection } from "./agentSelection.js";
import { sha256Canonical } from "./canonicalJson.js";
import {
  capabilityViewSchema,
  executionProfileSnapshotSchema,
  type CapabilityViewV1,
  type ExecutionProfileSnapshotV1,
  type WebWorkKindV1,
} from "./webProtocol.js";

type DeclaredCapabilities = ExecutionProfileSnapshotV1["profile"]["capabilities"];

export interface FrozenProfile {
  readonly snapshot: Readonly<ExecutionProfileSnapshotV1>;
  readonly profileHash: string;
  readonly port: ExecutionPort;
}

export interface ObservedProfile {
  readonly profile: FrozenProfile;
  readonly observed: CapabilityViewV1;
  readonly observedAt: string;
  readonly probeFailureCode: KnownControlErrorCode | null;
  /**
   * Agent selection spec §4.6: ccloop's answer for the selection the caller asked about -- what an import or a
   * re-estimate freezes. Null when the probe failed.
   */
  readonly resolution: AgentResolution | null;
}

export interface ExecutionProfileRouter {
  resolve(workKind: WebWorkKindV1, profileId: string, expectedHash: string): FrozenProfile;
  /**
   * Agent selection spec §6.4 (C3): a probe is of one selection -- the one the caller is about to dispatch, freeze
   * or show (plan T11: required; every gate passes the run's or work item's frozen one, and only the panel's profile
   * display the operator's default). A layered (partial) selection may be asked too -- ccloop fills what it leaves
   * out -- so the import and a re-estimate probe the very selection they freeze.
   */
  probe(profile: FrozenProfile, selection: PartialSelection): Promise<ObservedProfile>;
  list(): readonly FrozenProfile[];
}

export const unavailableCapabilities: CapabilityViewV1 = Object.freeze({
  usageObservation: "unavailable",
  budgetEnforcement: "unavailable",
  contextObservation: "unavailable",
  handoffControl: "unavailable",
  handoffExecution: null,
  contextWindowTokens: null,
  requestBoundProof: null,
});

const unboundPort: ExecutionPort = {
  resolveAgent: async () => { throw new ControlError("control-protocol-unavailable"); },
  listAgents: async () => { throw new ControlError("control-protocol-unavailable"); },
  readEvidence: async () => { throw new ControlError("control-protocol-unavailable"); },
  accept: async () => { throw new ControlError("control-protocol-unavailable"); },
  inspect: async () => { throw new ControlError("control-protocol-unavailable"); },
  requestHandoff: async () => { throw new ControlError("control-protocol-unavailable"); },
  collect: async () => { throw new ControlError("control-protocol-unavailable"); },
};

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function ownPort(port: ExecutionPort): ExecutionPort {
  const resolveAgent = port.resolveAgent.bind(port);
  const listAgents = port.listAgents.bind(port);
  const readEvidence = port.readEvidence.bind(port);
  const accept = port.accept.bind(port);
  const inspect = port.inspect.bind(port);
  const requestHandoff = port.requestHandoff.bind(port);
  const collect = port.collect.bind(port);
  const owned: ExecutionPort = {
    resolveAgent: (partial) => resolveAgent(partial),
    listAgents: () => listAgents(),
    readEvidence: (ref) => readEvidence(ref),
    accept: (input) => accept(input),
    inspect: (input) => inspect(input),
    requestHandoff: (input, request) => requestHandoff(input, request),
    collect: (input, afterSeq) => collect(input, afterSeq),
  };
  return Object.freeze(owned);
}

function minimum<T extends string>(left: T, right: T, order: readonly T[]): T {
  return order[Math.min(order.indexOf(left), order.indexOf(right))];
}

function proofMatches(left: CapabilityViewV1["requestBoundProof"], right: CapabilityViewV1["requestBoundProof"]): boolean {
  return left !== null && right !== null && sha256Canonical(left) === sha256Canonical(right);
}

export function intersectCapabilities(declared: DeclaredCapabilities, observed: CapabilityViewV1): CapabilityViewV1 {
  const usageOrder = ["unavailable", "phase-end", "realtime"] as const;
  const enforcementOrder = ["unavailable", "soft", "bounded"] as const;
  const handoffOrder = ["unavailable", "phase-end", "durable"] as const;
  return {
    usageObservation: minimum(declared.usageObservation, observed.usageObservation, usageOrder),
    budgetEnforcement: minimum(declared.budgetEnforcement, observed.budgetEnforcement, enforcementOrder),
    contextObservation: minimum(declared.contextObservation, observed.contextObservation, usageOrder),
    handoffControl: minimum(declared.handoffControl, observed.handoffControl, handoffOrder),
    handoffExecution: observed.handoffExecution === declared.handoffExecution ? declared.handoffExecution : null,
    contextWindowTokens:
      declared.contextWindowTokens !== null && observed.contextWindowTokens !== null
        ? Math.min(declared.contextWindowTokens, observed.contextWindowTokens)
        : null,
    requestBoundProof: proofMatches(declared.requestBoundProof, observed.requestBoundProof)
      ? declared.requestBoundProof
      : null,
  };
}

export function resolveProfile(snapshot: ExecutionProfileSnapshotV1, port: ExecutionPort = unboundPort): FrozenProfile {
  const parsed = executionProfileSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) throw new ControlError("control-profile-invalid", parsed.error.issues[0]?.message);
  const closedSnapshot = deepFreeze(structuredClone(parsed.data));
  return Object.freeze({ snapshot: closedSnapshot, profileHash: sha256Canonical(closedSnapshot), port });
}

function probeFailureCode(error: unknown): KnownControlErrorCode {
  return error instanceof ControlError ? error.code : "control-capability-probe-failed";
}

export function createExecutionProfileRouter(
  profiles: readonly FrozenProfile[],
  options: { now?: () => Date } = {},
): ExecutionProfileRouter {
  const byId = new Map<string, FrozenProfile>();
  for (const supplied of profiles) {
    const id = supplied.snapshot.profile.profileId;
    if (
      !executionProfileSnapshotSchema.safeParse(supplied.snapshot).success
      || sha256Canonical(supplied.snapshot) !== supplied.profileHash
    ) throw new ControlError("control-profile-invalid", `identity:${id}`);
    if (byId.has(id)) throw new ControlError("control-profile-invalid", `duplicate:${id}`);
    const snapshot = deepFreeze(structuredClone(supplied.snapshot));
    byId.set(id, Object.freeze({ snapshot, profileHash: supplied.profileHash, port: ownPort(supplied.port) }));
  }
  const ordered = Object.freeze([...byId.values()].sort((left, right) =>
    left.snapshot.profile.profileId.localeCompare(right.snapshot.profile.profileId)));
  const now = options.now ?? (() => new Date());

  return Object.freeze({
    list: () => ordered,
    resolve(workKind: WebWorkKindV1, profileId: string, expectedHash: string): FrozenProfile {
      const profile = byId.get(profileId);
      if (!profile || profile.profileHash !== expectedHash || !profile.snapshot.profile.allowedWorkKinds.includes(workKind)) {
        throw new ControlError("profile-changed");
      }
      return profile;
    },
    async probe(profile: FrozenProfile, selection: PartialSelection): Promise<ObservedProfile> {
      if (byId.get(profile.snapshot.profile.profileId) !== profile) throw new ControlError("profile-changed");
      try {
        const resolution = await profile.port.resolveAgent(selection);
        const result = capabilityViewSchema.safeParse(resolution.capabilities);
        if (!result.success) throw new ControlError("control-capability-probe-failed");
        return Object.freeze({
          profile,
          observed: deepFreeze(intersectCapabilities(profile.snapshot.profile.capabilities, result.data)),
          observedAt: now().toISOString(),
          probeFailureCode: null,
          resolution: deepFreeze(structuredClone({ ...resolution, capabilities: result.data })),
        });
      } catch (error) {
        return Object.freeze({
          profile,
          observed: unavailableCapabilities,
          observedAt: now().toISOString(),
          probeFailureCode: probeFailureCode(error),
          resolution: null,
        });
      }
    },
  });
}
