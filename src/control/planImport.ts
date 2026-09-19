import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { applyWebCommand, preflightWebCommand, type WebCommandContext } from "./commandLedger.js";
import { dimensions, zero } from "./commands.js";
import { ControlError } from "./errors.js";
import type { ExecutionProfileRouter, FrozenProfile, ObservedProfile } from "./profiles.js";
import type { ControlStore } from "./store.js";
import type { Amount } from "./types.js";
import {
  budgetEstimateRequestSchema,
  controlPlanSchema,
  type BudgetEstimateRequestV1,
  type CommandLookupV1,
  type CommandSuccessV1,
  type ControlPlanV1,
  type RawAuthorityCommandV1,
} from "./webProtocol.js";
import { writeCanonicalRecord } from "./snapshot.js";
import { readSchedulerControlPlanSource, type SchedulerControlPlanSource } from "../scheduler/planFile.js";
import type { TrustedControlConfig } from "../panel/controlConfig.js";

export type AllowlistedPlanSource = SchedulerControlPlanSource & { repoId: string; planId: string };
export type ImportCommand = Extract<RawAuthorityCommandV1, { verb: "import-plan" }>;
export type ImportResult = CommandLookupV1["body"];

export interface ImportDefaults {
  estimatorProfileId: string;
  estimatorProfileHash: string;
  estimateMode: "strict" | "soft";
}

export interface ImportDeps {
  store: ControlStore;
  trustedConfig: Pick<TrustedControlConfig, "resolveTarget">;
  profileRouter: ExecutionProfileRouter;
  defaults: () => ImportDefaults;
  estimatorObservation: (profile: FrozenProfile) => Pick<ObservedProfile, "profile" | "observed" | "probeFailureCode">;
  exactTokenCount?: (profile: FrozenProfile, canonicalRequestBytes: Buffer) => number;
  beforeCommit?: () => void;
}

export type AsyncImportDeps = Omit<ImportDeps, "estimatorObservation">;

const TASK_WORK: Amount = Object.freeze({ tokens: 3_000_000, activeMs: 14_400_000, attempts: 3, sessions: 3 });
const TASK_HANDOFF: Amount = Object.freeze({ tokens: 300_000, activeMs: 1_800_000, attempts: 0, sessions: 0 });
const GOAL_REVIEW: Amount = Object.freeze({ tokens: 1_000_000, activeMs: 3_600_000, attempts: 1, sessions: 1 });
const ESTIMATE_GRANT: Amount = Object.freeze({ tokens: 250_000, activeMs: 900_000, attempts: 1, sessions: 1 });

function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function cloneAmount(value: Amount): Amount { return { ...value }; }
function checkedAdd(left: Amount, right: Amount): Amount {
  const result = zero();
  for (const dimension of dimensions) {
    const value = BigInt(left[dimension]) + BigInt(right[dimension]);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ControlError("numeric-overflow");
    result[dimension] = Number(value);
  }
  return result;
}
function reserve20(base: Amount): Amount {
  const result = zero();
  for (const dimension of dimensions) {
    const value = (BigInt(base[dimension]) * 20n + 99n) / 100n;
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ControlError("numeric-overflow");
    result[dimension] = Number(value);
  }
  return result;
}
function defaultProvenance() {
  const field = () => ({ provenance: "complex-1m-default" as const, estimateId: null });
  return { tokens: field(), activeMs: field(), attempts: field(), sessions: field() };
}
function systemProvenance() {
  const field = () => ({ provenance: "system" as const, estimateId: null });
  return { tokens: field(), activeMs: field(), attempts: field(), sessions: field() };
}

function reject(detail: string): never { throw new ControlError("control-plan-rejected", detail); }

