// Tester #389: after Orca auto-confirms an unlimited group with an active run, `group set-limit` refuses with
// `active-unbounded-budget-conflict` (the provider already holds an unbounded grant, so a finite limit cannot bind it).
// The refusal must name the run and the exact ways out -- group close-run (or run abandon while it runs) -- and the retry.
import { describe, expect, it } from "vitest";
import { claimWork } from "../../src/control/budget.js";
import { createGroup, putWork, setGroupLimit } from "../../src/control/commands.js";
import { amount, caps, fixtureAgent, openTestStore } from "./fixtures/store.js";

describe("active-unbounded-budget-conflict names the way out (tester #389)", () => {
  it("names the run, group close-run, run abandon and the retry; installs nothing", async () => {
    const h = await openTestStore();
    try {
      createGroup(h.store, {
        groupId: "g", projectKey: "r", goal: "ship", successConditions: ["passes"], budgetMode: "soft",
        limit: { ...amount(0, 1_000_000, 100, 100), tokens: null }, reviewReserve: amount(0, 0, 0, 0), deadlineAt: null,
      } as never, { commandId: "create", expectedRevision: 0, by: "human" });
      putWork(h.store, "g", {
        workItemId: "a", taskId: "a", kind: "task", dependsOn: [], contract: {}, configHash: "config", agent: fixtureAgent,
        grant: { work: { ...amount(0), tokens: null }, handoff: amount(10, 0, 0, 0) },
      } as never, { commandId: "put-a", expectedRevision: 1, by: "human" });
      const claim = claimWork(h.store, { groupId: "g", workItemId: "a", graphVersion: 2, targetVersion: 1, commandId: "claim-a", expectedRevision: 2, by: "service", capabilities: caps });
      expect(claim.grant.work.tokens).toBeNull();
      let message = "";
      try {
        setGroupLimit(h.store, "g", amount(1000, 1_000_000, 100, 100), { commandId: "limit", expectedRevision: 2, by: "human" });
      } catch (error) { message = (error as Error).message; }
      // mutation: keep the old "stop and reconcile" text -> no run id and no command, red.
      expect(message).toContain("active-unbounded-budget-conflict");
      expect(message).toContain(claim.runId);
      expect(message).toContain(`orca group close-run g --run ${claim.runId}`);
      expect(message).toContain(`orca run abandon g --run ${claim.runId}`);
      expect(message).toContain("then run this command again");
      // The refusal rolls the write back: the group still has no token limit.
      expect(JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).limit.tokens).toBeNull();
    } finally { await h.dispose(); }
  });
});
