import { describe, expect, it } from "vitest";
import { flagDecision } from "../../src/control/flaggedDecisions.js";
import { readGroupSummary } from "../../src/panel/controlViews.js";
import { profileSnapshot, webFixture } from "../control/fixtures/web.js";

// Kanban spec 2026-10-20 §4 (session 9ec98639): the three facts a board card shows, from the summary.
describe("a board card's facts (kanban spec §4)", () => {
  it("budget, decisions waiting for a person, and the first failed task with its cause", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }, { taskId: "b" }]); try {
      const body = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as { used: { tokens: number }; limit: { tokens: number | null } };
      expect(readGroupSummary(h.store, "g").card).toEqual({ budget: { usedTokens: body.used.tokens, limitTokens: body.limit.tokens }, pendingDecisions: 0, firstFailure: null });
      h.store.transaction(() => flagDecision(h.store, { decisionId: "r/agent-0", groupId: "g", runId: null, source: "reconcile", reason: "r", evidence: [], by: "orca-auto", at: "t" }));
      // mutation: drop the flagged count -> 0, red
      expect(readGroupSummary(h.store, "g").card!.pendingDecisions).toBe(1);
      h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('rb','g','b',1,0,?)").run(JSON.stringify({ failureCode: null, drive: { blockedReason: "terminal:exhausted" } }));
      const work = JSON.parse(String(h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='b'").get()!.body));
      h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='b'").run(JSON.stringify({ ...work, currentRunId: "rb" }));
      // mutation: read only failureCode -> null, red
      expect(readGroupSummary(h.store, "g").card!.firstFailure).toEqual({ taskId: "b", cause: "terminal:exhausted" });
    } finally { await h.dispose(); }
  });
});
