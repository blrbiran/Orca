import { recordActivity } from "./activity.js";
import { syncWebBudget } from "./budget.js";
import type { ExecutionReport } from "./executionPort.js";
import { groupHeadroom, pauseLineOf, pauseStateOf, syncCeilingReserve } from "./liveCeiling.js";
import { readGroup, readWork, saveGroup, saveWork } from "./queries.js";
import type { ControlStore } from "./store.js";
import type { AdmissionGate } from "./admissionGate.js";
import { applyWebCommand } from "./commandLedger.js";
import { commandPrincipalFor } from "./commandClient.js";
import { ControlError } from "./errors.js";
import { PAUSE_LINE_MULTIPLE, pauseLineFor, taskExpectation } from "./expectationModel.js";
import { refuseClarifying } from "./requirementRecords.js";
import { commandSuccess, readStopIntent } from "./stopIntent.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";

/**
 * Tester follow-up G spec §2.1 / §2.5 (plan Part B, O4, D3): what a run ccloop stopped at its live ceiling becomes. The run
 * is settled recoverable with its work (the caller committed its partial candidate), and its task continues from that
 * checkpoint on its next claim -- the allowance path's mechanism (`allowancePredecessorRunId`), so a continuation keeps
 * the stopped run's work:
 * - cause `group`: with at least AUTO_CONTINUE_MIN_TOKENS of free headroom the task is ready again at once; below that it
 *   waits as `groupCapStop` until a person tops the group up (webService setLimit), so a claim never starts with a ceiling
 *   too small to do anything;
 * - cause `pause-line`: the task waits as `usagePause` for a person or an orchestrating agent to continue or stop it.
 * A `task-cap` stop (a person's hard cap) is not routed here: it ends exhausted as today, with no pause line (§10.3).
 */
export const AUTO_CONTINUE_MIN_TOKENS = 1_000_000;
export type CeilingStop = NonNullable<ExecutionReport["liveCeilingStop"]>;
export type CeilingStopOutcome = "auto-continued" | "group-cap-reached" | "usage-paused";

/** Every work token the task's runs have used (all of them are settled when this is read). */
export function taskWorkTokens(store: ControlStore, groupId: string, workItemId: string): number {
  let tokens = 0;
  for (const row of store.db.prepare("SELECT body FROM runs WHERE group_id=? AND work_item_id=?").all(groupId, workItemId)) {
    tokens += (JSON.parse(String(row.body)) as { cumulative?: { work?: { tokens?: number } } }).cumulative?.work?.tokens ?? 0;
  }
  return tokens;
}

/** One decimal: 3.24 -> 3.2. */
export const ratioOf = (used: number, expected: number): number => Math.round((used / expected) * 10) / 10;

/** Call inside the settle transaction, after the stopped run is settled recoverable and inactive. */
export function classifyCeilingStop(store: ControlStore, run: { runId: string; groupId: string; workItemId: string; taskId: string | null }, stop: CeilingStop, at: number): CeilingStopOutcome {
  const group = readGroup(store, run.groupId);
  // The stopped run's outstanding ceiling goes back to the group first, so the headroom read below is the real one.
  syncCeilingReserve(store, group);
  syncWebBudget(store, group, null);
  saveGroup(store, group);
  const work = readWork(store, run.groupId, run.workItemId) as unknown as Record<string, unknown> & { status: string };
  work.allowancePredecessorRunId = run.runId;
  work.fundingReleased = true;
  const stopped = group.stopped || store.db.prepare("SELECT group_id FROM stop_intents WHERE group_id=?").get(run.groupId) !== undefined;
  let outcome: CeilingStopOutcome;
  if (stop.cause === "pause-line") {
    const line = pauseLineOf(store, group, work as never);
    const usedTokens = taskWorkTokens(store, run.groupId, run.workItemId);
    const expectationTokens = line?.expectationTokens ?? null;
    work.status = "blocked";
    work.usagePause = { line: line?.line ?? stop.tokens, multiple: line?.multiple ?? 1, usedTokens, expectationTokens, runId: run.runId, at };
    recordActivity(store, { groupId: run.groupId, taskId: run.taskId, runId: run.runId, kind: "usage-paused",
      body: { usedTokens, expectationTokens, ratio: expectationTokens === null ? null : ratioOf(usedTokens, expectationTokens), line: line?.line ?? stop.tokens, phase: stop.phase, at: stop.at } });
    outcome = "usage-paused";
  } else {
    const headroom = groupHeadroom(group);
    const autoContinued = !stopped && (headroom === null || headroom >= AUTO_CONTINUE_MIN_TOKENS);
    if (autoContinued) { work.status = "ready"; delete work.groupCapStop; }
    else { work.status = "blocked"; work.groupCapStop = { runId: run.runId, at, observedTokens: stop.observedTokens }; }
    recordActivity(store, { groupId: run.groupId, taskId: run.taskId, runId: run.runId, kind: "group-cap-reached",
      body: { observedTokens: stop.observedTokens, ceilingTokens: stop.tokens, headroomTokens: headroom, autoContinued, phase: stop.phase, at: stop.at } });
    outcome = autoContinued ? "auto-continued" : "group-cap-reached";
  }
  saveWork(store, run.groupId, work as never);
  const after = readGroup(store, run.groupId);
  if (!after.stopped && (after as { status?: string }).status !== "blocked") { (after as { status?: string }).status = "running"; saveGroup(store, after); }
  return outcome;
}