export function normalizeControlPlan(source: AllowlistedPlanSource): ControlPlanV1 {
  if (source.goal.length === 0 || source.successConditions.length === 0 || new Set(source.successConditions).size !== source.successConditions.length) {
    return reject("goal-or-success-conditions");
  }
  const ids = new Set<string>();
  for (const task of source.tasks) {
    if (ids.has(task.taskId)) return reject(`duplicate-task:${task.taskId}`);
    ids.add(task.taskId);
  }
  for (const task of source.tasks) {
    if (new Set(task.dependencyTaskIds).size !== task.dependencyTaskIds.length) return reject(`duplicate-dependency:${task.taskId}`);
    if (task.dependencyTaskIds.some(id => !ids.has(id))) return reject(`dangling-dependency:${task.taskId}`);
    let parsed: unknown;
    try { parsed = JSON.parse(task.originalContractCanonicalJson); }
    catch { return reject(`contract-json:${task.taskId}`); }
    const canonical = canonicalBytes(parsed).toString("utf8");
    if (canonical !== task.originalContractCanonicalJson || sha256Canonical(parsed) !== task.originalContractHash) {
      return reject(`contract-hash:${task.taskId}`);
    }
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const byId = new Map(source.tasks.map(task => [task.taskId, task]));
  const visit = (id: string): void => {
    if (visiting.has(id)) return reject("graph-cycle");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)!.dependencyTaskIds) visit(dependency);
    visiting.delete(id); visited.add(id);
  };
  for (const id of ids) visit(id);
  const candidate = {
    schema: "orca-control-plan-v1" as const,
    repoId: source.repoId,
    planId: source.planId,
    goal: source.goal,
    successConditions: [...source.successConditions],
    tasks: source.tasks.map(task => ({
      taskId: task.taskId,
      dependencyTaskIds: [...task.dependencyTaskIds].sort(compare),
      targetVersion: task.targetVersion,
      configHash: task.configHash,
      originalContractHash: task.originalContractHash,
      originalContractCanonicalJson: task.originalContractCanonicalJson,
    })).sort((left, right) => compare(left.taskId, right.taskId)),
  };
  const parsed = controlPlanSchema.safeParse(candidate);
  if (!parsed.success) return reject(parsed.error.issues[0]?.message ?? "normalized-plan");
  return parsed.data;
}

type EstimateState = "queued" | "blocked-capability" | "input-too-large";
interface EstimatePreflight { state: EstimateState; reasonCode: string | null; requestHash: string | null; request: BudgetEstimateRequestV1 | null }

