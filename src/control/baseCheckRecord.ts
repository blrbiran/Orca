/**
 * Pre-existing failures spec 2026-11-18 L3 (#341): the `base_check_results` table -- a task's failing required check, run
 * once at its group's base commit, cached by (repository, base commit, command) across groups. Store reads and writes only,
 * so the driver's step C and priorFailures read it without pulling in the runner (baseCheck.ts).
 *
 * A row is asked for (`pending`) only when a task run settles with `required-check-failed` (never before a start: human
 * ruling quoted in the spec); the base run fills it in once. `unknown` is "could not tell" (setup failed, timeout, not
 * runnable, the base could not be checked out) and claims nothing. Every row names the newest task run that asked for it,
 * so a later reader (the L2 problem row, Task 2) can list it with who and when.
 */
import { isGroupArchived } from "./archivedMark.js";
import { groupRepoId, isDirGroup } from "./dirGroup.js";
import { readConfirmedTaskExecution } from "./executionSnapshot.js";
import { groupBaseCommit } from "./groupAcceptanceRecord.js";
import { isMultiGroup } from "./multiGroup.js";
import { isDirFlowGroup } from "../flow/groups.js";
import type { ControlStore } from "./store.js";

/** Spec L3, verbatim: the evidence line's prefix; the base run's failure tail follows it. */
export const BASE_CHECK_EVIDENCE_PREFIX = "This check already failed at the group's base, before any change: ";
/** Task 3 review I-2: an `error:` unknown is run again for a different asker until the row has had this many base runs. */
export const BASE_CHECK_MAX_ATTEMPTS = 2;

export type BaseCheckResult = "red" | "green" | "unknown";
export interface BaseCheckKey { repoId: string; base: string; command: string }
export interface BaseCheckRow extends BaseCheckKey {
  result: BaseCheckResult | "pending";
  /** The base run's output tail (red; unknown after a failed setup), else null. */
  tail: string | null;
  /** Why the answer is unknown (`setup-failed`, `timeout`, `not-runnable`, `error: ...`), else null. */
  why: string | null;
  /** The newest task run whose `required-check-failed` asked for it (Task 3 review I-1: the newest asker owns a pending row). */
  groupId: string; taskId: string; runId: string;
  requestedAt: number;
  /** When the answer was recorded; null while pending. */
  at: number | null;
  /** Base runs asked for this row, the first included. */
  attempts: number;
}

/** The group's (repository, base) half of the key; null for a group with no single tree (multi-directory, dir) or no base yet. */
export function baseCheckScopeOf(store: ControlStore, groupId: string): { repoId: string; base: string } | null {
  try {
    if (isMultiGroup(store, groupId) || isDirGroup(store, groupId) || isDirFlowGroup(store, groupId)) return null;
    const base = groupBaseCommit(store, groupId);
    return base === null ? null : { repoId: groupRepoId(store, groupId), base };
  } catch { return null; }
}

