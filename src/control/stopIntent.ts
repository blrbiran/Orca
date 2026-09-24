import { createHash } from "node:crypto";
import { z } from "zod";
import { applyWebCommand, type WebCommandContext } from "./commandLedger.js";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { dimensions } from "./commands.js";
import { add, budgetBalance, subtract } from "./budget.js";
import { ControlError } from "./errors.js";
import { recordProjectionChange } from "./projectionJournal.js";
import { readBudgetProposal, readWork, saveWork, type BudgetProposalRecord } from "./queries.js";
import { writeCanonicalRecord } from "./snapshot.js";
import { rearmFailedContinuation } from "./continuation.js";
import { resumeBlockedDriverRun } from "./driveRecord.js";
import { dispatchEnvelopeSchema, type CapabilityViewV1, type CommandErrorBodyV1, type CommandSuccessV1, type RawAuthorityCommandV1 } from "./webProtocol.js";
import { idSchema, safeInteger, canonicalTimestampSchema } from "./schema.js";
import type { Amount } from "./types.js";
import type { ExecutionProfileRouter } from "./profiles.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { ControlStore } from "./store.js";

export type StopMode = "pause" | "shutdown" | "handoff";
export type StopState = "paused" | "handoff-pending" | "handoff-partial" | "handoff-unresolved" | "handoff-complete";
export type GroupStopState = "none" | StopState;
export type HandoffDisposition = "settled-recoverable" | "settled-restartable" | "settled-unrecoverable" | "outcome-unknown";
export interface StopIntentV1 {
  mode: StopMode;
  state: StopState;
  frozenRunIds: string[];
  acceptedAt: string | null;
  deadlineAt: string | null;
}
export interface StopDeps {
  store: ControlStore;
  profileRouter: ExecutionProfileRouter;
  admissionGate?: AdmissionGate;
  now?: () => Date;
  beforeCommit?: () => void;
}
export type PauseCommand = Extract<RawAuthorityCommandV1, { verb: "pause-dispatch" }>;
export type HandoffStopCommand = Extract<RawAuthorityCommandV1, { verb: "handoff-stop" }>;
export type ResumeDispatchCommand = Extract<RawAuthorityCommandV1, { verb: "resume-dispatch" }>;
export type RecoveryRetryCommand = Extract<RawAuthorityCommandV1, { verb: "recovery-retry" }>;
export type StopCommandResult = CommandSuccessV1 | CommandErrorBodyV1;
export type HandoffDelivery = Array<{ requestId: string; runId: string; state: string }>;
export type HandoffAttemptOutcome =
  | { kind: "reserved"; phaseAttemptOrdinal: number; envelopeHash: string; envelope: unknown }
  | { kind: "capability-unavailable"; reasonCode: string }
  | { kind: "settled-unrecoverable"; reasonCode: string }
  | { kind: "closed"; state: string };

const MAX_STOP_INSTANT = "9999-12-31T23:59:59.999Z";
export const HANDOFF_DEADLINE_MS = 30 * 60_000;
const OPEN_STATES = ["request-pending", "latched", "collecting"];
/** An outcome-unknown request still owns its run, so a later stop joins it rather than opening a second one. */
const ADOPTABLE_STATES = [...OPEN_STATES, "outcome-unknown"];
const SETTLED_STATES = ["settled-recoverable", "settled-restartable", "settled-unrecoverable"];

const stopIntentBodySchema = z
  .object({
    mode: z.enum(["pause", "shutdown", "handoff"]),
    state: z.enum(["paused", "handoff-pending", "handoff-partial", "handoff-unresolved", "handoff-complete"]),
    frozenRunIds: z.array(idSchema),
    acceptedAt: canonicalTimestampSchema.nullable(),
    deadlineAt: canonicalTimestampSchema.nullable(),
  })
  .strict();

const handoffRequestBodySchema = z
  .object({
    requestId: idSchema,
    runId: idSchema,
    state: z.enum(["request-pending", "latched", "collecting", ...SETTLED_STATES, "outcome-unknown"]),
    deadlineAt: canonicalTimestampSchema,
    phaseAttemptOrdinal: safeInteger.positive(),
    failureCode: z.string().min(1).nullable(),
    evidenceIds: z.array(idSchema),
  })
  .strict();

type HandoffRequestBody = z.infer<typeof handoffRequestBodySchema>;
export type GroupBody = {
  groupId: string;
  status: string;
  stopped: boolean;
  used: Amount;
  reserved: Amount;
  limit: Amount;
  ledger: {
    groupLimit: Amount;
    used: Amount;
    committedRemaining: Amount;
    explicitUnallocatedReserve: Amount;
    budgetDeficit: Amount;
    usageUnknown: boolean;
  };
  [key: string]: unknown;
};
export interface RunBody {
  runId: string;
  groupId: string;
  workItemId: string;
  taskId: string | null;
  estimateId: string | null;
  generation: number;
  graphVersion: number;
  phase: "estimate" | "work" | "handoff";
  state: string;
  claimOrdinal: number | null;
  providerAttemptOrdinal: number;
  ownerToken: string;
  grant: { work: Amount; handoff: Amount };
  remaining: { work: Amount; handoff: Amount };
  cumulative: { work: Amount; handoff: Amount };
  unknown: { work: boolean; handoff: boolean };
  failureCode: string | null;
  executionProfile: { profileId: string; profileHash: string };
  handoffProfile: { profileId: string; profileHash: string } | null;
  [key: string]: unknown;
}

