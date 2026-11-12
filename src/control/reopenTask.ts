import { recordActivity } from "./activity.js";
import type { AdmissionGate } from "./admissionGate.js";
import { add } from "./budget.js";
import { applyWebCommand } from "./commandLedger.js";
import { commandPrincipalFor } from "./commandClient.js";
import { dimensions } from "./commands.js";
import { landedAnywhere, type DriveRecord } from "./driveRecord.js";
import { ControlError } from "./errors.js";
import { hasOptionalTaskPolicy } from "./fundedAllowance.js";
import { readBudgetProposal, readGroup, readWork, saveGroup, saveWork } from "./queries.js";
import { retryFundingOf } from "./retryTask.js";
import { commandSuccess, groupCommandTarget, readGroupBody, readStopIntent, reserveCommitment, setAllocationStates } from "./stopIntent.js";
import { refuseFlowChild } from "../flow/groups.js";
import { remainingBudget } from "./tokenPolicy.js";
import { appendTopUp, topUpSum, withTopUp } from "./workTopUp.js";
import type { ControlStore } from "./store.js";
import type { Amount } from "./types.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";

/**
 * Tester follow-up G spec §1.4-§1.5 (human: 「希望这个任务直接在同一组里带你写的一句说明重新跑一次」): revoke a task's
 * no-change completion and run it again in the same group, with a note its next run gets as the operator note. One core
 * serves the person's and an orchestrating agent's `reopen-task` and the goal judge's own re-run (`by: "system"`, Task 5).
 * Dependents that already started or landed are not rolled back (controller's call); only this task moves.
 */
export type ReopenTaskCommand = Extract<RawAuthorityCommandV1, { verb: "reopen-task" }>;

/**
 * The blocks a provable no change can stop in while it waits for a person (spec §10.1): written on the run's drive record
 * by the goal judge's path (noChangeJudge.ts). Listed here so "what can be reopened" is one predicate.
 */
export const NO_CHANGE_BLOCKS = ["no-change-twice", "no-change-judge-failed", "no-change-judge-unfunded", "no-change-not-met"] as const;

/** The goal judge's work item for a task's no-change run (noChangeJudge.ts claims on it). */
export const noChangeJudgeWorkItemId = (workRunId: string): string => `no-change-judge-${workRunId}`;

type ReopenWork = {
  workItemId: string; taskId: string; status: string; currentRunId?: string | null; pendingRunId?: string | null;
  grant: { work: Amount; handoff: Amount }; noChangeCompletion?: { runId: string }; reopenNote?: { text: string; scope: string };
  fundingReleased?: boolean; noChangeRerun?: unknown;
};

const acceptedRow = (store: ControlStore, runId: string): { runId: string; accepted: boolean; source: unknown } | null => {
  const row = store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='acceptance'").get(`acceptance:${runId}`);
  return row === undefined ? null : JSON.parse(String(row.body));
};

/**
 * Whether `runId` is a reopenable no change of the task: `completed` -- the task is done on this run by a no-change
 * completion (its acceptance row still accepted); `blocked` -- the task is blocked on this settled run with a bound proof,
 * no acceptance, and a block that waits for a person (none, or one of NO_CHANGE_BLOCKS) with no goal judge still running.
 * Anything else is the refusal's detail: `run-moved`, `run-active`, `judge-pending`, `not-no-change`.
 */
export function reopenEligibility(store: ControlStore, groupId: string, taskId: string, runId: string): "completed" | "blocked" | string {
  const work = readWork(store, groupId, taskId) as unknown as ReopenWork;
  if (work.currentRunId !== runId) return "run-moved";
  const row = store.db.prepare("SELECT active, body FROM runs WHERE id=? AND group_id=?").get(runId, groupId);
  if (row === undefined) return "run-moved";
  if (Number(row.active) === 1) return "run-active";
  const run = JSON.parse(String(row.body)) as { state: string; drive?: DriveRecord };
  const drive = run.drive;
  if (run.state !== "settled" || drive === undefined || landedAnywhere(drive) || drive.noChange === null || drive.noChange.attempt !== drive.attemptSha) return "not-no-change";
  const acceptance = acceptedRow(store, runId);
  if (work.status === "done") return work.noChangeCompletion?.runId === runId && acceptance?.accepted === true ? "completed" : "not-no-change";
  if (work.status !== "blocked" || acceptance?.accepted === true) return "not-no-change";
  if (store.db.prepare("SELECT 1 FROM runs WHERE group_id=? AND work_item_id=? AND active=1").get(groupId, noChangeJudgeWorkItemId(runId)) !== undefined) return "judge-pending";
  const reason = drive.blockedReason;
  return reason === null || NO_CHANGE_BLOCKS.some((block) => reason === block || reason.startsWith(`${block}:`)) ? "blocked" : "not-no-change";
}

/**
 * Spec §1.4, in the caller's transaction: refusals first in retry-task's order, then the no-change acceptance withdrawn
 * (its outbox row rewritten `accepted: false` with who, why and when, so neither acceptanceEvidence nor
 * repairAcceptedWork counts it again), the task back to `ready` carrying the note for its next claim, a fresh start's
 * funding (§1.5), its allocations confirmed, and a done group running again.
 */
