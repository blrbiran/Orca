import { readRun, saveRun, syncWebBudget, type RunRecord } from "./budget.js";
import { recordActivity } from "./activity.js";
import { commandPrincipalFor } from "./commandClient.js";
import { openRequestOf } from "./driverHandoff.js";
import { resumeBlockedDriverRun, type DriveRecord } from "./driveRecord.js";
import { ControlError } from "./errors.js";
import { isFlowCallRun } from "../flow/calls.js";
import { readGroup, saveGroup } from "./queries.js";
import { interruptRequirementCall, requirementCallTargetMoved } from "./requirementCalls.js";
import { amountSchema } from "./schema.js";
import { chargeRunRemainder } from "./settleUnknownUsage.js";
import { singleCallPurposeOf } from "./singleCall.js";
import { singleCallHandler, type SingleCallHandler, type SingleCallRunRow } from "./singleCallPurposes.js";
import { interruptEstimate, readStopIntent } from "./stopIntent.js";
import { singleCallSettlementSchema, type SingleCallSettlement } from "./usageSettlement.js";
import type { ControlStore } from "./store.js";

/**
 * Spec 2026-10-27 single-call unknown usage (tester #62), §9 R1-R4: a single call the driver blocked at C because its
 * usage is unknown (stepCSingleCall, `<usageUnknownReason>[:<failure>]`) is settled by the person through the run-scoped
 * recovery-retry with `acknowledge: "charge-remaining-grant"`: the call's remaining grant is charged (D2, never a silent
 * zero, D1), the group's usage-unknown flag is recomputed (R3), and the call is completed as failed by its purpose's own
 * core -- so its purpose's retry rule applies -- or interrupted when its round, draft or estimate moved on (R2).
 * Requirement clarify/split and estimate only; flow calls are out of scope (R1).
 */

export const SINGLE_CALL_SETTLE_ACKNOWLEDGE = "charge-remaining-grant";

type SingleCallRun = RunRecord & SingleCallRunRow & { purpose?: string; drive?: DriveRecord; singleCallUsageLowerBound?: { tokens: number }; singleCallSettlement?: SingleCallSettlement };

/**
 * The commit the driver's Ce runs first inside the settlement's transaction (stepCSingleCall), shared with a usage
 * settlement (R2): a run with an open handoff request yields to the handoff, a run that moved off `accepted` is left alone,
 * otherwise it becomes `settled-restartable`.
 */
export function singleCallCommitTerminal(store: ControlStore, run: { groupId: string; runId: string }): () => void {
  return () => {
    if (openRequestOf(store, run) !== null) throw new ControlError("handoff-request-conflict", "estimate-yields-to-handoff");
    const current = readRun(store, run.runId) as Omit<RunRecord, "state"> & { state: string };
    // As stepC: the run may have moved while this step awaited ccloop; only an `accepted` run is settled here.
    if (current.state !== "accepted") throw new ControlError("start-state-conflict", "estimate-run-moved");
    current.state = "settled-restartable";
    saveRun(store, current as never);
  };
}

/**
 * The block a person can settle: a requirement or estimate single call (never a flow call) blocked at C with a reason
 * that is its purpose's usageUnknownReason, alone or followed by `:` and ccloop's failure code. `failure` is that code;
 * a reason without one (the call completed but its usage is unknown) is recorded as `usage-unknown` (review S2).
 */
export function settleableSingleCallBlock(run: { state?: unknown; drive?: { blockedAt?: string | null; blockedReason?: string | null } } & Record<string, unknown>): { handler: SingleCallHandler; failure: string } | null {
  const purpose = singleCallPurposeOf(run as never);
  if (purpose === null || run.state !== "blocked" || run.drive?.blockedAt !== "C") return null;
  const handler = singleCallHandler(purpose);
  if (handler.completeInTransaction === undefined || isFlowCallRun(run as never)) return null;
  const reason = run.drive.blockedReason ?? "", prefix = handler.usageUnknownReason;
  if (reason !== prefix && !reason.startsWith(`${prefix}:`)) return null;
  return { handler, failure: reason === prefix ? "usage-unknown" : reason.slice(prefix.length + 1) };
}