const same = (left: unknown, right: unknown): boolean => canonicalBytes(left).compare(canonicalBytes(right)) === 0;

function blocked(detail: string): never {
  throw new ControlError("recovery-blocked", detail);
}

function parseStored<T>(schema: z.ZodType<T>, value: string, detail: string): T {
  const parsed = schema.safeParse(JSON.parse(value));
  if (!parsed.success) return blocked(`${detail}:${parsed.error.issues[0]?.message ?? "invalid"}`);
  return parsed.data;
}

export function groupCommandTarget(command: RawAuthorityCommandV1): string {
  if (command.target.kind === "global" || command.target.kind === "repository") throw new ControlError("control-target-not-allowed");
  return command.target.groupId;
}

export function commandSuccess(context: WebCommandContext, result: CommandSuccessV1["result"], status = 200): { status: number; body: CommandSuccessV1 } {
  return { status, body: {
    schema: "orca-command-success-v1", commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId, verb: context.rawCommand.verb,
    target: context.rawCommand.target, commandRevision: context.nextCommandRevision, projectionSeq: context.nextProjectionSeq,
    effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash, result,
  } };
}

export function readGroupBody(store: ControlStore, groupId: string): GroupBody {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  if (!row) throw new ControlError("group-not-found");
  const group = JSON.parse(String(row.body)) as GroupBody;
  if (group.groupId !== groupId || !same(group.used, group.ledger.used) || !same(group.reserved, group.ledger.committedRemaining)
    || !same(group.limit, group.ledger.groupLimit)) return blocked("group-ledger-mirror");
  return group;
}

export function saveGroupBody(store: ControlStore, group: GroupBody): void {
  store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(group), group.groupId);
}

export function readRunBody(store: ControlStore, runId: string): RunBody {
  const row = store.db.prepare("SELECT active,body FROM runs WHERE id=?").get(runId);
  if (!row) throw new ControlError("run-not-found");
  return JSON.parse(String(row.body)) as RunBody;
}

export function saveRunBody(store: ControlStore, run: RunBody, active: boolean | null = null): void {
  store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(run), run.runId);
  if (active !== null) store.db.prepare("UPDATE runs SET active=? WHERE id=?").run(active ? 1 : 0, run.runId);
}

export function writeHandoffRequest(store: ControlStore, request: HandoffRequestBody, groupId: string): void {
  store.db.prepare("INSERT INTO handoff_requests(id,group_id,run_id,state,body) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING")
    .run(request.requestId, groupId, request.runId, request.state, canonicalBytes(request).toString("utf8"));
}

export function saveHandoffRequest(store: ControlStore, groupId: string, request: HandoffRequestBody): void {
  const changed = store.db.prepare("UPDATE handoff_requests SET state=?,body=? WHERE group_id=? AND id=? AND body<>?")
    .run(request.state, canonicalBytes(request).toString("utf8"), groupId, request.requestId, canonicalBytes(request).toString("utf8")).changes;
  if (changed > 0) recordProjectionChange(store, [groupId]);
}

export function readHandoffRequest(store: ControlStore, groupId: string, requestId: string): { request: HandoffRequestBody; bodyJson: string } {
  const row = store.db.prepare("SELECT state,body FROM handoff_requests WHERE group_id=? AND id=?").get(groupId, requestId);
  if (!row) throw new ControlError("handoff-request-conflict");
  const bodyJson = String(row.body);
  const request = parseStored(handoffRequestBodySchema, bodyJson, "handoff-request-invalid");
  if (request.requestId !== requestId || request.state !== String(row.state) || canonicalBytes(request).toString("utf8") !== bodyJson) {
    return blocked("handoff-request-identity");
  }
  return { request, bodyJson };
}

/** The newest request a run owns is the only one a stop may act on. */
function latestRequestForRun(store: ControlStore, groupId: string, runId: string): HandoffRequestBody | null {
  const row = store.db.prepare("SELECT id FROM handoff_requests WHERE group_id=? AND run_id=? ORDER BY rowid DESC LIMIT 1").get(groupId, runId);
  return row ? readHandoffRequest(store, groupId, String(row.id)).request : null;
}

