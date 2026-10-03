import { z } from "zod";
import { randomUUID, createHash } from "node:crypto";
import { applyWebCommand, preflightWebCommand, type WebCommandContext } from "./commandLedger.js";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { dimensions, zero } from "./commands.js";
import { ControlError, type KnownControlErrorCode } from "./errors.js";
import { buildBudgetEstimateRequest, ESTIMATE_GRANT, GOAL_REVIEW, TASK_HANDOFF, TASK_WORK, provenance, residual, safeNumber, sumAmounts, persistEstimateArtifacts, estimateCapabilityDegraded, classifyEstimateOutput } from "./estimator.js";
import { deriveContract, prepareExecutionSnapshot, readConfirmedTaskExecution, replaceTaskInSnapshot } from "./executionSnapshot.js";
import { answeredPartials, currentPartials, readGroupAgentOverrides, RECONCILE_SLOT_KEY, resolveGroupSelections, taskSlotKey, type GroupSelectionResolution } from "./agentFreeze.js";
import type { ExecutionPort } from "./executionPort.js";
import { estimatorSlotFor, importControlPlanAsync, rejectedEstimatorRequest, type AsyncImportDeps, type ImportCommand } from "./planImport.js";
import { intersectCapabilities } from "./profiles.js";
import type { FrozenSlot } from "./agentSelection.js";
import { effectivePlanCanonicalJson, estimateIsStale, readArchivedPlan, readBudgetProposal, readEstimateRecord, type BudgetProposalRecord } from "./queries.js";
import { amountSchema } from "./schema.js";
import { writeCanonicalRecord, readCanonicalRecord } from "./snapshot.js";
import { estimateExecutionContractSchema, executionSnapshotSchema } from "./webProtocol.js";
import { scheduleStart, type StartCommand } from "./webDispatch.js";
import { applyHandoffStop, applyPauseDispatch, applyRecoveryRetry, applyResumeDispatch, type HandoffStopCommand, type PauseCommand, type RecoveryRetryCommand, type ResumeDispatchCommand, type StopDeps } from "./stopIntent.js";
import { applyContinueTask, applyResumeFromHandoff, type ContinueTaskCommand, type ResumeFromHandoffCommand } from "./continuation.js";
import { applySetWorkspaceMode, type SetWorkspaceModeCommand } from "./workspaceSettings.js";
import { applySetAgentPreferences, type SetAgentPreferencesCommand } from "./agentPreferences.js";
import { recordProjectionChange } from "./projectionJournal.js";
import { effectiveTaskLabels, normalizeInputLabels, readTaskLabelState } from "./labels.js";
import { TASK_AMENDMENT_SCHEMA, effectivePlanTask, workBodyOf, writeTaskAmendment } from "./taskAmendments.js";
import { expandLoopPlan, expandRecipe, normalizeLoopSkills, type LoopRecipe, type LoopSkills, type LoopTaskExpansion } from "./loopPlans.js";
import { taskContractSchema } from "../scheduler/planFile.js";
import { profileMembers, SyncskillError, type SyncskillOptions } from "../skills/syncskill.js";
import type { Amount } from "./types.js";
import type { ControlStore } from "./store.js";
import type { BudgetEstimateV1, CommandLookupV1, CommandSuccessV1, EffectiveProposalEditPayload, RawAuthorityCommandV1, ProfileBindingV1 } from "./webProtocol.js";
import type { AdmissionGate } from "./admissionGate.js";
import { budgetBalance } from "./budget.js";
import { refuseClarifying, setRequirementLimit } from "./requirementRecords.js";
import { assertCallUsageBooked, closeSingleCall, insertSingleCallRun, verifyStoppedSingleCall } from "./singleCallLedger.js";
import {
  applyRequirementAnswer, applyRequirementConsensus, applyRequirementDraftAccept, applyRequirementDraftFeedback, applyRequirementOpen,
  type RequirementAnswerCommand, type RequirementConsensusCommand, type RequirementDraftAcceptCommand, type RequirementDraftFeedbackCommand, type RequirementOpenCommand,
} from "./requirementCommands.js";

export type ProposalEditCommand = Extract<RawAuthorityCommandV1, { verb: "proposal-edit" }>;
export type ReestimateCommand = Extract<RawAuthorityCommandV1, { verb: "estimate" }>;
export type ConfirmCommand = Extract<RawAuthorityCommandV1, { verb: "confirm" }>;
export type SetLimitCommand = Extract<RawAuthorityCommandV1, { verb: "set-limit" }>;
export type ProposalSetAgentCommand = Extract<RawAuthorityCommandV1, { verb: "proposal-set-agent" }>;
export type SetTaskLabelsCommand = Extract<RawAuthorityCommandV1, { verb: "set-task-labels" }>;
export type SetTaskLoopCommand = Extract<RawAuthorityCommandV1, { verb: "set-task-loop" }>;
export type WebCommandResult = CommandLookupV1["body"];
export interface WebServiceDeps extends AsyncImportDeps {
  admissionGate?: AdmissionGate; now?: () => Date; knownRepository?: (repoId: string) => boolean;
  /** Agent selection spec §6.4 (W6-19): the same port the panel's profiles use; confirm resolves selections through it. */
  port: Pick<ExecutionPort, "resolveAgent">;
  /** Syncskill integration spec §10.5: confirm looks up each declared profile through it. Absent means not configured. */
  syncskill?: SyncskillOptions;
}
interface EstimateRun { runId: string; groupId: string; workItemId: string; phase: string; state: string; claimOrdinal: null; providerAttemptOrdinal: number; remaining: { work: Amount; handoff: Amount }; cumulative: { work: Amount; handoff: Amount }; unknown: { work: boolean; handoff: boolean }; [key: string]: unknown }

const ledgerSchema = z.object({ groupLimit: amountSchema, used: amountSchema, committedRemaining: amountSchema, explicitUnallocatedReserve: amountSchema, budgetDeficit: amountSchema, usageUnknown: z.boolean() }).strict();
const groupSchema = z.object({ groupId: z.string(), status: z.enum(["clarifying", "draft", "ready", "running", "review", "done", "blocked"]), stopped: z.boolean(), used: amountSchema, reserved: amountSchema, limit: amountSchema, ledger: ledgerSchema }).passthrough();
type Group = z.infer<typeof groupSchema>;
const same = (a: unknown, b: unknown) => canonicalBytes(a).equals(canonicalBytes(b));
function identifyRawEstimateOutput(value: unknown): { rawHash: string; rawIdentity: string; canonicalJson: string | null } {
  try {
    const bytes = canonicalBytes(value), canonicalJson = bytes.toString("utf8");
    return { rawHash: createHash("sha256").update(bytes).digest("hex"), rawIdentity: `canonical-json:${canonicalJson}`, canonicalJson };
  } catch (error) {
    if (!(error instanceof ControlError) || error.code !== "control-non-canonical-json") throw error;
  }
  const seen = new Map<object, number>();
  const encode = (item: unknown): unknown => {
    if (item === null) return ["null"];
    if (typeof item === "boolean" || typeof item === "string") return [typeof item, item];
    if (typeof item === "number") return ["number", Object.is(item, -0) ? "-0" : String(item)];
    if (typeof item === "bigint") return ["bigint", item.toString()];
    if (typeof item === "undefined") return ["undefined"];
    if (typeof item === "symbol") return ["symbol", item.description ?? ""];
    if (typeof item === "function") return ["function", item.name];
    const prior = seen.get(item);
    if (prior !== undefined) return ["reference", prior];
    const identity = seen.size; seen.set(item, identity);
    if (Array.isArray(item)) return ["array", identity, item.map(encode)];
    const entries = Reflect.ownKeys(item).map((key, ordinal) => {
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      const encodedKey = typeof key === "string" ? ["string", key] : ["symbol", key.description ?? "", ordinal];
      return [encodedKey, "value" in descriptor ? ["value", encode(descriptor.value)] : ["accessor", Boolean(descriptor.get), Boolean(descriptor.set)]];
    });
    entries.sort((left, right) => JSON.stringify(left[0]).localeCompare(JSON.stringify(right[0])));
    return ["object", identity, entries];
  };
  const rawIdentity = `noncanonical-v1:${JSON.stringify(encode(value))}`;
  return { rawHash: createHash("sha256").update(rawIdentity).digest("hex"), rawIdentity, canonicalJson: null };
}
export function readWebGroup(store: ControlStore, groupId: string): Group {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  if (!row) throw new ControlError("group-not-found");
  try {
    const group = groupSchema.parse(JSON.parse(String(row.body)));
    if (group.groupId !== groupId || !same(group.used, group.ledger.used) || !same(group.reserved, group.ledger.committedRemaining) || !same(group.limit, group.ledger.groupLimit)) throw new Error("ledger-mismatch");
    return group;
  } catch { throw new ControlError("recovery-blocked"); }
}
/** Spec §10.5: what confirm's profile lookups answered, decided inside the transaction like a slot failure. */
type SkillLookup = { members: Map<string, string[]> } | { failure: unknown };
const UNCONFIGURED_SYNCSKILL: SyncskillOptions = { bin: null, env: {} };
const SYNCSKILL_REFUSALS = ["skills-profile-empty", "skills-shape", "syncskill-missing", "syncskill-output-invalid", "syncskill-output-too-large", "syncskill-timeout", "syncskill-unconfigured"] as const satisfies readonly KnownControlErrorCode[];
/** One `profile ls` per distinct profile the tasks' effective recipes declare, in name order, one at a time. */
async function lookupSkillProfiles(store: ControlStore, groupId: string, syncskill: SyncskillOptions): Promise<SkillLookup> {
  const profiles = new Set<string>();
  let declared = false;
  try {
    for (const archived of readArchivedPlan(store, groupId).plan.tasks) {
      const skills = effectivePlanTask(store, groupId, archived, workBodyOf(store, groupId, archived.taskId)).loop?.skills;
      if (skills !== undefined) declared = true;
      if (skills !== undefined && "profile" in skills) profiles.add(skills.profile);
    }
  } catch { return { members: new Map() }; } // the transaction's own checks name what could not be read
  // Spec §4.2 / §10.5: any declared skills, names included, need syncskill at run start, so confirm refuses without it.
  if (declared && syncskill.bin === null) return { failure: new ControlError("syncskill-unconfigured") };
  const members = new Map<string, string[]>();
  for (const profile of [...profiles].sort()) {
    try { members.set(profile, await profileMembers(syncskill, profile)); } catch (error) { return { failure: syncskillRefusal(error) }; }
  }
  return { members };
}
/**
 * Spec §10.5, H3: the profile set-task-loop must look up, or null. Only a confirmed task whose payload declares a profile
 * other than its recipe's needs one: a draft task is frozen later by confirm, and an unchanged declaration keeps the
 * frozen entry as it is. Read before the transaction; the transaction re-checks (a confirm in between is refused).
 */
