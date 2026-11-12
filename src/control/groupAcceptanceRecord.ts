/**
 * Tester follow-up E §5 (#241): the group acceptance record kept on the group body as `acceptance`, and the predicates the
 * done pass, the integration pass and the views read. Type imports only, so modules on the driver's import cycle can read
 * it without pulling in the acceptance runner (groupAcceptance.ts).
 */
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
}

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
export function acceptanceSatisfied(store: Pick<ControlStore, "db">, groupId: string, body: unknown): boolean {
  const record = acceptanceOf(body);
  if (record?.why === "work-branch-missing" && (body as { status?: unknown }).status === "done") return true;
  if (record !== null && record.why !== "work-branch-missing") return SATISFIED.has(record.result);
  const b = (body ?? {}) as { multiDir?: unknown; dirWorkspace?: unknown };
  if (b.multiDir != null || b.dirWorkspace != null) return true;
  return landedTaskCount(store, groupId) <= 1;
}

/** The command a failed acceptance stopped at (the last one it ran). */
export function failedCommandOf(record: GroupAcceptance): string {
  return record.commands.at(-1)?.command ?? "?";
}

/** The problem a failed acceptance shows (Board, Problems, `group show`); null otherwise. */
export function acceptanceProblem(record: GroupAcceptance | null): string | null {
  return record?.result === "failed" ? `group-acceptance-failed:${failedCommandOf(record)}` : null;
}
