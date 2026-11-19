import { ControlError, type KnownControlErrorCode } from "./errors.js";
import { peerCode, peerFailure } from "./ccloopPort.js";
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
  /** #381: the router's legacy-hash aliases, so a holder of the profile compares a frozen hash as the router does. */
  readonly aliases?: ProfileHashAliases;
}

export interface ObservedProfile {
  readonly profile: FrozenProfile;
  readonly observed: CapabilityViewV1;
  readonly observedAt: string;
  readonly probeFailureCode: string | null;
  /** Issue #73: ccloop's stderr after its code when the probe failed with a peer exit that printed one; absent otherwise. */
  readonly probeFailureDetail?: string;
  /**
   * Agent selection spec §4.6: ccloop's answer for the selection the caller asked about -- what an import or a
   * re-estimate freezes. Null when the probe failed.
   */
  readonly resolution: AgentResolution | null;
  /**
   * Issue #124 (session 3cfc2e73): set by estimatorSlotFor when ccloop read the codex catalog and the chosen model is not
   * in it, so the estimator check names that instead of the two capability codes it implies. Absent otherwise.
   */
  readonly catalogMiss?: { model: string; listed: string[] };
}

/**
 * #381 (session 3ba26002, human ruling 6): a legacy profile hash -- the whole snapshot's, which groups, runs and estimate
 * requests froze before the binding hash below -- mapped to the binding hash of the same file, recorded at panel start
 * (profileCarryOver.ts). Frozen bodies keep their legacy hash; resolution accepts it through this map.
 */
export type ProfileHashAliases = ReadonlyMap<string, string>;
const NO_ALIASES: ProfileHashAliases = new Map();

/** The hash every profile binding froze before #381: the whole snapshot. Kept only to recognise those bindings. */
export function legacyProfileHash(snapshot: ExecutionProfileSnapshotV1): string { return sha256Canonical(snapshot); }

/**
 * #381 (session 3ba26002, human rulings 1, 4, 5): what a group, run or estimate request is bound to. The estimator
 * preflight block, the `estimator` tokenizer artifact and the secret value hashes are left out: each call reads them at
 * launch and freezes what it used in its own contract, so editing them does not refuse work already bound to the file.
 * A positive list, so a field added to the profile schema is unbound until someone decides otherwise here.
 */
export function profileBindingHash(snapshot: ExecutionProfileSnapshotV1): string {
  const { profile, resolved } = snapshot;
  return sha256Canonical({
    schema: "orca-execution-profile-binding-v1",
    profile: {
      profileId: profile.profileId,
      allowedWorkKinds: profile.allowedWorkKinds,
      contextTokenizer: profile.contextTokenizer,
      workMaxOutputTokens: profile.workMaxOutputTokens,
      capabilities: profile.capabilities,
    },
    resolved: {
      proofDocumentContentHashes: resolved.proofDocumentContentHashes,
      tokenizerArtifactHashes: resolved.tokenizerArtifactHashes.filter((entry) => entry.purpose !== "estimator"),
    },
  });
}

/**
 * #381 ruling 7: the one profile-hash comparison. Two hashes name the same binding when they are equal once each legacy
 * hash is replaced by the binding hash an alias records for it.
 */
export function sameProfileHash(left: string, right: string, aliases: ProfileHashAliases = NO_ALIASES): boolean {
  return (aliases.get(left) ?? left) === (aliases.get(right) ?? right);
}