/** The estimate's twin of requirementCallTargetMoved: its settlement records only a running (or start-unknown) estimate. */
function estimateMoved(store: ControlStore, groupId: string, estimateId: string): boolean {
  const row = store.db.prepare("SELECT state FROM estimates WHERE group_id=? AND id=?").get(groupId, estimateId);
  return row === undefined || !["running", "start-unknown"].includes(String(row.state));
}

/**
 * The settlement, inside recovery-retry's transaction (stopIntent.ts retryRun). `evaluation` is what the purpose's
 * `evaluate` answered before the transaction for a failed call (rawOutput null), as the driver computes it (R2, review
 * S2); a purpose without `evaluate` gets null. A refusal throws, and the command's transaction rolls everything back.
 */
export function settleSingleCallUsageInTransaction(
  store: ControlStore, input: { groupId: string; runId: string; commandId: string; at: number; evaluation?: unknown },
): void {
  const run = readRun(store, input.runId) as SingleCallRun;
  const block = settleableSingleCallBlock(run);
  if (block === null || run.groupId !== input.groupId) throw new ControlError("run-usage-not-settleable", "not-single-call-usage-unknown");
  // As settle-unknown-usage: an authenticated owner on the Web (the route refuses anyone else first, humanOnly.ts).
  const principal = commandPrincipalFor(input.commandId);
  if (principal === null || !principal.startsWith("user:")) throw new ControlError("run-usage-not-settleable", "owner-required");
  const group = readGroup(store, run.groupId);
  // A stop owns the group's calls: it settles them (terminaliseRun) and recovery-retry lifts it first.
  if (group.stopped || readStopIntent(store, run.groupId) !== null) throw new ControlError("stop-mode-conflict");
  if (store.db.prepare("SELECT seq FROM usage_events WHERE run_id=? AND seq>?").get(run.runId, run.highWater)) throw new ControlError("run-usage-pending");
  if (!run.unknown.work && !run.unknown.handoff) throw new ControlError("run-usage-not-unknown");
  const { handler, failure } = block;
  if (handler.evaluate !== undefined && input.evaluation === undefined) throw new ControlError("run-usage-not-settleable", "evaluation-missing");
  const estimate = handler.purpose === "estimate";
  const moved = estimate ? estimateMoved(store, run.groupId, String(run.estimateId)) : requirementCallTargetMoved(store, run);
  // A single call's grant is work-only (verifyStoppedSingleCall), so its whole remainder is the work bucket's.
  const charged = amountSchema.parse(run.remaining.work);
  chargeRunRemainder(store, run, group, { work: charged, handoff: amountSchema.parse(run.remaining.handoff) }, { unmetered: false, releaseReserved: true, at: input.at });
  const marker = singleCallSettlementSchema.parse({
    method: "remaining-grant", commandId: input.commandId, principal, at: input.at, groupId: run.groupId, runId: run.runId, highWater: run.highWater,
    charged, usageLowerBound: run.singleCallUsageLowerBound ?? null, blockedReason: run.drive!.blockedReason, disposition: moved ? "interrupted" : "completed",
  });
  run.singleCallSettlement = marker;
  saveRun(store, run);
  // R3: the flag is recomputed (syncRequirementLedger for a clarifying group), so the next claim is not parked on it.
  syncWebBudget(store, group, run);
  if (group.budgetVersion === Number.MAX_SAFE_INTEGER) throw new ControlError("numeric-overflow");
  group.budgetVersion += 1;
  saveGroup(store, group);
  // Back to `accepted`, the state stepCSingleCall left the run in before it blocked it; then its Ce, as the driver runs it.
  resumeBlockedDriverRun(store, run.runId);
  const commitTerminal = singleCallCommitTerminal(store, run);
  if (moved) {
    commitTerminal();
    const settled = readRun(store, run.runId) as SingleCallRun;
    if (estimate) interruptEstimate(store, run.groupId, String(run.estimateId));
    else interruptRequirementCall(store, run.groupId, settled as never);
    store.db.prepare("UPDATE runs SET active=0 WHERE id=?").run(run.runId);
  } else {
    handler.completeInTransaction!(store, readRun(store, run.runId) as SingleCallRun, handler.evaluate === undefined ? null : input.evaluation, commitTerminal, failure);
  }
  recordActivity(store, { groupId: run.groupId, taskId: null, runId: run.runId, kind: "usage-settled", body: { method: marker.method, charged, principal, at: input.at, disposition: marker.disposition } });
}
