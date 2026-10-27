/**
 * Scheduled flows and groups spec 2026-10-24 §12, plan B2: the `schedules` table's readers and its one writer. A row's
 * revision is the per-schedule optimistic concurrency of §11.1; a remove is a mark, never a delete, so its fires and
 * body stay readable (Rule 13). The fire writer (§7.5) enforces the only legal moves of a fire row and writes `lastSlot`
 * / `state` with the schedules row's revision in the same transaction as the fire write.
 */
import type { ControlStore } from "../store.js";
import { ControlError } from "../errors.js";
import { parseScheduleBody, type ScheduleBody, type ScheduleState } from "./model.js";

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
  by: String(row.by), via: String(row.via), body: parseFireBody(row.body),
});

/** A fire's stored body; a corrupt row is a named refusal, never a raw SyntaxError out of a route. */
function parseFireBody(body: unknown): ScheduleFire["body"] {
  let parsed: unknown;
  try { parsed = JSON.parse(String(body)); }
  catch { throw new ControlError("recovery-blocked", "schedule-fire-body-invalid"); }
  // A parsed `null` or array would leave the views dereferencing nothing: the body is a plain object or nothing.
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new ControlError("recovery-blocked", "schedule-fire-body-invalid");
  return parsed as ScheduleFire["body"];
}

const COLUMNS = "id,project_id,kind,revision,removed,body";

export function readSchedule(store: ControlStore, scheduleId: string): ScheduleRow | null {
  const row = store.db.prepare(`SELECT ${COLUMNS} FROM schedules WHERE id=?`).get(scheduleId);
  return row === undefined ? null : rowOf(row);
}

/** The row's mark without its body: a corrupt body is no reason for a remove's no-op check to fail. */
export function readScheduleState(store: ControlStore, scheduleId: string): { removed: boolean } | null {
  const row = store.db.prepare("SELECT removed FROM schedules WHERE id=?").get(scheduleId);
  return row === undefined ? null : { removed: Number(row.removed) === 1 };
}

export type ScheduleListing = { rows: ScheduleRow[]; corrupt: Array<{ id: string; error: ControlError }> };

