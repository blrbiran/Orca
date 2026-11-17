import { isTerminalRunState } from "./budget.js";
import type { ControlStore } from "./store.js";
import { costOutliers, type CostRun, type TaskCost } from "./taskCost.js";

/**
 * Tester #285: `used` and the group's total advance only as work events are booked. A Codex response may now provide
 * a provisional observation between bookings, without changing either total. The view names when usage was last booked
 * and, once known, its split by kind (the newest usage event's cumulative `byModel`, summed over models).
 */
export type UsageObservation = "realtime" | "phase-end" | "unavailable";
export interface UsageBreakdown { input: number; output: number; cacheRead: number; cacheWrite: number }

/** The newest time a usage delta of this run was booked (usage_ledger.applied_at); null before any. */
export function usageBookedAt(store: ControlStore, runId: string): number | null {
  const row = store.db.prepare("SELECT max(applied_at) AS at FROM usage_ledger WHERE run_id=?").get(runId);
  return row?.at == null ? null : Number(row.at);
}

/** The run's split of its bucket's usage by kind, from the newest event of that bucket that carries one; null without. */
export function usageBreakdownOf(store: ControlStore, runId: string, bucket: "work" | "handoff"): UsageBreakdown | null {
  for (const row of store.db.prepare("SELECT body FROM usage_events WHERE run_id=? ORDER BY seq DESC").all(runId)) {
    const event = JSON.parse(String(row.body)) as { bucket: string; byModel?: Array<UsageBreakdown> | null };
    if (event.bucket !== bucket) continue;
    if (!Array.isArray(event.byModel)) return null;
    return event.byModel.reduce((sum, entry) => ({ input: sum.input + entry.input, output: sum.output + entry.output,
      cacheRead: sum.cacheRead + entry.cacheRead, cacheWrite: sum.cacheWrite + entry.cacheWrite }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  }
  return null;
}

/**
 * A run still under way: not settled and not yet landed or ended (issue-fixes spec §5.2's endedAt). Tester #285 (follow-up
 * J): nor blocked -- a run the driver blocked (drive.blockedAt) is waiting on a person, not working, so its lagging usage is
 * not a phase in progress.
 */
export const runUnderWay = (run: { state: string; endedAt?: number; drive?: { blockedAt?: string | null } }): boolean =>
  run.endedAt === undefined && !isTerminalRunState(run.state) && run.state !== "blocked" && (run.drive?.blockedAt ?? null) === null;

/**
 * `orca group brief`'s note: the runs under way whose agent reports usage only at phase end, and the newest time any of
 * them booked usage; null when there is none, so the group's used figure is as live as its agents report.
 */
export function phaseEndUsageOf(store: ControlStore, groupId: string): { runIds: string[]; asOf: number | null } | null {
  const runIds = store.db.prepare("SELECT id, body FROM runs WHERE group_id=? ORDER BY id").all(groupId).flatMap((row) => {
    const body = JSON.parse(String(row.body)) as { state: string; endedAt?: number; drive?: { blockedAt?: string | null }; agentCapabilities?: { usageObservation?: string } };
    return runUnderWay(body) && body.agentCapabilities?.usageObservation === "phase-end" ? [String(row.id)] : [];
  });
  if (runIds.length === 0) return null;
  const times = runIds.map((runId) => usageBookedAt(store, runId)).filter((at): at is number => at !== null);
  return { runIds, asOf: times.length === 0 ? null : Math.max(...times) };
}

/**
 * Tester #321 part C: `orca group brief`'s `costOutliers` -- the tasks whose runs together cost a multiple of the group
 * median, or ran past the long-running line (taskCost.ts); null when none is. Read from the stored runs, each in its own
 * bucket like the view's `used`. Display only.
 */
export function costOutliersOf(store: ControlStore, groupId: string, now: number): TaskCost[] | null {
  const runs = store.db.prepare("SELECT body FROM runs WHERE group_id=? ORDER BY rowid").all(groupId).map((row): CostRun => {
    const body = JSON.parse(String(row.body)) as Parameters<typeof runUnderWay>[0] & { taskId: string | null; phase: string; startedAt?: number; cumulative: Record<"work" | "handoff", { tokens: number; activeMs: number }> };
    const used = body.cumulative[body.phase === "handoff" ? "handoff" : "work"];
    return { taskId: body.taskId, tokens: used.tokens, activeMs: used.activeMs, startedAt: body.startedAt ?? null, endedAt: body.endedAt ?? null, underWay: runUnderWay(body) };
  });
  const outliers = costOutliers(runs, now);
  return outliers.length === 0 ? null : outliers;
}
