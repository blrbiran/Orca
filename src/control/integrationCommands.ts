import { recordActivity } from "./activity.js";
import { FLOW_GROUP_DELIVERY_FIXED, isDirFlowGroup } from "../flow/groups.js";
import { applyWebCommand } from "./commandLedger.js";
import { canonicalBytes } from "./canonicalJson.js";
import { advancesByAppend, historyArtifactAt, verifyHistoryChain } from "./historyIntegration.js";
import { refTip } from "./integrationGit.js";
import { dirWorkspaceOf, type DirProjectOf } from "./dirGroup.js";
import { multiDirOf } from "./multiGroup.js";
import { ControlError } from "./errors.js";
import { acceptanceSatisfied } from "./groupAcceptanceRecord.js";
import { approveResolution, type ResolutionPrepared } from "./integrationResolve.js";
import { ENVIRONMENT_CHECKS, newGroupIntegration, readGroupIntegration, readIntegrationDefault, schemeHash, type GroupIntegration, type IntegrationScheme } from "./integrationScheme.js";
import { readRepositorySettingsBody, writeRepositorySettingsBody, type RepositorySettingsBody } from "./workspaceSettings.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { ControlStore } from "./store.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";

/** Integration spec §3.4: the integration verbs' apply functions, each run inside applyWebCommand's transaction. */
export type SetIntegrationSchemeCommand = Extract<RawAuthorityCommandV1, { verb: "set-integration-scheme" }>;
export type SetGroupIntegrationCommand = Extract<RawAuthorityCommandV1, { verb: "set-group-integration" }>;
export type RetryIntegrationCommand = Extract<RawAuthorityCommandV1, { verb: "retry-integration" }>;
export type ResolveIntegrationConflictCommand = Extract<RawAuthorityCommandV1, { verb: "resolve-integration-conflict" }>;
export type IntegrateNowCommand = Extract<RawAuthorityCommandV1, { verb: "integrate-now" }>;

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
  deps: { store: ControlStore; admissionGate?: AdmissionGate; knownRepository(repoId: string): boolean; dirProjectOf?: DirProjectOf },
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
        // Dir-requirements spec §7: a `dir` project's groups deliver by placement; its default is never read, so never set.
        if ((deps.dirProjectOf?.(target.repoId) ?? null) !== null) throw new ControlError("dir-group-delivery-fixed");
        refuseFailedCheck(failedCheck);
        const integration = (context.effectiveCommand.payload as { integration: IntegrationScheme }).integration;
        if (canonicalBytes(readIntegrationDefault(deps.store, target.repoId).scheme).equals(canonicalBytes(integration))) throw new ControlError("no-op-command");
        // The body's other field (the workspace mode; no row is worktree, execution driver spec §3.2) is kept.
        // Checks spec 2026-10-22 §4.1: so are the project's check settings.
        const current = readRepositorySettingsBody(deps.store, target.repoId);
        const workspaceMode = current?.workspaceMode ?? "worktree";
        const next: RepositorySettingsBody = { workspaceMode, revision: context.nextCommandRevision, ...(integration.delivery === "keep" ? {} : { integration }),
          ...(current?.checks === undefined ? {} : { checks: current.checks }) };
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
      // Flow engine spec §5.1 [IR-I7]: a `dir` flow group delivers by copy-back only.
      if (isDirFlowGroup(deps.store, groupId)) throw new ControlError(FLOW_GROUP_DELIVERY_FIXED);
      // Dir-requirements spec §7: a dir group delivers by placement into its folder only.
      if (dirWorkspaceOf(group) !== null) throw new ControlError("dir-group-delivery-fixed");
      // Multi-directory projects spec §9.2: each member's delivery was frozen at accept; no single setter applies.
      if (multiDirOf(group) !== null) throw new ControlError("multi-dir-delivery-fixed");
      // A clarifying group has no plan yet; it gets its copy when its split is accepted.
      if (group.status === "clarifying") throw new ControlError("group-state-invalid");
      refuseFailedCheck(failedCheck);
      const current = readGroupIntegration(group);
      if (current?.state === "resolving") throw new ControlError("integration-busy");
      const scheme = (context.effectiveCommand.payload as { integration: IntegrationScheme }).integration;
      if (canonicalBytes(current?.scheme ?? { delivery: "keep" }).equals(canonicalBytes(scheme))) throw new ControlError("no-op-command");
      const frozen = (group.proposal as { state?: unknown } | undefined)?.state === "confirmed";
      if (frozen && (current?.scheme.delivery === "local" && current.scheme.historyExpectation || scheme.delivery === "local" && scheme.historyExpectation))
        throw new ControlError("integration-history-frozen");
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
 * Integration spec §6.5: what a retry changes in a blocked or conflicted integration -- back to idle, tried again at the
 * next round. The conflict record is kept: it numbers the next attempt (§7). Also used by approve-pending-decision.
 */
export function resetIntegrationForRetry(current: GroupIntegration): GroupIntegration {
  return { ...current, state: "idle", reason: null, retryAfter: null, transient: 0 };
}

/**
 * The target a reconciliation may record: it must merely append single-parent commits after the published
 * commit. Resolving a source conflict is also a merge target, which is refused here for a person to inspect.
 */
export type HistoryRetryPlan = { clearPending: boolean; reconciledTargetTip: string | null };
export async function historyRetryPlan(repo: string, current: GroupIntegration): Promise<HistoryRetryPlan> {
  if (current.pending?.history !== undefined) {
    if (current.scheme.delivery !== "local" || !current.scheme.historyExpectation
      || current.pending.base !== current.pending.history.base || current.pending.new !== current.pending.history.targetTip
      || !(await verifyHistoryChain(repo, current.pending.history)))
      throw new ControlError("task-not-reopenable", "history-evidence-invalid");
    const target = await refTip(repo, current.scheme.historyExpectation.targetRef);
    if (target !== current.pending.base) throw new ControlError("task-not-reopenable", "history-pending-kept");
    return { clearPending: true, reconciledTargetTip: null };
  }
  return { clearPending: false, reconciledTargetTip: await historyReconciledTarget(repo, current) };
}

