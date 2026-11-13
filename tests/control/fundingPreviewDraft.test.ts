// Tester follow-up I, seat K (the controller's dogfood run, g-28d9b560): before a group is confirmed every task is `draft`,
// and the funding preview `orca proposal show` and `orca group confirm` print (#212) answered "a claim now funds nothing
// (task-budget-unavailable)" for each of them -- the moment a person decides to confirm -- although the independent tasks
// were then funded and ran in parallel. A task waiting for a dependency is named as such, not as a missing budget.
import { describe, expect, it } from "vitest";
import { fundingPreview } from "../../src/control/fundedAllowance.js";
import { readGroup, saveGroup } from "../../src/control/queries.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";

describe("the funding preview of a group not yet confirmed (tester follow-up I, seat K)", () => {
  it("funds the draft tasks a claim could take, and names the one that waits for its dependency", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a", tokenBudget: null }, { taskId: "b", tokenBudget: null }, { taskId: "c", tokenBudget: null, dependsOn: ["a"] }],
      { tokenPolicy: "optional-v1", modelVersion: "followup-g" });
    try {
      const group = readGroup(h.store, "g");
      expect(group.status).toBe("draft");
      group.limit = { ...group.limit, tokens: 4_000_000 }; saveGroup(h.store, group);
      const rows = fundingPreview(h.store, "g", Date.now());
      // mutation K-D5: the preview's eligible statuses without draft -> every row task-budget-unavailable, red
      expect(rows.map((row) => [row.taskId, row.reason])).toEqual([["a", null], ["b", null], ["c", "dependencies-pending"]]);
      expect(rows.filter((row) => row.reason === null).every((row) => typeof row.fundableTokens === "number" && row.fundableTokens > 0)).toBe(true);
    } finally { await h.dispose(); }
  });
});

// Tester #291 (follow-up J): in a running expectation-model group the preview said task-budget-unavailable for every task --
// decideFundedAllowance's answer for any task or group a claim skips -- while four of them were running. The preview now
// names why a claim would not fund it: the task is running (task-active) or done (task-done), the group is stopped
// (group-stopped) or has a recovery blocker (recovery-blocked). Display only: the claim is unchanged (ruling #212).
describe("the funding preview names why a claim would not fund a task (#291)", () => {
  it("task-active, task-done, group-stopped and recovery-blocked instead of task-budget-unavailable", async () => {
    const { WebControlService } = await import("../../src/control/webService.js");
    const { deliverScheduledStart } = await import("../../src/control/webDispatch.js");
    const h = await webFixture(profileSnapshot(), [{ taskId: "a", tokenBudget: null }, { taskId: "b", tokenBudget: null }, { taskId: "c", tokenBudget: null }],
      { tokenPolicy: "optional-v1", modelVersion: "followup-g" });
    try {
      const service = new WebControlService(h.deps);
      await service.confirm(h.command("confirm", await h.confirmPayload()));
      await service.start(h.command("start", {}));
      const claimed = await deliverScheduledStart({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate }, "g");
      if (claimed.kind !== "claimed") throw new Error(JSON.stringify(claimed));
      const running = String((JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(claimed.runId)!.body)) as { taskId: string }).taskId);
      const others = ["a", "b", "c"].filter((task) => task !== running);
      const done = others[0]!, ready = others[1]!;
      h.store.db.prepare("UPDATE work_items SET body=json_set(body,'$.status','done') WHERE group_id='g' AND id=?").run(done);
      const reasons = () => Object.fromEntries(fundingPreview(h.store, "g", Date.now()).map((row) => [row.taskId, row.reason]));
      // mutation (no task reasons before decide) -> red here: task-budget-unavailable for both.
      expect(reasons()).toEqual({ [running]: "task-active", [done]: "task-done", [ready]: null });
      h.store.db.prepare("INSERT INTO recovery_blockers(id,group_id,run_id,scope,code,body) VALUES ('blk-291','g',NULL,'group','claim-capability-unavailable',?)").run(JSON.stringify({ evidenceIds: [] }));
      // mutation (no recovery-blocked) -> red here.
      expect(reasons()).toEqual({ [running]: "recovery-blocked", [done]: "recovery-blocked", [ready]: "recovery-blocked" });
      h.store.db.prepare("DELETE FROM recovery_blockers WHERE id='blk-291'").run();
      const group = readGroup(h.store, "g"); saveGroup(h.store, { ...group, stopped: true } as typeof group);
      // mutation (no group-stopped) -> red here.
      expect(reasons()[ready]).toBe("group-stopped");
    } finally { await h.dispose(); }
  });
});
