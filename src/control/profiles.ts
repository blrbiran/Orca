import { ControlError, type KnownControlErrorCode } from "./errors.js";
import type { ExecutionPort, ProfileCapabilityProbe } from "./executionPort.js";
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
}

export interface ExecutionProfileRouter {
  resolve(workKind: WebWorkKindV1, profileId: string, expectedHash: string): FrozenProfile;
  probe(profile: FrozenProfile): Promise<ObservedProfile>;
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
  capabilities: async () => { throw new ControlError("control-protocol-unavailable"); },
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

function minimum<T extends string>(left: T, right: T, order: readonly T[]): T {
  return order[Math.min(order.indexOf(left), order.indexOf(right))];
}

function proofMatches(left: CapabilityViewV1["requestBoundProof"], right: CapabilityViewV1["requestBoundProof"]): boolean {
  return left !== null && right !== null && sha256Canonical(left) === sha256Canonical(right);
}

export function intersectCapabilities(declared: DeclaredCapabilities, observed: ProfileCapabilityProbe): CapabilityViewV1 {
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
  for (const profile of profiles) {
    const id = profile.snapshot.profile.profileId;
    if (
      !executionProfileSnapshotSchema.safeParse(profile.snapshot).success
      || sha256Canonical(profile.snapshot) !== profile.profileHash
    ) throw new ControlError("control-profile-invalid", `identity:${id}`);
    if (byId.has(id)) throw new ControlError("control-profile-invalid", `duplicate:${id}`);
    byId.set(id, profile);
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
    async probe(profile: FrozenProfile): Promise<ObservedProfile> {
      if (byId.get(profile.snapshot.profile.profileId) !== profile) throw new ControlError("profile-changed");
      try {
        if (!profile.port.probeProfileCapabilities) throw new ControlError("control-capability-probe-failed");
        const result = capabilityViewSchema.safeParse(await profile.port.probeProfileCapabilities());
        if (!result.success) throw new ControlError("control-capability-probe-failed");
        return Object.freeze({
          profile,
          observed: deepFreeze(intersectCapabilities(profile.snapshot.profile.capabilities, result.data)),
          observedAt: now().toISOString(),
          probeFailureCode: null,
        });
      } catch (error) {
        return Object.freeze({
          profile,
          observed: unavailableCapabilities,
          observedAt: now().toISOString(),
          probeFailureCode: probeFailureCode(error),
        });
      }
    },
  });
}
