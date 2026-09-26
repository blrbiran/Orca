import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { applyWebCommand, preflightWebCommand, type WebCommandContext } from "./commandLedger.js";
import { dimensions, zero } from "./commands.js";
import { ControlError, type KnownControlErrorCode } from "./errors.js";
import { readAgentPreferences } from "./agentPreferences.js";
import { descriptorProvenance, resolveSelection, slotLayers, type FrozenSlot, type GroupAgentOverrides, type PartialSelection } from "./agentSelection.js";
import { unavailableCapabilities, type ExecutionProfileRouter, type FrozenProfile, type ObservedProfile } from "./profiles.js";
import type { ControlStore } from "./store.js";
import type { Amount } from "./types.js";
import {
  controlPlanSchema,
  type CommandLookupV1,
  type CommandSuccessV1,
  type ControlPlanV1,
  type RawAuthorityCommandV1,
} from "./webProtocol.js";
import { writeCanonicalRecord } from "./snapshot.js";
import { readSchedulerControlPlanSource, type SchedulerControlPlanSource } from "../scheduler/planFile.js";
import type { TrustedControlConfig } from "../panel/controlConfig.js";
import { buildBudgetEstimateRequest, persistEstimateArtifacts, TASK_WORK, TASK_HANDOFF, GOAL_REVIEW, ESTIMATE_GRANT, type FrozenEstimateRequest } from "./estimator.js";

export type AllowlistedPlanSource = SchedulerControlPlanSource & { repoId: string; planId: string };
export type ImportCommand = Extract<RawAuthorityCommandV1, { verb: "import-plan" }>;
export type ImportResult = CommandLookupV1["body"];

export interface ImportDefaults {
  estimatorProfileId: string;
  estimatorProfileHash: string;
  estimateMode: "strict" | "soft";
}

/** Agent selection spec §6.4 (§12 I9): the estimator slot, resolved before the import's transaction. */
export type EstimatorSlotOutcome =
  | { kind: "frozen"; partial: PartialSelection; slot: FrozenSlot }
  | { kind: "rejected"; partial: PartialSelection | null; code: KnownControlErrorCode };
export interface PreparedEstimatorSlot { outcome: EstimatorSlotOutcome; observation: ObservedProfile }

export interface ImportDeps {
  store: ControlStore;
  trustedConfig: Pick<TrustedControlConfig, "resolveTarget">;
  profileRouter: ExecutionProfileRouter;
  defaults: () => ImportDefaults;
  estimatorObservation: (profile: FrozenProfile) => Pick<ObservedProfile, "profile" | "observed" | "probeFailureCode">;
  estimatorSlot: EstimatorSlotOutcome;
  exactTokenCount?: (profile: FrozenProfile, canonicalRequestBytes: Buffer) => number;
  beforeCommit?: () => void;
}

export type AsyncImportDeps = Omit<ImportDeps, "estimatorObservation" | "estimatorSlot">;

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
    ...(source.agent ? { agent: source.agent } : {}),
    ...(source.reconcileAgent ? { reconcileAgent: source.reconcileAgent } : {}),
    tasks: source.tasks.map(task => ({
      taskId: task.taskId,
      dependencyTaskIds: [...task.dependencyTaskIds].sort(compare),
      targetVersion: task.targetVersion,
      ...(task.agent ? { agent: task.agent } : {}),
      originalContractHash: task.originalContractHash,
      originalContractCanonicalJson: task.originalContractCanonicalJson,
    })).sort((left, right) => compare(left.taskId, right.taskId)),
  };
  const parsed = controlPlanSchema.safeParse(candidate);
  if (!parsed.success) return reject(parsed.error.issues[0]?.message ?? "normalized-plan");
  return parsed.data;
}

/** The plan's group layers, as the group's initial agentOverrides (W6-20: one layer, no plan/panel split). */
export function planGroupLayer(plan: ControlPlanV1): GroupAgentOverrides {
  return {
    ...(plan.agent ? { worker: plan.agent } : {}),
    ...(plan.reconcileAgent ? { reconcile: plan.reconcileAgent } : {}),
  };
}