function profileToLookUp(store: ControlStore, groupId: string, taskId: string, skills: LoopSkills | undefined): string | null {
  if (skills === undefined || !("profile" in skills)) return null;
  try {
    if (readBudgetProposal(store, groupId).state === "editable") return null;
    const archived = readArchivedPlan(store, groupId).plan.tasks.find(task => task.taskId === taskId);
    if (archived === undefined) return null;
    const current = effectivePlanTask(store, groupId, archived, workBodyOf(store, groupId, taskId)).loop?.skills;
    return current !== undefined && "profile" in current && current.profile === skills.profile ? null : skills.profile;
  } catch { return null; } // the transaction's own checks name what could not be read
}
async function lookupProfile(profile: string | null, syncskill: SyncskillOptions): Promise<SkillLookup> {
  if (profile === null) return { members: new Map() };
  // profileMembers refuses an unset ORCA_SYNCSKILL_BIN itself (syncskill-unconfigured).
  try { return { members: new Map([[profile, await profileMembers(syncskill, profile)]]) }; } catch (error) { return { failure: syncskillRefusal(error) }; }
}
function syncskillRefusal(error: unknown): unknown {
  if (!(error instanceof SyncskillError)) return error;
  if (error.code.startsWith("syncskill-failed:")) return new ControlError("syncskill-failed", error.code.slice("syncskill-failed:".length));
  const known = SYNCSKILL_REFUSALS.find(code => code === error.code);
  return known === undefined ? error : new ControlError(known);
}
function prestart(group: Group): void {
  if (group.status === "running" || group.status === "review" || group.status === "done") throw new ControlError("grant-amendment-unsupported");
  if (group.status !== "draft" && group.status !== "ready") throw new ControlError("group-state-invalid");
}
/**
 * For the commands that reopen the proposal or reset task state (edit, set-agent, confirm). Nothing on the Web path
 * moves the group past `ready`, so a claimed task is seen only on its own work item; reopening then would return a
 * running task to draft while its run continues. Estimates do not reset task state and keep prestart alone.
 */
function refuseAfterTaskStarted(store: ControlStore, id: string): void {
  for (const row of store.db.prepare("SELECT body FROM work_items WHERE group_id=?").all(id)) {
    const work = JSON.parse(String(row.body));
    if (work.kind === "task" && work.status !== "draft" && work.status !== "ready") throw new ControlError("grant-amendment-unsupported");
  }
}
export function estimateCommitments(store: ControlStore, groupId: string): Array<{ ownerKind: "estimate"; ownerId: string; bucket: "work"; amount: Amount; fieldProvenance: ReturnType<typeof provenance> }> {
  return store.db.prepare("SELECT id FROM estimates WHERE group_id=? ORDER BY id").all(groupId).flatMap(row => {
    const estimate = readEstimateRecord(store, groupId, String(row.id));
    if (!["queued", "running", "start-unknown"].includes(estimate.state)) return [];
    let amount = estimate.grant;
    if (estimate.state !== "queued") {
      const runs = store.db.prepare("SELECT body FROM runs WHERE group_id=? AND work_item_id=? AND active=1").all(groupId, estimate.estimateId);
      if (runs.length !== 1) throw new ControlError("recovery-blocked");
      amount = amountSchema.parse(JSON.parse(String(runs[0].body)).remaining.work);
    }
    return [{ ownerKind: "estimate" as const, ownerId: estimate.estimateId, bucket: "work" as const, amount, fieldProvenance: provenance("system") }];
  });
}
export function assertKnownConservation(store: ControlStore, group: Group, proposal: BudgetProposalRecord): void {
  if (store.dispatchBlocked || group.ledger.usageUnknown) throw new ControlError("recovery-blocked");
  for (const row of store.db.prepare("SELECT body FROM runs WHERE group_id=?").all(group.groupId)) {
    const run = JSON.parse(String(row.body));
    if (!run.unknown || run.unknown.work || run.unknown.handoff) throw new ControlError("recovery-blocked");
  }
  if (!same(group.ledger.explicitUnallocatedReserve, proposal.explicitUnallocatedReserve)
    || !same(residual(group.limit, group.used, group.reserved), proposal.explicitUnallocatedReserve)
    || dimensions.some(d => group.ledger.budgetDeficit[d] !== 0)) throw new ControlError("recovery-blocked");
  const commitments = proposal.allocations.filter(a => a.ownerKind !== "reserve").map(allocation => {
    if (allocation.ownerKind === "goal-review") {
      const remaining = amountSchema.safeParse(group.reviewRemaining);
      if (!remaining.success || dimensions.some(d => remaining.data[d] > allocation.amount[d])) throw new ControlError("recovery-blocked");
      return remaining.data;
    }
    const row = store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(group.groupId, allocation.ownerId);
    if (!row) throw new ControlError("recovery-blocked");
    const work = JSON.parse(String(row.body));
    if (["draft", "ready"].includes(work.status)) return allocation.amount;
    if (allocation.state === "terminal") return zero();
    const current = typeof work.currentRunId === "string" ? store.db.prepare("SELECT body FROM runs WHERE group_id=? AND id=? AND work_item_id=?").get(group.groupId, work.currentRunId, allocation.ownerId) : undefined;
    if (!current) throw new ControlError("recovery-blocked");
    const run = JSON.parse(String(current.body));
    const remaining = amountSchema.safeParse(run.remaining?.[allocation.bucket]);
    if (!remaining.success || dimensions.some(d => remaining.data[d] > allocation.amount[d])) throw new ControlError("recovery-blocked");
    return remaining.data;
  });
  const expected = sumAmounts([...commitments, ...estimateCommitments(store, group.groupId).map(a => a.amount)]);
  if (!same(expected, group.reserved)) throw new ControlError("recovery-blocked");
}
export function saveWebAuthority(store: ControlStore, group: Group, proposal: BudgetProposalRecord): void {
  const review = proposal.allocations.find(a => a.ownerKind === "goal-review");
  if (!review) throw new ControlError("recovery-blocked");
  group.reviewReserve = review.amount;
  if (["draft", "ready"].includes(group.status)) group.reviewRemaining = review.amount;
  group.proposal = { state: proposal.state, proposalVersion: proposal.proposalVersion, planHash: proposal.planHash, budgetMode: proposal.budgetMode, contextPolicy: proposal.contextPolicy, profiles: proposal.profiles, executionSnapshotHash: proposal.executionSnapshotHash };
  group.limit = proposal.groupLimit;
  group.reserved = group.ledger.committedRemaining;
  group.ledger = { ...group.ledger, groupLimit: proposal.groupLimit, used: group.used, explicitUnallocatedReserve: proposal.explicitUnallocatedReserve };
  store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(group), group.groupId);
  store.db.prepare("UPDATE budget_proposals SET proposal_version=?,body=? WHERE group_id=?").run(proposal.proposalVersion, canonicalBytes(proposal).toString("utf8"), group.groupId);
}
export function setReserve(proposal: BudgetProposalRecord, reserve: Amount): void {
  proposal.explicitUnallocatedReserve = reserve;
  const row = proposal.allocations.find(a => a.ownerKind === "reserve");
  if (!row) throw new ControlError("recovery-blocked");
  row.amount = reserve;
}
function success(context: WebCommandContext, result: CommandSuccessV1["result"], status = 200) {
  return { status, body: { schema: "orca-command-success-v1" as const, commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId,
    verb: context.rawCommand.verb, target: context.rawCommand.target, commandRevision: context.nextCommandRevision, projectionSeq: context.nextProjectionSeq,
    effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash, result } };
}
function groupId(command: RawAuthorityCommandV1): string {
  // Agent selection spec §12 I10 (plan-review P7): positively exclude the settings-scoped targets
  // (repository, operator) instead of assuming everything else carries a groupId.
  if (command.target.kind !== "group" && command.target.kind !== "task" && command.target.kind !== "run") throw new ControlError("group-not-found");
  return command.target.groupId;
}
function allocationFor(proposal: BudgetProposalRecord, target: EffectiveProposalEditPayload["operations"][number]["target"]) {
  const row = proposal.allocations.find(a => target.scope === "task" ? a.ownerKind === "task" && a.ownerId === target.taskId && a.bucket === target.allocation : a.ownerKind === "goal-review");
  if (!row) throw new ControlError("work-not-found");
  return row;
}
function verifyModelField(store: ControlStore, id: string, proposal: BudgetProposalRecord, target: EffectiveProposalEditPayload["operations"][number]["target"], value: number, estimateId: string): void {
  const estimate = readEstimateRecord(store, id, estimateId);
  if (estimate.state !== "ready" || !estimate.output || estimate.output.planHash !== proposal.planHash) throw new ControlError("proposal-version-conflict");
  const suggestion = target.scope === "goal-review" ? estimate.output.goalReviewReserve : estimate.output.tasks.find(t => t.taskId === target.taskId)?.[target.allocation];
  if (!suggestion || suggestion[target.dimension] !== value) throw new ControlError("proposal-version-conflict");
}