export async function historyReconciledTarget(repo: string, current: GroupIntegration): Promise<string | null> {
  if (current.historyPublished === undefined || current.scheme.delivery !== "local" || !current.scheme.historyExpectation) return null;
  const target = await refTip(repo, current.scheme.historyExpectation.targetRef);
  if (target === null || target === current.historyPublished.targetTip) return null;
  if (!(await advancesByAppend(repo, current.historyPublished.targetTip, target)))
    throw new ControlError("task-not-reopenable", "history-target-diverged");
  for (const path of current.historyPublished.artifactPaths)
    if (!(await historyArtifactAt(repo, target, path))) throw new ControlError("task-not-reopenable", `history-artifact-missing:${path}`);
  return target;
}

/**
 * Integration spec §6.5: a blocked or conflicted integration goes back to idle and is tried again at the next round
 * (refused integration-not-blocked otherwise). The conflict record is kept: it numbers the next attempt (§7).
 */
export function applyRetryIntegration(deps: { store: ControlStore; historyReconciledTargetTip?: string | null; clearHistoryPending?: boolean }, command: RetryIntegrationCommand): CommandSuccessV1 | CommandErrorBodyV1 {
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
      const history = current.scheme.delivery === "local" && current.scheme.historyExpectation !== undefined;
      if (history) {
        if (current.pending?.history !== undefined && deps.clearHistoryPending !== true)
          throw new ControlError("task-not-reopenable", "history-pending-kept");
        if (current.historyPublished !== undefined && (deps.historyReconciledTargetTip ?? null) === null)
          throw new ControlError("task-not-reopenable", "history-reconciliation-required");
      }
      const retried = resetIntegrationForRetry(current);
      group.integration = history && deps.clearHistoryPending === true
        ? { ...retried, pending: null }
        : history && current.historyPublished !== undefined
          ? { ...retried, pending: null, historyReconciledTargetTip: deps.historyReconciledTargetTip! }
          : retried;
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
 * Delivery tail spec D6 (tester #333, human ruling 2): "integrate now" skips only the backoff and the trigger's timing. It
 * needs a frozen, non-keep integration that is idle, every task done, the acceptance satisfied and no run active but the
 * requirement review's own call (as integrationPass.ts groupComplete), and something not yet delivered: `tip` is the work
 * branch's tip, read before the transaction (null: no branch). A pending history chain is allowed -- the next pass only
 * re-tries that one CAS. Clears `retryAfter` / `transient`; the driver's next round integrates (nothing else is skipped).
 */
export function applyIntegrateNow(deps: { store: ControlStore }, command: IntegrateNowCommand, tip: string | null): CommandSuccessV1 | CommandErrorBodyV1 {
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
    rawCommand: command,
    expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const groupId = command.target.groupId;
      const row = deps.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
      if (!row) throw new ControlError("group-not-found");
      const group = JSON.parse(String(row.body)) as Record<string, unknown>;
      const current = readGroupIntegration(group);
      if (current === null || !current.frozen) throw new ControlError("integration-not-configured");
      if (current.state !== "idle") throw new ControlError("integration-not-idle", current.state);
      // Review 2026-11-17 finding 4: the pass skips a stopped group (integrationPass.ts), so nothing would follow. (An archived
      // group is refused group-archived before this runs, by the command ledger.)
      if (group.stopped === true || deps.store.db.prepare("SELECT 1 FROM stop_intents WHERE group_id=?").get(groupId) !== undefined) throw new ControlError("integration-not-ready", "stopped");
      const tasks = deps.store.db.prepare("SELECT body FROM work_items WHERE group_id=?").all(groupId)
        .map((work) => JSON.parse(String(work.body)) as { kind?: string; status?: string }).filter((work) => work.kind === "task");
      if (tasks.length === 0 || tasks.some((work) => work.status !== "done")) throw new ControlError("integration-not-ready", "tasks-not-done");
      if (!acceptanceSatisfied(deps.store, groupId, group)) throw new ControlError("integration-not-ready", "acceptance-not-satisfied");
      if (deps.store.db.prepare("SELECT 1 FROM runs WHERE group_id=? AND active=1 AND coalesce(json_extract(body,'$.purpose'),'') <> 'requirement-review'").get(groupId) !== undefined)
        throw new ControlError("integration-not-ready", "run-active");
      if (tip === null) throw new ControlError("integration-not-ready", "work-branch-missing");
      const draftPr = current.scheme.delivery === "github-pr" && current.pr !== null && !current.pr.ready;
      const delivered = current.historyPublished !== undefined ? current.historyPublished.groupTip === tip
        : current.lastIntegrated === tip && current.pending === null && !draftPr;
      if (delivered) throw new ControlError("integration-up-to-date");
      group.integration = { ...current, retryAfter: null, transient: 0, transientReason: null };
      deps.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(group), groupId);
      recordActivity(deps.store, { groupId, kind: "integration-requested", body: { tip } });
      return { status: 200, body: {
        schema: "orca-command-success-v1", commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId,
        verb: context.rawCommand.verb, target: context.rawCommand.target, commandRevision: context.nextCommandRevision, projectionSeq: context.nextProjectionSeq,
        effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash,
        result: { kind: "integration-requested", groupId },
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
