/**
 * Scheduled flows and groups spec 2026-10-24 §6, plan B3, B5, B8: a schedule's body and the checks every write makes
 * before anything is stored -- the cron at most hourly in the panel's zone, a flow template at a shipped version with its
 * own params, a group start's entry and version of this project, and the id shapes (`sch-` schedules, `sgrp-` fired
 * groups). A refused write changes nothing (its command books the code).
 */
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { ControlError } from "../errors.js";
import { checkParamValue } from "../../flow/params.js";
import { asFlowControlError } from "../../flow/flowCommands.js";
import { loadBuiltin } from "../../flow/template/load.js";
import { cronTooFrequent, latestSlot, parseCron, validateSchedule } from "../checks/cron.js";
import type { ControlStore } from "../store.js";
import { canonicalTimeZone, readUsageCalendar } from "../usageCalendar.js";
import { readEntry, readVersion } from "../planLibrary/store.js";
import type { IntegrationScheme } from "../integrationScheme.js";

export const SCHEDULE_ID = /^sch-[a-z0-9][a-z0-9-]{0,59}$/;
export const FIRED_GROUP_ID = /^sgrp-[0-9a-f]{16}$/;
export const SCHEDULE_LIMIT = 8;

export type ScheduleStart =
  | { kind: "flow"; template: string; params: Record<string, string | number | boolean>; clarify?: "skip"; unattended?: boolean; pool?: number }
  | { kind: "group"; entryId: string; sha256: string; tokenLimit: number | null; integration: IntegrationScheme | null };

export interface ScheduleState { lastSlot: number | null; tz: string | null; failureStreak: number; paused: boolean; pausedReason: string | null }
export interface ScheduleBody {
  id: string; projectId: string; name: string; kind: "flow" | "group"; cron: string; enabled: boolean; start: ScheduleStart;
  createdBy: string; createdVia: string; createdAt: number;
  updatedBy: string; updatedVia: string; updatedAt: number;
  enabledBy: string; enabledVia: string; enabledAt: number;
  state: ScheduleState;
}

/** B3: `sch-` + the name's slug (lower-cased, runs of non-alphanumerics as `-`), for a client that names a new one. */
export function scheduleIdFor(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 59).replace(/-+$/, "");
  return `sch-${slug === "" ? "schedule" : slug}`;
}

/** B3: the group a fire imports, deterministic from the schedule and its slot. */
export const firedGroupId = (scheduleId: string, slot: number): string =>
  `sgrp-${createHash("sha256").update(`${scheduleId}\0${slot}`, "utf8").digest("hex").slice(0, 16)}`;

export interface ScheduleValidationDeps {
  store: ControlStore;
  flowProjects(): ReadonlyArray<{ repoId: string; path: string }>;
  knownRepository(repoId: string): boolean;
}

/** §6.1: the start as stored, with a flow template's shipped version filled in when the person named none. */
export function validateStart(deps: ScheduleValidationDeps, projectId: string, start: ScheduleStart): ScheduleStart {
  if (start.kind === "flow") return validateFlowStart(deps, projectId, start);
  return validateGroupStart(deps, projectId, start);
}

