import { applyWebCommand } from "./commandLedger.js";
import { dirWorkspaceOf, readPlacement } from "./dirGroup.js";
import { ControlError } from "./errors.js";
import { groupExecutionPendingInStore } from "./executionPending.js";
import { readGroupIntegration } from "./integrationScheme.js";
import { readGroupOrchestration } from "./orchestration.js";
import type { ControlStore } from "./store.js";
import { groupRepoIdOf } from "./usageLedger.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";
import { workBranchRef } from "./workspace.js";
import { flowChildStartPoint } from "../flow/groups.js";

/**
 * Kanban spec 2026-10-20 §3.3-§3.4 and §9a items 1 and 5: v1 edges between groups come from the person only. An edge
 * says `from` (the prerequisite) must be done before `to` (the dependent) starts. Ordering otherwise comes from nothing:
 * groups run in parallel and conflicts are resolved when they land. Every rule here is code (Rule 5).
 *
 * Done (§9a.1): every task of the prerequisite is done, and -- when its delivery is `local` -- its work is integrated
 * into the target (nothing pending, no conflict). A prerequisite that is not delivered locally is done once its tasks
 * are: the dependent then branches from the prerequisite's `orca/<g>` branch (stacked), so no dependency ever waits for
 * a person to merge. Two such prerequisites cannot both be stacked on, so that edge is refused (builder's call, §11).
 */
export type AddGroupDependencyCommand = Extract<RawAuthorityCommandV1, { verb: "add-group-dependency" }>;
export type RemoveGroupDependencyCommand = Extract<RawAuthorityCommandV1, { verb: "remove-group-dependency" }>;

/** The direct prerequisites of a group, in the order they were added. */
export function prerequisitesOf(store: ControlStore, groupId: string): string[] {
  return store.db.prepare("SELECT from_group FROM group_edges WHERE to_group=? ORDER BY rowid").all(groupId).map((row) => String(row.from_group));
}

function groupBody(store: ControlStore, groupId: string): Record<string, unknown> | null {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  return row === undefined ? null : JSON.parse(String(row.body)) as Record<string, unknown>;
}

function tasksAllDone(store: ControlStore, groupId: string): boolean {
  const statuses = store.db.prepare("SELECT body FROM work_items WHERE group_id=?").all(groupId)
    .map((row) => JSON.parse(String(row.body)) as { kind?: unknown; status?: unknown })
    .filter((work) => work.kind === "task").map((work) => work.status);
  return statuses.length > 0 && statuses.every((status) => status === "done" || status === "completed");
}

/**
 * Delivered locally: a non-keep record whose scheme delivers into a local target branch. Dir-requirements spec §7: a dir
 * group too -- its work reaches its folder by placement, so a dependent never stacks on its work branch.
 */
function deliversLocally(group: Record<string, unknown>): boolean {
  return dirWorkspaceOf(group) !== null || readGroupIntegration(group)?.scheme.delivery === "local";
}

/**
 * Dir-requirements spec §7, §6.5: a dir group's placement has caught up with its landings -- idle, nothing owed, the
 * placed tip is the landed tip. Read from the DB only (the landings record `landedTip`), never from git.
 */
function dirPlacementCaughtUp(group: Record<string, unknown>): boolean {
  const placement = readPlacement(group.placement);
  return placement !== null && placement.state === "idle" && placement.pending === null && placement.tip === placement.landedTip;
}

export function prerequisiteDone(store: ControlStore, groupId: string): boolean {
  const group = groupBody(store, groupId);
  if (group === null || !tasksAllDone(store, groupId)) return false;
  if (dirWorkspaceOf(group) !== null) return dirPlacementCaughtUp(group);
  if (!deliversLocally(group)) return true;
  const integration = readGroupIntegration(group)!;
  return integration.lastIntegrated !== null && integration.pending === null && integration.conflict === null && integration.state === "idle";
}

/** The orchestrator's and the board's answer (orchestration.ts PrerequisiteReader): direct prerequisites not done yet. */
export function waitingPrerequisites(store: ControlStore, groupId: string): string[] {
  return prerequisitesOf(store, groupId).filter((prerequisite) => !prerequisiteDone(store, prerequisite));
}

/**
 * §9a.1: where the dependent's work branch starts. The one prerequisite not delivered locally (its work is only on its
 * `orca/<g>` branch); null (the target's HEAD, as before) when every prerequisite is delivered locally or there is none.
 */
