import { add, readRun, saveRun, subtract, syncWebBudget } from "./budget.js";
import { isGroupArchived } from "./archivedMark.js";
import { recordActivity } from "./activity.js";
import { applyWebCommand } from "./commandLedger.js";
import { commandClientFor, commandPrincipalFor } from "./commandClient.js";
import { ControlError } from "./errors.js";
import { readGroup, readBudgetProposal, readWork, saveGroup } from "./queries.js";
import { ADOPTABLE_STATES, commandSuccess, groupCommandTarget, latestRequestForRun, readStopIntent, settleManuallyFailedRequestInTransaction } from "./stopIntent.js";
import { releasedSettlementCheckpoint, settlementProof, settlementSame, usageSettlementSchema, type SettlementRun } from "./usageSettlement.js";
import { bookSettledUsage } from "./usageLedger.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { ControlStore } from "./store.js";
import type { RawAuthorityCommandV1, CommandSuccessV1, CommandErrorBodyV1 } from "./webProtocol.js";

export type SettleUnknownUsageCommand = Extract<RawAuthorityCommandV1, { verb: "settle-unknown-usage" }>;
export interface SettleUnknownUsageDeps { store: ControlStore; admissionGate?: AdmissionGate; now?: () => Date; beforeCommit?: () => void; afterEvidence?: () => Promise<void> }

/** Optional request-local raw work reader; writers omit it and retain their transaction's database reads. */
export interface SettlementAdmissionReadContext {
  readonly store: ControlStore;
  readonly groupId: string;
  readWork(id: string): unknown;
}

