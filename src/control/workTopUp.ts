import { z } from "zod";
import { amountSchema, budgetAmountSchema, safeInteger } from "./schema.js";
import type { ControlStore } from "./store.js";
import type { Amount } from "./types.js";
import type { BudgetAmount } from "./tokenPolicy.js";

/**
 * Retry work top-up spec 2026-11-06 §2: a `retry-task` with `work` appends one row here, never an edit of the task's
 * `work.grant`. A top-up applies to a run R of the same work item iff rowid(from_run_id) < rowid(R) in `runs` -- the
 * order readFundedAllowance already uses for inherited usage -- so the run it was retried from, and every earlier run,
 * keep their check byte for byte; the retried run and every later run read it.
 *
 * A leaf on purpose: fundedAllowance.ts, retryTask.ts, continuation.ts, savedResultRecovery.ts and the panel's views all
 * read it, so it imports no control module on the estimator -> ... -> webDispatch cycle (schema.ts only).
 */
export const topUpBodySchema = z.object({
  amount: amountSchema,
  commandId: z.string().min(1),
  by: z.string().min(1),
  personAuthority: z.boolean(),
  at: safeInteger,
}).strict();
export type TopUpBody = z.infer<typeof topUpBodySchema>;
export interface TopUpRow extends TopUpBody { fromRunId: string; workItemId: string }

const ZERO: Amount = { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 };
const DIMENSIONS = ["tokens", "activeMs", "attempts", "sessions"] as const;
const plus = (left: Amount, right: Amount): Amount => {
  const out = { ...left };
  for (const d of DIMENSIONS) { out[d] = left[d] + right[d]; if (!Number.isSafeInteger(out[d])) throw new Error("numeric-overflow"); }
  return out;
};
const parsed = (body: unknown): TopUpBody => topUpBodySchema.parse(JSON.parse(String(body)));

/** The group's top-up rows in insertion order (the board's lines). */
export function groupTopUps(store: ControlStore, groupId: string): TopUpRow[] {
  return store.db.prepare("SELECT work_item_id, from_run_id, body FROM work_grant_top_ups WHERE group_id=? ORDER BY rowid").all(groupId)
    .map(row => ({ ...parsed(row.body), workItemId: String(row.work_item_id), fromRunId: String(row.from_run_id) }));
}

/**
 * The sum of the task's top-ups that apply to `runId` (strictly earlier from_run_id), or -- with `runId` null -- every
 * top-up of the task (what the next run, the newest, reads).
 */
export function topUpSum(store: ControlStore, groupId: string, workItemId: string, runId: string | null): Amount {
  const rows = runId === null
    ? store.db.prepare("SELECT t.body FROM work_grant_top_ups t WHERE t.group_id=? AND t.work_item_id=? ORDER BY t.rowid").all(groupId, workItemId)
    : store.db.prepare(`SELECT t.body FROM work_grant_top_ups t JOIN runs f ON f.id=t.from_run_id
        WHERE t.group_id=? AND t.work_item_id=? AND f.rowid < (SELECT rowid FROM runs WHERE id=?) ORDER BY t.rowid`).all(groupId, workItemId, runId);
  return rows.reduce<Amount>((total, row) => plus(total, parsed(row.body).amount), { ...ZERO });
}

/** The group's agent top-ups (personAuthority false), summed: what `agentTopUpCap` bounds. */
export function agentTopUpSum(store: ControlStore, groupId: string): Amount {
  return groupTopUps(store, groupId).filter(row => !row.personAuthority).reduce<Amount>((total, row) => plus(total, row.amount), { ...ZERO });
}

/** The authored grant plus a top-up; an unbounded token ceiling stays unbounded (`null + n = null`). */
export function withTopUp(authored: BudgetAmount, topUp: Amount): BudgetAmount {
  const base = budgetAmountSchema.parse(authored);
  return {
    tokens: base.tokens === null ? null : safeInteger.parse(base.tokens + topUp.tokens),
    activeMs: safeInteger.parse(base.activeMs + topUp.activeMs),
    attempts: safeInteger.parse(base.attempts + topUp.attempts),
    sessions: safeInteger.parse(base.sessions + topUp.sessions),
  };
}

export function appendTopUp(store: ControlStore, groupId: string, workItemId: string, fromRunId: string, body: TopUpBody): void {
  store.db.prepare("INSERT INTO work_grant_top_ups(group_id, work_item_id, from_run_id, body) VALUES (?,?,?,?)")
    .run(groupId, workItemId, fromRunId, JSON.stringify(topUpBodySchema.parse(body)));
}

/**
 * The global `agentTopUpCap` orchestration setting (spec §2 "The cap"), read here rather than through orchestration.ts
 * so this leaf stays off the import cycle; orchestration.ts's settings schema validates the same field on every write.
 * Absent or null: agents may not top up.
 */
export function readAgentTopUpCap(store: ControlStore): Amount | null {
  const row = store.db.prepare("SELECT body FROM orchestration_settings WHERE singleton=1").get();
  if (row === undefined) return null;
  const cap = (JSON.parse(String(row.body)) as { agentTopUpCap?: unknown }).agentTopUpCap;
  return cap === undefined || cap === null ? null : amountSchema.parse(cap);
}
