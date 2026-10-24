/**
 * Scheduled flows and groups spec 2026-10-24 §7.2, plan Task 6: one scheduler pass. Resume every unsettled start first
 * (§7.5), then evaluate each live schedule: the zone-change re-initialisation, the newest due slot, the overlap skip,
 * T1, the start, T2. Every decision is pure over stored facts; each write is one transaction (the fire row with the
 * schedules row's revision). A starter is idempotent by `fire.commandId`; a refusal from it (`ControlError` or the flow
 * kernel's `FlowRefusal`) is a failed start, any other throw is a crash that leaves the `starting` row for the next
 * pass (C5).
 */
import { autoConfirmBlocker, autoConfirmCommandId } from "../autoConfirm.js";
import { PAUSE_AFTER } from "../checks/pass.js";
import { cronSlotsBetween, latestSlot, parseCron } from "../checks/cron.js";
import { ControlError } from "../errors.js";
import { readGroupIntegration } from "../integrationScheme.js";
import type { ImportDefaults } from "../planImport.js";
import type { ControlStore } from "../store.js";
import { canonicalTimeZone, readUsageCalendar } from "../usageCalendar.js";
import { FlowRefusal, uuidOf } from "../../flow/kernel.js";
import { firedGroupId, type ScheduleBody, type ScheduleState } from "./model.js";
import {
  insertFire, listActiveFires, listLiveSchedules, listOpenGroupFires, listStartingFires, readSchedule, settleFire, writeScheduleState,
  type ScheduleFire, type ScheduleRow,
} from "./store.js";

