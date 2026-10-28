import { recordActivity } from "./activity.js";
import { archivedMarkOf } from "./archivedMark.js";
import { applyWebCommand, type WebCommandContext } from "./commandLedger.js";
import { ControlError } from "./errors.js";
import { readGroupIntegration } from "./integrationScheme.js";
import { pendingRequirementCall, type RequirementTarget } from "./requirementCalls.js";
import { readDraft, readRound, writeDraft, writeRound } from "./requirementRecords.js";
import { deriveStopState, readStopIntent } from "./stopIntent.js";
import type { ControlStore } from "./store.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";

/** Issue-fixes spec §6.3 (ruling H4): a group is archived, never deleted; it keeps every record and takes no new work. */
export type ArchiveGroupCommand = Extract<RawAuthorityCommandV1, { verb: "archive-group" }>;
export type UnarchiveGroupCommand = Extract<RawAuthorityCommandV1, { verb: "unarchive-group" }>;

function success(context: WebCommandContext, result: CommandSuccessV1["result"]): { status: number; body: CommandSuccessV1 } {
  return { status: 200, body: {
    schema: "orca-command-success-v1", commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId,
    verb: context.rawCommand.verb, target: context.rawCommand.target, commandRevision: context.nextCommandRevision, projectionSeq: context.nextProjectionSeq,
    effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash, result,
  } };
}

function groupBody(store: ControlStore, groupId: string): Record<string, unknown> {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  if (!row) throw new ControlError("group-not-found");
  return JSON.parse(String(row.body)) as Record<string, unknown>;
}

/**
 * Spec §6.3: archive is refused while work is in motion, each case by its own code. Order matters for reachability: a
 * running estimate or a pending requirement call also has (or will have) an active run, and a settling handoff always
 * has one, so those are named before the plain active-run guard. A `pause` intent with no active run does not refuse,
 * nor does a handoff stop that has settled -- complete, or partial (a frozen run was settled unrecoverable: terminal,
 * nothing in motion, and no exit leads from it to handoff-complete).
 * The stop state is derived the way groupStopState derives it (the stored body's state can lag the requests it summarises).
 */
function refuseArchive(store: ControlStore, groupId: string, group: Record<string, unknown>): RequirementTarget | null {
  for (const row of store.db.prepare("SELECT state FROM estimates WHERE group_id=?").all(groupId)) {
    if (["running", "start-unknown"].includes(String(row.state))) throw new ControlError("archive-call-in-flight", "estimate");
  }
  // Spec §6.3: this guard is what keeps requirement calls off an archived group -- no call is pending when it is archived,
  // and the ledger gate refuses every requirement command that would queue another.
  // Tester #100 (2026-10-28): a pending round or draft that would not be sent -- parked on `waiting` (unknown usage, the
  // budget) or held by a stop -- is not in flight; it is returned and the archive interrupts it (applyArchiveGroup).
  const pending = group.status === "clarifying" ? pendingRequirementCall(store, groupId) : null;
  if (pending !== null && !parkedRequirementCall(store, groupId, group, pending)) throw new ControlError("archive-call-in-flight", "requirement");
  const intent = readStopIntent(store, groupId);
  if (intent !== null && intent.mode !== "pause") {
    const state = deriveStopState(store, groupId, intent.frozenRunIds);
    if (state !== "handoff-complete" && state !== "handoff-partial") throw new ControlError("archive-stop-pending", `${intent.mode}:${state}`);
  }
  if (readGroupIntegration(group)?.state === "resolving") throw new ControlError("archive-integration-resolving");
  if (store.db.prepare("SELECT id FROM runs WHERE group_id=? AND active=1").get(groupId)) throw new ControlError("archive-run-active");
  return pending;
}

/** A pending call with no run is parked when the claim would not send it: it waits on a reason, or a stop holds the group. */
function parkedRequirementCall(store: ControlStore, groupId: string, group: Record<string, unknown>, target: RequirementTarget): boolean {
  const waiting = target.kind === "round" ? readRound(store, groupId, target.no).waiting : readDraft(store, groupId, target.no).waiting;
  return waiting !== null || group.stopped === true || readStopIntent(store, groupId) !== null;
}

/** Tester #100: the parked round or draft ends interrupted, so the archived group has no pending call (spec §6.3). */
function interruptParkedCall(store: ControlStore, groupId: string, target: RequirementTarget): void {
  if (target.kind === "round") writeRound(store, groupId, { ...readRound(store, groupId, target.no), state: "interrupted", waiting: null });
  else writeDraft(store, groupId, { ...readDraft(store, groupId, target.no), state: "interrupted", waiting: null });
}

/** Spec §6.3: marks the body `archived: { at, actor }` and writes an `archived` activity row in the same transaction. */
export function applyArchiveGroup(deps: { store: ControlStore }, command: ArchiveGroupCommand): CommandSuccessV1 | CommandErrorBodyV1 {
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
    rawCommand: command,
    expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const groupId = command.target.groupId;
      const group = groupBody(deps.store, groupId);
      const parked = refuseArchive(deps.store, groupId, group);
      if (parked !== null) interruptParkedCall(deps.store, groupId, parked);
      const at = deps.store.now();
      group.archived = { at, actor: context.rawCommand.actorId };
      deps.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(group), groupId);
      recordActivity(deps.store, { groupId, kind: "archived", body: {} });
      return success(context, { kind: "archived", groupId, at });
    },
  }).body;
}

/** Spec §6.3: removes the mark (refused no-op-command when there is none) and writes an `unarchived` activity row. */
export function applyUnarchiveGroup(deps: { store: ControlStore }, command: UnarchiveGroupCommand): CommandSuccessV1 | CommandErrorBodyV1 {
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
    rawCommand: command,
    expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const groupId = command.target.groupId;
      const group = groupBody(deps.store, groupId);
      if (archivedMarkOf(group) === null) throw new ControlError("no-op-command");
      delete group.archived;
      deps.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(group), groupId);
      recordActivity(deps.store, { groupId, kind: "unarchived", body: {} });
      return success(context, { kind: "unarchived", groupId });
    },
  }).body;
}
