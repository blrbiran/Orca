import { createHash } from "node:crypto";
import { applyWebCommand, updateRevision } from "../control/commandLedger.js";
import { canonicalBytes } from "../control/canonicalJson.js";
import { ControlError } from "../control/errors.js";
import { recordProjectionChange } from "../control/projectionJournal.js";
import {
  deriveStopState,
  frozenRunIds,
  freezeRun,
  readGroupBody,
  readStopIntent,
  saveGroupBody,
  saveStopIntent,
  type StopIntentV1,
} from "../control/stopIntent.js";
import { isWebWorkRun } from "../control/webDispatch.js";
import type { ExecutionProfileRouter } from "../control/profiles.js";
import type { AdmissionGate } from "../control/admissionGate.js";
import type { ControlStore } from "../control/store.js";
import type { CommandSuccessV1, RawAuthorityCommandV1 } from "../control/webProtocol.js";

/** Default wall-clock budget for one panel shutdown, per the design spec. */
export const DEFAULT_SHUTDOWN_GRACE_MS = 120_000;
const MAX_SHUTDOWN_INSTANT = "9999-12-31T23:59:59.999Z";
const SHUTDOWN_ACTOR = "panel-shutdown";

export interface ShutdownWindow {
  shutdownAcceptedAt: string;
  shutdownDeadlineAt: string;
}

export interface PanelShutdownDeps {
  store: ControlStore;
  profileRouter: ExecutionProfileRouter;
  admissionGate?: AdmissionGate;
  epoch: string;
  shutdownGraceMs?: number;
  now?: () => Date;
  beforeCommit?: () => void;
  /**
   * Execution driver spec §4: a run the driver owns keeps running in ccloop across an Orca restart and is
   * collected afterwards, so no stop is frozen for it. Off unless a driver exists.
   */
  exemptDriverRuns?: boolean;
}

export interface PanelStartupOrder {
  recover: () => Promise<void>;
  listen: () => Promise<void>;
}

type Disposition = "created" | "strengthened-pause" | "preserved-pause" | "preserved-handoff" | "preserved-shutdown" | "blocked-inconsistent";

interface ShutdownGroupEntry {
  groupId: string;
  disposition: Disposition;
  changed: boolean;
  commandRevision: number;
  projectionSeq: number;
  frozenRunIds: string[];
  requestIds: string[];
  blockerCode: string | null;
}

type ShutdownCommand = Extract<RawAuthorityCommandV1, { verb: "shutdown" }>;

/**
 * The shutdown window is absolute wall-clock time frozen at accept: the deadline
 * saturates at the maximum protocol instant rather than wrapping.
 */
export function freezeShutdownWindow(input: { now: () => Date; shutdownGraceMs?: number }): ShutdownWindow {
  const acceptedAt = input.now().toISOString();
  const grace = input.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
  const candidate = Date.parse(acceptedAt) + grace;
  return {
    shutdownAcceptedAt: acceptedAt,
    shutdownDeadlineAt: candidate > Date.parse(MAX_SHUTDOWN_INSTANT) ? MAX_SHUTDOWN_INSTANT : new Date(candidate).toISOString(),
  };
}

/** The idSchema carries no colon, so the global shutdown identity is hash-shaped. */
export function shutdownCommandId(epoch: string): string {
  return `shutdown-${createHash("sha256").update(epoch).digest("hex")}`;
}

/** One admitted writer, or an immediate `panel-draining` refusal once the gate is draining. */
export function withAdmission<T>(deps: { admissionGate?: AdmissionGate }, write: () => T): T {
  const release = deps.admissionGate?.enter();
  try {
    return write();
  } finally {
    release?.();
  }
}

function revisionOf(store: ControlStore, groupId: string): number {
  return Number(store.db.prepare("SELECT revision FROM groups WHERE id=?").get(groupId)!.revision);
}

function projectionOf(store: ControlStore, groupId: string): number {
  return Number(store.db.prepare("SELECT projection_seq FROM groups WHERE id=?").get(groupId)!.projection_seq);
}

function versions(store: ControlStore, groupId: string): { commandRevision: number; projectionSeq: number } {
  return { commandRevision: revisionOf(store, groupId), projectionSeq: projectionOf(store, groupId) };
}

/** A pending shutdown whose frozen set names a run neither active nor request-owned cannot be reconciled. */
function frozenSetIsInconsistent(store: ControlStore, groupId: string, intent: StopIntentV1, active: readonly string[]): boolean {
  if (intent.mode !== "shutdown" || intent.state === "handoff-complete" || intent.frozenRunIds.length === 0) return false;
  return intent.frozenRunIds.some((runId) => !active.includes(runId)
    && store.db.prepare("SELECT id FROM handoff_requests WHERE group_id=? AND run_id=?").get(groupId, runId) === undefined);
}

