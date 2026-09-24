import { z } from "zod";
import { applyWebCommand } from "./commandLedger.js";
import { canonicalBytes } from "./canonicalJson.js";
import { ControlError } from "./errors.js";
import { safeInteger } from "./schema.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { ControlStore } from "./store.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";

export type WorkspaceMode = "worktree" | "clone";
export interface WorkspaceSetting { workspaceMode: WorkspaceMode; revision: number }
export type SetWorkspaceModeCommand = Extract<RawAuthorityCommandV1, { verb: "set-workspace-mode" }>;

const settingSchema = z.object({ workspaceMode: z.enum(["worktree", "clone"]), revision: safeInteger.positive() }).strict();

/** Execution driver spec §3.2: no row is the default, `worktree` at revision 0. */
export function readWorkspaceSetting(store: ControlStore, repoId: string): WorkspaceSetting {
  const row = store.db.prepare("SELECT body FROM repository_settings WHERE repo_id=?").get(repoId);
  if (!row) return { workspaceMode: "worktree", revision: 0 };
  const parsed = settingSchema.safeParse(JSON.parse(String(row.body)));
  if (!parsed.success) throw new ControlError("recovery-blocked", "repository-settings-invalid");
  return parsed.data;
}

/**
 * spec §3.2: changes the mode only for runs that enter A1 afterwards. A repository the panel was not
 * started with is refused by name; so is setting the mode it already has.
 */
export function applySetWorkspaceMode(
  deps: { store: ControlStore; admissionGate?: AdmissionGate; knownRepository(repoId: string): boolean },
  command: SetWorkspaceModeCommand,
): CommandSuccessV1 | CommandErrorBodyV1 {
  const release = deps.admissionGate?.enter();
  try {
    return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
      rawCommand: command,
      expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      // The setting carries its own revision; no group revision or projection moves.
      authorityChanged: false,
      projectionGroupIds: [],
      apply: (context) => {
        const target = context.rawCommand.target;
        if (target.kind !== "repository" || !deps.knownRepository(target.repoId)) throw new ControlError("control-target-not-allowed");
        const payload = context.effectiveCommand.payload as { workspaceMode: WorkspaceMode };
        if (readWorkspaceSetting(deps.store, target.repoId).workspaceMode === payload.workspaceMode) throw new ControlError("no-op-command");
        const next: WorkspaceSetting = { workspaceMode: payload.workspaceMode, revision: context.nextCommandRevision };
        deps.store.db.prepare("INSERT INTO repository_settings(repo_id,body) VALUES (?,?) ON CONFLICT(repo_id) DO UPDATE SET body=excluded.body")
          .run(target.repoId, canonicalBytes(next).toString("utf8"));
        return { status: 200, body: {
          schema: "orca-command-success-v1", commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId,
          verb: context.rawCommand.verb, target: context.rawCommand.target, commandRevision: context.nextCommandRevision, projectionSeq: null,
          effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash,
          result: { kind: "workspace-mode-set", repoId: target.repoId, workspaceMode: next.workspaceMode },
        } };
      },
    }).body;
  } finally { release?.(); }
}