export function readStopIntent(store: ControlStore, groupId: string): StopIntentV1 | null {
  const row = store.db.prepare("SELECT mode,revision,body FROM stop_intents WHERE group_id=?").get(groupId);
  if (!row) return null;
  const bodyJson = String(row.body);
  const intent = parseStored(stopIntentBodySchema, bodyJson, "stop-intent-invalid");
  const revision = Number(row.revision);
  const groupRevision = Number(store.db.prepare("SELECT revision FROM groups WHERE id=?").get(groupId)?.revision ?? 0);
  const sorted = [...new Set(intent.frozenRunIds)].sort((left, right) => left.localeCompare(right));
  if (canonicalBytes(intent).toString("utf8") !== bodyJson || String(row.mode) !== intent.mode
    || !Number.isSafeInteger(revision) || revision <= 0 || revision > groupRevision
    || sorted.join("\0") !== intent.frozenRunIds.join("\0")) return blocked("stop-intent-identity");
  return intent;
}

export function saveStopIntent(store: ControlStore, groupId: string, mode: StopMode, revision: number, intent: StopIntentV1): void {
  store.db.prepare(`INSERT INTO stop_intents(group_id,mode,revision,body) VALUES (?,?,?,?)
    ON CONFLICT(group_id) DO UPDATE SET mode=excluded.mode,revision=excluded.revision,body=excluded.body`)
    .run(groupId, mode, revision, canonicalBytes(intent).toString("utf8"));
}

function rewriteStopIntentState(store: ControlStore, groupId: string, intent: StopIntentV1, state: StopState): void {
  if (intent.state === state) return;
  const body = { ...intent, state };
  if (stopIntentBodySchema.safeParse(body).success) {
    store.db.prepare("UPDATE stop_intents SET body=? WHERE group_id=?").run(canonicalBytes(body).toString("utf8"), groupId);
    recordProjectionChange(store, [groupId]);
  }
}

export function groupStopState(store: ControlStore, groupId: string): GroupStopState {
  const intent = readStopIntent(store, groupId);
  if (!intent) return "none";
  if (intent.mode === "pause") return "paused";
  return deriveStopState(store, groupId, intent.frozenRunIds);
}

export function deriveStopState(store: ControlStore, groupId: string, frozenRunIds: readonly string[]): StopState {
  let unresolved = false, pending = false, partial = false;
  for (const runId of frozenRunIds) {
    const state = latestRequestForRun(store, groupId, runId)?.state ?? null;
    if (state === null || state === "outcome-unknown") unresolved = true;
    else if (OPEN_STATES.includes(state)) pending = true;
    else if (state === "settled-unrecoverable") partial = true;
  }
  return unresolved ? "handoff-unresolved" : pending ? "handoff-pending" : partial ? "handoff-partial" : "handoff-complete";
}

export function freezeHandoffDuration(acceptedAt: string, deadlineAt: string): number {
  return Math.max(Date.parse(deadlineAt) - Date.parse(acceptedAt), 0);
}

/** The default deadline is `acceptedAt + 30min`, saturating at the maximum protocol instant. */
export function freezeHandoffDeadline(acceptedAt: string, requested: string | null | undefined): string {
  if (requested !== undefined && requested !== null) return requested;
  const candidate = Date.parse(acceptedAt) + HANDOFF_DEADLINE_MS;
  return candidate > Date.parse(MAX_STOP_INSTANT) ? MAX_STOP_INSTANT : new Date(candidate).toISOString();
}

/** Every run still open in the group, plus any estimate the ledger still treats as in flight. */
export function frozenRunIds(store: ControlStore, groupId: string): string[] {
  const ids = new Set(store.db.prepare("SELECT id FROM runs WHERE group_id=? AND active=1").all(groupId).map(row => String(row.id)));
  return [...ids].sort((left, right) => left.localeCompare(right));
}

function adoptRequest(
  store: ControlStore,
  groupId: string,
  run: RunBody,
  existing: HandoffRequestBody,
  desired: string,
  acceptedAt: string,
  deadlineAt: string,
  origin: "handoff" | "shutdown",
): string {
  const effective = Date.parse(existing.deadlineAt) < Date.parse(deadlineAt) ? existing.deadlineAt : deadlineAt;
  const join = {
    schema: "orca-handoff-join-v1", joinId: `handoff-join:${desired}:${existing.requestId}`,
    desiredRequestId: desired, existingRequestId: existing.requestId, runId: run.runId, generation: run.generation,
    origin, effectiveDeadlineAt: effective, createdAt: acceptedAt,
  };
  store.db.prepare("INSERT INTO handoff_request_joins(request_id,joined_request_id,body) VALUES (?,?,?) ON CONFLICT(request_id,joined_request_id) DO NOTHING")
    .run(existing.requestId, desired, canonicalBytes(join).toString("utf8"));
  if (effective !== existing.deadlineAt) saveHandoffRequest(store, groupId, { ...existing, deadlineAt: effective });
  return existing.requestId;
}

