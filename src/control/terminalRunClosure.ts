import { recordActivity } from "./activity.js";
import { add, hasObservedUsage } from "./budget.js";
import { applyWebCommand } from "./commandLedger.js";
import { isTerminallyFailedRun, terminalClosureSchema, type DriveRecord } from "./driveRecord.js";
import { ControlError } from "./errors.js";
import { readWork, saveWork } from "./queries.js";
import { ADOPTABLE_STATES, commandSuccess, groupCommandTarget, latestRequestForRun, readRunBody, releaseCommitment, saveRunBody, setAllocationStates, type RunBody } from "./stopIntent.js";
import type { ControlStore } from "./store.js";
import { finiteCommitment } from "./tokenPolicy.js";
import { hasValidUsageSettlement, settlementArtifact, settlementProof, settlementSame, type SettlementRun } from "./usageSettlement.js";
import { isWebWorkRun } from "./webDispatch.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";

type TerminalClosure = import("./driveRecord.js").TerminalClosure;
type TerminalRun = RunBody & {
  executionId: string | null; commandId: string; configHash: string; highWater: number;
  drive?: DriveRecord; mode?: string; recoveryOf?: unknown; terminalClosure?: unknown;
};
type WorkBody = { kind: string; currentRunId?: string | null; pendingRunId?: string | null; status: string };
export type CloseRunCommand = Extract<RawAuthorityCommandV1, { verb: "close-run" }>;
export interface CloseRunDeps { store: ControlStore; admissionGate?: AdmissionGate; beforeCommit?: () => void }

function sealedProof(store: ControlStore, run: TerminalRun): { report: TerminalClosure["report"]; stopProof: TerminalClosure["stopProof"] } | null {
  try {
    const settlement = run as unknown as SettlementRun;
    if (!hasObservedUsage(store, settlement as unknown as Parameters<typeof hasObservedUsage>[1]) || (run.usageSettlement !== undefined && !hasValidUsageSettlement(store, settlement))) return null;
    const proof = settlementProof(store, settlement);
    const bytes = JSON.parse(settlementArtifact(store, proof.stopProof.source).toString()) as Record<string, unknown>;
    if (bytes.ownerLeaseReleased !== true || bytes.workerSealed !== true) return null;
    return { report: proof.report, stopProof: proof.stopProof.source };
  } catch { return null; }
}

/** Check stored evidence every time it grants an inactive run authority; a marker by itself grants nothing. */
export function validTerminalClosure(store: ControlStore, run: TerminalRun): boolean {
  try {
    if (run.state !== "settled-failed" || Number(store.db.prepare("SELECT active FROM runs WHERE id=?").get(run.runId)?.active) !== 0
      || !isWebWorkRun(store, run.runId) || run.drive?.outcome === null || run.drive?.outcome === "succeeded" || run.drive?.blockedAt !== "C") return false;
    const marker = terminalClosureSchema.parse(run.terminalClosure), proof = sealedProof(store, run);
    const row = store.db.prepare("SELECT verb, body_json FROM commands WHERE group_id=? AND id=?").get(run.groupId, marker.closeCommandId) as { verb?: string; body_json?: string } | undefined;
    const receipt = row === undefined ? null : (JSON.parse(String(row.body_json)) as { result?: { kind?: unknown; runId?: unknown; alreadyClosed?: unknown } }).result;
    return proof !== null && row?.verb === "close-run" && receipt?.kind === "run-closed" && receipt.runId === run.runId
      && marker.runId === run.runId && marker.generation === run.generation && marker.executionId === run.executionId
      && marker.highWater === run.highWater && marker.outcome === run.drive.outcome && marker.commandId === run.commandId
      && marker.ownerToken === run.ownerToken && settlementSame(marker.report, proof.report) && settlementSame(marker.stopProof, proof.stopProof);
  } catch { return false; }
}

/**
 * `close-run` (#169): a person or agent ends a proved terminal failure's accounting. It does not accept the work, does not
 * charge unspent tokens and does not retry; it releases the unused reservation so the task can be retried later or its
 * paused group archived. Anonymous, unknown-usage or unsealed runs refuse by name and stay retryable as before.
 */
