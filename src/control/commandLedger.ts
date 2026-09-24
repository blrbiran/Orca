import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { ControlError, durableCommandErrorStatus } from "./errors.js";
import { recordProjectionChange } from "./projectionJournal.js";
import type { ControlStore } from "./store.js";
import {
  commandErrorBodySchema,
  commandSuccessSchema,
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
type CommandBody = CommandLookupV1["body"];

type CommandScope = { key: string; kind: "group" | "global" | "repository"; id: string; groupId: string | null; repoId: string | null };

function scope(command: RawAuthorityCommandV1): CommandScope {
  if (command.target.kind === "global") return { key: "@global", kind: "global", id: "global", groupId: null, repoId: null };
  if (command.target.kind === "repository") {
    return { key: `@repository:${command.target.repoId}`, kind: "repository", id: command.target.repoId, groupId: null, repoId: command.target.repoId };
  }
  return { key: command.target.groupId, kind: "group", id: command.target.groupId, groupId: command.target.groupId, repoId: null };
}

/**
 * Execution driver spec §3.2: a repository-scoped command is checked against its setting's own
 * revision (0 while no row exists), not against any group's.
 */
function repositoryRevision(store: ControlStore, repoId: string): number {
  const row = store.db.prepare("SELECT body FROM repository_settings WHERE repo_id=?").get(repoId);
  if (!row) return 0;
  const revision = (JSON.parse(String(row.body)) as { revision?: unknown }).revision;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision <= 0) throw new ControlError("recovery-blocked", "repository-settings-invalid");
  return revision;
}

function invalidResult(): never {
  throw new ControlError("control-command-result-invalid");
}

function validatedOutcome(statusValue: unknown, body: unknown): StoredCommandOutcome<CommandBody> {
  const status = Number(statusValue);
  if (!Number.isSafeInteger(status) || !((status >= 200 && status < 300) || (status >= 400 && status < 500))) invalidResult();
  const parsed = (status >= 200 && status < 300 ? commandSuccessSchema : commandErrorBodySchema).safeParse(body);
  if (!parsed.success) invalidResult();
  if ("error" in parsed.data && parsed.data.error.retryable) invalidResult();
  return { status, body: parsed.data } as StoredCommandOutcome<CommandBody>;
}

function parsedBody(bodyJson: unknown): unknown {
  try { return JSON.parse(String(bodyJson)); }
  catch { return invalidResult(); }
}

function replay(row: CommandRow): StoredCommandOutcome<CommandBody> {
  if (row.original_status === null || row.body_json === null) throw new ControlError("command-id-conflict");
  return validatedOutcome(row.original_status, parsedBody(row.body_json));
}

/**
 * Read-only raw identity lookup. A miss does not check the current revision;
 * asynchronous orchestration must use preflightWebCommand before preparation.
 */
export function lookupWebCommandReplay<T>(store: ControlStore, input: RawAuthorityCommandV1): StoredCommandOutcome<T> | null {
  const rawCommand = rawAuthorityCommandSchema.parse(input) as RawAuthorityCommandV1;
  const commandScope = scope(rawCommand);
  const rawRequestHash = sha256Canonical(rawCommand);
  const prior = store.db.prepare("SELECT raw_request_hash,original_status,body_json FROM commands WHERE group_id=? AND id=?")
    .get(commandScope.key, rawCommand.commandId) as CommandRow | undefined;
  if (!prior) return null;
  if (prior.raw_request_hash !== rawRequestHash) throw new ControlError("command-id-conflict");
  return replay(prior) as StoredCommandOutcome<T>;
}

/**
 * Atomic identity/CAS gate before asynchronous preparation. A stale new command
 * commits its durable conflict; null means current with no writes or reservation.
 * Callers must still use applyWebCommand after preparation to close races.
 */
