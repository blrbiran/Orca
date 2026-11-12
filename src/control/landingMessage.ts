import { readConfirmedTaskExecution } from "./executionSnapshot.js";
import type { ControlStore } from "./store.js";

/** A landing commit's subject limit (git's conventional 72 columns, counted in code points, as ccloop's attempt commits). */
export const LANDING_SUBJECT_MAX = 72;

/**
 * Tester issue #277: a landing (`land`) or an accepted attempt's merge (`accept`) ends up in the target's history, where
 * `orca: land <runId>` tells a reader nothing. The subject is the task's goal (its confirmed contract's objective.goal) on
 * one line, at most 72 characters (cut with "..."), with `suffix` (a reconciliation's ` (reconciled with <task ids>)`)
 * kept inside the limit; the run id moves to the `Orca-Run` trailer (landingTrailers). A run whose goal cannot be read
 * keeps the old subject. Nothing reads these subjects back: a landing is found by its parents (findLanding).
 */
export function landingSubject(goal: string | null, kind: "land" | "accept", runId: string, suffix = ""): string {
  const line = (goal ?? "").replace(/\s+/g, " ").trim();
  const subject = line === "" ? `orca: ${kind} ${runId}` : line;
  const room = LANDING_SUBJECT_MAX - Array.from(suffix).length;
  const chars = Array.from(subject);
  if (chars.length <= room) return `${subject}${suffix}`;
  if (room <= 3) return `${Array.from(`${subject}${suffix}`).slice(0, LANDING_SUBJECT_MAX - 3).join("").trimEnd()}...`;
  return `${chars.slice(0, room - 3).join("").trimEnd()}...${suffix}`;
}

/** The task's goal as its confirmed contract states it; null for a run with no task or a contract that cannot be read. */
export function taskGoalOf(store: ControlStore, run: { groupId: string; taskId: string | null }): string | null {
  if (run.taskId === null) return null;
  try { return readConfirmedTaskExecution(store, run.groupId, run.taskId).contract.objective.goal; } catch { return null; }
}

/** Tester D10, #277: a landing's body names the group, task and run it lands, so `git log` alone says whose work it is. */
export function landingTrailers(run: { groupId: string; taskId: string | null; runId: string }): string {
  return `Orca-Group: ${run.groupId}${run.taskId === null ? "" : `\nOrca-Task: ${run.taskId}`}\nOrca-Run: ${run.runId}`;
}