export function applyCloseRun(deps: CloseRunDeps, command: CloseRunCommand): CommandSuccessV1 | CommandErrorBodyV1 {
  const release = deps.admissionGate?.enter();
  try {
    return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
      rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      apply: context => {
        const groupId = groupCommandTarget(command), runId = command.payload.runId;
        const run = readRunBody(deps.store, runId) as TerminalRun;
        if (run.groupId !== groupId) throw new ControlError("run-not-found");
        if (run.terminalClosure !== undefined) {
          if (!validTerminalClosure(deps.store, run)) throw new ControlError("run-closure-invalid");
          return commandSuccess(context, { kind: "run-closed", runId, taskId: String(run.taskId), alreadyClosed: true });
        }
        if (Number(deps.store.db.prepare("SELECT active FROM runs WHERE id=?").get(runId)?.active) !== 1) throw new ControlError("run-closure-not-terminal");
        if (run.phase !== "work" || run.mode !== undefined || run.recoveryOf !== undefined || !isTerminallyFailedRun(run)) throw new ControlError("run-closure-not-terminal");
        const work = readWork(deps.store, groupId, run.workItemId) as unknown as WorkBody;
        if (work.kind !== "task" || work.currentRunId !== runId || work.status !== "running" || work.pendingRunId != null
          || deps.store.db.prepare("SELECT id FROM runs WHERE group_id=? AND work_item_id=? ORDER BY rowid DESC LIMIT 1").get(groupId, run.workItemId)?.id !== runId) throw new ControlError("run-closure-not-current");
        const request = latestRequestForRun(deps.store, groupId, runId);
        if (request && ADOPTABLE_STATES.includes(request.state)) throw new ControlError("run-closure-request-open", request.requestId);
        if (run.unknown.work || run.unknown.handoff) throw new ControlError("run-closure-evidence", "usage-unknown");
        if (!workspaceOwnerGone(deps.store, run)) throw new ControlError("run-closure-process-live");
        const proof = sealedProof(deps.store, run);
        if (proof === null) throw new ControlError("run-closure-evidence");
        if (run.executionId === null || run.drive?.outcome === null || run.drive?.outcome === undefined) throw new ControlError("run-closure-evidence");
        run.terminalClosure = terminalClosureSchema.parse({ runId, generation: run.generation, executionId: run.executionId, highWater: run.highWater,
          outcome: run.drive.outcome, commandId: run.commandId, closeCommandId: context.rawCommand.commandId, ownerToken: run.ownerToken, ...proof, at: deps.store.now() });
        run.state = "settled-failed";
        (run as unknown as { recoverable: boolean }).recoverable = false;
        saveRunBody(deps.store, run, false);
        releaseCommitment(deps.store, groupId, add(finiteCommitment(run.remaining.work), run.remaining.handoff));
        setAllocationStates(deps.store, groupId, run.workItemId, "terminal");
        work.status = "blocked";
        saveWork(deps.store, groupId, work as never);
        recordActivity(deps.store, { groupId, taskId: run.taskId, runId, kind: "run-blocked", body: { reason: "terminal-accounting-closed" } });
        deps.beforeCommit?.();
        return commandSuccess(context, { kind: "run-closed", runId, taskId: String(run.taskId), alreadyClosed: false });
      },
    }).body;
  } finally { release?.(); }
}

/**
 * A process may still hold the run's workspace during cleanup, but it must not own the provider attempt. The terminal
 * stop proof is the durable owner statement; a live workspace directory alone is not proof that a provider is running.
 */
function workspaceOwnerGone(store: ControlStore, run: TerminalRun): boolean {
  try {
    const proof = settlementProof(store, run as unknown as SettlementRun);
    const bytes = JSON.parse(settlementArtifact(store, proof.stopProof.source).toString()) as Record<string, unknown>;
    return bytes.ownerLeaseReleased === true && bytes.workerSealed === true;
  } catch { return false; }
}
