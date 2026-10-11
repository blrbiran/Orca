import { applyWebCommand, lookupWebCommandReplay, preflightWebCommand } from "./commandLedger.js";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { ControlError } from "./errors.js";
import { withCommandContext } from "./commandClient.js";
import { agentReceiptSchema, type AgentApplyRequest, type AgentReceipt } from "./agentInstallationProtocol.js";
import type { ExecutionPort } from "./executionPort.js";
import type { ControlStore } from "./store.js";
import { rawAuthorityCommandSchema, type CommandLookupV1, type RawAuthorityCommandV1 } from "./webProtocol.js";

export type ApplyAgentUpdateCommand = Extract<RawAuthorityCommandV1, { verb: "apply-agent-update" }>;
type Outcome = { status: number; body: CommandLookupV1["body"] };
type Reservation = { request: AgentApplyRequest; existingPending: boolean };
type Pending = { operator_id: string; command_id: string; raw_hash: string; raw_command_json: string; request_json: string; principal: string; client: string; state: string };

function revision(store: ControlStore, operatorId: string): number {
  const row = store.db.prepare("SELECT revision FROM agent_update_state WHERE operator_id=?").get(operatorId);
  const value = Number(row?.revision ?? 0);
  if (!Number.isSafeInteger(value) || value < 0) throw new ControlError("recovery-blocked", "agent-update-revision-invalid");
  return value;
}

export function readAgentUpdateRevision(store: ControlStore, operatorId: string): number { return revision(store, operatorId); }
export function hasPendingAgentUpdate(store: ControlStore, operatorId: string): boolean {
  return store.db.prepare("SELECT command_id FROM agent_update_outbox WHERE operator_id=? AND state='pending'").get(operatorId) !== undefined;
}

function pendingFor(store: ControlStore, operatorId: string): Pending | undefined {
  return store.db.prepare("SELECT operator_id,command_id,raw_hash,raw_command_json,request_json,principal,client,state FROM agent_update_outbox WHERE operator_id=? AND state='pending'").get(operatorId) as Pending | undefined;
}
/** Owner-only view may offer the retained command for an explicit same-ID retry after a lost answer. */
export function pendingAgentUpdateCommand(store: ControlStore, operatorId: string): ApplyAgentUpdateCommand | null {
  const pending = pendingFor(store, operatorId);
  if (!pending) return null;
  const parsed = rawAuthorityCommandSchema.parse(JSON.parse(pending.raw_command_json)) as ApplyAgentUpdateCommand;
  if (parsed.verb !== "apply-agent-update" || parsed.target.kind !== "operator" || parsed.target.operatorId !== operatorId
    || parsed.commandId !== pending.command_id || sha256Canonical(parsed) !== pending.raw_hash) {
    throw new ControlError("recovery-blocked", "agent-update-command-intent-mismatch");
  }
  return parsed;
}

function requestFor(command: ApplyAgentUpdateCommand): AgentApplyRequest {
  return {
    opId: command.commandId,
    requestDigest: sha256Canonical({ actorId: command.actorId, target: command.target, payload: command.payload }),
    previewId: command.payload.previewId,
    baseTableHash: command.payload.baseTableHash,
    acceptedChangeIds: [...command.payload.acceptedChangeIds],
  };
}

function verifyReceipt(request: AgentApplyRequest, value: unknown): AgentReceipt {
  const parsed = agentReceiptSchema.safeParse(value);
  if (!parsed.success) throw new ControlError("control-response-invalid", "agent-update-receipt-shape");
  const receipt = parsed.data;
  if (receipt.opId !== request.opId || receipt.requestDigest !== request.requestDigest || receipt.previewId !== request.previewId
    || receipt.beforeHash !== request.baseTableHash || canonicalBytes(receipt.acceptedChangeIds).compare(canonicalBytes(request.acceptedChangeIds)) !== 0) {
    throw new ControlError("control-response-invalid", "agent-update-receipt-identity");
  }
  return receipt;
}

