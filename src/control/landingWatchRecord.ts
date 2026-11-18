/**
 * Tester follow-up G §6.2 (#269): the landing watch's record, kept on the group body as `landingWatch`, and the pure
 * green-to-red rule. Type imports only (as groupAcceptanceRecord.ts), so the views read it without the runner.
 *
 * Controller's calls (plan Part D, A4/A5): the first watch of a group records states only -- a check red there was never
 * green, so it is no regression. A setup failure leaves the checks unrun; they keep their previous state. A regression
 * names the tasks whose landings the previous record did not cover, keeps that first attribution while it stays red, and
 * clears when the check is green again.
 */
import type { EveryCheckOutcome } from "./checkCommand.js";
import type { ControlStore } from "./store.js";

export type CheckState = "green" | "red" | "not-run";
export interface LandingRegression { command: string; landedTaskIds: string[]; tip: string; exit: string; tail?: string; since: number }
export interface LandingWatch {
  /** The `orca/<g>` tip the watch ran on. */
  tip: string;
  at: number;
  /** Every landed run the record accounts for: a later landing is one not in this list. */
  coveredRunIds: string[];
  commands: EveryCheckOutcome["commands"];
  states: Record<string, CheckState>;
  regressions: LandingRegression[];
}

export function landingWatchOf(body: unknown): LandingWatch | null {
  const value = (body as { landingWatch?: unknown } | null)?.landingWatch;
  return value === undefined || value === null || typeof value !== "object" ? null : value as LandingWatch;
}

export function nextLandingWatch(previous: LandingWatch | null, run: { tip: string; at: number; coveredRunIds: string[]; landedTaskIds: string[]; outcome: EveryCheckOutcome }): { record: LandingWatch; turnedRed: LandingRegression[]; turnedGreen: string[] } {
  const states: Record<string, CheckState> = { ...(previous?.states ?? {}) };
  for (const command of run.outcome.commands) states[command.command] = command.exit === "0" ? "green" : "red";
  const turnedRed: LandingRegression[] = [];
  const turnedGreen: string[] = [];
  const regressions: LandingRegression[] = [];
  for (const kept of previous?.regressions ?? []) {
    if (states[kept.command] === "green") turnedGreen.push(kept.command); else regressions.push(kept);
  }
  for (const command of run.outcome.commands) {
    if (command.exit === "0" || previous?.states[command.command] !== "green") continue;
    if (regressions.some((regression) => regression.command === command.command)) continue;
    const regression: LandingRegression = { command: command.command, landedTaskIds: [...run.landedTaskIds], tip: run.tip, exit: command.exit, ...(command.tail === undefined || command.tail === "" ? {} : { tail: command.tail }), since: run.at };
    turnedRed.push(regression);
    regressions.push(regression);
  }
  return { record: { tip: run.tip, at: run.at, coveredRunIds: [...run.coveredRunIds], commands: run.outcome.commands, states, regressions }, turnedRed, turnedGreen };
}

/** The problems a record shows (Problems, `group show`): one per regression. */
export function landingRegressionProblems(record: LandingWatch | null): string[] {
  return (record?.regressions ?? []).map((regression) => `landing-regression:${regression.command}`);
}

/** The group's task runs that landed a commit on its branch, in run order: runId and taskId. */
export function landedRuns(store: ControlStore, groupId: string): Array<{ runId: string; taskId: string }> {
  const landed: Array<{ runId: string; taskId: string }> = [];
  for (const row of store.db.prepare("SELECT id, body FROM runs WHERE group_id=? ORDER BY rowid").all(groupId)) {
    const run = JSON.parse(String(row.body)) as { taskId?: unknown; drive?: { landedCommit?: unknown } };
    if (typeof run.taskId === "string" && typeof run.drive?.landedCommit === "string") landed.push({ runId: String(row.id), taskId: run.taskId });
  }
  return landed;
}

function taskIdsOf(store: ControlStore, groupId: string): string[] {
  return store.db.prepare("SELECT body FROM work_items WHERE group_id=?").all(groupId)
    .map((row) => JSON.parse(String(row.body)) as { kind?: string; taskId?: unknown })
    .filter((work) => work.kind === "task" && typeof work.taskId === "string").map((work) => work.taskId as string);
}

function allTasksDone(store: ControlStore, groupId: string): boolean {
  const tasks = store.db.prepare("SELECT body FROM work_items WHERE group_id=?").all(groupId)
    .map((row) => JSON.parse(String(row.body)) as { kind?: string; status?: string }).filter((work) => work.kind === "task");
  return tasks.length > 0 && tasks.every((work) => work.status === "done");
}

/**
 * The watch's own stop rule (landingWatch.ts watchLandings): every task done, or every task landed -- nothing is left to
 * land after this tip, and the group acceptance checks the final tip. Tester #371 review (I5): the views read the same rule,
 * so a watch the acceptance took over stays taken over while that acceptance reruns, and one that runs again (a task
 * appended after the acceptance) shows its regressions again. DB reads only.
 */
export function watchHasNothingLeft(store: ControlStore, groupId: string): boolean {
  if (allTasksDone(store, groupId)) return true;
  const landed = landedRuns(store, groupId);
  return taskIdsOf(store, groupId).every((taskId) => landed.some((run) => run.taskId === taskId));
}