/**
 * W6: a suggestion is applied only from an estimate built from the tasks' current effective contracts. Not part of
 * verifyModelField: confirmation re-checks values already applied, and a later plan change does not undo them.
 */
function refuseStaleEstimate(store: ControlStore, id: string, estimateId: string): void {
  if (estimateIsStale(readEstimateRecord(store, id, estimateId), effectivePlanCanonicalJson(store, id))) throw new ControlError("estimate-stale");
}

/**
 * A draft proposal's commitments -- every non-reserve allocation plus every in-flight estimate -- with the reserve row
 * reset to what the group limit leaves of them. Shared by every proposal change (editProposal, proposalSetAgent,
 * setTaskLoop; loop plans ruling P5), each of which then reopens the proposal with the returned commitments.
 */
function resetDraftReserve(store: ControlStore, id: string, group: Group, proposal: BudgetProposalRecord): Amount {
  const commitments = sumAmounts([...proposal.allocations.filter(a => a.ownerKind !== "reserve").map(a => a.amount), ...estimateCommitments(store, id).map(a => a.amount)]);
  setReserve(proposal, residual(proposal.groupLimit, group.used, commitments));
  return commitments;
}

/** Any proposal change returns it to editable: the version advances and every confirmation-time fact is dropped. */
function reopenProposal(store: ControlStore, id: string, group: Group, proposal: BudgetProposalRecord, commitments: Amount): void {
  proposal.proposalVersion = safeNumber(BigInt(proposal.proposalVersion) + 1n);
  proposal.state = "editable"; proposal.budgetMode = null; proposal.profiles = null; proposal.executionSnapshotHash = null;
  proposal.contextPolicy = { handoffAtContextTokens: null };
  proposal.allocations.forEach(a => { a.state = "draft-encumbered"; });
  group.status = "draft"; group.ledger.committedRemaining = commitments;
  for (const row of store.db.prepare("SELECT id,body FROM work_items WHERE group_id=?").all(id)) {
    const work = JSON.parse(String(row.body));
    if (work.kind !== "task") continue;
    work.status = "draft"; work.derivedContractHash = null;
    // Agent selection spec §6.4: a reopened proposal has no frozen selection; the next confirmation freezes one.
    work.configHash = null;
    for (const key of ["agent", "agentProvenance", "timeoutMs", "killGraceMs", "agentCapabilities"]) delete work[key];
    work.grant = { work: proposal.allocations.find(a => a.ownerId === row.id && a.bucket === "work")!.amount, handoff: proposal.allocations.find(a => a.ownerId === row.id && a.bucket === "handoff")!.amount };
    store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id=?").run(JSON.stringify(work), id, row.id);
  }
  (group as Record<string, unknown>).reconcileSlot = null;
  saveWebAuthority(store, group, proposal);
}

