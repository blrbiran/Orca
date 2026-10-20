import { describe, expect, it } from "vitest";
import { executionPendingFrom, groupExecutionPendingInStore } from "../../src/control/executionPending.js";
import { WebControlService } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";

// Start guard spec (2026-10-15) §3.1: one predicate decides "this group's execution is pending or running" for the group
// view (which hides Start) and for start's guard (which refuses it) -- two copies drifted once already. An estimate,
// clarify or split single call shares the runs table and is not execution: it has its own guards.
async function confirmed() {
  const h = await webFixture(profileSnapshot());
  const service = new WebControlService(h.deps);
  await service.confirm(h.command("confirm", await h.confirmPayload()));
  return { h, service };
}

describe("the execution-pending predicate (spec B §3.1)", () => {
  it("counts only dispatch wakes, work runs and busy work statuses", () => {
    expect(executionPendingFrom({ undeliveredWakeKinds: ["continuation", "budget-estimate", "requirement-call", "requirement-export"],
      activeRunPhases: ["single-call", "handoff", undefined], taskStatuses: ["draft", "ready", "done", "blocked", "completed", undefined] })).toBe(false);
    const one = (facts: Partial<Parameters<typeof executionPendingFrom>[0]>) => executionPendingFrom({ undeliveredWakeKinds: [], activeRunPhases: [], taskStatuses: [], ...facts });
    expect([one({ undeliveredWakeKinds: ["start"] }), one({ undeliveredWakeKinds: ["no-start"] }), one({ undeliveredWakeKinds: ["resume"] }), one({ activeRunPhases: ["work"] }),
      ...["running", "active", "starting", "start-unknown", "held", "continuing"].map((status) => one({ taskStatuses: [status] }))])
      .toEqual([true, true, true, true, true, true, true, true, true, true]);
  });

  it("an active estimate run alone is not pending, in the view and in the store", async () => {
    // Spec correction 2026-10-20: claimed before the confirm (a queued estimate is withdrawn once the proposal is confirmed).
    const h = await webFixture(profileSnapshot()), service = new WebControlService(h.deps); try {
      expect(await service.claimEstimate("g", h.estimateId)).not.toBeNull();
      expect(await service.confirm(h.command("confirm", await h.confirmPayload()))).toMatchObject({ result: { kind: "confirmed" } });
      expect(h.store.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE group_id='g' AND active=1").get()!.n).toBe(1);
      expect([readControlGroup(h.store, "epoch-test", "g").summary.executionPending, groupExecutionPendingInStore(h.store, "g")]).toEqual([false, false]);
    } finally { await h.dispose(); }
  });
});
