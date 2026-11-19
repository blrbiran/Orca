import { recordActivity } from "./activity.js";
import { terminalKindOf } from "./archivedMark.js";
import { applyWebCommand, type WebCommandContext } from "./commandLedger.js";
import { ArchiveRunActiveError, ControlError, type ActiveRunRef } from "./errors.js";
import { recoveryRetryCommand, resumableBlockedRun } from "./driveRecord.js";
import { dirWorkspaceOf } from "./dirGroup.js";
import { acceptanceOf, landedTaskCount } from "./groupAcceptanceRecord.js";
import { multiDirOf } from "./multiGroup.js";
import { readGroupIntegration } from "./integrationScheme.js";
import { pendingRequirementCall, type RequirementTarget } from "./requirementCalls.js";
import { readDraft, readRound, writeDraft, writeRound } from "./requirementRecords.js";
import { deriveStopState, readStopIntent, saveStopIntent } from "./stopIntent.js";
import { flowBlockOf, refuseFlowChild } from "../flow/groups.js";
import { readGroupOrchestration } from "./orchestration.js";
import { readBudgetProposal } from "./queries.js";
import { nextClaimableTask } from "./webDispatch.js";
import type { ControlStore } from "./store.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";

/** Issue-fixes spec §6.3 (ruling H4): a group is archived, never deleted; it keeps every record and takes no new work. */
export type ArchiveGroupCommand = Extract<RawAuthorityCommandV1, { verb: "archive-group" }>;
export type UnarchiveGroupCommand = Extract<RawAuthorityCommandV1, { verb: "unarchive-group" }>;
/**
 * Tester #355 (human ruling 2026-11-19 「同意该方案，同意允许互转」): a done group is closed -- the same terminal mark with
 * `kind: "closed"`, frozen alike -- and unclosed; an archived done group closes (converting), a closed one archives.
 */
export type CloseGroupCommand = Extract<RawAuthorityCommandV1, { verb: "close-group" }>;
export type UncloseGroupCommand = Extract<RawAuthorityCommandV1, { verb: "unclose-group" }>;

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
 * Tester #379: requirement-resplit (requirementResplit.ts) archives the old group with these same refusals.
 */
export function refuseArchive(store: ControlStore, groupId: string, group: Record<string, unknown>): RequirementTarget | null {
  // #370 review 2: a flow child is its flow's to drive, archive included (as retry, continue, abandon and reopen refuse it).
  refuseFlowChild(store, groupId);
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
  const active = store.db.prepare("SELECT id,body FROM runs WHERE group_id=? AND active=1 ORDER BY rowid").all(groupId);
  if (active.length > 0) throw new ArchiveRunActiveError(active.map((row) => activeRunRef(groupId, String(row.id), String(row.body))));
  return pending;
}

/**
 * Tester #292: an active run's state, block point and the one command that moves it, when one does -- a terminal failure's
 * accounting (settle its unknown usage, else close it), or a run blocked where recovery retry resumes it. A run still
 * working, or one whose stop is settling, names none: it ends on its own, or by a stop.
 */
function activeRunRef(groupId: string, runId: string, body: string): ActiveRunRef {
  let run: { state?: unknown; taskId?: unknown; unknown?: { work?: unknown; handoff?: unknown }; drive?: { blockedAt?: unknown; outcome?: unknown } };
  try { run = JSON.parse(body) as typeof run; } catch { return { runId, state: "unreadable", blockedAt: null }; }
  const state = typeof run.state === "string" && run.state.length > 0 ? run.state : "unknown";
  const blockedAt = typeof run.drive?.blockedAt === "string" ? run.drive.blockedAt : null;
  const taskId = typeof run.taskId === "string" ? run.taskId : null;
  const terminalFailure = state === "blocked" && blockedAt === "C" && typeof run.drive?.outcome === "string" && run.drive.outcome !== "succeeded";
  const unknownUsage = (run.unknown?.work === true || run.unknown?.handoff === true) && taskId !== null;
  const settle = `orca task settle-usage ${groupId} ${taskId} --acknowledge charge-remaining-grant`;
  // Tester follow-up K (#272 rest): a run still active once settled-* named nothing; it is read, its unknown usage settled first.
  const next = terminalFailure
    ? unknownUsage ? settle : `orca group close-run ${groupId} --run ${runId}`
    : resumableBlockedRun(run) ? recoveryRetryCommand(runId)
      : state.startsWith("settled-") ? unknownUsage ? settle : `orca run show ${runId}`
        // Tester #332: a landed run whose settle is still running (archive, checkpoint, publish) leaves on its own; the next
        // step is this archive again once it has (a settle that fails blocks the run, and the line above names its retry).
        : state === "landed" || state === "settled" ? `orca group archive ${groupId} once it has settled (orca run show ${runId})` : undefined;
  return { runId, state, blockedAt, ...(next === undefined ? {} : { next }) };
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

/**
 * Tester #370 (human ruling 2026-11-20: the read side plus clearing pending wakes this round; DB `status` convergence is
 * a later design): a group archived or closed takes no new work, so its queued start-family wakes are marked delivered in
 * the same transaction -- the rows stay for audit. `recovery list` therefore reports no `group-archived` deferred wake for
 * a group archived from now on, and the unarchive does not resurrect them (nothing is re-armed). Only the kinds the pump
 * would claim as a start are retired; a queued estimate's wake is not one of them -- it is held, not dropped, and delivers
 * once the group is unarchived (spec §6.3).
 */
function clearPendingStartWakes(store: ControlStore, groupId: string): void {
  store.db.prepare("UPDATE scheduler_wakes SET delivered=1 WHERE group_id=? AND delivered=0 AND kind IN ('start','no-start','resume')").run(groupId);
}

/**
 * Spec §6.3: marks the body `archived: { at, actor }` and writes an `archived` activity row in the same transaction.
 * Tester #355: on a closed group (the ledger admits archive-group there) the same write converts it to archived, after the
 * same refusals.
 */
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
      clearPendingStartWakes(deps.store, groupId);
      recordActivity(deps.store, { groupId, kind: "archived", body: {} });
      return success(context, { kind: "archived", groupId, at });
    },
  }).body;
}

