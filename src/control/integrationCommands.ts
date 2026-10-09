import { recordActivity } from "./activity.js";
import { applyWebCommand } from "./commandLedger.js";
import { canonicalBytes } from "./canonicalJson.js";
import { ControlError } from "./errors.js";
import { approveResolution, type ResolutionPrepared } from "./integrationResolve.js";
import { ENVIRONMENT_CHECKS, newGroupIntegration, readGroupIntegration, readIntegrationDefault, schemeHash, type IntegrationScheme } from "./integrationScheme.js";
import { readRepositorySettingsBody, writeRepositorySettingsBody, type RepositorySettingsBody } from "./workspaceSettings.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { ControlStore } from "./store.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";

/** Integration spec §3.4: the integration verbs' apply functions, each run inside applyWebCommand's transaction. */
export type SetIntegrationSchemeCommand = Extract<RawAuthorityCommandV1, { verb: "set-integration-scheme" }>;
export type SetGroupIntegrationCommand = Extract<RawAuthorityCommandV1, { verb: "set-group-integration" }>;
export type RetryIntegrationCommand = Extract<RawAuthorityCommandV1, { verb: "retry-integration" }>;
export type ResolveIntegrationConflictCommand = Extract<RawAuthorityCommandV1, { verb: "resolve-integration-conflict" }>;

/**
 * What a setter's pre-transaction check found, refused by name: a bad name or remote is the scheme's own fault
 * (integration-invalid); git not answering or the repository's path not resolving is not (integration-preflight-failed).
 */
function refuseFailedCheck(failedCheck: string | null): void {
  if (failedCheck !== null) throw new ControlError(ENVIRONMENT_CHECKS.has(failedCheck) ? "integration-preflight-failed" : "integration-invalid", failedCheck);
}

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
        refuseFailedCheck(failedCheck);
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
      refuseFailedCheck(failedCheck);
      const current = readGroupIntegration(group);
      if (current?.state === "resolving") throw new ControlError("integration-busy");
      const scheme = (context.effectiveCommand.payload as { integration: IntegrationScheme }).integration;
      if (canonicalBytes(current?.scheme ?? { delivery: "keep" }).equals(canonicalBytes(scheme))) throw new ControlError("no-op-command");
      const frozen = (group.proposal as { state?: unknown } | undefined)?.state === "confirmed";
      if (scheme.delivery === "keep") delete group.integration;
      else if (current === null) group.integration = { ...newGroupIntegration(scheme)!, frozen };
      else {
        // A PR is a branch of one remote into one target: another delivery, target or remote is another PR (fix round 1,
        // R2). A trigger change keeps it. Final review I1: it is another destination too -- what reached the old one is
        // not in the new one, so the new one starts from scratch (a squash takes its merge base from the target).
        const sameDestination = current.scheme.delivery === scheme.delivery && current.scheme.target === scheme.target
          && ("remote" in current.scheme ? current.scheme.remote : null) === ("remote" in scheme ? scheme.remote : null);
        group.integration = { ...current, scheme, schemeHash: schemeHash(scheme), frozen, state: "idle", reason: null, pending: null, conflict: null, retryAfter: null, transient: 0,
          ...(sameDestination ? {} : { lastIntegrated: null, integratedCommit: null, pr: null }) };
      }
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

/**
 * Integration spec §6.5: a blocked or conflicted integration goes back to idle and is tried again at the next round
 * (refused integration-not-blocked otherwise). The conflict record is kept: it numbers the next attempt (§7).
 */
export function applyRetryIntegration(deps: { store: ControlStore }, command: RetryIntegrationCommand): CommandSuccessV1 | CommandErrorBodyV1 {
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
    rawCommand: command,
    expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const groupId = command.target.groupId;
      const row = deps.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
      if (!row) throw new ControlError("group-not-found");
      const group = JSON.parse(String(row.body)) as Record<string, unknown>;
      const current = readGroupIntegration(group);
      if (current === null || (current.state !== "blocked" && current.state !== "conflict")) throw new ControlError("integration-not-blocked");
      group.integration = { ...current, state: "idle", reason: null, retryAfter: null, transient: 0 };
      deps.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(group), groupId);
      return { status: 200, body: {
        schema: "orca-command-success-v1", commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId,
        verb: context.rawCommand.verb, target: context.rawCommand.target, commandRevision: context.nextCommandRevision, projectionSeq: context.nextProjectionSeq,
        effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash,
        result: { kind: "integration-retried", groupId },
      } };
    },
  }).body;
}

/**
 * Integration spec §7: an owner's approval of an agent resolving the group's integration conflict. It records the
 * resolution and state `resolving` only; the driver's pass spawns it. `prepared` is what was read before the
 * transaction (the conflict's copy and pinned commit; null: none waits).
 */
export function applyResolveIntegrationConflict(deps: { store: ControlStore }, command: ResolveIntegrationConflictCommand, prepared: ResolutionPrepared | null): CommandSuccessV1 | CommandErrorBodyV1 {
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
    rawCommand: command,
    expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const groupId = command.target.groupId;
      const row = deps.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
      if (!row) throw new ControlError("group-not-found");
      const group = JSON.parse(String(row.body)) as Record<string, unknown>;
      group.integration = approveResolution(deps.store, groupId, group, prepared);
      deps.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(group), groupId);
      // Issue-fixes spec §5.2: the owner's approval is the group entering `resolving`; the settle rows follow in the pass.
      recordActivity(deps.store, { groupId, kind: "integration", body: { state: "resolving", reason: null } });
      return { status: 200, body: {
        schema: "orca-command-success-v1", commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId,
        verb: context.rawCommand.verb, target: context.rawCommand.target, commandRevision: context.nextCommandRevision, projectionSeq: context.nextProjectionSeq,
        effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash,
        result: { kind: "integration-resolution-started", groupId },
      } };
    },
  }).body;
}
