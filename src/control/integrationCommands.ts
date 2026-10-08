import { applyWebCommand } from "./commandLedger.js";
import { canonicalBytes } from "./canonicalJson.js";
import { ControlError } from "./errors.js";
import { readIntegrationDefault, type IntegrationScheme } from "./integrationScheme.js";
import { readRepositorySettingsBody, writeRepositorySettingsBody, type RepositorySettingsBody } from "./workspaceSettings.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { ControlStore } from "./store.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";

/** Integration spec §3.4: the integration verbs' apply functions, each run inside applyWebCommand's transaction. */
export type SetIntegrationSchemeCommand = Extract<RawAuthorityCommandV1, { verb: "set-integration-scheme" }>;

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
