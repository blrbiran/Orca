/**
 * Dir-requirements spec §9.2: `resolve-folder-change`, the person's answer to a folder change that stopped a dir group's
 * placement. The command only records the answer in `placement.resolution`; the next placement round (dirPlacement.ts)
 * does the git and folder work under the folder lock. Refused (`folder-change-not-pending`) when no stopped change waits,
 * when take-folder is asked of a state other than `folder-changed`, or when withhold has nothing to withhold.
 */
import { applyWebCommand } from "./commandLedger.js";
import { dirWorkspaceOf, readPlacement } from "./dirGroup.js";
import { ControlError } from "./errors.js";
import type { ControlStore } from "./store.js";
import type { FolderChangeAction } from "./webProtocol.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";

export type ResolveFolderChangeCommand = Extract<RawAuthorityCommandV1, { verb: "resolve-folder-change" }>;

const STOPPED = new Set(["folder-changed", "folder-unwritable", "folder-missing"]);

export function applyResolveFolderChange(deps: { store: ControlStore }, command: ResolveFolderChangeCommand): CommandSuccessV1 | CommandErrorBodyV1 {
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
    rawCommand: command,
    expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const groupId = command.target.groupId;
      const row = deps.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
      if (!row) throw new ControlError("group-not-found");
      const group = JSON.parse(String(row.body)) as Record<string, unknown>;
      // A dir group's placement record exists from its export on; any other group has no folder change to answer.
      const placement = dirWorkspaceOf(group) === null ? null : readPlacement(group.placement);
      if (placement === null || !STOPPED.has(placement.state)) throw new ControlError("folder-change-not-pending");
      const action = (context.effectiveCommand.payload as { action: FolderChangeAction }).action;
      if (action === "take-folder" && placement.state !== "folder-changed") throw new ControlError("folder-change-not-pending");
      if (action === "withhold" && placement.changedTotal + placement.unwritableTotal === 0) throw new ControlError("folder-change-not-pending");
      const next = { ...placement, resolution: { id: command.commandId, action, by: command.actorId, at: deps.store.now() } };
      deps.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify({ ...group, placement: next }), groupId);
      return { status: 200, body: {
        schema: "orca-command-success-v1", commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId,
        verb: context.rawCommand.verb, target: context.rawCommand.target, commandRevision: context.nextCommandRevision, projectionSeq: context.nextProjectionSeq,
        effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash,
        result: { kind: "folder-change-resolved", groupId, action },
      } };
    },
  }).body;
}
