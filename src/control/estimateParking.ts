import type { ControlStore } from "./store.js";

/**
 * Estimate parking spec 2026-10-21 §3.1: a queued estimate of a stopped pre-start group stays queued with its grant;
 * its wake is acknowledged here, inside the claim's transaction, so the pump stops re-posting it, and an un-stop that
 * commits after the claim cannot be overwritten by the pump's own acknowledgement. (A cap block needs no clearing here:
 * the stop that made the group stopped already cleared it, saveStopIntent in stopIntent.ts.)
 */
export function parkEstimate(store: ControlStore, groupId: string, estimateId: string): void {
  store.db.prepare("UPDATE scheduler_wakes SET delivered=1 WHERE group_id=? AND kind='budget-estimate' AND delivered=0 AND json_extract(body,'$.estimateId')=?")
    .run(groupId, estimateId);
}

/**
 * Spec §3.2-§3.3: an estimate is queued only at creation and its wake is acknowledged by the handler only once it has
 * left `queued`, so a delivered wake of a queued estimate was parked. Every un-stop path that can reach a pre-start
 * group with estimates calls this in its own transaction.
 */
export function rearmParkedEstimates(store: ControlStore, groupId: string): void {
  store.db.prepare(`UPDATE scheduler_wakes SET delivered=0 WHERE group_id=? AND kind='budget-estimate' AND delivered=1
    AND json_extract(body,'$.estimateId') IN (SELECT id FROM estimates WHERE group_id=? AND state='queued')`).run(groupId, groupId);
}
