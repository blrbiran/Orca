import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { dimensions, zero } from "./commands.js";
import { ControlError } from "./errors.js";
import { intersectCapabilities, type FrozenProfile, type ObservedProfile } from "./profiles.js";
import { amountSchema } from "./schema.js";
import type { ControlStore } from "./store.js";
import { writeCanonicalRecord } from "./snapshot.js";
import type { Amount } from "./types.js";
import { budgetEstimateRequestSchema, budgetEstimateSchema, controlPlanSchema, estimateExecutionContractSchema,
  type AmountProvenanceV1, type BudgetEstimateRequestV1, type BudgetEstimateV1, type EstimateExecutionContractV1 } from "./webProtocol.js";

export const TASK_WORK: Amount = Object.freeze({ tokens: 3_000_000, activeMs: 14_400_000, attempts: 3, sessions: 3 });
export const TASK_HANDOFF: Amount = Object.freeze({ tokens: 300_000, activeMs: 1_800_000, attempts: 0, sessions: 0 });
export const GOAL_REVIEW: Amount = Object.freeze({ tokens: 1_000_000, activeMs: 3_600_000, attempts: 1, sessions: 1 });
export const ESTIMATE_GRANT: Amount = Object.freeze({ tokens: 250_000, activeMs: 900_000, attempts: 1, sessions: 1 });
export const safeNumber = (value: bigint): number => {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ControlError("numeric-overflow");
  return Number(value);
};
export function sumAmounts(values: readonly Amount[]): Amount {
  for (const value of values) amountSchema.parse(value);
  const result = zero();
  for (const d of dimensions) result[d] = safeNumber(values.reduce((sum, v) => sum + BigInt(v[d]), 0n));
  return result;
}
export function residual(limit: Amount, used: Amount, committed: Amount): Amount {
  [limit, used, committed].forEach(value => amountSchema.parse(value));
  const result = zero();
  for (const d of dimensions) {
    const value = BigInt(limit[d]) - BigInt(used[d]) - BigInt(committed[d]);
    if (value < 0n) throw new ControlError("group-budget-unavailable");
    result[d] = safeNumber(value);
  }
  return result;
}
export function provenance(kind: "complex-1m-default" | "system"): AmountProvenanceV1 {
  return Object.fromEntries(dimensions.map(d => [d, { provenance: kind, estimateId: null }])) as AmountProvenanceV1;
}
export interface DefaultLedger { base: Amount; reserve: Amount; limit: Amount }
export function complex1mDefaults(taskCount: number): DefaultLedger {
  if (!Number.isSafeInteger(taskCount) || taskCount < 0) throw new ControlError("numeric-overflow");
  const base = zero(), reserve = zero(), limit = zero();
  for (const d of dimensions) {
    const total = BigInt(taskCount) * (BigInt(TASK_WORK[d]) + BigInt(TASK_HANDOFF[d])) + BigInt(GOAL_REVIEW[d]) + BigInt(ESTIMATE_GRANT[d]);
    const extra = (total * 20n + 99n) / 100n;
    base[d] = safeNumber(total); reserve[d] = safeNumber(extra); limit[d] = safeNumber(total + extra);
  }
  return { base, reserve, limit };
}
export interface EstimateInput {
  planHash: string; planCanonicalJson: string; profile: FrozenProfile;
  observation: Pick<ObservedProfile, "profile" | "observed" | "probeFailureCode">;
  mode: "strict" | "soft";
  exactTokenCount?: (profile: FrozenProfile, bytes: Buffer) => number;
}
export interface FrozenEstimateRequest {
  state: "queued" | "blocked-capability" | "input-too-large"; reasonCode: string | null;
  requestHash: string | null; request: BudgetEstimateRequestV1 | null;
  contract: EstimateExecutionContractV1 | null; contractHash: string | null;
  inputTokens: number | null; requiredRequestTokens: number | null;
}
export function buildBudgetEstimateRequest(input: EstimateInput): FrozenEstimateRequest {
  const { profile, observation } = input;
  if (observation.profile.profileHash !== profile.profileHash) throw new ControlError("profile-changed");
  const plan = controlPlanSchema.parse(JSON.parse(input.planCanonicalJson));
  if (canonicalBytes(plan).toString("utf8") !== input.planCanonicalJson || sha256Canonical(plan) !== input.planHash) throw new ControlError("recovery-blocked");
  const observed = intersectCapabilities(profile.snapshot.profile.capabilities, observation.observed);
  const preflight = profile.snapshot.profile.estimatorPreflight;
  const blocked: FrozenEstimateRequest = { state: "blocked-capability", reasonCode: "estimate-blocked-capability", requestHash: null, request: null, contract: null, contractHash: null, inputTokens: null, requiredRequestTokens: null };
  // Active time, attempts and sessions are bounded by the accounted claim path.
  if (observation.probeFailureCode !== null || !preflight || observed.contextWindowTokens === null || observed.handoffControl !== "durable" || observed.handoffExecution === null
    || observed.usageObservation === "unavailable" || observed.budgetEnforcement === "unavailable"
    || (input.mode === "strict" && (observed.budgetEnforcement !== "bounded" || !observed.requestBoundProof?.workDimensions.includes("tokens")))) return blocked;
  const request = budgetEstimateRequestSchema.parse({ schema: "budget-estimate-request-v1", planHash: input.planHash,
    planSnapshotCanonicalJson: input.planCanonicalJson, estimatorProfile: { profileId: profile.snapshot.profile.profileId, profileHash: profile.profileHash },
    estimatorCapabilities: { contextWindowTokens: observed.contextWindowTokens, usageObservation: observed.usageObservation, budgetEnforcement: observed.budgetEnforcement, contextObservation: observed.contextObservation },
    responseSchemaVersion: preflight.schemaVersion, instructionVersion: preflight.instructionVersion });
  const bytes = canonicalBytes(request), requestHash = sha256Canonical(request);
  let serialized: bigint;
  if (preflight.tokenizer.kind === "exact") {
    if (!input.exactTokenCount) return { ...blocked, request, requestHash };
    const count = input.exactTokenCount(profile, bytes);
    if (!Number.isSafeInteger(count) || count < 0) throw new ControlError("numeric-overflow");
    serialized = BigInt(count);
  } else {
    const { numerator, denominator } = preflight.tokenizer;
    serialized = (BigInt(bytes.length) * BigInt(numerator) + BigInt(denominator) - 1n) / BigInt(denominator);
  }
  const inputTokens = safeNumber(serialized + BigInt(preflight.framingTokenOverhead));
  const requiredRequestTokens = safeNumber(BigInt(inputTokens) + BigInt(preflight.maxOutputTokens));
  const contract = estimateExecutionContractSchema.parse({ schema: "orca-estimate-execution-contract-v1", requestHash, grant: ESTIMATE_GRANT,
    profile: request.estimatorProfile, estimatorCapabilities: request.estimatorCapabilities, instructionVersion: preflight.instructionVersion,
    responseSchemaVersion: preflight.schemaVersion, tokenizer: preflight.tokenizer, framingTokenOverhead: preflight.framingTokenOverhead, maxOutputTokens: preflight.maxOutputTokens });
  const tooLarge = requiredRequestTokens > observed.contextWindowTokens || requiredRequestTokens > ESTIMATE_GRANT.tokens;
  return { state: tooLarge ? "input-too-large" : "queued", reasonCode: tooLarge ? "estimate-input-too-large" : null,
    request, requestHash, contract, contractHash: sha256Canonical(contract), inputTokens, requiredRequestTokens };
}
export function estimateCapabilityDegraded(request: BudgetEstimateRequestV1, observation: Pick<ObservedProfile, "profile" | "observed" | "probeFailureCode">, mode: "strict" | "soft" = "strict"): boolean {
  if (observation.profile.profileHash !== request.estimatorProfile.profileHash) throw new ControlError("profile-changed");
  const current = intersectCapabilities(observation.profile.snapshot.profile.capabilities, observation.observed), frozen = request.estimatorCapabilities;
  const order = ["unavailable", "phase-end", "realtime"], budgetOrder = ["unavailable", "soft", "bounded"];
  return observation.probeFailureCode !== null || current.contextWindowTokens === null || current.contextWindowTokens < frozen.contextWindowTokens
    || order.indexOf(current.usageObservation) < order.indexOf(frozen.usageObservation)
    || order.indexOf(current.contextObservation) < order.indexOf(frozen.contextObservation)
    || budgetOrder.indexOf(current.budgetEnforcement) < budgetOrder.indexOf(frozen.budgetEnforcement)
    || current.handoffControl !== "durable" || current.handoffExecution === null
    || (mode === "strict" && !current.requestBoundProof?.workDimensions.includes("tokens"));
}
export function validateEstimateOutput(value: unknown, planHash: string, taskIds: string[]): BudgetEstimateV1 {
  const parsed = budgetEstimateSchema.safeParse(value);
  if (!parsed.success || parsed.data.planHash !== planHash || parsed.data.tasks.map(task => task.taskId).join("\0") !== taskIds.join("\0")) throw new ControlError("plan-version-conflict", "invalid-estimate-output");
  return parsed.data;
}

export function persistEstimateArtifacts(store: ControlStore, groupId: string, estimateId: string, prepared: FrozenEstimateRequest): void {
  if (prepared.request && prepared.requestHash) writeCanonicalRecord(store, groupId, prepared.requestHash, canonicalBytes(prepared.request).toString("utf8"));
  if (prepared.contract && prepared.contractHash) {
    writeCanonicalRecord(store, groupId, prepared.contractHash, canonicalBytes(prepared.contract).toString("utf8"));
    store.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?,'estimate-contract',?,1)").run(`estimate-contract:${groupId}:${estimateId}`, canonicalBytes({ groupId, estimateId, requestHash: prepared.requestHash, contractHash: prepared.contractHash }).toString("utf8"));
  }
}
