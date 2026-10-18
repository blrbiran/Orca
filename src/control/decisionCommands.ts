import { appendEvents } from "../ledger/writer.js";
import { applyWebCommand } from "./commandLedger.js";
import { ControlError, type KnownControlErrorCode } from "./errors.js";
import { resetIntegrationForRetry } from "./integrationCommands.js";
import { readGroupIntegration } from "./integrationScheme.js";
import { findDecision, ledgerSources, type DecisionWhere } from "./ledgerAtRef.js";
import { commitLedgerOnGroupBranch } from "./ledgerTree.js";
import { readPendingDecision, settlePendingDecision, type PendingDecisionRow } from "./pendingDecisions.js";
import { readGroup } from "./queries.js";
import { normalizeAgentEntry } from "./runLedger.js";
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
  const active = store.db.prepare("SELECT body FROM runs WHERE group_id=? AND active=1").all(groupId);
  if (active.some((row) => (JSON.parse(String(row.body)) as { state?: unknown }).state === "reconciling")) return refused("decision-approve-reconciling");
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
    evidence: [...evidence, `undo.how by ${command.actorId} via approve-pending-decision ${command.commandId}`],
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
    const result = await commitLedgerOnGroupBranch({
      // One worktree per command: two approvals of the same item must not remove each other's live worktree.
      repo, roots, groupId, worktreeName: `approve-${pendingId}-${command.commandId}`, message: `orca: approve ${pendingId}`, beforeCas: seams.beforeCas,
      write: async (decisionsDir) => {
        await appendEvents(decisionsDir, ledgerRun, [event]);
        return [`${ledgerRun}.jsonl`];
      },
    });
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