/** executionDriver.ts DISPATCHABLE_GROUP_STATES (not imported: the driver module is heavy and this one is a command). */
const DISPATCHABLE = new Set(["ready", "running", "review"]);

/**
 * Tester #370 (correction 2026-11-18, second form; review 2): whether the unarchived group would run on its own. Never a
 * flow child (its flow drives it) or a group already under a stop intent (that stop holds it already). Otherwise:
 * - any queued start, no-start re-arm or resume wake -- whatever the group's status or confirmation, since the wake is
 *   what the pump claims from;
 * - a confirmed never-started ready group the auto-start pass would start (orchestration `mode = run`, no start yet),
 *   whatever its slot or prerequisites, which only delay that start;
 * - a dispatchable, confirmed group started before (an earlier start wake) with a claimable task, which
 *   replenishStartWakes re-arms from.
 * A budget proposal or orchestration row that cannot be read counts as absent here (the auto-start pass cannot start from
 * an unreadable row either): the unarchive itself is never refused for it.
 */
function wouldRunOnUnarchive(store: ControlStore, groupId: string, group: Record<string, unknown>): boolean {
  if (flowBlockOf(group)?.role === "child") return false;
  if (store.db.prepare("SELECT 1 FROM stop_intents WHERE group_id=?").get(groupId) !== undefined) return false;
  if (store.db.prepare("SELECT 1 FROM scheduler_wakes WHERE group_id=? AND kind IN ('start','no-start','resume') AND delivered=0").get(groupId) !== undefined) return true;
  let orchestration: ReturnType<typeof readGroupOrchestration>;
  try { orchestration = readGroupOrchestration(store, groupId); } catch { orchestration = null; }
  if (orchestration?.mode === "run" && orchestration.startedRevision === null && group.status === "ready") return true;
  if (!DISPATCHABLE.has(String(group.status))) return false;
  if (store.db.prepare("SELECT 1 FROM scheduler_wakes WHERE group_id=? AND kind='start'").get(groupId) === undefined) return false;
  let confirmed: boolean;
  try { confirmed = readBudgetProposal(store, groupId).state === "confirmed"; } catch { confirmed = false; }
  return confirmed && nextClaimableTask(store, groupId, group) !== null;
}

/**
 * Tester #355: marks a done group `archived: { at, actor, kind: "closed" }` and writes a `closed` activity row. Only a done
 * group closes (group-not-done otherwise); the archive refusals apply as well, so a closed group has nothing in motion, and
 * one whose delivery is still owed is refused close-delivery-pending (#355 review I1: owedDelivery).
 * On an archived done group (the ledger admits close-group there) it converts the mark to closed.
 */
export function applyCloseGroup(deps: { store: ControlStore }, command: CloseGroupCommand): CommandSuccessV1 | CommandErrorBodyV1 {
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
    rawCommand: command,
    expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const groupId = command.target.groupId;
      const group = groupBody(deps.store, groupId);
      if (group.status !== "done") throw new ControlError("group-not-done", String(group.status));
      refuseArchive(deps.store, groupId, group);
      const owed = owedDelivery(deps.store, groupId, group);
      if (owed !== null) throw new ControlError("close-delivery-pending", owed);
      const at = deps.store.now();
      group.archived = { at, actor: context.rawCommand.actorId, kind: "closed" };
      deps.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(group), groupId);
      clearPendingStartWakes(deps.store, groupId);
      recordActivity(deps.store, { groupId, kind: "closed", body: {} });
      return success(context, { kind: "closed", groupId, at });
    },
  }).body;
}

