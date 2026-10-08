import { applyWebCommand } from "./commandLedger.js";
import { canonicalBytes } from "./canonicalJson.js";
import { ControlError } from "./errors.js";
import { newGroupIntegration, readGroupIntegration, readIntegrationDefault, schemeHash, type IntegrationScheme } from "./integrationScheme.js";
import { readRepositorySettingsBody, writeRepositorySettingsBody, type RepositorySettingsBody } from "./workspaceSettings.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { ControlStore } from "./store.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";

/** Integration spec §3.4: the integration verbs' apply functions, each run inside applyWebCommand's transaction. */
export type SetIntegrationSchemeCommand = Extract<RawAuthorityCommandV1, { verb: "set-integration-scheme" }>;
export type SetGroupIntegrationCommand = Extract<RawAuthorityCommandV1, { verb: "set-group-integration" }>;

/**
 * Integration spec §3.1, §3.3: sets the repository's default scheme under the settings body's revision, keeping the
 * body's workspace mode. `failedCheck` is what checkScheme found before the transaction (null: passed); a failure is
 * refused here as integration-invalid naming the check. Setting keep removes the field (ruling R5).
 */
export function applySetIntegrationScheme(
  deps: { store: ControlStore; admissionGate?: AdmissionGate; knownRepository(repoId: string): boolean },
  command: SetIntegrationSchemeCommand,
  failedCheck: string | null = null,
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
        if (failedCheck !== null) throw new ControlError("integration-invalid", failedCheck);
        const integration = (context.effectiveCommand.payload as { integration: IntegrationScheme }).integration;
        if (canonicalBytes(readIntegrationDefault(deps.store, target.repoId).scheme).equals(canonicalBytes(integration))) throw new ControlError("no-op-command");
        // The body's other field (the workspace mode; no row is worktree, execution driver spec §3.2) is kept.
        const workspaceMode = readRepositorySettingsBody(deps.store, target.repoId)?.workspaceMode ?? "worktree";
        const next: RepositorySettingsBody = { workspaceMode, revision: context.nextCommandRevision, ...(integration.delivery === "keep" ? {} : { integration }) };
        writeRepositorySettingsBody(deps.store, target.repoId, next);
        return { status: 200, body: {
          schema: "orca-command-success-v1", commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId,
          verb: context.rawCommand.verb, target: context.rawCommand.target, commandRevision: context.nextCommandRevision, projectionSeq: null,
          effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash,
          result: { kind: "integration-scheme-set", repoId: target.repoId, integration },
        } };
      },
    }).body;
  } finally { release?.(); }
}

/**
 * Integration spec §3.1, §3.3: sets a group's copy of the scheme. Before confirm it edits the copy the confirm will
 * approve; once the proposal is confirmed the command is itself the approval (H3), so the new scheme is frozen at once,
 * applies from the next integration on and keeps what was already integrated. Refused integration-busy while a
 * resolution runs; any other state (a conflict, a block) is reset to idle. Keep removes the field (ruling R5).
 * `failedCheck` is what checkScheme found before the transaction (null: passed).
 */
export function applySetGroupIntegration(
  deps: { store: ControlStore },
  command: SetGroupIntegrationCommand,
  failedCheck: string | null = null,
): CommandSuccessV1 | CommandErrorBodyV1 {
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
    rawCommand: command,
    expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const groupId = command.target.groupId;
      const row = deps.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
      if (!row) throw new ControlError("group-not-found");
      const group = JSON.parse(String(row.body)) as Record<string, unknown>;
      // A clarifying group has no plan yet; it gets its copy when its split is accepted.
      if (group.status === "clarifying") throw new ControlError("group-state-invalid");
      if (failedCheck !== null) throw new ControlError("integration-invalid", failedCheck);
      const current = readGroupIntegration(group);
      if (current?.state === "resolving") throw new ControlError("integration-busy");
      const scheme = (context.effectiveCommand.payload as { integration: IntegrationScheme }).integration;
      if (canonicalBytes(current?.scheme ?? { delivery: "keep" }).equals(canonicalBytes(scheme))) throw new ControlError("no-op-command");
      const frozen = (group.proposal as { state?: unknown } | undefined)?.state === "confirmed";
      if (scheme.delivery === "keep") delete group.integration;
      else if (current === null) group.integration = { ...newGroupIntegration(scheme)!, frozen };
      else group.integration = { ...current, scheme, schemeHash: schemeHash(scheme), frozen, state: "idle", reason: null, pending: null, conflict: null, retryAfter: null, transient: 0 };
      deps.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(group), groupId);
      return { status: 200, body: {
        schema: "orca-command-success-v1", commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId,
        verb: context.rawCommand.verb, target: context.rawCommand.target, commandRevision: context.nextCommandRevision, projectionSeq: context.nextProjectionSeq,
        effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash,
        result: { kind: "group-integration-set", groupId, integration: scheme },
      } };
    },
  }).body;
}