export interface SchedulePassDeps {
  store: ControlStore;
  now?: () => number;
  /** §8 step 7; idempotent by `fire.body.commandId`, refusing with a `ControlError`. Absent: `control-target-not-allowed`. */
  startFlow?: (fire: ScheduleFire, schedule: ScheduleBody) => Promise<{ flowRunId: string }>;
  /** §9 step 7 (Task 9 wires the real one). Absent: `control-target-not-allowed`. */
  startGroup?: (fire: ScheduleFire, schedule: ScheduleBody) => Promise<{ groupId: string }>;
  /** §9.2 rule 6: the control-config defaults; absent, the pass decides as if none were configured (condition 8). */
  defaults?: () => ImportDefaults | null;
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

/** §7.6: a start that refused by name is a failed fire; any other throw is a crash (C5). */
function refusalCode(error: unknown): string | null {
  if (error instanceof ControlError || error instanceof FlowRefusal) return error.code;
  return null;
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

/** A crash's one short line for the pump: the schedule it belongs to and the error (§7.1). */
function crashOf(scheduleId: string, error: unknown): string {
  return `${scheduleId}: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * §9.2 step 9: what a fired group's booked facts say now. A `started` fire may move to `waiting` (once), gain the
 * confirmation R2 booked, or stay; a `waiting` fire moves only from the condition-8 reason to `started` on R2's success
 * (§22.2). Nothing here sends a confirm: the only automatic confirmer is R2's pass.
 */
type GroupFireWrite =
  | { outcome: "started"; confirm: Record<string, unknown> }
  | { outcome: "waiting"; reason: string; confirm?: Record<string, unknown> };

/** The estimate states §9.2 rule 8 calls a failure; every other state is transient. */
const FAILED_ESTIMATE_STATES = new Set(["failed", "interrupted", "blocked-capability", "input-too-large"]);

/**
 * Rule 1: the fired group's body, or null when there is no group row, the body is not a plain object, it was not fired by
 * a schedule, or it has no limit object. A body that does not parse throws: step 9's caller records the crash.
 */
function firedGroupOf(store: ControlStore, fire: ScheduleFire): Record<string, unknown> | null {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(firedGroupId(fire.scheduleId, fire.slot));
  if (row === undefined) return null;
  const parsed = JSON.parse(String(row.body)) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const group = parsed as Record<string, unknown>;
  if ((group.origin as { kind?: unknown } | undefined)?.kind !== "schedule") return null;
  const limit = group.limit;
  return typeof limit === "object" && limit !== null && !Array.isArray(limit) ? group : null;
}

/** Rule 3: R2's booked attempt for the proposal version on the record, read from the ledger (never from pass state, C5 (d)). */
function bookedAutoConfirm(store: ControlStore, groupId: string): { commandId: string; status: number; code: string | null } | null {
  const proposal = store.db.prepare("SELECT proposal_version FROM budget_proposals WHERE group_id=?").get(groupId);
  // A version's row is about that version: an older attempt cannot speak for a proposal the person has since edited. A
  // group with no proposal row (a hand-written fixture) has only the newest attempt to read.
  const row = proposal === undefined
    ? store.db.prepare("SELECT id, original_status, result FROM commands WHERE group_id=? AND id LIKE 'orca-auto-confirm-unlimited-v%' ORDER BY rowid DESC LIMIT 1").get(groupId)
    : store.db.prepare("SELECT id, original_status, result FROM commands WHERE group_id=? AND id=?").get(groupId, autoConfirmCommandId(Number(proposal.proposal_version)));
  if (row === undefined) return null;
  let code: string | null = null;
  try {
    const result = (JSON.parse(String(row.result)) as { error?: { code?: unknown } }).error?.code;
    if (typeof result === "string") code = result;
  } catch { /* an unreadable result names no error code: the caller treats the row as transient */ }
  return { commandId: String(row.id), status: row.original_status === null ? 200 : Number(row.original_status), code };
}

/** §9.2 rules 2-9, in the spec's order; null means the derivation does not change the row. */
function groupFireWrite(store: ControlStore, fire: ScheduleFire, now: number, defaults: ImportDefaults | null): GroupFireWrite | null {
  const group = firedGroupOf(store, fire);
  if (group === null) return null;
  // Rule 2: a `waiting` row other than condition 8 is write-once; a started row that already carries its confirm is done.
  if (fire.outcome === "waiting" && fire.reason !== "auto-confirm-ineligible:8") return null;
  if (fire.outcome === "started" && fire.body.confirm !== undefined && fire.body.confirm !== null) return null;
  const groupId = firedGroupId(fire.scheduleId, fire.slot);
  // Rule 3: R2's booked attempt, read from the ledger (never from pass state, C5 (d)).
  const booked = bookedAutoConfirm(store, groupId);
  if (booked !== null) {
    if (booked.status < 400) {
      return { outcome: "started", confirm: { state: "auto-confirmed", commandId: booked.commandId, code: null, at: now } };
    }
    // §22.2: only a success moves a condition-8 waiting row; every other waiting reason stays as it is.
    if (fire.outcome === "waiting") return null;
    // An unreadable error code is transient: the next pass reads the row again.
    if (booked.code === null) return null;
    if (booked.code === "auto-confirm-selections-unresolved") return { outcome: "waiting", reason: "auto-confirm-ineligible:10" };
    return {
      outcome: "waiting", reason: `auto-confirm-refused:${booked.code}`,
      confirm: { state: "auto-confirm-refused", commandId: booked.commandId, code: booked.code, at: now },
    };
  }
  // A condition-8 waiting row waits for the success above; nothing else about the group can move it.
  if (fire.outcome === "waiting") return null;
  // Rule 4: a person confirmed it (or it moved on) without an automatic attempt: the group's own ledger names them.
  if (group.status !== "draft") return null;
  // Rule 5: a finite limit is the person's one-click confirm.
  if ((group.limit as { tokens?: unknown }).tokens !== null) return { outcome: "waiting", reason: "limited" };
  // Rule 6: R2's own predicate; only condition 8 (no control-config defaults) never clears by waiting. Condition 6 (a
  // delivery scheme) is rule 7's to name; every other condition is transient.
  const blocker = autoConfirmBlocker(store, group, defaults);
  if (blocker !== null && blocker.condition === 8) return { outcome: "waiting", reason: "auto-confirm-ineligible:8" };
  if (blocker !== null && blocker.condition !== 6) return null;
  // Rule 7: any delivery scheme keeps the owner's click (C-2).
  const integration = readGroupIntegration(group);
  if (integration !== null) return { outcome: "waiting", reason: `delivery-needs-person:${integration.scheme.delivery}` };
  // Rule 8: an estimate that ended in a failure will not run by waiting either.
  const estimate = store.db.prepare("SELECT state, body FROM estimates WHERE group_id=? ORDER BY estimate_version DESC LIMIT 1").get(groupId) as
    { state: unknown; body: unknown } | undefined;
  if (estimate !== undefined && FAILED_ESTIMATE_STATES.has(String(estimate.state))) {
    const reasonCode = (JSON.parse(String(estimate.body)) as { reasonCode?: unknown }).reasonCode;
    return {
      outcome: "waiting",
      reason: `estimate-failed:${String(estimate.state)}${typeof reasonCode === "string" && reasonCode !== "" ? `:${reasonCode}` : ""}`,
    };
  }
  // Rule 9: transient -- an estimate is still running or queued, or R2 has not tried yet.
  return null;
}

/** §9.2 step 9: one fire's derivation, written through the single writer only when it changes the row. */
function recordGroupFire(deps: SchedulePassDeps, fire: ScheduleFire, now: number, defaults: ImportDefaults | null): void {
  const next = groupFireWrite(deps.store, fire, now, defaults);
  if (next === null) return;
  if (next.outcome === "started") {
    settleFire(deps.store, {
      scheduleId: fire.scheduleId, seq: fire.seq, outcome: "started", reason: null,
      body: { confirm: next.confirm },
    });
    return;
  }
  settleFire(deps.store, {
    scheduleId: fire.scheduleId, seq: fire.seq, outcome: "waiting", reason: next.reason,
    ...(next.confirm === undefined ? {} : { body: { confirm: next.confirm } }),
  });
}

async function resumeFire(deps: SchedulePassDeps, fire: ScheduleFire): Promise<void> {
  const row = readSchedule(deps.store, fire.scheduleId);
  const signalled = alreadyStarted(deps.store, fire, row?.body ?? null);
  if (signalled !== null) {
    if (signalled.ok) settleStarted(deps.store, fire, signalled);
    else settleFailed(deps.store, fire, signalled.code);
    return;
  }
  // §9 is Task 9's: until `startGroup` is wired, a group fire is neither re-run nor failed -- it stays `starting`.
  if (row !== null && row.body.kind === "group" && deps.startGroup === undefined) return;
  if (row === null || row.removed || !row.body.enabled || row.body.state.paused) {
    settleFailed(deps.store, fire, "schedule-disabled");
    return;
  }
  try {
    settleStarted(deps.store, fire, await startOf(deps, fire, row.body));
  } catch (error) {
    const code = refusalCode(error);
    if (code === null) throw error;
    settleFailed(deps.store, fire, code);
  }
}

/**
 * §7.2 step 0: settle every `starting` fire of any schedule, oldest first. A start that happened is recorded from what
 * exists; a schedule removed, disabled or paused since T1 fails `schedule-disabled` (the person's stop wins, streak
 * unchanged); anything else re-runs its own starter and settles the outcome. A crash is isolated to its fire (C5): the
 * row stays `starting` and every other fire and schedule still runs.
 */
export async function resumeStartingFires(deps: SchedulePassDeps): Promise<{ crashes: string[] }> {
  const crashes: string[] = [];
  for (const fire of listStartingFires(deps.store)) {
    try { await resumeFire(deps, fire); }
    catch (error) { crashes.push(crashOf(fire.scheduleId, error)); }
  }
  return { crashes };
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
  // §9 is Task 9's: a group schedule with no wired starter consumes nothing and writes nothing.
  if (body.kind === "group" && deps.startGroup === undefined) return;
  // §7.2 step 2: a zone change (or a never-initialised `lastSlot`) re-initialises in the new zone and fires nothing
  // this pass (M-2).
  const tz = canonicalTimeZone(readUsageCalendar(store).timeZone);
  const spec = parseCron(body.cron);
  if (tz !== body.state.tz || body.state.lastSlot === null) {
    const lastSlot = latestSlot(spec, tz, Number.NEGATIVE_INFINITY, now) ?? now;
    store.transaction(() => writeScheduleState(store, row.id, (state) => ({ ...state, tz, lastSlot })));
    return;
  }
  const from = body.state.lastSlot;
  const slot = latestSlot(spec, tz, from, now);
  if (slot === null) return;
  // §7.2 step 3: for the record only -- older missed slots collapse into this one (§7.3).
  const missed = Math.max(0, cronSlotsBetween(spec, tz, from, slot).length - 1);
  const lateMs = now - slot;
  const creditedTo = body.enabledBy;
  // §7.2 step 4: a `starting` row or a still-running/paused run or a live group consumes the slot as a skip. The first
  // active id is enough, so a long history is not walked (and its bodies are not parsed) past that point.
  let active: string | null = null;
  for (const fire of listActiveFires(store, row.id)) {
    active = activeFireId(store, fire);
    if (active !== null) break;
  }
  try {
    if (active !== null) {
      insertFire(store, {
        scheduleId: row.id, slot, at: now, expectedLastSlot: from, lastSlot: slot, outcome: "skipped",
        reason: `previous-active:${active}`, lateMs, missed, creditedTo,
      });
      return;
    }
    // §7.2 steps 5-6: T1; a UNIQUE(schedule, slot) hit means another pass took the slot, and a moved `lastSlot` means
    // an enable re-initialised it -- either way nothing more to record this pass.
    const fire = insertFire(store, {
      scheduleId: row.id, slot, at: now, expectedLastSlot: from, lastSlot: slot, outcome: "starting",
      commandId: `orca-auto-schedule-${row.id}-${slot}`, lateMs, missed, creditedTo,
    });
    // §7.2 steps 7-8: the start is idempotent; a refusal settles `failed`, any other throw stays a crash.
    try {
      settleStarted(store, fire, await startOf(deps, fire, body));
    } catch (error) {
      const code = refusalCode(error);
      if (code === null) throw error;
      settleFailed(store, fire, code);
    }
  } catch (error) {
    if (error instanceof ControlError && (error.detail === "schedule-slot-taken" || error.detail === "schedule-state-changed")) return;
    throw error;
  }
}

/**
 * §7.2: one pass -- every `starting` fire first, then every live schedule, then step 9's record of each group fire. A
 * crash is isolated to its fire or schedule (C5): the rest of the pass still runs, and the caller writes one line per
 * crash. A corrupt schedule body is one crash line for that row; the other schedules still run.
 */
export async function schedulesPass(deps: SchedulePassDeps, now: number = (deps.now ?? Date.now)()): Promise<{ crashes: string[] }> {
  const { crashes } = await resumeStartingFires(deps);
  const listed = listLiveSchedules(deps.store, null);
  for (const { id, error } of listed.corrupt) crashes.push(crashOf(id, error));
  for (const row of listed.rows) {
    try { await evaluateSchedule(deps, row, now); }
    catch (error) { crashes.push(crashOf(row.id, error)); }
  }
  // §9.2 step 9: after every start of the pass, so a fire this pass just started is recorded in the same pass.
  const defaults = deps.defaults?.() ?? null;
  for (const fire of listOpenGroupFires(deps.store)) {
    try { recordGroupFire(deps, fire, now, defaults); }
    catch (error) { crashes.push(crashOf(`${fire.scheduleId}#${fire.seq}`, error)); }
  }
  return { crashes };
}