/** Spec §6.4 / §7: an estimator selection that failed is a blocked estimate named after the failure. */
const ESTIMATOR_REJECTED_PREFIX = "agent-selection-rejected:estimator:";
export function rejectedEstimatorRequest(code: KnownControlErrorCode): FrozenEstimateRequest {
  return { state: "blocked-capability", reasonCode: `${ESTIMATOR_REJECTED_PREFIX}${code}`, requestHash: null, request: null, contract: null, contractHash: null, inputTokens: null, requiredRequestTokens: null };
}

/** The estimator slot's layered partial as the store has it now; null when no layer names an agent. */
function currentEstimatorPartial(store: ControlStore, operatorId: string, group: GroupAgentOverrides): PartialSelection | null {
  const prefs = readAgentPreferences(store, operatorId).preferences;
  try { return resolveSelection(slotLayers("estimator", prefs, group), prefs.perAgent).partial; }
  catch (error) {
    if (error instanceof ControlError && error.code === "agent-unselected") return null;
    throw error;
  }
}

/**
 * Spec §6.3 estimator layers, then ccloop's answer through the router (spec §6.4 last paragraph: the probe is of
 * the selection). A failed selection is an outcome, not a throw: the estimate degrades instead (§12 I9). Nothing
 * is awaited before the probe, so a racing command is still rechecked after it (planImport.test.ts).
 */
export async function estimatorSlotFor(
  deps: { store: ControlStore; profileRouter: ExecutionProfileRouter },
  operatorId: string,
  group: GroupAgentOverrides,
  profile: FrozenProfile,
): Promise<PreparedEstimatorSlot> {
  const prefs = readAgentPreferences(deps.store, operatorId).preferences;
  let resolved: ReturnType<typeof resolveSelection>;
  try { resolved = resolveSelection(slotLayers("estimator", prefs, group), prefs.perAgent); }
  catch (error) {
    if (!(error instanceof ControlError) || error.code !== "agent-unselected") throw error;
    return {
      outcome: { kind: "rejected", partial: null, code: "agent-unselected" },
      observation: { profile, observed: unavailableCapabilities, observedAt: new Date().toISOString(), probeFailureCode: "agent-unselected", resolution: null },
    };
  }
  const { partial, provenance } = resolved;
  const observation = await deps.profileRouter.probe(profile, partial);
  if (observation.probeFailureCode !== null || observation.resolution === null) {
    return { outcome: { kind: "rejected", partial, code: observation.probeFailureCode ?? "control-capability-probe-failed" }, observation };
  }
  try {
    const labelled = descriptorProvenance(partial, observation.resolution.selection, provenance);
    return { outcome: { kind: "frozen", partial, slot: { ...structuredClone(observation.resolution), partial, provenance: labelled } }, observation };
  } catch (error) {
    if (!(error instanceof ControlError)) throw error;
    return { outcome: { kind: "rejected", partial, code: error.code }, observation: { ...observation, observed: unavailableCapabilities, probeFailureCode: error.code, resolution: null } };
  }
}

/**
 * The asynchronous importer's preparation. Controller ruling R7 (W5-M16): the import-time slot is resolved from the
 * importing operator's layers only, so preparing it reads no plan source before the probe; a group estimator layer
 * comes from the panel and takes effect on re-estimate.
 */
export async function prepareEstimatorSlot(
  deps: { store: ControlStore; profileRouter: ExecutionProfileRouter },
  command: ImportCommand,
  profile: FrozenProfile,
): Promise<PreparedEstimatorSlot> {
  return estimatorSlotFor(deps, command.actorId, {}, profile);
}

type EstimateState = "queued" | "blocked-capability" | "input-too-large";

