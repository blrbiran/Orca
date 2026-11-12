import { ControlError } from "./errors.js";
import { pendingEntrySchema, type PendingEntry } from "./runLedger.js";
import type { ControlStore } from "./store.js";

export interface PendingDecisionRow {
  pendingId: string;
  groupId: string;
  runId: string;
  /** `allowed`: settled by an allowance (tester follow-up G §6.3, #189), stored `approved` with body `allowed`, no ledger line. */
  state: "pending" | "approved" | "rejected" | "allowed";
  entry: PendingEntry;
  approvedId: string | null;
  correctionId: string | null;
  allowed: PendingAllowed | null;
}

export interface PendingAllowed { by: string; via: string; at: number; commandId: string; allowanceId: string | null }

type Outcome = { state: "approved"; approvedId: string } | { state: "rejected"; correctionId: string };
type Stored = { id: string; group_id: string; run_id: string; state: "pending" | "approved" | "rejected"; body: string };
const COLUMNS = "id,group_id,run_id,state,body";

function toRow(row: Stored): PendingDecisionRow {
  const body = JSON.parse(row.body) as Record<string, unknown>;
  const { approvedId, correctionId, allowed, ...entry } = body;
  const allowedBy = allowed !== undefined && allowed !== null && typeof allowed === "object" ? allowed as PendingAllowed : null;
  return {
    pendingId: row.id, groupId: row.group_id, runId: row.run_id, state: row.state === "approved" && allowedBy !== null ? "allowed" : row.state,
    entry: pendingEntrySchema.parse(entry) as PendingEntry,
    approvedId: typeof approvedId === "string" ? approvedId : null,
    correctionId: typeof correctionId === "string" ? correctionId : null,
    allowed: allowedBy,
  };
}

/** Called inside the caller's transaction. A re-run of the same landing keeps the first body per id. */
export function insertPendingDecisions(store: ControlStore, groupId: string, runId: string, pending: readonly PendingEntry[]): void {
  const insert = store.db.prepare(
    "INSERT INTO pending_decisions(id,group_id,run_id,ledger_run,entry_index,state,body) VALUES (?,?,?,?,?,'pending',?) ON CONFLICT(id) DO NOTHING");
  for (const p of pending) insert.run(p.pendingId, groupId, runId, p.ledgerRun, p.entryIndex, JSON.stringify(pendingEntrySchema.parse(p)));
}

export function listPendingDecisions(store: ControlStore, groupId: string): PendingDecisionRow[] {
  const rows = store.db.prepare(`SELECT ${COLUMNS} FROM pending_decisions WHERE group_id=? ORDER BY run_id,ledger_run,entry_index`).all(groupId) as Stored[];
  return rows.map(toRow);
}

export function readPendingDecision(store: ControlStore, pendingId: string): PendingDecisionRow | null {
  const row = store.db.prepare(`SELECT ${COLUMNS} FROM pending_decisions WHERE id=?`).get(pendingId) as Stored | undefined;
  return row ? toRow(row) : null;
}

export function settlePendingDecision(store: ControlStore, pendingId: string, outcome: Outcome): void {
  const current = readPendingDecision(store, pendingId);
  if (!current) throw new ControlError("recovery-blocked", `pending-decision-unknown:${pendingId}`);
  const body = { ...current.entry, ...(outcome.state === "approved" ? { approvedId: outcome.approvedId } : { correctionId: outcome.correctionId }) };
  store.db.prepare("UPDATE pending_decisions SET state=?,body=? WHERE id=?").run(outcome.state, JSON.stringify(body), pendingId);
}

/**
 * Tester follow-up G §6.3 (#189, plan A6): a pending decision let through by an allowance. The column's CHECK is not widened:
 * the row is stored `approved` with body `allowed` and no `approvedId` (no ledger line was written), and read back `allowed`.
 * Called inside the caller's transaction, on a row still pending.
 */
export function allowPendingDecision(store: ControlStore, pendingId: string, allowed: PendingAllowed): void {
  const current = readPendingDecision(store, pendingId);
  if (!current) throw new ControlError("pending-decision-not-found");
  if (current.state !== "pending") throw new ControlError("pending-decision-settled", current.state);
  store.db.prepare("UPDATE pending_decisions SET state='approved',body=? WHERE id=?").run(JSON.stringify({ ...current.entry, allowed }), pendingId);
}