export function freezeRun(store: ControlStore, groupId: string, runId: string, stopMode: StopMode, stopRevision: number, acceptedAt: string, deadlineAt: string): string {
  const desired = `${stopMode === "shutdown" ? "shutdown" : "handoff-stop"}:${groupId}:${stopRevision}:${runId}`;
  const origin: "handoff" | "shutdown" = stopMode === "shutdown" ? "shutdown" : "handoff";
  const run = readRunBody(store, runId);
  const existing = latestRequestForRun(store, groupId, runId);
  if (existing) {
    if (!ADOPTABLE_STATES.includes(existing.state)) return blocked("handoff-request-already-settled");
    return adoptRequest(store, groupId, run, existing, desired, acceptedAt, deadlineAt, origin);
  }
  const request: HandoffRequestBody = {
    requestId: `handoff-${createHash("sha256").update(desired).digest("hex")}`, runId, state: "request-pending",
    deadlineAt, phaseAttemptOrdinal: run.providerAttemptOrdinal + 1, failureCode: null, evidenceIds: [],
  };
  writeHandoffRequest(store, request, groupId);
  const outbox = {
    desiredRequestId: desired, requestId: request.requestId, groupId, runId, generation: run.generation,
    origin, acceptedAt, deadlineAt,
  };
  store.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?,'handoff-request',?,0) ON CONFLICT(id) DO NOTHING")
    .run(desired, canonicalBytes(outbox).toString("utf8"));
  recordProjectionChange(store, [groupId]);
  return request.requestId;
}

export function applyPauseDispatch(deps: StopDeps, command: PauseCommand): StopCommandResult {
  const { store } = deps;
  const release = deps.admissionGate?.enter();
  try {
    return applyWebCommand<StopCommandResult>(store, {
      rawCommand: command,
      expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      apply: context => {
        const groupId = groupCommandTarget(command);
        const existing = readStopIntent(store, groupId);
        if (existing) throw new ControlError(existing.mode === "pause" ? "stop-already-active" : "stop-mode-conflict");
        const group = readGroupBody(store, groupId);
        saveStopIntent(store, groupId, "pause", context.nextCommandRevision, {
          mode: "pause", state: "paused", frozenRunIds: [], acceptedAt: null, deadlineAt: null,
        });
        group.stopped = true;
        saveGroupBody(store, group);
        deps.beforeCommit?.();
        return commandSuccess(context, { kind: "paused", stopMode: "pause" });
      },
    }).body;
  } finally { release?.(); }
}

export function applyHandoffStop(deps: StopDeps, command: HandoffStopCommand): StopCommandResult {
  const { store } = deps;
  const acceptedAt = (deps.now ?? (() => new Date()))().toISOString();
  const deadlineAt = freezeHandoffDeadline(acceptedAt, command.payload.handoffDeadlineAt);
  const release = deps.admissionGate?.enter();
  try {
    return applyWebCommand<StopCommandResult>(store, {
      rawCommand: command,
      expand: () => ({ ...command, schema: "orca-authority-command-v1", payload: { handoffDeadlineAt: deadlineAt } }),
      apply: context => {
        const groupId = groupCommandTarget(command);
        const existing = readStopIntent(store, groupId);
        if (existing?.mode === "shutdown") throw new ControlError("stop-mode-conflict");
        if (existing?.mode === "handoff") throw new ControlError("stop-already-active");
        const group = readGroupBody(store, groupId);
        const frozen = frozenRunIds(store, groupId);
        const requestIds = frozen.map(runId => freezeRun(store, groupId, runId, "handoff", context.nextCommandRevision, acceptedAt, deadlineAt)).sort();
        const state = deriveStopState(store, groupId, frozen);
        saveStopIntent(store, groupId, "handoff", context.nextCommandRevision, {
          mode: "handoff", state, frozenRunIds: frozen, acceptedAt, deadlineAt,
        });
        group.stopped = true;
        saveGroupBody(store, group);
        deps.beforeCommit?.();
        return commandSuccess(context, {
          kind: "handoff-stopped", stopRevision: context.nextCommandRevision, acceptedAt, handoffDeadlineAt: deadlineAt, frozenRunIds: frozen, requestIds,
        });
      },
    }).body;
  } finally { release?.(); }
}

export function applyResumeDispatch(deps: StopDeps, command: ResumeDispatchCommand): StopCommandResult {
  const { store } = deps;
  const release = deps.admissionGate?.enter();
  try {
    return applyWebCommand<StopCommandResult>(store, {
      rawCommand: command,
      expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      apply: context => {
        const groupId = groupCommandTarget(command);
        const existing = readStopIntent(store, groupId);
        if (existing?.mode !== "pause") throw new ControlError("stop-mode-conflict");
        const group = readGroupBody(store, groupId);
        store.db.prepare("DELETE FROM stop_intents WHERE group_id=?").run(groupId);
        group.stopped = false;
        saveGroupBody(store, group);
        const wakeId = startSchedulerWake(store, groupId, context.nextCommandRevision);
        deps.beforeCommit?.();
        return commandSuccess(context, { kind: "scheduled", operation: "resume-dispatch", wakeId }, 202);
      },
    }).body;
  } finally { release?.(); }
}

