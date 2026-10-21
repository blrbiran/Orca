import { projectKeyOf } from "../corrections/projectKey.js";
import { attributionText, commandAttributionFor, routedAttributionFor } from "./commandClient.js";
import { correctionRowFrom, recordNewCorrection } from "../corrections/record.js";
import { CorrectRejection } from "../corrections/rejection.js";
import { CORRECTION_ALREADY_RECORDED, DUPLICATE_CORRECTION_ID, readCorrections } from "../corrections/store.js";
import { appendEvents } from "../ledger/writer.js";
import { applyWebCommand } from "./commandLedger.js";
import { ControlError, type KnownControlErrorCode } from "./errors.js";
import { ratifyFlag } from "./flaggedDecisions.js";
import { resetIntegrationForRetry } from "./integrationCommands.js";
import { readGroupIntegration } from "./integrationScheme.js";
import { findDecision, ledgerSources, type DecisionWhere } from "./ledgerAtRef.js";
import { commitLedgerOnGroupBranch } from "./ledgerTree.js";
import { readPendingDecision, settlePendingDecision, type PendingDecisionRow } from "./pendingDecisions.js";
import { groupHasReconcilingRun, readGroup } from "./queries.js";
import { agentDecisionId, normalizeAgentEntry } from "./runLedger.js";
import type { ControlStore } from "./store.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";
import type { WorkspaceRoots } from "./workspace.js";

/**
 * Control run decisions plan Task 9: an owner settles a decision the landing refused. Approving gives it an executable
 * undo.how; the line is written in a ledger-only commit on `orca/<groupId>` (git, before the transaction), and the
 * transaction marks the item approved.
 */
export type ApprovePendingDecisionCommand = Extract<RawAuthorityCommandV1, { verb: "approve-pending-decision" }>;

export type ApprovePrepared =
  | { kind: "already-present"; id: string; where: DecisionWhere }
  | { kind: "committed"; id: string; commit: string }
  | { kind: "refused"; code: KnownControlErrorCode; detail?: string };

/** A moved group branch is tried again this many times before the approve is refused decision-approve-tip-moved. */
const MOVED_RETRIES = 3;

const refused = (code: KnownControlErrorCode, detail?: string): ApprovePrepared => ({ kind: "refused", code, ...(detail === undefined ? {} : { detail }) });

/** Why a pending row cannot be approved (null: it can); read again inside the transaction. */
function rowRefusal(row: PendingDecisionRow | null, groupId: string): ApprovePrepared | null {
  if (row === null || row.groupId !== groupId) return refused("pending-decision-not-found");
  if (row.state === "approved") return refused("no-op-command");
  if (row.state === "rejected") return refused("pending-decision-settled");
  return null;
}

/**
 * Review Focus 3: a commit on the group branch while a run of the group reconciles would move the tip under that paid
 * reconciliation; and a resolving integration owns the branch's next move.
 */
function busyRefusal(store: ControlStore, groupId: string): ApprovePrepared | null {
  if (readGroupIntegration(readGroup(store, groupId))?.state === "resolving") return refused("integration-busy");
  if (groupHasReconcilingRun(store, groupId)) return refused("decision-approve-reconciling");
  return null;
}

/**
 * Everything git: check the row, build the line with the owner's undo.how, and commit it on the group branch unless a
 * line with its id is already somewhere the group's decisions are read from (§10.5: a crash between the commit and the
 * transaction leaves the line; a second approve only marks the item).
 */
export async function prepareApproval(
  store: ControlStore, roots: WorkspaceRoots, repo: string, command: ApprovePendingDecisionCommand,
  seams: { beforeCas?: () => Promise<void> } = {},
): Promise<ApprovePrepared> {
  const groupId = command.target.groupId;
  const { pendingId, undoHow } = command.payload;
  const row = readPendingDecision(store, pendingId);
  const refusal = rowRefusal(row, groupId);
  if (refusal !== null) return refusal;
  const { ledgerRun, entryIndex, entry, at, evidence } = row!.entry;
  // goal.md §1.1: who wrote the undo.how is visible on the line.
  const normalized = normalizeAgentEntry(entry, {
    ledgerRun, entryIndex, at, undoHow,
    // CLI v2 spec §16: `by <person> via <channel>`, then the verb and command that wrote it.
    evidence: [...evidence, `undo.how ${attributionText(commandAttributionFor(command.commandId, command.actorId))} approve-pending-decision ${command.commandId}`],
  });
  if (!normalized.ok) {
    return refused(normalized.reason.startsWith("tier-0:") ? "decision-undo-not-executable" : "pending-decision-entry-invalid", normalized.reason);
  }
  const { event } = normalized;
  for (let attempt = 0; attempt <= MOVED_RETRIES; attempt += 1) {
    const found = await findDecision(repo, await ledgerSources(store, repo, groupId), event.id);
    if (found !== null) return { kind: "already-present", id: event.id, where: found.where };
    const busy = busyRefusal(store, groupId);
    if (busy !== null) return busy;
    // Final review m2: a run ledger on the branch that appendEvents refuses to extend is this approve's refusal, by name.
    let appendRefused: string | null = null;
    const result = await commitLedgerOnGroupBranch({
      // One worktree per command: two approvals of the same item must not remove each other's live worktree.
      repo, roots, groupId, worktreeName: `approve-${pendingId}-${command.commandId}`, message: `orca: approve ${pendingId}`, beforeCas: seams.beforeCas,
      write: async (decisionsDir) => {
        try { await appendEvents(decisionsDir, ledgerRun, [event]); }
        catch (error) { appendRefused = error instanceof Error ? error.message : String(error); return []; }
        return [`${ledgerRun}.jsonl`];
      },
    });
    if (appendRefused !== null) return refused("pending-decision-entry-invalid", appendRefused);
    if (result.kind === "swapped") return { kind: "committed", id: event.id, commit: result.commit };
    if (result.kind === "nothing") throw new Error(`approve ${pendingId}: the ledger write named no file`);
  }
  return refused("decision-approve-tip-moved");
}

