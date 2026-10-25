/**
 * Flow engine spec §6.2-§6.3 (plan Task 10): the driver-backed side of a `work` step. Opening a child imports the
 * step's one-task plan as a group of its own (precedent: applySystemDebugOpen) with no estimate, its grant the
 * allocation drawn from the run pool (`stripped`: the handoff and goal-review allocations are zero, so the draw caps the
 * whole child), delivery `keep`, and the `flow` child block; then `orca-auto` confirms it with the parent's frozen
 * profiles under a deterministic command id. The pump's auto-start pass starts it under the parent's slot and the
 * existing execution driver runs it on the vault (groupRepoId, stackBaseOf). Both halves are idempotent per child id, so
 * a restart opens and confirms nothing twice.
 *
 * The open is written by code in its own transaction, not as a command of its own (spec §22 leaves the import mechanics
 * to the builder): the child is Orca's, nobody issues it, and its one command -- the confirmation -- is booked as usual.
 *
 * `status` reads how the child is doing from its task's run and drive record: running (also while blocked short of a
 * terminal: a person's recovery acts there), failed (a terminal other than `succeeded`), or landed with the tip of
 * `orca/<child>` in the vault as the step's output -- or, for an effect step that changed no file, landed with no commit.
 */
import { updateRevision } from "../control/commandLedger.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resumeFlowChildInTransaction } from "../control/continuation.js";
import { isTerminallyFailedRun, type DriveRecord } from "../control/driveRecord.js";
import { ControlError } from "../control/errors.js";
import { readConfirmedTaskExecution } from "../control/executionSnapshot.js";
import { savedReport } from "../control/executionDriver.js";
import { ORCHESTRATION_ACTOR } from "../control/orchestration.js";
import { normalizeControlPlan, writeImportedPlan, type ImportDeps } from "../control/planImport.js";
import { readArchivedPlan, readBudgetProposal } from "../control/queries.js";
import { recordProjectionChange } from "../control/projectionJournal.js";
import { reportedFlowOf } from "../control/reportedDecisions.js";
import type { ControlStore } from "../control/store.js";
import { applyFlowHandoffStop, groupStopState, readStopIntent, type FlowStopMarker } from "../control/stopIntent.js";
import type { ToolRulesReport } from "../control/toolRules.js";
import { workBranchRef } from "../control/workspace.js";
import { flowBlockOf, flowVaultRepoId, vaultPathOfRepoId } from "./groups.js";
import { FlowRefusal } from "./kernel.js";
import type { FlowChildOpen, FlowChildPort, FlowChildResume, FlowChildStatus, FlowChildStopState } from "./kinds/work.js";
import { readParentConfirmation } from "./parent.js";
import { getFlowRun } from "./store.js";

const run = promisify(execFile);

export interface DriverChildPortDeps {
  store: ControlStore;
  env: NodeJS.ProcessEnv;
  /** writeImportedPlan's deps as the service holds them (the estimator slot is never used: the estimate is deferred). */
  importDeps: Omit<ImportDeps, "estimatorObservation" | "estimatorSlot">;
  /** The service's confirm (it books the command and freezes the selections). */
  confirm(command: unknown): Promise<unknown>;
  /** The confirm payload's selections hash, resolved through the port as every confirm's is (agentFreeze.ts); null: rejected. */
  selectionsHash(groupId: string): Promise<string | null>;
  admissionGate?: { enter(): () => void };
}

export const FLOW_CHILD_PLAN_ID = "flow-step";
/** The child's one confirmation; the proposal version is always 1 (nothing re-estimates a child). */
export const CHILD_CONFIRM_COMMAND_ID = "orca-auto-confirm-v1";

function groupBody(store: ControlStore, groupId: string): Record<string, unknown> | null {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  return row === undefined ? null : JSON.parse(String(row.body)) as Record<string, unknown>;
}

