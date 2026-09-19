import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { ControlError } from "./errors.js";
import { recordProjectionChange } from "./projectionJournal.js";
import type { ControlStore } from "./store.js";
import {
  effectiveAuthorityCommandSchema,
  rawAuthorityCommandSchema,
  type CommandLookupV1,
  type EffectiveAuthorityCommandV1,
  type RawAuthorityCommandV1,
} from "./webProtocol.js";

export interface StoredCommandOutcome<T> { status: number; body: T }

export interface WebCommandContext {
  rawCommand: RawAuthorityCommandV1;
  effectiveCommand: EffectiveAuthorityCommandV1;
  rawRequestHash: string;
  effectivePayloadHash: string;
  authorityCommandHash: string;
  currentCommandRevision: number;
  nextCommandRevision: number;
  currentProjectionSeq: number | null;
  nextProjectionSeq: number | null;
}

export interface WebCommandInput<T> {
  rawCommand: RawAuthorityCommandV1;
  expand: () => EffectiveAuthorityCommandV1;
  apply: (context: WebCommandContext) => StoredCommandOutcome<T>;
  authorityChanged?: boolean | ((outcome: StoredCommandOutcome<T>) => boolean);
  projectionGroupIds?: readonly string[] | ((outcome: StoredCommandOutcome<T>) => readonly string[]);
}

type CommandRow = { raw_request_hash: unknown; original_status: unknown; body_json: unknown };

function scope(command: RawAuthorityCommandV1): { key: string; kind: "group" | "global"; id: string; groupId: string | null } {
  if (command.target.kind === "global") return { key: "@global", kind: "global", id: "global", groupId: null };
  return { key: command.target.groupId, kind: "group", id: command.target.groupId, groupId: command.target.groupId };
}

function replay(row: CommandRow): StoredCommandOutcome<unknown> {
  if (row.original_status === null || row.body_json === null) throw new ControlError("command-id-conflict");
  return { status: Number(row.original_status), body: JSON.parse(String(row.body_json)) };
}

function identityWithoutPayload(command: RawAuthorityCommandV1 | EffectiveAuthorityCommandV1): unknown {
  return { commandId: command.commandId, expectedRevision: command.expectedRevision, actorId: command.actorId, verb: command.verb, target: command.target };
}

function checkedStatus(status: number): number {
  if (!Number.isSafeInteger(status) || status < 100 || status > 599) throw new ControlError("control-command-status-invalid");
  return status;
}

function revisionConflict(commandRevision: number): StoredCommandOutcome<unknown> {
  return {
    status: 409,
    body: { error: { code: "revision-conflict", message: "The command revision is stale.", commandRevision, evidenceIds: [], retryable: false } },
  };
}

function updateRevision(store: ControlStore, groupId: string, nextRevision: number): void {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  if (!row) throw new ControlError("group-not-found");
  let body = String(row.body);
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (Object.getPrototypeOf(parsed) === Object.prototype) {
      if (Object.hasOwn(parsed, "revision")) parsed.revision = nextRevision;
      if (Object.hasOwn(parsed, "commandRevision")) parsed.commandRevision = nextRevision;
      body = JSON.stringify(parsed);
    }
  } catch {
    // The indexed revision remains authoritative for normalized Web-only records.
  }
  store.db.prepare("UPDATE groups SET revision=?,body=? WHERE id=?").run(nextRevision, body, groupId);
}

