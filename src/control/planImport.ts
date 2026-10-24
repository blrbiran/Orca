import { saveTokenPolicy, hasTokenPolicy } from "./fundedAllowance.js";
import type { BudgetAmount } from "./tokenPolicy.js";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { applyWebCommand, preflightWebCommand, type WebCommandContext } from "./commandLedger.js";
import { dimensions, zero } from "./commands.js";
import { ControlError, type KnownControlErrorCode } from "./errors.js";
import { readAgentPreferences } from "./agentPreferences.js";
import { readGroupAgentOverrides } from "./agentFreeze.js";
import { descriptorProvenance, estimatorLayerAuthority, frozenSlotOf, resolveSelection, slotLayers, type FrozenSlot, type GroupAgentOverrides, type PartialSelection } from "./agentSelection.js";
import { unavailableCapabilities, type ExecutionProfileRouter, type FrozenProfile, type ObservedProfile } from "./profiles.js";
import { dirWorkspaceOf, type DirProjectOf } from "./dirGroup.js";
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
import { newGroupIntegration, readIntegrationDefault, type IntegrationScheme } from "./integrationScheme.js";
import { canonicalPlanDoc } from "./planLibrary/codec.js";
import { readEntry, readVersion } from "./planLibrary/store.js";
import { commandPrincipalFor, routedPersonAuthorityFor } from "./commandClient.js";
import { AgentCeilingRefusal, capStatuses, spendCapBlocking } from "./spendCaps.js";
import { readSchedulerControlPlanSource, type SchedulerControlPlanSource } from "../scheduler/planFile.js";
import type { TrustedControlConfig } from "../panel/controlConfig.js";
import { buildBudgetEstimateRequest, estimateGrantFor, persistEstimateArtifacts, withEstimateGrant, TASK_WORK, TASK_HANDOFF, GOAL_REVIEW, ESTIMATE_GRANT, type FrozenEstimateRequest } from "./estimator.js";

/** Tester round 2 spec §7.2 condition 11: the routed principal of the creating command is a person's. */
export function createdByPerson(commandId: string): boolean {
  const principal = commandPrincipalFor(commandId);
  return principal === "web" || (principal !== null && principal.startsWith("user:")) || routedPersonAuthorityFor(commandId);
}

export type AllowlistedPlanSource = SchedulerControlPlanSource & { repoId: string; planId: string };
export type ImportCommand = Extract<RawAuthorityCommandV1, { verb: "import-plan" }>;
export type ImportResult = CommandLookupV1["body"];

export interface ImportDefaults {
  estimatorProfileId: string | null;
  estimatorProfileHash: string | null;
  estimateMode: "strict" | "soft";
}

/** Agent selection spec §6.4 (§12 I9): the estimator slot, resolved before the import's transaction. */
export type EstimatorSlotOutcome =
  | { kind: "frozen"; partial: PartialSelection; slot: FrozenSlot }
  | { kind: "rejected"; partial: PartialSelection | null; code: string };
export interface PreparedEstimatorSlot { outcome: EstimatorSlotOutcome; observation: ObservedProfile; layerAuthority: string }

export interface ImportDeps {
  store: ControlStore;
  trustedConfig: Pick<TrustedControlConfig, "resolveTarget">;
  /** Scheduled flows and groups spec §5.5: a known repository's path, which a library entry's loop tasks expand with. */
  resolveRepository?: (repoId: string) => string;
  profileRouter: ExecutionProfileRouter;
  defaults: () => ImportDefaults | null;
  estimatorObservation: (profile: FrozenProfile) => Pick<ObservedProfile, "profile" | "observed" | "probeFailureCode" | "resolution">;
  estimatorSlot: EstimatorSlotOutcome;
  estimatorLayerAuthority?: string;
  exactTokenCount?: (profile: FrozenProfile, promptBytes: Buffer) => number;
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
      // Spec §2.3: written only when non-empty, like `agent`; never `labels: undefined` (canonicalBytes refuses it).
      ...(task.labels && task.labels.length > 0 ? { labels: [...task.labels] } : {}),
      // Loop plans spec §3.3: written only for a loop task, like labels.
      ...(task.loop ? { loop: task.loop } : {}),
      originalContractHash: task.originalContractHash,
      originalContractCanonicalJson: task.originalContractCanonicalJson,
    })).sort((left, right) => compare(left.taskId, right.taskId)),
  };
  const parsed = controlPlanSchema.safeParse(candidate);
  if (!parsed.success) return reject(parsed.error.issues[0]?.message ?? "normalized-plan");
  return parsed.data;
}