/**
 * The transaction: a refusal `prepared` found is thrown here so it is booked; otherwise the row (read again) is marked
 * approved. A line only on the group branch re-arms a blocked or conflicted integration, so it reaches the target.
 */
export function applyApprovePendingDecision(deps: { store: ControlStore }, command: ApprovePendingDecisionCommand, prepared: ApprovePrepared): CommandSuccessV1 | CommandErrorBodyV1 {
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
    rawCommand: command,
    expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const groupId = command.target.groupId;
      const { pendingId } = command.payload;
      const row = deps.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
      if (!row) throw new ControlError("group-not-found");
      const decided = prepared.kind === "refused" ? prepared : rowRefusal(readPendingDecision(deps.store, pendingId), groupId);
      if (decided !== null && decided.kind === "refused") throw new ControlError(decided.code, decided.detail);
      const { id } = prepared as Exclude<ApprovePrepared, { kind: "refused" }>;
      // §4: a decision is on the target exactly when its work is. A fresh commit, or a recovered one still only on the
      // group branch (a crash between the commit and this transaction), re-arms a stuck integration.
      if (prepared.kind === "committed" || (prepared.kind === "already-present" && prepared.where === "group-branch")) {
        const group = JSON.parse(String(row.body)) as Record<string, unknown>;
        const current = readGroupIntegration(group);
        if (current !== null && (current.state === "blocked" || current.state === "conflict")) {
          group.integration = resetIntegrationForRetry(current);
          deps.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(group), groupId);
        }
      }
      settlePendingDecision(deps.store, pendingId, { state: "approved", approvedId: id });
      return { status: 200, body: {
        schema: "orca-command-success-v1", commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId,
        verb: context.rawCommand.verb, target: context.rawCommand.target, commandRevision: context.nextCommandRevision, projectionSeq: context.nextProjectionSeq,
        effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash,
        result: { kind: "pending-decision-approved", pendingId, decisionId: id },
      } };
    },
  }).body;
}

/**
 * Control run decisions plan Task 10: an owner rejects a decision the landing refused. The rejection is a `wrong`-kind
 * correction naming `{ runId, pendingId }` (debug-task design §12.3), recorded in the corrections store before the
 * transaction; the transaction marks the item rejected with the correction's id.
 */
export type RejectPendingDecisionCommand = Extract<RawAuthorityCommandV1, { verb: "reject-pending-decision" }>;

export type RejectPrepared =
  | { kind: "recorded"; correctionId: string }
  | { kind: "refused"; code: KnownControlErrorCode; detail?: string };

/** Why a pending row cannot be rejected (null: it can); read again inside the transaction. A rejected row answers its correction. */
function rejectRefusal(row: PendingDecisionRow | null, groupId: string): RejectPrepared | null {
  if (row === null || row.groupId !== groupId) return { kind: "refused", code: "pending-decision-not-found" };
  if (row.state === "approved") return { kind: "refused", code: "pending-decision-settled" };
  if (row.state === "rejected") return { kind: "recorded", correctionId: row.correctionId! };
  return null;
}

const textOr = (value: unknown): string => (typeof value === "string" ? value : "(missing)");

/**
 * Everything outside the transaction: check the row, refuse a decision whose line is already readable (an approve whose
 * commit landed but whose transaction did not), and record the correction unless one for this item is already in the
 * store (§10.5: a crash between the store write and the transaction leaves it; a second reject finds it).
 * `corrections.by` is the panel's own identity (cross-plan resolution 1), never the command's actorId.
 */