/** Arm one ordinary ready-work dispatch claim for the group under `startRevision`. */
export function startSchedulerWake(store: ControlStore, groupId: string, startRevision: number): string {
  const proposal = readBudgetProposal(store, groupId);
  if (proposal.state !== "confirmed" || proposal.executionSnapshotHash === null) throw new ControlError("group-state-invalid");
  const wakeId = `scheduler-wake:${groupId}:${startRevision}`;
  store.db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES (?,?,'start',?,0) ON CONFLICT(id) DO NOTHING")
    .run(wakeId, groupId, canonicalBytes({ groupId, startRevision, executionSnapshotHash: proposal.executionSnapshotHash }).toString("utf8"));
  return wakeId;
}

export function applyRecoveryRetry(deps: StopDeps, command: RecoveryRetryCommand): StopCommandResult {
  const { store } = deps;
  const release = deps.admissionGate?.enter();
  try {
    return applyWebCommand<StopCommandResult>(store, {
      rawCommand: command,
      expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      apply: context => {
        const target = command.target;
        if (target.kind === "global" || target.kind === "repository") throw new ControlError("control-target-not-allowed");
        const groupId = target.groupId;
        const observed = target.kind === "run"
          ? retryRun(store, groupId, target.runId, context)
          : retryGroup(store, groupId, context);
        const result: CommandSuccessV1["result"] = {
          kind: "recovery-observed", resolved: observed.resolved,
          blockerCodes: [...new Set(observed.blockerCodes)].sort(), evidenceIds: [...new Set(observed.evidenceIds)].sort(),
          wakeIds: [...new Set(observed.wakeIds)].sort(),
        };
        deps.beforeCommit?.();
        return commandSuccess(context, result);
      },
    }).body;
  } finally { release?.(); }
}

interface ObservedRecovery { resolved: boolean; blockerCodes: string[]; evidenceIds: string[]; wakeIds: string[] }

function clearedBlockers(store: ControlStore, groupId: string, runId: string | null): { codes: string[]; evidenceIds: string[]; resolved: boolean } {
  const rows = runId === null
    ? store.db.prepare("SELECT id,code,body FROM recovery_blockers WHERE group_id=? AND scope='group' ORDER BY id").all(groupId)
    : store.db.prepare("SELECT id,code,body FROM recovery_blockers WHERE group_id=? AND run_id=? ORDER BY id").all(groupId, runId);
  const codes: string[] = [], evidenceIds: string[] = [];
  for (const row of rows) {
    const body = parseStored(z.object({ evidenceIds: z.array(idSchema) }).strict(), String(row.body), "recovery-blocker-invalid");
    codes.push(String(row.code));
    evidenceIds.push(...body.evidenceIds);
    store.db.prepare("DELETE FROM recovery_blockers WHERE id=?").run(String(row.id));
  }
  return { codes, evidenceIds, resolved: rows.length > 0 };
}

function retryRun(store: ControlStore, groupId: string, runId: string, context: WebCommandContext): ObservedRecovery {
  const blockers = clearedBlockers(store, groupId, runId);
  const wakeIds: string[] = [];
  const run = readRunBody(store, runId);
  if (run.groupId !== groupId) return blocked("recovery-run-owner");
  const rearm = rearmFailedContinuation(store, groupId, run);
  if (rearm !== null) wakeIds.push(rearm);
  const resumedDriverRun = resumeBlockedDriverRun(store, runId);
  const resolved = blockers.resolved || rearm !== null || resumedDriverRun;
  const requestId = store.db.prepare("SELECT id FROM handoff_requests WHERE group_id=? AND run_id=? ORDER BY rowid DESC LIMIT 1").get(groupId, runId);
  if (!requestId) return { resolved, blockerCodes: blockers.codes, evidenceIds: blockers.evidenceIds, wakeIds };
  const { request } = readHandoffRequest(store, groupId, String(requestId.id));
  if (request.state !== "outcome-unknown") return { resolved, blockerCodes: blockers.codes, evidenceIds: blockers.evidenceIds, wakeIds };
  const identity = `handoff-recovery:${request.requestId}:${context.rawCommand.commandId}`;
  store.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?,'handoff-recovery',?,0) ON CONFLICT(id) DO NOTHING")
    .run(identity, canonicalBytes({ requestId: request.requestId, runId, groupId, commandId: context.rawCommand.commandId, requeuedAt: context.rawCommand.commandId }).toString("utf8"));
  saveHandoffRequest(store, groupId, { ...request, state: "request-pending", failureCode: null });
  return { resolved: true, blockerCodes: blockers.codes, evidenceIds: blockers.evidenceIds, wakeIds };
}

function retryGroup(store: ControlStore, groupId: string, context: WebCommandContext): ObservedRecovery {
  void context;
  const blockers = clearedBlockers(store, groupId, null);
  return { resolved: blockers.resolved, blockerCodes: blockers.codes, evidenceIds: blockers.evidenceIds, wakeIds: [] };
}

