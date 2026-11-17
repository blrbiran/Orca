import { contains } from "../scheduler/pathTrie.js";
import { git } from "../scheduler/gitExec.js";
import { normalizeClaim } from "../scheduler/writeSet.js";
import { recordActivity } from "./activity.js";
import { readConfirmedTaskExecution } from "./executionSnapshot.js";
import type { ControlStore } from "./store.js";
import { QUIET_GIT } from "./workspace.js";

/**
 * Off-plan writes spec W3 (#346): when a run lands, the paths its attempt changed outside its task's targetPaths are
 * recorded -- one `off-plan-write` activity row, in the transaction that makes the run `landed`. Information only: it
 * never fails or blocks a landing and never feeds back into the plan.
 */
export const OFF_PLAN_PATHS_MAX = 64;
export interface OffPlanWrite { paths: string[]; count: number }
export interface OffPlanWriteBody extends OffPlanWrite { taskId: string; runId: string }

/** `.decisions/` is the ledger Orca itself writes into every landing; it is never the agent's off-plan write. */
const LEDGER_DIR = ".decisions";

/** The changed paths no target covers (segment containment under normalizeClaim, as the write-set rules compare), sorted. */
export function offPlanPaths(changed: readonly string[], targetPaths: readonly string[]): string[] {
  const targets = targetPaths.map((path) => normalizeClaim(path).normalized);
  return changed
    .filter((path) => !contains(LEDGER_DIR, path))
    .filter((path) => !targets.some((target) => contains(target, path)))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * What `base..attempt` changed outside `targetPaths`, the paths capped at OFF_PLAN_PATHS_MAX and the count whole; null
 * when nothing is off-plan. A range git cannot read is no record (logged), never an error: the landing does not wait on it.
 */
export async function offPlanWriteOf(repo: string, base: string, attempt: string, targetPaths: readonly string[]): Promise<OffPlanWrite | null> {
  let changed: string[];
  try {
    // --no-renames: a moved file is a deletion and an addition, and both paths are writes.
    changed = (await git(repo, [...QUIET_GIT, "diff", "--name-only", "-z", "--no-renames", base, attempt], { maxBuffer: 256 * 1024 * 1024 }))
      .split("\0").filter((path) => path.length > 0);
  } catch (error) {
    process.stderr.write(`orca-driver: off-plan record skipped for ${attempt}: ${error instanceof Error ? error.message : String(error)}\n`);
    return null;
  }
  const paths = offPlanPaths(changed, targetPaths);
  return paths.length === 0 ? null : { paths: paths.slice(0, OFF_PLAN_PATHS_MAX), count: paths.length };
}

/**
 * A landing run's record, read against its task's frozen contract: the contract's own targetPaths, which belong to the
 * task's primary repository (a multi-directory task's first written directory). An extra directory's writes are not
 * compared -- a known limitation, recorded here. Null for a run with no task or no attempt range.
 */
export async function landingOffPlanWrite(
  store: ControlStore, run: { groupId: string; taskId: string | null; runId: string }, repo: string, base: string | null | undefined, attempt: string | null | undefined,
): Promise<OffPlanWriteBody | null> {
  if (run.taskId === null || base == null || attempt == null) return null;
  const { contract } = readConfirmedTaskExecution(store, run.groupId, run.taskId);
  const record = await offPlanWriteOf(repo, base, attempt, contract.context.targetPaths);
  return record === null ? null : { taskId: run.taskId, runId: run.runId, ...record };
}

/** The row, inside the caller's landing transaction. */
export function recordOffPlanWrite(store: ControlStore, groupId: string, body: OffPlanWriteBody): void {
  recordActivity(store, { groupId, taskId: body.taskId, runId: body.runId, kind: "off-plan-write", body: { ...body } });
}

/** A group's records by run (a run lands once; a later row of the same run would replace an earlier). */
export function readOffPlanWritesByRun(store: ControlStore, groupId: string): Map<string, OffPlanWriteBody> {
  const rows = store.db.prepare("SELECT body FROM activity WHERE group_id=? AND kind='off-plan-write' ORDER BY seq").all(groupId);
  return new Map(rows.map((row) => { const body = JSON.parse(String(row.body)) as OffPlanWriteBody; return [body.runId, body]; }));
}

/** One line: the kept paths, then how many more the record counted. */
export function offPlanWriteText(record: OffPlanWrite): string {
  return `${record.paths.join(", ")}${record.count > record.paths.length ? ` (+${record.count - record.paths.length} more)` : ""}`;
}

/** The review's "What Orca recorded beyond the diff": one line per task with records (its newest), by task id. */
export function offPlanFactLines(store: ControlStore, groupId: string): string[] {
  const byTask = new Map<string, OffPlanWriteBody>();
  for (const body of readOffPlanWritesByRun(store, groupId).values()) byTask.set(body.taskId, body);
  return [...byTask.values()].sort((a, b) => (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0))
    .map((body) => `Off-plan writes by ${body.taskId}: ${offPlanWriteText(body)}`);
}