export async function prepareRejection(
  store: ControlStore, repo: string, corrections: { dir: string; by: string }, command: RejectPendingDecisionCommand, now: () => Date,
  seams: { beforeRecord?: () => Promise<void> } = {},
): Promise<RejectPrepared> {
  const groupId = command.target.groupId;
  const { pendingId, because } = command.payload;
  const row = readPendingDecision(store, pendingId);
  const decided = rejectRefusal(row, groupId);
  if (decided !== null) return decided;
  const { ledgerRun, entryIndex, entry } = row!.entry;
  // CLI v2 spec §16: the routed person and channel; a call that skips the routes records the panel's identity, as before.
  const routed = routedAttributionFor(command.commandId);
  const by = routed?.by ?? corrections.by;
  const id = agentDecisionId(ledgerRun, entryIndex);
  const found = await findDecision(repo, await ledgerSources(store, repo, groupId), id);
  if (found !== null) return { kind: "refused", code: "pending-decision-settled", detail: `decision-recorded:${id}@${found.where}` };
  try {
    const projectKey = await projectKeyOf(repo);
    const existing = (await readCorrections(corrections.dir)).find((c) => c.projectKey === projectKey && c.pendingId === pendingId);
    if (existing !== undefined) return { kind: "recorded", correctionId: existing.id };
    await seams.beforeRecord?.();
    const fields = (entry ?? {}) as { question?: unknown; chose?: unknown };
    const stored = await recordNewCorrection(corrections.dir, correctionRowFrom({
      projectKey, runId: row!.runId, pendingId, kind: "wrong",
      because: `${because === undefined ? "" : `${because}\n`}question: ${textOr(fields.question)}\nchose: ${textOr(fields.chose)}`,
      by, ...(routed === null ? {} : { via: routed.via }),
    }, now), { again: false });
    return { kind: "recorded", correctionId: stored.id };
  } catch (error) {
    // The same identity's double submit raced past the lookup: the store already holds its correction, so answer it.
    // (Two identities racing both record: the lookup and the append are not one store-lock hold; a named gap.)
    if (error instanceof CorrectRejection && (error.code === CORRECTION_ALREADY_RECORDED || error.code === DUPLICATE_CORRECTION_ID)) {
      const raced = (await readCorrections(corrections.dir)).find((c) => c.runId === row!.runId && c.pendingId === pendingId && c.by === by);
      if (raced !== undefined) return { kind: "recorded", correctionId: raced.id };
    }
    if (error instanceof CorrectRejection) return { kind: "refused", code: "pending-decision-correction-failed", detail: error.code };
    throw error;
  }
}

/** The transaction: a refusal `prepared` found is thrown here so it is booked; otherwise the row (read again) is marked rejected. */
export function applyRejectPendingDecision(deps: { store: ControlStore }, command: RejectPendingDecisionCommand, prepared: RejectPrepared): CommandSuccessV1 | CommandErrorBodyV1 {
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
    rawCommand: command,
    expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const groupId = command.target.groupId;
      const { pendingId } = command.payload;
      if (!deps.store.db.prepare("SELECT 1 FROM groups WHERE id=?").get(groupId)) throw new ControlError("group-not-found");
      if (prepared.kind === "refused") throw new ControlError(prepared.code, prepared.detail);
      const now = rejectRefusal(readPendingDecision(deps.store, pendingId), groupId);
      if (now !== null && now.kind === "refused") throw new ControlError(now.code, now.detail);
      // A row rejected meanwhile keeps its own correction.
      const correctionId = now === null ? prepared.correctionId : now.correctionId;
      if (now === null) settlePendingDecision(deps.store, pendingId, { state: "rejected", correctionId });
      return { status: 200, body: {
        schema: "orca-command-success-v1", commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId,
        verb: context.rawCommand.verb, target: context.rawCommand.target, commandRevision: context.nextCommandRevision, projectionSeq: context.nextProjectionSeq,
        effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash,
        result: { kind: "pending-decision-rejected", pendingId, correctionId },
      } };
    },
  }).body;
}

/** Kanban spec 2026-10-20 §9a: a person ratifies a landed decision Orca flagged. Only the flag changes; the line stays. */
export type RatifyFlaggedDecisionCommand = Extract<RawAuthorityCommandV1, { verb: "ratify-flagged-decision" }>;

export function applyRatifyFlaggedDecision(deps: { store: ControlStore }, command: RatifyFlaggedDecisionCommand): CommandSuccessV1 | CommandErrorBodyV1 {
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
    rawCommand: command,
    expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const groupId = command.target.groupId;
      const { decisionId, note } = command.payload;
      if (!deps.store.db.prepare("SELECT 1 FROM groups WHERE id=?").get(groupId)) throw new ControlError("group-not-found");
      const { by, via } = commandAttributionFor(context.rawCommand.commandId, context.rawCommand.actorId);
      ratifyFlag(deps.store, groupId, decisionId, { actorId: by, via, commandId: context.rawCommand.commandId, at: new Date(deps.store.now()).toISOString(), ...(note === undefined ? {} : { note }) });
      return { status: 200, body: {
        schema: "orca-command-success-v1", commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId,
        verb: context.rawCommand.verb, target: context.rawCommand.target, commandRevision: context.nextCommandRevision, projectionSeq: context.nextProjectionSeq,
        effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash,
        result: { kind: "flagged-decision-ratified", decisionId },
      } };
    },
  }).body;
}
