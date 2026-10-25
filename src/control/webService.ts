import { join } from "node:path";
import { applyFlowCommand, type FlowCommand } from "../flow/flowCommands.js";
import { applyPlanLibraryCommand, type PlanLibraryCommand } from "./planLibrary/commands.js";
import { applyScheduleCommand, type ScheduleCommand } from "./schedules/commands.js";
import { schedulesPass, type SchedulePassDeps } from "./schedules/pass.js";
import type { FlowDeps } from "../flow/kernel.js";
import { peerCode, peerFailure } from "./ccloopPort.js";
import {retainSavedInterruption,readDriverRun,describeError} from "./executionDriver.js";
import { readSavedResultEligibility,applyVerifySavedResult,type VerifySavedResultCommand } from "./savedResultRecovery.js";
import { finiteCommitment, budgetFits, type BudgetAmount } from "./tokenPolicy.js";
import { assertNoActiveUnbounded } from "./spendCaps.js";
import { hasTokenPolicy, saveTokenPolicy, enableOptionalTokenPolicy } from "./fundedAllowance.js";
import { budgetAmountSchema, safeInteger } from "./schema.js";
import { z } from "zod";
import { randomUUID, createHash } from "node:crypto";
import { applyWebCommand, lookupWebCommandReplay, preflightWebCommand, type WebCommandContext } from "./commandLedger.js";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { dimensions, zero } from "./commands.js";
import { ControlError, type KnownControlErrorCode } from "./errors.js";
import { buildBudgetEstimateRequest, ESTIMATE_GRANT, estimateGrantFor, withEstimateGrant, GOAL_REVIEW, TASK_HANDOFF, TASK_WORK, provenance, residual, safeNumber, sumAmounts, persistEstimateArtifacts, estimateCapabilityDegradationReasons, classifyEstimateOutput, readEstimateContract, singleCallOutputBound } from "./estimator.js";
import { deriveContract, prepareExecutionSnapshot, readConfirmedTaskExecution, replaceTaskInSnapshot } from "./executionSnapshot.js";
import { answeredPartials, currentPartials, readGroupAgentOverrides, RECONCILE_SLOT_KEY, resolveGroupSelections, taskSlotKey, type GroupSelectionResolution } from "./agentFreeze.js";
import type { ExecutionPort } from "./executionPort.js";
import { isDirGroup, type DirProjectOf } from "./dirGroup.js";
import type { MultiDirProjectOf } from "./multiGroup.js";
import { isMultiGroup } from "./multiGroup.js";
import { estimatorSlotFor, importControlPlanAsync, rejectedEstimatorRequest, type AsyncImportDeps, type ImportCommand, type ImportDefaults, type ImportOrigin } from "./planImport.js";
import { readAgentPreferences } from "./agentPreferences.js";
import { intersectCapabilities, type ExecutionProfileRouter } from "./profiles.js";
import { estimatorLayerAuthority, type FrozenSlot } from "./agentSelection.js";
import { allWork, effectivePlanCanonicalJson, estimateIsStale, readArchivedPlan, readBudgetProposal, readEstimateRecord, type BudgetProposalRecord, type EstimateRecord, type EstimateWithdrawnReason } from "./queries.js";
import { groupExecutionPendingInStore } from "./executionPending.js";
import { agentSelectionSchema, amountSchema } from "./schema.js";
import { writeCanonicalRecord, readCanonicalRecord } from "./snapshot.js";
import { budgetEstimateSchema, estimateExecutionContractSchema, executionSnapshotSchema } from "./webProtocol.js";
import { problemsFromRefusal, repairEstimateOutput } from "./estimateRepair.js";
import { decideEstimateRetry, estimateRetryId, retryPromptRequired, writeEstimateRetry } from "./estimateRetry.js";
import { parkEstimate } from "./estimateParking.js";
import { scheduleStart, type StartCommand } from "./webDispatch.js";
import { applyHandoffStop, applyPauseDispatch, applyRecoveryRetry, applyResumeDispatch, readStopIntent, type HandoffStopCommand, type PauseCommand, type RecoveryRetryCommand, type ResumeDispatchCommand, type StopDeps } from "./stopIntent.js";
import { applyContinueTask, applyResumeFromHandoff, type ContinueTaskCommand, type ResumeFromHandoffCommand } from "./continuation.js";
import { applySettleUnknownUsage, type SettleUnknownUsageCommand } from "./settleUnknownUsage.js";
import { applyRetryTask, type RetryTaskCommand } from "./retryTask.js";
import { applySetWorkspaceMode, type SetWorkspaceModeCommand } from "./workspaceSettings.js";
import { prepareResolution } from "./integrationResolve.js";
import { controlWorkspaceRoots } from "./workspace.js";
import { applyResolveIntegrationConflict, applyRetryIntegration, applySetGroupIntegration, applySetIntegrationScheme, type ResolveIntegrationConflictCommand, type RetryIntegrationCommand, type SetGroupIntegrationCommand, type SetIntegrationSchemeCommand } from "./integrationCommands.js";
import { applyResolveFolderChange, type ResolveFolderChangeCommand } from "./folderChangeCommands.js";
import { applyMultiDirLanding, type MultiDirLandingCommand } from "./multiLanding.js";
import { applyArchiveGroup, applyUnarchiveGroup, type ArchiveGroupCommand, type UnarchiveGroupCommand } from "./archiveGroup.js";
import { refuseUnnamedDebugChecks } from "./debugChecks.js";
import { readCorrectionList, type CorrectionListItemV1 } from "./correctionState.js";
import { applyCorrectionDebugOpen, archiveUnstartedDebugGroups, debugGroupIdFor, type CorrectionDebugOpenCommand } from "./debugGroup.js";
import { writeSystemDebugSettled, type SystemDebugMark } from "./systemDebug.js";
import { allTasksDone, anyTaskFailed, applySystemDebugOpen, terminallyFailedRun, ladderCandidates, ladderLevelOneCommandId, ladderFacts, quotaWaitCandidates, settleSystemDebug, systemDebugGroupId, systemDebugGroups, type SystemDebugOpenCommand, isGroupSource } from "./systemDebug.js";
import { QUIET_GIT, revParse, workBranchRef } from "./workspace.js";
import { git } from "../scheduler/gitExec.js";
import { applySetCriteriaReview, criteriaDecisionIdOf, criteriaReviewCandidates, criteriaReviewFacts, criteriaReviewVerdict, type SetCriteriaReviewCommand } from "./criteriaReview.js";
import { flagDecision, ratifyFlag, readFlaggedDecision } from "./flaggedDecisions.js";
import { join as joinPath } from "node:path";
import { decideFundedAllowance } from "./fundedAllowance.js";
import { failedRunDetail, groupWorkerAgent, MODEL_REVIEW_ADMIT_MS, newestConfirmedGroup, rangeDenylist, reviewAgentOf, reviewInputsOf, reviewPathDenied, type ReviewRunFacts } from "./modelReview/run.js";
import { writeReviewInputs } from "./modelReview/inputs.js";
import { FINDINGS_PATH, validatorCommand } from "./modelReview/plan.js";
import { parseFindings, validateFindings, type Finding } from "./modelReview/findings.js";
import { cutRange, rangeOf } from "./checks/range.js";
import { landedGroups } from "./integrationCheck.js";
import { groupStopState } from "./stopIntent.js";
import { readGroupOrchestration } from "./orchestration.js";
import type { PartialSelection } from "./agentSelection.js";
import { integrationCheckFacts, runIntegrationCheck } from "./integrationCheck.js";
import { applyResumeCheck, applyRunCheckNow, applySetCheckLocks, applySetCheckSettings, applySetScheduledCheck, type CheckCommand } from "./checks/commands.js";
import { migrateIntegrationMeta } from "./checks/migrate.js";
import { applyCheckEnded, asked, consumeStarters, dueStarters, initialiseSlots, prepareRange, projectTargets, rangeFacts, recordCheckEnded, recordCheckSkipped, recordCheckStarted, type CheckEnd, type Starters } from "./checks/pass.js";
import type { CheckRange, RangeGroup } from "./checks/range.js";
import type { CheckKind } from "./checks/settingsSchema.js";
import { readUsageCalendar } from "./usageCalendar.js";
import { effectiveChecks } from "./checks/settings.js";
import { applySetFlowLocks, applySetFlowSettings, type FlowSettingsCommand } from "../flow/settingsCommands.js";
import { readCheckState, type CheckState } from "./checks/state.js";
import { evaluateTrigger } from "./checks/trigger.js";
import { gitChild } from "./integrationGit.js";
import { applyCorrectionClose, applyCorrectionRecord, applyCorrectionWithdraw, type CorrectionCloseCommand, type CorrectionRecordCommand, type CorrectionWithdrawCommand, type PanelCorrections } from "./correctionCommands.js";
import { recordActivity } from "./activity.js";
import { DISPATCHED_PERSON_DIRNAME, commandClientFor, commandPrincipalFor, withCommandContext } from "./commandClient.js";
import { applyApprovePendingDecision, applyRatifyFlaggedDecision, applyRejectPendingDecision, prepareApproval, prepareRejection, type ApprovePendingDecisionCommand, type ApprovePrepared, type RatifyFlaggedDecisionCommand, type RejectPendingDecisionCommand, type RejectPrepared } from "./decisionCommands.js";
import { readCorrections } from "../corrections/store.js";
import { autoConfirmBlocker, autoConfirmCommandId } from "./autoConfirm.js";
import { autoStartPass, ORCHESTRATION_ACTOR, readOrchestrationSettings, recordConfirmed, type PrerequisiteReader } from "./orchestration.js";
import { applySetOrchestrationSettings, type SetOrchestrationSettingsCommand } from "./orchestrationCommands.js";
import { applyAddGroupDependency, applyRemoveGroupDependency, waitingPrerequisites, type AddGroupDependencyCommand, type RemoveGroupDependencyCommand } from "./groupEdges.js";
import { readWithdrawals, withdrawnIds } from "../corrections/withdrawals.js";
import { isGroupArchived } from "./archivedMark.js";
import { checkScheme, preflightScheme, readGroupIntegration, REPOSITORY_CHECK, suggestedTarget, type GroupIntegration, type IntegrationScheme } from "./integrationScheme.js";
import { applySpendCommand, type SpendCommand } from "./spendCommands.js";
import { applySetAgentPreferences, type SetAgentPreferencesCommand } from "./agentPreferences.js";
import { applyAgentUpdate, hasPendingAgentUpdate, pendingAgentUpdateCommand, readAgentUpdateRevision, reconcilePendingAgentUpdates, type ApplyAgentUpdateCommand } from "./agentUpdates.js";
import type { AgentObservation, AgentPreview } from "./agentInstallationProtocol.js";
import { recordProjectionChange } from "./projectionJournal.js";
import { capStatuses, claimCapBlocking, clearSpendCapBlock, gateClaim } from "./spendCaps.js";
import { groupRepoIdOf } from "./usageLedger.js";
import { effectiveTaskLabels, normalizeInputLabels, readTaskLabelState } from "./labels.js";
import { TASK_AMENDMENT_SCHEMA, effectivePlanTask, workBodyOf, writeTaskAmendment } from "./taskAmendments.js";
import { expandLoopPlan, expandRecipe, normalizeLoopSkills, type LoopRecipe, type LoopSkills, type LoopTaskExpansion } from "./loopPlans.js";
import { taskContractSchema } from "../scheduler/planFile.js";
import { profileMembers, SyncskillError, type SyncskillOptions } from "../skills/syncskill.js";
import type { Amount } from "./types.js";
import type { ControlStore } from "./store.js";
import type { BudgetEstimateV1, CommandLookupV1, CommandSuccessV1, EffectiveProposalEditPayload, RawAuthorityCommandV1, ProfileBindingV1 } from "./webProtocol.js";
import type { AdmissionGate } from "./admissionGate.js";
import { budgetBalance, isTerminalRunState } from "./budget.js";
import { mirrorWebAuthority, reopenProposalBodies, type Body } from "./proposalReopen.js";
import { isTerminallyFailedRun } from "./driveRecord.js";
import { hasRequirementBlock, latestDraft, latestRound, readRequirementGroup, refuseClarifying, setRequirementLimit } from "./requirementRecords.js";
import { assertCallUsageBooked, closeSingleCall, insertSingleCallRun, verifyStoppedSingleCall } from "./singleCallLedger.js";
import {
  applyRequirementAnswer, applyRequirementClarifyMore, applyRequirementRevise, applyRequirementClassify, applyRequirementConsensus, applyRequirementDraftAccept, applyRequirementDraftFeedback, applyRequirementOpen,
  type RequirementAnswerCommand, type RequirementClarifyMoreCommand, type RequirementReviseCommand, type RequirementClassifyCommand, type RequirementConsensusCommand, type RequirementDraftAcceptCommand, type RequirementDraftFeedbackCommand, type RequirementOpenCommand,
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
  /** Integration spec §3.3: a known repository's path, for the git checks that run before a setter's transaction. */
  resolveRepository?: (repoId: string) => string;
  /** Agent selection spec §6.4 (W6-19): the same port the panel's profiles use; confirm resolves selections through it. */
  port: Pick<ExecutionPort, "resolveAgent" | "listAgents" | "readFeatures" | "observeAgentInstallations" | "previewAgentInstallations" | "applyAgentInstallations">;
  /** Syncskill integration spec §10.5: confirm looks up each declared profile through it. Absent means not configured. */
  syncskill?: SyncskillOptions;
  /**
   * Control run decisions plan Task 10: where reject-pending-decision records its correction (the panel's
   * correctionsDir, Rule 17), and as whom: the panel's resolved identity `/api/corrections` stamps (cross-plan
   * resolution 1). Either absent, reject is refused corrections-store-unconfigured.
   */
  correctionsDir?: string;
  correctionsBy?: string;
  /** Flow engine spec §14.2: the flow kernel's production ports (a panel with an execution driver); null: none. */
  flowDeps?: () => FlowDeps | null;
  /** Review finding I4: the registered `dir` projects a flow may start on (their settings key and folder); absent: none. */
  flowProjects?: () => ReadonlyArray<{ repoId: string; path: string }>;
  /**
   * Dir-requirements spec §5.1-§5.2: the registered `dir` project a repo id names (the panel builds it from the same
   * projects-file entries as flowProjects); absent, every project is a repository. Read by requirement-open (the frozen
   * dir workspace), import-plan and the debug opens (refused), and the route's dispatched-run payload check.
   */
  dirProjectOf?: DirProjectOf;
  /**
   * Multi-directory projects spec §4.3, §5.2: a multi-dir repo id has no single path (the settings setters refuse it) and
   * its members are what requirement-open freezes. Absent, no id is a multi id.
   */
  multiDirRepoId?: (repoId: string) => boolean;
  multiDirProjectOf?: MultiDirProjectOf;
  /** Debug task plan Task 11: what correction-record/-withdraw need from the panel (correctionCommands.ts). Absent, both refuse corrections-store-unconfigured. */
  panelCorrections?: PanelCorrections;
  /**
   * Debug task plan Task 6: every configured repository with its trusted path, for correction-debug-open's lookup of the
   * repository whose projectKey a correction names. Absent, no repository matches (correction-repository-unknown).
   */
  listRepositories?: () => Array<{ repoId: string; path: string }>;
  /** Debug task plan Task 6 (fix round 1): the repoId the panel gives a project key (controlRepoKey); absent, only remote-derived keys match. */
  repoIdOfProjectKey?: (projectKey: string) => string;
  /** Test seams into approve's and reject's git/store steps (decisionCommands.ts), passed through unchanged. */
  decisionSeams?: { beforeCas?: () => Promise<void>; beforeRecord?: () => Promise<void>; beforeOpen?: () => Promise<void> };
}
interface EstimateRun { runId: string; groupId: string; workItemId: string; phase: string; state: string; claimOrdinal: null; providerAttemptOrdinal: number; remaining: { work: Amount; handoff: Amount }; cumulative: { work: Amount; handoff: Amount }; unknown: { work: boolean; handoff: boolean }; [key: string]: unknown }

const ledgerSchema = z.object({ groupLimit: budgetAmountSchema, used: amountSchema, committedRemaining: amountSchema, explicitUnallocatedReserve: budgetAmountSchema, budgetDeficit: amountSchema, usageUnknown: z.boolean() }).strict();
const groupSchema = z.object({ groupId: z.string(), status: z.enum(["clarifying", "draft", "ready", "running", "review", "done", "blocked"]), stopped: z.boolean(), used: amountSchema, reserved: amountSchema, limit: budgetAmountSchema, ledger: ledgerSchema }).passthrough();
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
/**
 * Spec §10.5: what confirm's profile lookups answered, decided inside the transaction like a slot failure. `kinds` maps
 * each agents-table installation id to its kind, asked of ccloop only when the read before the transaction saw a task
 * that needs it; null when it was not asked.
 */