function preflightEstimate(
  deps: ImportDeps,
  planHash: string,
  planCanonicalJson: string,
  profile: FrozenProfile,
  mode: "strict" | "soft",
): EstimatePreflight {
  const observation = deps.estimatorObservation(profile);
  if (observation.profile !== profile || observation.profile.profileHash !== profile.profileHash) throw new ControlError("profile-changed");
  const observed = observation.observed;
  const preflight = profile.snapshot.profile.estimatorPreflight;
  if (observation.probeFailureCode !== null || !preflight || observed.contextWindowTokens === null || observed.handoffControl !== "durable"
    || observed.usageObservation === "unavailable" || observed.budgetEnforcement === "unavailable"
    || observed.handoffExecution === null
    || (mode === "strict" && (observed.budgetEnforcement !== "bounded"
      || !observed.requestBoundProof || !dimensions.every(dimension => observed.requestBoundProof!.workDimensions.includes(dimension))))) {
    return { state: "blocked-capability", reasonCode: "estimate-blocked-capability", requestHash: null, request: null };
  }
  const request = budgetEstimateRequestSchema.parse({
    schema: "budget-estimate-request-v1",
    planHash,
    planSnapshotCanonicalJson: planCanonicalJson,
    estimatorProfile: { profileId: profile.snapshot.profile.profileId, profileHash: profile.profileHash },
    estimatorCapabilities: {
      contextWindowTokens: observed.contextWindowTokens,
      usageObservation: observed.usageObservation,
      budgetEnforcement: observed.budgetEnforcement,
      contextObservation: observed.contextObservation,
    },
    responseSchemaVersion: "budget-estimate-v1",
    instructionVersion: preflight.instructionVersion,
  });
  const bytes = canonicalBytes(request);
  let serializedInputTokens: number;
  if (preflight.tokenizer.kind === "exact") {
    if (!deps.exactTokenCount) return { state: "blocked-capability", reasonCode: "estimate-blocked-capability", requestHash: sha256Canonical(request), request };
    serializedInputTokens = deps.exactTokenCount(profile, bytes);
  } else {
    const numerator = BigInt(preflight.tokenizer.numerator);
    const denominator = BigInt(preflight.tokenizer.denominator);
    const count = (BigInt(bytes.length) * numerator + denominator - 1n) / denominator;
    if (count > BigInt(Number.MAX_SAFE_INTEGER)) throw new ControlError("numeric-overflow");
    serializedInputTokens = Number(count);
  }
  if (!Number.isSafeInteger(serializedInputTokens) || serializedInputTokens < 0) throw new ControlError("numeric-overflow");
  const requiredBig = BigInt(serializedInputTokens) + BigInt(preflight.framingTokenOverhead) + BigInt(preflight.maxOutputTokens);
  if (requiredBig > BigInt(Number.MAX_SAFE_INTEGER)) throw new ControlError("numeric-overflow");
  const required = Number(requiredBig);
  if (required > observed.contextWindowTokens || required > ESTIMATE_GRANT.tokens) {
    return { state: "input-too-large", reasonCode: "estimate-input-too-large", requestHash: sha256Canonical(request), request };
  }
  return { state: "queued", reasonCode: null, requestHash: sha256Canonical(request), request };
}

function success(context: WebCommandContext, groupId: string, estimateId: string, state: EstimateState, reasonCode: string | null): { status: number; body: CommandSuccessV1 } {
  return {
    status: 201,
    body: {
      schema: "orca-command-success-v1",
      commandId: context.rawCommand.commandId,
      actorId: context.rawCommand.actorId,
      verb: "import-plan",
      target: context.rawCommand.target,
      commandRevision: context.nextCommandRevision,
      projectionSeq: context.nextProjectionSeq,
      effectivePayloadHash: context.effectivePayloadHash,
      authorityCommandHash: context.authorityCommandHash,
      result: { kind: "imported", groupId, estimateId, estimateState: state, estimateReasonCode: reasonCode },
    },
  };
}

