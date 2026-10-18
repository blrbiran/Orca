import { ControlError } from "./errors.js";
import { pendingEntrySchema, type PendingEntry } from "./runLedger.js";
import type { ControlStore } from "./store.js";

export interface PendingDecisionRow {
  pendingId: string;
  groupId: string;
  runId: string;
  state: "pending" | "approved" | "rejected";
  entry: PendingEntry;
  approvedId: string | null;
  correctionId: string | null;
}

type Outcome = { state: "approved"; approvedId: string } | { state: "rejected"; correctionId: string };
type Stored = { id: string; group_id: string; run_id: string; state: PendingDecisionRow["state"]; body: string };
const COLUMNS = "id,group_id,run_id,state,body";

function toRow(row: Stored): PendingDecisionRow {
  const body = JSON.parse(row.body) as Record<string, unknown>;
  const { approvedId, correctionId, ...entry } = body;
  return {
    pendingId: row.id, groupId: row.group_id, runId: row.run_id, state: row.state,
    entry: pendingEntrySchema.parse(entry) as PendingEntry,
    approvedId: typeof approvedId === "string" ? approvedId : null,
    correctionId: typeof correctionId === "string" ? correctionId : null,
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
