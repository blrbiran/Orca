/**
 * Pre-existing failures spec 2026-11-18 L3 (#341): the `base_check_results` table -- a task's failing required check, run
 * once at its group's base commit, cached by (repository, base commit, command) across groups. Store reads and writes only,
 * so the driver's step C and priorFailures read it without pulling in the runner (baseCheck.ts).
 *
 * A row is asked for (`pending`) only when a task run settles with `required-check-failed` (never before a start: human
 * ruling quoted in the spec); the base run fills it in once. `unknown` is "could not tell" (setup failed, timeout, the base
 * could not be checked out) and claims nothing. Every row names the task run that asked for it, so a later reader (the L2
 * problem row, Task 2) can list it with who and when.
 */
import { isGroupArchived } from "./archivedMark.js";
import { groupRepoId, isDirGroup } from "./dirGroup.js";
import { readConfirmedTaskExecution } from "./executionSnapshot.js";
import { isMultiGroup } from "./multiGroup.js";
import { isDirFlowGroup } from "../flow/groups.js";
import type { ControlStore } from "./store.js";

/** Spec L3, verbatim: the evidence line's prefix; the base run's failure tail follows it. */
export const BASE_CHECK_EVIDENCE_PREFIX = "This check already failed at the group's base, before any change: ";

export type BaseCheckResult = "red" | "green" | "unknown";
export interface BaseCheckKey { repoId: string; base: string; command: string }
export interface BaseCheckRow extends BaseCheckKey {
  result: BaseCheckResult | "pending";
  /** The base run's output tail (red; unknown after a failed setup), else null. */
  tail: string | null;
  /** Why the answer is unknown (`setup-failed`, `timeout`, `error: ...`), else null. */
  why: string | null;
  /** The task run whose `required-check-failed` asked for it. */
  groupId: string; taskId: string; runId: string;
  requestedAt: number;
  /** When the answer was recorded; null while pending. */
  at: number | null;
}

/** The commit the group branched from: the base of its first work run (the rule groupAcceptance and the review use). */
function groupBaseOf(store: ControlStore, groupId: string): string | null {
  for (const row of store.db.prepare("SELECT body FROM runs WHERE group_id=? ORDER BY rowid").all(groupId)) {
    const run = JSON.parse(String(row.body)) as { phase?: unknown; drive?: { base?: unknown } };
    if (run.phase === "work" && typeof run.drive?.base === "string") return run.drive.base;
  }
  return null;
}

/** The group's (repository, base) half of the key; null for a group with no single tree (multi-directory, dir) or no base yet. */
export function baseCheckScopeOf(store: ControlStore, groupId: string): { repoId: string; base: string } | null {
  try {
    if (isMultiGroup(store, groupId) || isDirGroup(store, groupId) || isDirFlowGroup(store, groupId)) return null;
    const base = groupBaseOf(store, groupId);
    return base === null ? null : { repoId: groupRepoId(store, groupId), base };
  } catch { return null; }
}

function rowOf(row: Record<string, unknown>): BaseCheckRow {
  return {
    repoId: String(row.repo_id), base: String(row.base), command: String(row.command), result: String(row.result) as BaseCheckRow["result"],
    tail: row.tail === null ? null : String(row.tail), why: row.why === null ? null : String(row.why),
    groupId: String(row.group_id), taskId: String(row.task_id), runId: String(row.run_id),
    requestedAt: Number(row.requested_at), at: row.at === null ? null : Number(row.at),
  };
}

export function readBaseCheck(store: ControlStore, key: BaseCheckKey): BaseCheckRow | null {
  const row = store.db.prepare("SELECT * FROM base_check_results WHERE repo_id=? AND base=? AND command=?").get(key.repoId, key.base, key.command);
  return row === undefined ? null : rowOf(row);
}

/** Every recorded and pending row, oldest request first (Task 2 lists the red ones as problems). */
export function listBaseChecks(store: ControlStore): BaseCheckRow[] {
  return store.db.prepare("SELECT * FROM base_check_results ORDER BY requested_at, rowid").all().map(rowOf);
}

/**
 * Step C, in the caller's transaction, right after a work run settled failed: when its last rejection is
 * `required-check-failed` on one of its task's confirmed required checks, ask for that command's base run. A triple already
 * asked for or answered is left as it is (the cache: nothing runs twice). Answers whether a row was added.
 */
export function requestBaseCheck(store: ControlStore, run: { groupId: string; taskId: string; runId: string }, last: { rejectCategory: string; failingCommand: string | null } | undefined): boolean {
  if (last === undefined || last.rejectCategory !== "required-check-failed" || last.failingCommand === null) return false;
  const command = last.failingCommand;
  if (isGroupArchived(store, run.groupId)) return false;
  // Only a command the person confirmed as the task's required check is ever run by Orca (never a string from elsewhere).
  if (!readConfirmedTaskExecution(store, run.groupId, run.taskId).contract.verification.requiredChecks.includes(command)) return false;
  const scope = baseCheckScopeOf(store, run.groupId);
  if (scope === null) return false;
  return store.db.prepare("INSERT INTO base_check_results(repo_id,base,command,result,tail,why,group_id,task_id,run_id,requested_at,at) VALUES (?,?,?,'pending',NULL,NULL,?,?,?,?,NULL) ON CONFLICT(repo_id,base,command) DO NOTHING")
    .run(scope.repoId, scope.base, command, run.groupId, run.taskId, run.runId, store.now()).changes > 0;
}

/** The base run's answer, once: a pending row only (a row already answered keeps its answer). */
export function recordBaseCheck(store: ControlStore, key: BaseCheckKey, answer: { result: BaseCheckResult; tail: string | null; why: string | null }): boolean {
  return store.db.prepare("UPDATE base_check_results SET result=?, tail=?, why=?, at=? WHERE repo_id=? AND base=? AND command=? AND result='pending'")
    .run(answer.result, answer.tail, answer.why, store.now(), key.repoId, key.base, key.command).changes > 0;
}

/**
 * priorFailures: the evidence line a failed run of `groupId` carries when `command` was red at the group's base (spec L3),
 * uncut (priorFailures cuts it to the evidence bound); null when it was green, unknown, not yet answered or never asked.
 */
export function baseCheckEvidence(store: ControlStore, groupId: string, command: string): string | null {
  const scope = baseCheckScopeOf(store, groupId);
  if (scope === null) return null;
  const row = readBaseCheck(store, { ...scope, command });
  if (row === null || row.result !== "red") return null;
  return `${BASE_CHECK_EVIDENCE_PREFIX}${row.tail ?? ""}`;
}