/** The import, in one transaction: the plan, the grant from the pool, keep, and the child block. */
function importChild(deps: DriverChildPortDeps, request: FlowChildOpen, repoId: string): void {
  const release = deps.admissionGate?.enter();
  try {
    deps.store.transaction(() => {
      if (groupBody(deps.store, request.childGroupId) !== null) return;
      const plan = normalizeControlPlan({ ...request.plan, repoId, planId: FLOW_CHILD_PLAN_ID });
      const defaults = deps.importDeps.defaults();
      writeImportedPlan({
        ...deps.importDeps, estimatorSlot: { kind: "rejected", partial: null, code: "control-estimator-unconfigured" },
        estimatorObservation: () => { throw new ControlError("control-estimator-unconfigured"); },
      }, {
        groupId: request.childGroupId, repoId, planId: FLOW_CHILD_PLAN_ID, plan, actorId: ORCHESTRATION_ACTOR, commandId: `orca-auto-flow-open-${request.childGroupId}`,
        estimatorProfileId: defaults?.estimatorProfileId ?? null, estimatorProfileHash: defaults?.estimatorProfileHash ?? null, estimateMode: defaults?.estimateMode ?? "soft",
      }, null, { estimate: "deferred", stripped: { workTokens: request.work.tokens } });
      const body = groupBody(deps.store, request.childGroupId)!;
      // §5.1: a flow group delivers by copy-back only; whatever the repository's default scheme is, the child keeps.
      delete body.integration;
      body.flow = {
        role: "child", flowRunId: request.flowRunId, parentGroupId: request.parentGroupId, stepKey: request.stepKey, seq: request.seq,
        baseCommit: request.baseCommit, ...(request.effectRecordId === null ? {} : { effectRecordId: request.effectRecordId }),
        // §12.2 phase 1: the step's own skills, injected by the driver's A2 (flowChildSkills).
        ...(request.skills.length === 0 ? {} : { skills: [...request.skills] }),
      };
      deps.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(body), request.childGroupId);
      // Revision 1 with its projection recorded, as the import command it stands in for would leave it.
      updateRevision(deps.store, request.childGroupId, 1);
      recordProjectionChange(deps.store, [request.childGroupId]);
    });
  } finally { release?.(); }
}

