/**
 * Scheduled flows and groups spec 2026-10-24 §6, §11.1, plan B2-B4: the schedule verbs. Each is one command on its own
 * `@schedule:<id>` scope (revision = the `schedules` row's, 0 while there is none), except `schedule-from-group`, which
 * targets the source group and pins the version it saves in the same transaction. Every check runs inside the ledger's
 * transaction: a refusal books its code and writes nothing, and a replay answers the first outcome. `by`/`via` are the
 * route's attribution, stored on every write.
 */
import { canonicalBytes } from "../canonicalJson.js";
import { applyWebCommand, preflightWebCommand, type WebCommandContext } from "../commandLedger.js";
import { commandAttributionFor } from "../commandClient.js";
import { ControlError } from "../errors.js";
import { readArchivedPlan } from "../queries.js";
import { readGroupBody } from "../stopIntent.js";
import { readGroupIntegration } from "../integrationScheme.js";
import type { ControlStore } from "../store.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "../webProtocol.js";
import { libraryEntryId } from "../planLibrary/commands.js";
import { canonicalPlanDoc, docFromArchivedPlan } from "../planLibrary/codec.js";
import { appendVersion, insertEntry } from "../planLibrary/store.js";
import { initialiseState, scheduleIdFor, SCHEDULE_ID, SCHEDULE_LIMIT, validateStart, type ScheduleBody, type ScheduleStart } from "./model.js";
import { insertSchedule, liveScheduleCount, markRemoved, readSchedule, writeSchedule } from "./store.js";

export const SCHEDULE_VERBS = ["schedule-set", "schedule-enable", "schedule-remove", "schedule-resume", "schedule-from-group"] as const;
export type ScheduleCommand = Extract<RawAuthorityCommandV1, { verb: (typeof SCHEDULE_VERBS)[number] }>;
type Result = Extract<CommandSuccessV1["result"], { kind: `schedule-${string}` }>;

export interface ScheduleDeps {
  store: ControlStore;
  flowProjects?: () => ReadonlyArray<{ repoId: string; path: string }>;
  knownRepository?: (repoId: string) => boolean;
  resolveRepository?: (repoId: string) => string;
  now?: () => Date;
}

const at = (deps: ScheduleDeps): number => (deps.now ?? (() => new Date()))().getTime();

function success(context: WebCommandContext, result: Result, revision: number, projectionSeq: number | null): { status: number; body: CommandSuccessV1 } {
  return { status: 200, body: {
    schema: "orca-command-success-v1", commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId,
    verb: context.rawCommand.verb, target: context.rawCommand.target,
    commandRevision: revision, projectionSeq,
    effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash, result,
  } };
}

function scheduleTarget(command: ScheduleCommand): string {
  if (command.target.kind !== "schedule") throw new ControlError("control-target-not-allowed");
  return command.target.scheduleId;
}

function requireLive(store: ControlStore, scheduleId: string) {
  const row = readSchedule(store, scheduleId);
  if (row === null || row.removed) throw new ControlError("control-target-not-allowed", scheduleId);
  return row;
}

function checkId(scheduleId: string): string {
  if (!SCHEDULE_ID.test(scheduleId)) throw new ControlError("control-argument-invalid", "schedule-id");
  return scheduleId;
}

function makeBody(deps: ScheduleDeps, input: { id: string; projectId: string; name: string; cron: string; enabled: boolean; start: ScheduleStart; who: { by: string; via: string }; now: number }): ScheduleBody {
  return {
    id: input.id, projectId: input.projectId, name: input.name, kind: input.start.kind, cron: input.cron, enabled: input.enabled, start: input.start,
    createdBy: input.who.by, createdVia: input.who.via, createdAt: input.now,
    updatedBy: input.who.by, updatedVia: input.who.via, updatedAt: input.now,
    enabledBy: input.who.by, enabledVia: input.who.via, enabledAt: input.now,
    state: initialiseState(deps.store, input.cron, input.now),
  };
}

function validationDeps(deps: ScheduleDeps) {
  return { store: deps.store, flowProjects: deps.flowProjects ?? (() => []), knownRepository: deps.knownRepository ?? (() => false) };
}

