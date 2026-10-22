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
 * `orca/<child>` in the vault as the step's output.
 */
import { updateRevision } from "../control/commandLedger.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isTerminallyFailedRun, type DriveRecord } from "../control/driveRecord.js";
import { ControlError } from "../control/errors.js";
import { savedReport } from "../control/executionDriver.js";
import { ORCHESTRATION_ACTOR } from "../control/orchestration.js";
import { normalizeControlPlan, writeImportedPlan, type ImportDeps } from "../control/planImport.js";
import { readArchivedPlan, readBudgetProposal } from "../control/queries.js";
import { recordProjectionChange } from "../control/projectionJournal.js";
import { reportedFlowOf } from "../control/reportedDecisions.js";
import type { ControlStore } from "../control/store.js";
import type { ToolRulesReport } from "../control/toolRules.js";
import { workBranchRef } from "../control/workspace.js";
import { flowBlockOf, flowVaultRepoId, vaultPathOfRepoId } from "./groups.js";
import type { FlowChildOpen, FlowChildPort, FlowChildStatus } from "./kinds/work.js";
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

type RunBody = { runId: string; state: string; drive?: DriveRecord; cumulative?: { work?: { tokens?: number } } };

function childRuns(store: ControlStore, groupId: string): RunBody[] {
  return store.db.prepare("SELECT body FROM runs WHERE group_id=? ORDER BY rowid").all(groupId).map((row) => JSON.parse(String(row.body)) as RunBody)
    .filter((body) => (body as { phase?: unknown }).phase === "work");
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
  if (isTerminallyFailedRun(current as Parameters<typeof isTerminallyFailedRun>[0])) {
    const reason = current.drive?.failureCause?.cause ?? `outcome:${current.drive?.outcome ?? "unknown"}`;
    return { state: "failed", reason, spentTokens, ...(toolRules === undefined ? {} : { toolRules }) };
  }
  if (work?.status !== "done" || current.state !== "settled") return { state: "running" };
  const flowRun = getFlowRun(deps.store, block.flowRunId);
  const vault = flowRun?.vaultId == null ? null : vaultPathOfRepoId(deps.env, flowVaultRepoId(flowRun.vaultId));
  if (vault === null) throw new ControlError("recovery-blocked", `flow-child-vault-missing:${childGroupId}`);
  const commit = (await run("/usr/bin/git", ["--git-dir", vault, "rev-parse", "--verify", "--quiet", `${workBranchRef(childGroupId)}^{commit}`])).stdout.trim();
  // §4.3: what the agent reported under `flow` (the pinned ccloop carries only `decisions` and `debug`: absent until it does).
  const reported = reportedFlowOf(await savedReport(deps.store, current.runId));
  const flow = reported.kind === "object" ? { ...(reported.value.needs === undefined ? {} : { needs: reported.value.needs }), ...(reported.value.candidates === undefined ? {} : { candidates: reported.value.candidates }) } : undefined;
  return { state: "landed", commit, spentTokens, ...(toolRules === undefined ? {} : { toolRules }), ...(flow === undefined ? {} : { flow }) };
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
  };
}
