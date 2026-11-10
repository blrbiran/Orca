import { describe, expect, it } from "vitest";
import { ladderLevelOneCommandId } from "../../src/control/systemDebug.js";
import { readWebGroup, WebControlService } from "../../src/control/webService.js";
import { driverHarness } from "./fixtures/driverHarness.js";

/**
 * Tester follow-up B T2 (#234): the ladder's automatic retry of an optional-policy task is funded with what the task's
 * authored work leaves (authored + top-ups - lineage usage). When that is smaller than one attempt of the failed lineage
 * has cost, the retry cannot finish an attempt: ccloop checks its budget only between phases, so the doomed run overshoots
 * into the group's deficit (the tester's run went 4.9x over). The ladder must leave such a run to a person, and say why.
 *
 * Fixture: the #234 numbers -- 4,000,000 tokens authored, one failed run that used 3,204,406 tokens over 2 attempts, so the
 * next claim would fund 795,594 against 1,602,203 per attempt. The ample case uses the same authored budget with far less spent.
 */
async function failedOnce(workTokens: number) {
  const t = await driverHarness([{ taskId: "a", targetPaths: ["a"], tokenBudget: 4_000_000 }], {
    tokenPolicy: "optional-v1", behaviour: () => "failed", stopReason: () => "Error: check failed: node check.js",
    workTokens: () => workTokens, workAttempts: () => 2,
  });
  const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
  const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, attempts: limit.attempts + 10, sessions: limit.sessions + 10 } }));
  if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
  const service = new WebControlService({ ...t.h.deps, knownRepository: (id: string) => id === "repo", resolveRepository: () => t.repo });
  const runId = await t.claim();
  await t.until(t.driver(), () => t.body(runId).state === "blocked");
  const skipped = () => t.h.store.db.prepare("SELECT body FROM activity WHERE run_id=? AND kind='ladder-skipped'").get(runId);
  return { t, service, runId, skipped };
}

describe("no automatic retry on a remainder smaller than one attempt (#234)", { timeout: 120_000 }, () => {
  it("leaves the #234 run to a person and records the fresh grant against the per-attempt cost", async () => {
    const w = await failedOnce(3_204_406);
    try {
      const workItem = () => JSON.parse(String(w.t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body)) as { status: string; currentRunId: string };
      const before = workItem();
      const pass = await w.service.systemDebugPass();
      expect(pass).toMatchObject({ redispatched: [], opened: [] });
      const note = w.skipped();
      expect(note && JSON.parse(String(note.body))).toMatchObject({ reason: "retry-funding-below-attempt-cost:795594/1602203" });
      // The task waits for a person: the pass left it on the same failed run, and wrote no level-1 retry command.
      expect(w.t.h.store.db.prepare("SELECT id FROM commands WHERE group_id='g' AND id=?").get(ladderLevelOneCommandId("a"))).toBeUndefined();
      expect([before.currentRunId, workItem().status, workItem().currentRunId]).toEqual([w.runId, before.status, w.runId]);
      expect(w.t.body(w.runId).state).toBe("blocked");
    } finally { await w.t.h.dispose(); }
  });

  it("still retries automatically when the remainder covers an attempt", async () => {
    const w = await failedOnce(1_000_000);
    try {
      const pass = await w.service.systemDebugPass();
      expect(pass.redispatched).toEqual(["g:a"]);
      expect(w.skipped()).toBeUndefined();
    } finally { await w.t.h.dispose(); }
  });
});