export function settlementAdmission(store: ControlStore, run: SettlementRun, context?: SettlementAdmissionReadContext): "committed" | "released" {
  const group = readGroup(store, run.groupId), work = (context?.store === store && context.groupId === run.groupId
    ? context.readWork(run.workItemId) : readWork(store, run.groupId, run.workItemId)) as unknown as { taskId: string; currentRunId?: string; status: string; grant: unknown; pendingRunId?: string | null };
  if (isGroupArchived(store, run.groupId)) throw new ControlError("group-archived");
  if (run.usageSettlement !== undefined) throw new ControlError("run-usage-settled");
  if ((group as { status?: string }).status === "clarifying") throw new ControlError("group-state-invalid", "clarifying");
  if (run.phase !== "work" || run.taskId === null || run.estimateId !== null || work.taskId !== run.taskId || work.currentRunId !== run.runId
    || ["done", "continuing"].includes(work.status) || work.pendingRunId != null || !run.drive || run.drive.outcome == null || run.drive.outcome === "succeeded") throw new ControlError("run-usage-not-settleable", "current-failed-task");
  const active = Number(store.db.prepare("SELECT active FROM runs WHERE id=?").get(run.runId)?.active) === 1;
  const request = latestRequestForRun(store, run.groupId, run.runId);
  if (request && ADOPTABLE_STATES.includes(request.state)) throw new ControlError("run-usage-not-settleable", "handoff-request-open");
  if (store.db.prepare("SELECT seq FROM usage_events WHERE run_id=? AND seq>?").get(run.runId, run.highWater)) throw new ControlError("run-usage-pending");
  if (!run.unknown.work && !run.unknown.handoff) throw new ControlError("run-usage-not-unknown");
  const stop = readStopIntent(store, run.groupId);
  if (active && run.state === "blocked" && run.drive.blockedAt === "C") {
    if (group.stopped || stop) throw new ControlError("stop-mode-conflict");
    return "committed";
  }
  const allocations = readBudgetProposal(store, run.groupId).allocations.filter(a => a.ownerKind === "task" && a.ownerId === run.taskId);
  if (active || run.state !== "settled-unrecoverable" || work.status !== "blocked" || allocations.length !== 2 || allocations.some(a => a.state !== "terminal")
    || !settlementSame(work.grant, run.grant) || request?.state !== "settled-unrecoverable" || request.failureCode !== "usage-unsettled") throw new ControlError("run-usage-not-settleable", "released-handoff");
  if (stop?.mode === "pause" || (group.stopped && !stop)) throw new ControlError("stop-mode-conflict");
  return "released";
}
export async function applySettleUnknownUsage(deps: SettleUnknownUsageDeps, command: SettleUnknownUsageCommand): Promise<CommandSuccessV1 | CommandErrorBodyV1> {
  const { store } = deps;
  const principal = commandPrincipalFor(command.commandId);
  if (commandClientFor(command.commandId) !== "web" || principal === null || !principal.startsWith("user:")) throw new Error("control-verb-human-only: authenticated owner Web context required");
  const release = deps.admissionGate?.enter();
  try {
    // Evidence read before authority transaction. Its exact run/report/checkpoint snapshot is rechecked inside it.
    let evidence: { body: unknown; proof: ReturnType<typeof settlementProof>; checkpoint: ReturnType<typeof releasedSettlementCheckpoint> | null } | { error: unknown };
    try {
      const run = readRun(store, command.payload.runId) as unknown as SettlementRun;
      const disposition = settlementAdmission(store, run);
      evidence = { body: structuredClone(run), proof: settlementProof(store, run), checkpoint: disposition === "released" ? releasedSettlementCheckpoint(store, run) : null };
    } catch (error) { evidence = { error }; }
    await deps.afterEvidence?.();
    return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(store, {
      rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      apply: context => {
        const groupId = groupCommandTarget(command), run = readRun(store, command.payload.runId) as unknown as SettlementRun;
        if (run.groupId !== groupId || run.taskId !== command.payload.taskId || run.generation !== command.payload.generation) throw new ControlError("run-usage-not-settleable", "identity");
        const disposition = settlementAdmission(store, run);
        if ("error" in evidence) throw evidence.error;
        if (!settlementSame(run, evidence.body) || !settlementSame(settlementProof(store, run), evidence.proof)
          || (disposition === "released" && !settlementSame(releasedSettlementCheckpoint(store, run), evidence.checkpoint))) throw new ControlError("run-usage-not-settleable", "evidence-changed");
        const charged = structuredClone(run.remaining), at = (deps.now ?? (() => new Date()))().getTime();
        const request = latestRequestForRun(store, groupId, run.runId);
        const marker = usageSettlementSchema.parse({ method: "remaining-grant", commandId: command.commandId, principal, at,
          groupId, taskId: run.taskId, workItemId: run.workItemId, runId: run.runId, generation: run.generation, highWater: run.highWater,
          charged, reservationDisposition: disposition, ...evidence.proof,
          ...(disposition === "released" ? { handoffResolution: { requestId: request!.requestId, previousState: "settled-unrecoverable", previousFailureCode: "usage-unsettled", ...evidence.checkpoint! } } : {}),
        });
        const group = readGroup(store, groupId), delta = add(charged.work, charged.handoff);
        group.used = add(group.used, delta);
        if (disposition === "committed") group.reserved = subtract(group.reserved, delta);
        for (const b of ["work", "handoff"] as const) {
          run.cumulative[b] = add(run.cumulative[b], charged[b]); run.remaining[b] = { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 }; run.unknown[b] = false;
          bookSettledUsage(store, { run, groupBody: group as unknown as Record<string, unknown>, bucket: b, tokens: charged[b].tokens, appliedAt: at });
        }
        run.usageSettlement = marker;
        // Preserve endedAt/activity: this is manual accounting, not another provider terminalisation/release.
        if (disposition === "released") { run.state = "settled-failed"; run.recoverable = false; }
        if (disposition === "released") store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(run), run.runId);
        else saveRun(store, run as never);
        syncWebBudget(store, group, run as never);
        if (group.budgetVersion === Number.MAX_SAFE_INTEGER) throw new ControlError("numeric-overflow");
        group.budgetVersion += 1; saveGroup(store, group);
        if (disposition === "released") settleManuallyFailedRequestInTransaction(store, groupId, request!.requestId, marker);
        recordActivity(store, { groupId, taskId: run.taskId, runId: run.runId, kind: "usage-settled", body: { method: marker.method, charged, principal, at } });
        deps.beforeCommit?.();
        return commandSuccess(context, { kind: "usage-settled", taskId: run.taskId!, runId: run.runId, generation: run.generation, charged, at, method: marker.method });
      },
    }).body;
  } finally { release?.(); }
}
