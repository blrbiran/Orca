/**
 * Scheduled flows and groups spec 2026-10-24 §13.1, §13.3: the schedules' reads -- a project's schedules with their next
 * three slots and last fire, one schedule's body and fires, and a fire list. Pure reads; the routes are controlApi.ts's.
 */
import { ControlError } from "../errors.js";
import { parseCron, nextSlots } from "../checks/cron.js";
import type { ControlStore } from "../store.js";
import { readUsageCalendar } from "../usageCalendar.js";
import { newestVersionSha } from "../planLibrary/store.js";
import { listLiveSchedules, listFires, latestFire, readSchedule, type ScheduleFire, type ScheduleRow } from "./store.js";

const fireView = (fire: ScheduleFire | null) => fire === null ? null : {
  seq: fire.seq, slot: fire.slot, at: fire.at, lateMs: fire.body.lateMs ?? null, missed: fire.body.missed ?? 0,
  outcome: fire.outcome, reason: fire.reason, commandId: fire.body.commandId ?? null,
  flowRunId: fire.flowRunId, groupId: fire.groupId, creditedTo: fire.body.creditedTo ?? null, confirm: fire.body.confirm ?? null,
  by: fire.by, via: fire.via,
};

function slotsOf(store: ControlStore, row: ScheduleRow, now: number): number[] {
  return nextSlots(parseCron(row.body.cron), row.body.state.tz ?? readUsageCalendar(store).timeZone, now, 3);
}

/** §13.3: "a newer version available" for a group start, when the entry has one after the pinned version. */
function newerVersion(store: ControlStore, row: ScheduleRow): string | null {
  const start = row.body.start;
  if (start.kind !== "group") return null;
  const newest = newestVersionSha(store, start.entryId);
  return newest !== null && newest !== start.sha256 ? newest : null;
}

const scheduleView = (store: ControlStore, row: ScheduleRow, now: number) => ({
  id: row.id, projectId: row.projectId, name: row.body.name, kind: row.kind, cron: row.body.cron, enabled: row.body.enabled,
  start: row.body.start, removed: row.removed, revision: row.revision,
  createdBy: row.body.createdBy, createdVia: row.body.createdVia, createdAt: row.body.createdAt,
  updatedBy: row.body.updatedBy, updatedVia: row.body.updatedVia, updatedAt: row.body.updatedAt,
  enabledBy: row.body.enabledBy, enabledVia: row.body.enabledVia, enabledAt: row.body.enabledAt,
  lastSlot: row.body.state.lastSlot, tz: row.body.state.tz, failureStreak: row.body.state.failureStreak,
  paused: row.body.state.paused, pausedReason: row.body.state.pausedReason,
  nextSlots: slotsOf(store, row, now), lastFire: fireView(latestFire(store, row.id)),
  newerVersion: newerVersion(store, row),
});

/** GET /api/control/schedules?repoId=<id>: the project's live schedules, creation order; a body this panel cannot read is a `corrupt` row, never a failed read. */
export function scheduleListView(store: ControlStore, repoId: string, now: number) {
  const listed = listLiveSchedules(store, repoId);
  return {
    schema: "orca-schedules-v1" as const, repoId,
    schedules: listed.rows.map((row) => scheduleView(store, row, now)),
    corrupt: listed.corrupt.map(({ id, error }) => ({ id, code: error.code, message: error.message })),
  };
}

/** GET /api/control/schedules/:scheduleId: the body, its next slots and last fire, and newer-version information. */
export function scheduleDetailView(store: ControlStore, scheduleId: string, now: number) {
  const row = readSchedule(store, scheduleId);
  if (row === null) throw new ControlError("control-target-not-allowed", scheduleId);
  return { schema: "orca-schedule-v1" as const, ...scheduleView(store, row, now) };
}

/** GET /api/control/schedules/:scheduleId/fires: the newest fires first. */
export function scheduleFiresView(store: ControlStore, scheduleId: string, limit: number) {
  if (readSchedule(store, scheduleId) === null) throw new ControlError("control-target-not-allowed", scheduleId);
  return { schema: "orca-schedule-fires-v1" as const, scheduleId, fires: listFires(store, scheduleId, limit).map(fireView) };
}