/** A project's live schedules in creation order; a corrupt body is a per-row fact, not a throw that ends the read. */
export function listLiveSchedules(store: ControlStore, projectId: string | null): ScheduleListing {
  const where = [projectId === null ? null : "project_id=?", "removed=0"].filter((clause) => clause !== null).join(" AND ");
  const rows: ScheduleRow[] = [];
  const corrupt: ScheduleListing["corrupt"] = [];
  for (const row of store.db.prepare(`SELECT ${COLUMNS} FROM schedules${where === "" ? "" : ` WHERE ${where}`} ORDER BY rowid`)
    .all(...(projectId === null ? [] : [projectId]))) {
    try { rows.push(rowOf(row)); }
    catch (error) {
      corrupt.push({ id: String(row.id), error: error instanceof ControlError ? error : new ControlError("recovery-blocked", "schedule-body-invalid") });
    }
  }
  return { rows, corrupt };
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

/** A remove of a row whose body cannot be parsed: the mark and the revision only, so the stored bytes stay as they are. */
export function markRemovedUnparsed(store: ControlStore, scheduleId: string, input: { revision: number }): void {
  store.db.prepare("UPDATE schedules SET revision=?,removed=1 WHERE id=?").run(input.revision, scheduleId);
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

/**
 * §7.2 step 4: this schedule's fires that may still be active -- a `starting` row always counts. The `schedule_id`
 * prefix of the primary key seeks this schedule's rows and the outcome predicate is applied before any body is parsed,
 * so a long history is scanned but never decoded; `(schedule_id, outcome)` needs no second index for that.
 */
export function listActiveFires(store: ControlStore, scheduleId: string): ScheduleFire[] {
  return store.db.prepare(`SELECT ${FIRE_COLUMNS} FROM schedule_fires WHERE schedule_id=? AND outcome IN ('starting','started','waiting') ORDER BY seq`)
    .all(scheduleId).map(fireOf);
}

/** §7.2 step 0: every unsettled start, oldest first, across all schedules. */
export function listStartingFires(store: ControlStore): ScheduleFire[] {
  return store.db.prepare(`SELECT ${FIRE_COLUMNS} FROM schedule_fires WHERE outcome='starting' ORDER BY at, schedule_id, seq`).all().map(fireOf);
}

/** Both tables carry `body`, so the joined read qualifies every column of the fire. */
const GROUP_FIRE_COLUMNS = "f.schedule_id,f.seq,f.slot,f.at,f.outcome,f.reason,f.flow_run_id,f.group_id,f.\"by\",f.via,f.body";

/** §9.2 step 9: the group fires still open -- a condition-8 `waiting`, or a `started` row with no confirm recorded yet. */
export function listOpenGroupFires(store: ControlStore): ScheduleFire[] {
  // A corrupt body is no decision for this pass; the CASE keeps json_extract away from it (SQLite may test the OR first).
  return store.db.prepare(`SELECT ${GROUP_FIRE_COLUMNS} FROM schedule_fires f JOIN schedules s ON s.id=f.schedule_id
    WHERE s.kind='group' AND json_valid(f.body) AND ((f.outcome='waiting' AND f.reason='auto-confirm-ineligible:8')
      OR (f.outcome='started' AND (CASE WHEN json_valid(f.body) THEN json_extract(f.body,'$.confirm') END) IS NULL))
    ORDER BY f.at, f.schedule_id, f.seq`).all().map(fireOf);
}

export function readFire(store: ControlStore, scheduleId: string, seq: number): ScheduleFire | null {
  const row = store.db.prepare(`SELECT ${FIRE_COLUMNS} FROM schedule_fires WHERE schedule_id=? AND seq=?`).get(scheduleId, seq);
  return row === undefined ? null : fireOf(row);
}

/** The row's state change with the schedules row's revision bumped; the caller's transaction is the unit (§7.5). */
export function writeScheduleState(store: ControlStore, scheduleId: string, change: (state: ScheduleState) => ScheduleState): ScheduleBody {
  const row = readSchedule(store, scheduleId);
  if (row === null) throw new ControlError("recovery-blocked", "schedule-missing");
  const body = structuredClone(row.body);
  body.state = change(body.state);
  store.db.prepare("UPDATE schedules SET revision=?,body=? WHERE id=?").run(row.revision + 1, JSON.stringify(body), scheduleId);
  return body;
}

export interface FireInsertInput {
  scheduleId: string; slot: number; at: number;
  /** The `state.lastSlot` the pass read before deciding; a fresh row that no longer has it has moved on (enable, edit). */
  expectedLastSlot: number;
  /** The slot this fire consumes, written as the row's new `state.lastSlot`. */
  lastSlot: number;
  outcome: "starting" | "skipped"; reason?: string | null;
  commandId?: string; lateMs: number; missed: number; creditedTo: string;
}

/** The fire's attribution is the writer's (§10): `orca-auto` through `schedule:<id>`, credited to the enabler. */
const FIRE_BY = "orca-auto";
const fireVia = (scheduleId: string): string => `schedule:${scheduleId}`;

/**
 * T1 and a skip: one transaction writes the fire row and moves `lastSlot`. `UNIQUE(schedule_id, slot)` is the race guard
 * (§7.5): a second row for one slot is refused `schedule-slot-taken`, and the pass stops for that schedule.
 */
export function insertFire(store: ControlStore, input: FireInsertInput): { fire: ScheduleFire; schedule: ScheduleBody } {
  return store.transaction(() => {
    const row = readSchedule(store, input.scheduleId);
    if (row === null) throw new ControlError("recovery-blocked", "schedule-missing");
    // §7.2 step 1 on the fresh row: the pass awaits each start, so a person's disable, pause or remove can commit after
    // the pass listed this schedule; that stop wins and nothing is written for the slot.
    if (row.removed || !row.body.enabled || row.body.state.paused) throw new ControlError("recovery-blocked", "schedule-state-changed");
    // §10: the attribution is the schedule's enabler; a different name never writes a fire.
    if (input.creditedTo !== row.body.enabledBy) throw new ControlError("recovery-blocked", "fire-credited-to");
    // §7.2 step 2: a write from a pass that read an older row must not resurrect a slot an enable (or a cron edit) has
    // already re-initialised away; the pass stops this schedule for the pass and decides again from fresh state.
    if (row.body.state.lastSlot !== input.expectedLastSlot) throw new ControlError("recovery-blocked", "schedule-state-changed");
    if (store.db.prepare("SELECT 1 FROM schedule_fires WHERE schedule_id=? AND slot=?").get(input.scheduleId, input.slot) !== undefined) {
      throw new ControlError("recovery-blocked", "schedule-slot-taken");
    }
    const seq = Number(store.db.prepare("SELECT COALESCE(MAX(seq),0) AS n FROM schedule_fires WHERE schedule_id=?").get(input.scheduleId)!.n) + 1;
    const body: ScheduleFire["body"] = {
      lateMs: input.lateMs, missed: input.missed, creditedTo: input.creditedTo,
      ...(input.commandId === undefined ? {} : { commandId: input.commandId }),
    };
    try {
      store.db.prepare(`INSERT INTO schedule_fires(${FIRE_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(input.scheduleId, seq, input.slot, input.at, input.outcome, input.reason ?? null, null, null, FIRE_BY, fireVia(input.scheduleId), JSON.stringify(body));
    } catch (error) {
      // Only the (schedule_id, slot) UNIQUE is "another pass took the slot"; the (schedule_id, seq) PK race is a crash.
      const message = (error as Error).message;
      if (message.includes("schedule_fires.schedule_id") && message.includes("schedule_fires.slot")) {
        throw new ControlError("recovery-blocked", "schedule-slot-taken");
      }
      throw error;
    }
    const next = structuredClone(row.body);
    next.state.lastSlot = input.lastSlot;
    store.db.prepare("UPDATE schedules SET revision=?,body=? WHERE id=?").run(row.revision + 1, JSON.stringify(next), input.scheduleId);
    // The start reads this body, not the pass's listing: an edit committed since the listing is what the person asked for.
    const fire = fireOf({ schedule_id: input.scheduleId, seq, slot: input.slot, at: input.at, outcome: input.outcome, reason: input.reason ?? null,
      flow_run_id: null, group_id: null, by: FIRE_BY, via: fireVia(input.scheduleId), body: JSON.stringify(body) });
    return { fire, schedule: next };
  });
}

export interface FireSettleInput {
  scheduleId: string; seq: number;
  outcome: "started" | "failed" | "waiting";
  reason?: string | null;
  flowRunId?: string | null; groupId?: string | null;
  /** Merged into the stored body; `confirm` is the one body field a settled fire may gain (§9.2). */
  body?: Record<string, unknown>;
  /** The state write that rides with T2; omitted, the schedules row is not touched. */
  state?: (state: ScheduleState) => ScheduleState;
}

/** C10: the only legal moves of a fire row; anything else is a named refusal (a store writer, not a caller's choice). */
function assertLegalFireMove(current: ScheduleFire, input: FireSettleInput): void {
  if (input.outcome === current.outcome) {
    const confirm = input.body?.confirm;
    const gainedConfirm = confirm !== undefined && confirm !== null && (current.body.confirm === undefined || current.body.confirm === null);
    if (current.outcome === "started" && gainedConfirm) return;
    throw new ControlError("recovery-blocked", "schedule-fire-move-illegal");
  }
  if (current.outcome === "starting" && (input.outcome === "started" || input.outcome === "failed")) return;
  if (current.outcome === "started" && input.outcome === "waiting") return;
  // §9.2: the one waiting → started move, re-evaluated each pass until condition 8 clears.
  if (current.outcome === "waiting" && input.outcome === "started" && current.reason === "auto-confirm-ineligible:8") return;
  throw new ControlError("recovery-blocked", "schedule-fire-move-illegal");
}

/** T2: settle one fire and write the streak it implies, in one transaction (§7.5). */
export function settleFire(store: ControlStore, input: FireSettleInput): ScheduleFire {
  return store.transaction(() => {
    const current = readFire(store, input.scheduleId, input.seq);
    if (current === null) throw new ControlError("recovery-blocked", "schedule-fire-missing");
    assertLegalFireMove(current, input);
    const body = { ...current.body, ...(input.body ?? {}) };
    const reason = input.reason === undefined ? current.reason : input.reason;
    const flowRunId = input.flowRunId === undefined ? current.flowRunId : input.flowRunId;
    const groupId = input.groupId === undefined ? current.groupId : input.groupId;
    store.db.prepare(`UPDATE schedule_fires SET outcome=?,reason=?,flow_run_id=?,group_id=?,body=? WHERE schedule_id=? AND seq=?`)
      .run(input.outcome, reason, flowRunId, groupId, JSON.stringify(body), input.scheduleId, input.seq);
    if (input.state !== undefined) writeScheduleState(store, input.scheduleId, input.state);
    return fireOf({ schedule_id: input.scheduleId, seq: input.seq, slot: current.slot, at: current.at, outcome: input.outcome, reason,
      flow_run_id: flowRunId, group_id: groupId, by: current.by, via: current.via, body: JSON.stringify(body) });
  });
}
