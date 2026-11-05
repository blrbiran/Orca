import type { DatabaseSync } from "node:sqlite";
import type { ControlStore } from "./store.js";

// A leaf module (type imports only): retryTask.ts and webService.ts both use it, and groupEdges.ts sits on the control
// import cycle, so D1's done rule (groupEdges.ts prerequisiteDone) is passed in by the caller, never imported here.

/**
 * Session 3cfc2e73 D2 (spec 2026-11-05 §3.2): a Web group's `blocked` status has one writer, a run over its grant
 * (usage.ts). The runs whose breach could have blocked it -- every run with a recorded breach except an estimate run (its
 * breach is advice, tester round 2 H1) and a clarify or split call (recorded while the group was clarifying, DR18), as the
 * 18 -> 19 repair reads them (migrations.ts repairOf). Sorted by run id; empty when no such run exists, so a `blocked`
 * group with none is blocked for a reason this cannot name. Over the raw connection, so the 21 -> 22 repair shares it.
 */
export function overGrantBlockRuns(db: DatabaseSync, groupId: string): string[] {
  const runIds: string[] = [];
  for (const row of db.prepare("SELECT id, body FROM runs WHERE group_id=?").all(groupId)) {
    const run = JSON.parse(String(row.body)) as { phase?: unknown; purpose?: unknown; breaches?: unknown };
    if (!Array.isArray(run.breaches) || run.breaches.length === 0 || run.phase === "estimate") continue;
    if (run.phase === "single-call" && (run.purpose === "clarify" || run.purpose === "split")) continue;
    runIds.push(String(row.id));
  }
  return runIds.sort();
}

/**
 * §3.2: the status an over-grant block is lifted to, by rule and not from memory -- an active run of any phase: `running`;
 * else every task done and delivered (groupEdges.ts prerequisiteDone, D1's done rule): `done`; else `review`.
 */
export function unblockedStatus(store: ControlStore, groupId: string, done: (store: ControlStore, groupId: string) => boolean): "running" | "done" | "review" {
  if (store.db.prepare("SELECT 1 FROM runs WHERE group_id=? AND active=1 LIMIT 1").get(groupId) !== undefined) return "running";
  return done(store, groupId) ? "done" : "review";
}
