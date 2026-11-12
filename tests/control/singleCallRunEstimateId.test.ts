import { describe, expect, it } from "vitest";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { readWebGroup } from "../../src/control/webService.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { reviewWorld, type ReviewWorld } from "./fixtures/reviewWorld.js";
import { answerSingleCalls } from "./fixtures/singleCallAnswers.js";

/**
 * Tester #282 (follow-up H): a group whose requirement review (a group single call, groupSingleCall.ts) ran answered
 * `group show` / `proposal show` with 423 `recovery-blocked:run-invalid:<review run>:Required` for good: the review run's
 * body had no `estimateId`, which the run read schema requires. The no-change goal judge is written the same way.
 * Two layers: the writer gives every group single call `estimateId: null`; the reader takes a stored run written before
 * the fix (no `estimateId`) as `null`, so groups already in a person's store read again without editing the database.
 */
const reviewRun = (w: ReviewWorld) => {
  const rows = w.t.h.store.db.prepare("SELECT id, body FROM runs WHERE group_id='g' AND json_extract(body,'$.purpose')='requirement-review'").all();
  expect(rows).toHaveLength(1);
  return { id: String(rows[0]!.id), body: JSON.parse(String(rows[0]!.body)) as Record<string, unknown> };
};

describe("a group single call's run reads in the group view (#282)", () => {
  it("the review run is written with estimateId null, and the group reads in full with it", async () => {
    const w = await reviewWorld();
    try {
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "passed", 120);
      const run = reviewRun(w);
      // mutation W: drop `estimateId: null` from the group single call's identity -> the key is absent, red
      expect(run.body).toHaveProperty("estimateId", null);
      expect(readControlGroup(w.t.h.store, "epoch-test", "g").runs.map((r) => r.runId)).toContain(run.id);
    } finally { await w.t.h.dispose(); }
  }, 180000);

  it("a review run stored before the fix, without estimateId, still lets the group read", async () => {
    const w = await reviewWorld();
    try {
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "passed", 120);
      const run = reviewRun(w);
      w.t.h.store.db.prepare("UPDATE runs SET body=json_remove(body,'$.estimateId') WHERE id=?").run(run.id);
      expect(reviewRun(w).body).not.toHaveProperty("estimateId");
      // mutation R: make the read schema's estimateId required again -> run-invalid:<id>:Required, red
      expect(readControlGroup(w.t.h.store, "epoch-test", "g").runs.map((r) => r.runId)).toContain(run.id);
    } finally { await w.t.h.dispose(); }
  }, 180000);

  it("a goal judge run reads in the group view", async () => {
    // As noChangeJudge.test.ts's `judged`: a command-verified task that changes nothing asks one goal-judge call.
    const t = await driverHarness([{ taskId: "a" }], { files: () => ({}) });
    try {
      const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
      const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, activeMs: limit.activeMs * 4, attempts: limit.attempts + 20, sessions: limit.sessions + 20 } }));
      if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
      answerSingleCalls(t, () => ({ outcome: "complete", output: { verdict: "met", finding: "already there" } }));
      await t.claim();
      const driver = t.driver();
      const judge = () => t.h.store.db.prepare("SELECT id FROM runs WHERE group_id='g' AND json_extract(body,'$.purpose')='no-change-judge'").get();
      await t.until(driver, () => judge() !== undefined && t.h.store.db.prepare("SELECT 1 FROM runs WHERE id=? AND active=0").get(String(judge()!.id)) !== undefined);
      // mutation J: drop the read schema's noChangeJudge key -> run-invalid:<id>:Unrecognized key(s), red
      expect(readControlGroup(t.h.store, "epoch-test", "g").runs.map((r) => r.runId)).toContain(String(judge()!.id));
    } finally { await t.h.dispose(); }
  }, 60000);
});