export function deliverHandoffStop(deps: StopDeps, groupId: string): HandoffDelivery {
  const { store } = deps;
  const release = deps.admissionGate?.enter();
  try {
    return store.transaction(() => {
      const rows = store.db.prepare("SELECT id,body FROM outbox WHERE kind='handoff-request' AND delivered=0 AND json_extract(body,'$.groupId')=? ORDER BY rowid").all(groupId);
      const delivered: HandoffDelivery = [];
      for (const row of rows) {
        const body = JSON.parse(String(row.body)) as { requestId: string };
        const { request } = readHandoffRequest(store, groupId, String(body.requestId));
        const run = readRunBody(store, request.runId);
        let next = request;
        if (request.state === "request-pending" && !isModelAssisted(deps.profileRouter, run)) {
          const intent = readStopIntent(store, groupId);
          const deadlineAt = intent && Date.parse(intent.deadlineAt ?? MAX_STOP_INSTANT) < Date.parse(request.deadlineAt) ? intent.deadlineAt! : request.deadlineAt;
          next = { ...request, state: "latched", deadlineAt };
          saveHandoffRequest(store, groupId, next);
        }
        if (next.state !== "request-pending") {
          store.db.prepare("UPDATE outbox SET delivered=1 WHERE id=?").run(String(row.id));
        }
        delivered.push({ requestId: request.requestId, runId: request.runId, state: next.state });
      }
      if (delivered.length > 0) recordProjectionChange(store, [groupId]);
      return delivered;
    });
  } finally { release?.(); }
}

function isModelAssisted(router: ExecutionProfileRouter, run: RunBody): boolean {
  if (run.handoffProfile === null) return false;
  const binding = router.resolve("handoff", run.handoffProfile.profileId, run.handoffProfile.profileHash);
  return binding.snapshot.profile.capabilities.handoffExecution === "model-assisted-v1";
}

/** The declared capability view; a model-assisted profile needs a fresh probe before every attempt. */
function declaredHandoffExecution(router: ExecutionProfileRouter, run: RunBody): string | null {
  try {
    if (run.handoffProfile === null) return "mechanical-in-run-v1";
    return router.resolve("handoff", run.handoffProfile.profileId, run.handoffProfile.profileHash).snapshot.profile.capabilities.handoffExecution;
  } catch (error) {
    if (error instanceof ControlError && error.code === "profile-changed") return null;
    throw error;
  }
}

function hasHandoffProviderStart(store: ControlStore, run: RunBody): boolean {
  return store.db.prepare("SELECT kind FROM attempt_evidence WHERE run_id=? AND generation=? AND phase='handoff' AND kind='provider-start'").get(run.runId, run.generation) !== undefined;
}

function settleRequestUnrecoverably(deps: StopDeps, groupId: string, requestId: string, reasonCode: string): void {
  const { store } = deps;
  store.transaction(() => {
    settleHandoffRequestInTransaction(deps, groupId, requestId, "settled-unrecoverable", reasonCode);
  });
}

export async function beginHandoffAttempt(deps: StopDeps, requestId: string): Promise<HandoffAttemptOutcome> {
  const { store, profileRouter } = deps;
  const release = deps.admissionGate?.enter();
  try {
    const prepared = store.transaction(() => {
      const intent = store.db.prepare("SELECT group_id FROM handoff_requests WHERE id=?").get(requestId);
      if (!intent) throw new ControlError("handoff-request-conflict");
      const groupId = String(intent.group_id);
      const { request } = readHandoffRequest(store, groupId, requestId);
      if (!OPEN_STATES.includes(request.state)) return { closed: request.state as string | null, groupId, request, run: null as RunBody | null, next: 0, execution: null as string | null };
      const run = readRunBody(store, request.runId);
      const execution = declaredHandoffExecution(profileRouter, run);
      const next = Math.max(request.phaseAttemptOrdinal, run.providerAttemptOrdinal + 1);
      return { closed: null as string | null, groupId, request, run, next, execution };
    });
    if (prepared.closed !== null) return { kind: "closed", state: prepared.closed };
    const { groupId, request, run } = prepared as { groupId: string; request: HandoffRequestBody; run: RunBody; next: number; execution: string | null };
    const next = prepared.next;

    const settle = (reasonCode: string): void => settleRequestUnrecoverably(deps, groupId, requestId, reasonCode);
    if (prepared.execution === null) return settleNow("profile-changed");
    if (next >= Number.MAX_SAFE_INTEGER) return settleNow("identity-space-exhausted");

    function settleNow(reasonCode: string): HandoffAttemptOutcome {
      settle(reasonCode);
      return { kind: "settled-unrecoverable", reasonCode };
    }

    if (prepared.execution === "model-assisted-v1") {
      const profile = profileRouter.resolve("handoff", run.handoffProfile!.profileId, run.handoffProfile!.profileHash);
      const observed = await profileRouter.probe(profile);
      const cap: CapabilityViewV1 = observed.observed;
      if (observed.probeFailureCode !== null || cap.handoffControl !== "durable" || cap.handoffExecution !== "model-assisted-v1") {
        const reasonCode = "handoff-capability-unavailable";
        store.transaction(() => {
          saveHandoffRequest(store, groupId, { ...request, failureCode: reasonCode });
        });
        return { kind: "capability-unavailable", reasonCode };
      }
    }

    return store.transaction(() => {
      const current = readHandoffRequest(store, groupId, requestId).request;
      if (!OPEN_STATES.includes(current.state)) return { kind: "closed" as const, state: current.state };
      const fresh = readRunBody(store, current.runId);
      const ordinal = Math.max(current.phaseAttemptOrdinal, fresh.providerAttemptOrdinal + 1, next);
      const sessionReservation = hasHandoffProviderStart(store, fresh) ? 0 : 1;
      const envelope = handoffAttemptEnvelope(deps, groupId, fresh, current, ordinal);
      store.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?, 'handoff-attempt', ?, 0) ON CONFLICT(id) DO NOTHING")
        .run(`handoff-attempt:${requestId}:${ordinal}`, canonicalBytes({
          requestId, runId: fresh.runId, phase: "handoff", sessionReservation, attemptReservation: 1, envelopeHash: sha256Canonical(envelope),
        }).toString("utf8"));
      saveHandoffRequest(store, groupId, { ...current, state: "request-pending", phaseAttemptOrdinal: ordinal });
      saveRunBody(store, { ...fresh, providerAttemptOrdinal: ordinal });
      recordProjectionChange(store, [groupId]);
      return { kind: "reserved" as const, phaseAttemptOrdinal: ordinal, envelopeHash: sha256Canonical(envelope), envelope };
    });
  } finally { release?.(); }
}