/** Spec §6.4 / §7: an estimator selection that failed is a blocked estimate named after the failure. */
const ESTIMATOR_REJECTED_PREFIX = "agent-selection-rejected:estimator:";
export function rejectedEstimatorRequest(code: string): FrozenEstimateRequest {
  return { state: "blocked-capability", reasonCode: `${ESTIMATOR_REJECTED_PREFIX}${code}`, requestHash: null, request: null, contract: null, contractHash: null, inputTokens: null, requiredRequestTokens: null };
}

/** The estimator slot's layered partial as the store has it now; null when no layer names an agent. */
function currentEstimatorPartial(store: ControlStore, operatorId: string, group: GroupAgentOverrides, planGroup?: PartialSelection): PartialSelection | null {
  const prefs = readAgentPreferences(store, operatorId).preferences;
  try { return resolveSelection(slotLayers("estimator", prefs, group, undefined, { group: planGroup }), prefs.perAgent).partial; }
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
  planGroup?: PartialSelection,
): Promise<PreparedEstimatorSlot> {
  const prefs = readAgentPreferences(deps.store, operatorId).preferences;
  const layerAuthority = estimatorLayerAuthority(prefs, group, planGroup);
  let resolved: ReturnType<typeof resolveSelection>;
  try { resolved = resolveSelection(slotLayers("estimator", prefs, group, undefined, { group: planGroup }), prefs.perAgent); }
  catch (error) {
    if (!(error instanceof ControlError) || error.code !== "agent-unselected") throw error;
    return {
      outcome: { kind: "rejected", partial: null, code: "agent-unselected" },
      observation: { profile, observed: unavailableCapabilities, observedAt: new Date().toISOString(), probeFailureCode: "agent-unselected", resolution: null },
      layerAuthority,
    };
  }
  const { partial, provenance } = resolved;
  const observation = await deps.profileRouter.probe(profile, partial);
  if (observation.probeFailureCode !== null || observation.resolution === null) {
    return { outcome: { kind: "rejected", partial, code: observation.probeFailureCode ?? "control-capability-probe-failed" }, observation, layerAuthority };
  }
  try {
    const labelled = descriptorProvenance(partial, observation.resolution.selection, provenance);
    return { outcome: { kind: "frozen", partial, slot: frozenSlotOf(structuredClone(observation.resolution), partial, labelled) }, observation, layerAuthority };
  } catch (error) {
    if (!(error instanceof ControlError)) throw error;
    return { outcome: { kind: "rejected", partial, code: error.code }, observation: { ...observation, observed: unavailableCapabilities, probeFailureCode: error.code, resolution: null }, layerAuthority };
  }
}

/**
 * Import's initial estimator follows the effective plan worker primary. The plan source is read before the probe;
 * writeImportedPlan compares the prepared partial with the just-read plan inside the command transaction.
 */
