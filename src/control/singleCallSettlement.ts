import { readRun, saveRun, syncWebBudget, type RunRecord } from "./budget.js";
import { recordActivity } from "./activity.js";
import { settlingPersonFor } from "./commandClient.js";
import { zero } from "./commands.js";
import { queueRequirementCall } from "./requirementRecords.js";
import { singleCallCommitTerminal } from "./driverHandoff.js";
import { resumeBlockedDriverRun, type DriveRecord } from "./driveRecord.js";
import { ControlError } from "./errors.js";
import { readGroup, saveGroup } from "./queries.js";
import { interruptRequirementCall, requirementCallTargetMoved } from "./requirementCalls.js";
import { amountSchema } from "./schema.js";
import { chargeRunRemainder } from "./settleUnknownUsage.js";
import { settleableSingleCallBlock } from "./singleCall.js";
import { singleCallHandler, type SingleCallRunRow } from "./singleCallPurposes.js";
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

type SingleCallRun = RunRecord & SingleCallRunRow & { purpose?: string; drive?: DriveRecord; singleCallUsageLowerBound?: { tokens: number }; singleCallSettlement?: SingleCallSettlement };

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
export type SettleSingleCallUsage = typeof settleSingleCallUsageInTransaction;
export function settleSingleCallUsageInTransaction(
  store: ControlStore, input: { groupId: string; runId: string; commandId: string; at: number; evaluation?: unknown },
): void {
  const run = readRun(store, input.runId) as SingleCallRun;
  const block = settleableSingleCallBlock(run as never);
  if (block === null || run.groupId !== input.groupId) throw new ControlError("run-usage-not-settleable", "not-single-call-usage-unknown");
  // As settle-unknown-usage: an authenticated owner on the Web (the route refuses anyone else first, humanOnly.ts), or --
  // tester #103, the recovery CLI -- an owner's person token on the socket (`recovery-retry.acknowledge` is token-tier).
  const principal = settlingPersonFor(input.commandId);
  if (principal === null) throw new ControlError("run-usage-not-settleable", "owner-required");
  const group = readGroup(store, run.groupId);
  // A stop owns the group's calls in flight: it closes them (terminaliseRun) and the call is settled after (code review
  // S1). One it already closed is no longer the stop's.
  if (!block.closed && (group.stopped || readStopIntent(store, run.groupId) !== null)) throw new ControlError("stop-mode-conflict");
  if (store.db.prepare("SELECT seq FROM usage_events WHERE run_id=? AND seq>?").get(run.runId, run.highWater)) throw new ControlError("run-usage-pending");
  if (!run.unknown.work && !run.unknown.handoff) throw new ControlError("run-usage-not-unknown");
  const { failure } = block, handler = singleCallHandler(block.purpose);
  // Re-review m-b: a requirement call closed by a stop is settled only while its group still clarifies (the summary offers
  // it only then, and the wake it queues is a clarifying group's).
  if (block.closed && handler.purpose !== "estimate" && (group as { status?: string }).status !== "clarifying") throw new ControlError("run-usage-not-settleable", "group-not-clarifying");
  if (!block.closed && handler.evaluate !== undefined && input.evaluation === undefined) throw new ControlError("run-usage-not-settleable", "evaluation-missing");
  const estimate = handler.purpose === "estimate";
  const moved = !block.closed && (estimate ? estimateMoved(store, run.groupId, String(run.estimateId)) : requirementCallTargetMoved(store, run));
  // A single call's grant is work-only (verifyStoppedSingleCall), so its whole remainder is the work bucket's.
  const charged = amountSchema.parse(run.remaining.work);
  // A stop already gave the grant back (interruptRequirementCall / releaseCommitment): the charge books `used` only.
  chargeRunRemainder(store, run, group, { work: charged, handoff: amountSchema.parse(run.remaining.handoff) }, { unmetered: false, releaseReserved: !block.closed, at: input.at });
  const disposition = block.closed ? "stopped" : moved ? "interrupted" : "completed";
  const marker = singleCallSettlementSchema.parse({
    method: "remaining-grant", commandId: input.commandId, principal, at: input.at, groupId: run.groupId, runId: run.runId, highWater: run.highWater,
    charged, usageLowerBound: run.singleCallUsageLowerBound ?? null, blockedReason: run.drive!.blockedReason, disposition,
  });
  run.singleCallSettlement = marker;
  saveRun(store, run);
  // R3: the flag is recomputed (syncRequirementLedger for a clarifying group), so the next claim is not parked on it.
  syncWebBudget(store, group, run);
  if (group.budgetVersion === Number.MAX_SAFE_INTEGER) throw new ControlError("numeric-overflow");
  group.budgetVersion += 1;
  saveGroup(store, group);
  if (block.closed) {
    // Its round or draft was interrupted by the stop; a round or draft re-queued since and parked on the flag is woken
    // (a stopped group keeps the wake pending until the stop is lifted, claimOrWait "held").
    if (!estimate) queueRequirementCall(store, run.groupId, `usage-settled-${run.runId}`);
  } else {
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
  }
  recordActivity(store, { groupId: run.groupId, taskId: null, runId: run.runId, kind: "usage-settled", body: { method: marker.method, charged: { work: charged, handoff: zero() }, principal, at: input.at, disposition } });
}