export function applyWebCommand<T>(store: ControlStore, input: WebCommandInput<T>): StoredCommandOutcome<T> {
  const rawCommand = rawAuthorityCommandSchema.parse(input.rawCommand) as RawAuthorityCommandV1;
  const commandScope = scope(rawCommand);
  const rawRequestJson = canonicalBytes(rawCommand).toString("utf8");
  const rawRequestHash = sha256Canonical(rawCommand);

  return store.transaction(() => {
    const prior = store.db.prepare("SELECT raw_request_hash,original_status,body_json FROM commands WHERE group_id=? AND id=?")
      .get(commandScope.key, rawCommand.commandId) as CommandRow | undefined;
    if (prior) {
      if (prior.raw_request_hash !== rawRequestHash) throw new ControlError("command-id-conflict");
      return replay(prior) as StoredCommandOutcome<T>;
    }

    const effectiveCommand = effectiveAuthorityCommandSchema.parse(input.expand()) as EffectiveAuthorityCommandV1;
    if (canonicalBytes(identityWithoutPayload(rawCommand)).compare(canonicalBytes(identityWithoutPayload(effectiveCommand))) !== 0) {
      throw new ControlError("control-effective-command-identity-mismatch");
    }
    const effectivePayloadJson = canonicalBytes(effectiveCommand.payload).toString("utf8");
    const effectivePayloadHash = sha256Canonical(effectiveCommand.payload);
    const authorityCommandJson = canonicalBytes(effectiveCommand).toString("utf8");
    const authorityCommandHash = sha256Canonical(effectiveCommand);

    const groupRow = commandScope.groupId === null ? undefined : store.db.prepare("SELECT revision,projection_seq FROM groups WHERE id=?").get(commandScope.groupId);
    const currentCommandRevision = commandScope.groupId === null ? 0 : Number(groupRow?.revision ?? 0);
    const currentProjectionSeq = commandScope.groupId === null || !groupRow ? null : Number(groupRow.projection_seq);
    const nextCommandRevision = currentCommandRevision === Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : currentCommandRevision + 1;
    const nextProjectionSeq = currentProjectionSeq === null
      ? commandScope.groupId === null ? null : 1
      : currentProjectionSeq === Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : currentProjectionSeq + 1;

    let outcome: StoredCommandOutcome<T>;
    if (rawCommand.expectedRevision !== currentCommandRevision) outcome = revisionConflict(currentCommandRevision) as StoredCommandOutcome<T>;
    else outcome = input.apply({ rawCommand, effectiveCommand, rawRequestHash, effectivePayloadHash, authorityCommandHash, currentCommandRevision, nextCommandRevision, currentProjectionSeq, nextProjectionSeq });
    checkedStatus(outcome.status);

    const authorityChanged = rawCommand.expectedRevision === currentCommandRevision && (typeof input.authorityChanged === "function"
      ? input.authorityChanged(outcome)
      : input.authorityChanged ?? (outcome.status >= 200 && outcome.status < 300));
    if (authorityChanged && commandScope.groupId === null) throw new ControlError("control-global-authority-requires-explicit-groups");
    if (authorityChanged) {
      if (currentCommandRevision === Number.MAX_SAFE_INTEGER) throw new ControlError("control-sequence-overflow");
      updateRevision(store, commandScope.groupId!, currentCommandRevision + 1);
    }
    const projectionGroups = typeof input.projectionGroupIds === "function"
      ? input.projectionGroupIds(outcome)
      : input.projectionGroupIds ?? (authorityChanged && commandScope.groupId !== null ? [commandScope.groupId] : []);
    if (projectionGroups.length > 0) recordProjectionChange(store, projectionGroups);

    const finalGroup = commandScope.groupId === null ? undefined : store.db.prepare("SELECT revision,projection_seq FROM groups WHERE id=?").get(commandScope.groupId);
    const commandRevision = commandScope.groupId === null ? null : Number(finalGroup?.revision ?? currentCommandRevision);
    const projectionSeq = commandScope.groupId === null || !finalGroup ? null : Number(finalGroup.projection_seq);
    const bodyJson = canonicalBytes(outcome.body).toString("utf8");
    const responseBytes = Buffer.from(bodyJson, "utf8");
    store.db.prepare(`INSERT INTO commands(
      group_id,id,payload_hash,result,ledger_version,scope_kind,scope_id,actor_id,verb,target_json,expected_revision,
      raw_request_json,raw_request_hash,effective_payload_json,effective_payload_hash,authority_command_json,authority_command_hash,
      original_status,body_json,response_bytes,command_revision,projection_seq
    ) VALUES (?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      commandScope.key, rawCommand.commandId, rawRequestHash, bodyJson, commandScope.kind, commandScope.id, rawCommand.actorId,
      rawCommand.verb, canonicalBytes(rawCommand.target).toString("utf8"), rawCommand.expectedRevision, rawRequestJson, rawRequestHash,
      effectivePayloadJson, effectivePayloadHash, authorityCommandJson, authorityCommandHash, outcome.status, bodyJson, responseBytes,
      commandRevision, projectionSeq,
    );
    return outcome;
  });
}

export function lookupCommandResult(store: ControlStore, groupId: string, commandId: string): CommandLookupV1 | null {
  const row = store.db.prepare("SELECT original_status,body_json FROM commands WHERE group_id=? AND id=?")
    .get(groupId, commandId) as Pick<CommandRow, "original_status" | "body_json"> | undefined;
  if (!row || row.original_status === null || row.body_json === null) return null;
  return { schema: "orca-command-lookup-v1", originalStatus: Number(row.original_status), body: JSON.parse(String(row.body_json)) } as CommandLookupV1;
}