export function preflightWebCommand<T = CommandBody>(store: ControlStore, input: RawAuthorityCommandV1): StoredCommandOutcome<T> | null {
  const rawCommand = rawAuthorityCommandSchema.parse(input) as RawAuthorityCommandV1;
  return store.transaction(() => {
    const prior = lookupWebCommandReplay<T>(store, rawCommand);
    if (prior) return prior;

    const commandScope = scope(rawCommand);
    const groupRow = commandScope.groupId === null ? undefined : store.db.prepare("SELECT revision,projection_seq FROM groups WHERE id=?").get(commandScope.groupId);
    const currentCommandRevision = commandScope.repoId !== null ? repositoryRevision(store, commandScope.repoId)
      : commandScope.groupId === null ? 0 : Number(groupRow?.revision ?? 0);
    if (rawCommand.expectedRevision === currentCommandRevision) return null;

    const commandRevision = commandScope.repoId !== null ? currentCommandRevision : commandScope.groupId === null ? null : currentCommandRevision;
    const projectionSeq = commandScope.groupId === null || !groupRow ? null : Number(groupRow.projection_seq);
    const conflict = revisionConflict(currentCommandRevision);
    const outcome = validatedOutcome(conflict.status, conflict.body);
    assertFinalVersions(outcome.body, commandRevision, projectionSeq);
    persistCommandOutcome(store, rawCommand, outcome, commandRevision, projectionSeq);
    return outcome as StoredCommandOutcome<T>;
  });
}

function identityWithoutPayload(command: RawAuthorityCommandV1 | EffectiveAuthorityCommandV1): unknown {
  return { commandId: command.commandId, expectedRevision: command.expectedRevision, actorId: command.actorId, verb: command.verb, target: command.target };
}

function revisionConflict(commandRevision: number): StoredCommandOutcome<CommandBody> {
  return {
    status: 409,
    body: { error: { code: "revision-conflict", message: "The command revision is stale.", commandRevision, evidenceIds: [], retryable: false } },
  };
}

function domainErrorOutcome(error: ControlError, commandRevision: number | null): StoredCommandOutcome<CommandBody> | null {
  const status = durableCommandErrorStatus(error.code);
  if (status === null) return null;
  return {
    status,
    body: { error: { code: error.code, message: error.message, commandRevision, evidenceIds: [], retryable: false } },
  };
}

type SavepointResult<T> = { value: T } | { outcome: StoredCommandOutcome<CommandBody> };

function invokeWithSavepoint<T>(
  store: ControlStore,
  name: "web_command_expand" | "web_command_apply",
  invoke: () => T,
  commandRevision: number | null,
  rollbackResult: (value: T) => boolean = () => false,
): SavepointResult<T> {
  store.db.exec(`SAVEPOINT ${name}`);
  try {
    const value = invoke();
    if (rollbackResult(value)) store.db.exec(`ROLLBACK TO ${name}`);
    store.db.exec(`RELEASE ${name}`);
    return { value };
  } catch (error) {
    store.db.exec(`ROLLBACK TO ${name}`);
    store.db.exec(`RELEASE ${name}`);
    if (!(error instanceof ControlError)) throw error;
    const outcome = domainErrorOutcome(error, commandRevision);
    if (outcome === null) throw error;
    return { outcome };
  }
}

function assertSuccessIdentity(
  body: CommandBody,
  context: Pick<WebCommandContext, "rawCommand" | "effectivePayloadHash" | "authorityCommandHash">,
): void {
  if (!("schema" in body)) return;
  if (
    body.commandId !== context.rawCommand.commandId
    || body.actorId !== context.rawCommand.actorId
    || body.verb !== context.rawCommand.verb
    || canonicalBytes(body.target).compare(canonicalBytes(context.rawCommand.target)) !== 0
    || body.effectivePayloadHash !== context.effectivePayloadHash
    || body.authorityCommandHash !== context.authorityCommandHash
  ) invalidResult();
}

function assertFinalVersions(body: CommandBody, commandRevision: number | null, projectionSeq: number | null): void {
  if ("schema" in body) {
    if (body.commandRevision !== commandRevision || body.projectionSeq !== projectionSeq) invalidResult();
  } else if (body.error.commandRevision !== commandRevision) invalidResult();
}