type SkillLookup = { members: Map<string, string[]>; kinds: Map<string, string> | null } | { failure: unknown };
const UNCONFIGURED_SYNCSKILL: SyncskillOptions = { bin: null, env: {} };
const SYNCSKILL_REFUSALS = ["skills-profile-empty", "skills-shape", "syncskill-missing", "syncskill-output-invalid", "syncskill-output-too-large", "syncskill-timeout", "syncskill-unconfigured"] as const satisfies readonly KnownControlErrorCode[];
/** One `profile ls` per distinct profile the tasks' effective recipes declare, in name order, one at a time. */
async function lookupSkillProfiles(store: ControlStore, groupId: string, syncskill: SyncskillOptions, port: Pick<ExecutionPort, "listAgents">): Promise<SkillLookup> {
  const profiles = new Set<string>();
  let declared = false;
  try {
    for (const archived of readArchivedPlan(store, groupId).plan.tasks) {
      const skills = effectivePlanTask(store, groupId, archived, workBodyOf(store, groupId, archived.taskId)).loop?.skills;
      if (skills !== undefined) declared = true;
      if (skills !== undefined && "profile" in skills) profiles.add(skills.profile);
    }
  } catch { return { members: new Map(), kinds: null }; } // the transaction's own checks name what could not be read
  // Spec §4.2 / §10.5: any declared skills, names included, need syncskill at run start, so confirm refuses without it.
  if (declared && syncskill.bin === null) return { failure: new ControlError("syncskill-unconfigured") };
  const members = new Map<string, string[]>();
  for (const profile of [...profiles].sort()) {
    try { members.set(profile, await profileMembers(syncskill, profile)); } catch (error) { return { failure: syncskillRefusal(error) }; }
  }
  const kinds = await agentKinds(port, declared);
  return "failure" in kinds ? kinds : { members, kinds: kinds.kinds };
}
/**
 * Human ruling 2026-10-03 (session 9d95e6c8): a task with skills on an agent other than claude is refused when it is
 * confirmed or changed, not first at run start, where it could only be ended by stopping its group. The kind comes from
 * ccloop's own table view (listAgents). ccloop's acceptStart still refuses it at run start, for a table changed since.
 */
