import { describe, expect, it } from "vitest";
import { readGroupSummary } from "../../src/panel/controlViews.js";
import { profileSnapshot, webFixture } from "../control/fixtures/web.js";

// Tester #267: a run blocked at C before ccloop stated an outcome (a collect a sleeping machine timed out) is resumed by
// recovery retry --run, as a run blocked at any other step is (#229); the card's failure names that command for it too.
describe("the card's first failure names recovery retry --run for a run blocked at C with no outcome (#267)", () => {
  it("names it with no outcome, and not once ccloop stated a failure", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const work = JSON.parse(String(h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body));
      h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify({ ...work, currentRunId: "rc" }));
      const run = (drive: Record<string, unknown>) => JSON.stringify({ state: "blocked", failureCode: null, drive });
      h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('rc','g','a',1,1,?)")
        .run(run({ blockedAt: "C", outcome: null, blockedReason: "control-peer-timeout" }));
      expect(readGroupSummary(h.store, "g").card!.firstFailure).toEqual({ taskId: "a", cause: "control-peer-timeout", next: "orca recovery retry --run rc" });
      h.store.db.prepare("UPDATE runs SET body=? WHERE id='rc'").run(run({ blockedAt: "C", outcome: "failed", blockedReason: "terminal:failed" }));
      expect(readGroupSummary(h.store, "g").card!.firstFailure).toEqual({ taskId: "a", cause: "terminal:failed" });
    } finally { await h.dispose(); }
  });
});