function persistCommandOutcome(
  store: ControlStore,
  rawCommand: RawAuthorityCommandV1,
  outcome: StoredCommandOutcome<CommandBody>,
  commandRevision: number | null,
  projectionSeq: number | null,
  effectiveIdentity?: {
    effectivePayloadJson: string | null;
    effectivePayloadHash: string | null;
    authorityCommandJson: string | null;
    authorityCommandHash: string | null;
  },
): void {
  const commandScope = scope(rawCommand);
  const rawRequestJson = canonicalBytes(rawCommand).toString("utf8");
  const rawRequestHash = sha256Canonical(rawCommand);
  const bodyJson = canonicalBytes(outcome.body).toString("utf8");
  const responseBytes = Buffer.from(bodyJson, "utf8");
  store.db.prepare(`INSERT INTO commands(
    group_id,id,payload_hash,result,ledger_version,scope_kind,scope_id,actor_id,verb,target_json,expected_revision,
    raw_request_json,raw_request_hash,effective_payload_json,effective_payload_hash,authority_command_json,authority_command_hash,
    original_status,body_json,response_bytes,command_revision,projection_seq
  ) VALUES (?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    commandScope.key, rawCommand.commandId, rawRequestHash, bodyJson, commandScope.kind, commandScope.id, rawCommand.actorId,
    rawCommand.verb, canonicalBytes(rawCommand.target).toString("utf8"), rawCommand.expectedRevision, rawRequestJson, rawRequestHash,
    effectiveIdentity?.effectivePayloadJson ?? null, effectiveIdentity?.effectivePayloadHash ?? null,
    effectiveIdentity?.authorityCommandJson ?? null, effectiveIdentity?.authorityCommandHash ?? null,
    outcome.status, bodyJson, responseBytes, commandRevision, projectionSeq,
  );
}

export function updateRevision(store: ControlStore, groupId: string, nextRevision: number): void {
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
  const rawRequestHash = sha256Canonical(rawCommand);

  return store.transaction(() => {
    const prior = store.db.prepare("SELECT raw_request_hash,original_status,body_json FROM commands WHERE group_id=? AND id=?")
      .get(commandScope.key, rawCommand.commandId) as CommandRow | undefined;
    if (prior) {
      if (prior.raw_request_hash !== rawRequestHash) throw new ControlError("command-id-conflict");
      return replay(prior) as StoredCommandOutcome<T>;
    }

    const groupRow = commandScope.groupId === null ? undefined : store.db.prepare("SELECT revision,projection_seq FROM groups WHERE id=?").get(commandScope.groupId);
    const currentCommandRevision = commandScope.repoId !== null ? repositoryRevision(store, commandScope.repoId)
      : commandScope.groupId === null ? 0 : Number(groupRow?.revision ?? 0);
    const resultCommandRevision = commandScope.repoId !== null ? currentCommandRevision : commandScope.groupId === null ? null : currentCommandRevision;
    const currentProjectionSeq = commandScope.groupId === null || !groupRow ? null : Number(groupRow.projection_seq);
    const nextCommandRevision = currentCommandRevision === Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : currentCommandRevision + 1;
    const nextProjectionSeq = currentProjectionSeq === null
      ? commandScope.groupId === null ? null : 1
      : currentProjectionSeq === Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : currentProjectionSeq + 1;

    let effectivePayloadJson: string | null = null;
    let effectivePayloadHash: string | null = null;
    let authorityCommandJson: string | null = null;
    let authorityCommandHash: string | null = null;
    let context: WebCommandContext | null = null;
    let unvalidated: StoredCommandOutcome<T | CommandBody>;
    if (rawCommand.expectedRevision !== currentCommandRevision) {
      unvalidated = revisionConflict(currentCommandRevision);
    } else {
      const expansion = invokeWithSavepoint(store, "web_command_expand", () => {
        const effectiveCommand = effectiveAuthorityCommandSchema.parse(input.expand()) as EffectiveAuthorityCommandV1;
        if (canonicalBytes(identityWithoutPayload(rawCommand)).compare(canonicalBytes(identityWithoutPayload(effectiveCommand))) !== 0) {
          throw new ControlError("control-effective-command-identity-mismatch");
        }
        return effectiveCommand;
      }, resultCommandRevision);
      if ("outcome" in expansion) {
        unvalidated = expansion.outcome;
      } else {
        const effectiveCommand = expansion.value;
        effectivePayloadJson = canonicalBytes(effectiveCommand.payload).toString("utf8");
        effectivePayloadHash = sha256Canonical(effectiveCommand.payload);
        authorityCommandJson = canonicalBytes(effectiveCommand).toString("utf8");
        authorityCommandHash = sha256Canonical(effectiveCommand);
        context = {
          rawCommand, effectiveCommand, rawRequestHash, effectivePayloadHash, authorityCommandHash,
          currentCommandRevision, nextCommandRevision, currentProjectionSeq, nextProjectionSeq,
        };
        const application = invokeWithSavepoint(
          store,
          "web_command_apply",
          () => input.apply(context!),
          resultCommandRevision,
          (value) => Number(value.status) >= 400 && Number(value.status) < 500,
        );
        unvalidated = "outcome" in application ? application.outcome : application.value;
      }
    }
    const outcome = validatedOutcome(unvalidated.status, unvalidated.body);
    if ("schema" in outcome.body) {
      if (context === null) invalidResult();
      assertSuccessIdentity(outcome.body, context);
    }
    const typedOutcome = outcome as unknown as StoredCommandOutcome<T>;

    const succeeded = outcome.status >= 200 && outcome.status < 300;
    const authorityChanged = succeeded && rawCommand.expectedRevision === currentCommandRevision && (typeof input.authorityChanged === "function"
      ? input.authorityChanged(typedOutcome)
      : input.authorityChanged ?? (outcome.status >= 200 && outcome.status < 300));
    if (authorityChanged && commandScope.groupId === null) throw new ControlError("control-global-authority-requires-explicit-groups");
    if (authorityChanged) {
      if (currentCommandRevision === Number.MAX_SAFE_INTEGER) throw new ControlError("control-sequence-overflow");
      updateRevision(store, commandScope.groupId!, currentCommandRevision + 1);
    }
    const projectionGroups = !succeeded ? [] : typeof input.projectionGroupIds === "function"
      ? input.projectionGroupIds(typedOutcome)
      : input.projectionGroupIds ?? (authorityChanged && commandScope.groupId !== null ? [commandScope.groupId] : []);
    if (projectionGroups.length > 0) recordProjectionChange(store, projectionGroups);

    const finalGroup = commandScope.groupId === null ? undefined : store.db.prepare("SELECT revision,projection_seq FROM groups WHERE id=?").get(commandScope.groupId);
    const commandRevision = commandScope.repoId !== null ? repositoryRevision(store, commandScope.repoId)
      : commandScope.groupId === null ? null : Number(finalGroup?.revision ?? currentCommandRevision);
    const projectionSeq = commandScope.groupId === null || !finalGroup ? null : Number(finalGroup.projection_seq);
    assertFinalVersions(outcome.body, commandRevision, projectionSeq);
    persistCommandOutcome(store, rawCommand, outcome, commandRevision, projectionSeq, {
      effectivePayloadJson, effectivePayloadHash, authorityCommandJson, authorityCommandHash,
    });
    return typedOutcome;
  });
}

export function lookupCommandResult(store: ControlStore, groupId: string, commandId: string): CommandLookupV1 | null {
  const row = store.db.prepare("SELECT original_status,body_json FROM commands WHERE group_id=? AND id=?")
    .get(groupId, commandId) as Pick<CommandRow, "original_status" | "body_json"> | undefined;
  if (!row || row.original_status === null || row.body_json === null) return null;
  const outcome = validatedOutcome(row.original_status, parsedBody(row.body_json));
  return { schema: "orca-command-lookup-v1", originalStatus: outcome.status, body: outcome.body };
}