export function stackBaseOf(store: ControlStore, groupId: string): string | null {
  // Flow engine spec §5.3: a flow step's child group starts at the composition it was opened on.
  const composed = flowChildStartPoint(store, groupId);
  if (composed !== null) return composed;
  // System debug task spec 2026-10-21 §3.2: a ladder debug group starts from its original group's branch.
  const stackOn = (groupBody(store, groupId)?.systemDebug as { stackOn?: unknown } | undefined)?.stackOn;
  if (typeof stackOn === "string") return workBranchRef(stackOn);
  const stacked = prerequisitesOf(store, groupId).filter((prerequisite) => {
    const group = groupBody(store, prerequisite);
    return group !== null && !deliversLocally(group);
  });
  return stacked.length === 1 ? workBranchRef(stacked[0]!) : null;
}

/** Whether `target` is reachable from `from` by following prerequisites (from → its prerequisites → theirs …). */
function reaches(store: ControlStore, from: string, target: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === target) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...prerequisitesOf(store, current));
  }
  return false;
}

const repoOf = groupRepoIdOf;

function dependentStarted(store: ControlStore, groupId: string, group: Record<string, unknown>): boolean {
  if (["running", "review", "done"].includes(String(group.status))) return true;
  if ((readGroupOrchestration(store, groupId)?.startedRevision ?? null) !== null) return true;
  return group.status === "ready" && groupExecutionPendingInStore(store, groupId);
}

function success(context: Parameters<Parameters<typeof applyWebCommand>[1]["apply"]>[0], result: CommandSuccessV1["result"]) {
  return { status: 200, body: {
    schema: "orca-command-success-v1" as const, commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId,
    verb: context.rawCommand.verb, target: context.rawCommand.target, commandRevision: context.nextCommandRevision, projectionSeq: context.nextProjectionSeq,
    effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash, result,
  } satisfies CommandSuccessV1 };
}

/** The dependent is the command's target group (its revision); the prerequisite is named in the payload. */
export function applyAddGroupDependency(deps: { store: ControlStore }, command: AddGroupDependencyCommand): CommandSuccessV1 | CommandErrorBodyV1 {
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
    rawCommand: command,
    expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const store = deps.store, dependent = command.target.groupId, prerequisite = command.payload.dependsOn;
      const group = groupBody(store, dependent);
      if (group === null) throw new ControlError("group-not-found");
      if (prerequisite === dependent) throw new ControlError("group-edge-self");
      const before = groupBody(store, prerequisite);
      if (before === null) throw new ControlError("group-edge-prerequisite-not-found", prerequisite);
      if (repoOf(before) !== repoOf(group)) throw new ControlError("group-edge-repository-mismatch", `${repoOf(before)}:${repoOf(group)}`);
      if (store.db.prepare("SELECT 1 FROM group_edges WHERE from_group=? AND to_group=?").get(prerequisite, dependent)) throw new ControlError("no-op-command");
      if (dependentStarted(store, dependent, group)) throw new ControlError("group-edge-dependent-started");
      // A cycle: the prerequisite already (transitively) waits on the dependent.
      if (reaches(store, prerequisite, dependent)) throw new ControlError("group-edge-cycle");
      const stacked = [...prerequisitesOf(store, dependent), prerequisite].filter((id) => { const body = groupBody(store, id); return body !== null && !deliversLocally(body); });
      if (stacked.length > 1) throw new ControlError("group-edge-stack-ambiguous", stacked.join(","));
      store.db.prepare("INSERT INTO group_edges(from_group,to_group,body) VALUES (?,?,?)")
        .run(prerequisite, dependent, JSON.stringify({ by: context.rawCommand.actorId, commandId: context.rawCommand.commandId, at: store.now() }));
      return success(context, { kind: "group-dependency-added", groupId: dependent, dependsOn: prerequisite });
    },
  }).body;
}

export function applyRemoveGroupDependency(deps: { store: ControlStore }, command: RemoveGroupDependencyCommand): CommandSuccessV1 | CommandErrorBodyV1 {
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
    rawCommand: command,
    expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const store = deps.store, dependent = command.target.groupId, prerequisite = command.payload.dependsOn;
      if (groupBody(store, dependent) === null) throw new ControlError("group-not-found");
      if (Number(store.db.prepare("DELETE FROM group_edges WHERE from_group=? AND to_group=?").run(prerequisite, dependent).changes) === 0) throw new ControlError("no-op-command");
      return success(context, { kind: "group-dependency-removed", groupId: dependent, dependsOn: prerequisite });
    },
  }).body;
}