/** H6 approved design (2026-10-05): Claude and Codex support frozen skills, and OMP since 2026-10-13 (spec 2026-10-13-omp-skill-injection-design.md); ccloop's table supplies the kind. */
async function agentKinds(port: Pick<ExecutionPort, "listAgents">, needed: boolean): Promise<{ kinds: Map<string, string> | null } | { failure: unknown }> {
  if (!needed) return { kinds: null };
  try { return { kinds: new Map((await port.listAgents()).installations.map(installation => [installation.id, installation.kind])) }; } catch (failure) { return { failure }; }
}
function assertSkillsAgent(kinds: Map<string, string> | null, taskId: string, agentId: string): void {
  // Not asked: the read before the transaction saw no such task (a draft then, or no skills), so the state moved since.
  if (kinds === null) throw new ControlError("proposal-version-conflict");
  const kind = kinds.get(agentId);
  if (kind !== "claude" && kind !== "codex" && kind !== "omp") throw new ControlError("skills-unsupported-agent", `${taskId}:${agentId}:${kind ?? "not-in-table"}`);
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
async function lookupProfile(profile: string | null, syncskill: SyncskillOptions, port: Pick<ExecutionPort, "listAgents">, needKinds: boolean): Promise<SkillLookup> {
  let members = new Map<string, string[]>();
  // profileMembers refuses an unset ORCA_SYNCSKILL_BIN itself (syncskill-unconfigured).
  if (profile !== null) {
    try { members = new Map([[profile, await profileMembers(syncskill, profile)]]); } catch (error) { return { failure: syncskillRefusal(error) }; }
  }
  const kinds = await agentKinds(port, needKinds);
  return "failure" in kinds ? kinds : { members, kinds: kinds.kinds };
}
/** A confirmed group's task whose payload declares skills: its frozen agent's kind is checked (a draft task's, at confirm). */
function confirmedWithSkills(store: ControlStore, groupId: string, skills: LoopSkills | undefined): boolean {
  if (skills === undefined) return false;
  try { return readBudgetProposal(store, groupId).state !== "editable"; } catch { return false; } // the transaction's own checks name what could not be read
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
/**
 * Estimate usable-answer spec, correction of 2026-10-20: why a queued estimate's answer could no longer be used, decided by
 * code at claim time for every queued estimate (a person's, an import's, a draft's or an automatic retry). The group has
 * started -- past pre-start, or its execution pending by the start guard's predicate (a Web start keeps the stored status
 * `ready` through the first run) -- the proposal is confirmed, or a newer estimate exists. The first that holds names it.
 */
function withdrawalReason(store: ControlStore, groupId: string, group: Group, proposal: BudgetProposalRecord, estimate: EstimateRecord): EstimateWithdrawnReason | null {
  if (group.status === "running" || group.status === "review" || group.status === "done" || groupExecutionPendingInStore(store, groupId)) return "group-started";
  if (proposal.state === "confirmed") return "proposal-confirmed";
  const newest = Number(store.db.prepare("SELECT MAX(estimate_version) AS n FROM estimates WHERE group_id=?").get(groupId)?.n ?? 0);
  if (newest > estimate.estimateVersion) return "superseded";
  return null;
}
/** The terminal `withdrawn` state: no run, no settlement, no retry; the grant leaves `committedRemaining` as a settlement's does. */
function withdrawEstimate(store: ControlStore, groupId: string, group: Group, proposal: BudgetProposalRecord, estimate: EstimateRecord, reason: EstimateWithdrawnReason): void {
  estimate.state = "withdrawn"; estimate.reasonCode = `estimate-withdrawn:${reason}`;
  group.ledger.committedRemaining = residual(group.reserved, zero(), estimate.grant);
  const balance = budgetBalance(group.limit, group.used, group.ledger.committedRemaining);
  group.ledger.budgetDeficit = balance.deficit;
  setReserve(proposal, balance.reserve);
  store.db.prepare("UPDATE estimates SET state=?,body=? WHERE group_id=? AND id=?").run(estimate.state, canonicalBytes(estimate).toString("utf8"), groupId, estimate.estimateId);
  clearSpendCapBlock(store, groupId, "estimate");
  saveWebAuthority(store, group, proposal); recordProjectionChange(store, [groupId]);
}
/**
 * `proposedLimit` (tester round 2 spec §4.2.5, review C1 / round 2 N2): a proposal-edit that raises the limit is checked
 * against that limit -- its deficit by `budgetBalance`, which never throws -- in place of the two checks against the
 * stored limit, and before any other use of it, so a deficit an estimate overrun left cannot refuse the raise that cures it.
 */
/**
 * Tester round 2 spec §5.2.2-§5.2.4: a queued estimate's grant in `group`, read now -- the group's remaining tokens
 * (`limit - used - committedRemaining`, before this grant is reserved) and the binding spend cap's headroom. A limited group
 * with no token left refuses with group-budget-unavailable (writer's decision D3).
 */
export function estimateGrantInStore(store: ControlStore, group: { limit: BudgetAmount; used: Amount; reserved: Amount } & Record<string, unknown>, requiredRequestTokens: number, at: number): Amount {
  const remainingTokens = group.limit.tokens === null ? null : group.limit.tokens - group.used.tokens - group.reserved.tokens;
  if (remainingTokens !== null && remainingTokens <= 0) throw new ControlError("group-budget-unavailable");
  const capHeadroom = capStatuses(store, groupRepoIdOf(group), at)[0]?.headroom ?? null;
  return estimateGrantFor({ limitTokens: group.limit.tokens, remainingTokens, capHeadroom, requiredRequestTokens });
}
export function assertKnownConservation(store: ControlStore, group: Group, proposal: BudgetProposalRecord, proposedLimit?: BudgetAmount): void {
  if (store.dispatchBlocked || group.ledger.usageUnknown) throw new ControlError("recovery-blocked");
  for (const row of store.db.prepare("SELECT body FROM runs WHERE group_id=?").all(group.groupId)) {
    const run = JSON.parse(String(row.body));
    if (!run.unknown || run.unknown.work || run.unknown.handoff) throw new ControlError("recovery-blocked");
  }
  if (proposedLimit !== undefined) {
    const { deficit } = budgetBalance(proposedLimit, group.used, group.reserved);
    if (dimensions.some(d => deficit[d] !== 0) || !same(group.ledger.explicitUnallocatedReserve, proposal.explicitUnallocatedReserve)) throw new ControlError("recovery-blocked");
  } else if (!same(group.ledger.explicitUnallocatedReserve, proposal.explicitUnallocatedReserve)
    || !same(residual(group.limit, group.used, group.reserved), proposal.explicitUnallocatedReserve)
    || dimensions.some(d => group.ledger.budgetDeficit[d] !== 0)) throw new ControlError("recovery-blocked");
  const commitments = proposal.allocations.filter(a => a.ownerKind !== "reserve").map(allocation => {
    if (allocation.ownerKind === "goal-review") {
      const remaining = amountSchema.safeParse(group.reviewRemaining);
      if (!remaining.success || !budgetFits(finiteCommitment(remaining.data),allocation.amount)) throw new ControlError("recovery-blocked");
      return remaining.data;
    }
    const row = store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(group.groupId, allocation.ownerId);
    if (!row) throw new ControlError("recovery-blocked");
    const work = JSON.parse(String(row.body));
    if(hasTokenPolicy(store,group.groupId)&&work.fundingReleased===true){
      const prior=store.db.prepare("SELECT active,body FROM runs WHERE id=? AND group_id=? AND work_item_id=?").get(work.currentRunId,group.groupId,work.workItemId);
      if(!prior||prior.active!==0||JSON.parse(String(prior.body)).unknown.work||JSON.parse(String(prior.body)).unknown.handoff)throw new ControlError("recovery-blocked","released-funding-invalid");
      return zero();
    }
    if (["draft", "ready"].includes(work.status)) return hasTokenPolicy(store,group.groupId)?{...allocation.amount,tokens:0}:amountSchema.parse(allocation.amount);
    if (allocation.state === "terminal") return zero();
    const current = typeof work.currentRunId === "string" ? store.db.prepare("SELECT body FROM runs WHERE group_id=? AND id=? AND work_item_id=?").get(group.groupId, work.currentRunId, allocation.ownerId) : undefined;
    if (!current) throw new ControlError("recovery-blocked");
    const run = JSON.parse(String(current.body));
    const remaining = budgetAmountSchema.safeParse(run.remaining?.[allocation.bucket]);
    if (!remaining.success || !budgetFits(finiteCommitment(remaining.data),allocation.amount)) throw new ControlError("recovery-blocked");
    return finiteCommitment(remaining.data);
  });
  const expected = sumAmounts([...commitments, ...estimateCommitments(store, group.groupId).map(a => a.amount)]);
  if (!same(expected, group.reserved)) throw new ControlError("recovery-blocked");
}
export function saveWebAuthority(store: ControlStore, group: Group, proposal: BudgetProposalRecord): void {
  if (!proposal.allocations.some(a => a.ownerKind === "goal-review")) throw new ControlError("recovery-blocked");
  const optionalPolicy=hasTokenPolicy(store,group.groupId);
  mirrorWebAuthority(group as unknown as Body, proposal as unknown as Body);
  saveTokenPolicy(store,group.groupId,"",proposal.groupLimit.tokens,optionalPolicy?"optional-v1":"finite-legacy");
  if(optionalPolicy)for(const a of proposal.allocations)if(a.ownerKind==="task"&&a.bucket==="work")saveTokenPolicy(store,group.groupId,a.ownerId,a.amount.tokens);
  store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(group), group.groupId);
  store.db.prepare("UPDATE budget_proposals SET proposal_version=?,body=? WHERE group_id=?").run(proposal.proposalVersion, canonicalBytes(proposal).toString("utf8"), group.groupId);
}
export function setReserve(proposal: BudgetProposalRecord, reserve: BudgetAmount): void {
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
function verifyModelField(store: ControlStore, id: string, proposal: BudgetProposalRecord, target: EffectiveProposalEditPayload["operations"][number]["target"], value: number|null, estimateId: string): void {
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
  const commitments = sumAmounts([...proposal.allocations.filter(a => a.ownerKind !== "reserve").map(a => hasTokenPolicy(store,id)&&a.ownerKind==="task"?{...a.amount,tokens:0}:amountSchema.parse(a.amount)), ...estimateCommitments(store, id).map(a => a.amount)]);
  setReserve(proposal, residual(proposal.groupLimit, group.used, commitments));
  return commitments;
}

/**
 * Any proposal change returns it to editable: the version advances and every confirmation-time fact is dropped. The body
 * transformation is `reopenProposalBodies` (proposalReopen.ts), shared with the schema 18 → 19 repair (tester round 2 §4.3.1).
 */
function reopenProposal(store: ControlStore, id: string, group: Group, proposal: BudgetProposalRecord, commitments: Amount): void {
  readGroupIntegration(group); // a scheme that does not parse refuses by name, as before
  const works = store.db.prepare("SELECT id,body FROM work_items WHERE group_id=?").all(id).map(row => ({ id: String(row.id), body: JSON.parse(String(row.body)) as Record<string, unknown> }));
  reopenProposalBodies(group as unknown as Body, proposal as unknown as Body, works.map(work => work.body), commitments);
  for (const work of works) if (work.body.kind === "task") store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id=?").run(JSON.stringify(work.body), id, work.id);
  saveWebAuthority(store, group, proposal);
}

/** Web commands only publish durable authority. Provider invocation belongs to scheduler delivery. */
export class WebControlService {
  private installationObservation: AgentObservation | null = null;
  private installationPreview: AgentPreview | null = null;
  private installationFailure: string | null = null;
  readonly store: ControlStore;
  /** Final review I3: per group, the tail of the approve/reject chain (see serializeDecision). */
  private readonly decisionChains = new Map<string, Promise<unknown>>();
  constructor(readonly deps: WebServiceDeps) { this.store = deps.store; }
  private mutate<T>(action: () => T): T { const release = this.deps.admissionGate?.enter(); try { return action(); } finally { release?.(); } }
  /**
   * Final review I3: approve and reject of a group's pending decisions run one at a time, prepare and apply together.
   * Unserialized, a reject could find no line while an approve is between its check and its commit, mark the item
   * rejected, and leave the approve's commit on orca/<groupId> to integrate. One panel process holds the service.
   */
  private serializeDecision<T>(groupId: string, action: () => Promise<T>): Promise<T> {
    const next = (this.decisionChains.get(groupId) ?? Promise.resolve()).then(action);
    const tail = next.catch(() => undefined);
    this.decisionChains.set(groupId, tail);
    void tail.then(() => { if (this.decisionChains.get(groupId) === tail) this.decisionChains.delete(groupId); });
    return next;
  }
  async importPlan(command: ImportCommand, origin?: ImportOrigin): Promise<WebCommandResult> {
    const release = this.deps.admissionGate?.enter();
    try { return await importControlPlanAsync(this.deps, command, origin === undefined ? {} : { origin }); } finally { release?.(); }
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
        assertKnownConservation(this.store, group, proposal, payload.proposedGroupLimit ?? undefined);
        // Loop plans spec §4.3 (C6, Rule 7): a loop task's work allocation has one owner, set-task-loop.
        const loopTasks = new Set(readArchivedPlan(this.store, id).plan.tasks.filter(task => task.loop !== undefined).map(task => task.taskId));
        const seen = new Set<string>();
        const before = canonicalBytes({ allocations: proposal.allocations, limit: proposal.groupLimit });
        if(payload.operations.some(op=>op.target.scope==="task"&&op.target.allocation==="work"&&op.target.dimension==="tokens"&&op.value===null))enableOptionalTokenPolicy(this.store,id);
        for (const op of payload.operations) {
          const key = canonicalBytes(op.target).toString("utf8");
          if (seen.has(key)) throw new ControlError("duplicate-proposal-target"); seen.add(key);
          if (op.target.scope === "task" && op.target.allocation === "work" && loopTasks.has(op.target.taskId)) throw new ControlError("budget-owned-by-loop-plan");
          const row = allocationFor(proposal, op.target);
          if (row.bucket === "work" && op.value !== null && op.value <= 0 && op.target.dimension!=="tokens") throw new ControlError("execution-policy-unrepresentable");
          if (op.provenance === "model") {
            verifyModelField(this.store, id, proposal, op.target, op.value, op.estimateId!);
            refuseStaleEstimate(this.store, id, op.estimateId!);
          }
          if (op.provenance === "complex-1m-default") {
            const defaults = op.target.scope === "goal-review" ? GOAL_REVIEW : op.target.allocation === "work" ? TASK_WORK : TASK_HANDOFF;
            if (op.value !== (op.target.scope==="task"&&op.target.allocation==="work"&&op.target.dimension==="tokens"&&hasTokenPolicy(this.store,id)?null:defaults[op.target.dimension])) throw new ControlError("proposal-version-conflict");
          }
          if(op.target.dimension==="tokens")row.amount.tokens=op.value;else row.amount[op.target.dimension]=safeInteger.parse(op.value);
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
      let layerAuthority: string;
      try {
        const id = groupId(command), group = readWebGroup(this.store, id);
        const plan = readArchivedPlan(this.store, id), proposal = readBudgetProposal(this.store, id);
        if (proposal.proposalVersion !== command.payload.proposalVersion) throw new ControlError("proposal-version-conflict");
        prestart(group);
        const profile = this.deps.profileRouter.resolve("budget-estimate", command.payload.estimatorProfileId, command.payload.estimatorProfileHash);
        // Spec §6.4: a re-estimate resolves the estimator layers as they are now -- including the group's, which only
        // the panel sets (controller ruling R7) -- and freezes them for this estimate only.
        const overrides = readGroupAgentOverrides(group);
        const slot = await estimatorSlotFor({ store: this.store, profileRouter: this.deps.profileRouter }, command.actorId, overrides, profile, plan.plan.agent);
        layerAuthority = slot.layerAuthority;
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
          const currentPlan = readArchivedPlan(this.store, id).plan;
          const currentPrefs = readAgentPreferences(this.store, command.actorId).preferences;
          if (estimatorLayerAuthority(currentPrefs, readGroupAgentOverrides(group), currentPlan.agent) !== layerAuthority) throw new ControlError("agent-selection-changed");
          this.deps.profileRouter.resolve("budget-estimate", command.payload.estimatorProfileId, command.payload.estimatorProfileHash);
          const estimateVersion = safeNumber(BigInt(Number(this.store.db.prepare("SELECT MAX(estimate_version) AS n FROM estimates WHERE group_id=?").get(id)?.n ?? 0)) + 1n);
          const estimateId = `estimate-${sha256Canonical({ groupId: id, planHash: proposal.planHash, version: estimateVersion }).slice(0, 24)}`;
          let grant: Amount = ESTIMATE_GRANT;
          if (prepared.state === "queued") {
            assertKnownConservation(this.store, group, proposal);
            // Tester round 2 spec §5.2.2-§5.2.4: the grant from the group's remaining tokens and the binding cap's headroom,
            // read in this transaction; a limited group with no token left refuses (D3).
            const at = (this.deps.now?.() ?? new Date()).getTime();
            grant = estimateGrantInStore(this.store, group, prepared.requiredRequestTokens!, at);
            prepared = withEstimateGrant(prepared, grant);
            group.ledger.committedRemaining = sumAmounts([group.reserved, grant]);
            setReserve(proposal, residual(group.limit, group.used, group.ledger.committedRemaining));
          }
          const estimate = { estimateId, estimateVersion, state: prepared.state, profile: { profileId: command.payload.estimatorProfileId, profileHash: command.payload.estimatorProfileHash }, mode: command.payload.estimateMode,
            requestHash: prepared.requestHash, request: prepared.request, outputHash: null, output: null, reasonCode: prepared.reasonCode,
            ...(prepared.compatibilityReasonCodes === undefined ? {} : { compatibilityReasonCodes: prepared.compatibilityReasonCodes }), grant, estimatorSlot, proposalVersion: proposal.proposalVersion };
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
      // Accounts spec §6.3.1: an estimate that left the queue another way no longer waits on a cap.
      const leftQueue = (): null => { this.store.transaction(() => clearSpendCapBlock(this.store, id, "estimate")); return null; };
      if (!["queued", "running", "start-unknown"].includes(initial.state)) return leftQueue();
      if (initial.profile === null) throw new ControlError("recovery-blocked", "estimate-profile-missing");
      // Issue-fixes spec §6.3: a queued estimate of an archived group is not probed; the check in the transaction below
      // stays for a group archived while the probe ran.
      if (initial.state === "queued" && isGroupArchived(this.store, id)) return null;
      const profile = this.deps.profileRouter.resolve("budget-estimate", initial.profile.profileId, initial.profile.profileHash);
      const at = (this.deps.now?.() ?? new Date()).getTime();
      // A capped estimate is not probed (read-only check; the gate in the transaction decides, and records the block).
      const precapped = initial.state === "queued" && claimCapBlocking(this.store, id, initial.grant.tokens, at) !== null;
      // Spec §6.4 last paragraph: the claim probes the estimate's frozen estimator selection. An estimate without one is
      // never queued; asking `{}` lets the port refuse it, which degrades the estimate below.
      const observation = precapped ? null : await this.deps.profileRouter.probe(profile, initial.estimatorSlot?.selection ?? {});
      return this.store.transaction(() => {
        const estimate = readEstimateRecord(this.store, id, estimateId), group = readWebGroup(this.store, id), proposal = readBudgetProposal(this.store, id);
        if (!["queued", "running", "start-unknown"].includes(estimate.state)) { clearSpendCapBlock(this.store, id, "estimate"); return null; }
        const existing = this.store.db.prepare("SELECT body FROM runs WHERE group_id=? AND work_item_id=?").get(id, estimateId);
        if (existing) return JSON.parse(String(existing.body)) as EstimateRun;
        // Issue-fixes spec §6.3 (Part E ruling 2): an archived group claims no estimate; it stays queued and its wake
        // pending until the group is unarchived.
        if (isGroupArchived(this.store, id)) return null;
        if (estimate.state !== "queued" || !estimate.request || estimate.profile === null) throw new ControlError("recovery-blocked");
        // Spec correction 2026-10-20: a queued estimate whose answer can no longer be used is withdrawn, not run -- before
        // prestart, which would throw for a started group and leave the wake re-delivered and the grant held forever.
        const withdrawn = withdrawalReason(this.store, id, group, proposal, estimate);
        if (withdrawn !== null) { withdrawEstimate(this.store, id, group, proposal, estimate, withdrawn); return null; }
        prestart(group); assertKnownConservation(this.store, group, proposal);
        // Estimate parking spec 2026-10-21: a stopped pre-start group's estimate waits, queued with its grant, for an un-stop.
        if (group.stopped) { parkEstimate(this.store, id, estimateId); return null; }
        this.deps.profileRouter.resolve("budget-estimate", estimate.profile.profileId, estimate.profile.profileHash);
        // Found capped before the probe: re-checked here (the block recorded or cleared), never claimed unprobed.
        if (observation === null) { gateClaim(this.store, id, estimate.grant.tokens, at, "estimate"); return null; }
        const degradationReasons = estimateCapabilityDegradationReasons(estimate.request, observation, estimate.mode);
        if (degradationReasons.length > 0) {
          estimate.state = "blocked-capability"; estimate.reasonCode = "estimate-capability-degraded";
          estimate.compatibilityReasonCodes = degradationReasons;
          group.ledger.committedRemaining = residual(group.reserved, zero(), estimate.grant);
          setReserve(proposal, residual(group.limit, group.used, group.ledger.committedRemaining));
          this.store.db.prepare("UPDATE estimates SET state=?,body=? WHERE group_id=? AND id=?").run(estimate.state, canonicalBytes(estimate).toString("utf8"), id, estimateId);
          saveWebAuthority(this.store, group, proposal); recordProjectionChange(this.store, [id]);
          return null;
        }
        // Accounts spec §6.3.1, D9: an estimate is a claim too; under a cap it stays queued and its wake pending.
        if (!gateClaim(this.store, id, estimate.grant.tokens, at, "estimate")) return null;
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
  /**
   * Kanban spec 2026-10-20 §3.1-§3.2: one pass of start-on-confirm. Each start is this service's own start path, sent as
   * orca-auto; a refusal is recorded with its backoff (orchestration.ts). The panel's pump calls it before wake delivery.
   */
  autoStart(prerequisites: PrerequisiteReader = waitingPrerequisites): ReturnType<typeof autoStartPass> {
    return autoStartPass({ store: this.store, now: () => (this.deps.now?.() ?? new Date()).getTime(), start: (command) => this.start(command as StartCommand), prerequisites });
  }
  /**
   * Tester round 2 spec §7.2 (ruling H4): the single automatic confirmer of ordinary groups. Each group the port-free
   * predicate `autoConfirmBlocker` (autoConfirm.ts) clears -- an unlimited-token draft a person created, nothing blocking
   * it -- has its agent slots resolved as orca-auto (condition 10), then is confirmed through the unchanged `confirm` as
   * orca-auto, start authorized (D7), under one command id per proposal version; an unresolved slot is booked under that
   * id as auto-confirm-selections-unresolved (N5). Never `integrationHash`, never `hold`, never a flow effect (§2.2).
   * The panel pump calls it after the flow pass and before `autoStart`, so a group it confirms starts in the same pass.
   */
  async autoConfirmUnlimitedPass(defaults: () => ImportDefaults | null = this.deps.defaults): Promise<{ confirmed: string[]; refused: Array<{ groupId: string; code: string }> }> {
    const confirmed: string[] = [], refused: Array<{ groupId: string; code: string }> = [];
    const current = defaults();
    for (const row of this.store.db.prepare("SELECT id, body FROM groups ORDER BY rowid").all()) {
      const groupId = String(row.id);
      let command: ConfirmCommand;
      try {
        if (autoConfirmBlocker(this.store, JSON.parse(String(row.body)) as Record<string, unknown>, current) !== null || current === null) continue;
        const proposal = readBudgetProposal(this.store, groupId), plan = readArchivedPlan(this.store, groupId);
        const profileId = current.estimatorProfileId!, profileHash = current.estimatorProfileHash!;
        // The worker profile's declared window is the handoff threshold when the proposal names none (the flow children's
        // binding, flowAssembly.ts): confirm refuses a null threshold under a profile that declares a window.
        const window = this.deps.profileRouter.resolve("task", profileId, profileHash).snapshot.profile.capabilities.contextWindowTokens;
        let selectionsHash: string | null;
        // Review I1: only a resolution that answers "unresolved" is booked; a thrown one (a transient port failure) books
        // nothing, so the next pass tries again.
        try { selectionsHash = (await resolveGroupSelections({ store: this.store, port: this.deps.port }, groupId, ORCHESTRATION_ACTOR)).selectionsHash; }
        catch (error) { process.stderr.write(`orca-control: automatic confirm of ${groupId} skipped: ${describeError(error)}\n`); continue; }
        const revision = Number(this.store.db.prepare("SELECT revision FROM groups WHERE id=?").get(groupId)!.revision);
        command = {
          schema: "orca-raw-command-v1", commandId: autoConfirmCommandId(proposal.proposalVersion), actorId: ORCHESTRATION_ACTOR, expectedRevision: revision,
          verb: "confirm", target: { kind: "group", groupId },
          payload: {
            planHash: plan.planHash, proposalVersion: proposal.proposalVersion, budgetMode: current.estimateMode,
            profileIds: { estimator: profileId, worker: profileId, handoff: profileId, goalReview: profileId },
            profileHashes: { estimator: profileHash, worker: profileHash, handoff: profileHash, goalReview: profileHash },
            contextPolicy: { handoffAtContextTokens: proposal.contextPolicy.handoffAtContextTokens ?? window },
            selectionsHash: selectionsHash ?? "0".repeat(64),
          },
        };
        if (selectionsHash === null) {
          // Condition 10, booked (round 2 N5): visible without a port, and condition 9 stops the next pass re-resolving.
          const failed = command;
          this.mutate(() => applyWebCommand(this.store, { rawCommand: failed, expand: () => ({ ...failed, schema: "orca-authority-command-v1" }), apply: () => { throw new ControlError("auto-confirm-selections-unresolved"); } }));
          refused.push({ groupId, code: "auto-confirm-selections-unresolved" });
          continue;
        }
      } catch (error) { // review M2: a group the pass cannot read is skipped, named once per pass
        process.stderr.write(`orca-control: automatic confirm of ${groupId} skipped: ${describeError(error)}\n`);
        continue;
      }
      const answer = await this.confirm(command);
      const error = (answer as { error?: { code?: unknown } }).error;
      if (error === undefined) confirmed.push(groupId); else refused.push({ groupId, code: String(error.code) });
    }
    return { confirmed, refused };
  }
  /**
   * Kanban spec 2026-10-20 §9a.2 (overrides integration spec 2026-10-08 §7's human-only approval for this path): a
   * group's integration conflict is handed to an agent by the driver, as orca-auto, through the same command a person
   * sends. One command per conflict attempt and group revision, so a pass that replays a refusal never loops; a person
   * can still send it. The resolution, once integrated, is flagged for the person (integrationPass.ts).
   */
  async autoResolveIntegrationConflicts(): Promise<{ started: string[]; refused: Array<{ groupId: string; code: string }> }> {
    const started: string[] = [], refused: Array<{ groupId: string; code: string }> = [];
    for (const row of this.store.db.prepare("SELECT id, revision, body FROM groups ORDER BY rowid").all()) {
      const groupId = String(row.id);
      let integration: GroupIntegration | null;
      try { integration = readGroupIntegration(JSON.parse(String(row.body))); } catch { continue; }
      if (integration === null || integration.state !== "conflict" || integration.conflict === null) continue;
      if (isGroupArchived(this.store, groupId)) continue;
      const revision = Number(row.revision);
      const command = {
        schema: "orca-raw-command-v1" as const, commandId: `orca-auto-resolve-${integration.conflict.attempt}-r${revision}`, actorId: ORCHESTRATION_ACTOR,
        expectedRevision: revision, verb: "resolve-integration-conflict" as const, target: { kind: "group" as const, groupId }, payload: {},
      };
      if (this.store.db.prepare("SELECT 1 FROM commands WHERE group_id=? AND id=?").get(groupId, command.commandId) !== undefined) continue;
      const answer = await this.resolveIntegrationConflict(command);
      const error = (answer as { error?: { code?: unknown } }).error;
      if (error === undefined) started.push(groupId); else refused.push({ groupId, code: String(error.code) });
    }
    return { started, refused };
  }
  /** System debug task spec 2026-10-21 §2: Orca opens (or finds) a debug group of its own (systemDebug.ts). */
  async openSystemDebugGroup(command: SystemDebugOpenCommand, reviewAgent?: PartialSelection): Promise<WebCommandResult> {
    const release = this.deps.admissionGate?.enter();
    try { return applySystemDebugOpen({ ...this.deps, repositoryPath: (repoId) => this.repositoryPath(repoId) }, command, reviewAgent); }
    finally { release?.(); }
  }
  /**
   * System debug task spec 2026-10-21 §2-§3, kanban spec §6 levels 1-3: one pass, as orca-auto. (1) A started group's
   * task that ended terminally failed is first re-dispatched once (level 1); failing again, with no ladder yet, it opens a
   * ladder debug group stacked on that group. (2) A system
   * debug group not yet confirmed is confirmed with its source group's profiles (start-on-confirm then starts it). (3) A
   * ladder debug group whose tasks are all done is folded into its original group's branch, and the failed task is
   * retried once. Every outcome that ends the ladder is written on the debug group's mark (level 3: needs you).
   */
  async systemDebugPass(): Promise<{ redispatched: string[]; opened: string[]; confirmed: string[]; folded: string[]; settled: string[] }> {
    const out = { redispatched: [] as string[], opened: [] as string[], confirmed: [] as string[], folded: [] as string[], settled: [] as string[] };
    // Failure-cause spec 2026-10-21 §5: a quota failure on an installation set to wait is retried once per failed run, as
    // orca-auto, after the re-probe interval; the retry's ledger row and its task-retried activity are its record.
    for (const candidate of quotaWaitCandidates(this.store, new Set(readOrchestrationSettings(this.store).quotaWait ?? []), this.store.now())) {
      const revision = Number(this.store.db.prepare("SELECT revision FROM groups WHERE id=?").get(candidate.groupId)?.revision ?? 0);
      this.retryTask({
        schema: "orca-raw-command-v1", commandId: `orca-auto-quota-retry-${candidate.taskId}-${candidate.runId}`, actorId: ORCHESTRATION_ACTOR,
        expectedRevision: revision, verb: "retry-task", target: { kind: "group", groupId: candidate.groupId }, payload: { taskId: candidate.taskId },
      });
    }
    for (const candidate of ladderCandidates(this.store)) {
      // Kanban spec §6 level 1 (ccloop priorFailures spec §3): the first escalation of a task is one fresh re-dispatch
      // as orca-auto; its run carries the earlier runs' failures (A2, priorFailures.ts). The retry-task command row is
      // the level's record -- once it exists (applied or refused), the next failure goes to level 2.
      const levelOne = ladderLevelOneCommandId(candidate.taskId);
      if (this.store.db.prepare("SELECT 1 FROM commands WHERE group_id=? AND id=?").get(candidate.groupId, levelOne) === undefined) {
        const revision = Number(this.store.db.prepare("SELECT revision FROM groups WHERE id=?").get(candidate.groupId)?.revision ?? 0);
        const answer = this.retryTask({
          schema: "orca-raw-command-v1", commandId: levelOne, actorId: ORCHESTRATION_ACTOR, expectedRevision: revision,
          verb: "retry-task", target: { kind: "group", groupId: candidate.groupId }, payload: { taskId: candidate.taskId },
        });
        if (!("error" in answer)) out.redispatched.push(`${candidate.groupId}:${candidate.taskId}`);
        continue;
      }
      const source = { kind: "ladder" as const, groupId: candidate.groupId, taskId: candidate.taskId, runId: candidate.run.runId };
      const groupId = systemDebugGroupId(source);
      let checks: string[];
      try {
        const task = readArchivedPlan(this.store, candidate.groupId).plan.tasks.find((entry) => entry.taskId === candidate.taskId);
        checks = task === undefined ? [] : taskContractSchema.parse(JSON.parse(task.originalContractCanonicalJson)).verification.requiredChecks;
      } catch { checks = []; }
      if (checks.length === 0) continue; // nothing to hold the debug task to: the task stays with the person (level 3)
      const answer = await this.openSystemDebugGroup({
        schema: "orca-raw-command-v1", commandId: `orca-auto-ladder-${candidate.taskId}`, actorId: ORCHESTRATION_ACTOR, expectedRevision: 0,
        verb: "system-debug-open", target: { kind: "group", groupId },
        payload: { source, stackOn: candidate.groupId, repoId: candidate.repoId, facts: ladderFacts(candidate.run), checks },
      });
      if (!("error" in answer)) out.opened.push(groupId);
    }
    // Protect-acceptance-criteria spec §5: each red test-change flag is judged first (criteriaReview.ts). The judge starts
    // from the flagged group's branch unless that group delivers locally (its change is then on the target already).
    const exists = (groupId: string) => this.store.db.prepare("SELECT 1 FROM groups WHERE id=?").get(groupId) !== undefined;
    for (const candidate of criteriaReviewCandidates(this.store, (source) => exists(systemDebugGroupId(source)))) {
      const groupId = systemDebugGroupId(candidate.source);
      let checks: string[];
      try {
        const task = readArchivedPlan(this.store, candidate.groupId).plan.tasks.find((entry) => entry.taskId === candidate.taskId);
        checks = task === undefined ? [] : taskContractSchema.parse(JSON.parse(task.originalContractCanonicalJson)).verification.requiredChecks;
      } catch { checks = []; }
      if (checks.length === 0) continue; // nothing to hold the judge to: the flag stays the person's
      const original = this.store.db.prepare("SELECT body FROM groups WHERE id=?").get(candidate.groupId);
      const local = original !== undefined && readGroupIntegration(JSON.parse(String(original.body)))?.scheme.delivery === "local";
      const answer = await this.openSystemDebugGroup({
        schema: "orca-raw-command-v1", commandId: `orca-auto-criteria-review-${candidate.runId}`, actorId: ORCHESTRATION_ACTOR, expectedRevision: 0,
        verb: "system-debug-open", target: { kind: "group", groupId },
        payload: { source: candidate.source, stackOn: local ? null : candidate.groupId, repoId: candidate.repoId, facts: criteriaReviewFacts(candidate), checks },
      });
      if (!("error" in answer)) out.opened.push(groupId);
    }
    for (const group of systemDebugGroups(this.store)) {
      const { groupId, mark } = group;
      // Checks spec 2026-10-22 §6.1: a review's group is settled into exactly one end of its own (modelReviewStep).
      if (mark.source.kind === "model-review" && mark.settled === null) {
        const step = await this.modelReviewStep(group);
        if (step === "confirmed") out.confirmed.push(groupId); else if (step === "settled") out.settled.push(groupId);
        continue;
      }
      if (mark.settled !== null || isGroupArchived(this.store, groupId)) continue;
      if (anyTaskFailed(this.store, groupId)) { settleSystemDebug(this.store, groupId, "debug-failed", null); out.settled.push(groupId); continue; }
      // §3: a person retried (or otherwise moved) the original task since: the ladder steps aside -- an unconfirmed debug
      // group is never started, a running one is not folded back.
      const superseded = mark.source.kind === "ladder" && terminallyFailedRun(this.store, mark.source.groupId, mark.source.taskId!)?.runId !== mark.source.runId;
      if (superseded && (group.status === "draft" || allTasksDone(this.store, groupId))) { settleSystemDebug(this.store, groupId, "superseded", null); out.settled.push(groupId); continue; }
      if (group.status === "draft") {
        // Checks spec 2026-10-22 §6.1: a finding's fix takes the profiles of its newest involved group that is confirmed,
        // else the repository's newest confirmed group.
        let profileGroup: string | null;
        if (isGroupSource(mark.source)) profileGroup = mark.source.groupId;
        else if (mark.source.kind === "model-review-finding") {
          const involved = readFlaggedDecision(this.store, `model-review:${mark.source.reviewGroupId}:${mark.source.findingId}`)?.involvedGroupIds ?? [];
          profileGroup = newestConfirmedGroup(this.store, mark.source.repoId, involved) ?? newestConfirmedGroup(this.store, mark.source.repoId);
        } else continue;
        const refused = profileGroup === null ? "no-profiles" : await this.autoConfirmSystemDebug(groupId, profileGroup);
        if (refused === null) out.confirmed.push(groupId); else { settleSystemDebug(this.store, groupId, "confirm-refused", refused); out.settled.push(groupId); }
        continue;
      }
      // Protect-acceptance-criteria spec §5: the judge is settled by its run, not by its task -- an empty attempt (justified)
      // leaves the task blocked (D14), which is the verdict, not a failure.
      if (mark.source.kind === "criteria-review") {
        if (criteriaReviewVerdict(this.store, groupId) === null) continue;
        const settled = await this.settleCriteriaReview(groupId, mark.source, mark.stackOn);
        settleSystemDebug(this.store, groupId, settled.state, settled.detail);
        out.settled.push(groupId);
        continue;
      }
      if (!allTasksDone(this.store, groupId)) continue;
      // Only a ladder group folds back; any other is done once its own work landed.
      if (mark.source.kind !== "ladder" || mark.stackOn === null) { settleSystemDebug(this.store, groupId, "done", null); out.settled.push(groupId); continue; }
      const refused = await this.foldLadder(groupId, mark.stackOn, mark.source.taskId!, mark.source.runId!);
      settleSystemDebug(this.store, groupId, refused === null ? "folded" : refused.state, refused?.detail ?? null);
      (refused === null ? out.folded : out.settled).push(groupId);
    }
    return out;
  }
  /**
   * Checks spec 2026-10-22 §6.1: one step of a review group, by code. Archived, not admitted within 24 h of opening
   * (archived then as orca-auto), stopped, refused at confirm or claim, or a run that ended without success ⇒ one
   * `errored` end; a succeeded run ⇒ its findings are read, checked and routed (completeModelReview). Null: nothing yet.
   */
  private async modelReviewStep(group: { groupId: string; status: string; mark: SystemDebugMark }): Promise<"confirmed" | "settled" | null> {
    const { groupId, mark } = group;
    const source = mark.source as Extract<SystemDebugMark["source"], { kind: "model-review" }>;
    const end = (detail: string): "settled" => { this.endModelReview(groupId, source, { state: "errored", at: this.store.now(), detail }); return "settled"; };
    if (isGroupArchived(this.store, groupId)) return end("archived");
    const orchestration = readGroupOrchestration(this.store, groupId);
    if ((orchestration?.startedRevision ?? null) === null && mark.openedAt !== undefined && this.store.now() - mark.openedAt >= MODEL_REVIEW_ADMIT_MS) {
      const revision = Number(this.store.db.prepare("SELECT revision FROM groups WHERE id=?").get(groupId)?.revision ?? 0);
      // A refused archive (something in motion) leaves the group live: not ended, retried on a later pass under a new
      // command id (a refusal is booked under its id and would only replay).
      const archived = this.archiveGroup({ schema: "orca-raw-command-v1", commandId: `orca-auto-not-admitted-${groupId}-${this.store.now()}`, actorId: ORCHESTRATION_ACTOR, expectedRevision: revision, verb: "archive-group", target: { kind: "group", groupId }, payload: {} } as ArchiveGroupCommand);
      return (archived as { error?: unknown }).error === undefined ? end("not-admitted") : null;
    }
    const stop = groupStopState(this.store, groupId);
    if (stop === "handoff-complete" || stop === "handoff-partial") return end("stopped");
    if (group.status === "draft") {
      const profileGroup = newestConfirmedGroup(this.store, source.repoId);
      if (profileGroup === null) return end("no-profiles");
      const refused = await this.autoConfirmSystemDebug(groupId, profileGroup);
      return refused === null ? "confirmed" : end(`confirm-refused:${refused}`);
    }
    const row = this.store.db.prepare("SELECT id, body FROM runs WHERE group_id=? ORDER BY rowid DESC LIMIT 1").get(groupId);
    if (row === undefined) {
      // §6.1: a claim refused for lack of grant or limit before any run is the budget's end; any other refusal is its own.
      if ((orchestration?.startedRevision ?? null) === null) return null;
      const decision = decideFundedAllowance(this.store, groupId, null, this.store.now());
      if (decision.allowance !== null) return null;
      // Only the group's limit is a budget end here: before any run the task's grant is whole, and
      // `task-budget-unavailable` is decideFundedAllowance's answer for every group it skips (a pause or stop intent, a
      // recovery blocker, unknown usage) -- those wait, with no end and nothing added to the streak.
      if (decision.reason === "group-budget-unavailable") return end("budget: limit");
      if (decision.reason === "spend-cap-reached") return end(`claim-refused:${decision.reason}`);
      return null;
    }
    const body = JSON.parse(String(row.body));
    const run = body as { runId: string; state: string; drive?: { outcome?: string | null; blockedReason?: string | null; landedCommit?: string | null; base?: string | null; failureCause?: { cause?: string }; budgetSnapshot?: ReviewRunFacts["budgetSnapshot"] } };
    const facts: ReviewRunFacts = {
      state: run.state, outcome: run.drive?.outcome ?? null, blockedReason: run.drive?.blockedReason ?? null, landedCommit: run.drive?.landedCommit ?? null,
      base: run.drive?.base ?? null, failureCause: run.drive?.failureCause?.cause ?? null, budgetSnapshot: run.drive?.budgetSnapshot ?? null,
    };
    // A blocked run ends the review only when recovery-retry cannot move it (ccloop's own terminal at C, or a write
    // outside the read-only set); any other block waits for a person's recovery-retry (or an archive/stop).
    if (run.state === "blocked") return isTerminallyFailedRun(body) || facts.blockedReason?.startsWith("out-of-bounds:") === true ? end(failedRunDetail(facts)) : null;
    // §6.1 any other non-succeeded terminal ⇒ run-failed -- unless its task was re-armed (a retry-task, a no-start): the
    // next claim continues the review.
    if (isTerminalRunState(run.state) && run.state !== "settled") {
      const rearmed = allWork(this.store, groupId).some((work) => work.kind === "task" && ["ready", "continuing"].includes(work.status));
      return rearmed ? null : end(failedRunDetail({ ...facts, blockedReason: facts.blockedReason ?? run.state }));
    }
    if (run.state !== "settled" || !allTasksDone(this.store, groupId)) return null;
    return this.completeModelReview(groupId, source, mark, run.runId, facts);
  }
  /** §5.2, §6.1: the review's end on its mark and on the check state, in one transaction. */
  private endModelReview(groupId: string, source: { repoId: string; target: string }, end: CheckEnd, extra: () => void = () => {}): void {
    this.store.transaction(() => {
      extra();
      if (writeSystemDebugSettled(this.store, groupId, end.state, end.detail ?? null)) applyCheckEnded(this.store, source.repoId, "model-review", source.target, { ...end, reviewGroupId: groupId });
    });
  }
  /**
   * §6.1 step 3, §6.4, §6.5: a succeeded review. Any path on its branch other than the findings file and its decision
   * ledger ⇒ not-read-only (nothing read); a findings file that fails the schema or names another range ⇒
   * findings-invalid; else each finding is checked against the range's groups and the files at its head, invalid ones are
   * dropped with their reason, valid ones flagged (major red with a fix group held to the involved groups' checks, when
   * they have any; minor not red), the record is written and the watermark moves -- with the end, in one transaction.
   */
  private async completeModelReview(groupId: string, source: Extract<SystemDebugMark["source"], { kind: "model-review" }>, mark: SystemDebugMark, runId: string, run: ReviewRunFacts): Promise<"settled"> {
    const at = this.store.now();
    const errored = (detail: string): "settled" => { this.endModelReview(groupId, source, { state: "errored", at, detail }); return "settled"; };
    const repo = this.repositoryPath(source.repoId);
    const tip = (await gitChild(repo, ["rev-parse", "--verify", "--quiet", `${workBranchRef(groupId)}^{commit}`])).stdout.trim() || run.landedCommit;
    if (tip === null || run.base === null) return errored("range-unavailable");
    const changed = (await gitChild(repo, ["diff", "--name-only", "--no-renames", run.base, tip])).stdout.split("\n").filter((line) => line !== "");
    if (changed.some((path) => path !== FINDINGS_PATH && !path.startsWith(".decisions/"))) return errored("not-read-only");
    const file = await gitChild(repo, ["show", `${tip}:${FINDINGS_PATH}`]);
    let value: unknown = null;
    try { value = file.code === 0 ? JSON.parse(file.stdout) : null; } catch { value = null; }
    const parsed = parseFindings(value, { from: source.from, to: source.to });
    if (!parsed.ok) return errored("findings-invalid");
    const included = new Set(mark.review?.groups ?? []);
    const landed = landedGroups(this.store, source.repoId).filter((entry) => included.has(entry.groupId));
    const boundaries = new Set(landedGroups(this.store, source.repoId, { includeSystem: true }).filter((entry) => entry.target === source.target).map((entry) => entry.integratedCommit));
    const groups = (await rangeOf(gitChild, repo, source.from, source.to, landed, boundaries)).groups;
    const lines = new Map<string, number | null>();
    for (const path of new Set(parsed.doc.findings.flatMap((entry) => entry.evidence.map((evidence) => evidence.path)))) {
      const shown = await gitChild(repo, ["show", `${source.to}:${path}`]);
      lines.set(path, shown.code !== 0 ? null : shown.stdout === "" ? 0 : shown.stdout.split("\n").length - (shown.stdout.endsWith("\n") ? 1 : 0));
    }
    const { valid, dropped } = validateFindings(parsed.doc, groups, (path) => lines.get(path) ?? null);
    const order = groups.map((entry) => entry.groupId);
    const involvedOf = (entry: Finding) => order.filter((id) => entry.evidence.some((evidence) => evidence.groupId === id));
    const routed: Array<{ findingId: string; severity: string; debugGroupId: string | null; detail: string | null }> = [];
    const debugGroupIds: string[] = [];
    for (const entry of valid) {
      if (entry.severity === "minor") { routed.push({ findingId: entry.id, severity: "minor", debugGroupId: null, detail: null }); continue; }
      const involved = involvedOf(entry);
      const checks = [...new Set(groups.filter((group) => involved.includes(group.groupId)).flatMap((group) => group.checks))].slice(0, 32);
      if (checks.length === 0) { routed.push({ findingId: entry.id, severity: "major", debugGroupId: null, detail: "no-checks: fix not opened" }); continue; }
      const findingSource = { kind: "model-review-finding" as const, repoId: source.repoId, reviewGroupId: groupId, findingId: entry.id };
      const fixId = systemDebugGroupId(findingSource);
      const facts = [`${entry.category} (${entry.severity}): ${entry.title}`, entry.explanation, ...entry.evidence.map((evidence) => `evidence: group ${evidence.groupId}, ${evidence.path}:${evidence.line}${evidence.note === "" ? "" : ` -- ${evidence.note}`}`), ...(entry.suggestedFix === "" ? [] : [`suggested fix: ${entry.suggestedFix}`])].map((fact) => fact.slice(0, 4096)).slice(0, 32);
      const answer = await this.openSystemDebugGroup({
        schema: "orca-raw-command-v1", commandId: `orca-auto-finding-${groupId}-${entry.id}`, actorId: ORCHESTRATION_ACTOR, expectedRevision: 0,
        verb: "system-debug-open", target: { kind: "group", groupId: fixId }, payload: { source: findingSource, stackOn: null, repoId: source.repoId, facts, checks },
      }, [...involved].reverse().map((id) => groupWorkerAgent(this.store, id)).find((agent) => agent !== undefined) ?? (() => { const profile = newestConfirmedGroup(this.store, source.repoId); return profile === null ? undefined : reviewAgentOf(this.store, profile); })());
      const error = (answer as { error?: { code?: unknown } }).error;
      if (error === undefined) debugGroupIds.push(fixId);
      routed.push({ findingId: entry.id, severity: "major", debugGroupId: error === undefined ? fixId : null, detail: error === undefined ? null : `fix-open-refused:${String(error.code)}` });
    }
    const record = { schema: "orca-model-review-record-v1", reviewGroupId: groupId, runId, range: { target: source.target, from: source.from, to: source.to }, groups: order, valid, dropped: dropped.map((entry) => ({ findingId: entry.finding.id, reason: entry.reason })), routed };
    const recordJson = canonicalBytes(record).toString("utf8"), recordHash = sha256Canonical(record);
    const iso = new Date(at).toISOString();
    this.endModelReview(groupId, source, { state: "completed", at, moveTo: source.to, debugGroupIds, recordHash, detail: null }, () => {
      writeCanonicalRecord(this.store, groupId, recordHash, recordJson);
      for (const entry of valid) flagDecision(this.store, {
        decisionId: `model-review:${groupId}:${entry.id}`, groupId, runId, source: "model-review", reason: `${entry.category}: ${entry.title}`.slice(0, 2048),
        evidence: entry.evidence.map((evidence) => `${evidence.groupId}:${evidence.path}:${evidence.line}`), by: ORCHESTRATION_ACTOR, at: iso,
        severity: entry.severity, involvedGroupIds: involvedOf(entry).slice(0, 8),
      });
    });
    return "settled";
  }
  /** §2: confirm as orca-auto with the source group's confirmed profiles, budget mode and context policy; null, or why not. */
  private async autoConfirmSystemDebug(groupId: string, sourceGroupId: string): Promise<string | null> {
    const source = readBudgetProposal(this.store, sourceGroupId);
    if (source.state !== "confirmed" || source.profiles === null || source.budgetMode === null) return "source-not-confirmed";
    const proposal = readBudgetProposal(this.store, groupId), plan = readArchivedPlan(this.store, groupId);
    const commandId = `orca-auto-confirm-v${proposal.proposalVersion}`;
    if (this.store.db.prepare("SELECT 1 FROM commands WHERE group_id=? AND id=?").get(groupId, commandId) !== undefined) return "confirm-already-refused";
    let selectionsHash: string | null;
    try { selectionsHash = (await resolveGroupSelections({ store: this.store, port: this.deps.port }, groupId, ORCHESTRATION_ACTOR)).selectionsHash; }
    catch (error) { return describeError(error); }
    if (selectionsHash === null) return "agent-selection-rejected";
    const row = this.store.db.prepare("SELECT revision, body FROM groups WHERE id=?").get(groupId)!;
    const integration = readGroupIntegration(JSON.parse(String(row.body)));
    const { profiles } = source;
    const answer = await this.confirm({
      schema: "orca-raw-command-v1", commandId, actorId: ORCHESTRATION_ACTOR, expectedRevision: Number(row.revision), verb: "confirm", target: { kind: "group", groupId },
      payload: {
        planHash: plan.planHash, proposalVersion: proposal.proposalVersion, budgetMode: source.budgetMode,
        profileIds: { estimator: profiles.estimator?.profileId ?? null, worker: profiles.worker.profileId, handoff: profiles.handoff.profileId, goalReview: profiles.goalReview.profileId },
        profileHashes: { estimator: profiles.estimator?.profileHash ?? null, worker: profiles.worker.profileHash, handoff: profiles.handoff.profileHash, goalReview: profiles.goalReview.profileHash },
        contextPolicy: source.contextPolicy, selectionsHash, ...(integration === null ? {} : { integrationHash: integration.schemeHash }),
      },
    });
    const error = (answer as { error?: { code?: unknown } }).error;
    return error === undefined ? null : String(error.code);
  }
  /**
   * Protect-acceptance-criteria spec §5 (criteriaReview.ts): the judge's verdict. Justified (an empty attempt) or
   * restored (a stacked judge's fix is fast-forwarded into the flagged group's branch) clears the flag as orca-auto; an
   * unreadable verdict or a refused fold leaves it red for the person.
   */
  private async settleCriteriaReview(debugGroupId: string, source: { groupId: string; runId: string | null }, stackOn: string | null): Promise<{ state: string; detail: string | null }> {
    const verdict = criteriaReviewVerdict(this.store, debugGroupId);
    if (verdict === null) return { state: "verdict-unknown", detail: null };
    if (verdict === "restored" && stackOn !== null) {
      const refused = await this.fastForwardGroupBranch(debugGroupId, stackOn);
      if (refused !== null) return refused;
    }
    const decisionId = criteriaDecisionIdOf({ kind: "criteria-review", groupId: source.groupId, taskId: null, runId: source.runId });
    try {
      this.store.transaction(() => ratifyFlag(this.store, source.groupId, decisionId, {
        actorId: ORCHESTRATION_ACTOR, commandId: `orca-auto-criteria-review-${debugGroupId}`, at: new Date(this.store.now()).toISOString(),
      }));
    } catch (error) {
      // A person ratified it first, or the flag is gone: the verdict stands, nothing to clear.
      if (!(error instanceof ControlError)) throw error;
    }
    return { state: verdict, detail: null };
  }
  /** Fast-forward `orca/<original>` to the debug group's branch when it is an ancestor; null, or why not. */
  private async fastForwardGroupBranch(debugGroupId: string, originalGroupId: string): Promise<{ state: string; detail: string | null } | null> {
    const repoId = this.planRepository(originalGroupId);
    if (repoId === null) return { state: "fold-refused", detail: "original-repository-unknown" };
    try {
      const repo = this.repositoryPath(repoId);
      const debugHead = await revParse(repo, workBranchRef(debugGroupId)), originalHead = await revParse(repo, workBranchRef(originalGroupId));
      if (debugHead !== originalHead) {
        try { await git(repo, [...QUIET_GIT, "merge-base", "--is-ancestor", originalHead, debugHead]); }
        catch { return { state: "fold-refused", detail: `orca/${originalGroupId} moved: not an ancestor of orca/${debugGroupId}` }; }
        await git(repo, [...QUIET_GIT, "update-ref", workBranchRef(originalGroupId), debugHead, originalHead]);
      }
    } catch (error) { return { state: "fold-refused", detail: describeError(error) }; }
    return null;
  }
  /**
   * §3.3: fast-forward the original group's branch to the debug group's (only when it is an ancestor -- it cannot have
   * moved while its task was blocked), then retry the failed task once as orca-auto. Idempotent: a branch already moved
   * by an earlier pass is only retried.
   */
  private async foldLadder(debugGroupId: string, originalGroupId: string, taskId: string, failedRunId: string): Promise<{ state: string; detail: string | null } | null> {
    const refused = await this.fastForwardGroupBranch(debugGroupId, originalGroupId);
    if (refused !== null) return refused;
    const revision = Number(this.store.db.prepare("SELECT revision FROM groups WHERE id=?").get(originalGroupId)?.revision ?? 0);
    const answer = this.retryTask({
      schema: "orca-raw-command-v1", commandId: `orca-auto-ladder-retry-${taskId}-${failedRunId}`, actorId: ORCHESTRATION_ACTOR,
      expectedRevision: revision, verb: "retry-task", target: { kind: "group", groupId: originalGroupId }, payload: { taskId },
    });
    const error = (answer as { error?: { code?: unknown; message?: unknown } }).error;
    // The retry-task command is the rerun's record (its ledger row names orca-auto; it writes task-retried).
    if (error === undefined) return null;
    return { state: "retry-refused", detail: `${String(error.code)}${typeof error.message === "string" && error.message !== "" ? `: ${error.message}` : ""}` };
  }
  /** Protect-acceptance-criteria spec §5: an owner turns the repository's automatic reviewer on or off. */
  setCriteriaReview(command: SetCriteriaReviewCommand): WebCommandResult {
    return this.mutate(() => applySetCriteriaReview({ store: this.store, admissionGate: this.deps.admissionGate, knownRepository: this.settingsKnownRepository() }, command)) as WebCommandResult;
  }
  /**
   * Checks spec 2026-10-22 §4.4: a person's check settings, schedules, locks, run-now and resume (checks/commands.ts).
   * Multi-directory projects spec §4.3: set-check-settings refuses a multi id inside its transaction; the orchestration
   * commands below are unchanged.
   */
  private checkDeps() {
    return { store: this.store, admissionGate: this.deps.admissionGate, knownRepository: (repoId: string) => this.deps.knownRepository?.(repoId) ?? false };
  }
  /**
   * Multi-directory projects spec §4.3: the settings setters' known test. A multi id's settings live on its members, so
   * it is refused by name -- thrown inside the transaction, which books it as the command's durable outcome.
   */
  private settingsKnownRepository(): (repoId: string) => boolean {
    return (repoId: string) => {
      if (this.deps.multiDirRepoId?.(repoId) ?? false) throw new ControlError("multi-dir-project-setting-unsupported");
      return this.deps.knownRepository?.(repoId) ?? false;
    };
  }
  setCheckSettings(command: CheckCommand<"set-check-settings">): WebCommandResult {
    return this.mutate(() => applySetCheckSettings({ ...this.checkDeps(), knownRepository: this.settingsKnownRepository() }, command)) as WebCommandResult;
  }
  setScheduledCheck(command: CheckCommand<"set-scheduled-check">): WebCommandResult {
    return this.mutate(() => applySetScheduledCheck({ ...this.checkDeps(), knownRepository: this.settingsKnownRepository() }, command)) as WebCommandResult;
  }
  setCheckLocks(command: CheckCommand<"set-check-locks">): WebCommandResult { return this.mutate(() => applySetCheckLocks(this.checkDeps(), command)) as WebCommandResult; }
  runCheckNow(command: CheckCommand<"run-check-now">): WebCommandResult { return this.mutate(() => applyRunCheckNow(this.checkDeps(), command)) as WebCommandResult; }
  resumeCheck(command: CheckCommand<"resume-check">): WebCommandResult { return this.mutate(() => applyResumeCheck(this.checkDeps(), command)) as WebCommandResult; }
  /** Flow engine spec §11.2: a person's flow settings of a layer and the global locks (flow/settingsCommands.ts). */
  setFlowSettings(command: FlowSettingsCommand<"set-flow-settings">): WebCommandResult {
    return this.mutate(() => applySetFlowSettings({ ...this.checkDeps(), knownRepository: this.settingsKnownRepository() }, command)) as WebCommandResult;
  }
  setFlowLocks(command: FlowSettingsCommand<"set-flow-locks">): WebCommandResult { return this.mutate(() => applySetFlowLocks(this.checkDeps(), command)) as WebCommandResult; }
  /** Flow engine spec §14.2: every flow verb (flowCommands.ts); the kernel acts first, the ledger books the outcome. */
  async flowCommand(command: FlowCommand): Promise<WebCommandResult> {
    const release = this.deps.admissionGate?.enter();
    try { return await applyFlowCommand({ store: this.store, flow: this.deps.flowDeps ?? (() => null), projects: this.deps.flowProjects ?? (() => []) }, command) as WebCommandResult; }
    finally { release?.(); }
  }
  /** Scheduled flows and groups spec §5.3, §5.6: the plan library's writes (planLibrary/commands.ts), one transaction each. */
  planLibraryCommand(command: PlanLibraryCommand): WebCommandResult {
    return this.mutate(() => applyPlanLibraryCommand({ store: this.store, ...(this.deps.resolveRepository === undefined ? {} : { resolveRepository: this.deps.resolveRepository }), ...(this.deps.now === undefined ? {} : { now: this.deps.now }) }, command)) as WebCommandResult;
  }
  /** Scheduled flows and groups spec §6, §11.1: a schedule's writes (schedules/commands.ts), one transaction each. */
  scheduleCommand(command: ScheduleCommand): WebCommandResult {
    return this.mutate(() => applyScheduleCommand({
      store: this.store, flowProjects: this.deps.flowProjects ?? (() => []), knownRepository: this.deps.knownRepository ?? (() => false),
      ...(this.deps.resolveRepository === undefined ? {} : { resolveRepository: this.deps.resolveRepository }), ...(this.deps.now === undefined ? {} : { now: this.deps.now }),
    }, command)) as WebCommandResult;
  }
  /**
   * Scheduled flows and groups spec §7.2: one scheduler pass (schedules/pass.ts), the pump's step after `checksPass` and
   * before the flow pass. The starters are the caller's -- a panel with no execution driver passes none, so a flow fire
   * fails `control-target-not-allowed` as any other unnamed target would.
   */
  async schedulesPass(starters: Omit<SchedulePassDeps, "store" | "now"> = {}): Promise<{ crashes: string[] }> {
    // §9.2 rule 6: step 9 reads the control config's defaults, never a caller's copy of them.
    return schedulesPass({ store: this.store, now: () => (this.deps.now?.() ?? new Date()).getTime(), ...starters, defaults: () => this.deps.defaults() });
  }
  private readonly checkJobs = new Map<string, Promise<void>>();
  /**
   * Checks spec 2026-10-22 §2–§5 (kanban spec §7 layer 1 on the check model): for each repository, convert the pre-16
   * integration-check state once (§5.1), then evaluate each enabled check kind per target: the range W..H since the
   * watermark, its facts, and the effective trigger (project > global > built-in). A due integration check runs without
   * the pump waiting for it -- a slow suite must not hold the pump; a red one opens a system debug group as orca-auto
   * (the next system debug pass confirms it). One run per (project, kind, target) at a time; a `running` record no job
   * of this process owns was cut off by a stop and is forgotten (no failure counted).
   */
  async checksPass(): Promise<{ started: string[]; initialised: string[]; skipped: string[]; opened: string[] }> {
    const out = { started: [] as string[], initialised: [] as string[], skipped: [] as string[], opened: [] as string[] };
    if (this.deps.resolveRepository === undefined) return out;
    const repoIds = [...new Set(this.store.db.prepare("SELECT body FROM groups").all().flatMap((row) => {
      try { const repoId = (JSON.parse(String(row.body)) as { plan?: { repoId?: unknown } }).plan?.repoId; return typeof repoId === "string" ? [repoId] : []; } catch { return []; }
    }))];
    const now = (this.deps.now?.() ?? new Date()).getTime();
    for (const repoId of repoIds) {
      try {
        const repo = this.repositoryPath(repoId);
        await migrateIntegrationMeta(this.store, gitChild, repo, repoId);
        const settings = effectiveChecks(this.store, repoId).kinds["integration-check"];
        for (const target of projectTargets(this.store, repoId)) await this.modelReviewTick(repoId, repo, target, now, out);
        for (const target of projectTargets(this.store, repoId)) {
          const key = `${repoId}\0integration-check\0${target}`;
          if (this.checkJobs.has(key)) continue; // in flight: its slots and a pending run stay pending (§2.4)
          if (readCheckState(this.store, repoId, "integration-check", target)?.last?.state === "running") {
            recordCheckEnded(this.store, repoId, "integration-check", target, { state: "errored", at: now, detail: "interrupted: Orca stopped while it ran", interrupted: true });
          }
          const due = await this.dueCheck(repoId, repo, "integration-check", target, now, out);
          if (due === null) continue;
          const groups = due.range.groups;
          const commands = settings.command.value !== null ? [settings.command.value] : [...new Set(groups.flatMap((group) => group.checks))];
          if (commands.length === 0) {
            // Nothing to run: a slot or a run now that asked is consumed, not left to ask at every pass.
            if (asked(due.starters)) { recordCheckSkipped(this.store, repoId, "integration-check", target, now, due.starters, "nothing to run"); if (!out.skipped.includes(repoId)) out.skipped.push(repoId); }
            continue;
          }
          recordCheckStarted(this.store, repoId, "integration-check", target, now, due.range, {}, due.starters);
          const job = this.runIntegrationCheckJob(repoId, target, groups, due.range.to, commands, now)
            .finally(() => { this.checkJobs.delete(key); });
          this.checkJobs.set(key, job);
          out.started.push(repoId);
        }
      } catch (error) {
        process.stderr.write(`orca-control: checks ${repoId}: ${describeError(error)}\n`);
      }
    }
    return out;
  }
  /**
   * Checks spec 2026-10-22 §2, §6.1-§6.2: the model-review kind on one target. One review in flight per (project, kind,
   * target) -- its group, until settled; a `running` record with no group was cut off before the open and is forgotten.
   * A due trigger cuts the range to maxGroupsPerReview (oldest first), writes the inputs under the runs root and opens
   * the review group as orca-auto; no confirmed group in the project, or a findings path the range's denylist forbids,
   * ends the run errored without opening anything.
   */
  /**
   * Checks spec 2026-10-22 §2.4, §5.3-§5.4: whether one (project, kind, target) with no run in flight starts now, and
   * over which range. Its starters are the kind's event trigger (only while the kind is enabled), each enabled scheduled
   * check of the kind with a due slot, and a person's pending "run now"; a paused check is started by the last alone. A
   * kind with none of them configured is not evaluated at all. No watermark ⇒ initialised (the starters consumed with
   * it); an empty range asked for by a slot or a run now ⇒ consumed and recorded `skipped: nothing new`.
   */
  private async dueCheck(repoId: string, repo: string, kind: CheckKind, target: string, now: number, out: { initialised: string[]; skipped: string[] }): Promise<{ range: CheckRange; state: CheckState; starters: Starters } | null> {
    const effective = effectiveChecks(this.store, repoId);
    const enabled = effective.kinds[kind].enabled.value;
    const schedules = effective.scheduled.map((entry) => entry.value).filter((entry) => entry.kind === kind && entry.enabled);
    if (!enabled && schedules.length === 0 && (readCheckState(this.store, repoId, kind, target)?.pendingRun ?? null) === null) return null;
    const timeZone = readUsageCalendar(this.store).timeZone;
    const state = initialiseSlots(this.store, repoId, kind, target, schedules, timeZone, now);
    const starters = dueStarters(state, schedules, timeZone, now);
    if (state.paused && !asked(starters)) return null;
    const prepared = await prepareRange(this.store, gitChild, repo, repoId, kind, target, now);
    if (prepared.kind === "initialised") {
      if (asked(starters)) consumeStarters(this.store, repoId, kind, target, starters);
      if (!out.initialised.includes(repoId)) out.initialised.push(repoId);
      return null;
    }
    if (prepared.kind === "errored") return null;
    if (prepared.kind === "idle" || prepared.range.groups.length === 0) {
      if (asked(starters)) { recordCheckSkipped(this.store, repoId, kind, target, now, starters); if (!out.skipped.includes(repoId)) out.skipped.push(repoId); }
      return null;
    }
    const byTrigger = enabled && evaluateTrigger(effective.kinds[kind].trigger.value, rangeFacts(this.store, repoId, prepared.range.groups, prepared.state, now));
    return byTrigger || asked(starters) ? { range: prepared.range, state: prepared.state, starters } : null;
  }
  private async modelReviewTick(repoId: string, repo: string, target: string, now: number, out: { initialised: string[]; skipped: string[]; opened: string[] }): Promise<void> {
    const settings = effectiveChecks(this.store, repoId).kinds["model-review"];
    const last = readCheckState(this.store, repoId, "model-review", target)?.last ?? null;
    if (last?.state === "running") {
      const body = last.reviewGroupId === null ? undefined : this.store.db.prepare("SELECT body FROM groups WHERE id=?").get(last.reviewGroupId);
      if (body !== undefined) return; // its group settles it (systemDebugPass)
      recordCheckEnded(this.store, repoId, "model-review", target, { state: "errored", at: now, detail: "interrupted: Orca stopped before the review opened", interrupted: true });
    }
    const due = await this.dueCheck(repoId, repo, "model-review", target, now, out);
    if (due === null) return;
    const { groups, to } = await cutRange(gitChild, repo, due.range, settings.maxGroupsPerReview.value);
    const source = { kind: "model-review" as const, repoId, target, from: due.range.from, to, runSeq: due.state.runSeq + 1 };
    const reviewId = systemDebugGroupId(source);
    recordCheckStarted(this.store, repoId, "model-review", target, now, { from: source.from, to, groups }, { reviewGroupId: reviewId }, due.starters);
    const end = (detail: string) => recordCheckEnded(this.store, repoId, "model-review", target, { state: "errored", at: now, detail: detail.slice(0, 500) });
    try {
      const profileGroup = newestConfirmedGroup(this.store, repoId);
      if (profileGroup === null) { end("no-profiles"); return; }
      const denylist = rangeDenylist(this.store, groups);
      if (reviewPathDenied(denylist)) { end("findings-path-denied"); return; }
      const stats = new Map<string, string>();
      for (const group of groups) stats.set(group.groupId, (await gitChild(repo, ["diff", "--shortstat", `${group.integratedCommit}^1`, group.integratedCommit])).stdout.trim());
      const instruction = [
        "Review the groups that landed in the range for, in priority order: (1) contract or convention drift between groups, (2) duplication, (3) whole behaviour no check covers.",
        `Change no file except ${FINDINGS_PATH}. Write it as orca-model-review-findings-v1 with range {from: ${source.from}, to: ${to}}.`,
        "Every finding needs evidence (group, path, line) from two groups that landed in the range. Report nothing rather than guess.",
      ].join("\n");
      const inputs = reviewInputsOf(this.store, { target, from: source.from, to }, groups, (group) => stats.get(group.groupId) ?? "", instruction);
      const dir = joinPath(controlWorkspaceRoots(this.store.stateDir).runsRoot, "model-review", reviewId);
      const written = await writeReviewInputs(dir, inputs);
      const answer = await this.openSystemDebugGroup({
        schema: "orca-raw-command-v1", commandId: `orca-auto-model-review-${reviewId}`, actorId: ORCHESTRATION_ACTOR, expectedRevision: 0,
        verb: "system-debug-open", target: { kind: "group", groupId: reviewId },
        payload: {
          source, stackOn: null, repoId, facts: [`model review of ${source.from}..${to} on ${target}; inputs: ${dir}`.slice(0, 4096)], checks: [validatorCommand(source.from, to)],
          review: { inputDir: dir, inputSha256: written.sha256, groups: groups.map((group) => group.groupId), budgetTokens: settings.budgetTokens.value, denylistPaths: denylist },
        },
      }, reviewAgentOf(this.store, profileGroup));
      const error = (answer as { error?: { code?: unknown } }).error;
      if (error !== undefined) { end(`open-refused:${String(error.code)}`); return; }
      out.opened.push(reviewId);
    } catch (error) { end(describeError(error)); }
  }
  /** Every check run this process started, settled (tests; a shutdown does not wait for them). */
  async checksSettled(): Promise<void> { await Promise.all([...this.checkJobs.values()]); }
  private async runIntegrationCheckJob(repoId: string, target: string, groups: readonly RangeGroup[], head: string, commands: string[], at: number): Promise<void> {
    const ids = groups.map((group) => group.groupId);
    try {
      const run = await runIntegrationCheck(this.repositoryPath(repoId), controlWorkspaceRoots(this.store.stateDir), repoId, target, commands, at, join(this.store.stateDir, DISPATCHED_PERSON_DIRNAME));
      // §5.2: a completed check (green or red) covers its range: the watermark moves to the head it read at the start.
      if (run.failures.length === 0) { recordCheckEnded(this.store, repoId, "integration-check", target, { state: "passed", at, moveTo: head }); return; }
      const source = { kind: "integration-check" as const, groupId: ids.at(-1)!, taskId: null, runId: `check-${at}` };
      const groupId = systemDebugGroupId(source);
      const answer = await this.openSystemDebugGroup({
        schema: "orca-raw-command-v1", commandId: `orca-auto-integration-check-${at}`, actorId: ORCHESTRATION_ACTOR, expectedRevision: 0,
        verb: "system-debug-open", target: { kind: "group", groupId },
        payload: { source, stackOn: null, repoId, facts: integrationCheckFacts(run, ids, target), checks: run.failures.map((failure) => failure.command) },
      });
      const error = (answer as { error?: { code?: unknown } }).error;
      recordCheckEnded(this.store, repoId, "integration-check", target, { state: "failed", at, moveTo: head, detail: run.failures.map((failure) => failure.command).join("; ").slice(0, 500), debugGroupIds: error === undefined ? [groupId] : [] });
    } catch (error) {
      recordCheckEnded(this.store, repoId, "integration-check", target, { state: "errored", at, detail: describeError(error).slice(0, 500) });
    }
  }
  /** Kanban spec §3.3, §9a.5: a person's edge between groups (groupEdges.ts). */
  addGroupDependency(command: AddGroupDependencyCommand): WebCommandResult {
    return this.mutate(() => applyAddGroupDependency({ store: this.store }, command)) as WebCommandResult;
  }
  removeGroupDependency(command: RemoveGroupDependencyCommand): WebCommandResult {
    return this.mutate(() => applyRemoveGroupDependency({ store: this.store }, command)) as WebCommandResult;
  }
  /** Kanban spec §3.2: the running-group cap (orchestrationCommands.ts). */
  setOrchestrationSettings(command: SetOrchestrationSettingsCommand): WebCommandResult {
    return this.mutate(() => applySetOrchestrationSettings({ store: this.store, admissionGate: this.deps.admissionGate }, command)) as WebCommandResult;
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
    const replay = preflightWebCommand<WebCommandResult>(this.store, command); if (replay) return replay.body;
    const outputBound = command.target.kind === "group" ? await this.retryOutputBound(command.target.groupId) : null;
    return applyRecoveryRetry(this.stopDeps(), command, outputBound) as WebCommandResult;
  }
  /**
   * Spec 2026-10-15 ccloop error codes §4.8: for a clarifying requirement whose latest round or draft failed or was
   * interrupted, the output bound its calls would be sent with now -- asked of the frozen selection (plan correction K5)
   * through the requirement's own profile. Null, with one log line, when it cannot be asked: the retry is as before.
   */
  private async retryOutputBound(groupId: string): Promise<number | null> {
    const row = this.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
    if (row === undefined || !hasRequirementBlock(JSON.parse(String(row.body)) as { requirement?: unknown })) return null;
    const group = readRequirementGroup(this.store, groupId);
    if (group.status !== "clarifying") return null;
    const step = group.requirement.consensus === null ? latestRound(this.store, groupId) : latestDraft(this.store, groupId);
    if (step === null || (step.state !== "failed" && step.state !== "interrupted")) return null;
    const kept = (reason: string): null => { process.stderr.write(`orca-control: recovery-retry ${groupId}: output bound kept at ${group.requirement.maxOutputTokens}: ${reason}\n`); return null; };
    let profile: ReturnType<ExecutionProfileRouter["resolve"]>;
    try { profile = this.deps.profileRouter.resolve("budget-estimate", group.requirement.profile.profileId, group.requirement.profile.profileHash); }
    catch (error) { return kept(describeError(error)); }
    const preflight = profile.snapshot.profile.estimatorPreflight;
    if (preflight === null) return kept("estimator-preflight-missing");
    const observation = await this.deps.profileRouter.probe(profile, group.requirement.agentSlot.selection);
    if (observation.resolution === null) return kept(observation.probeFailureCode ?? "probe-failed");
    return singleCallOutputBound(preflight.maxOutputTokens, observation.resolution);
  }
  /** N1 spec §11.1. */
  openRequirement(command: RequirementOpenCommand): Promise<WebCommandResult> { return applyRequirementOpen(this.deps, command); }
  answerRequirement(command: RequirementAnswerCommand): WebCommandResult { return applyRequirementAnswer(this.deps, command); }
  requirementConsensus(command: RequirementConsensusCommand): WebCommandResult { return applyRequirementConsensus(this.deps, command); }
  requirementDraftFeedback(command: RequirementDraftFeedbackCommand): WebCommandResult { return applyRequirementDraftFeedback(this.deps, command); }
  /** Clarify caps spec 2026-10-21 §3.1, §3.3. */
  requirementClarifyMore(command: RequirementClarifyMoreCommand): WebCommandResult { return applyRequirementClarifyMore(this.deps, command); }
  requirementRevise(command: RequirementReviseCommand): WebCommandResult { return applyRequirementRevise(this.deps, command); }
  requirementClassify(command: RequirementClassifyCommand): WebCommandResult { return applyRequirementClassify(this.deps, command); }
  /** N1 spec §9.1. */
  acceptRequirementDraft(command: RequirementDraftAcceptCommand): Promise<WebCommandResult> { return applyRequirementDraftAccept(this.deps, command); }
  /** Execution driver spec §3.2. A panel started without the repository refuses it by name. */
  async setWorkspaceMode(command: SetWorkspaceModeCommand): Promise<WebCommandResult> {
    return applySetWorkspaceMode({ store: this.store, admissionGate: this.deps.admissionGate, knownRepository: this.settingsKnownRepository() }, command) as WebCommandResult;
  }
  repositoryKnown(repoId: string): boolean { return this.deps.knownRepository?.(repoId) ?? false; }
  /**
   * Integration spec §3.3: the repository's git checks run after the replay check and before the transaction, which
   * refuses from what they found. An unknown repository is not checked; the transaction refuses it by name.
   */
  async setIntegrationScheme(command: SetIntegrationSchemeCommand): Promise<WebCommandResult> {
    const knownRepository = this.deps.knownRepository ?? (() => false);
    // The git checks run before the admission gate is entered: a drain never waits on a git child.
    // Dir-requirements spec §7: a `dir` project's folder is not checked (the transaction refuses it dir-group-delivery-fixed).
    // Multi-directory projects spec §4.3: a multi id is refused inside the transaction, so its check is skipped here (an
    // earlier throw would escape the durable booking).
    const multiDir = this.deps.multiDirRepoId?.(command.target.repoId) ?? false;
    const dirProject = (this.deps.dirProjectOf?.(command.target.repoId) ?? null) !== null;
    const failedCheck = !multiDir && knownRepository(command.target.repoId) && !dirProject ? await this.schemeCheck(command.target.repoId, command.payload.integration) : null;
    const release = this.deps.admissionGate?.enter();
    try {
      const replay = preflightWebCommand<WebCommandResult>(this.store, command); if (replay) return replay.body;
      return applySetIntegrationScheme({ store: this.store, knownRepository: this.settingsKnownRepository(), dirProjectOf: this.deps.dirProjectOf }, command, failedCheck) as WebCommandResult;
    } finally { release?.(); }
  }
  /**
   * Integration spec §3.1, §3.3: the group's copy of the scheme. The setter's git checks run against the plan's
   * repository after the replay check and before the transaction; a group without a plan (missing, clarifying) is not
   * checked, and the transaction refuses it by name.
   */
  async setGroupIntegration(command: SetGroupIntegrationCommand): Promise<WebCommandResult> {
    // Dir-requirements spec §7: a dir group's folder is not checked (the transaction refuses it dir-group-delivery-fixed).
    // Multi-directory projects spec §9.2: a multi group's delivery is frozen per member (multi-dir-delivery-fixed).
    const repoId = isDirGroup(this.store, command.target.groupId) || isMultiGroup(this.store, command.target.groupId) ? null : this.planRepository(command.target.groupId);
    const failedCheck = repoId === null ? null : await this.schemeCheck(repoId, command.payload.integration);
    const release = this.deps.admissionGate?.enter();
    try {
      const replay = preflightWebCommand<WebCommandResult>(this.store, command); if (replay) return replay.body;
      return applySetGroupIntegration({ store: this.store }, command, failedCheck) as WebCommandResult;
    } finally { release?.(); }
  }
  /** Integration spec §6.5: a blocked or conflicted integration back to idle (no git child; the next round retries it). */
  retryIntegration(command: RetryIntegrationCommand): WebCommandResult {
    return this.mutate(() => applyRetryIntegration({ store: this.store }, command)) as WebCommandResult;
  }
  /** Dir-requirements spec §9.2: the person's answer to a stopped folder change (no git child; the next round acts). */
  resolveFolderChange(command: ResolveFolderChangeCommand): WebCommandResult {
    return this.mutate(() => applyResolveFolderChange({ store: this.store }, command)) as WebCommandResult;
  }
  /** Multi-directory projects spec §9.7: retry the rest, or record that the person landed it (no git child; next round acts). */
  multiDirLanding(command: MultiDirLandingCommand): WebCommandResult {
    return this.mutate(() => applyMultiDirLanding({ store: this.store }, command)) as WebCommandResult;
  }
  /** Issue-fixes spec §6.3: archive a group (it keeps every record and takes no new work) / take it back. */
  archiveGroup(command: ArchiveGroupCommand): WebCommandResult {
    return this.mutate(() => applyArchiveGroup({ store: this.store }, command)) as WebCommandResult;
  }
  unarchiveGroup(command: UnarchiveGroupCommand): WebCommandResult {
    return this.mutate(() => applyUnarchiveGroup({ store: this.store }, command)) as WebCommandResult;
  }
  /**
   * Integration spec §7: an owner approves an agent's resolution of the conflict. The conflict's copy and pinned commit
   * are read before the gate (git, as the setters' checks); the transaction re-checks the record they belong to.
   */
  async resolveIntegrationConflict(command: ResolveIntegrationConflictCommand): Promise<WebCommandResult> {
    const prepared = await prepareResolution(this.store, controlWorkspaceRoots(this.store.stateDir), command.target.groupId, (repoId) => this.repositoryPath(repoId));
    const release = this.deps.admissionGate?.enter();
    try {
      const replay = preflightWebCommand<WebCommandResult>(this.store, command); if (replay) return replay.body;
      return applyResolveIntegrationConflict({ store: this.store }, command, prepared) as WebCommandResult;
    } finally { release?.(); }
  }
  /**
   * Control run decisions plan Task 9: an owner approves a refused decision. A replay, a stale revision or an archived
   * group answers before any git runs (§10.5: an archived group's item stays pending); the line is committed before the
   * gate (git, as resolveIntegrationConflict's read), and the transaction marks the item approved.
   */
  approvePendingDecision(command: ApprovePendingDecisionCommand): Promise<WebCommandResult> {
    return this.serializeDecision(command.target.groupId, () => this.approvePendingDecisionNow(command));
  }
  private async approvePendingDecisionNow(command: ApprovePendingDecisionCommand): Promise<WebCommandResult> {
    const early = this.mutate(() => preflightWebCommand<WebCommandResult>(this.store, command));
    if (early) return early.body;
    const repoId = this.planRepository(command.target.groupId);
    // A group with no plan has no runs, so no pending decision; a missing group is refused by name in the transaction.
    const prepared: ApprovePrepared = repoId === null ? { kind: "refused", code: "pending-decision-not-found" }
      : await prepareApproval(this.store, controlWorkspaceRoots(this.store.stateDir), this.repositoryPath(repoId), command, { beforeCas: this.deps.decisionSeams?.beforeCas });
    const release = this.deps.admissionGate?.enter();
    try {
      const replay = preflightWebCommand<WebCommandResult>(this.store, command); if (replay) return replay.body;
      return applyApprovePendingDecision({ store: this.store }, command, prepared) as WebCommandResult;
    } finally { release?.(); }
  }
  /**
   * Control run decisions plan Task 10: an owner rejects a refused decision. As approve: a replay, a stale revision or an
   * archived group answers before anything is written; the correction is recorded before the gate, and the transaction
   * marks the item rejected.
   */
  rejectPendingDecision(command: RejectPendingDecisionCommand): Promise<WebCommandResult> {
    return this.serializeDecision(command.target.groupId, () => this.rejectPendingDecisionNow(command));
  }
  private async rejectPendingDecisionNow(command: RejectPendingDecisionCommand): Promise<WebCommandResult> {
    const result = await this.rejectAndRecord(command);
    await this.openDebugGroupAfterReject(command, result);
    return result;
  }
  /**
   * Debug task plan Task 12: a booked reject (first or replayed) opens the correction's debug group as its own command
   * `<rejectCommandId>.debug-open`. The reject's outcome is never changed by it (anti-goal 1): a refused or failed open
   * leaves its own booked row, or none, and the corrections list shows the Open button. A replay first looks the
   * open's row up (controller ruling C23): once the group has moved, re-sending it at a new revision would conflict.
   */
  private async openDebugGroupAfterReject(command: RejectPendingDecisionCommand, result: WebCommandResult): Promise<void> {
    const success = (result as { result?: { kind?: string; correctionId?: string } }).result;
    if (success?.kind !== "pending-decision-rejected" || success.correctionId === undefined) return;
    const commandId = `${command.commandId}.debug-open`;
    if (this.store.db.prepare("SELECT 1 FROM commands WHERE id=? AND original_status IS NOT NULL").get(commandId) !== undefined) return;
    try {
      await this.deps.decisionSeams?.beforeOpen?.();
      const groupId = debugGroupIdFor(this.store, success.correctionId, false);
      const revision = this.store.db.prepare("SELECT revision FROM groups WHERE id=?").get(groupId);
      const open: CorrectionDebugOpenCommand = {
        schema: "orca-raw-command-v1", commandId, actorId: command.actorId, expectedRevision: revision === undefined ? 0 : Number(revision.revision),
        verb: "correction-debug-open", target: { kind: "group", groupId }, payload: { correctionId: success.correctionId },
      };
      const client = commandClientFor(command.commandId), principal = commandPrincipalFor(command.commandId);
      const send = () => this.openCorrectionDebugGroup(open);
      await (client === null || principal === null ? send() : withCommandContext(commandId, { client, principal }, send));
    } catch (error) {
      // The reject stands and no refusal is booked (a replay retries the open); the failure is kept as one activity row.
      this.noteDebugOpenFailed(command, success.correctionId, commandId, error);
    }
  }
  /** Never throws: the reject must stand even if the note cannot be written. */
  private noteDebugOpenFailed(command: RejectPendingDecisionCommand, correctionId: string, commandId: string, error: unknown): void {
    try {
      const message = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim().slice(0, 200);
      this.mutate(() => this.store.transaction(() => recordActivity(this.store, {
        groupId: command.target.groupId, runId: null, kind: "debug-open-failed", body: { correctionId, commandId, error: message },
      })));
    } catch (noteError) { process.stderr.write(`orca-control: debug-open-failed note for ${commandId}: ${String(noteError)}\n`); }
  }
  private async rejectAndRecord(command: RejectPendingDecisionCommand): Promise<WebCommandResult> {
    const early = this.mutate(() => preflightWebCommand<WebCommandResult>(this.store, command));
    if (early) return early.body;
    const repoId = this.planRepository(command.target.groupId);
    const { correctionsDir: dir, correctionsBy: by } = this.deps;
    const prepared: RejectPrepared = repoId === null ? { kind: "refused", code: "pending-decision-not-found" }
      : dir === undefined || by === undefined ? { kind: "refused", code: "corrections-store-unconfigured" }
      : await prepareRejection(this.store, this.repositoryPath(repoId), { dir, by }, command, this.deps.now ?? (() => new Date()), { beforeRecord: this.deps.decisionSeams?.beforeRecord });
    const release = this.deps.admissionGate?.enter();
    try {
      const replay = preflightWebCommand<WebCommandResult>(this.store, command); if (replay) return replay.body;
      return applyRejectPendingDecision({ store: this.store }, command, prepared) as WebCommandResult;
    } finally { release?.(); }
  }
  /** Debug task plan Task 6: one recorded correction opens (or returns) its debug group; nothing is spent. */
  async openCorrectionDebugGroup(command: CorrectionDebugOpenCommand): Promise<WebCommandResult> {
    const release = this.deps.admissionGate?.enter();
    try { return await applyCorrectionDebugOpen({ ...this.deps, listRepositories: this.deps.listRepositories ?? (() => []) }, command); }
    finally { release?.(); }
  }
  /** Debug task plan Task 11: the human-only correction verbs (correctionCommands.ts). */
  async recordCorrection(command: CorrectionRecordCommand): Promise<WebCommandResult> {
    const release = this.deps.admissionGate?.enter();
    try { return await applyCorrectionRecord(this.deps, command); } finally { release?.(); }
  }
  async closeCorrection(command: CorrectionCloseCommand): Promise<WebCommandResult> {
    const release = this.deps.admissionGate?.enter();
    try { return await applyCorrectionClose(this.deps, command); } finally { release?.(); }
  }
  async withdrawCorrection(command: CorrectionWithdrawCommand): Promise<WebCommandResult> {
    const release = this.deps.admissionGate?.enter();
    // Withdraw Amendment 2, as the panel route does it: archived as the command's actor and principal.
    const actor = { actorId: command.actorId, principal: commandPrincipalFor(command.commandId) ?? "web" };
    try { return await applyCorrectionWithdraw(this.deps, command, (id) => archiveUnstartedDebugGroups({ store: this.store, service: this }, id, actor)); }
    finally { release?.(); }
  }
  /** Debug task plan Task 10: every correction with its debug groups and computed closed state; reads only. */
  /**
   * Kanban spec §9a: the decision ids a recorded, not withdrawn correction names -- a flag on one of them no longer waits
   * for the person. No corrections store ⇒ none (every flag keeps waiting: the safe direction).
   */
  async correctedDecisionIds(): Promise<Set<string>> {
    const dir = this.deps.correctionsDir;
    if (dir === undefined) return new Set();
    const withdrawn = withdrawnIds(await readWithdrawals(dir));
    return new Set((await readCorrections(dir)).filter((c) => c.decisionId !== undefined && !withdrawn.has(c.id)).map((c) => c.decisionId!));
  }
  /** Kanban spec §9a: a person ratifies a flagged decision (decisionCommands.ts). */
  ratifyFlaggedDecision(command: RatifyFlaggedDecisionCommand): WebCommandResult {
    return this.mutate(() => applyRatifyFlaggedDecision({ store: this.store }, command)) as WebCommandResult;
  }
  async correctionList(): Promise<CorrectionListItemV1[]> {
    const dir = this.deps.correctionsDir;
    if (dir === undefined) throw new ControlError("corrections-store-unconfigured");
    return readCorrectionList({ store: this.store, correctionsDir: dir, listRepositories: this.deps.listRepositories ?? (() => []), repoIdOfProjectKey: this.deps.repoIdOfProjectKey });
  }
  /** Controller ruling (Task 7): the target the panel offers for this repository; null when its path does not resolve. */
  async suggestedTarget(repoId: string): Promise<string | null> {
    let path: string;
    try { path = this.repositoryPath(repoId); } catch { return null; }
    return suggestedTarget(path);
  }
  /** Control run decisions plan Task 8: a repository's trusted path for the group decisions read; null when it does not resolve. */
  repositoryPathOf(repoId: string): string | null {
    try { return this.repositoryPath(repoId); } catch { return null; }
  }
  /** The setters' check against a repository's trusted path; a path that does not resolve is its own named check. */
  private async schemeCheck(repoId: string, scheme: IntegrationScheme): Promise<string | null> {
    let path: string;
    try { path = this.repositoryPath(repoId); } catch { return REPOSITORY_CHECK; }
    return checkScheme(path, scheme);
  }
  /** The repository a group's plan names, read before a transaction; null when the group has none (yet). */
  private planRepository(id: string): string | null {
    const row = this.store.db.prepare("SELECT body FROM groups WHERE id=?").get(id);
    const repoId = row ? (JSON.parse(String(row.body)) as { plan?: { repoId?: unknown } }).plan?.repoId : undefined;
    return typeof repoId === "string" ? repoId : null;
  }
  private repositoryPath(repoId: string): string {
    if (this.deps.resolveRepository === undefined) throw new Error("integration checks need resolveRepository");
    return this.deps.resolveRepository(repoId);
  }
  /** Agent selection spec §6.2 layer 1: the operator's defaults, under their own revision. */
  async setAgentPreferences(command: SetAgentPreferencesCommand): Promise<WebCommandResult> {
    return applySetAgentPreferences({ store: this.store, admissionGate: this.deps.admissionGate }, command) as WebCommandResult;
  }
  /** One startup observation, with pending same-operation reconciliation first. Failure remains visible and nonfatal. */
  async recoverAgentUpdates(): Promise<void> {
    let reconcileFailure: string | null = null;
    try { await reconcilePendingAgentUpdates(this.store, this.deps.port); }
    catch (error) { reconcileFailure = error instanceof ControlError ? peerCode(error) : "control-internal-error"; }
    await this.observeAgentUpdates();
    if (reconcileFailure) this.installationFailure = reconcileFailure;
  }
  async observeAgentUpdates(): Promise<void> {
    if (!this.deps.port.observeAgentInstallations) { this.installationFailure = "control-agent-update-unsupported"; return; }
    try { this.installationObservation = await this.deps.port.observeAgentInstallations(); this.installationFailure = null; }
    catch (error) { this.installationObservation = null; this.installationFailure = error instanceof ControlError ? peerCode(error) : "control-internal-error"; }
  }
  /** Agent version auto-refresh spec 2026-10-20 §3.3: a refresh's own observation, re-stated against the table it wrote. */
  noteAgentObservation(observation: AgentObservation): void { this.installationObservation = observation; this.installationFailure = null; }
  agentUpdateView(operatorId: string) {
    return { schema: "orca-agent-installation-state-v1" as const, revision: readAgentUpdateRevision(this.store, operatorId),
      pending: hasPendingAgentUpdate(this.store, operatorId), pendingCommand: pendingAgentUpdateCommand(this.store, operatorId), observation: this.installationObservation,
      preview: this.installationPreview, failureCode: this.installationFailure };
  }
  async previewAgentUpdates(): Promise<AgentPreview> {
    if (!this.deps.port.previewAgentInstallations) throw new ControlError("control-agent-update-unsupported");
    if (this.store.db.prepare("SELECT command_id FROM agent_update_outbox WHERE state='pending' LIMIT 1").get()) throw new ControlError("agent-installation-update-pending");
    const preview = await this.deps.port.previewAgentInstallations();
    this.installationPreview = preview;
    this.installationObservation = { schema: "orca-agent-detection-observation-v1", baseTableHash: preview.baseTableHash, observedAt: preview.observedAt, installed: preview.installed };
    this.installationFailure = null;
    return preview;
  }
  async applyAgentUpdate(command: ApplyAgentUpdateCommand, context: { client: string; principal: string }): Promise<WebCommandResult> {
    const release = this.deps.admissionGate?.enter();
    try {
      const replay = lookupWebCommandReplay<WebCommandResult>(this.store, command);
      if (replay) return replay.body;
      const preflight = preflightWebCommand<WebCommandResult>(this.store, command);
      if (preflight) return preflight.body;
      const pending = hasPendingAgentUpdate(this.store, command.actorId);
      if (!pending) {
        const preview = this.installationPreview;
        if (!preview || preview.previewId !== command.payload.previewId || preview.baseTableHash !== command.payload.baseTableHash
          || command.payload.acceptedChangeIds.some((id) => !preview.changes.some((change) => change.changeId === id))) {
          throw new ControlError("agent-installation-update-conflict", "preview-not-owned-or-changed");
        }
      }
      let result: Awaited<ReturnType<typeof applyAgentUpdate>>;
      try { result = await applyAgentUpdate({ store: this.store, port: this.deps.port }, command, context); }
      catch (error) {
        // Plan correction K2 (2026-10-15): ccloop's apply runs after the outbox row is reserved, and a peer exit leaves the
        // operation pending for same-identity reconciliation -- its outcome is unknown, so it is not a 424 refusal.
        if (peerFailure(error) !== null && hasPendingAgentUpdate(this.store, command.actorId)) throw new Error("agent-installation-update-outcome-unknown", { cause: error });
        throw error;
      }
      if (result.status < 300) {
        this.installationPreview = null;
        await this.observeAgentUpdates();
      }
      return result.body as WebCommandResult;
    } finally {
      release?.();
    }
  }
  /** Accounts spec §6.1: the spend caps and the usage calendar, under the spend scope's revision (D5). */
  setSpendCap(command: Extract<SpendCommand, { verb: "set-spend-cap" }>): WebCommandResult { return this.applySpend(command); }
  clearSpendCap(command: Extract<SpendCommand, { verb: "clear-spend-cap" }>): WebCommandResult { return this.applySpend(command); }
  setUsageCalendar(command: Extract<SpendCommand, { verb: "set-usage-calendar" }>): WebCommandResult { return this.applySpend(command); }
  private applySpend(command: SpendCommand): WebCommandResult {
    return applySpendCommand({ store: this.store, admissionGate: this.deps.admissionGate, now: this.deps.now, knownRepository: this.deps.knownRepository ?? (() => false) }, command) as WebCommandResult;
  }
  async resumeFromHandoff(command: ResumeFromHandoffCommand): Promise<WebCommandResult> {
    return applyResumeFromHandoff(this.stopDeps(), command) as WebCommandResult;
  }
  async continueTask(command: ContinueTaskCommand): Promise<WebCommandResult> {
    return applyContinueTask(this.stopDeps(), command) as WebCommandResult;
  }
  /** Issue fixes spec §4.2(2): a task whose run ccloop ended failed back to ready (retryTask.ts). */
  async settleUnknownUsage(command: SettleUnknownUsageCommand): Promise<WebCommandResult> {
    const result=await applySettleUnknownUsage(this.stopDeps(), command);
    if("result" in result){const run=readDriverRun(this.store,command.payload.runId);if(run.mode==="verify-saved-result"||run.recoveryOf!==undefined)await retainSavedInterruption({store:this.store,admissionGate:this.deps.admissionGate},run.runId);}
    return result;
  }
  savedResultEligibility(runId:string){return readSavedResultEligibility(this.stopDeps(),runId);}
  verifySavedResult(command:VerifySavedResultCommand){return applyVerifySavedResult(this.stopDeps(),command);}
  retryTask(command: RetryTaskCommand): WebCommandResult {
    return applyRetryTask(this.stopDeps(), command) as WebCommandResult;
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
      let optionalSupported=true,featureError:unknown=null;
      try {
        const proposalBefore=readBudgetProposal(this.store,groupId(command));
        const needsOptional=proposalBefore.allocations.some(a=>a.ownerKind==="task"&&a.bucket==="work"&&a.amount.tokens===null);
        optionalSupported=!needsOptional||(await this.deps.profileRouter.resolve("task",command.payload.profileIds.worker,command.payload.profileHashes.worker).port.readFeatures?.())?.tokenPolicy==="optional-v1";
      }catch(error){featureError=error;}
      const skillLookup = await lookupSkillProfiles(this.store, groupId(command), this.deps.syncskill ?? UNCONFIGURED_SYNCSKILL, this.deps.port);
      // Integration spec §3.3: a non-keep scheme's preflight, decided inside the transaction. The group revision the
      // command is checked against there covers any set-group-integration since this read. It stays after the selection
      // resolution, which must start before anything awaits (agentFreeze: a layer change during it is refused).
      const preflight = await this.integrationPreflight(groupId(command));
      return applyWebCommand<WebCommandResult>(this.store, {
        rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
        apply: context => {
          const id = groupId(command), group = readWebGroup(this.store, id), plan = readArchivedPlan(this.store, id), proposal = readBudgetProposal(this.store, id), payload = command.payload;
          if (payload.planHash !== plan.planHash) throw new ControlError("plan-version-conflict");
          if (payload.proposalVersion !== proposal.proposalVersion) throw new ControlError("proposal-version-conflict");
          prestart(group); refuseAfterTaskStarted(this.store, id);
          refuseUnnamedDebugChecks(this.store, id, group);
          if (proposal.state === "confirmed") throw new ControlError("no-op-command");
          assertKnownConservation(this.store, group, proposal);
          if(featureError)throw featureError;
          if(!optionalSupported)throw new ControlError("control-token-policy-unsupported");
          if ((payload.profileIds.estimator === null) !== (payload.profileHashes.estimator === null)) throw new ControlError("control-estimator-unconfigured");
          const selected = { estimator: payload.profileIds.estimator === null ? null : this.deps.profileRouter.resolve("budget-estimate", payload.profileIds.estimator, payload.profileHashes.estimator!), worker: this.deps.profileRouter.resolve("task", payload.profileIds.worker, payload.profileHashes.worker), handoff: this.deps.profileRouter.resolve("handoff", payload.profileIds.handoff, payload.profileHashes.handoff), goalReview: this.deps.profileRouter.resolve("goal-review", payload.profileIds.goalReview, payload.profileHashes.goalReview) };
          const window = selected.worker.snapshot.profile.capabilities.contextWindowTokens, threshold = payload.contextPolicy.handoffAtContextTokens;
          if (window === null ? threshold !== null : threshold === null || threshold > window) throw new ControlError("execution-policy-unrepresentable");
          const profiles = Object.fromEntries(Object.entries(selected).map(([slot, p]) => [slot, p === null ? null : { profileId: p.snapshot.profile.profileId, profileHash: p.profileHash }])) as { estimator: ProfileBindingV1 | null; worker: ProfileBindingV1; handoff: ProfileBindingV1; goalReview: ProfileBindingV1 };
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
            const handoff = amountSchema.parse(proposal.allocations.find(a => a.ownerId === task.taskId && a.bucket === "handoff")!.amount);
            if (selected.handoff.snapshot.profile.capabilities.handoffExecution === "model-assisted-v1" && dimensions.some(d => handoff[d] < 1)) throw new ControlError("handoff-grant-insufficient");
            return { ...task, work, handoff };
          });
          // Syncskill integration spec §10.5: a lookup failure (or syncskill unset while any task declares skills) refuses
          // the whole confirmation, decided here as a slot failure is; then each task's skill set is frozen -- names as
          // declared, a profile as syncskill answered it.
          if ("failure" in skillLookup) throw skillLookup.failure;
          // Integration spec §3.2 (ruling R2): a non-keep scheme is approved by the hash of the scheme the owner saw; a keep
          // group carries none. Then the preflight's finding refuses by name.
          const integration = readGroupIntegration(group);
          if (integration === null ? payload.integrationHash !== undefined : payload.integrationHash !== integration.schemeHash) throw new ControlError("integration-unapproved");
          if (integration !== null && preflight !== null) throw new ControlError("integration-preflight-failed", preflight);
          const skills = tasks.flatMap((task): Array<{ taskId: string; profile: string | null; names: string[] }> => {
            const declared = task.loop?.skills;
            if (declared === undefined) return [];
            assertSkillsAgent(skillLookup.kinds, task.taskId, frozenOf(taskSlotKey(task.taskId)).selection.agent);
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
          if (integration !== null) (group as Record<string, unknown>).integration = { ...integration, frozen: true } satisfies GroupIntegration;
          proposal.state = "confirmed"; proposal.budgetMode = payload.budgetMode; proposal.contextPolicy = payload.contextPolicy; proposal.profiles = profiles; proposal.executionSnapshotHash = built.snapshotHash;
          proposal.allocations.forEach(a => { a.state = "confirmed"; }); group.status = "ready"; group.budgetMode = payload.budgetMode;
          saveWebAuthority(this.store, group, proposal);
          // Kanban spec 2026-10-20 §3.1: confirming authorizes the start unless the person chose "Confirm only".
          recordConfirmed(this.store, id, payload.hold === true ? "hold" : "run", context.nextCommandRevision);
          this.deps.beforeCommit?.();
          return success(context, { kind: "confirmed", executionSnapshotHash: built.snapshotHash });
        },
      }).body;
    } finally { release?.(); }
  }
  /** The failed check of the group's non-keep scheme, null when it passed, is keep, or cannot be read here (the transaction refuses that). */
  private async integrationPreflight(id: string): Promise<string | null> {
    let integration: GroupIntegration | null;
    try {
      const row = this.store.db.prepare("SELECT body FROM groups WHERE id=?").get(id);
      integration = row ? readGroupIntegration(JSON.parse(String(row.body))) : null;
    } catch { return null; }
    const repoId = this.planRepository(id);
    if (integration === null || repoId === null) return null;
    let path: string;
    try { path = this.repositoryPath(repoId); } catch { return REPOSITORY_CHECK; }
    return preflightScheme(path, integration.scheme, process.env.ORCA_GH_BIN || "gh");
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
        if(limit.tokens!==null)assertNoActiveUnbounded(this.store,"all",id);
        const decreasing = dimensions.some(d => limit[d]!==null&&(group.limit[d]===null||limit[d]! < group.limit[d]!));
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
      const skillLookup = await lookupProfile(profileToLookUp(this.store, groupId(command), command.target.taskId, command.payload.skills), this.deps.syncskill ?? UNCONFIGURED_SYNCSKILL,
        this.deps.port, confirmedWithSkills(this.store, groupId(command), command.payload.skills));
      return applyWebCommand<WebCommandResult>(this.store, {
        rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
        apply: context => {
          const id = groupId(command), taskId = command.target.taskId, payload = command.payload;
          const group = readWebGroup(this.store, id), proposal = readBudgetProposal(this.store, id), plan = readArchivedPlan(this.store, id);
          // Step 1. assertKnownConservation first (recovery-blocked before any state refusal, ruling P3). Start guard spec
          // (2026-10-15) §3.3: a running, reviewing or paused group takes a change to a task that has not started; a handoff
          // or shutdown stop, a stopped flag with no intent, done and blocked do not.
          assertKnownConservation(this.store, group, proposal);
          const stopIntent = readStopIntent(this.store, id);
          const editable = ["draft", "ready", "running", "review"].includes(group.status)
            && ((!group.stopped && stopIntent === null) || stopIntent?.mode === "pause");
          if (!editable) throw new ControlError("group-state-invalid");
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
          const next: BudgetAmount = { ...before, tokens: payload.work.tokens, activeMs: payload.work.activeMs, attempts: payload.work.attempts };
          if(next.tokens===null&&!hasTokenPolicy(this.store,id)){
            enableOptionalTokenPolicy(this.store,id);
            const draftTokens=sumAmounts(proposal.allocations.filter(a=>a.ownerKind==="task").map(a=>amountSchema.parse(a.amount))).tokens;
            group.ledger.committedRemaining.tokens-=draftTokens;group.reserved={...group.ledger.committedRemaining};
          }
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
            if(d==="tokens"&&hasTokenPolicy(this.store,id))continue;
            const shortfall = next[d]! - before[d]! - proposal.explicitUnallocatedReserve[d]!;
            if (shortfall > 0) throw new ControlError("group-reserve-insufficient", `${d}:${shortfall}`);
          }
          if (loopVersion === Number.MAX_SAFE_INTEGER) throw new ControlError("numeric-overflow");
          // Syncskill integration spec §10.5: a lookup failure (or syncskill unset when a lookup was needed) refuses the change,
          // decided here after every existing check, as at confirm.
          if ("failure" in skillLookup) throw skillLookup.failure;
          // Final review N1: a confirmed task's changed declaration, names included, needs syncskill at run start, so it is
          // refused unset as confirm refuses it (lookupSkillProfiles). Removing skills or keeping them unchanged needs none.
          if (proposal.state !== "editable" && !skillsUnchanged && expanded.recipe.skills !== undefined
            && (this.deps.syncskill?.bin ?? null) === null) throw new ControlError("syncskill-unconfigured");
          // Human ruling 2026-10-03 (session 9d95e6c8): skills on a confirmed task need its frozen agent to be claude.
          if (proposal.state !== "editable" && expanded.recipe.skills !== undefined) {
            const agent = agentSelectionSchema.safeParse(work.agent);
            if (!agent.success) throw new ControlError("recovery-blocked", `work-item-agent-invalid:${taskId}`);
            assertSkillsAgent(skillLookup.kinds, taskId, agent.data.agent);
          }
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
            for (const d of dimensions) if(d!=="tokens"||!hasTokenPolicy(this.store,id))group.ledger.committedRemaining[d] += next[d]! - before[d]!;
            setReserve(proposal, residual(proposal.groupLimit, group.used, group.ledger.committedRemaining));
            const derived = deriveContract({ taskId, originalContractHash: expanded.hash, originalContractCanonicalJson: expanded.canonicalJson, work: next, handoff: amountSchema.parse(handoff.amount) }, proposal.proposalVersion);
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

/** Estimate usable-answer spec §4.3: a failed settlement's reason and the problems a retry would carry. */
export interface EstimateFailure { reasonCode: string; problems: string[] }

/**
 * The problems for a failed estimate: repair's own, the classifier's refusal of a repaired answer (never empty), or
 * `no-json-object` for a call ccloop could read no JSON object from. Every other call failure is not retryable: `[]`.
 */
function estimateFailureProblems(reasonCode: string, callFailure: string | null, repairProblems: string[] | null, judged: unknown, notCanonical: boolean): string[] {
  if (repairProblems !== null) return repairProblems;
  if (reasonCode.startsWith("estimate-call-failed")) return callFailure === "single-call-output-invalid" ? ["no-json-object"] : [];
  // A repaired answer the classifier still finds about another plan: its planHash or task ids do not match the request.
  if (reasonCode === "estimate-output-plan-mismatch") return ["plan-mismatch"];
  const parsed = budgetEstimateSchema.safeParse(judged);
  const problems = problemsFromRefusal(parsed.success ? [] : parsed.error.issues, notCanonical);
  return problems.length > 0 ? problems : ["output-not-canonical"];
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
  // Spec 2026-10-15 ccloop error codes §4.5: ccloop's code for a failed call (driver-normalised); the service method passes none.
  callFailure: string | null = null,
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
      // Estimate usable-answer spec §4.2: repair runs on every non-null answer before the classifier, which then judges
      // the repaired value and stays the single judge. A null answer is a failed call and never reaches repair.
      const taskIds = plan.plan.tasks.map(t => t.taskId), contract = readEstimateContract(deps.store, id, estimateId);
      let repairs: string[] = [], repairProblems: string[] | null = null, judged: unknown = rawOutput;
      if (rawOutput !== null) {
        const repaired = repairEstimateOutput(rawOutput, { planHash: plan.planHash, taskIds, instructionVersion: contract.instructionVersion });
        if (repaired.ok) { repairs = repaired.repairs; judged = repaired.output; } else repairProblems = repaired.problems;
      }
      const classified = repairProblems !== null ? { ok: false as const, reasonCode: "estimate-output-invalid" } : classify(judged, plan.planHash, taskIds);
      let output: BudgetEstimateV1 | null = null, outputHash: string | null = null, notCanonical = false;
      let reasonCode: string | null = classified.ok ? null
        : classified.reasonCode === "estimate-call-failed" && callFailure !== null ? `estimate-call-failed:${callFailure}` : classified.reasonCode;
      if (classified.ok) {
        try { outputHash = sha256Canonical(classified.output); output = classified.output; }
        catch (error) { if (!(error instanceof ControlError)) throw error; reasonCode = "estimate-output-invalid"; notCanonical = true; }
      }
      // Spec §4.3: why the estimate failed and the problems a retry would carry; empty problems = not retryable.
      const failure: EstimateFailure | null = reasonCode === null ? null : { reasonCode, problems: estimateFailureProblems(reasonCode, callFailure, repairProblems, judged, notCanonical) };
      estimate.state = output ? "ready" : "failed"; estimate.output = output; estimate.outputHash = outputHash; estimate.reasonCode = failure?.reasonCode ?? null;
      estimate.repairs = repairs;
      if (rawCanonicalJson !== null) writeCanonicalRecord(deps.store, id, rawHash, rawCanonicalJson);
      if (output) writeCanonicalRecord(deps.store, id, estimate.outputHash!, canonicalBytes(output).toString("utf8"));
      group.ledger.committedRemaining = residual(group.reserved, zero(), run.remaining.work);
      const settledBalance = budgetBalance(group.limit, group.used, group.ledger.committedRemaining);
      group.ledger.budgetDeficit = settledBalance.deficit;
      setReserve(proposal, settledBalance.reserve);
      // Spec §4.3: the one automatic retry, decided on the settled numbers by plain reads only (it never throws).
      const decision = decideEstimateRetry({ estimate, contract, failure, group, proposalVersion: proposal.proposalVersion, proposalConfirmed: proposal.state === "confirmed",
        newestEstimateVersion: Number(deps.store.db.prepare("SELECT MAX(estimate_version) AS n FROM estimates WHERE group_id=?").get(id)?.n ?? 0),
        reserveAfterSettlement: settledBalance.reserve, dispatchBlocked: deps.store.dispatchBlocked });
      if (decision.kind === "skip") estimate.retrySkipped = decision.code;
      if (decision.kind === "retry") estimate.retriedAs = estimateRetryId(id, estimateId);
      deps.store.db.prepare("UPDATE estimates SET state=?,body=? WHERE group_id=? AND id=?").run(estimate.state, canonicalBytes(estimate).toString("utf8"), id, estimateId);
      if (decision.kind === "retry") {
        // Tester round 2 spec §5.2.3: the retry's grant from the reserve after this settlement and the cap headroom read in
        // this transaction, reserved like any queued estimate's (createEstimate).
        const required = retryPromptRequired(contract, estimate.request!, decision.problems)!;
        // The settlement never throws for the retry (spec §4.3): a cap reading that fails leaves the cap term out, and the
        // claim gate then decides with the frozen grant.
        let capHeadroom: number | null;
        try { capHeadroom = capStatuses(deps.store, groupRepoIdOf(group as unknown as Record<string, unknown>), deps.store.now())[0]?.headroom ?? null; } catch { capHeadroom = null; }
        const grant = estimateGrantFor({ limitTokens: group.limit.tokens, remainingTokens: settledBalance.reserve.tokens, capHeadroom, requiredRequestTokens: Number(required) });
        writeEstimateRetry(deps.store, id, estimate, contract, decision.problems, grant);
        group.ledger.committedRemaining = sumAmounts([group.ledger.committedRemaining, grant]);
        setReserve(proposal, residual(group.limit, group.used, group.ledger.committedRemaining));
      }
      closeSingleCall(deps.store, run.runId, { id: receiptId, kind: "estimate-result", body: { groupId: id, estimateId, runId: run.runId, rawHash, rawIdentity } });
      saveWebAuthority(deps.store, group, proposal); recordProjectionChange(deps.store, [id]);
    });
  } finally { release?.(); }
}
