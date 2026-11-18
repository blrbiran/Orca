/**
 * Pre-existing failures spec 2026-11-18 L3 (#341): the base run. A row step C asked for (baseCheckRecord.ts, `pending`) is
 * answered by running that one command at the group's base commit, once, with the same runner and scratch worktrees the
 * group acceptance uses (runOnScratchTip + runCheckSequence), the asking task's setup first and its per-attempt bound on
 * each command. It runs off the driver round, as the acceptance and the landing watch do: the pass starts it and a later
 * round records its answer; stop() aborts it and waits until its worktree is gone, recording nothing (the row stays
 * pending, so the next driver runs it again).
 *
 * The answer is red only when the check itself ran and exited non-zero. A setup that fails, a timeout, a base that cannot
 * be checked out or any other error is `unknown` ("could not tell", review focus 4) -- never red. No retry rule reads it.
 */
import { isGroupArchived } from "./archivedMark.js";
import { listBaseChecks, recordBaseCheck, type BaseCheckKey, type BaseCheckResult, type BaseCheckRow } from "./baseCheckRecord.js";
import { runCheckSequence } from "./checkCommand.js";
import { readConfirmedTaskExecution } from "./executionSnapshot.js";
import { clearGroupFailure, logGroupFailureOnce, nextAcceptancePath, runOnScratchTip, type GroupAcceptanceDeps } from "./groupAcceptance.js";
import { isGroupAcceptancePathOf } from "./workspace.js";
import type { ControlStore } from "./store.js";

export interface BaseCheckAnswer { result: BaseCheckResult; tail: string | null; why: string | null }
/** One base run in flight, by its key; `done` settles once its scratch worktree is removed. */
export interface BaseCheckRun { key: BaseCheckKey; controller: AbortController; settled: { answer: BaseCheckAnswer } | { error: unknown } | null; done: Promise<void> }

const WHY_MAX = 512;
const keyOf = (key: BaseCheckKey): string => JSON.stringify([key.repoId, key.base, key.command]);

/**
 * Runs `command` once at `base` in a scratch worktree of `repo`: setup first, then the check. An abort is thrown (the caller
 * records nothing); every other way it cannot run is an `unknown` answer.
 */
export async function runBaseCheck(deps: GroupAcceptanceDeps, repo: string, row: Pick<BaseCheckRow, "base" | "command" | "groupId">, setup: readonly string[], timeoutMs: number, signal: AbortSignal): Promise<BaseCheckAnswer> {
  const as = { runId: `base-check-${row.groupId}`, ...(deps.dispatchedPersonDir === undefined ? {} : { personDir: deps.dispatchedPersonDir }) };
  try {
    const outcome = await runOnScratchTip(deps, repo, nextAcceptancePath(deps.roots, row.groupId), (name) => isGroupAcceptancePathOf(name, row.groupId), row.base,
      (tree) => runCheckSequence(tree, setup, [row.command], timeoutMs, as, signal));
    const failure = outcome.failure;
    if (failure === null) return { result: "green", tail: null, why: null };
    if (failure.command.startsWith("setup: ")) return { result: "unknown", tail: failure.tail === "" ? null : failure.tail, why: "setup-failed" };
    if (failure.exit.startsWith("timeout")) return { result: "unknown", tail: null, why: "timeout" };
    return { result: "red", tail: failure.tail, why: null };
  } catch (error) {
    if (signal.aborted) throw error;
    return { result: "unknown", tail: null, why: `error: ${error instanceof Error ? error.message : String(error)}`.slice(0, WHY_MAX) };
  }
}

/** The asking task's setup commands and per-attempt bound, from its confirmed contract. */
function taskRunShape(store: ControlStore, row: BaseCheckRow): { setup: string[]; timeoutMs: number } {
  const contract = readConfirmedTaskExecution(store, row.groupId, row.taskId).contract;
  return { setup: [...(contract.context.setupCommands ?? [])], timeoutMs: contract.executionPolicy.perAttemptTimeoutMs };
}

/**
 * One round: records the answers of base runs that finished, then starts one for each pending row not in flight (an archived
 * group's or a stopped group's row waits). Answers whether anything was recorded.
 */
export async function checkBases(deps: GroupAcceptanceDeps, runs: Map<string, BaseCheckRun>): Promise<boolean> {
  const { store } = deps;
  let moved = false;
  for (const [key, inFlight] of [...runs]) {
    if (inFlight.settled === null) continue;
    runs.delete(key);
    // An abort records nothing: the row stays pending for the next driver.
    if ("error" in inFlight.settled) continue;
    const answer = inFlight.settled.answer;
    if (deps.write(() => recordBaseCheck(store, inFlight.key, answer))) moved = true;
  }
  // Read after the answers above: a row answered just now is not pending any more, so it is never started a second time.
  for (const row of listBaseChecks(store).filter((candidate) => candidate.result === "pending")) {
    if (deps.stopped()) break;
    const key = keyOf(row);
    if (runs.has(key)) continue;
    try {
      if (isGroupArchived(store, row.groupId) || store.db.prepare("SELECT 1 FROM stop_intents WHERE group_id=?").get(row.groupId) !== undefined) continue;
      const { setup, timeoutMs } = taskRunShape(store, row);
      const repo = deps.resolveRepository(row.repoId);
      const controller = new AbortController();
      const entry: BaseCheckRun = { key: { repoId: row.repoId, base: row.base, command: row.command }, controller, settled: null, done: Promise.resolve() };
      entry.done = runBaseCheck(deps, repo, row, setup, timeoutMs, controller.signal)
        .then((answer) => { entry.settled = { answer }; }, (error: unknown) => { entry.settled = { error }; });
      runs.set(key, entry);
      clearGroupFailure(runs, "base-check", row.groupId);
    } catch (error) {
      // A contract or repository that does not resolve now: tried again next round, logged once while it repeats.
      logGroupFailureOnce(runs, "base-check", row.groupId, error);
    }
  }
  return moved;
}