function set(deps: ScheduleDeps, context: WebCommandContext, command: Extract<ScheduleCommand, { verb: "schedule-set" }>): { status: number; body: CommandSuccessV1 } {
  const scheduleId = checkId(scheduleTarget(command));
  const payload = command.payload;
  const who = commandAttributionFor(command.commandId, command.actorId);
  const now = at(deps);
  const row = readSchedule(deps.store, scheduleId);
  if ("set" in payload) {
    if (row === null || row.removed) throw new ControlError("control-target-not-allowed", scheduleId);
    const next = structuredClone(row.body);
    let moved = false;
    if (payload.set.name !== undefined && payload.set.name !== next.name) { next.name = payload.set.name; moved = true; }
    if (payload.set.cron !== undefined && payload.set.cron !== next.cron) {
      next.cron = payload.set.cron;
      next.state = initialiseState(deps.store, next.cron, now, next.state);
      moved = true;
    }
    if (payload.set.start !== undefined) {
      const start = validateStart(validationDeps(deps), row.projectId, payload.set.start);
      if (start.kind !== row.kind) throw new ControlError("control-argument-invalid", "start-kind");
      if (!canonicalBytes(start).equals(canonicalBytes(next.start))) { next.start = start; moved = true; }
    }
    if (!moved) throw new ControlError("no-op-command");
    next.updatedBy = who.by; next.updatedVia = who.via; next.updatedAt = now;
    writeSchedule(deps.store, scheduleId, { revision: context.nextCommandRevision, body: next });
    return success(context, { kind: "schedule-set", scheduleId }, context.nextCommandRevision, null);
  }
  if (row !== null) throw new ControlError("control-argument-invalid", "schedule-exists");
  if (liveScheduleCount(deps.store, payload.projectId) >= SCHEDULE_LIMIT) throw new ControlError("schedule-limit", `${SCHEDULE_LIMIT}`);
  const start = validateStart(validationDeps(deps), payload.projectId, payload.start);
  const body = makeBody(deps, { id: scheduleId, projectId: payload.projectId, name: payload.name, cron: payload.cron, enabled: payload.enabled, start, who, now });
  insertSchedule(deps.store, { id: scheduleId, projectId: payload.projectId, kind: body.kind, revision: context.nextCommandRevision, body });
  return success(context, { kind: "schedule-set", scheduleId }, context.nextCommandRevision, null);
}

function enable(deps: ScheduleDeps, context: WebCommandContext, command: Extract<ScheduleCommand, { verb: "schedule-enable" }>): { status: number; body: CommandSuccessV1 } {
  const scheduleId = checkId(scheduleTarget(command));
  const row = requireLive(deps.store, scheduleId);
  if (row.body.enabled === command.payload.enabled) throw new ControlError("no-op-command");
  const who = commandAttributionFor(command.commandId, command.actorId);
  const now = at(deps);
  const next = structuredClone(row.body);
  next.enabled = command.payload.enabled;
  next.updatedBy = who.by; next.updatedVia = who.via; next.updatedAt = now;
  // §7.2: enabling after a disable starts from now; a slot from before the person's act never fires.
  if (command.payload.enabled) {
    next.enabledBy = who.by; next.enabledVia = who.via; next.enabledAt = now;
    next.state = initialiseState(deps.store, next.cron, now, next.state);
  }
  writeSchedule(deps.store, scheduleId, { revision: context.nextCommandRevision, body: next });
  return success(context, { kind: "schedule-enabled", scheduleId, enabled: next.enabled }, context.nextCommandRevision, null);
}

function remove(deps: ScheduleDeps, context: WebCommandContext, command: Extract<ScheduleCommand, { verb: "schedule-remove" }>): { status: number; body: CommandSuccessV1 } {
  const scheduleId = checkId(scheduleTarget(command));
  const row = readSchedule(deps.store, scheduleId);
  if (row === null || row.removed) throw new ControlError("no-op-command");
  const who = commandAttributionFor(command.commandId, command.actorId);
  const next = structuredClone(row.body);
  next.updatedBy = who.by; next.updatedVia = who.via; next.updatedAt = at(deps);
  markRemoved(deps.store, scheduleId, { revision: context.nextCommandRevision, body: next });
  return success(context, { kind: "schedule-removed", scheduleId }, context.nextCommandRevision, null);
}