export async function prepareEstimatorSlot(
  deps: { store: ControlStore; profileRouter: ExecutionProfileRouter; trustedConfig?: Pick<TrustedControlConfig, "resolveTarget"> },
  command: ImportCommand,
  profile: FrozenProfile,
): Promise<PreparedEstimatorSlot> {
  // Scheduled flows and groups spec §5.5: a library import's plan agent is the pinned version's (no file is read).
  if (command.payload.libraryEntry !== undefined) {
    const version = readVersion(deps.store, command.payload.libraryEntry.entryId, command.payload.libraryEntry.sha256);
    const agent = version === null ? undefined : (JSON.parse(version.doc) as { agent?: PartialSelection }).agent;
    return estimatorSlotFor(deps, command.actorId, {}, profile, agent);
  }
  const target = deps.trustedConfig?.resolveTarget({ repoId: command.payload.repoId, planId: command.payload.planId });
  const source = target ? readSchedulerControlPlanSource(target) : null;
  return estimatorSlotFor(deps, command.actorId, {}, profile, source?.agent);
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

export interface ImportedPlanWrite {
  groupId: string; repoId: string; planId: string; plan: ControlPlanV1; actorId: string;
  estimatorProfileId: string | null; estimatorProfileHash: string | null; estimateMode: "strict" | "soft";
  /** The command writing it: its principal (commandClient.ts) decides the agent ceiling. `at` (epoch ms) dates the caps' periods. */
  commandId: string; at?: number;
  /**
   * Scheduled flows and groups spec §9.1 (a fresh import only): `tokenLimit` is the group limit's tokens (absent or null:
   * unlimited, as today); `integration` the group's scheme instead of the repository default (null: keep); `origin` is
   * written on the group body. Absent, each adds no byte (tests/control/fixtures/importPlanStoredBytes.golden.json).
   */
  tokenLimit?: number | null; integration?: IntegrationScheme | null; origin?: ImportOrigin;
}
/** Spec §9.1, §15: what started a group a schedule fired; passed in-process by the fire, never a payload field. */
export interface ImportOrigin { kind: "schedule"; scheduleId: string; slot: number }
/** N1 spec §9.1: what a requirement brings into the plan group it becomes. */
export interface RequirementCarryOver { existingBody: Record<string, unknown>; used: Amount; usageUnknown: boolean; traces: Readonly<Record<string, readonly string[]>> }

/**
 * The import's writes, shared by import-plan (a new group, carry null) and requirement-draft-accept (N1 spec §9.1: the
 * same group, its clarifying spend carried over -- `used` unchanged and the limit raised by exactly that much, so the
 * reserve, `limit - used - committed`, is what a fresh import would have).
 */
export function writeImportedPlan(deps: ImportDeps, input: ImportedPlanWrite, carry: RequirementCarryOver | null, opts?: { estimate: "preflight" }): { estimateId: string; preflight: FrozenEstimateRequest };
/**
 * `estimate: "deferred"` (debug-task spec: opening spends nothing): the group is imported with no estimate row, no estimate
 * artifacts and no wake -- the estimator slot is not resolved or frozen either, as no estimate would use it. The reserve
 * follows the non-queued branch, so a later estimate's grant is still available to the first re-estimate.
 */
export function writeImportedPlan(deps: ImportDeps, input: ImportedPlanWrite, carry: RequirementCarryOver | null, opts: { estimate: "deferred"; stripped?: { workTokens: number } }): { estimateId: null; preflight: null };
export function writeImportedPlan(deps: ImportDeps, input: ImportedPlanWrite, carry: RequirementCarryOver | null, opts?: { estimate: "preflight" | "deferred" }): { estimateId: string | null; preflight: FrozenEstimateRequest | null };
/**
 * `stripped` (checks spec 2026-10-22 §6.1, a model review; deferred only): the task's work grant is `workTokens` tokens
 * (non-token dimensions from TASK_WORK), the group limit equals it, and the handoff and goal-review allocations are
 * present (the protocol requires them) with zero amounts, as is every non-token reserve. So the review budget caps the
 * whole group.
 */
export function writeImportedPlan(deps: ImportDeps, input: ImportedPlanWrite, carry: RequirementCarryOver | null, opts: { estimate: "preflight" | "deferred"; stripped?: { workTokens: number } } = { estimate: "preflight" }): { estimateId: string | null; preflight: FrozenEstimateRequest | null } {
  const deferred = opts.estimate === "deferred";
  const stripped = deferred && carry === null ? opts.stripped ?? null : null;
  const handoffAmount = stripped === null ? TASK_HANDOFF : zero(), reviewAmount = stripped === null ? GOAL_REVIEW : zero();
  const plan = input.plan;
  const planCanonicalJson = canonicalBytes(plan).toString("utf8");
  const planHash = sha256Canonical(plan);
  const estimatorProfile = !deferred && input.estimatorProfileId !== null && input.estimatorProfileHash !== null
    ? deps.profileRouter.resolve("budget-estimate", input.estimatorProfileId, input.estimatorProfileHash) : null;
  // Spec §6.4 (frozen = seen): the operator layers the estimator slot was resolved from must be the layers now.
  const partialNow = currentEstimatorPartial(deps.store, input.actorId, carry === null ? {} : readGroupAgentOverrides(carry.existingBody), plan.agent);
  if (estimatorProfile !== null && !canonicalBytes(partialNow).equals(canonicalBytes(deps.estimatorSlot.partial))) throw new ControlError("plan-version-conflict", "estimator-selection-changed");
  if (estimatorProfile !== null && deps.estimatorLayerAuthority !== undefined) {
    const prefs = readAgentPreferences(deps.store, input.actorId).preferences;
    const group = carry === null ? {} : readGroupAgentOverrides(carry.existingBody);
    if (estimatorLayerAuthority(prefs, group, plan.agent) !== deps.estimatorLayerAuthority) throw new ControlError("plan-version-conflict", "estimator-layer-changed");
  }
  const estimatorSlot = estimatorProfile === null ? null : deps.estimatorSlot.kind === "frozen" ? deps.estimatorSlot.slot : null;
  const preflight = deferred ? null : estimatorProfile === null ? rejectedEstimatorRequest("control-estimator-unconfigured") : deps.estimatorSlot.kind === "rejected"
    ? rejectedEstimatorRequest(deps.estimatorSlot.code)
    : preflightEstimate(deps, planHash, planCanonicalJson, estimatorProfile, input.estimateMode);
  let preflightFrozen = preflight;
  const estimateId = deferred ? null : `estimate-${sha256Canonical({ groupId: input.groupId, planHash, version: 1 }).slice(0, 24)}`;
  const queued = preflight?.state === "queued";
  const legacyCarry=carry!==null&&!hasTokenPolicy(deps.store,input.groupId);
  const authoredTokens=(task:ControlPlanV1["tasks"][number]):number|null=>stripped!==null?stripped.workTokens:legacyCarry?TASK_WORK.tokens:JSON.parse(task.originalContractCanonicalJson).executionPolicy.tokenBudget;
  const taskAllocations = plan.tasks.flatMap(task => [
    { ownerKind: "task", ownerId: task.taskId, bucket: "work", state: "draft-encumbered", amount: {...TASK_WORK,tokens:authoredTokens(task)}, fieldProvenance: defaultProvenance() },
    { ownerKind: "task", ownerId: task.taskId, bucket: "handoff", state: "draft-encumbered", amount: cloneAmount(handoffAmount), fieldProvenance: defaultProvenance() },
  ]);
  let base = stripped === null ? checkedAdd(ESTIMATE_GRANT, GOAL_REVIEW) : zero();
  for (const _task of plan.tasks) base = checkedAdd(base, stripped === null ? checkedAdd(TASK_WORK, TASK_HANDOFF) : { ...TASK_WORK, tokens: stripped.workTokens });
  const initialReserve = stripped === null ? reserve20(base) : zero();
  const explicitUnallocatedReserve:BudgetAmount = queued || stripped !== null ? initialReserve : checkedAdd(initialReserve, ESTIMATE_GRANT);
  const groupLimit = checkedAdd(base, initialReserve);
  // Spec §6.3.2 (H10), D4, D10: an agent's import may not promise more than the caps leave -- its fresh limit (no carried
  // clarifying spend) against the headroom without this group's own runs. Not a ControlError: the command transaction
  // rolls back, books nothing, and the route answers 403. A person (any user principal) is not held to it.
  if (legacyCarry && commandPrincipalFor(input.commandId)?.startsWith("agent:")) {
    const blocking = spendCapBlocking(deps.store, input.repoId, groupLimit.tokens, input.at ?? Date.now(), input.groupId);
    if (blocking !== null) throw new AgentCeilingRefusal(blocking, groupLimit.tokens);
  }
  const used = carry === null ? zero() : { ...carry.used };
  const limit:BudgetAmount = {...checkedAdd(groupLimit, used),tokens:stripped!==null?groupLimit.tokens:carry===null?input.tokenLimit??null:legacyCarry?checkedAdd(groupLimit,used).tokens:(carry.existingBody.limit as BudgetAmount).tokens};
  let committedRemaining = checkedAdd(reviewAmount, zero());
  for (const _task of plan.tasks) committedRemaining = checkedAdd(committedRemaining, stripped === null ? checkedAdd(TASK_WORK, TASK_HANDOFF) : TASK_WORK);
  if(!legacyCarry)committedRemaining.tokens=reviewAmount.tokens;
  // Tester round 2 spec §5.2.3: the queued estimate's grant from the group's remaining tokens before it (a limited group
  // with none left refuses, D3) and the binding cap's headroom; the contract is re-frozen with it.
  let estimateGrant: Amount = cloneAmount(ESTIMATE_GRANT);
  if (queued) {
    const remainingTokens = limit.tokens === null ? null : limit.tokens - used.tokens - committedRemaining.tokens;
    if (remainingTokens !== null && remainingTokens <= 0) throw new ControlError("group-budget-unavailable");
    const capHeadroom = capStatuses(deps.store, input.repoId, input.at ?? Date.now())[0]?.headroom ?? null;
    estimateGrant = estimateGrantFor({ limitTokens: limit.tokens, remainingTokens, capHeadroom, requiredRequestTokens: preflight!.requiredRequestTokens! });
    preflightFrozen = withEstimateGrant(preflight!, estimateGrant);
    committedRemaining = checkedAdd(committedRemaining, estimateGrant);
  }
  explicitUnallocatedReserve.tokens=limit.tokens===null?null:limit.tokens-used.tokens-committedRemaining.tokens;
  if(explicitUnallocatedReserve.tokens!==null&&explicitUnallocatedReserve.tokens<0)throw new ControlError("group-budget-unavailable");
  const allocations = [
    ...taskAllocations,
    { ownerKind: "goal-review", ownerId: `${input.groupId}:goal-review`, bucket: "review", state: "draft-encumbered", amount: cloneAmount(reviewAmount), fieldProvenance: defaultProvenance() },
    { ownerKind: "reserve", ownerId: `${input.groupId}:reserve`, bucket: "reserve", state: "draft-encumbered", amount: explicitUnallocatedReserve, fieldProvenance: systemProvenance() },
  ].sort((left, right) => compare(`${left.ownerKind}\0${left.ownerId}\0${left.bucket}`, `${right.ownerKind}\0${right.ownerId}\0${right.bucket}`));
  const group = {
    ...(carry === null ? {} : carry.existingBody),
    groupId: input.groupId, projectKey: input.repoId, goal: plan.goal, successConditions: plan.successConditions,
    budgetMode: input.estimateMode, limit, reviewReserve: cloneAmount(reviewAmount), deadlineAt: null,
    revision: 0, commandRevision: 0, graphVersion: 1, stopped: false, status: "draft", used, reserved: committedRemaining,
    // N1 spec §9.1: the budget version keeps counting from the clarifying phase's usage bookings (usage.ts), so a
    // group-handoff outbox id is never reused; revision and commandRevision are set by applyWebCommand afterwards.
    reviewRemaining: cloneAmount(reviewAmount), budgetVersion: carry === null ? 1 : carry.existingBody.budgetVersion, planHash,
    plan: { repoId: input.repoId, planId: input.planId, planHash, goal: plan.goal, successConditions: plan.successConditions },
    proposal: { state: "editable", proposalVersion: 1, planHash, budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
    ledger: { groupLimit: limit, used, committedRemaining, explicitUnallocatedReserve, budgetDeficit: zero(), usageUnknown: carry === null ? false : carry.usageUnknown },
    importDefaults: { estimatorProfileId: input.estimatorProfileId, estimatorProfileHash: input.estimatorProfileHash, estimateMode: input.estimateMode },
    // Ruling review R7: the panel's layers start empty -- the plan's own layers are read from the archived plan
    // (agentFreeze.ts groupSelectionPartials), below the panel's. The estimator slot is what this import froze.
    // N1 spec §9.1: an accepted requirement keeps the layers its clarifying group was opened with.
    agentOverrides: carry === null ? {} : (carry.existingBody.agentOverrides ?? {}), estimatorSlot, reconcileSlot: null,
    // Tester round 2 spec §7.2 condition 11: whether a person created this group (import) or accepted it (requirement) --
    // a routed `web` / `user:<id>` principal, or a routed person authority (an owner's person token on the socket);
    // never a run Orca dispatched, never Orca's own command.
    createdByPerson: createdByPerson(input.commandId),
  };
  // Integration spec §3.1: the group gets its copy of the repository's default where it gets its plan -- here, for
  // import-plan and a requirement's split acceptance alike. Keep is no field, so a keep group's body is unchanged.
  // Dir-requirements spec §7: a dir group (its body carries `dirWorkspace`) never has a record; it delivers by placement.
  // Scheduled flows and groups spec §9.1: a library import may carry its own scheme (null: keep) instead.
  const integration = dirWorkspaceOf(group) !== null ? null
    : input.integration === undefined ? newGroupIntegration(readIntegrationDefault(deps.store, input.repoId).scheme)
      : input.integration === null ? null : newGroupIntegration(input.integration);
  if (integration !== null) Object.assign(group, { integration });
  if (input.origin !== undefined) Object.assign(group, { origin: input.origin });
  if (carry === null) {
    deps.store.db.prepare("INSERT INTO groups(id,revision,graph_version,projection_seq,body) VALUES (?,?,?,0,?)")
      .run(input.groupId, 0, 1, JSON.stringify(group));
  } else {
    deps.store.db.prepare("UPDATE groups SET graph_version=1, body=? WHERE id=?").run(JSON.stringify(group), input.groupId);
  }
  saveTokenPolicy(deps.store,input.groupId,"",limit.tokens,legacyCarry?"finite-legacy":"optional-v1");
  writeCanonicalRecord(deps.store, input.groupId, planHash, planCanonicalJson);
  for (const task of plan.tasks) {
    writeCanonicalRecord(deps.store, input.groupId, task.originalContractHash, task.originalContractCanonicalJson);
    const work = {
      workItemId: task.taskId, taskId: task.taskId, kind: "task", dependsOn: task.dependencyTaskIds,
      contract: { contentAddressedHash: task.originalContractHash },
      // Agent selection spec §6.2 / §12 I3: a draft has no configHash; confirmation freezes ccloop's.
      configHash: null,
      grant: { work: {...TASK_WORK,tokens:authoredTokens(task)}, handoff: cloneAmount(handoffAmount) }, targetVersion: task.targetVersion,
      status: "draft", originalContractHash: task.originalContractHash, derivedContractHash: null,
      // Ruling review R7: the task's panel layer; the plan's `agent` for this task stays in the archived plan.
      agentOverride: null,
      ...(carry === null ? {} : { traces: [...(carry.traces[task.taskId] ?? [])] }),
    };
    deps.store.db.prepare("INSERT INTO work_items(group_id,id,target_version,body) VALUES (?,?,?,?)")
      .run(input.groupId, task.taskId, task.targetVersion, JSON.stringify(work));
  }
  for(const task of plan.tasks)saveTokenPolicy(deps.store,input.groupId,task.taskId,authoredTokens(task),legacyCarry?"finite-legacy":"optional-v1");
  const proposal = {
    proposalVersion: 1, state: "editable", planHash, groupLimit: limit, explicitUnallocatedReserve,
    allocations, budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null,
  };
  deps.store.db.prepare("INSERT INTO budget_proposals(group_id,proposal_version,body) VALUES (?,?,?)")
    .run(input.groupId, 1, canonicalBytes(proposal).toString("utf8"));
  if (preflightFrozen === null || estimateId === null) return { estimateId: null, preflight: null };
  const frozen = preflightFrozen;
  const estimate = {
    estimateId, estimateVersion: 1, state: frozen.state,
    profile: estimatorProfile === null ? null : { profileId: input.estimatorProfileId, profileHash: input.estimatorProfileHash }, mode: input.estimateMode,
    requestHash: frozen.requestHash, request: frozen.request, outputHash: null, output: null, reasonCode: frozen.reasonCode,
    ...(frozen.compatibilityReasonCodes === undefined ? {} : { compatibilityReasonCodes: frozen.compatibilityReasonCodes }),
    grant: estimateGrant, estimatorSlot, proposalVersion: 1,
  };
  deps.store.db.prepare("INSERT INTO estimates(group_id,id,estimate_version,state,body) VALUES (?,?,?,?,?)")
    .run(input.groupId, estimateId, 1, frozen.state, canonicalBytes(estimate).toString("utf8"));
  persistEstimateArtifacts(deps.store, input.groupId, estimateId, frozen);
  if (queued) {
    const wakeId = `scheduler-wake:${input.groupId}:estimate:${estimateId}`;
    deps.store.db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES (?,?, 'budget-estimate', ?, 0)")
      .run(wakeId, input.groupId, JSON.stringify({ groupId: input.groupId, estimateId, planHash }));
  }
  return { estimateId, preflight: frozen };
}

/**
 * Scheduled flows and groups spec §5.5: the plan source of a pinned library version -- its bytes re-hashed
 * (plan-library-hash-mismatch), revalidated as every library write is, its loop tasks expanded with the repository's
 * path -- and the plan id `lib-<entryId>-<sha256[:12]>` (plan B3).
 */
function librarySource(deps: ImportDeps, repoId: string, ref: { entryId: string; sha256: string }): { planId: string; source: SchedulerControlPlanSource } {
  const entry = readEntry(deps.store, ref.entryId);
  if (entry === null) throw new ControlError("plan-library-entry-not-found", ref.entryId);
  if (entry.projectId !== repoId) throw new ControlError("plan-library-project-mismatch", `${ref.entryId} belongs to ${entry.projectId}`);
  const version = readVersion(deps.store, ref.entryId, ref.sha256);
  if (version === null) throw new ControlError("plan-library-entry-not-found", `${ref.entryId}@${ref.sha256}`);
  if (deps.resolveRepository === undefined) throw new ControlError("control-target-not-allowed");
  return { planId: `lib-${ref.entryId}-${ref.sha256.slice(0, 12)}`, source: canonicalPlanDoc(JSON.parse(version.doc), deps.resolveRepository(repoId)).source };
}

export function importControlPlan(deps: ImportDeps, command: ImportCommand, opts: { origin?: ImportOrigin } = {}): ImportResult {
  const outcome = applyWebCommand<CommandSuccessV1>(deps.store, {
    rawCommand: command,
    expand: () => {
      const payload = command.payload;
      const defaults = deps.defaults();
      const estimatorProfileId = payload.estimatorProfileId ?? defaults?.estimatorProfileId ?? null;
      const estimatorProfileHash = payload.estimatorProfileHash ?? defaults?.estimatorProfileHash ?? null;
      const estimateMode = payload.estimateMode ?? defaults?.estimateMode ?? "strict";
      if (estimatorProfileId !== null && estimatorProfileHash !== null) deps.profileRouter.resolve("budget-estimate", estimatorProfileId, estimatorProfileHash);
      return { ...command, schema: "orca-authority-command-v1", payload: { ...payload, estimatorProfileId, estimatorProfileHash, estimateMode } };
    },
    apply: context => {
      const payload = context.effectiveCommand.payload as ImportDefaults & { groupId: string; repoId: string; planId?: string;
        libraryEntry?: { entryId: string; sha256: string }; tokenLimit?: number | null; integration?: IntegrationScheme | null };
      // N1 plan F8: an id that names any group -- a clarifying one included -- is refused by name, not by SQLite.
      if (deps.store.db.prepare("SELECT id FROM groups WHERE id=?").get(payload.groupId)) throw new ControlError("group-already-exists");
      // The payload schema admits exactly one of planId and libraryEntry.
      const { planId, source } = payload.libraryEntry !== undefined ? librarySource(deps, payload.repoId, payload.libraryEntry)
        : { planId: payload.planId!, source: readSchedulerControlPlanSource(deps.trustedConfig.resolveTarget({ repoId: payload.repoId, planId: payload.planId })) };
      const plan = normalizeControlPlan({ ...source, repoId: payload.repoId, planId });
      const { estimateId, preflight } = writeImportedPlan(deps, { groupId: payload.groupId, repoId: payload.repoId, planId, plan, actorId: context.rawCommand.actorId, commandId: context.rawCommand.commandId,
        estimatorProfileId: payload.estimatorProfileId, estimatorProfileHash: payload.estimatorProfileHash, estimateMode: payload.estimateMode,
        ...(payload.tokenLimit === undefined ? {} : { tokenLimit: payload.tokenLimit }), ...(payload.integration === undefined ? {} : { integration: payload.integration }),
        ...(opts.origin === undefined ? {} : { origin: opts.origin }) }, null);
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
export async function importControlPlanAsync(deps: AsyncImportDeps & { dirProjectOf?: DirProjectOf }, command: ImportCommand, opts: { origin?: ImportOrigin } = {}): Promise<ImportResult> {
  const preflight = preflightWebCommand(deps.store, command);
  if (preflight) return preflight.body;

  let frozenDefaults: ImportDefaults;
  let profile: FrozenProfile | null;
  let prepared: PreparedEstimatorSlot | null;
  try {
    const raw = command.payload;
    // Dir-requirements spec §5.2: only a requirement gets a dir workspace; a plan on a `dir` project is refused by name,
    // before its plan file is looked up (a folder has none).
    if ((deps.dirProjectOf?.(raw.repoId) ?? null) !== null) throw new ControlError("dir-project-plan-import-unsupported", raw.repoId);
    const currentDefaults = deps.defaults();
    frozenDefaults = {
      estimatorProfileId: raw.estimatorProfileId ?? currentDefaults?.estimatorProfileId ?? null,
      estimatorProfileHash: raw.estimatorProfileHash ?? currentDefaults?.estimatorProfileHash ?? null,
      estimateMode: raw.estimateMode ?? currentDefaults?.estimateMode ?? "strict",
    };
    profile = frozenDefaults.estimatorProfileId !== null && frozenDefaults.estimatorProfileHash !== null
      ? deps.profileRouter.resolve("budget-estimate", frozenDefaults.estimatorProfileId, frozenDefaults.estimatorProfileHash) : null;
    prepared = profile === null ? null : await prepareEstimatorSlot(deps, command, profile);
  } catch (error) {
    return persistAsyncPreparationFailure(deps.store, command, error);
  }
  return importControlPlan({
    ...deps,
    defaults: () => frozenDefaults,
    estimatorSlot: prepared?.outcome ?? { kind: "rejected", partial: null, code: "control-estimator-unconfigured" },
    ...(prepared === null ? {} : { estimatorLayerAuthority: prepared.layerAuthority }),
    estimatorObservation: selected => {
      if (selected !== profile) throw new ControlError("profile-changed");
      if (prepared === null) throw new ControlError("control-estimator-unconfigured");
      return prepared.observation;
    },
  }, command, opts);
}
