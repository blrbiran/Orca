/**
 * Tester follow-up E §5 (#241): the group acceptance record kept on the group body as `acceptance`, and the predicates the
 * done pass, the integration pass and the views read. Type imports only, so modules on the driver's import cycle can read
 * it without pulling in the acceptance runner (groupAcceptance.ts).
 */
import { fullSuiteCommand } from "./fullSuite.js";
import type { ControlStore } from "./store.js";

export type GroupAcceptanceResult = "passed" | "failed" | "not-needed" | "not-run" | "waived";
export interface GroupAcceptance {
  /** The `orca/<g>` tip the record is for; null for not-run (no single tree). */
  tip: string | null;
  result: GroupAcceptanceResult;
  why?: "single-landing" | "multi-repo" | "dir" | "work-branch-missing";
  /** work-branch-missing (#278): how many runs had landed when the branch was found missing; a later landing checks again. */
  landings?: number;
  /** Every command that ran, setup named `setup: <cmd>`, with its exit and wall-clock ms (driveRecord.ts checkRunCommandSchema). */
  commands: Array<{ command: string; exit: string; ms: number }>;
  /** The failing command's output tail (failed, and waived after it). */
  tail?: string;
  at: number;
  /** waive-acceptance: who accepted the failed tip anyway, and why. */
  waived?: { by: string; note: string; at: number };
  /**
   * Full suite spec 2026-11-12 §4 (#279): the project's full-suite command this acceptance ran after the union (null: none
   * set -- then `suggestion` is what code detected, never run), each run's exit (a red first run is run once more), and
   * whether it passed only on the retry. Absent on records written before it, and on not-run.
   */
  fullSuite?: FullSuiteRecord;
}
export interface FullSuiteRecord { command: string | null; suggestion: string | null; exits: string[]; flaky: boolean }

const SATISFIED: ReadonlySet<GroupAcceptanceResult> = new Set(["passed", "not-needed", "not-run", "waived"]);

export function acceptanceOf(body: unknown): GroupAcceptance | null {
  const value = (body as { acceptance?: unknown } | null)?.acceptance;
  return value === undefined || value === null || typeof value !== "object" ? null : value as GroupAcceptance;
}

/** How many of the group's tasks landed a commit on its branch (any run of the task); a DB read, no git. */
export function landedTaskCount(store: Pick<ControlStore, "db">, groupId: string): number {
  const tasks = new Set<string>();
  for (const row of store.db.prepare("SELECT body FROM runs WHERE group_id=?").all(groupId)) {
    const run = JSON.parse(String(row.body)) as { taskId?: unknown; drive?: { landedCommit?: unknown } };
    if (typeof run.taskId === "string" && typeof run.drive?.landedCommit === "string") tasks.add(run.taskId);
  }
  return tasks.size;
}

/** How many of the group's runs landed a commit (#278: a later landing changes it); a DB read, no git. */
export function landedRunCount(store: Pick<ControlStore, "db">, groupId: string): number {
  let count = 0;
  for (const row of store.db.prepare("SELECT body FROM runs WHERE group_id=?").all(groupId)) {
    if (typeof (JSON.parse(String(row.body)) as { drive?: { landedCommit?: unknown } }).drive?.landedCommit === "string") count += 1;
  }
  return count;
}

/**
 * The gate the done pass, the integration pass and a dependent's prerequisite read (DB only, no git child). A recorded
 * acceptance answers by its result. With none recorded yet, a group that needs none by definition is accepted -- at most
 * one task landed (its own checks ran on that tree), or a multi-directory or folder group (always `not-run`, a known gap)
 * -- and any other group waits for the acceptance pass. A work branch found missing (#278) answers as no record would, and
 * also satisfies a group already `done` (it stays done, and its dependents keep reading it so); any other group that
 * needs an acceptance has no tree to accept and waits.
 */
export function acceptanceSatisfied(store: ControlStore, groupId: string, body: unknown): boolean {
  const record = acceptanceOf(body);
  if (record?.why === "work-branch-missing" && (body as { status?: unknown }).status === "done") return true;
  if (record !== null && record.why !== "work-branch-missing") return SATISFIED.has(record.result);
  const b = (body ?? {}) as { multiDir?: unknown; dirWorkspace?: unknown; plan?: { repoId?: unknown } };
  if (b.multiDir != null || b.dirWorkspace != null) return true;
  const landed = landedTaskCount(store, groupId);
  // Full suite spec §4: with a full-suite command set, one landing waits for the acceptance too. Settings that cannot be
  // read wait as well: the acceptance pass names that error every round (groupAcceptance.ts acceptGroups).
  let suite: string | null;
  try { suite = typeof b.plan?.repoId === "string" ? fullSuiteCommand(store, b.plan.repoId) : null; } catch { return false; }
  return landed <= maxLandingsWithoutAcceptance(suite);
}

/**
 * Full suite spec §4: the most landings a group may have and still need no acceptance -- one (its own checks ran on that
 * tree), or none once the project has a full-suite command (the suite ran on no task's tree).
 */
export function maxLandingsWithoutAcceptance(suite: string | null): number {
  return suite === null ? 1 : 0;
}

/** Full suite spec §5: the warning a recorded acceptance gives about its full suite (never a blocking problem); else null. */
export function fullSuiteWarning(record: GroupAcceptance | null): string | null {
  const suite = record?.fullSuite;
  if (record === null || record.result === "failed") return null;
  // Tester follow-up K, item 2: a passed (or not-needed) record written before the full suite existed ran none either --
  // read as not set. A waived or not-run record without the field never had a suite to run, so it says nothing.
  if (suite === undefined) return record.result === "passed" || record.result === "not-needed" ? "full-suite-not-set" : null;
  if (suite.command === null) return "full-suite-not-set";
  return suite.flaky ? `full-suite-flaky:${suite.command}` : null;
}

/** The command a failed acceptance stopped at (the last one it ran). */
export function failedCommandOf(record: GroupAcceptance): string {
  return record.commands.at(-1)?.command ?? "?";
}

/** The problem a failed acceptance shows (Board, Problems, `group show`); null otherwise. */
export function acceptanceProblem(record: GroupAcceptance | null): string | null {
  return record?.result === "failed" ? `group-acceptance-failed:${failedCommandOf(record)}` : null;
}