function validateFlowStart(deps: ScheduleValidationDeps, projectId: string, start: Extract<ScheduleStart, { kind: "flow" }>): ScheduleStart {
  if (!deps.flowProjects().some((project) => project.repoId === projectId)) throw new ControlError("flow-dir-unregistered", projectId);
  const match = /^(?:builtin\/)?([a-z0-9][a-z0-9-]*)(?:@(\d+))?$/.exec(start.template);
  if (match === null) throw new ControlError("flow-template-invalid", start.template);
  const templateId = match[1]!;
  const namedVersion = match[2];
  let loaded;
  try { loaded = loadBuiltin(templateId); }
  catch (error) { throw new ControlError("flow-template-invalid", (error as Error).message); }
  for (const [id, value] of Object.entries(start.params)) {
    // Own keys only: `toString`/`constructor` from the prototype chain is not a parameter of the template.
    const param = loaded.template.params !== undefined && Object.hasOwn(loaded.template.params, id) ? loaded.template.params[id] : undefined;
    if (param === undefined) throw new ControlError("flow-param-invalid", `${id}: not a parameter of the template`);
    // §6.1: an image is read inside the folder at every fire, so a preset-style absolute path is not a scheduled value.
    if (param.type === "image" && typeof value === "string" && isAbsolute(value)) throw new ControlError("schedule-param-absolute", id);
    try { checkParamValue(id, param, value); }
    catch (error) { throw asFlowControlError(error); }
  }
  const shipped = String(loaded.template.version ?? 1);
  // §6.1, §8 step 2: a named version the build does not ship would fail every fire; refuse it now, with the kernel's code.
  if (namedVersion !== undefined && Number(namedVersion) !== Number(shipped)) {
    throw new ControlError("flow-template-version-missing", `builtin/${templateId}@${namedVersion} was named, but version ${shipped} is installed`);
  }
  return { ...start, template: `builtin/${templateId}@${namedVersion ?? shipped}` };
}

function validateGroupStart(deps: ScheduleValidationDeps, projectId: string, start: Extract<ScheduleStart, { kind: "group" }>): ScheduleStart {
  if (!deps.knownRepository(projectId)) throw new ControlError("control-target-not-allowed", projectId);
  const entry = readEntry(deps.store, start.entryId);
  if (entry === null || entry.state !== "active") throw new ControlError("plan-library-entry-not-found", start.entryId);
  if (entry.projectId !== projectId) throw new ControlError("plan-library-project-mismatch", `${start.entryId} belongs to ${entry.projectId}`);
  if (readVersion(deps.store, start.entryId, start.sha256) === null) throw new ControlError("plan-library-entry-not-found", `${start.entryId}@${start.sha256}`);
  return start;
}

/** §7.2: a slot from before the person's act never fires; `state.tz` is written with it (M-2). */
export function initialiseState(store: ControlStore, cron: string, now: number, prior?: Partial<Pick<ScheduleState, "failureStreak" | "paused" | "pausedReason">>): ScheduleState {
  const calendar = readUsageCalendar(store);
  const spec = validateSchedule(cron, calendar.timeZone);
  const tz = canonicalTimeZone(calendar.timeZone);
  return {
    lastSlot: latestSlot(spec, tz, Number.NEGATIVE_INFINITY, now) ?? now, tz,
    failureStreak: prior?.failureStreak ?? 0, paused: prior?.paused ?? false, pausedReason: prior?.pausedReason ?? null,
  };
}

/** The stored body, checked against its row so a hand-edited DB never acts on another schedule's bytes. */
export function parseScheduleBody(row: { id: unknown; project_id: unknown; kind: unknown; body: unknown }): ScheduleBody {
  let body: ScheduleBody;
  try { body = JSON.parse(String(row.body)) as ScheduleBody; }
  catch { throw new ControlError("recovery-blocked", "schedule-body-invalid"); }
  if (body === null || typeof body !== "object" || body.id !== String(row.id) || body.projectId !== String(row.project_id)
    || body.kind !== String(row.kind) || !SCHEDULE_ID.test(body.id) || (body.start?.kind !== "flow" && body.start?.kind !== "group")
    || body.start.kind !== body.kind || body.state === null || typeof body.state !== "object") {
    throw new ControlError("recovery-blocked", "schedule-body-invalid");
  }
  let tooFrequent: boolean;
  try { tooFrequent = cronTooFrequent(parseCron(String(body.cron))); }
  catch { throw new ControlError("recovery-blocked", "schedule-body-invalid"); }
  // §6's at-most-hourly rule is part of the body's validity, not only of the write that stored it.
  if (tooFrequent) throw new ControlError("recovery-blocked", "schedule-body-invalid");
  if (body.state.tz !== null && typeof body.state.tz !== "string") throw new ControlError("recovery-blocked", "schedule-body-invalid");
  return body;
}
