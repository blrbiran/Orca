import { describe, expect, it } from "vitest";
import { readWork, saveWork } from "../../src/control/queries.js";
import { workerLostCandidates } from "../../src/control/systemDebug.js";
import { driverHarness } from "./fixtures/driverHarness.js";

/**
 * Worker-lost recovery spec 2026-11-12 §5.4, as corrected in tester follow-up I (Orca session d467cbd2; review of #273,
 * finding 1): "at most 3 worker-lost restarts in a row" counts the task's runs that lost their worker, newest first, in the
 * order they were claimed. The task's lineage (`lineageRunIds`) is stored sorted by id and run ids are random, so walking it
 * in stored order counted in random order: the bound could be skipped after a real failure, or fire on the first loss of a
 * new streak. Here the earlier runs' ids are chosen so that id order is not claim order.
 */
async function lostTask() {
  const t = await driverHarness([{ taskId: "a" }], {
    behaviour: () => "failed",
    failure: () => ({ failureCause: { cause: "worker-lost", phase: "execute", retries: 0, detail: null } }),
  });
  t.h.store.db.prepare("UPDATE group_orchestration SET body=json_set(body,'$.mode','run') WHERE group_id='g'").run();
  const runId = await t.claim();
  await t.until(t.driver(), () => t.body(runId).state === "blocked");
  return { t, runId };
}

/** Runs of the task claimed before the current one (lower rowids, oldest first), each ended with `cause`. */
function claimedEarlier(t: Awaited<ReturnType<typeof lostTask>>["t"], current: string, runs: Array<{ id: string; cause: string }>): void {
  const workItemId = String(t.h.store.db.prepare("SELECT work_item_id FROM runs WHERE id=?").get(current)!.work_item_id);
  const firstRowid = Number(t.h.store.db.prepare("SELECT MIN(rowid) AS r FROM runs").get()!.r) - runs.length - 1;
  runs.forEach((run, index) => t.h.store.db.prepare("INSERT INTO runs(rowid,id,group_id,work_item_id,generation,active,body) VALUES (?,?,?,?,1,0,?)")
    .run(firstRowid + index, run.id, "g", workItemId, JSON.stringify({ runId: run.id, state: "blocked", drive: { blockedAt: "C", outcome: "failed", failureCause: { cause: run.cause, phase: "execute", retries: 0, detail: null } } })));
  const work = readWork(t.h.store, "g", "a") as unknown as { lineageRunIds?: string[] };
  work.lineageRunIds = [...runs.map((run) => run.id), current].sort(); // stored as webDispatch stores it: sorted by id
  saveWork(t.h.store, "g", work as never);
}

const streak = (t: Awaited<ReturnType<typeof lostTask>>["t"]): number[] => workerLostCandidates(t.h.store).map((candidate) => candidate.consecutive);

describe("worker-lost restarts count losses in a row in claim order (tester follow-up I)", { timeout: 120_000 }, () => {
  it("a real failure, then three losses: the streak is three ('!' sorts before every run id, '~' after)", async () => {
    const { t, runId } = await lostTask(); try {
      claimedEarlier(t, runId, [{ id: "run-~failed", cause: "required-check-failed" }, { id: "run-!lost-1", cause: "worker-lost" }, { id: "run-!lost-2", cause: "worker-lost" }]);
      // mutation: lineage walked by id order -> the real failure (sorted last) is met first, streak 1, red
      expect(streak(t)).toEqual([3]);
    } finally { await t.h.dispose(); }
  });

  it("three losses, a real failure, a new loss: the streak is one, not four (the bound must not fire)", async () => {
    const { t, runId } = await lostTask(); try {
      claimedEarlier(t, runId, [{ id: "run-~lost-1", cause: "worker-lost" }, { id: "run-~lost-2", cause: "worker-lost" }, { id: "run-~lost-3", cause: "worker-lost" }, { id: "run-!failed", cause: "required-check-failed" }]);
      // mutation: lineage walked by id order -> the three old losses (sorted last) are met first, streak 4 (> 3: blocked
      // worker-lost-repeated on the first loss of a new streak), red
      expect(streak(t)).toEqual([1]);
    } finally { await t.h.dispose(); }
  });
});