function preflightEstimate(
  deps: ImportDeps,
  planHash: string,
  planCanonicalJson: string,
  profile: FrozenProfile,
  mode: "strict" | "soft",
): FrozenEstimateRequest {
  return buildBudgetEstimateRequest({ planHash, planCanonicalJson, profile, mode,
    observation: deps.estimatorObservation(profile), exactTokenCount: deps.exactTokenCount });
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
      // Spec §6.4 (frozen = seen): the operator layers the estimator slot was resolved from must be the layers now.
      const partialNow = currentEstimatorPartial(deps.store, context.rawCommand.actorId, {});
      if (!canonicalBytes(partialNow).equals(canonicalBytes(deps.estimatorSlot.partial))) throw new ControlError("plan-version-conflict", "estimator-selection-changed");
      const estimatorSlot = deps.estimatorSlot.kind === "frozen" ? deps.estimatorSlot.slot : null;
      const preflight = deps.estimatorSlot.kind === "rejected"
        ? rejectedEstimatorRequest(deps.estimatorSlot.code)
        : preflightEstimate(deps, planHash, planCanonicalJson, estimatorProfile, payload.estimateMode);
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
        // Agent selection spec §6.2/§6.4: the plan's layers become the group's; the slot is what this import froze.
        agentOverrides: planGroupLayer(plan), estimatorSlot, reconcileSlot: null,
      };
      deps.store.db.prepare("INSERT INTO groups(id,revision,graph_version,projection_seq,body) VALUES (?,?,?,0,?)")
        .run(payload.groupId, 0, 1, JSON.stringify(group));
      writeCanonicalRecord(deps.store, payload.groupId, planHash, planCanonicalJson);
      for (const task of plan.tasks) {
        writeCanonicalRecord(deps.store, payload.groupId, task.originalContractHash, task.originalContractCanonicalJson);
        const work = {
          workItemId: task.taskId, taskId: task.taskId, kind: "task", dependsOn: task.dependencyTaskIds,
          contract: { contentAddressedHash: task.originalContractHash },
          // Agent selection spec §6.2 / §12 I3: a draft has no configHash; confirmation freezes ccloop's.
          configHash: null,
          grant: { work: cloneAmount(TASK_WORK), handoff: cloneAmount(TASK_HANDOFF) }, targetVersion: task.targetVersion,
          status: "draft", originalContractHash: task.originalContractHash, derivedContractHash: null,
          agentOverride: task.agent ?? null,
        };
        deps.store.db.prepare("INSERT INTO work_items(group_id,id,target_version,body) VALUES (?,?,?,?)")
          .run(payload.groupId, task.taskId, task.targetVersion, JSON.stringify(work));
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
        grant: cloneAmount(ESTIMATE_GRANT), estimatorSlot,
      };
      deps.store.db.prepare("INSERT INTO estimates(group_id,id,estimate_version,state,body) VALUES (?,?,?,?,?)")
        .run(payload.groupId, estimateId, 1, preflight.state, canonicalBytes(estimate).toString("utf8"));
      persistEstimateArtifacts(deps.store, payload.groupId, estimateId, preflight);
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
  let prepared: PreparedEstimatorSlot;
  try {
    const raw = command.payload;
    const currentDefaults = deps.defaults();
    frozenDefaults = {
      estimatorProfileId: raw.estimatorProfileId ?? currentDefaults.estimatorProfileId,
      estimatorProfileHash: raw.estimatorProfileHash ?? currentDefaults.estimatorProfileHash,
      estimateMode: raw.estimateMode ?? currentDefaults.estimateMode,
    };
    profile = deps.profileRouter.resolve("budget-estimate", frozenDefaults.estimatorProfileId, frozenDefaults.estimatorProfileHash);
    prepared = await prepareEstimatorSlot(deps, command, profile);
  } catch (error) {
    return persistAsyncPreparationFailure(deps.store, command, error);
  }
  return importControlPlan({
    ...deps,
    defaults: () => frozenDefaults,
    estimatorSlot: prepared.outcome,
    estimatorObservation: selected => {
      if (selected !== profile) throw new ControlError("profile-changed");
      return prepared.observation;
    },
  }, command);
}
