import type { AdmissionGate } from "./admissionGate.js";
import type { DriveRecord } from "./driveRecord.js";
import type { ControlStore } from "./store.js";
import type { Amount } from "./types.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";
import { recordActivity } from "./activity.js";
import { add } from "./budget.js";
import { applyWebCommand } from "./commandLedger.js";
import { dimensions } from "./commands.js";
import { ControlError } from "./errors.js";
import { readBudgetProposal, readWork, saveWork } from "./queries.js";
import {
  ADOPTABLE_STATES, commandSuccess, groupCommandTarget, latestRequestForRun, readGroupBody, readRunBody, readStopIntent, releaseCommitment,
  reserveCommitment, saveRunBody,
} from "./stopIntent.js";

/**
 * Issue fixes spec §4.2(2) (human ruling H2): a task whose current run ccloop ended failed is started again. In one
 * transaction the failed run is settled `settled-failed` (inactive; its booked usage stays, its remainder is released and
 * the task's grant re-reserved, so the allocation stays `confirmed` at its grant), the task returns to `ready` with
 * `currentRunId` still on that run (the view requires it to be the task's last run row until the next claim replaces it),
 * and the driver is left to archive and clean it (`drive.cleanedUp` false). Normal dispatch then claims the task from the
 * group branch's current head (H3); nothing here arms a wake -- the driver's replenishStartWakes does.
 * The run's endedAt and its `run-settled` row come from saveRunBody's noteRunWrite (activity.ts RUN_ENDED_STATES).
 */
export type RetryTaskCommand = Extract<RawAuthorityCommandV1, { verb: "retry-task" }>;
export type RetryTaskResult = CommandSuccessV1 | CommandErrorBodyV1;
export interface RetryTaskDeps { store: ControlStore; admissionGate?: AdmissionGate; beforeCommit?: () => void }

interface RetriedWork { workItemId: string; status: string; currentRunId?: string | null; grant: { work: Amount; handoff: Amount } }

/** A grant-shaped pair summed per dimension: what the group's committed amount holds for it. */
const both = (amount: { work: Amount; handoff: Amount }): Amount => add(amount.work, amount.handoff);

export function applyRetryTask(deps: RetryTaskDeps, command: RetryTaskCommand): RetryTaskResult {
  const { store } = deps;
  const release = deps.admissionGate?.enter();
  try {
    return applyWebCommand<RetryTaskResult>(store, {
      rawCommand: command,
      expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      apply: context => {
        const groupId = groupCommandTarget(command);
        const taskId = command.payload.taskId;
        // Spec §4.2(2), in the spec's order. Archived groups are refused by Part E (group-archived).
        const group = readGroupBody(store, groupId);
        if (group.status === "clarifying") throw new ControlError("group-state-invalid", "clarifying");
        if (group.stopped || readStopIntent(store, groupId) !== null) throw new ControlError("stop-mode-conflict");
        const work = readWork(store, groupId, taskId) as unknown as RetriedWork;
        if (typeof work.currentRunId !== "string") throw new ControlError("task-not-retryable", "no-run");
        const runId = work.currentRunId;
        const run = readRunBody(store, runId);
        const live = Number(store.db.prepare("SELECT active FROM runs WHERE id=?").get(runId)?.active ?? 0) === 1;
        if (!live || run.state !== "blocked") throw new ControlError("task-not-retryable", `run-state:${run.state}`);
        const drive = run.drive as DriveRecord | undefined;
        if (drive === undefined || drive.blockedAt !== "C") throw new ControlError("task-not-retryable", `blocked-at:${drive?.blockedAt ?? "none"}`);
        // A codex-skills-* failure sets an outcome too (review C3), so it is retryable like any other ccloop failure.
        if (drive.outcome === null || drive.outcome === "succeeded") throw new ControlError("task-not-retryable", `outcome:${drive.outcome ?? "none"}`);
        // releaseRunReserve's conditions (budget.ts): no request still owns the run, and its usage is known and complete.
        const request = latestRequestForRun(store, groupId, runId);
        if (request !== null && ADOPTABLE_STATES.includes(request.state)) throw new ControlError("task-not-retryable", `handoff-request-open:${request.requestId}`);
        if (run.unknown.work || run.unknown.handoff) throw new ControlError("task-not-retryable", "usage-unknown");
        if (store.db.prepare("SELECT seq FROM usage_events WHERE run_id=? AND seq>?").get(runId, Number(run.highWater))) throw new ControlError("task-not-retryable", "usage-pending");
        // The new run is claimed at the task's current grant (after a continuation, the continuation's), so the net new
        // reservation is grant - remainder in each dimension; it must fit the group's unallocated reserve.
        const grant = both(work.grant), remaining = both(run.remaining);
        const reserve = readBudgetProposal(store, groupId).explicitUnallocatedReserve;
        for (const d of dimensions) {
          const shortfall = grant[d] - remaining[d] - reserve[d];
          if (shortfall > 0) throw new ControlError("group-reserve-insufficient", `${d}:${shortfall}`);
        }
        // Effect 1: the run alone moves; `remaining` stays on it (the view checks remaining == max(grant - cumulative, 0)).
        saveRunBody(store, { ...run, state: "settled-failed", drive: { ...drive, cleanedUp: false } }, false);
        releaseCommitment(store, groupId, remaining);
        reserveCommitment(store, groupId, grant);
        // Effect 2.
        work.status = "ready";
        saveWork(store, groupId, work as never);
        // Effect 4 (the command revision advances in applyWebCommand).
        recordActivity(store, { groupId, taskId, runId, kind: "task-retried", body: { fromRunId: runId } });
        deps.beforeCommit?.();
        return commandSuccess(context, { kind: "task-retried", taskId, fromRunId: runId });
      },
    }).body;
  } finally { release?.(); }
}