function derivedContractHash(store: ControlStore, groupId: string, run: RunBody): string {
  if (run.phase === "estimate" || run.taskId === null) {
    const row = store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='estimate-contract'").get(`estimate-contract:${groupId}:${run.workItemId}`);
    if (!row) throw new ControlError("recovery-blocked");
    return String((JSON.parse(String(row.body)) as { contractHash: string }).contractHash);
  }
  const work = readWork(store, groupId, run.workItemId) as unknown as { derivedContractHash: string | null };
  if (work.derivedContractHash === null) throw new ControlError("recovery-blocked");
  return work.derivedContractHash;
}

function handoffAttemptEnvelope(deps: StopDeps, groupId: string, run: RunBody, request: HandoffRequestBody, ordinal: number) {
  const { profileId, profileHash } = run.handoffProfile
    ?? (() => { const [first] = deps.profileRouter.list(); return { profileId: first.snapshot.profile.profileId, profileHash: first.profileHash }; })();
  const envelope = dispatchEnvelopeSchema.parse({
    schema: "orca-dispatch-envelope-v1", phase: "handoff", groupId, workItemId: run.workItemId, runId: run.runId, generation: run.generation,
    claimIdentity: `${request.requestId}:attempt:${ordinal}`, ownerTokenHash: createHash("sha256").update(run.ownerToken).digest("hex"),
    continuationIntentId: null, claimOrdinal: run.claimOrdinal ?? 1, derivedContractHash: derivedContractHash(deps.store, groupId, run),
    grants: run.grant, profiles: { estimator: null, worker: null, handoff: { profileId, profileHash } },
  });
  writeCanonicalRecord(deps.store, groupId, sha256Canonical(envelope), canonicalBytes(envelope).toString("utf8"));
  return envelope;
}

export function settleHandoffRequest(
  deps: StopDeps,
  input: { requestId: string; outcome: HandoffDisposition; reasonCode?: string | null },
): { state: string; groupStopState: GroupStopState } {
  const { store } = deps;
  const release = deps.admissionGate?.enter();
  try {
    return store.transaction(() => settleHandoffRequestInTransaction(deps, requestedGroup(store, input.requestId), input.requestId, input.outcome, input.reasonCode ?? null));
  } finally { release?.(); }
}

function requestedGroup(store: ControlStore, requestId: string): string {
  const row = store.db.prepare("SELECT group_id FROM handoff_requests WHERE id=?").get(requestId);
  if (!row) throw new ControlError("handoff-request-conflict");
  return String(row.group_id);
}

function settleHandoffRequestInTransaction(
  deps: StopDeps,
  groupId: string,
  requestId: string,
  outcome: HandoffDisposition,
  reasonCode: string | null,
): { state: string; groupStopState: GroupStopState } {
  const { store } = deps;
  const request = readHandoffRequest(store, groupId, requestId).request;
  // A settle the adapter re-delivers after losing its answer is the same settlement, not a
  // second one: re-running it would give the group reserve back twice and under-book live runs.
  if (!ADOPTABLE_STATES.includes(request.state)) {
    return { state: request.state, groupStopState: groupStopState(store, groupId) };
  }
  const run = readRunBody(store, request.runId);
  if (outcome !== "outcome-unknown") {
    saveHandoffRequest(store, groupId, { ...request, state: outcome, failureCode: reasonCode });
    terminaliseRun(store, groupId, run, outcome, reasonCode);
  } else {
    saveHandoffRequest(store, groupId, { ...request, state: "outcome-unknown", failureCode: reasonCode });
  }
  const intent = readStopIntent(store, groupId);
  if (intent && intent.mode !== "pause") {
    rewriteStopIntentState(store, groupId, intent, deriveStopState(store, groupId, intent.frozenRunIds));
  }
  return { state: outcome === "outcome-unknown" ? "outcome-unknown" : outcome, groupStopState: groupStopState(store, groupId) };
}

