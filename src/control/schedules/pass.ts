/**
 * Scheduled flows and groups spec 2026-10-24 §7.2, plan Task 6: one scheduler pass. Resume every unsettled start first
 * (§7.5), then evaluate each live schedule: the zone-change re-initialisation, the newest due slot, the overlap skip,
 * T1, the start, T2. Every decision is pure over stored facts; each write is one transaction (the fire row with the
 * schedules row's revision). A starter is idempotent by `fire.commandId`; a `ControlError` from it is a failed start,
 * any other throw is a crash that leaves the `starting` row for the next pass (C5).
 */
import { PAUSE_AFTER } from "../checks/pass.js";
import { cronSlotsBetween, latestSlot, parseCron } from "../checks/cron.js";
import { ControlError } from "../errors.js";
import type { ControlStore } from "../store.js";
import { canonicalTimeZone, readUsageCalendar } from "../usageCalendar.js";
import { uuidOf } from "../../flow/kernel.js";
import { firedGroupId, type ScheduleBody, type ScheduleState } from "./model.js";
import {
  insertFire, listActiveFires, listSchedules, listStartingFires, readSchedule, settleFire, writeScheduleState,
  type ScheduleFire, type ScheduleRow,
} from "./store.js";

export interface SchedulePassDeps {
  store: ControlStore;
  now?: () => number;
  /** §8 step 7; idempotent by `fire.body.commandId`, refusing with a `ControlError`. Absent: `control-target-not-allowed`. */
  startFlow?: (fire: ScheduleFire, schedule: ScheduleBody) => Promise<{ flowRunId: string }>;
  /** §9 step 7 (Task 9 wires the real one). Absent: `control-target-not-allowed`. */
  startGroup?: (fire: ScheduleFire, schedule: ScheduleBody) => Promise<{ groupId: string }>;
}

/** The group statuses §7.4 counts as active; a `done` or archived group is not. */
const ACTIVE_GROUP_STATUSES = new Set(["draft", "ready", "running", "review", "blocked"]);
const ACTIVE_FLOW_STATES = new Set(["running", "paused"]);

function flowRunActive(store: ControlStore, flowRunId: string): boolean {
  const row = store.db.prepare("SELECT state FROM flow_runs WHERE id=?").get(flowRunId);
  return row !== undefined && ACTIVE_FLOW_STATES.has(String(row.state));
}

/** §7.4: not archived and a status in {draft, ready, running, review, blocked}. An unreadable group reads active. */
function groupActive(store: ControlStore, groupId: string): boolean {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  if (row === undefined) return false;
  try {
    const body = JSON.parse(String(row.body)) as Record<string, unknown>;
    if (Object.hasOwn(body, "archived")) return false;
    return ACTIVE_GROUP_STATUSES.has(String(body.status));
  } catch { return true; }
}

/** The id a skip names: the run/group, or a `starting` row's own command. */
function activeFireId(store: ControlStore, fire: ScheduleFire): string | null {
  if (fire.outcome === "starting") return fire.flowRunId ?? fire.groupId ?? fire.body.commandId ?? `${fire.scheduleId}:${fire.seq}`;
  if (fire.flowRunId !== null) return flowRunActive(store, fire.flowRunId) ? fire.flowRunId : null;
  if (fire.groupId !== null) return groupActive(store, fire.groupId) ? fire.groupId : null;
  return null;
}

type AlreadyStarted = { ok: true; flowRunId?: string; groupId?: string } | { ok: false; code: string } | null;

/**
 * §7.2 step 0: did this fire's start already happen? A flow start derives its run id from the command
 * (`fr-<uuidOf(commandId)>`, §7.5); a group import is a booked `commands` row for the deterministic `sgrp-` group.
 */
function alreadyStarted(store: ControlStore, fire: ScheduleFire, schedule: ScheduleBody | null): AlreadyStarted {
  const commandId = fire.body.commandId;
  if (commandId === undefined || schedule === null) return null;
  if (schedule.kind === "flow") {
    const flowRunId = `fr-${uuidOf(commandId)}`;
    return store.db.prepare("SELECT 1 FROM flow_runs WHERE id=?").get(flowRunId) !== undefined ? { ok: true, flowRunId } : null;
  }
  const groupId = firedGroupId(fire.scheduleId, fire.slot);
  const row = store.db.prepare("SELECT original_status,body_json FROM commands WHERE group_id=? AND id=?").get(groupId, commandId);
  if (row === undefined) return null;
  const status = row.original_status === null ? 200 : Number(row.original_status);
  if (status < 400) return { ok: true, groupId };
  let code = "flow-refused";
  try {
    const body = JSON.parse(String(row.body_json ?? "{}")) as { error?: { code?: unknown } };
    if (typeof body.error?.code === "string") code = body.error.code;
  } catch { /* the booked body is unreadable: the failure still happened */ }
  return { ok: false, code };
}

/** §7 step 7: the schedule's own starter; a kind without one fails `control-target-not-allowed`. */
async function startOf(deps: SchedulePassDeps, fire: ScheduleFire, schedule: ScheduleBody): Promise<{ flowRunId?: string; groupId?: string }> {
  if (schedule.kind === "flow") {
    if (deps.startFlow === undefined) throw new ControlError("control-target-not-allowed");
    const { flowRunId } = await deps.startFlow(fire, schedule);
    return { flowRunId };
  }
  if (deps.startGroup === undefined) throw new ControlError("control-target-not-allowed");
  const { groupId } = await deps.startGroup(fire, schedule);
  return { groupId };
}

