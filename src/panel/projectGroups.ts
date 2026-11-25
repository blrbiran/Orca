/**
 * Project remove spec 2026-11-25 §6 (tester #470, session 5d3d0c09): what `orca project remove` asks of the control
 * store -- a project's groups and whether each carries the terminal mark -- and the one way it archives one: the
 * existing `archive-group` command, as the panel's operator, under the remover's principal (as the debug-group archive on
 * a correction's withdrawal does). Nothing here decides which groups may be archived; archive's own refusals do.
 */
import { terminalKindOf } from "../control/archivedMark.js";
import type { ArchiveGroupCommand } from "../control/archiveGroup.js";
import { withCommandContext } from "../control/commandClient.js";
import { readVersions } from "../control/queries.js";
import type { ControlStore } from "../control/store.js";
import { groupRepoIdOf } from "../control/usageLedger.js";
import { compareText } from "../control/webProtocol.js";
import type { WebCommandResult } from "../control/webService.js";
import { ensurePanelOperatorId } from "./controlApi.js";

export interface ProjectGroup { groupId: string; status: string; archived: boolean }
export type ArchiveOutcome = { ok: true } | { ok: false; code: string; message: string };

export interface ProjectGroupsPort {
  /** Every group of control repository `repoId`, by id; `archived` is the terminal mark (archived or closed). */
  of(repoId: string): ProjectGroup[];
  /** Archive one group through `archive-group`; `client` and `principal` ride beside the command (accounts D3). */
  archive(groupId: string, by: { client: string; principal: string; commandId: string }): ArchiveOutcome;
}

export function projectGroupsPort(store: ControlStore, service: { archiveGroup(command: ArchiveGroupCommand): WebCommandResult }): ProjectGroupsPort {
  return {
    of(repoId) {
      const groups: ProjectGroup[] = [];
      for (const row of store.db.prepare("SELECT id, body FROM groups").all()) {
        const body = JSON.parse(String(row.body)) as Record<string, unknown>;
        if (groupRepoIdOf(body) !== repoId) continue;
        let archived: boolean;
        // A mark that does not parse is not "archived": the group counts as one to archive, and archive names the fault.
        try { archived = terminalKindOf(body) !== null; } catch { archived = false; }
        groups.push({ groupId: String(row.id), status: typeof body.status === "string" ? body.status : "unknown", archived });
      }
      return groups.sort((a, b) => compareText(a.groupId, b.groupId));
    },
    archive(groupId, by) {
      const command: ArchiveGroupCommand = {
        schema: "orca-raw-command-v1", commandId: by.commandId, actorId: ensurePanelOperatorId(store),
        expectedRevision: readVersions(store, groupId).commandRevision, verb: "archive-group", target: { kind: "group", groupId }, payload: {},
      };
      const outcome = withCommandContext(command.commandId, { client: by.client, principal: by.principal }, () => service.archiveGroup(command));
      if ("error" in outcome) return { ok: false, code: outcome.error.code, message: outcome.error.message };
      return { ok: true };
    },
  };
}
