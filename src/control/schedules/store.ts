/**
 * Scheduled flows and groups spec 2026-10-24 §12, plan B2: the `schedules` table's readers and its one writer. A row's
 * revision is the per-schedule optimistic concurrency of §11.1; a remove is a mark, never a delete, so its fires and
 * body stay readable (Rule 13). The fire writer lands with the pass (plan Task 6); this module reads its rows.
 */
import type { ControlStore } from "../store.js";
import { parseScheduleBody, type ScheduleBody } from "./model.js";

export interface ScheduleRow { id: string; projectId: string; kind: "flow" | "group"; revision: number; removed: boolean; body: ScheduleBody }
export interface ScheduleFire {
  scheduleId: string; seq: number; slot: number; at: number;
  outcome: "starting" | "started" | "waiting" | "skipped" | "failed"; reason: string | null;
  flowRunId: string | null; groupId: string | null; by: string; via: string;
  body: { lateMs?: number; missed?: number; commandId?: string; confirm?: unknown; creditedTo?: string };
}

const rowOf = (row: Record<string, unknown>): ScheduleRow => ({
  id: String(row.id), projectId: String(row.project_id), kind: String(row.kind) as ScheduleRow["kind"],
  revision: Number(row.revision), removed: Number(row.removed) === 1,
  body: parseScheduleBody(row as { id: unknown; project_id: unknown; kind: unknown; body: unknown }),
});
const fireOf = (row: Record<string, unknown>): ScheduleFire => ({
  scheduleId: String(row.schedule_id), seq: Number(row.seq), slot: Number(row.slot), at: Number(row.at),
  outcome: String(row.outcome) as ScheduleFire["outcome"], reason: row.reason === null ? null : String(row.reason),
  flowRunId: row.flow_run_id === null ? null : String(row.flow_run_id), groupId: row.group_id === null ? null : String(row.group_id),
  by: String(row.by), via: String(row.via), body: JSON.parse(String(row.body)) as ScheduleFire["body"],
});

const COLUMNS = "id,project_id,kind,revision,removed,body";

export function readSchedule(store: ControlStore, scheduleId: string): ScheduleRow | null {
  const row = store.db.prepare(`SELECT ${COLUMNS} FROM schedules WHERE id=?`).get(scheduleId);
  return row === undefined ? null : rowOf(row);
}

/** A project's schedules, removed ones excluded unless asked, in creation order. */
export function listSchedules(store: ControlStore, projectId: string | null, includeRemoved = false): ScheduleRow[] {
  const where = [projectId === null ? null : "project_id=?", includeRemoved ? null : "removed=0"].filter((clause) => clause !== null).join(" AND ");
  return store.db.prepare(`SELECT ${COLUMNS} FROM schedules${where === "" ? "" : ` WHERE ${where}`} ORDER BY rowid`)
    .all(...(projectId === null ? [] : [projectId])).map(rowOf);
}

export function liveScheduleCount(store: ControlStore, projectId: string): number {
  return Number(store.db.prepare("SELECT COUNT(*) AS n FROM schedules WHERE project_id=? AND removed=0").get(projectId)!.n);
}

export function insertSchedule(store: ControlStore, input: { id: string; projectId: string; kind: "flow" | "group"; revision: number; body: ScheduleBody }): void {
  store.db.prepare("INSERT INTO schedules(id,project_id,kind,revision,removed,body) VALUES (?,?,?,?,0,?)")
    .run(input.id, input.projectId, input.kind, input.revision, JSON.stringify(input.body));
}

export function writeSchedule(store: ControlStore, scheduleId: string, input: { revision: number; body: ScheduleBody }): void {
  store.db.prepare("UPDATE schedules SET revision=?,body=? WHERE id=?").run(input.revision, JSON.stringify(input.body), scheduleId);
}

export function markRemoved(store: ControlStore, scheduleId: string, input: { revision: number; body: ScheduleBody }): void {
  store.db.prepare("UPDATE schedules SET revision=?,removed=1,body=? WHERE id=?").run(input.revision, JSON.stringify(input.body), scheduleId);
}

const FIRE_COLUMNS = "schedule_id,seq,slot,at,outcome,reason,flow_run_id,group_id,\"by\",via,body";

export function latestFire(store: ControlStore, scheduleId: string): ScheduleFire | null {
  const row = store.db.prepare(`SELECT ${FIRE_COLUMNS} FROM schedule_fires WHERE schedule_id=? ORDER BY seq DESC LIMIT 1`).get(scheduleId);
  return row === undefined ? null : fireOf(row);
}

/** A schedule's newest fires first; `limit` is already checked by the caller's query schema. */
export function listFires(store: ControlStore, scheduleId: string, limit: number): ScheduleFire[] {
  return store.db.prepare(`SELECT ${FIRE_COLUMNS} FROM schedule_fires WHERE schedule_id=? ORDER BY seq DESC LIMIT ?`).all(scheduleId, limit).map(fireOf);
}
