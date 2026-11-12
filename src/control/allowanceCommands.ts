import { recordActivity } from "./activity.js";
import { commandAttributionFor, commandPrincipalFor } from "./commandClient.js";
import { applyWebCommand } from "./commandLedger.js";
import { ControlError } from "./errors.js";
import { readFlaggedDecision, ratifyFlag } from "./flaggedDecisions.js";
import { allowancesOf, applyDecisionAllowances, flaggedRequestKey, pendingRequestKey, type AllowanceRequest, type GroupAllowance } from "./groupAllowances.js";
import { allowPendingDecision, readPendingDecision } from "./pendingDecisions.js";
import { commandSuccess } from "./stopIntent.js";
import type { ControlStore } from "./store.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";
import type { PathPolicyMissV1 } from "./pathPolicyMisses.js";

/**
 * Tester follow-up G §6.3 (#189): `allow-request` lets one request through (`scope: "one"`), or records an allowance that
 * lets every request of its kind in this group through (`scope: "group"`, the default the Web offers) -- the request
 * itself, the same-kind ones still open, and later ones (plan A8). `revoke-allowance` stops it for later requests; what it
 * let through stays. A person or an orchestrating agent (humanOnly.ts: human-only verbs, socket tier open); never a run Orca
 * dispatched. A path request's retry runs after this transaction (webService.ts allowRequest).
 */
export type AllowRequestCommand = Extract<RawAuthorityCommandV1, { verb: "allow-request" }>;
export type RevokeAllowanceCommand = Extract<RawAuthorityCommandV1, { verb: "revoke-allowance" }>;

/** The run's exact allowlist misses when it is this group's run blocked at C on an allowlist miss; otherwise refused by name. */
export function allowlistBlock(store: ControlStore, groupId: string, runId: string): { taskId: string; misses: PathPolicyMissV1[] } {
  const row = store.db.prepare("SELECT body FROM runs WHERE id=? AND group_id=?").get(runId, groupId);
  if (row === undefined) throw new ControlError("allowance-request-invalid", "run-not-in-group");
  const run = JSON.parse(String(row.body)) as { state?: unknown; taskId?: unknown; drive?: { blockedAt?: unknown; outcome?: unknown; stopReason?: unknown; pathPolicyMisses?: unknown } };
  const drive = run.drive;
  const misses = drive?.pathPolicyMisses;
  if (run.state !== "blocked" || drive?.blockedAt !== "C" || drive.outcome !== "blocked_waiting_human" || typeof drive.stopReason !== "string"
    || !drive.stopReason.startsWith("allowlist miss: ") || !Array.isArray(misses) || misses.length === 0 || typeof run.taskId !== "string")
    throw new ControlError("allowance-request-invalid", "not-an-allowlist-block");
  return { taskId: run.taskId, misses: misses as PathPolicyMissV1[] };
}

function groupBody(store: ControlStore, groupId: string): Record<string, unknown> {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  if (row === undefined) throw new ControlError("group-not-found");
  return JSON.parse(String(row.body)) as Record<string, unknown>;
}
function saveAllowances(store: ControlStore, groupId: string, allowances: GroupAllowance[]): void {
  const body = groupBody(store, groupId);
  store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify({ ...body, allowances }), groupId);
}

export function applyAllowRequest(deps: { store: ControlStore }, command: AllowRequestCommand): CommandSuccessV1 | CommandErrorBodyV1 {
  const { store } = deps;
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(store, {
    rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const groupId = command.target.groupId;
      const { request, scope } = command.payload;
      const body = groupBody(store, groupId);
      const { by, via } = commandAttributionFor(command.commandId, command.actorId);
      const principal = commandPrincipalFor(command.commandId);
      const at = store.now();
      const allowances = allowancesOf(body);
      const allowanceId = scope === "group" ? `allow-${allowances.length + 1}` : null;
      let key: AllowanceRequest;
      let from: GroupAllowance["from"];
      let settle: () => string[];
      if (request.kind === "pending-decision") {
        const row = readPendingDecision(store, request.pendingId);
        if (row === null || row.groupId !== groupId) throw new ControlError("pending-decision-not-found");
        if (row.state === "allowed" && scope === "one") throw new ControlError("no-op-command");
        if (row.state !== "pending" && row.state !== "allowed") throw new ControlError("pending-decision-settled", row.state);
        key = pendingRequestKey(row.entry.entry); from = { pendingId: row.pendingId };
        settle = () => { if (row.state !== "pending") return []; allowPendingDecision(store, row.pendingId, { by, via, at, commandId: command.commandId, allowanceId }); return [row.pendingId]; };
      } else if (request.kind === "flagged-decision") {
        const row = readFlaggedDecision(store, request.decisionId);
        if (row === null || row.groupId !== groupId) throw new ControlError("flagged-decision-not-found");
        if (row.state === "ratified" && scope === "one") throw new ControlError("no-op-command");
        key = flaggedRequestKey(row); from = { decisionId: row.decisionId };
        settle = () => {
          if (row.state !== "flagged") return [];
          ratifyFlag(store, groupId, row.decisionId, { actorId: by, via, commandId: command.commandId, at: new Date(at).toISOString(), note: allowanceId === null ? "allowed (this one)" : `allowed by ${allowanceId}` });
          return [row.decisionId];
        };
      } else {
        const block = allowlistBlock(store, groupId, request.runId);
        key = { type: "path", paths: block.misses.map((miss) => ({ repoKey: miss.repoKey, path: miss.path })) }; from = { runId: request.runId };
        settle = () => [];
      }
      if (allowanceId !== null) {
        const allowance: GroupAllowance = { allowanceId, request: key, from, by, via, principal, commandId: command.commandId, at };
        saveAllowances(store, groupId, [...allowances, allowance]);
        recordActivity(store, { groupId, kind: "allowance", body: { action: "granted", allowanceId, request: key, from } });
      }
      const settled = settle();
      if (allowanceId !== null) for (const applied of applyDecisionAllowances(store, groupId)) settled.push(applied.pendingId ?? applied.decisionId!);
      return commandSuccess(context, { kind: "request-allowed", allowanceId, settled });
    },
  }).body;
}

export function applyRevokeAllowance(deps: { store: ControlStore }, command: RevokeAllowanceCommand): CommandSuccessV1 | CommandErrorBodyV1 {
  const { store } = deps;
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(store, {
    rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const groupId = command.target.groupId;
      const allowances = allowancesOf(groupBody(store, groupId));
      const target = allowances.find((allowance) => allowance.allowanceId === command.payload.allowanceId);
      if (target === undefined) throw new ControlError("allowance-not-found");
      if (target.revoked !== undefined) throw new ControlError("no-op-command");
      const { by, via } = commandAttributionFor(command.commandId, command.actorId);
      const revoked = { by, via, commandId: command.commandId, at: store.now() };
      saveAllowances(store, groupId, allowances.map((allowance) => allowance === target ? { ...allowance, revoked } : allowance));
      recordActivity(store, { groupId, kind: "allowance", body: { action: "revoked", allowanceId: target.allowanceId } });
      return commandSuccess(context, { kind: "allowance-revoked", allowanceId: target.allowanceId });
    },
  }).body;
}
