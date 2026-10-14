import { amountSchema } from "./schema.js";
import { add, budgetBalance, readRun, saveRun, subtract, syncWebBudget } from "./budget.js";
import { dimensions } from "./commands.js";
import { hasTokenPolicy } from "./fundedAllowance.js";
import { isGroupArchived } from "./archivedMark.js";
import { recordActivity } from "./activity.js";
import { applyWebCommand } from "./commandLedger.js";
import { commandClientFor, commandPrincipalFor } from "./commandClient.js";
import { ControlError } from "./errors.js";
import { readGroup, readBudgetProposal, readWork, saveGroup, saveWork } from "./queries.js";
import { ADOPTABLE_STATES, commandSuccess, groupCommandTarget, latestRequestForRun, readStopIntent, reserveCommitment, setAllocationStates, settleManuallyFailedRequestInTransaction, settleRecoveredRequestInTransaction } from "./stopIntent.js";
import { releasedSettlementCheckpoint, settlementProof, settlementSame, unmeteredChargeSchema, usageSettlementSchema, type SettlementRun } from "./usageSettlement.js";
import { bookSettledUsage } from "./usageLedger.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { ControlStore } from "./store.js";
import type { RawAuthorityCommandV1, CommandSuccessV1, CommandErrorBodyV1 } from "./webProtocol.js";

export type SettleUnknownUsageCommand = Extract<RawAuthorityCommandV1, { verb: "settle-unknown-usage" }>;
export type SettleAcknowledge = SettleUnknownUsageCommand["payload"]["acknowledge"];
/** The acknowledgement a run's remainder admits: an unlimited work token remainder can only be released unmetered. */
export const settlementAcknowledgeFor = (run: SettlementRun): SettleAcknowledge => run.remaining.work.tokens === null ? "release-unmetered" : "charge-remaining-grant";
export interface SettleUnknownUsageDeps { store: ControlStore; admissionGate?: AdmissionGate; now?: () => Date; beforeCommit?: () => void; afterEvidence?: () => Promise<void> }

/** Optional request-local raw work reader; writers omit it and retain their transaction's database reads. */
export interface SettlementAdmissionReadContext {
  readonly store: ControlStore;
  readonly groupId: string;
  readWork(id: string): unknown;
}

