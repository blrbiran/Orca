import { z } from "zod";
import { ControlError } from "../errors.js";
import type { ControlStore } from "../store.js";
import type { CheckKind } from "./settingsSchema.js";

/**
 * Checks spec 2026-10-22 §5: one record per (project, kind, target) in the control DB's `check_state` table -- "reviewed
 * up to <watermark>" on the target branch, plus the check's run facts (§5.4). The watermark moves only when a run
 * completes (never at start, never on an error or interruption), so no range is checked twice by the same kind and none
 * is skipped.
 */
export const CHECK_LAST_STATES = ["running", "passed", "failed", "completed", "errored", "initialised", "skipped", "migrated"] as const;
const lastSchema = z.object({
  state: z.enum(CHECK_LAST_STATES),
  at: z.number().int(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  groups: z.array(z.string()),
  detail: z.string().nullable(),
  reviewGroupId: z.string().nullable(),
  debugGroupIds: z.array(z.string()),
  recordHash: z.string().nullable(),
}).strict();
export const checkStateSchema = z.object({
  watermark: z.string().nullable(),
  lastStartAt: z.number().int().nullable(),
  /** Per scheduled-check id, the newest slot it consumed (§2.4; Task 6). */
  lastSlot: z.record(z.string(), z.number().int()),
  /** Every run start of this (project, kind, target), never reused (§5.4, §6.1 ids). */
  runSeq: z.number().int().min(0),
  failureStreak: z.number().int().min(0),
  paused: z.boolean(),
  /** A person's "run now" waiting for the pass (Task 6). */
  pendingRun: z.object({ commandId: z.string(), at: z.number().int() }).strict().nullable(),
  /** The last range was taken from the merge-base because the target was rewritten (§5.3). */
  rebased: z.boolean(),
  last: lastSchema.nullable(),
}).strict();
export type CheckState = z.infer<typeof checkStateSchema>;
export type CheckLast = z.infer<typeof lastSchema>;
export const EMPTY_CHECK_STATE: CheckState = { watermark: null, lastStartAt: null, lastSlot: {}, runSeq: 0, failureStreak: 0, paused: false, pendingRun: null, rebased: false, last: null };

export function readCheckState(store: ControlStore, repoId: string, kind: CheckKind, target: string): CheckState | null {
  const row = store.db.prepare("SELECT body FROM check_state WHERE repo_id=? AND kind=? AND target=?").get(repoId, kind, target);
  if (row === undefined) return null;
  const parsed = checkStateSchema.safeParse(JSON.parse(String(row.body)));
  if (!parsed.success) throw new ControlError("recovery-blocked", `check-state-invalid:${repoId}:${kind}:${target}`);
  return parsed.data;
}

/** The single writer (callers hold the transaction that also records what moved it). */
export function writeCheckState(store: ControlStore, repoId: string, kind: CheckKind, target: string, state: CheckState): void {
  store.db.prepare("INSERT INTO check_state(repo_id,kind,target,body) VALUES (?,?,?,?) ON CONFLICT(repo_id,kind,target) DO UPDATE SET body=excluded.body")
    .run(repoId, kind, target, JSON.stringify(checkStateSchema.parse(state)));
}

export function listCheckStates(store: ControlStore, repoId: string): Array<{ kind: CheckKind; target: string; state: CheckState }> {
  return store.db.prepare("SELECT kind, target FROM check_state WHERE repo_id=? ORDER BY kind, target").all(repoId)
    .map((row) => ({ kind: String(row.kind) as CheckKind, target: String(row.target), state: readCheckState(store, repoId, String(row.kind) as CheckKind, String(row.target))! }));
}