export function importControlPlan(deps: ImportDeps, command: ImportCommand): ImportResult {
  const outcome = applyWebCommand<CommandSuccessV1>(deps.store, {
    rawCommand: command,
    expand: () => {
      const payload = command.payload;
      const defaults = deps.defaults();
      const estimatorProfileId = payload.estimatorProfileId ?? defaults.estimatorProfileId;
      const estimatorProfileHash = payload.estimatorProfileHash ?? defaults.estimatorProfileHash;
      const estimateMode = payload.estimateMode ?? defaults.estimateMode;
      deps.profileRouter.resolve("budget-estimate", estimatorProfileId, estimatorProfileHash);
      return { ...command, schema: "orca-authority-command-v1", payload: { ...payload, estimatorProfileId, estimatorProfileHash, estimateMode } };
    },
    apply: context => {
      const payload = context.effectiveCommand.payload as ImportDefaults & { groupId: string; repoId: string; planId: string };
      const target = deps.trustedConfig.resolveTarget({ repoId: payload.repoId, planId: payload.planId });
      const source = readSchedulerControlPlanSource(target);
      const plan = normalizeControlPlan({ ...source, repoId: payload.repoId, planId: payload.planId });
      const planCanonicalJson = canonicalBytes(plan).toString("utf8");
      const planHash = sha256Canonical(plan);
      const estimatorProfile = deps.profileRouter.resolve("budget-estimate", payload.estimatorProfileId, payload.estimatorProfileHash);
      const preflight = preflightEstimate(deps, planHash, planCanonicalJson, estimatorProfile, payload.estimateMode);
      const estimateId = `estimate-${sha256Canonical({ groupId: payload.groupId, planHash, version: 1 }).slice(0, 24)}`;
      const taskAllocations = plan.tasks.flatMap(task => [
        { ownerKind: "task", ownerId: task.taskId, bucket: "work", state: "draft-encumbered", amount: cloneAmount(TASK_WORK), fieldProvenance: defaultProvenance() },
        { ownerKind: "task", ownerId: task.taskId, bucket: "handoff", state: "draft-encumbered", amount: cloneAmount(TASK_HANDOFF), fieldProvenance: defaultProvenance() },
      ]);
      let base = checkedAdd(ESTIMATE_GRANT, GOAL_REVIEW);
      for (const _task of plan.tasks) base = checkedAdd(base, checkedAdd(TASK_WORK, TASK_HANDOFF));
      const initialReserve = reserve20(base);
      const explicitUnallocatedReserve = preflight.state === "queued" ? initialReserve : checkedAdd(initialReserve, ESTIMATE_GRANT);
      const groupLimit = checkedAdd(base, initialReserve);
      let committedRemaining = checkedAdd(GOAL_REVIEW, zero());
      for (const _task of plan.tasks) committedRemaining = checkedAdd(committedRemaining, checkedAdd(TASK_WORK, TASK_HANDOFF));
      if (preflight.state === "queued") committedRemaining = checkedAdd(committedRemaining, ESTIMATE_GRANT);
      const allocations = [
        ...taskAllocations,
        { ownerKind: "goal-review", ownerId: `${payload.groupId}:goal-review`, bucket: "review", state: "draft-encumbered", amount: cloneAmount(GOAL_REVIEW), fieldProvenance: defaultProvenance() },
        { ownerKind: "reserve", ownerId: `${payload.groupId}:reserve`, bucket: "reserve", state: "draft-encumbered", amount: explicitUnallocatedReserve, fieldProvenance: systemProvenance() },
      ].sort((left, right) => compare(`${left.ownerKind}\0${left.ownerId}\0${left.bucket}`, `${right.ownerKind}\0${right.ownerId}\0${right.bucket}`));
      const group = {
        groupId: payload.groupId, projectKey: payload.repoId, goal: plan.goal, successConditions: plan.successConditions,
        budgetMode: payload.estimateMode, limit: groupLimit, reviewReserve: cloneAmount(GOAL_REVIEW), deadlineAt: null,
        revision: 0, commandRevision: 0, graphVersion: 1, stopped: false, status: "draft", used: zero(), reserved: committedRemaining,
        reviewRemaining: cloneAmount(GOAL_REVIEW), budgetVersion: 1, planHash,
        plan: { repoId: payload.repoId, planId: payload.planId, planHash, goal: plan.goal, successConditions: plan.successConditions },
        proposal: { state: "editable", proposalVersion: 1, planHash, budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
        ledger: { groupLimit, used: zero(), committedRemaining, explicitUnallocatedReserve, budgetDeficit: zero(), usageUnknown: false },
        importDefaults: { estimatorProfileId: payload.estimatorProfileId, estimatorProfileHash: payload.estimatorProfileHash, estimateMode: payload.estimateMode },
      };
      deps.store.db.prepare("INSERT INTO groups(id,revision,graph_version,projection_seq,body) VALUES (?,?,?,0,?)")
        .run(payload.groupId, 0, 1, JSON.stringify(group));
      writeCanonicalRecord(deps.store, payload.groupId, planHash, planCanonicalJson);
      for (const task of plan.tasks) {
        writeCanonicalRecord(deps.store, payload.groupId, task.originalContractHash, task.originalContractCanonicalJson);
        const work = {
          workItemId: task.taskId, taskId: task.taskId, kind: "task", dependsOn: task.dependencyTaskIds,
          contract: { contentAddressedHash: task.originalContractHash }, configHash: task.configHash,
          grant: { work: cloneAmount(TASK_WORK), handoff: cloneAmount(TASK_HANDOFF) }, targetVersion: task.targetVersion,
          status: "draft", originalContractHash: task.originalContractHash, derivedContractHash: null,
        };
        deps.store.db.prepare("INSERT INTO work_items(group_id,id,target_version,body) VALUES (?,?,1,?)")
          .run(payload.groupId, task.taskId, JSON.stringify(work));
      }
      const proposal = {
        proposalVersion: 1, state: "editable", planHash, groupLimit, explicitUnallocatedReserve,
        allocations, budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null,
      };
      deps.store.db.prepare("INSERT INTO budget_proposals(group_id,proposal_version,body) VALUES (?,?,?)")
        .run(payload.groupId, 1, canonicalBytes(proposal).toString("utf8"));
      const estimate = {
        estimateId, estimateVersion: 1, state: preflight.state,
        profile: { profileId: payload.estimatorProfileId, profileHash: payload.estimatorProfileHash }, mode: payload.estimateMode,
        requestHash: preflight.requestHash, request: preflight.request, outputHash: null, output: null, reasonCode: preflight.reasonCode,
        grant: cloneAmount(ESTIMATE_GRANT),
      };
      deps.store.db.prepare("INSERT INTO estimates(group_id,id,estimate_version,state,body) VALUES (?,?,?,?,?)")
        .run(payload.groupId, estimateId, 1, preflight.state, canonicalBytes(estimate).toString("utf8"));
      if (preflight.state === "queued") {
        const wakeId = `scheduler-wake:${payload.groupId}:estimate:${estimateId}`;
        deps.store.db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES (?,?, 'budget-estimate', ?, 0)")
          .run(wakeId, payload.groupId, JSON.stringify({ groupId: payload.groupId, estimateId, planHash }));
      }
      deps.beforeCommit?.();
      return success(context, payload.groupId, estimateId, preflight.state, preflight.reasonCode);
    },
  });
  return outcome.body;
}

function persistAsyncPreparationFailure(store: ControlStore, command: ImportCommand, failure: unknown): ImportResult {
  const outcome = applyWebCommand<CommandSuccessV1>(store, {
    rawCommand: command,
    expand: () => { throw failure; },
    apply: () => { throw failure; },
  });
  return outcome.body;
}

/**
 * Production orchestration for import's asynchronous capability probe. Durable
 * identity/CAS preflight happens before dynamic defaults or I/O; applyWebCommand
 * repeats both checks after the await to close concurrent commit races.
 */
export async function importControlPlanAsync(deps: AsyncImportDeps, command: ImportCommand): Promise<ImportResult> {
  const preflight = preflightWebCommand(deps.store, command);
  if (preflight) return preflight.body;

  let frozenDefaults: ImportDefaults;
  let profile: FrozenProfile;
  let observation: ObservedProfile;
  try {
    const raw = command.payload;
    const currentDefaults = deps.defaults();
    frozenDefaults = {
      estimatorProfileId: raw.estimatorProfileId ?? currentDefaults.estimatorProfileId,
      estimatorProfileHash: raw.estimatorProfileHash ?? currentDefaults.estimatorProfileHash,
      estimateMode: raw.estimateMode ?? currentDefaults.estimateMode,
    };
    profile = deps.profileRouter.resolve("budget-estimate", frozenDefaults.estimatorProfileId, frozenDefaults.estimatorProfileHash);
    observation = await deps.profileRouter.probe(profile);
  } catch (error) {
    return persistAsyncPreparationFailure(deps.store, command, error);
  }
  return importControlPlan({
    ...deps,
    defaults: () => frozenDefaults,
    estimatorObservation: selected => {
      if (selected !== profile) throw new ControlError("profile-changed");
      return observation;
    },
  }, command);
}