export function settlementAdmission(store: ControlStore, run: SettlementRun, context?: SettlementAdmissionReadContext, acknowledge: SettleAcknowledge = settlementAcknowledgeFor(run)): "committed" | "released" | "recovered" {
  const group = readGroup(store, run.groupId), work = (context?.store === store && context.groupId === run.groupId
    ? context.readWork(run.workItemId) : readWork(store, run.groupId, run.workItemId)) as unknown as { taskId: string; currentRunId?: string; status: string; grant: unknown; pendingRunId?: string | null };
  if (acknowledge !== settlementAcknowledgeFor(run)) throw new ControlError("run-usage-not-settleable", run.remaining.work.tokens === null ? "unlimited-remainder" : "finite-remainder");
  if (isGroupArchived(store, run.groupId)) throw new ControlError("group-archived");
  if (run.usageSettlement !== undefined) throw new ControlError("run-usage-settled");
  if ((group as { status?: string }).status === "clarifying") throw new ControlError("group-state-invalid", "clarifying");
  if (run.phase !== "work" || run.taskId === null || run.estimateId !== null || work.taskId !== run.taskId || work.currentRunId !== run.runId
    || ["done", "continuing"].includes(work.status) || work.pendingRunId != null || !run.drive || run.drive.outcome === "succeeded"
    || (run.drive.outcome == null && !stoppedWorking(run))) throw new ControlError("run-usage-not-settleable", "current-failed-task");
  const active = Number(store.db.prepare("SELECT active FROM runs WHERE id=?").get(run.runId)?.active) === 1;
  const request = latestRequestForRun(store, run.groupId, run.runId);
  if (request && ADOPTABLE_STATES.includes(request.state)) throw new ControlError("run-usage-not-settleable", "handoff-request-open");
  if (store.db.prepare("SELECT seq FROM usage_events WHERE run_id=? AND seq>?").get(run.runId, run.highWater)) throw new ControlError("run-usage-pending");
  if (!run.unknown.work && !run.unknown.handoff) throw new ControlError("run-usage-not-unknown");
  const stop = readStopIntent(store, run.groupId);
  if (stoppedWorking(run)) {
    // Spec 2026-10-14-handoff-stop-unknown-usage-design.md §3.1: stopped while working, so there is no failure to settle;
    // its usage alone kept the handoff from settling recoverable, and the run goes back to recoverable once it is settled.
    // Its partial checkpoint is checked with the evidence (settlementProof, releasedSettlementCheckpoint).
    if (active || work.status !== "blocked" || request?.state !== "settled-unrecoverable" || request.failureCode !== "usage-unsettled") throw new ControlError("run-usage-not-settleable", "stopped-handoff");
    if (stop?.mode === "pause" || (group.stopped && !stop)) throw new ControlError("stop-mode-conflict");
    if (!hasTokenPolicy(store, run.groupId)) {
      // §3.2 finite-legacy: the charge and the commitment parked again for the continuation must both fit the group limit.
      const parked = add(run.remaining.work as never, run.remaining.handoff), available = budgetBalance(group.limit, group.used, group.reserved).reserve;
      for (const d of dimensions) {
        const shortfall = available[d] === null ? 0 : 2 * parked[d] - available[d]!;
        if (shortfall > 0) throw new ControlError("group-reserve-insufficient", `${d}:${shortfall}`);
      }
    }
    return "recovered";
  }
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
/** A run the owner's handoff stop ended while it was still working: no outcome, and only its usage kept it unrecoverable. */
const stoppedWorking = (run: SettlementRun): boolean => run.drive?.outcome === null && run.state === "settled-unrecoverable";
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
      const disposition = settlementAdmission(store, run, undefined, command.payload.acknowledge);
      evidence = { body: structuredClone(run), proof: settlementProof(store, run), checkpoint: disposition !== "committed" ? releasedSettlementCheckpoint(store, run) : null };
    } catch (error) { evidence = { error }; }
    await deps.afterEvidence?.();
    return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(store, {
      rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      apply: context => {
        const groupId = groupCommandTarget(command), run = readRun(store, command.payload.runId) as unknown as SettlementRun;
        if (run.groupId !== groupId || run.taskId !== command.payload.taskId || run.generation !== command.payload.generation) throw new ControlError("run-usage-not-settleable", "identity");
        const disposition = settlementAdmission(store, run, undefined, command.payload.acknowledge);
        if ("error" in evidence) throw evidence.error;
        if (!settlementSame(run, evidence.body) || !settlementSame(settlementProof(store, run), evidence.proof)
          || (disposition !== "committed" && !settlementSame(releasedSettlementCheckpoint(store, run), evidence.checkpoint))) throw new ControlError("run-usage-not-settleable", "evidence-changed");
        const unmetered = command.payload.acknowledge === "release-unmetered", at = (deps.now ?? (() => new Date()))().getTime();
        const charged = unmetered ? unmeteredChargeSchema.parse({ work: run.remaining.work, handoff: run.remaining.handoff })
          : { work: amountSchema.parse(run.remaining.work), handoff: amountSchema.parse(run.remaining.handoff) };
        const request = latestRequestForRun(store, groupId, run.runId);
        const marker = usageSettlementSchema.parse({ method: unmetered ? "owner-acknowledged-unmetered" : "remaining-grant", commandId: command.commandId, principal, at,
          groupId, taskId: run.taskId, workItemId: run.workItemId, runId: run.runId, generation: run.generation, highWater: run.highWater,
          charged, reservationDisposition: disposition, ...evidence.proof,
          ...(disposition !== "committed" ? { handoffResolution: { requestId: request!.requestId, previousState: "settled-unrecoverable", previousFailureCode: "usage-unsettled", ...evidence.checkpoint! } } : {}),
        });
        // Unmetered work tokens book nothing: the run keeps its observed cumulative and its unlimited (null) remainder.
        const work = { ...charged.work, tokens: charged.work.tokens ?? 0 }, group = readGroup(store, groupId), delta = add(work, charged.handoff);
        // §3.2: an optional-v1 stop kept its reservation (allocations `unknown`); a finite-legacy stop already released it.
        const legacy = disposition === "recovered" && !hasTokenPolicy(store, groupId), parked = { work: structuredClone(run.remaining.work), handoff: structuredClone(run.remaining.handoff) };
        group.used = add(group.used, delta);
        if (disposition === "committed" || (disposition === "recovered" && !legacy)) group.reserved = subtract(group.reserved, delta);
        for (const b of ["work", "handoff"] as const) {
          const amount = b === "work" ? work : charged.handoff;
          run.cumulative[b] = add(run.cumulative[b], amount); run.remaining[b] = { tokens: b === "work" && unmetered ? null : 0, activeMs: 0, attempts: 0, sessions: 0 } as never; run.unknown[b] = false;
          if (charged[b].tokens !== null) bookSettledUsage(store, { run, groupBody: group as unknown as Record<string, unknown>, bucket: b, tokens: charged[b].tokens, appliedAt: at });
        }
        run.usageSettlement = marker;
        // Preserve endedAt/activity: this is manual accounting, not another provider terminalisation/release.
        if (disposition === "released") { run.state = "settled-failed"; run.recoverable = false; }
        if (disposition === "recovered") Object.assign(run, { state: "settled-recoverable", recoverable: true, failureCode: null });
        if (disposition !== "committed") store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(run), run.runId);
        else saveRun(store, run as never);
        syncWebBudget(store, group, run as never);
        if (group.budgetVersion === Number.MAX_SAFE_INTEGER) throw new ControlError("numeric-overflow");
        group.budgetVersion += 1; saveGroup(store, group);
        if (disposition === "released") settleManuallyFailedRequestInTransaction(store, groupId, request!.requestId, marker);
        if (disposition === "recovered") {
          // §3.2: where terminaliseRun puts a recoverable stop with known usage. A finite-legacy continuation is funded from
          // the parked commitment: the grant minus observed usage, i.e. the remainder as it stood before the charge.
          const task = readWork(store, groupId, run.workItemId) as unknown as Record<string, unknown>;
          Object.assign(task, { status: "held" }, legacy ? { grant: parked } : { fundingReleased: true });
          saveWork(store, groupId, task as never);
          setAllocationStates(store, groupId, run.workItemId, "held", legacy ? parked as never : undefined);
          if (legacy) reserveCommitment(store, groupId, add(parked.work as never, parked.handoff));
          settleRecoveredRequestInTransaction(store, groupId, request!.requestId, marker);
        }
        recordActivity(store, { groupId, taskId: run.taskId, runId: run.runId, kind: "usage-settled", body: { method: marker.method, charged, principal, at } });
        deps.beforeCommit?.();
        const receipt = { kind: "usage-settled" as const, taskId: run.taskId!, runId: run.runId, generation: run.generation, at };
        return commandSuccess(context, { ...receipt, charged: marker.charged, method: marker.method });
      },
    }).body;
  } finally { release?.(); }
}