function terminaliseRun(store: ControlStore, groupId: string, run: RunBody, outcome: HandoffDisposition, reasonCode: string | null): void {
  const settled: RunBody = { ...run, state: outcome, failureCode: reasonCode };
  saveRunBody(store, settled, false);
  const released = add(settled.remaining.work, settled.remaining.handoff);
  if (run.phase === "estimate" && run.estimateId !== null) {
    interruptEstimate(store, groupId, run.estimateId);
    releaseCommitment(store, groupId, settled.remaining.work);
    return;
  }
  const work = readWork(store, groupId, run.workItemId) as unknown as { status: string; grant: { work: Amount; handoff: Amount } };
  if (outcome === "settled-unrecoverable") {
    setAllocationStates(store, groupId, run.workItemId, "terminal");
    work.status = "blocked";
    saveWork(store, groupId, work as never);
    releaseCommitment(store, groupId, released);
    return;
  }
  // §5.1.1: a recoverable predecessor parks its commitment at `each predecessor bucket's grant
  // minus settled cumulative usage`, so §6.3's continuation inherits that remainder rather than
  // the original plan grant. `remaining` already holds it, clamped at zero by usage settlement.
  setAllocationStates(store, groupId, run.workItemId, "held", settled.remaining);
  work.status = "held";
  work.grant = settled.remaining;
  saveWork(store, groupId, work as never);
}

function interruptEstimate(store: ControlStore, groupId: string, estimateId: string): void {
  const row = store.db.prepare("SELECT state,body FROM estimates WHERE group_id=? AND id=?").get(groupId, estimateId);
  if (!row) return;
  const estimate = JSON.parse(String(row.body)) as { estimateId: string; state: string; reasonCode: string | null };
  if (estimate.state === "interrupted") return;
  if (!["queued", "running", "start-unknown"].includes(estimate.state)) return;
  estimate.state = "interrupted";
  store.db.prepare("UPDATE estimates SET state=?,body=? WHERE group_id=? AND id=?")
    .run(estimate.state, canonicalBytes(estimate).toString("utf8"), groupId, estimateId);
  recordProjectionChange(store, [groupId]);
}

export function setAllocationStates(
  store: ControlStore,
  groupId: string,
  ownerId: string,
  state: BudgetProposalRecord["allocations"][number]["state"],
  amounts?: { work: Amount; handoff: Amount },
): void {
  const proposal = readBudgetProposal(store, groupId);
  let changed = false;
  for (const allocation of proposal.allocations) {
    if (allocation.ownerKind !== "task" || allocation.ownerId !== ownerId) continue;
    const amount = amounts?.[allocation.bucket as "work" | "handoff"];
    if (amount && dimensions.some(d => allocation.amount[d] !== amount[d])) { allocation.amount = { ...amount }; changed = true; }
    if (allocation.state !== state) { allocation.state = state; changed = true; }
  }
  if (!changed) return;
  store.db.prepare("UPDATE budget_proposals SET body=? WHERE group_id=?").run(canonicalBytes(proposal).toString("utf8"), groupId);
  recordProjectionChange(store, [groupId]);
}

/** Give the group reserve back for a commitment that has ended, keeping every ledger mirror in sync. */
export function releaseCommitment(store: ControlStore, groupId: string, released: Amount): void {
  const group = readGroupBody(store, groupId);
  const proposal = readBudgetProposal(store, groupId);
  group.reserved = subtract(group.reserved, released);
  const balance = budgetBalance(group.limit, group.used, group.reserved);
  group.ledger = {
    ...group.ledger, used: group.used, committedRemaining: group.reserved,
    explicitUnallocatedReserve: balance.reserve, budgetDeficit: balance.deficit,
  };
  const reserve = proposal.allocations.find(allocation => allocation.ownerKind === "reserve");
  if (!reserve) return blocked("reserve-allocation-missing");
  reserve.amount = balance.reserve;
  proposal.explicitUnallocatedReserve = balance.reserve;
  store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(group), groupId);
  store.db.prepare("UPDATE budget_proposals SET body=? WHERE group_id=?").run(canonicalBytes(proposal).toString("utf8"), groupId);
  recordProjectionChange(store, [groupId]);
}

export function readFrozenSnapshotHash(store: ControlStore, groupId: string): string {
  const proposal = readBudgetProposal(store, groupId);
  if (proposal.state !== "confirmed" || proposal.executionSnapshotHash === null) throw new ControlError("group-state-invalid");
  return proposal.executionSnapshotHash;
}