/** Web commands only publish durable authority. Provider invocation belongs to scheduler delivery. */
export class WebControlService {
  readonly store: ControlStore;
  constructor(readonly deps: WebServiceDeps) { this.store = deps.store; }
  private mutate<T>(action: () => T): T { const release = this.deps.admissionGate?.enter(); try { return action(); } finally { release?.(); } }
  async importPlan(command: ImportCommand): Promise<WebCommandResult> {
    const release = this.deps.admissionGate?.enter(); try { return await importControlPlanAsync(this.deps, command); } finally { release?.(); }
  }
  editProposal(command: ProposalEditCommand): WebCommandResult {
    return this.mutate(() => applyWebCommand(this.store, {
      rawCommand: command,
      expand: () => ({ ...command, schema: "orca-authority-command-v1", payload: { ...command.payload, proposedGroupLimit: command.payload.proposedGroupLimit ?? null, operations: command.payload.operations.map(op => ({ ...op, estimateId: op.estimateId ?? null })) } }),
      apply: context => {
        const id = groupId(command), group = readWebGroup(this.store, id), proposal = readBudgetProposal(this.store, id);
        const payload = context.effectiveCommand.payload as EffectiveProposalEditPayload;
        if (proposal.proposalVersion !== payload.baseProposalVersion) throw new ControlError("proposal-version-conflict");
        prestart(group); refuseAfterTaskStarted(this.store, id);
        assertKnownConservation(this.store, group, proposal);
        // Loop plans spec §4.3 (C6, Rule 7): a loop task's work allocation has one owner, set-task-loop.
        const loopTasks = new Set(readArchivedPlan(this.store, id).plan.tasks.filter(task => task.loop !== undefined).map(task => task.taskId));
        const seen = new Set<string>();
        const before = canonicalBytes({ allocations: proposal.allocations, limit: proposal.groupLimit });
        for (const op of payload.operations) {
          const key = canonicalBytes(op.target).toString("utf8");
          if (seen.has(key)) throw new ControlError("duplicate-proposal-target"); seen.add(key);
          if (op.target.scope === "task" && op.target.allocation === "work" && loopTasks.has(op.target.taskId)) throw new ControlError("budget-owned-by-loop-plan");
          const row = allocationFor(proposal, op.target);
          if (row.bucket === "work" && op.value <= 0) throw new ControlError("execution-policy-unrepresentable");
          if (op.provenance === "model") {
            verifyModelField(this.store, id, proposal, op.target, op.value, op.estimateId!);
            refuseStaleEstimate(this.store, id, op.estimateId!);
          }
          if (op.provenance === "complex-1m-default") {
            const defaults = op.target.scope === "goal-review" ? GOAL_REVIEW : op.target.allocation === "work" ? TASK_WORK : TASK_HANDOFF;
            if (op.value !== defaults[op.target.dimension]) throw new ControlError("proposal-version-conflict");
          }
          row.amount[op.target.dimension] = op.value;
          row.fieldProvenance[op.target.dimension] = { provenance: op.provenance, estimateId: op.estimateId };
        }
        proposal.groupLimit = payload.proposedGroupLimit ?? proposal.groupLimit;
        const commitments = resetDraftReserve(this.store, id, group, proposal);
        if (before.equals(canonicalBytes({ allocations: proposal.allocations, limit: proposal.groupLimit }))) throw new ControlError("no-op-command");
        reopenProposal(this.store, id, group, proposal, commitments);
        return success(context, { kind: "proposal-edited", proposalVersion: proposal.proposalVersion });
      },
    }).body);
  }
  /** Agent selection spec §6.2 (W6-20): replace or clear one selection layer -- a proposal change like any other. */
  async proposalSetAgent(command: ProposalSetAgentCommand): Promise<WebCommandResult> {
    return this.mutate(() => applyWebCommand(this.store, {
      rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      apply: context => {
        const id = groupId(command), group = readWebGroup(this.store, id), proposal = readBudgetProposal(this.store, id);
        const { scope, partial, baseProposalVersion } = command.payload;
        if (proposal.proposalVersion !== baseProposalVersion) throw new ControlError("proposal-version-conflict");
        prestart(group); refuseAfterTaskStarted(this.store, id);
        assertKnownConservation(this.store, group, proposal);
        if (scope.kind === "group") {
          const overrides = readGroupAgentOverrides(group);
          const before = canonicalBytes(overrides);
          if (partial === null) delete overrides[scope.slot];
          else overrides[scope.slot] = partial;
          if (before.equals(canonicalBytes(overrides))) throw new ControlError("no-op-command");
          (group as Record<string, unknown>).agentOverrides = overrides;
        } else {
          const row = this.store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(id, scope.taskId);
          const work = row ? JSON.parse(String(row.body)) : null;
          if (!work || work.kind !== "task") throw new ControlError("work-not-found");
          if (canonicalBytes(work.agentOverride ?? null).equals(canonicalBytes(partial))) throw new ControlError("no-op-command");
          work.agentOverride = partial;
          this.store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id=?").run(JSON.stringify(work), id, scope.taskId);
        }
        const commitments = resetDraftReserve(this.store, id, group, proposal);
        reopenProposal(this.store, id, group, proposal, commitments);
        return success(context, { kind: "proposal-edited", proposalVersion: proposal.proposalVersion });
      },
    }).body);
  }
  async createEstimate(command: ReestimateCommand): Promise<WebCommandResult> {
    const release = this.deps.admissionGate?.enter();
    try {
      const replay = preflightWebCommand(this.store, command); if (replay) return replay.body;
      let prepared: ReturnType<typeof buildBudgetEstimateRequest>;
      let estimatorSlot: FrozenSlot | null;
      try {
        const id = groupId(command), group = readWebGroup(this.store, id);
        const plan = readArchivedPlan(this.store, id), proposal = readBudgetProposal(this.store, id);
        if (proposal.proposalVersion !== command.payload.proposalVersion) throw new ControlError("proposal-version-conflict");
        prestart(group);
        const profile = this.deps.profileRouter.resolve("budget-estimate", command.payload.estimatorProfileId, command.payload.estimatorProfileHash);
        // Spec §6.4: a re-estimate resolves the estimator layers as they are now -- including the group's, which only
        // the panel sets (controller ruling R7) -- and freezes them for this estimate only.
        const overrides = readGroupAgentOverrides(group);
        const slot = await estimatorSlotFor({ store: this.store, profileRouter: this.deps.profileRouter }, command.actorId, overrides, profile);
        estimatorSlot = slot.outcome.kind === "frozen" ? slot.outcome.slot : null;
        prepared = slot.outcome.kind === "rejected"
          ? rejectedEstimatorRequest(slot.outcome.code)
          // W6: the model reads each task as set-task-loop last left it; planHash stays the archive's identity.
          : buildBudgetEstimateRequest({ planHash: plan.planHash, planCanonicalJson: plan.canonicalJson, effectivePlanCanonicalJson: effectivePlanCanonicalJson(this.store, id),
            profile, observation: slot.observation, mode: command.payload.estimateMode, exactTokenCount: this.deps.exactTokenCount });
      } catch (error) {
        return applyWebCommand<WebCommandResult>(this.store, { rawCommand: command, expand: () => { throw error; }, apply: () => { throw error; } }).body;
      }
      return applyWebCommand(this.store, {
        rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
        apply: context => {
          const id = groupId(command), group = readWebGroup(this.store, id), proposal = readBudgetProposal(this.store, id);
          if (proposal.proposalVersion !== command.payload.proposalVersion) throw new ControlError("proposal-version-conflict");
          prestart(group);
          this.deps.profileRouter.resolve("budget-estimate", command.payload.estimatorProfileId, command.payload.estimatorProfileHash);
          const estimateVersion = safeNumber(BigInt(Number(this.store.db.prepare("SELECT MAX(estimate_version) AS n FROM estimates WHERE group_id=?").get(id)?.n ?? 0)) + 1n);
          const estimateId = `estimate-${sha256Canonical({ groupId: id, planHash: proposal.planHash, version: estimateVersion }).slice(0, 24)}`;
          if (prepared.state === "queued") {
            assertKnownConservation(this.store, group, proposal);
            group.ledger.committedRemaining = sumAmounts([group.reserved, ESTIMATE_GRANT]);
            setReserve(proposal, residual(group.limit, group.used, group.ledger.committedRemaining));
          }
          const estimate = { estimateId, estimateVersion, state: prepared.state, profile: { profileId: command.payload.estimatorProfileId, profileHash: command.payload.estimatorProfileHash }, mode: command.payload.estimateMode,
            requestHash: prepared.requestHash, request: prepared.request, outputHash: null, output: null, reasonCode: prepared.reasonCode, grant: ESTIMATE_GRANT, estimatorSlot };
          this.store.db.prepare("INSERT INTO estimates(group_id,id,estimate_version,state,body) VALUES (?,?,?,?,?)").run(id, estimateId, estimateVersion, prepared.state, canonicalBytes(estimate).toString("utf8"));
          persistEstimateArtifacts(this.store, id, estimateId, prepared);
          const wakeId = prepared.state === "queued" ? `scheduler-wake:${id}:estimate:${estimateId}` : null;
          if (wakeId) this.store.db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES (?,?,'budget-estimate',?,0)").run(wakeId, id, JSON.stringify({ groupId: id, estimateId, planHash: proposal.planHash }));
          saveWebAuthority(this.store, group, proposal);
          return success(context, { kind: "estimate-created", estimateId, estimateVersion, estimateState: prepared.state, reasonCode: prepared.reasonCode, wakeId }, wakeId ? 202 : 200);
        },
      }).body;
    } finally { release?.(); }
  }
  /** Claim hook for durable wake delivery. It does not accept or invoke a provider. */
  async claimEstimate(id: string, estimateId: string): Promise<EstimateRun | null> {
    const release = this.deps.admissionGate?.enter();
    try {
      const initial = readEstimateRecord(this.store, id, estimateId);
      if (!["queued", "running", "start-unknown"].includes(initial.state)) return null;
      const profile = this.deps.profileRouter.resolve("budget-estimate", initial.profile.profileId, initial.profile.profileHash);
      // Spec §6.4 last paragraph: the claim probes the estimate's frozen estimator selection. An estimate without one is
      // never queued; asking `{}` lets the port refuse it, which degrades the estimate below.
      const observation = await this.deps.profileRouter.probe(profile, initial.estimatorSlot?.selection ?? {});
      return this.store.transaction(() => {
        const estimate = readEstimateRecord(this.store, id, estimateId), group = readWebGroup(this.store, id), proposal = readBudgetProposal(this.store, id);
        if (!["queued", "running", "start-unknown"].includes(estimate.state)) return null;
        const existing = this.store.db.prepare("SELECT body FROM runs WHERE group_id=? AND work_item_id=?").get(id, estimateId);
        if (existing) return JSON.parse(String(existing.body)) as EstimateRun;
        if (estimate.state !== "queued" || !estimate.request) throw new ControlError("recovery-blocked");
        prestart(group); assertKnownConservation(this.store, group, proposal);
        if (group.stopped) throw new ControlError("group-stopped");
        this.deps.profileRouter.resolve("budget-estimate", estimate.profile.profileId, estimate.profile.profileHash);
        if (estimateCapabilityDegraded(estimate.request, observation, estimate.mode)) {
          estimate.state = "blocked-capability"; estimate.reasonCode = "estimate-capability-degraded";
          group.ledger.committedRemaining = residual(group.reserved, zero(), estimate.grant);
          setReserve(proposal, residual(group.limit, group.used, group.ledger.committedRemaining));
          this.store.db.prepare("UPDATE estimates SET state=?,body=? WHERE group_id=? AND id=?").run(estimate.state, canonicalBytes(estimate).toString("utf8"), id, estimateId);
          saveWebAuthority(this.store, group, proposal); recordProjectionChange(this.store, [id]);
          return null;
        }
        const bindingRow = this.store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='estimate-contract'").get(`estimate-contract:${id}:${estimateId}`);
        if (!bindingRow) throw new ControlError("recovery-blocked");
        const binding = z.object({ groupId: z.literal(id), estimateId: z.literal(estimateId), requestHash: z.literal(estimate.requestHash), contractHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(JSON.parse(String(bindingRow.body)));
        const contract = estimateExecutionContractSchema.parse(JSON.parse(readCanonicalRecord(this.store, binding.contractHash)));
        if (contract.requestHash !== estimate.requestHash || !same(contract.profile, estimate.profile) || !same(contract.grant, estimate.grant)
          || !same(contract.estimatorCapabilities, estimate.request.estimatorCapabilities)) throw new ControlError("recovery-blocked");
        // Spec §12 C5: the estimate run's configHash is its frozen estimator selection's, never the profile hash.
        const slot = estimate.estimatorSlot;
        if (!slot) throw new ControlError("recovery-blocked", "estimator-slot-missing");
        const plan = readArchivedPlan(this.store, id), runId = `run-${randomUUID()}`;
        // N1 spec §5.1 (PR-I4): the run row and the frozen envelope are every single call's; the claim row is the estimate's.
        const { run, envelopeHash } = insertSingleCallRun(this.store, {
          groupId: id, workItemId: estimateId, runId, ownerToken: randomUUID(), purpose: "estimate", identity: { estimateId },
          graphVersion: plan.graphVersion, targetVersion: estimate.estimateVersion, commandId: estimateId, slot,
          agentCapabilities: intersectCapabilities(profile.snapshot.profile.capabilities, slot.capabilities), workGrant: estimate.grant, profile: estimate.profile,
          claimIdentity: `estimate:${id}:${estimateId}`, derivedContractHash: binding.contractHash,
        });
        this.store.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?,'estimate-claim',?,0)").run(`estimate:${id}:${estimateId}`, canonicalBytes({ groupId: id, estimateId, runId, envelopeHash, sessionReservation: 1, attemptReservation: 0 }).toString("utf8"));
        estimate.state = "running";
        this.store.db.prepare("UPDATE estimates SET state=?,body=? WHERE group_id=? AND id=?").run(estimate.state, canonicalBytes(estimate).toString("utf8"), id, estimateId);
        recordProjectionChange(this.store, [id]); return run as EstimateRun;
      });
    } finally { release?.(); }
  }
  /** The scheduler verifies evidence first, then commits terminal state in this same transaction. */
  completeEstimate(id: string, estimateId: string, rawOutput: unknown, commitTerminal?: () => void): void {
    completeEstimateInStore({ store: this.store, admissionGate: this.deps.admissionGate }, id, estimateId, rawOutput, commitTerminal);
  }
  async start(command: StartCommand): Promise<WebCommandResult> {
    return scheduleStart({ store: this.store, profileRouter: this.deps.profileRouter, admissionGate: this.deps.admissionGate }, command);
  }
  private stopDeps(): StopDeps {
    return { store: this.store, profileRouter: this.deps.profileRouter, admissionGate: this.deps.admissionGate, now: this.deps.now, beforeCommit: this.deps.beforeCommit };
  }
  async pauseDispatch(command: PauseCommand): Promise<WebCommandResult> {
    return applyPauseDispatch(this.stopDeps(), command) as WebCommandResult;
  }
  async handoffStop(command: HandoffStopCommand): Promise<WebCommandResult> {
    return applyHandoffStop(this.stopDeps(), command) as WebCommandResult;
  }
  async resumeDispatch(command: ResumeDispatchCommand): Promise<WebCommandResult> {
    return applyResumeDispatch(this.stopDeps(), command) as WebCommandResult;
  }
  async recoveryRetry(command: RecoveryRetryCommand): Promise<WebCommandResult> {
    return applyRecoveryRetry(this.stopDeps(), command) as WebCommandResult;
  }
  /** N1 spec §11.1. */
  openRequirement(command: RequirementOpenCommand): Promise<WebCommandResult> { return applyRequirementOpen(this.deps, command); }
  answerRequirement(command: RequirementAnswerCommand): WebCommandResult { return applyRequirementAnswer(this.deps, command); }
  requirementConsensus(command: RequirementConsensusCommand): WebCommandResult { return applyRequirementConsensus(this.deps, command); }
  requirementDraftFeedback(command: RequirementDraftFeedbackCommand): WebCommandResult { return applyRequirementDraftFeedback(this.deps, command); }
  /** N1 spec §9.1. */
  acceptRequirementDraft(command: RequirementDraftAcceptCommand): Promise<WebCommandResult> { return applyRequirementDraftAccept(this.deps, command); }
  /** Execution driver spec §3.2. A panel started without the repository refuses it by name. */
  async setWorkspaceMode(command: SetWorkspaceModeCommand): Promise<WebCommandResult> {
    return applySetWorkspaceMode({ store: this.store, admissionGate: this.deps.admissionGate, knownRepository: this.deps.knownRepository ?? (() => false) }, command) as WebCommandResult;
  }
  repositoryKnown(repoId: string): boolean { return this.deps.knownRepository?.(repoId) ?? false; }
  /** Agent selection spec §6.2 layer 1: the operator's defaults, under their own revision. */
  async setAgentPreferences(command: SetAgentPreferencesCommand): Promise<WebCommandResult> {
    return applySetAgentPreferences({ store: this.store, admissionGate: this.deps.admissionGate }, command) as WebCommandResult;
  }
  async resumeFromHandoff(command: ResumeFromHandoffCommand): Promise<WebCommandResult> {
    return applyResumeFromHandoff(this.stopDeps(), command) as WebCommandResult;
  }
  async continueTask(command: ContinueTaskCommand): Promise<WebCommandResult> {
    return applyContinueTask(this.stopDeps(), command) as WebCommandResult;
  }
  /**
   * Agent selection spec §6.4 (§12 C4): resolve every slot through ccloop outside the transaction, then freeze only
   * if what was resolved is what the operator saw and no layer moved since. A slot failure is decided inside the
   * transaction, after every existing check, so the precedence of the existing error codes is unchanged.
   */
  async confirm(command: ConfirmCommand): Promise<WebCommandResult> {
    const release = this.deps.admissionGate?.enter();
    try {
      const replay = preflightWebCommand<WebCommandResult>(this.store, command); if (replay) return replay.body;
      const prepared: GroupSelectionResolution | { failure: unknown } = await resolveGroupSelections({ store: this.store, port: this.deps.port }, groupId(command), command.actorId, "confirm")
        .catch((failure: unknown) => ({ failure }));
      const skillLookup = await lookupSkillProfiles(this.store, groupId(command), this.deps.syncskill ?? UNCONFIGURED_SYNCSKILL);
      return applyWebCommand<WebCommandResult>(this.store, {
        rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
        apply: context => {
          const id = groupId(command), group = readWebGroup(this.store, id), plan = readArchivedPlan(this.store, id), proposal = readBudgetProposal(this.store, id), payload = command.payload;
          if (payload.planHash !== plan.planHash) throw new ControlError("plan-version-conflict");
          if (payload.proposalVersion !== proposal.proposalVersion) throw new ControlError("proposal-version-conflict");
          prestart(group); refuseAfterTaskStarted(this.store, id);
          if (proposal.state === "confirmed") throw new ControlError("no-op-command");
          assertKnownConservation(this.store, group, proposal);
          const selected = { estimator: this.deps.profileRouter.resolve("budget-estimate", payload.profileIds.estimator, payload.profileHashes.estimator), worker: this.deps.profileRouter.resolve("task", payload.profileIds.worker, payload.profileHashes.worker), handoff: this.deps.profileRouter.resolve("handoff", payload.profileIds.handoff, payload.profileHashes.handoff), goalReview: this.deps.profileRouter.resolve("goal-review", payload.profileIds.goalReview, payload.profileHashes.goalReview) };
          const window = selected.worker.snapshot.profile.capabilities.contextWindowTokens, threshold = payload.contextPolicy.handoffAtContextTokens;
          if (window === null ? threshold !== null : threshold === null || threshold > window) throw new ControlError("execution-policy-unrepresentable");
          const profiles = Object.fromEntries(Object.entries(selected).map(([slot, p]) => [slot, { profileId: p.snapshot.profile.profileId, profileHash: p.profileHash }])) as Record<keyof typeof selected, ProfileBindingV1>;
          for (const row of proposal.allocations) for (const d of dimensions) {
            const source = row.fieldProvenance[d];
            if (source.provenance !== "model") continue;
            if (row.ownerKind === "reserve") throw new ControlError("proposal-version-conflict");
            const target = row.ownerKind === "goal-review" ? { scope: "goal-review" as const, dimension: d } : { scope: "task" as const, taskId: row.ownerId, allocation: row.bucket as "work" | "handoff", dimension: d };
            verifyModelField(this.store, id, proposal, target, row.amount[d], source.estimateId!);
          }
          // Spec §6.4 step 2: any failed slot refuses the whole confirmation, named after the first one by key.
          if ("failure" in prepared) throw prepared.failure;
          const resolution: GroupSelectionResolution = prepared;
          const rejected = resolution.slots.find(slot => slot.outcome.kind === "rejected");
          if (rejected && rejected.outcome.kind === "rejected") throw new ControlError("agent-selection-rejected", `${rejected.taskId ?? RECONCILE_SLOT_KEY}:${rejected.outcome.code}`);
          // Step 3: what was resolved is what the operator saw, and the layers have not moved since (checked inside the transaction).
          if (payload.selectionsHash !== resolution.selectionsHash || resolution.proposalVersion !== proposal.proposalVersion
            || !canonicalBytes(answeredPartials(resolution)).equals(canonicalBytes(currentPartials(this.store, id, command.actorId)))) throw new ControlError("agent-selection-changed");
          const frozenOf = (key: string) => {
            const slot = resolution.slots.find(entry => entry.key === key);
            if (!slot || slot.outcome.kind !== "resolved") throw new ControlError("recovery-blocked", `slot-missing:${key}`);
            return slot.outcome.frozen;
          };
          // Spec §6.5: a task's capabilities are the worker profile's declaration intersected with ccloop's answer for its selection.
          const workerDeclared = selected.worker.snapshot.profile.capabilities;
          const agentTasks = plan.plan.tasks.map(task => {
            const frozen = frozenOf(taskSlotKey(task.taskId));
            return { taskId: task.taskId, agent: frozen.selection, agentProvenance: frozen.provenance, configHash: frozen.configHash,
              timeoutMs: frozen.timeoutMs, killGraceMs: frozen.killGraceMs, agentCapabilities: intersectCapabilities(workerDeclared, frozen.capabilities) };
          });
          const reconcileSlot = frozenOf(RECONCILE_SLOT_KEY);
          // Loop plans spec §5.1 (C5): each task is frozen with its contract as amended, when it was.
          const tasks = plan.plan.tasks.map(archived => {
            const task = effectivePlanTask(this.store, id, archived, workBodyOf(this.store, id, archived.taskId));
            const work = proposal.allocations.find(a => a.ownerId === task.taskId && a.bucket === "work")!.amount;
            const handoff = proposal.allocations.find(a => a.ownerId === task.taskId && a.bucket === "handoff")!.amount;
            if (selected.handoff.snapshot.profile.capabilities.handoffExecution === "model-assisted-v1" && dimensions.some(d => handoff[d] < 1)) throw new ControlError("handoff-grant-insufficient");
            return { ...task, work, handoff };
          });
          // Syncskill integration spec §10.5: a lookup failure (or syncskill unset while any task declares skills) refuses
          // the whole confirmation, decided here as a slot failure is; then each task's skill set is frozen -- names as
          // declared, a profile as syncskill answered it.
          if ("failure" in skillLookup) throw skillLookup.failure;
          const skills = tasks.flatMap((task): Array<{ taskId: string; profile: string | null; names: string[] }> => {
            const declared = task.loop?.skills;
            if (declared === undefined) return [];
            // The agent's kind is not known here (selection.agent is an installation id): ccloop's acceptStart refuses a non-claude agent with skills.
            if ("names" in declared) return [{ taskId: task.taskId, profile: null, names: [...declared.names] }];
            const names = skillLookup.members.get(declared.profile);
            // Defensive: a recipe changed since the lookup reopens the proposal, refused above as proposal-version-conflict.
            if (names === undefined) throw new ControlError("recovery-blocked", `skills-lookup-missing:${task.taskId}`);
            return [{ taskId: task.taskId, profile: declared.profile, names }];
          });
          const built = prepareExecutionSnapshot({ store: this.store, groupId: id, planHash: plan.planHash, graphVersion: plan.graphVersion, proposalVersion: proposal.proposalVersion,
            proposalIdentity: { groupId: id, planHash: plan.planHash, proposalVersion: proposal.proposalVersion }, groupLimit: proposal.groupLimit, budgetMode: payload.budgetMode, contextPolicy: payload.contextPolicy, profiles,
            allocations: [...proposal.allocations.map(({ state: _state, ...a }) => a), ...estimateCommitments(this.store, id)], tasks, agents: { tasks: agentTasks, reconcile: reconcileSlot }, skills });
          for (const derived of built.derivedContracts) {
            writeCanonicalRecord(this.store, id, derived.derivedContractHash, derived.canonicalJson);
            const workRow = this.store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(id, derived.taskId);
            if (!workRow) throw new ControlError("recovery-blocked");
            const work = JSON.parse(String(workRow.body));
            // Spec §6.4 step 4: the work item carries exactly what the snapshot freezes for its task.
            const { taskId: _taskId, ...frozen } = agentTasks.find(entry => entry.taskId === derived.taskId)!;
            Object.assign(work, frozen);
            work.derivedContractHash = derived.derivedContractHash; work.status = "ready"; work.claimOrdinal = 0; work.currentRunId = null; work.pendingRunId = null; work.lineageRunIds = [];
            this.store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id=?").run(JSON.stringify(work), id, derived.taskId);
          }
          writeCanonicalRecord(this.store, id, built.snapshotHash, built.canonicalJson);
          (group as Record<string, unknown>).reconcileSlot = reconcileSlot;
          proposal.state = "confirmed"; proposal.budgetMode = payload.budgetMode; proposal.contextPolicy = payload.contextPolicy; proposal.profiles = profiles; proposal.executionSnapshotHash = built.snapshotHash;
          proposal.allocations.forEach(a => { a.state = "confirmed"; }); group.status = "ready"; group.budgetMode = payload.budgetMode;
          saveWebAuthority(this.store, group, proposal);
          this.deps.beforeCommit?.();
          return success(context, { kind: "confirmed", executionSnapshotHash: built.snapshotHash });
        },
      }).body;
    } finally { release?.(); }
  }
  setLimit(command: SetLimitCommand): WebCommandResult {
    return this.mutate(() => applyWebCommand(this.store, {
      rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      apply: context => {
        const id = groupId(command), group = readWebGroup(this.store, id);
        // N1 spec §11.1 (survey S6): before any proposal read, which a clarifying group does not have.
        if (group.status === "clarifying") return success(context, { kind: "limit-set", limit: setRequirementLimit(this.store, id, command.payload.limit) });
        const proposal = readBudgetProposal(this.store, id);
        if (!["ready", "running", "review"].includes(group.status)) throw new ControlError("group-state-invalid");
        const limit = command.payload.limit;
        if (same(limit, group.limit)) throw new ControlError("no-op-command");
        // Unknown usage cannot authorize a decrease or a new allocation.
        const decreasing = dimensions.some(d => limit[d] < group.limit[d]);
        if (decreasing || !group.ledger.usageUnknown) assertKnownConservation(this.store, group, proposal);
        proposal.groupLimit = limit;
        setReserve(proposal, residual(limit, group.used, group.reserved));
        saveWebAuthority(this.store, group, proposal);
        return success(context, { kind: "limit-set", limit });
      },
    }).body);
  }
  /**
   * Labels and progress spec §3.1 (§8 R6-R8, R16; human ruling L-2): replace or clear a task's operator label layer.
   * Any group state, no proposal change, no re-confirmation: labels are not budget authority. Checked in the spec's
   * order -- the work item, the labels version, the labels themselves, then no-op -- and the vocabulary here, not in the
   * payload schema, so a refusal is ledgered and names the label (R8).
   */
  setTaskLabels(command: SetTaskLabelsCommand): WebCommandResult {
    return this.mutate(() => applyWebCommand(this.store, {
      rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      apply: context => {
        const id = groupId(command), taskId = command.target.taskId;
        // N1 spec §4.1 (survey S14): a clarifying group has no work items to label.
        refuseClarifying(this.store, id);
        readWebGroup(this.store, id);
        const row = this.store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(id, taskId);
        const work = row ? JSON.parse(String(row.body)) as Record<string, unknown> : null;
        if (!work || work.kind !== "task") throw new ControlError("work-not-found");
        const state = readTaskLabelState(work);
        if (command.payload.baseLabelsVersion !== state.version) throw new ControlError("labels-version-conflict");
        let next: string[] | null = null;
        if (command.payload.labels === null) {
          if (state.override === null) throw new ControlError("no-op-command");
        } else {
          const checked = normalizeInputLabels(command.payload.labels);
          if (!checked.ok) throw new ControlError("labels-invalid", checked.detail);
          const planTask = readArchivedPlan(this.store, id).plan.tasks.find(task => task.taskId === taskId);
          if (same(checked.labels, effectiveTaskLabels(state, planTask?.labels).labels)) throw new ControlError("no-op-command");
          next = checked.labels;
        }
        if (state.version === Number.MAX_SAFE_INTEGER) throw new ControlError("numeric-overflow");
        work.labelsOverride = next; work.labelsVersion = state.version + 1;
        this.store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id=?").run(JSON.stringify(work), id, taskId);
        return success(context, { kind: "task-labels-set", taskId, labelsVersion: state.version + 1 });
      },
    }).body);
  }
  /**
   * Loop plans spec §5.2 (C5, C6): change a not-yet-started loop task's plan, inputs and work budget, before or after
   * confirmation. The archived plan is never rewritten: the new contract lives in a hashed amendment record that
   * effectivePlanTask verifies (taskAmendments.ts). The budget's delta comes out of, or goes back to, the group's
   * reserve; the group limit, `used` and `sessions` never move. Any failure rolls the whole transaction back.
   */
  async setTaskLoop(command: SetTaskLoopCommand): Promise<WebCommandResult> {
    const release = this.deps.admissionGate?.enter();
    try {
      const replay = preflightWebCommand<WebCommandResult>(this.store, command); if (replay) return replay.body;
      // Syncskill integration spec §10.5: the lookup runs before the transaction, as confirm's does (decided synchronously
      // here, before the first await).
      const skillLookup = await lookupProfile(profileToLookUp(this.store, groupId(command), command.target.taskId, command.payload.skills), this.deps.syncskill ?? UNCONFIGURED_SYNCSKILL);
      return applyWebCommand<WebCommandResult>(this.store, {
        rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
        apply: context => {
          const id = groupId(command), taskId = command.target.taskId, payload = command.payload;
          const group = readWebGroup(this.store, id), proposal = readBudgetProposal(this.store, id), plan = readArchivedPlan(this.store, id);
          // Step 1. Not prestart: the spec names one code for every state but draft/ready (prestart answers
          // grant-amendment-unsupported for running/review/done), and a stopped group is refused too.
          assertKnownConservation(this.store, group, proposal);
          if ((group.status !== "draft" && group.status !== "ready") || group.stopped) throw new ControlError("group-state-invalid");
          const body = workBodyOf(this.store, id, taskId);
          const work = typeof body === "object" && body !== null && !Array.isArray(body) ? body as Record<string, unknown> : null;
          const archived = plan.plan.tasks.find(task => task.taskId === taskId);
          if (!work || work.kind !== "task" || !archived) throw new ControlError("work-not-found");
          // Step 2: any runs row counts -- a finished run returns its task to ready. Decided inside this transaction, so
          // this command and the driver's claim (webDispatch.ts nextClaimableTask, createStartingRun) cannot both win.
          if ((work.status !== "draft" && work.status !== "ready")
            || this.store.db.prepare("SELECT id FROM runs WHERE group_id=? AND work_item_id=?").get(id, taskId)) throw new ControlError("task-already-started");
          // Step 3. The in-flight predicate is scheduleStart's (webDispatch.ts), Drafter finding F8.
          for (const estimate of this.store.db.prepare("SELECT state FROM estimates WHERE group_id=?").all(id)) {
            if (["running", "start-unknown"].includes(String(estimate.state))) throw new ControlError("estimate-in-flight");
          }
          const loopVersion = typeof work.loopVersion === "number" ? work.loopVersion : 0;
          if (payload.baseLoopVersion !== loopVersion) throw new ControlError("task-loop-version-conflict");
          if (archived.loop === undefined) throw new ControlError("task-has-no-loop-plan");
          // Step 4. repoPath is the current contract's own (Drafter finding F9).
          const current = effectivePlanTask(this.store, id, archived, work);
          const repoPath = taskContractSchema.parse(JSON.parse(current.originalContractCanonicalJson)).context.repoPath;
          // W7 ruling: the task's own plan with its own inputs keeps the recipe's plan version, so a budget-only change (or an
          // estimate's suggestion) never silently re-expands an older version's task at the current one; a change of plan
          // or inputs expands at the current version. The kept recipe keeps its chosenBy too (final review C1): the plan is
          // still the one the labels chose, and rewriting it would change the effective plan and make every estimate stale.
          // Syncskill integration spec §10.4: skills are left out of `kept` (a skills-only change keeps a v1 recipe at v1);
          // the kept recipe takes the payload's skills, and a payload without them removes them.
          const kept = current.loop !== undefined && current.loop.planId === payload.plan
            && canonicalBytes(current.loop.inputs).equals(canonicalBytes(payload.inputs));
          const skills = payload.skills === undefined ? undefined : normalizeLoopSkills(payload.skills);
          if (skills === "skills-shape") throw new ControlError("loop-plan-invalid", skills);
          const expanded: LoopTaskExpansion = kept ? keptExpansion(taskId, repoPath, current.loop!, payload.inputs, skills)
            : expandLoopPlan(taskId, repoPath, payload.plan, payload.inputs, "explicit", skills);
          if (!expanded.ok) throw new ControlError("loop-plan-invalid", expanded.reason);
          const allocation = proposal.allocations.find(a => a.ownerKind === "task" && a.ownerId === taskId && a.bucket === "work");
          const handoff = proposal.allocations.find(a => a.ownerKind === "task" && a.ownerId === taskId && a.bucket === "handoff");
          if (!allocation || !handoff) throw new ControlError("recovery-blocked");
          const before = allocation.amount;
          // R10: sessions is not in the payload; it is carried over unchanged.
          const next: Amount = { ...before, tokens: payload.work.tokens, activeMs: payload.work.activeMs, attempts: payload.work.attempts };
          // A plan-version bump with identical bytes is a no-op too; the recipe then keeps its version.
          // Spec §10.4: a skills-only change is not a no-op.
          const skillsUnchanged = canonicalBytes(current.loop?.skills ?? null).equals(canonicalBytes(expanded.recipe.skills ?? null));
          if (expanded.canonicalJson === current.originalContractCanonicalJson && same(next, before) && skillsUnchanged) throw new ControlError("no-op-command");
          // W5: a dimension taken from an estimate is its suggestion for this task's work allocation (proposal-edit's rule).
          const modelDimensions = Object.entries(payload.workProvenance ?? {}).flatMap(([d, source]) => source ? [{ dimension: d as "tokens" | "activeMs" | "attempts", estimateId: source.estimateId }] : []);
          for (const { dimension, estimateId } of modelDimensions) {
            verifyModelField(this.store, id, proposal, { scope: "task", taskId, allocation: "work", dimension }, next[dimension], estimateId);
          }
          // Step 6's refusal, before anything is written: the reserve may not go negative in any dimension.
          for (const d of dimensions) {
            const shortfall = next[d] - before[d] - proposal.explicitUnallocatedReserve[d];
            if (shortfall > 0) throw new ControlError("group-reserve-insufficient", `${d}:${shortfall}`);
          }
          if (loopVersion === Number.MAX_SAFE_INTEGER) throw new ControlError("numeric-overflow");
          // Syncskill integration spec §10.5: a lookup failure (or syncskill unset when a lookup was needed) refuses the change,
          // decided here after every existing check, as at confirm.
          if ("failure" in skillLookup) throw skillLookup.failure;
          // Step 5.
          const amendmentHash = writeTaskAmendment(this.store, id, {
            schema: TASK_AMENDMENT_SCHEMA, groupId: id, taskId, loopVersion: loopVersion + 1, previousContractHash: current.originalContractHash,
            recipe: expanded.recipe, originalContractHash: expanded.hash, originalContractCanonicalJson: expanded.canonicalJson,
          });
          writeCanonicalRecord(this.store, id, expanded.hash, expanded.canonicalJson);
          // Drafter finding F10: the projection compares both contract hashes; the claim copies derivedContractHash and grant.
          Object.assign(work, { amendmentHash, loopVersion: loopVersion + 1, originalContractHash: expanded.hash, contract: { contentAddressedHash: expanded.hash } });
          // H12 (human, 2026-10-01): once a change writes a contract other than the task's previous one, the card keeps
          // saying "changed", even after a later change back to the imported contract. Never cleared; a budget-only change
          // (same contract bytes) does not set it.
          if (expanded.canonicalJson !== current.originalContractCanonicalJson) work.planChanged = true;
          // Step 6.
          for (const d of dimensions) if (next[d] !== before[d]) allocation.fieldProvenance[d] = { provenance: "human", estimateId: null };
          for (const { dimension, estimateId } of modelDimensions) allocation.fieldProvenance[dimension] = { provenance: "model", estimateId };
          allocation.amount = next;
          if (proposal.state === "editable") {
            // Step 7, draft: the proposal version advances, as every proposal change does, so a stale confirm is refused.
            this.store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id=?").run(JSON.stringify(work), id, taskId);
            reopenProposal(this.store, id, group, proposal, resetDraftReserve(this.store, id, group, proposal));
          } else {
            // Step 7, confirmed: proposalVersion is inside every derived record and checked at A2 and in the projection,
            // so it does not move; only this task's contract is re-derived, at the same derivationVersion.
            for (const d of dimensions) group.ledger.committedRemaining[d] += next[d] - before[d];
            setReserve(proposal, residual(proposal.groupLimit, group.used, group.ledger.committedRemaining));
            const derived = deriveContract({ taskId, originalContractHash: expanded.hash, originalContractCanonicalJson: expanded.canonicalJson, work: next, handoff: handoff.amount }, proposal.proposalVersion);
            writeCanonicalRecord(this.store, id, derived.derivedContractHash, derived.canonicalJson);
            work.derivedContractHash = derived.derivedContractHash;
            work.grant = { ...(work.grant as Record<string, unknown>), work: next };
            this.store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id=?").run(JSON.stringify(work), id, taskId);
            // Step 7: copy the confirmed snapshot, replacing only this task's derived contract and its two allocations,
            // and point the proposal (and, through saveWebAuthority, the group's mirror) at it. Old snapshots are kept.
            const frozen = executionSnapshotSchema.parse(JSON.parse(readCanonicalRecord(this.store, proposal.executionSnapshotHash!)));
            const bare = ({ state: _state, ...rest }: BudgetProposalRecord["allocations"][number]) => rest;
            // Spec §10.5, H3: an unchanged declaration keeps its frozen entry as it is (readConfirmedTaskExecution below checks
            // it agrees); a changed one is frozen as confirm freezes it -- names as declared, a profile as syncskill answered it.
            const recipeSkills = expanded.recipe.skills;
            const frozenEntry = frozen.skills?.find(entry => entry.taskId === taskId);
            const profileNames = recipeSkills !== undefined && "profile" in recipeSkills ? skillLookup.members.get(recipeSkills.profile) : undefined;
            // Read as a draft before the transaction, so nothing was looked up, and confirmed since: the state moved under it.
            if (!skillsUnchanged && recipeSkills !== undefined && "profile" in recipeSkills && profileNames === undefined) throw new ControlError("proposal-version-conflict");
            const frozenSkills = skillsUnchanged ? (frozenEntry === undefined ? null : { profile: frozenEntry.profile, names: [...frozenEntry.names] })
              : recipeSkills === undefined ? null
              : "names" in recipeSkills ? { profile: null, names: [...recipeSkills.names] } : { profile: recipeSkills.profile, names: profileNames! };
            const rebuilt = replaceTaskInSnapshot(frozen, taskId, derived.derivedContractHash, { work: bare(allocation), handoff: bare(handoff) }, frozenSkills);
            writeCanonicalRecord(this.store, id, rebuilt.snapshotHash, rebuilt.canonicalJson);
            proposal.executionSnapshotHash = rebuilt.snapshotHash;
            saveWebAuthority(this.store, group, proposal);
            // Step 8: the changed task passes A2 before this commits.
            readConfirmedTaskExecution(this.store, id, taskId);
          }
          // Step 8: the ledger still conserves.
          assertKnownConservation(this.store, readWebGroup(this.store, id), readBudgetProposal(this.store, id));
          // W5/W6: the estimate still describes the contract as this command leaves it (a change in the same command makes it stale).
          for (const { estimateId } of modelDimensions) refuseStaleEstimate(this.store, id, estimateId);
          return success(context, { kind: "task-loop-set", taskId, loopVersion: loopVersion + 1, proposalVersion: proposal.proposalVersion });
        },
      }).body;
    } finally { release?.(); }
  }
}

function keptExpansion(taskId: string, repoPath: string, current: LoopRecipe, inputs: LoopRecipe["inputs"], skills: LoopSkills | undefined): LoopTaskExpansion {
  // An explicit `undefined` would make canonical JSON throw, so absent skills are an omitted key.
  const { skills: _previous, ...rest } = current;
  const recipe: LoopRecipe = { ...rest, inputs: structuredClone(inputs), ...(skills === undefined ? {} : { skills }) };
  const expanded = expandRecipe(taskId, repoPath, recipe);
  return expanded.ok ? { ...expanded, recipe } : expanded;
}

/**
 * The estimate's terminal settlement (formerly WebControlService.completeEstimate's body, moved unchanged so the
 * execution driver can call it -- single-call estimate spec §6.3, drafter finding F13). `commitTerminal` runs first, in
 * the same transaction, and a throw from anything here rolls it back with the rest.
 */
export function completeEstimateInStore(
  deps: { store: ControlStore; admissionGate?: AdmissionGate }, id: string, estimateId: string, rawOutput: unknown, commitTerminal?: () => void,
  // N1 spec §5.1: the estimate purpose's registered classifier (singleCallPurposes.ts); the service method keeps the default.
  classify: typeof classifyEstimateOutput = classifyEstimateOutput,
): void {
  const release = deps.admissionGate?.enter();
  try {
    deps.store.transaction(() => {
      const estimate = readEstimateRecord(deps.store, id, estimateId), receiptId = `estimate-result:${id}:${estimateId}`;
      const { rawHash, rawIdentity, canonicalJson: rawCanonicalJson } = identifyRawEstimateOutput(rawOutput);
      const receipt = deps.store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='estimate-result'").get(receiptId);
      if (receipt) {
        const retained = JSON.parse(String(receipt.body));
        if (retained.rawHash !== rawHash || retained.rawIdentity !== rawIdentity) throw new ControlError("report-identity-conflict");
        return;
      }
      commitTerminal?.();
      if (!["running", "start-unknown"].includes(estimate.state)) throw new ControlError("start-state-conflict");
      const rows = deps.store.db.prepare("SELECT id,active,body FROM runs WHERE group_id=? AND work_item_id=?").all(id, estimateId);
      if (rows.length !== 1) throw new ControlError("recovery-blocked");
      // N1 spec §5.1 (PR-I4): the stop and usage checks are every single call's.
      const run = verifyStoppedSingleCall(deps.store, rows[0], { groupId: id, workItemId: estimateId, workGrant: estimate.grant });
      const group = readWebGroup(deps.store, id), proposal = readBudgetProposal(deps.store, id), plan = readArchivedPlan(deps.store, id);
      assertCallUsageBooked(group, run);
      const currentBalance = budgetBalance(group.limit, group.used, group.reserved);
      if (!same(currentBalance.reserve, proposal.explicitUnallocatedReserve) || !same(currentBalance.deficit, group.ledger.budgetDeficit)) throw new ControlError("recovery-blocked");
      // Single-call estimate spec §6.4: a failed estimate carries its own reason. A schema-valid answer that is not
      // canonical JSON (a lone surrogate, a negative zero) cannot be hashed, so it is an invalid answer too.
      const classified = classify(rawOutput, plan.planHash, plan.plan.tasks.map(t => t.taskId));
      let output: BudgetEstimateV1 | null = null, outputHash: string | null = null;
      let reasonCode: string | null = classified.ok ? null : classified.reasonCode;
      if (classified.ok) {
        try { outputHash = sha256Canonical(classified.output); output = classified.output; }
        catch (error) { if (!(error instanceof ControlError)) throw error; reasonCode = "estimate-output-invalid"; }
      }
      estimate.state = output ? "ready" : "failed"; estimate.output = output; estimate.outputHash = outputHash; estimate.reasonCode = reasonCode;
      if (rawCanonicalJson !== null) writeCanonicalRecord(deps.store, id, rawHash, rawCanonicalJson);
      if (output) writeCanonicalRecord(deps.store, id, estimate.outputHash!, canonicalBytes(output).toString("utf8"));
      group.ledger.committedRemaining = residual(group.reserved, zero(), run.remaining.work);
      const settledBalance = budgetBalance(group.limit, group.used, group.ledger.committedRemaining);
      group.ledger.budgetDeficit = settledBalance.deficit;
      setReserve(proposal, settledBalance.reserve);
      deps.store.db.prepare("UPDATE estimates SET state=?,body=? WHERE group_id=? AND id=?").run(estimate.state, canonicalBytes(estimate).toString("utf8"), id, estimateId);
      closeSingleCall(deps.store, run.runId, { id: receiptId, kind: "estimate-result", body: { groupId: id, estimateId, runId: run.runId, rawHash, rawIdentity } });
      saveWebAuthority(deps.store, group, proposal); recordProjectionChange(deps.store, [id]);
    });
  } finally { release?.(); }
}