export type UsagePauseDecideCommand = Extract<RawAuthorityCommandV1, { verb: "usage-pause-decide" }>;

/**
 * Spec §2.5 (plan O5): a person or an orchestrating agent decides on a task waiting at its pause line.
 * - continue: the next line is pauseLineFor's next multiple (expectationModel.ts states the formula) -- tester #305: at
 *   least the first multiple above what the task used -- refused usage-pause-group-headroom (naming group set-limit) when
 *   half the group's remainder would not let the task use one more token, usage-pause-no-headroom when the task has no
 *   expectation; the task is ready again and continues
 *   from its stopped run, the optional note delivered to that run as its operator note. Tester follow-up I (seat L): it
 *   resumes that run's checkpoint only when the checkpoint is complete; a run stopped mid-phase starts afresh (stepA2).
 * - stop: the task ends stopped (`usageStopped`, still blocked); the group and its other tasks go on.
 */
export function applyUsagePauseDecide(deps: { store: ControlStore; admissionGate?: AdmissionGate }, command: UsagePauseDecideCommand): CommandSuccessV1 | CommandErrorBodyV1 {
  const { store } = deps;
  const release = deps.admissionGate?.enter();
  try {
    return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(store, {
      rawCommand: command,
      expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      apply: context => {
        if (command.target.kind !== "task") throw new ControlError("control-target-not-allowed");
        const { groupId, taskId } = command.target;
        refuseClarifying(store, groupId);
        const group = readGroup(store, groupId);
        if (group.stopped || readStopIntent(store, groupId) !== null) throw new ControlError("group-stopped");
        const work = readWork(store, groupId, taskId) as unknown as Record<string, unknown> & { status: string; usagePause?: { expectationTokens: number | null } };
        if (work.usagePause === undefined || work.status !== "blocked") throw new ControlError("usage-pause-not-waiting", taskId);
        const principal = commandPrincipalFor(command.commandId) ?? command.actorId;
        const at = store.now();
        const { decision, note } = command.payload;
        let nextLine: number | null = null;
        if (decision === "continue") {
          const expectation = work.usagePause.expectationTokens ?? taskExpectation(store, groupId, work as never)?.tokens ?? null;
          if (expectation === null) throw new ControlError("usage-pause-no-headroom", "no-expectation");
          const state = pauseStateOf(work);
          const used = taskWorkTokens(store, groupId, taskId);
          const groupUsed = group.used.tokens;
          // Tester #305 (follow-up J): a run that overshot its line (ccloop stops at a phase boundary or between turns)
          // may have used more than the next multiple too, and that line was then refused for good. The next line is the
          // next multiple and at least the first one above what the task used: k = max(k + 1, floor(used / 10E) + 1).
          const multiple = Math.max(state.multiple + 1, Math.floor(used / (PAUSE_LINE_MULTIPLE * expectation)) + 1);
          nextLine = pauseLineFor({ expectationTokens: expectation, multiple, groupLimitTokens: (group.limit as { tokens: number | null }).tokens, taskUsedAtDecision: used, groupUsedAtDecision: groupUsed });
          // Only half the group's remainder can still hold the line at or below what the task used: the group needs more.
          if (nextLine <= used) throw new ControlError("usage-pause-group-headroom", `${nextLine}<=${used}:orca group set-limit ${groupId} --limit <a higher limit>`);
          work.pauseLine = { multiple, taskUsedAtDecision: used, groupUsedAtDecision: groupUsed };
          delete work.usagePause;
          work.status = "ready";
          if (note !== undefined) work.pendingOperatorNote = note; else delete work.pendingOperatorNote;
        } else {
          delete work.usagePause;
          work.usageStopped = { at, principal, ...(note === undefined ? {} : { note: note.text }) };
        }
        saveWork(store, groupId, work as never);
        recordActivity(store, { groupId, taskId, kind: "usage-pause-decided", body: { decision, nextLine, principal } });
        return commandSuccess(context, { kind: "usage-pause-decided", taskId, decision, nextLine });
      },
    }).body;
  } finally { release?.(); }
}

/**
 * Spec §2.1 "after the person tops up the group, tasks continue": inside set-limit's transaction, every task of the group
 * waiting at the group cap is ready again (it continues from its stopped run on its next claim). Answers their ids.
 */
export function continueGroupCapStops(store: ControlStore, groupId: string): string[] {
  const continued: string[] = [];
  for (const row of store.db.prepare("SELECT id,body FROM work_items WHERE group_id=? ORDER BY id").all(groupId)) {
    const work = JSON.parse(String(row.body)) as Record<string, unknown> & { status: string };
    if (work.groupCapStop === undefined || work.status !== "blocked") continue;
    delete work.groupCapStop;
    work.status = "ready";
    saveWork(store, groupId, work as never);
    continued.push(String(row.id));
  }
  return continued;
}