function reserve(store: ControlStore, command: ApplyAgentUpdateCommand, context: { client: string; principal: string }): Reservation | Outcome {
  const target = command.target;
  if (target.kind !== "operator" || target.operatorId !== command.actorId) throw new ControlError("control-target-not-allowed");
  const prior = lookupWebCommandReplay<CommandLookupV1["body"]>(store, command);
  if (prior) return prior;
  const operatorId = target.operatorId;
  const rawHash = sha256Canonical(command);
  const pending = pendingFor(store, operatorId);
  if (pending) {
    if (pending.command_id === command.commandId && pending.raw_hash !== rawHash) throw new ControlError("command-id-conflict");
    if (pending.command_id !== command.commandId) throw new ControlError("agent-installation-update-pending");
    const request = JSON.parse(pending.request_json) as AgentApplyRequest;
    if (!canonicalBytes(request).equals(canonicalBytes(requestFor(command)))) throw new ControlError("recovery-blocked", "agent-update-request-intent-mismatch");
    return { request, existingPending: true };
  }
  const stale = preflightWebCommand(store, command);
  if (stale) return stale;
  const request = requestFor(command);
  return store.transaction(() => {
    if (pendingFor(store, operatorId)) throw new ControlError("agent-installation-update-pending");
    if (revision(store, operatorId) !== command.expectedRevision) throw new ControlError("agent-installation-update-stale");
    store.db.prepare("INSERT OR IGNORE INTO agent_update_state(operator_id,revision) VALUES (?,0)").run(operatorId);
    store.db.prepare("INSERT INTO agent_update_outbox(operator_id,command_id,raw_hash,raw_command_json,request_json,principal,client,state,receipt_json) VALUES (?,?,?,?,?,?,?,'pending',NULL)")
      .run(operatorId, command.commandId, rawHash, canonicalBytes(command).toString("utf8"), canonicalBytes(request).toString("utf8"), context.principal, context.client);
    return { request, existingPending: false };
  });
}

function finalize(store: ControlStore, command: ApplyAgentUpdateCommand, receipt: AgentReceipt): Outcome {
  const target = command.target;
  if (target.kind !== "operator") throw new ControlError("control-target-not-allowed");
  return applyWebCommand(store, {
    rawCommand: command,
    expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    authorityChanged: false,
    projectionGroupIds: [],
    apply: (ctx) => {
      const pending = pendingFor(store, target.operatorId);
      if (!pending || pending.command_id !== command.commandId || pending.raw_hash !== sha256Canonical(command)) throw new ControlError("recovery-blocked", "agent-update-outbox-missing");
      store.db.prepare("UPDATE agent_update_state SET revision=? WHERE operator_id=?").run(ctx.nextCommandRevision, target.operatorId);
      store.db.prepare("UPDATE agent_update_outbox SET state='complete',receipt_json=? WHERE operator_id=? AND command_id=?")
        .run(canonicalBytes(receipt).toString("utf8"), target.operatorId, command.commandId);
      return { status: 200, body: {
        schema: "orca-command-success-v1" as const, commandId: command.commandId, actorId: command.actorId, verb: command.verb,
        target: command.target, commandRevision: ctx.nextCommandRevision, projectionSeq: null,
        effectivePayloadHash: ctx.effectivePayloadHash, authorityCommandHash: ctx.authorityCommandHash,
        result: { kind: "agent-installations-updated" as const, operatorId: target.operatorId, revision: ctx.nextCommandRevision, beforeHash: receipt.beforeHash, afterHash: receipt.afterHash },
      } };
    },
  });
}

function finalizeKnownRefusal(store: ControlStore, command: ApplyAgentUpdateCommand, code: "agent-installation-update-stale" | "control-agent-update-unsupported"): Outcome {
  const status = code === "agent-installation-update-stale" ? 409 : 422;
  const message = code === "agent-installation-update-stale" ? "The installation table changed; detect again." : "This ccloop peer does not support installation updates.";
  const outcome = applyWebCommand(store, {
    rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    authorityChanged: false, projectionGroupIds: [],
    apply: (ctx) => ({ status, body: { error: { code, message, commandRevision: ctx.currentCommandRevision, evidenceIds: [], retryable: false } } }),
  });
  const target = command.target;
  if (target.kind === "operator") store.transaction(() => {
    store.db.prepare("UPDATE agent_update_outbox SET state='complete' WHERE operator_id=? AND command_id=? AND state='pending'").run(target.operatorId, command.commandId);
  });
  return outcome;
}