/**
 * #355 review (I1): what a done group still owes its delivery, null when nothing. A delivery other than `local` lets the
 * group reach done before it is delivered (groupEdges.ts prerequisiteDone), and the integration pass skips a closed group,
 * so closing it then would freeze the owed delivery silently; close is refused instead (archive stays available). Read
 * from the DB only (a command applies in one transaction, no git child): a frozen record that is not idle (blocked,
 * conflict, resolving), a write-ahead `pending`, a backoff (`retryAfter`), a draft pull request not yet marked ready, or
 * the accepted work-branch tip (the acceptance pass records it for every finished group) not the last one delivered. A
 * group none of whose tasks landed owes nothing (its branch is its base, never carried). Known gap: work a person merged
 * into the target by hand is not seen without git and reads as owed; such a group is archived.
 */
function owedDelivery(store: ControlStore, groupId: string, group: Record<string, unknown>): string | null {
  // A folder or multi-directory group delivers by placement or the multi landing, which its done gate already waits on.
  if (dirWorkspaceOf(group) !== null || multiDirOf(group) !== null) return null;
  const integration = readGroupIntegration(group);
  // keep (no record), or a scheme never confirmed: the integration pass carries nothing for it.
  if (integration === null || !integration.frozen) return null;
  if (integration.state !== "idle") return integration.state;
  if (integration.pending !== null) return "pending";
  if (integration.retryAfter !== null) return "backoff";
  if (integration.pr !== null && !integration.pr.ready) return "pr-draft";
  if (landedTaskCount(store, groupId) === 0) return null;
  const tip = acceptanceOf(group)?.tip ?? null;
  if (tip !== null ? tip !== integration.lastIntegrated : integration.lastIntegrated === null) return "not-delivered";
  return null;
}

/**
 * Spec §6.3 and the #370 correction below: removes a terminal mark of the given kind (refused no-op-command when the group
 * has none; the ledger refuses the other kind by its own code before this), pausing a group that would run on its own.
 */
function removeTerminalMark(store: ControlStore, context: WebCommandContext, groupId: string, kind: "archived" | "closed"): boolean {
  const group = groupBody(store, groupId);
  if (terminalKindOf(group) !== kind) throw new ControlError("no-op-command");
  delete group.archived;
  const pause = wouldRunOnUnarchive(store, groupId, group);
  if (pause) {
    saveStopIntent(store, groupId, "pause", context.nextCommandRevision, { mode: "pause", state: "paused", frozenRunIds: [], acceptedAt: null, deadlineAt: null });
    recordActivity(store, { groupId, kind: "stop", body: { mode: "pause" } });
    group.stopped = true;
  }
  store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(group), groupId);
  recordActivity(store, { groupId, kind: kind === "closed" ? "unclosed" : "unarchived", body: {} });
  return pause;
}

/**
 * Tester #355: removes a closed mark and writes an `unclosed` activity row; the group is done again. The #370 pause rule
 * holds here too (a done group normally has nothing to run, but the same path decides).
 */
export function applyUncloseGroup(deps: { store: ControlStore }, command: UncloseGroupCommand): CommandSuccessV1 | CommandErrorBodyV1 {
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
    rawCommand: command,
    expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const groupId = command.target.groupId;
      const pause = removeTerminalMark(deps.store, context, groupId, "closed");
      return success(context, { kind: "unclosed", groupId, ...(pause ? { paused: true as const } : {}) });
    },
  }).body;
}

/**
 * Spec §6.3: removes the mark (refused no-op-command when there is none) and writes an `unarchived` activity row.
 * Correction 2026-11-18 (#370, human ruling 「unarchive 一个 ready 组时，不应该自动开跑」): a group that would run on its own
 * once unarchived (wouldRunOnUnarchive) is paused in this transaction -- the same pause intent `pause-dispatch` writes, so
 * every wake stays (nothing is deleted) and `orca group resume` starts it the way a resume does -- and the result says
 * so (`paused`), so the receipt names `orca group resume`.
 */
export function applyUnarchiveGroup(deps: { store: ControlStore }, command: UnarchiveGroupCommand): CommandSuccessV1 | CommandErrorBodyV1 {
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
    rawCommand: command,
    expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const groupId = command.target.groupId;
      const pause = removeTerminalMark(deps.store, context, groupId, "archived");
      return success(context, { kind: "unarchived", groupId, ...(pause ? { paused: true as const } : {}) });
    },
  }).body;
}