function settleStarted(store: ControlStore, fire: ScheduleFire, ids: { flowRunId?: string; groupId?: string }): void {
  settleFire(store, {
    scheduleId: fire.scheduleId, seq: fire.seq, outcome: "started", reason: null,
    ...(ids.flowRunId === undefined ? {} : { flowRunId: ids.flowRunId }),
    ...(ids.groupId === undefined ? {} : { groupId: ids.groupId }),
    // §7.6: a started fire resets the streak.
    state: (state) => ({ ...state, failureStreak: 0 }),
  });
}

/** §7.6: a failed start adds one; `schedule-disabled` never counts; three in a row pause the schedule. */
function settleFailed(store: ControlStore, fire: ScheduleFire, code: string): void {
  settleFire(store, {
    scheduleId: fire.scheduleId, seq: fire.seq, outcome: "failed", reason: code,
    ...(code === "schedule-disabled" ? {} : {
      state: (state: ScheduleState) => {
        const failureStreak = state.failureStreak + 1;
        const paused = state.paused || failureStreak >= PAUSE_AFTER;
        return { ...state, failureStreak, paused, pausedReason: paused ? code : state.pausedReason };
      },
    }),
  });
}

/**
 * §7.2 step 0: settle every `starting` fire of any schedule, oldest first. A start that happened is recorded from what
 * exists; a schedule removed, disabled or paused since T1 fails `schedule-disabled` (the person's stop wins, streak
 * unchanged); anything else re-runs its own starter and settles the outcome.
 */
export async function resumeStartingFires(deps: SchedulePassDeps, _now: number): Promise<void> {
  for (const fire of listStartingFires(deps.store)) {
    const row = readSchedule(deps.store, fire.scheduleId);
    const signalled = alreadyStarted(deps.store, fire, row?.body ?? null);
    if (signalled !== null) {
      if (signalled.ok) settleStarted(deps.store, fire, signalled);
      else settleFailed(deps.store, fire, signalled.code);
      continue;
    }
    if (row === null || row.removed || !row.body.enabled || row.body.state.paused) {
      settleFailed(deps.store, fire, "schedule-disabled");
      continue;
    }
    try {
      settleStarted(deps.store, fire, await startOf(deps, fire, row.body));
    } catch (error) {
      if (!(error instanceof ControlError)) throw error;
      settleFailed(deps.store, fire, error.code);
    }
  }
}

/**
 * §7.2 steps 1-8 for one schedule (step 0 is `resumeStartingFires`, exported separately so the overlap rule can be
 * exercised on its own). The zone re-initialisation writes and stops without firing; a due slot is skipped while this
 * schedule has an active fire, else T1, the start and T2.
 */
export async function evaluateSchedule(deps: SchedulePassDeps, row: ScheduleRow, now: number): Promise<void> {
  const body = row.body;
  const store = deps.store;
  if (row.removed || !body.enabled || body.state.paused) return;
  // §7.2 step 2: a zone change re-initialises lastSlot in the new zone and fires nothing this pass (M-2).
  const tz = canonicalTimeZone(readUsageCalendar(store).timeZone);
  const spec = parseCron(body.cron);
  if (tz !== body.state.tz) {
    const lastSlot = latestSlot(spec, tz, Number.NEGATIVE_INFINITY, now) ?? now;
    store.transaction(() => writeScheduleState(store, row.id, (state) => ({ ...state, tz, lastSlot })));
    return;
  }
  const from = body.state.lastSlot ?? now;
  const slot = latestSlot(spec, tz, from, now);
  if (slot === null) return;
  // §7.2 step 3: for the record only -- older missed slots collapse into this one (§7.3).
  const missed = Math.max(0, cronSlotsBetween(spec, tz, from, slot).length - 1);
  const lateMs = now - slot;
  const creditedTo = body.enabledBy;
  // §7.2 step 4: a `starting` row or a still-running/paused run or a live group consumes the slot as a skip.
  const active = listActiveFires(store, row.id).map((fire) => activeFireId(store, fire)).find((id) => id !== null);
  try {
    if (active !== undefined) {
      insertFire(store, {
        scheduleId: row.id, slot, at: now, lastSlot: slot, outcome: "skipped",
        reason: `previous-active:${active}`, lateMs, missed, creditedTo,
      });
      return;
    }
    // §7.2 steps 5-6: T1; a UNIQUE(schedule, slot) hit means another pass took the slot -- nothing more to record.
    const fire = insertFire(store, {
      scheduleId: row.id, slot, at: now, lastSlot: slot, outcome: "starting",
      commandId: `orca-auto-schedule-${row.id}-${slot}`, lateMs, missed, creditedTo,
    });
    // §7.2 steps 7-8: the start is idempotent; a ControlError settles `failed`, any other throw stays a crash.
    try {
      settleStarted(store, fire, await startOf(deps, fire, body));
    } catch (error) {
      if (!(error instanceof ControlError)) throw error;
      settleFailed(store, fire, error.code);
    }
  } catch (error) {
    if (error instanceof ControlError && error.detail === "schedule-slot-taken") return;
    throw error;
  }
}

/** §7.2: one pass -- every `starting` fire first, then every live schedule. */
export async function schedulesPass(deps: SchedulePassDeps, now: number = (deps.now ?? Date.now)()): Promise<void> {
  await resumeStartingFires(deps, now);
  for (const row of listSchedules(deps.store, null)) await evaluateSchedule(deps, row, now);
}
