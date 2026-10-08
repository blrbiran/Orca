import { ControlError } from "./errors.js";
import { inProjectionTransaction, recordProjectionChange } from "./projectionJournal.js";
import type { ControlStore } from "./store.js";

/**
 * Issue-fixes spec §5 (ruling H5): Orca's own wall-clock record of what happened in a group. A row is written inside the
 * transaction that makes its change, so it exists if and only if the change committed; a replayed command writes none.
 * Group-scoped kinds only (§1 non-goals).
 */
export type ActivityKind = "command" | "run-claimed" | "run-started" | "phase" | "run-blocked" | "run-resumed" | "run-settled" | "task-retried" | "integration" | "stop" | "stop-cleared" | "archived" | "unarchived";
export const ACTIVITY_KINDS = [
  "command", "run-claimed", "run-started", "phase", "run-blocked", "run-resumed", "run-settled", "task-retried", "integration", "stop", "stop-cleared", "archived", "unarchived",
] as const satisfies readonly ActivityKind[];
export type ActivityRow = { groupId: string; taskId?: string | null; runId?: string | null; kind: ActivityKind; body: Record<string, unknown> };
export type ActivityEntry = { seq: number; groupId: string; taskId: string | null; runId: string | null; at: number; kind: ActivityKind; body: Record<string, unknown> };

/** §5.2 Retention: a group keeps its newest 500 rows. Run times live on the run body, so this only shortens the feed. */
export const ACTIVITY_RETENTION = 500;

/**
 * The insert (stamped with the store's clock) and the group's retention, with no projection change. Only
 * applyWebCommand calls it directly: a command's success body has already named its projectionSeq, and every
 * group-scoped command records its group's projection change itself (commandLedger.ts). Everyone else calls recordActivity.
 */
export function appendActivity(store: ControlStore, row: ActivityRow): void {
  if (!inProjectionTransaction(store)) throw new ControlError("control-projection-transaction-missing", "activity");
  store.db.prepare("INSERT INTO activity(group_id,task_id,run_id,at,kind,body) VALUES (?,?,?,?,?,?)")
    .run(row.groupId, row.taskId ?? null, row.runId ?? null, store.now(), row.kind, JSON.stringify(row.body));
  store.db.prepare("DELETE FROM activity WHERE group_id=? AND seq <= (SELECT seq FROM activity WHERE group_id=? ORDER BY seq DESC LIMIT 1 OFFSET ?)")
    .run(row.groupId, row.groupId, ACTIVITY_RETENTION);
}

/**
 * §5.2 "Change notification": the row, then the group's projection change, so the summary poll re-reads the open group.
 * recordProjectionChange moves a group at most once per transaction (projectionJournal.ts skips a group the transaction
 * already recorded, whichever call came first), so a change that recorded its own is never advanced a second time.
 */
export function recordActivity(store: ControlStore, row: ActivityRow): void {
  appendActivity(store, row);
  recordProjectionChange(store, [row.groupId]);
}

const COLUMNS = "seq,group_id,task_id,run_id,at,kind,body";

function entryOf(row: Record<string, unknown>): ActivityEntry {
  const seq = Number(row.seq), kind = String(row.kind);
  let body: unknown = null;
  try { body = JSON.parse(String(row.body)); } catch { body = null; }
  if (body === null || typeof body !== "object" || Array.isArray(body) || !(ACTIVITY_KINDS as readonly string[]).includes(kind)) {
    throw new ControlError("recovery-blocked", `activity-invalid:${seq}`);
  }
  return {
    seq, groupId: String(row.group_id), taskId: row.task_id === null ? null : String(row.task_id), runId: row.run_id === null ? null : String(row.run_id),
    at: Number(row.at), kind: kind as ActivityKind, body: body as Record<string, unknown>,
  };
}

function checkedLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new ControlError("query-invalid");
  return limit;
}

/** §5.2 Reads: a group's newest rows, newest first (by seq). */
export function readGroupActivity(store: ControlStore, groupId: string, limit: number): ActivityEntry[] {
  return store.db.prepare(`SELECT ${COLUMNS} FROM activity WHERE group_id=? ORDER BY seq DESC LIMIT ?`).all(groupId, checkedLimit(limit)).map(entryOf);
}

/** §5.2 Reads: a run's newest rows, newest first (by seq). */
export function readRunActivity(store: ControlStore, runId: string, limit: number): ActivityEntry[] {
  return store.db.prepare(`SELECT ${COLUMNS} FROM activity WHERE run_id=? ORDER BY seq DESC LIMIT ?`).all(runId, checkedLimit(limit)).map(entryOf);
}

/** §5.2: the `at` of the group's newest row by seq (the group summary's updatedAt, Part E); null with no row. */
export function latestGroupActivityAt(store: ControlStore, groupId: string): number | null {
  const row = store.db.prepare("SELECT at FROM activity WHERE group_id=? ORDER BY seq DESC LIMIT 1").get(groupId);
  return row === undefined ? null : Number(row.at);
}