/** §6.2: confirmed by orca-auto with the parent's profiles, once (a booked command id answers a replay). */
async function confirmChild(deps: DriverChildPortDeps, request: FlowChildOpen): Promise<void> {
  if (readBudgetProposal(deps.store, request.childGroupId).state === "confirmed") return;
  const parent = readParentConfirmation(deps.store, request.parentGroupId);
  if (parent?.children == null) throw new ControlError("recovery-blocked", `flow-parent-unconfirmed:${request.parentGroupId}`);
  const { profiles, budgetMode, contextPolicy } = parent.children;
  const revision = Number(deps.store.db.prepare("SELECT revision FROM groups WHERE id=?").get(request.childGroupId)!.revision);
  const answer = await deps.confirm({
    schema: "orca-raw-command-v1", commandId: CHILD_CONFIRM_COMMAND_ID, actorId: ORCHESTRATION_ACTOR, expectedRevision: revision, verb: "confirm",
    target: { kind: "group", groupId: request.childGroupId },
    payload: {
      planHash: readArchivedPlan(deps.store, request.childGroupId).planHash, proposalVersion: readBudgetProposal(deps.store, request.childGroupId).proposalVersion, budgetMode,
      profileIds: { estimator: profiles.estimator?.profileId ?? null, worker: profiles.worker.profileId, handoff: profiles.handoff.profileId, goalReview: profiles.goalReview.profileId },
      profileHashes: { estimator: profiles.estimator?.profileHash ?? null, worker: profiles.worker.profileHash, handoff: profiles.handoff.profileHash, goalReview: profiles.goalReview.profileHash },
      contextPolicy, selectionsHash: await selectionsHashOf(deps, request.childGroupId),
    },
  });
  const error = (answer as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  if (error !== undefined) throw new ControlError("recovery-blocked", `flow-child-confirm-refused:${String(error.code)}:${String(error.message)}`);
}

async function selectionsHashOf(deps: DriverChildPortDeps, groupId: string): Promise<string> {
  const hash = await deps.selectionsHash(groupId);
  if (hash === null) throw new ControlError("recovery-blocked", "flow-child-agent-selection-rejected");
  return hash;
}

type RunBody = { runId: string; state: string; drive?: DriveRecord; cumulative?: { work?: { tokens?: number } }; unknown?: { work?: boolean }; recoverable?: boolean; checkpointId?: string };

/** A child group's driver runs (phase `work`), oldest first: its pool return here and its spend (spend.ts, gaps §10). */
export function childRuns(store: ControlStore, groupId: string): RunBody[] {
  return store.db.prepare("SELECT body FROM runs WHERE group_id=? ORDER BY rowid").all(groupId).map((row) => JSON.parse(String(row.body)) as RunBody)
    .filter((body) => (body as { phase?: unknown }).phase === "work");
}

/**
 * §9.6: an effect step's side effect may change no file (an upload, a WeChat draft). Its run succeeded and settled with
 * a complete checkpoint but landed nothing, so it has no acceptance and the driver leaves the work item `blocked`
 * (deviation D14, the dev rule, kept as it is). For an effect child -- and only one -- that is a finished step with no
 * files (acceptance b37f7ce9: the draft id was never stored and the step never settled).
 */
function effectChangedNothing(store: ControlStore, block: { effectRecordId?: string | null }, current: RunBody, work: { status?: string } | null): boolean {
  if (typeof block.effectRecordId !== "string" || work?.status !== "blocked" || current.state !== "settled" || current.recoverable !== true) return false;
  if (current.drive?.outcome !== "succeeded" || current.drive.landedCommit !== null) return false;
  const checkpoint = current.checkpointId === undefined ? undefined : store.db.prepare("SELECT body FROM checkpoints WHERE id=? AND run_id=?").get(current.checkpointId, current.runId);
  return checkpoint !== undefined && (JSON.parse(String(checkpoint.body)) as { result?: unknown }).result === "complete";
}

async function childStatus(deps: DriverChildPortDeps, childGroupId: string): Promise<FlowChildStatus | null> {
  const body = groupBody(deps.store, childGroupId);
  const block = flowBlockOf(body);
  if (body === null || block?.role !== "child") return null;
  const task = deps.store.db.prepare("SELECT body FROM work_items WHERE group_id=? ORDER BY rowid LIMIT 1").get(childGroupId);
  const work = task === undefined ? null : JSON.parse(String(task.body)) as { status?: string; currentRunId?: string | null };
  const runs = childRuns(deps.store, childGroupId);
  const current = runs.find((r) => r.runId === work?.currentRunId) ?? null;
  if (current === null) return { state: "running" };
  const spentTokens = runs.reduce((sum, r) => sum + (r.cumulative?.work?.tokens ?? 0), 0);
  const toolRules = current.drive?.toolRules as ToolRulesReport | undefined;
  const skills = current.drive?.skills?.lock;
  if (isTerminallyFailedRun(current as Parameters<typeof isTerminallyFailedRun>[0])) {
    const reason = current.drive?.failureCause?.cause ?? `outcome:${current.drive?.outcome ?? "unknown"}`;
    return { state: "failed", reason, spentTokens, ...(toolRules === undefined ? {} : { toolRules }), ...(skills === undefined ? {} : { skills }) };
  }
  const unchanged = effectChangedNothing(deps.store, block, current, work);
  if (!unchanged && (work?.status !== "done" || current.state !== "settled")) return { state: "running" };
  let commit: string | null = null;
  if (!unchanged) {
    const flowRun = getFlowRun(deps.store, block.flowRunId);
    const vault = flowRun?.vaultId == null ? null : vaultPathOfRepoId(deps.env, flowVaultRepoId(flowRun.vaultId));
    if (vault === null) throw new ControlError("recovery-blocked", `flow-child-vault-missing:${childGroupId}`);
    commit = (await run("/usr/bin/git", ["--git-dir", vault, "rev-parse", "--verify", "--quiet", `${workBranchRef(childGroupId)}^{commit}`])).stdout.trim();
  }
  // §4.3: what the agent reported under `flow`, which ccloop (fbd3512 on) answers at collect's top level and the driver
  // saves with the report. A codex agent cannot report `candidates` (ccloop's closed wire shape omits them).
  const saved = await savedReport(deps.store, current.runId);
  const reported = reportedFlowOf(saved);
  // ccloop spec §5: the driver keeps the tool-rule report on the drive record only for a failed run; a landed run's is in
  // its saved collect report (T18 acceptance: every landed step lost its report and its flags).
  const landedRules = toolRules ?? saved.toolRules;
  const flow = reported.kind === "object" ? {
    ...(reported.value.needs === undefined ? {} : { needs: reported.value.needs }), ...(reported.value.candidates === undefined ? {} : { candidates: reported.value.candidates }),
    ...(reported.value.effect === undefined ? {} : { effect: reported.value.effect }),
    ...(reported.effectExtraKeys === undefined ? {} : { effectExtraKeys: reported.effectExtraKeys }),
  } : undefined;
  return { state: "landed", commit, spentTokens, ...(landedRules === undefined ? {} : { toolRules: landedRules }), ...(skills === undefined ? {} : { skills }), ...(current.drive?.skills?.dir === undefined ? {} : { skillsDir: current.drive.skills.dir }), ...(flow === undefined ? {} : { flow }) };
}

function sameMarker(left: FlowStopMarker, right: FlowStopMarker): boolean {
  return left.flowRunId === right.flowRunId && left.stepKey === right.stepKey && left.seq === right.seq && left.reason === right.reason;
}

/** §10.5.1: the held work item's current run can be continued only when it settled recoverable at a checkpoint. */
function childRecoverable(store: ControlStore, childGroupId: string): boolean {
  const row = store.db.prepare("SELECT body FROM work_items WHERE group_id=? ORDER BY rowid LIMIT 1").get(childGroupId);
  if (row === undefined) return false;
  const currentRunId = (JSON.parse(String(row.body)) as { currentRunId?: unknown }).currentRunId;
  if (typeof currentRunId !== "string") return false;
  const run = store.db.prepare("SELECT body FROM runs WHERE id=?").get(currentRunId);
  if (run === undefined) return false;
  const body = JSON.parse(String(run.body)) as { state?: unknown; recoverable?: unknown; checkpointId?: unknown };
  return body.state === "settled-recoverable" && body.recoverable === true && typeof body.checkpointId === "string";
}

/** Plan D7: none, not-complete (a handoff still open), resumable, or foreign (a stop the flow did not place). */
function childStopState(store: ControlStore, childGroupId: string, flowStop: FlowStopMarker): FlowChildStopState {
  const intent = readStopIntent(store, childGroupId);
  if (intent === null) return { state: "none" };
  if (intent.flowStop === undefined || !sameMarker(intent.flowStop, flowStop)) return { state: "foreign", stopState: intent.state };
  const state = groupStopState(store, childGroupId);
  if (state === "handoff-complete") return { state: "resumable", recoverable: childRecoverable(store, childGroupId) };
  if (state === "handoff-pending" || state === "handoff-partial" || state === "handoff-unresolved") return { state: "not-complete", stopState: state };
  return { state: "foreign", stopState: state };
}

export function createDriverChildPort(deps: DriverChildPortDeps): FlowChildPort {
  return {
    async open(request) {
      const flowRun = getFlowRun(deps.store, request.flowRunId);
      if (flowRun === null) throw new ControlError("recovery-blocked", `flow-run-missing:${request.flowRunId}`);
      const existing = groupBody(deps.store, request.childGroupId);
      if (existing !== null && flowBlockOf(existing)?.role !== "child") throw new ControlError("group-already-exists", request.childGroupId);
      // §6.2: a `dir` run's children target its vault; a `repo` run's (phase 3) its project's repository.
      const repoId = flowRun.vaultId !== null ? flowVaultRepoId(flowRun.vaultId) : String((flowRun.workspace as { projectId?: unknown }).projectId);
      importChild(deps, request, repoId);
      await confirmChild(deps, request);
    },
    status: (childGroupId) => childStatus(deps, childGroupId),
    attemptTimeoutMs(childGroupId) {
      try {
        const row = deps.store.db.prepare("SELECT body FROM work_items WHERE group_id=? ORDER BY rowid LIMIT 1").get(childGroupId);
        if (row === undefined) return null;
        const taskId = (JSON.parse(String(row.body)) as { taskId?: unknown }).taskId;
        if (typeof taskId !== "string") return null;
        const value = readConfirmedTaskExecution(deps.store, childGroupId, taskId).contract.executionPolicy.perAttemptTimeoutMs;
        return Number.isSafeInteger(value) && value > 0 ? value : null;
      } catch { return null; }
    },
    stop(childGroupId, input) {
      applyFlowHandoffStop(deps.store, childGroupId, input);
    },
    stopState: (childGroupId, flowStop) => childStopState(deps.store, childGroupId, flowStop),
    resume(children: FlowChildResume[]) {
      return deps.store.transaction(() => children.map((child) => {
        const state = childStopState(deps.store, child.childGroupId, child.flowStop);
        if (state.state !== "resumable") {
          const detail = state.state === "not-complete" ? state.stopState : "foreign";
          throw new FlowRefusal("flow-pause-stop-incomplete", `${child.childGroupId}:${detail}`);
        }
        try {
          const revision = Number(deps.store.db.prepare("SELECT revision FROM groups WHERE id=?").get(child.childGroupId)!.revision) + 1;
          updateRevision(deps.store, child.childGroupId, revision);
          const { pendingRunId } = resumeFlowChildInTransaction(deps.store, child.childGroupId, revision, child.operatorNote);
          return { childGroupId: child.childGroupId, pendingRunId };
        } catch (error) {
          if (!(error instanceof ControlError)) throw error;
          if (error.code === "continuation-budget-unavailable" || error.code === "group-budget-unavailable") throw new FlowRefusal(error.code, child.childGroupId);
          throw new FlowRefusal("flow-pause-resume-failed", error.code);
        }
      }));
    },
  };
}