export interface ExecutionProfileRouter {
  /** #381: the legacy-hash aliases this router resolves by (absent on a fake: none). */
  readonly aliases?: ProfileHashAliases;
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
  const readFeatures=port.readFeatures?.bind(port);
  const collectTaskResults=port.collectTaskResults?.bind(port);
  const readTaskResultEvidence=port.readTaskResultEvidence?.bind(port);
  // Issue #124 (session 3cfc2e73): the estimator check reads the installation's catalog through the profile's port.
  const listModels=port.listModels?.bind(port);
  // Tester follow-up G spec §2.1: the driver raises a running run's live ceiling through the profile's port.
  const setLiveCeiling=port.setLiveCeiling?.bind(port);
  const owned: ExecutionPort = {
    ...Object.fromEntries(["savedResultSourceEligibility","savedResultEligibility","collectSavedResultEvidence","readSavedResultEvidence","settleSavedResult","readSavedResultSettlement","settleLostWorker"].flatMap(key=>{const method=port[key as keyof ExecutionPort];return typeof method==="function"?[[key,method.bind(port)]]:[]})),
    ...(readFeatures?{readFeatures:()=>readFeatures()}:{}),
    resolveAgent: (partial) => resolveAgent(partial),
    listAgents: () => listAgents(),
    readEvidence: (ref) => readEvidence(ref),
    accept: (input) => accept(input),
    inspect: (input) => inspect(input),
    requestHandoff: (input, request) => requestHandoff(input, request),
    collect: (input, afterSeq) => collect(input, afterSeq),
    ...(collectTaskResults?{collectTaskResults:(input,afterRevision)=>collectTaskResults(input,afterRevision)}:{}),
    ...(readTaskResultEvidence?{readTaskResultEvidence:(input,manifestRef,ref)=>readTaskResultEvidence(input,manifestRef,ref)}:{}),
    ...(listModels?{listModels:(installation,refresh)=>listModels(installation,refresh)}:{}),
    ...(setLiveCeiling?{setLiveCeiling:(input,ceiling)=>setLiveCeiling(input,ceiling)}:{}),
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
    // Spec 2026-10-15 §6.3, human ruling R7: a declared null is "not declared", so the observed window is taken; an observed
    // null stays null (Orca never invents a window ccloop did not state); two numbers take the smaller.
    contextWindowTokens:
      observed.contextWindowTokens === null ? null
        : declared.contextWindowTokens === null ? observed.contextWindowTokens
          : Math.min(declared.contextWindowTokens, observed.contextWindowTokens),
    requestBoundProof: proofMatches(declared.requestBoundProof, observed.requestBoundProof)
      ? declared.requestBoundProof
      : null,
  };
}

export function resolveProfile(snapshot: ExecutionProfileSnapshotV1, port: ExecutionPort = unboundPort): FrozenProfile {
  const parsed = executionProfileSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) throw new ControlError("control-profile-invalid", parsed.error.issues[0]?.message);
  const closedSnapshot = deepFreeze(structuredClone(parsed.data));
  return Object.freeze({ snapshot: closedSnapshot, profileHash: profileBindingHash(closedSnapshot), port });
}

function probeFailureCode(error: unknown): string {
  // Spec 2026-10-15 ccloop error codes §4.3: a peer exit is stored as ccloop's own code.
  return error instanceof ControlError ? peerCode(error) : "control-capability-probe-failed";
}

export function createExecutionProfileRouter(
  profiles: readonly FrozenProfile[],
  options: { now?: () => Date; aliases?: ProfileHashAliases } = {},
): ExecutionProfileRouter {
  const aliases: ProfileHashAliases = new Map(options.aliases ?? NO_ALIASES);
  const byId = new Map<string, FrozenProfile>();
  for (const supplied of profiles) {
    const id = supplied.snapshot.profile.profileId;
    if (
      !executionProfileSnapshotSchema.safeParse(supplied.snapshot).success
      || !sameProfileHash(profileBindingHash(supplied.snapshot), supplied.profileHash)
    ) throw new ControlError("control-profile-invalid", `identity:${id}`);
    if (byId.has(id)) throw new ControlError("control-profile-invalid", `duplicate:${id}`);
    const snapshot = deepFreeze(structuredClone(supplied.snapshot));
    byId.set(id, Object.freeze({ snapshot, profileHash: supplied.profileHash, port: ownPort(supplied.port), aliases }));
  }
  const ordered = Object.freeze([...byId.values()].sort((left, right) =>
    left.snapshot.profile.profileId.localeCompare(right.snapshot.profile.profileId)));
  const now = options.now ?? (() => new Date());

  return Object.freeze({
    aliases,
    list: () => ordered,
    resolve(workKind: WebWorkKindV1, profileId: string, expectedHash: string): FrozenProfile {
      const profile = byId.get(profileId);
      if (!profile || !sameProfileHash(expectedHash, profile.profileHash, aliases) || !profile.snapshot.profile.allowedWorkKinds.includes(workKind)) {
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
        const detail = peerFailure(error)?.detail ?? "";
        return Object.freeze({
          profile,
          observed: unavailableCapabilities,
          observedAt: now().toISOString(),
          probeFailureCode: probeFailureCode(error),
          ...(detail === "" ? {} : { probeFailureDetail: detail }),
          resolution: null,
        });
      }
    },
  });
}