function recordInconsistency(store: ControlStore, groupId: string, shutdownId: string): void {
  store.db.prepare("INSERT INTO recovery_blockers(id,group_id,run_id,scope,code,body) VALUES (?,?,NULL,'group','shutdown-frozen-set-inconsistent',?) ON CONFLICT(id) DO NOTHING")
    .run(`shutdown-inconsistent:${groupId}:${shutdownId}`, groupId, canonicalBytes({ evidenceIds: [] }).toString("utf8"));
  recordProjectionChange(store, [groupId]);
}

/**
 * Compose one shutdown intent per group under a single global command: a pause is
 * strengthened only when it must actually stop a run, and a human handoff-stop or
 * an earlier epoch's deadline is never rewritten.
 */
export function shutdownGroup(store: ControlStore, groupId: string, window: ShutdownWindow, shutdownId: string, exemptDriverRuns = false): ShutdownGroupEntry {
  const intent = readStopIntent(store, groupId);
  const active = frozenRunIds(store, groupId).filter((runId) => !(exemptDriverRuns && isWebWorkRun(store, runId)));
  if (intent !== null && frozenSetIsInconsistent(store, groupId, intent, active)) {
    recordInconsistency(store, groupId, shutdownId);
    return { groupId, disposition: "blocked-inconsistent", changed: false, ...versions(store, groupId),
      frozenRunIds: intent.frozenRunIds, requestIds: [], blockerCode: "shutdown-frozen-set-inconsistent" };
  }
  if (intent !== null && (intent.mode === "handoff" || intent.mode === "shutdown")) {
    return { groupId, disposition: intent.mode === "handoff" ? "preserved-handoff" : "preserved-shutdown",
      changed: false, ...versions(store, groupId), frozenRunIds: intent.frozenRunIds, requestIds: [], blockerCode: null };
  }
  if (intent?.mode === "pause" && active.length === 0) {
    return { groupId, disposition: "preserved-pause", changed: false, ...versions(store, groupId), frozenRunIds: [], requestIds: [], blockerCode: null };
  }
  const stopRevision = revisionOf(store, groupId) + 1;
  updateRevision(store, groupId, stopRevision);
  const requestIds = active.map(runId => freezeRun(store, groupId, runId, "shutdown", stopRevision, window.shutdownAcceptedAt, window.shutdownDeadlineAt)).sort();
  saveStopIntent(store, groupId, "shutdown", stopRevision, {
    mode: "shutdown", state: deriveStopState(store, groupId, active), frozenRunIds: active,
    acceptedAt: window.shutdownAcceptedAt, deadlineAt: window.shutdownDeadlineAt,
  });
  const group = readGroupBody(store, groupId);
  group.stopped = true;
  saveGroupBody(store, group);
  recordProjectionChange(store, [groupId]);
  return { groupId, disposition: intent === null ? "created" : "strengthened-pause", changed: true,
    ...versions(store, groupId), frozenRunIds: active, requestIds, blockerCode: null };
}

export async function applyPanelShutdown(deps: PanelShutdownDeps): Promise<CommandSuccessV1> {
  const { store, epoch } = deps;
  const window = freezeShutdownWindow({ now: deps.now ?? (() => new Date()), shutdownGraceMs: deps.shutdownGraceMs });
  const drain = deps.admissionGate?.beginDrain();
  await drain?.beforeWriterTransaction;
  const command: ShutdownCommand = {
    schema: "orca-raw-command-v1", commandId: shutdownCommandId(epoch), expectedRevision: 0, actorId: SHUTDOWN_ACTOR,
    verb: "shutdown", target: { kind: "global", epoch }, payload: window,
  };
  const outcome = applyWebCommand<CommandSuccessV1>(store, {
    rawCommand: command,
    expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    authorityChanged: false,
    projectionGroupIds: [],
    apply: context => {
      if (context.rawCommand.target.kind !== "global") throw new ControlError("control-target-not-allowed");
      const groupIds = store.db.prepare("SELECT id FROM groups ORDER BY id").all().map((row) => String(row.id));
      const groups = groupIds.map(groupId => shutdownGroup(store, groupId, window, command.commandId, deps.exemptDriverRuns === true));
      deps.beforeCommit?.();
      return { status: 200, body: {
        schema: "orca-command-success-v1", commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId,
        verb: context.rawCommand.verb, target: context.rawCommand.target, commandRevision: null, projectionSeq: null,
        effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash,
        result: { kind: "shutdown", groups },
      } };
    },
  });
  return outcome.body;
}

/** Control state must be durable and recovered before a single request is accepted. */
export async function runControlPanelStartup(order: PanelStartupOrder): Promise<void> {
  await order.recover();
  await order.listen();
}