/** Reserve in SQLite before crossing the peer boundary. A replay sends the immutable request unchanged. */
export async function applyAgentUpdate(
  deps: { store: ControlStore; port: Pick<ExecutionPort, "applyAgentInstallations"> },
  raw: ApplyAgentUpdateCommand,
  context: { client: string; principal: string },
  afterReceipt?: () => void,
): Promise<Outcome> {
  const command = rawAuthorityCommandSchema.parse(raw) as ApplyAgentUpdateCommand;
  if (!deps.port.applyAgentInstallations) throw new ControlError("control-agent-update-unsupported");
  const reserved = reserve(deps.store, command, context);
  if ("status" in reserved) return reserved;
  let receipt: AgentReceipt;
  try { receipt = verifyReceipt(reserved.request, await deps.port.applyAgentInstallations(reserved.request)); }
  catch (error) {
    // A proven stale CAS or unsupported feature has no table mutation and can be booked durably.
    // Every unknown subprocess outcome retains the pending operation for same-identity reconciliation.
    if (error instanceof ControlError && error.code === "agent-installation-update-stale") return finalizeKnownRefusal(deps.store, command, error.code);
    if (error instanceof ControlError && error.code === "control-agent-update-unsupported" && !reserved.existingPending) return finalizeKnownRefusal(deps.store, command, error.code);
    throw error;
  }
  afterReceipt?.();
  return finalize(deps.store, command, receipt);
}

/** Bounded startup pass: the peer's same-operation receipt is the only evidence that finalizes a mutation. */
export async function reconcilePendingAgentUpdates(store: ControlStore, port: Pick<ExecutionPort, "applyAgentInstallations">): Promise<void> {
  const rows = store.db.prepare("SELECT operator_id,command_id,raw_hash,raw_command_json,request_json,principal,client,state FROM agent_update_outbox WHERE state='pending'").all() as Pending[];
  for (const row of rows) {
    const stored = store.db.prepare("SELECT raw_request_hash,verb FROM commands WHERE group_id=? AND id=? AND original_status IS NOT NULL").get(`@operator:${row.operator_id}`, row.command_id);
    if (stored) {
      if (stored.raw_request_hash !== row.raw_hash || stored.verb !== "apply-agent-update") throw new ControlError("recovery-blocked", "agent-update-ledger-identity-mismatch");
      const command = pendingAgentUpdateCommand(store, row.operator_id);
      if (!command || !lookupWebCommandReplay(store, command)) throw new ControlError("recovery-blocked", "agent-update-ledger-outcome-missing");
      store.transaction(() => { store.db.prepare("UPDATE agent_update_outbox SET state='complete' WHERE operator_id=? AND command_id=?").run(row.operator_id, row.command_id); });
      continue;
    }
    if (!port.applyAgentInstallations) continue;
    const command = rawAuthorityCommandSchema.parse(JSON.parse(row.raw_command_json)) as ApplyAgentUpdateCommand;
    if (sha256Canonical(command) !== row.raw_hash || command.commandId !== row.command_id) throw new ControlError("recovery-blocked", "agent-update-command-intent-mismatch");
    const request = JSON.parse(row.request_json) as AgentApplyRequest;
    if (!canonicalBytes(request).equals(canonicalBytes(requestFor(command)))) throw new ControlError("recovery-blocked", "agent-update-request-intent-mismatch");
    let receipt: AgentReceipt;
    try { receipt = verifyReceipt(request, await port.applyAgentInstallations(request)); }
    catch (error) {
      // A replacement peer's lack of this feature says nothing about what the earlier peer did.
      // Preserve the original pending identity and operator fence until its receipt can be read.
      if (error instanceof ControlError && error.code === "agent-installation-update-stale") {
        const code = error.code;
        withCommandContext(row.command_id, { client: row.client, principal: row.principal }, () => finalizeKnownRefusal(store, command, code));
        continue;
      }
      throw error;
    }
    withCommandContext(row.command_id, { client: row.client, principal: row.principal }, () => finalize(store, command, receipt));
  }
}