function resume(deps: ScheduleDeps, context: WebCommandContext, command: Extract<ScheduleCommand, { verb: "schedule-resume" }>): { status: number; body: CommandSuccessV1 } {
  const scheduleId = checkId(scheduleTarget(command));
  const row = requireLive(deps.store, scheduleId);
  if (!row.body.state.paused) throw new ControlError("no-op-command");
  const who = commandAttributionFor(command.commandId, command.actorId);
  const now = at(deps);
  const next = structuredClone(row.body);
  next.state = initialiseState(deps.store, next.cron, now, { failureStreak: 0, paused: false, pausedReason: null });
  next.updatedBy = who.by; next.updatedVia = who.via; next.updatedAt = now;
  writeSchedule(deps.store, scheduleId, { revision: context.nextCommandRevision, body: next });
  return success(context, { kind: "schedule-resumed", scheduleId }, context.nextCommandRevision, null);
}

/** §11.1: one transaction saves the source plan's new library version and the schedule pinning it. */
function fromGroup(deps: ScheduleDeps, context: WebCommandContext, command: Extract<ScheduleCommand, { verb: "schedule-from-group" }>): { status: number; body: CommandSuccessV1 } {
  if (command.target.kind !== "group") throw new ControlError("control-target-not-allowed");
  const groupId = command.target.groupId;
  const payload = command.payload;
  const scheduleId = checkId(payload.scheduleId);
  if (readSchedule(deps.store, scheduleId) !== null) throw new ControlError("control-argument-invalid", "schedule-exists");
  const archived = readArchivedPlan(deps.store, groupId);
  const projectId = archived.plan.repoId;
  if ((deps.knownRepository ?? (() => false))(projectId) === false) throw new ControlError("control-target-not-allowed", projectId);
  const repositoryPath = deps.resolveRepository?.(projectId);
  if (repositoryPath === undefined) throw new ControlError("control-target-not-allowed", projectId);
  if (liveScheduleCount(deps.store, projectId) >= SCHEDULE_LIMIT) throw new ControlError("schedule-limit", `${SCHEDULE_LIMIT}`);
  const who = commandAttributionFor(command.commandId, command.actorId);
  const now = at(deps);
  const entryId = libraryEntryId(command.commandId);
  insertEntry(deps.store, { id: entryId, projectId, name: payload.name, by: who.by, via: who.via, at: now });
  const canonical = canonicalPlanDoc(docFromArchivedPlan(archived.plan), repositoryPath);
  const appended = appendVersion(deps.store, {
    entryId, doc: canonical.bytes, origin: { kind: "group", groupId, planHash: archived.planHash }, by: who.by, via: who.via, at: now,
  });
  const source = readGroupIntegration(readGroupBody(deps.store, groupId))?.scheme ?? null;
  const start: ScheduleStart = {
    kind: "group", entryId, sha256: appended.sha256, tokenLimit: payload.tokenLimit ?? null,
    integration: source === null || source.delivery === "keep" ? null : source,
  };
  const body = makeBody(deps, { id: scheduleId, projectId, name: payload.name, cron: payload.cron, enabled: payload.enabled, start, who, now });
  insertSchedule(deps.store, { id: scheduleId, projectId, kind: "group", revision: 1, body });
  // The command's scope is the source group's, whose revision and projection the (unchanged) group still has.
  return success(context, { kind: "schedule-set", scheduleId }, context.currentCommandRevision, context.currentProjectionSeq);
}

function act(deps: ScheduleDeps, context: WebCommandContext, command: ScheduleCommand): { status: number; body: CommandSuccessV1 } {
  switch (command.verb) {
    case "schedule-set": return set(deps, context, command);
    case "schedule-enable": return enable(deps, context, command);
    case "schedule-remove": return remove(deps, context, command);
    case "schedule-resume": return resume(deps, context, command);
    case "schedule-from-group": return fromGroup(deps, context, command);
  }
}

export function applyScheduleCommand(deps: ScheduleDeps, command: ScheduleCommand): CommandSuccessV1 | CommandErrorBodyV1 {
  const replay = preflightWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, command); if (replay) return replay.body;
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
    rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }) as never,
    authorityChanged: false, projectionGroupIds: [],
    apply: (context) => act(deps, context, command),
  }).body;
}

export { scheduleIdFor };
