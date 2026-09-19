import { ControlError } from "./errors.js";
import type { ControlStore } from "./store.js";

export const projectionJournalRetention = 64;

type TransactionState = { changeSeq: number | null; groups: Set<string> };
const transactions = new WeakMap<ControlStore, TransactionState>();

export function beginProjectionTransaction(store: ControlStore): void {
  if (transactions.has(store)) throw new ControlError("control-nested-transaction");
  transactions.set(store, { changeSeq: null, groups: new Set() });
}

export function finishProjectionTransaction(store: ControlStore): void {
  transactions.delete(store);
}

function safeNext(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value === Number.MAX_SAFE_INTEGER) throw new ControlError("control-sequence-overflow");
  return value + 1;
}

function currentState(store: ControlStore): { changeSeq: number; oldestRetainedSeq: number } {
  const row = store.db.prepare("SELECT change_seq,oldest_retained_seq FROM projection_state WHERE singleton=1").get();
  if (!row) throw new ControlError("control-projection-state-missing");
  return { changeSeq: Number(row.change_seq), oldestRetainedSeq: Number(row.oldest_retained_seq) };
}

function recordInTransaction(store: ControlStore, groupIds: readonly string[]): number {
  const transaction = transactions.get(store);
  if (!transaction) throw new ControlError("control-projection-transaction-missing");
  const groups = [...new Set(groupIds)].sort();
  const pending = groups.filter((groupId) => !transaction.groups.has(groupId));
  const versions = new Map<string, number>();
  for (const groupId of pending) {
    const row = store.db.prepare("SELECT projection_seq FROM groups WHERE id=?").get(groupId);
    if (!row) throw new ControlError("group-not-found");
    versions.set(groupId, safeNext(Number(row.projection_seq)));
  }

  if (groups.length > 0 && transaction.changeSeq === null) {
    const state = currentState(store);
    transaction.changeSeq = safeNext(state.changeSeq);
    store.db.prepare("UPDATE projection_state SET change_seq=?,oldest_retained_seq=CASE WHEN oldest_retained_seq=0 THEN ? ELSE oldest_retained_seq END WHERE singleton=1")
      .run(transaction.changeSeq, transaction.changeSeq);
  }

  const changeSeq = transaction.changeSeq ?? currentState(store).changeSeq;
  for (const [groupId, projectionSeq] of versions) {
    store.db.prepare("UPDATE groups SET projection_seq=? WHERE id=?").run(projectionSeq, groupId);
    store.db.prepare("INSERT INTO projection_journal(change_seq,group_id,projection_seq) VALUES (?,?,?)").run(changeSeq, groupId, projectionSeq);
    transaction.groups.add(groupId);
  }

  if (versions.size > 0) {
    const cutoff = Math.max(1, changeSeq - projectionJournalRetention + 1);
    store.db.prepare("DELETE FROM projection_journal WHERE change_seq < ?").run(cutoff);
    const oldest = store.db.prepare("SELECT MIN(change_seq) AS value FROM projection_journal").get()?.value;
    store.db.prepare("UPDATE projection_state SET oldest_retained_seq=? WHERE singleton=1").run(oldest === null || oldest === undefined ? 0 : Number(oldest));
  }
  return changeSeq;
}

export function recordProjectionChange(store: ControlStore, groupIds: readonly string[]): number {
  if (transactions.has(store)) return recordInTransaction(store, groupIds);
  return store.transaction(() => recordInTransaction(store, groupIds));
}

export function readProjectionState(store: ControlStore): { changeSeq: number; oldestRetainedSeq: number } {
  return currentState(store);
}

export function readProjectionChanges(
  store: ControlStore,
  sinceChangeSeq: number,
): { changeSeq: number; resetRequired: boolean; groups: Array<{ groupId: string; projectionSeq: number }> } {
  if (!Number.isSafeInteger(sinceChangeSeq) || sinceChangeSeq < 0) throw new ControlError("query-invalid");
  const state = currentState(store);
  const resetRequired = sinceChangeSeq > state.changeSeq || (state.oldestRetainedSeq > 0 && sinceChangeSeq < state.oldestRetainedSeq - 1);
  const rows = resetRequired
    ? store.db.prepare("SELECT id AS group_id,projection_seq FROM groups ORDER BY id").all()
    : store.db.prepare("SELECT group_id,MAX(projection_seq) AS projection_seq FROM projection_journal WHERE change_seq>? GROUP BY group_id ORDER BY group_id").all(sinceChangeSeq);
  return {
    changeSeq: state.changeSeq,
    resetRequired,
    groups: rows.map((row) => ({ groupId: String(row.group_id), projectionSeq: Number(row.projection_seq) })),
  };
}
