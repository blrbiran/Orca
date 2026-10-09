import type { StatementSync } from "node:sqlite";
import type { ControlStore } from "../control/store.js";

export type StoredWorkRow = Readonly<{ id: string; group_id: string; body: string }>;
export type StoredRunRow = Readonly<{ id: string; group_id: string; work_item_id: string; generation: number; active: number; body: string }>;
export type StoredJsonResult = { ok: true; value: unknown } | { ok: false; error: SyntaxError };
export interface GroupReadSnapshot {
  readonly groupId: string;
  readonly workById: ReadonlyMap<string, StoredWorkRow>;
  readonly runById: ReadonlyMap<string, StoredRunRow>;
  readonly runsByRowid: readonly StoredRunRow[];
  decodeWork(id: string): StoredJsonResult | undefined;
  decodeRun(id: string): StoredJsonResult | undefined;
}

// Connection-bound statements only. Rows and decoded objects live in one request's snapshot.
const statements = new WeakMap<ControlStore, { work: StatementSync; runs: StatementSync }>();
function lazyDecoder(rows: ReadonlyMap<string, { body: string }>) {
  const decoded = new Map<string, StoredJsonResult>();
  return (id: string): StoredJsonResult | undefined => {
    const row = rows.get(id);
    if (row === undefined) return undefined;
    let result = decoded.get(id);
    if (result === undefined) {
      try { result = { ok: true, value: JSON.parse(row.body) }; }
      catch (error) { result = { ok: false, error: error as SyntaxError }; }
      decoded.set(id, result);
    }
    return result;
  };
}
export function readGroupSnapshot(store: ControlStore, groupId: string): GroupReadSnapshot {
  let prepared = statements.get(store);
  if (prepared === undefined) {
    prepared = {
      work: store.db.prepare("SELECT id,group_id,body FROM work_items WHERE group_id=?"),
      runs: store.db.prepare("SELECT id,group_id,work_item_id,generation,active,body FROM runs WHERE group_id=? ORDER BY rowid"),
    };
    statements.set(store, prepared);
  }
  const workById = new Map(prepared.work.all(groupId).map(row => [String(row.id), row as StoredWorkRow]));
  const runsByRowid = prepared.runs.all(groupId) as StoredRunRow[];
  const runById = new Map(runsByRowid.map(row => [row.id, row]));
  return { groupId, workById, runById, runsByRowid, decodeWork: lazyDecoder(workById), decodeRun: lazyDecoder(runById) };
}