export function reopenNoChangeTaskInTransaction(store: ControlStore, input: { groupId: string; taskId: string; runId: string; note: string; by: string; commandId: string }): { fromRunId: string; withdrawn: boolean } {
  const { groupId, taskId, runId } = input;
  const group = readGroupBody(store, groupId);
  refuseFlowChild(store, groupId);
  if (group.stopped || readStopIntent(store, groupId) !== null) throw new ControlError("stop-mode-conflict");
  const eligibility = reopenEligibility(store, groupId, taskId, runId);
  if (eligibility !== "completed" && eligibility !== "blocked") throw new ControlError("task-not-reopenable", eligibility);
  // §1.5: a finite group with no token remainder cannot fund the re-run.
  const ledger = readGroup(store, groupId) as unknown as { limit: Record<string, number | null>; used: Amount; reserved: Amount };
  if (ledger.limit.tokens != null && ledger.limit.tokens - ledger.used.tokens - ledger.reserved.tokens <= 0) throw new ControlError("group-budget-unavailable", "tokens");
  const work = readWork(store, groupId, taskId) as unknown as ReopenWork;
  if (eligibility === "completed") {
    const acceptance = acceptedRow(store, runId)!;
    store.db.prepare("UPDATE outbox SET body=? WHERE id=? AND kind='acceptance'").run(JSON.stringify({ runId, accepted: false, source: acceptance.source,
      withdrawn: { by: input.by, note: input.note, at: store.now(), commandId: input.commandId } }), `acceptance:${runId}`);
  }
  let freshStart: Amount | null = null;
  if (hasOptionalTaskPolicy(store, groupId, taskId)) {
    // §1.5 (as task retry's fresh start, tester follow-up E §8): the attempts and active time the lineage used beyond
    // every earlier top-up are credited back, within the group's non-token remainder; tokens are never credited.
    const funding = retryFundingOf(store, groupId, taskId, runId);
    if (funding === null) throw new ControlError("recovery-blocked", "reopen-funding-missing");
    const prior = topUpSum(store, groupId, taskId, null), inherited = funding.inherited, handoff = work.grant.handoff;
    const want: Amount = { tokens: 0, sessions: 0, attempts: Math.max(0, inherited.attempts - prior.attempts), activeMs: Math.max(0, inherited.activeMs - prior.activeMs) };
    // Never more than the group's own non-token limits leave the claim (decideFundedAllowance), so the task is never left
    // ready and unclaimable.
    const before = remainingBudget(withTopUp(work.grant.work, prior), inherited), credit: Amount = { ...want };
    for (const d of ["activeMs", "attempts"] as const) credit[d] = Math.min(want[d], Math.max(0, ledger.limit[d]! - ledger.used[d] - ledger.reserved[d] - handoff[d] - before[d]));
    const left = remainingBudget(withTopUp(work.grant.work, add(prior, credit)), inherited);
    const spent = dimensions.filter((d) => left[d] === 0);
    if (spent.length > 0) throw new ControlError("task-not-reopenable", `authored-budget-exhausted:${spent.join(",")}`);
    if (credit.attempts > 0 || credit.activeMs > 0) {
      appendTopUp(store, groupId, taskId, runId, { amount: credit, commandId: input.commandId, by: input.by, personAuthority: false, at: store.now(), kind: "fresh-start" });
      freshStart = credit;
    }
    work.fundingReleased = true;
  } else {
    // A finite-legacy task is re-granted in full, as task retry does; it must fit the group's unallocated reserve.
    const grant = add(work.grant.work, work.grant.handoff), reserve = readBudgetProposal(store, groupId).explicitUnallocatedReserve;
    for (const d of dimensions) {
      if (reserve[d] === null) continue;
      const shortfall = grant[d] - reserve[d]!;
      if (shortfall > 0) throw new ControlError("group-reserve-insufficient", `${d}:${shortfall}`);
    }
    reserveCommitment(store, groupId, grant);
  }
  work.status = "ready";
  work.pendingRunId = null;
  work.reopenNote = { text: input.note, scope: "remaining-attempts" };
  delete work.noChangeCompletion;
  // A person's or an agent's reopen starts the judge's count over; the judge's own re-run sets it again after this.
  delete work.noChangeRerun;
  saveWork(store, groupId, work as never);
  setAllocationStates(store, groupId, taskId, "confirmed");
  const resumed = readGroup(store, groupId);
  if (resumed.status === "done" || resumed.status === "review") { resumed.status = "running"; saveGroup(store, resumed); }
  // The judge's own re-run (by `system`) is recorded by its verdict row (no-change-judged); a person's or an agent's here.
  if (input.by !== "system") recordActivity(store, { groupId, taskId, runId, kind: "no-change-revoked",
    body: { runId, note: input.note, by: input.by, withdrawn: eligibility === "completed", ...(freshStart === null ? {} : { freshStart }) } });
  return { fromRunId: runId, withdrawn: eligibility === "completed" };
}

/** The `reopen-task` verb: a person (`user:<id>` / web) or an orchestrating agent (`agent:<client>`), named on the record. */
export function applyReopenTask(deps: { store: ControlStore; admissionGate?: AdmissionGate }, command: ReopenTaskCommand): CommandSuccessV1 | CommandErrorBodyV1 {
  const release = deps.admissionGate?.enter();
  try {
    return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
      rawCommand: command,
      expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      apply: (context) => {
        const groupId = groupCommandTarget(command);
        const { taskId, runId, note } = command.payload;
        const by = commandPrincipalFor(command.commandId) ?? command.actorId;
        const done = reopenNoChangeTaskInTransaction(deps.store, { groupId, taskId, runId, note, by, commandId: command.commandId });
        return commandSuccess(context, { kind: "task-reopened", taskId, fromRunId: done.fromRunId });
      },
    }).body;
  } finally { release?.(); }
}
