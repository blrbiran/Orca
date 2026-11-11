import { recordActivity } from "./activity.js";
import { isGroupArchived } from "./archivedMark.js";
import { prerequisiteDone } from "./groupEdges.js";
import type { ControlStore } from "./store.js";

/**
 * Review-exit spec 2026-11-05 §3.1 (D1, human ruling 「组里所有任务都完成并落地后，组自动变成 `done`，不再占槽位」): a pass by
 * code (Rule 5), run every driver round after the integration, landing and placement passes. A non-archived Web group (it
 * has a plan) in `review` or `running`, with no active run of any phase and no stop intent, becomes `done` when
 * - its work is delivered: `prerequisiteDone` (groupEdges.ts) -- every task done, plus by delivery: local integrated with
 *   nothing pending, a dir group's placement caught up, a multi group's landing `landed`; or
 * - it is a system verdict group (controller decision, spec §3.1): a criteria-review judge or a ladder group whose verdict is
 *   recorded (`systemDebug.settled`, written by the settle pass, webService.ts). A judge's justified verdict is a
 *   D14-blocked task (protect-acceptance-criteria spec §5: "settled by its run"), which never meets the first rule.
 * Tester follow-up E §5 (#241) overrides D1: `delivered` also needs the group accepted on its final tip (prerequisiteDone
 * reads groupAcceptance.ts's record: passed, not-needed, not-run or waived); a failed or not-yet-run acceptance keeps it
 * out of done.
 * A `blocked` group is never touched (Final review I1: the block is its brake). The status change and its activity row are
 * one savepoint per group, so one group's failure is its own. Answers the groups it moved.
 */
export function markGroupsDone(store: ControlStore): string[] {
  const moved: string[] = [];
  for (const row of store.db.prepare("SELECT id, body FROM groups ORDER BY rowid").all()) {
    const groupId = String(row.id);
    let body: Record<string, unknown>;
    try { body = JSON.parse(String(row.body)) as Record<string, unknown>; } catch { continue; } // its own reads name it
    if (body.planHash === undefined || (body.status !== "review" && body.status !== "running")) continue;
    let open = true;
    store.db.exec("SAVEPOINT group_done");
    try {
      if (isGroupArchived(store, groupId)) continue;
      if (store.db.prepare("SELECT 1 FROM stop_intents WHERE group_id=?").get(groupId) !== undefined) continue;
      if (store.db.prepare("SELECT 1 FROM runs WHERE group_id=? AND active=1").get(groupId) !== undefined) continue;
      const cause = verdictRecorded(body) ? "verdict" : prerequisiteDone(store, groupId) ? "delivered" : null;
      if (cause === null) continue;
      store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify({ ...body, status: "done" }), groupId);
      recordActivity(store, { groupId, kind: "group-done", body: { from: body.status, cause } });
      moved.push(groupId);
    } catch (error) {
      open = false;
      try { store.db.exec("ROLLBACK TO group_done"); store.db.exec("RELEASE group_done"); } catch { throw error; }
      process.stderr.write(`orca-driver: group ${groupId}: done pass: ${error instanceof Error ? error.message : String(error)}\n`);
    } finally {
      if (open) store.db.exec("RELEASE group_done");
    }
  }
  return moved;
}

/** A criteria-review judge or a ladder group whose outcome the settle pass recorded. */
function verdictRecorded(body: Record<string, unknown>): boolean {
  const mark = body.systemDebug as { source?: { kind?: unknown }; settled?: unknown } | undefined;
  if (mark === undefined || mark === null || typeof mark !== "object") return false;
  return (mark.source?.kind === "criteria-review" || mark.source?.kind === "ladder") && typeof mark.settled === "object" && mark.settled !== null;
}