function rowOf(row: Record<string, unknown>): BaseCheckRow {
  return {
    repoId: String(row.repo_id), base: String(row.base), command: String(row.command), result: String(row.result) as BaseCheckRow["result"],
    tail: row.tail === null ? null : String(row.tail), why: row.why === null ? null : String(row.why),
    groupId: String(row.group_id), taskId: String(row.task_id), runId: String(row.run_id),
    requestedAt: Number(row.requested_at), at: row.at === null ? null : Number(row.at), attempts: Number(row.attempts),
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

/** Spec L4: the commands answered red or green at exactly (repository, base), oldest answer first (a primary-key prefix read). */
export function answeredBaseChecksAt(store: ControlStore, repoId: string, base: string): BaseCheckRow[] {
  return store.db.prepare("SELECT * FROM base_check_results WHERE repo_id=? AND base=? AND result IN ('red','green') ORDER BY at, rowid").all(repoId, base).map(rowOf);
}

/** The rows waiting for a base run, oldest request first. */
export function pendingBaseChecks(store: ControlStore): BaseCheckRow[] {
  return store.db.prepare("SELECT * FROM base_check_results WHERE result='pending' ORDER BY requested_at, rowid").all().map(rowOf);
}

/**
 * Step C, in the caller's transaction, right after a work run settled failed: when its last rejection is
 * `required-check-failed` on one of its task's confirmed required checks, ask for that command's base run. A saved-result
 * verification or a recovery run asks nothing (it re-verifies a saved result; its task's own run asked already). Already
 * pending: this run becomes its asker (I-1, so an archived or stopped asker never holds the triple for every group). An
 * `error:` unknown asked by a different run is asked again while under BASE_CHECK_MAX_ATTEMPTS (I-2). Any other answer
 * stands (the cache: nothing runs twice). Answers whether the row is now pending for this run.
 */
export function requestBaseCheck(store: ControlStore, run: { groupId: string; taskId: string; runId: string; mode?: unknown; recoveryOf?: unknown }, last: { rejectCategory: string; failingCommand: string | null } | undefined): boolean {
  if (run.mode !== undefined || run.recoveryOf !== undefined) return false;
  if (last === undefined || last.rejectCategory !== "required-check-failed" || last.failingCommand === null) return false;
  const command = last.failingCommand;
  if (isGroupArchived(store, run.groupId)) return false;
  // Only a command the person confirmed as the task's required check is ever run by Orca (never a string from elsewhere).
  if (!readConfirmedTaskExecution(store, run.groupId, run.taskId).contract.verification.requiredChecks.includes(command)) return false;
  const scope = baseCheckScopeOf(store, run.groupId);
  if (scope === null) return false;
  return store.db.prepare(`INSERT INTO base_check_results(repo_id,base,command,result,tail,why,group_id,task_id,run_id,requested_at,at,attempts)
      VALUES (?,?,?,'pending',NULL,NULL,?,?,?,?,NULL,1)
    ON CONFLICT(repo_id,base,command) DO UPDATE SET
      attempts = attempts + (CASE WHEN result='unknown' THEN 1 ELSE 0 END),
      result='pending', tail=NULL, why=NULL, at=NULL,
      group_id=excluded.group_id, task_id=excluded.task_id, run_id=excluded.run_id, requested_at=excluded.requested_at
    WHERE result='pending'
      OR (result='unknown' AND why LIKE 'error:%' AND attempts < ${BASE_CHECK_MAX_ATTEMPTS} AND run_id <> excluded.run_id)`)
    .run(scope.repoId, scope.base, command, run.groupId, run.taskId, run.runId, store.now()).changes > 0;
}

/** The base run's answer, once: a pending row only (a row already answered keeps its answer). */
export function recordBaseCheck(store: ControlStore, key: BaseCheckKey, answer: { result: BaseCheckResult; tail: string | null; why: string | null }): boolean {
  return store.db.prepare("UPDATE base_check_results SET result=?, tail=?, why=?, at=? WHERE repo_id=? AND base=? AND command=? AND result='pending'")
    .run(answer.result, answer.tail, answer.why, store.now(), key.repoId, key.base, key.command).changes > 0;
}

/**
 * The spec's line for a red tail, within `maxBytes` UTF-8 bytes. The tail is cut from its front (Task 3 review M-1): a
 * failure's end is where the error usually is, so the end survives and an `…[N bytes omitted]` marker says what went.
 */
export function baseCheckLine(tail: string, maxBytes: number): string {
  const room = maxBytes - Buffer.byteLength(BASE_CHECK_EVIDENCE_PREFIX, "utf8");
  const bytes = Buffer.from(tail, "utf8");
  if (bytes.length <= room) return `${BASE_CHECK_EVIDENCE_PREFIX}${tail}`;
  // The marker's length depends on the count it names; grow the cut until marker and kept end fit.
  for (let cut = bytes.length - room; cut <= bytes.length; cut += 1) {
    let start = cut;
    while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start += 1;
    const marker = `…[${start} bytes omitted]`;
    if (Buffer.byteLength(marker, "utf8") + bytes.length - start <= room) return `${BASE_CHECK_EVIDENCE_PREFIX}${marker}${bytes.subarray(start).toString("utf8")}`;
  }
  return BASE_CHECK_EVIDENCE_PREFIX.slice(0, maxBytes);
}

/**
 * priorFailures: the evidence line a failed run of `groupId` carries when `command` was red at the group's base (spec L3),
 * within `maxBytes`; null when it was green, unknown, not yet answered or never asked.
 */
export function baseCheckEvidence(store: ControlStore, groupId: string, command: string, maxBytes: number): string | null {
  const scope = baseCheckScopeOf(store, groupId);
  if (scope === null) return null;
  const row = readBaseCheck(store, { ...scope, command });
  if (row === null || row.result !== "red") return null;
  return baseCheckLine(row.tail ?? "", maxBytes);
}
