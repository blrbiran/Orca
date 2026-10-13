import { describe, expect, it } from "vitest";
import type { driverHarness } from "./fixtures/driverHarness.js";
import { unknownFailure, settle } from "./fixtures/unknownFailure.js";
import { withCommandContext } from "../../src/control/commandClient.js";
import { hasValidUsageSettlement, usageSettlementSchema } from "../../src/control/usageSettlement.js";
import { recordUsage } from "../../src/control/usage.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";

// Spec 2026-10-13-unmetered-usage-settlement-design.md §A: an unlimited work token remainder is released, not charged.
// The shape of the tester's Codex 429: a failed work run (blocked at C) whose work usage is unknown and whose work tokens are unlimited.
async function unlimitedUnknown() {
  const { t: x, runId: id, driver } = await unknownFailure([{ taskId: "a", tokenBudget: null } as never], true, { tokenPolicy: "optional-v1" });
  return { x, id, driver };
}
const settleAs = (x: Awaited<ReturnType<typeof driverHarness>>, id: string, acknowledge: string) => {
  const c = x.h.command("settle-unknown-usage" as any, { taskId: "a", runId: id, generation: 1, acknowledge });
  return withCommandContext(c.commandId, { client: "web", principal: "user:owner" }, () => (x.service as any).settleUnknownUsage(c));
};
const workLedgerRows = (x: Awaited<ReturnType<typeof driverHarness>>, id: string) =>
  x.h.store.db.prepare("SELECT tokens FROM usage_ledger WHERE run_id=? AND source='run-work' ORDER BY id").all(id).map(r => Number(r.tokens));

describe("unmetered release of an unlimited run's unknown usage", () => {
  it("previews the release, refuses a charge, releases only the work tokens unmetered", async () => {
    const { x, id } = await unlimitedUnknown(); try {
      expect(readControlGroup(x.h.store, "epoch", "g").runs[0]!.unknownUsageSettlement).toMatchObject({ allowed: true, refusalReason: null, acknowledge: "release-unmetered" });
      const refused = await settleAs(x, id, "charge-remaining-grant");
      expect(refused.error).toMatchObject({ code: "run-usage-not-settleable" });
      expect(refused.error.message).toContain("unlimited-remainder");
      const before = x.body(id), used = readControlGroup(x.h.store, "epoch", "g").ledger.used, rowsBefore = workLedgerRows(x, id);
      expect(before.remaining.work.tokens).toBeNull();
      const result = await settleAs(x, id, "release-unmetered");
      expect(result).not.toHaveProperty("error");
      expect(result.result).toMatchObject({ kind: "usage-settled", method: "owner-acknowledged-unmetered",
        charged: { work: { tokens: null, activeMs: before.remaining.work.activeMs, attempts: before.remaining.work.attempts, sessions: before.remaining.work.sessions }, handoff: before.remaining.handoff } });
      const after = x.body(id), usedAfter = readControlGroup(x.h.store, "epoch", "g").ledger.used;
      expect(usedAfter.tokens).toBe(used.tokens + before.remaining.handoff.tokens);
      expect(usedAfter.activeMs).toBe(used.activeMs + before.remaining.work.activeMs + before.remaining.handoff.activeMs);
      expect(workLedgerRows(x, id)).toEqual(rowsBefore);
      expect(after.remaining.work).toEqual({ tokens: null, activeMs: 0, attempts: 0, sessions: 0 });
      expect(after.cumulative.work.tokens).toBe(before.cumulative.work.tokens);
      expect(after.unknown).toEqual({ work: false, handoff: false });
      expect(after.usageSettlement).toMatchObject({ method: "owner-acknowledged-unmetered", charged: { work: { tokens: null } } });
      expect(hasValidUsageSettlement(x.h.store, after)).toBe(true);
      expect(readControlGroup(x.h.store, "epoch", "g").ledger.unmeteredRuns).toBe(1);
      const prior = JSON.parse(String(x.h.store.db.prepare("SELECT body FROM usage_events WHERE run_id=? ORDER BY seq DESC LIMIT 1").get(id)!.body));
      expect(() => recordUsage(x.h.store, { ...prior, eventSeq: prior.eventSeq + 1 })).toThrow("run-usage-settled");
      // Review Focus 2/3: the null work token allowance belongs to the new method and its exact shape only.
      const forged = (patch: (r: any) => void) => { const r = structuredClone(after); patch(r); return hasValidUsageSettlement(x.h.store, r); };
      expect(forged(r => { r.usageSettlement.charged.work.tokens = 1; })).toBe(false);
      expect(forged(r => { r.remaining.work.tokens = 0; })).toBe(false);
      expect(forged(r => { r.usageSettlement.method = "remaining-grant"; })).toBe(false);
      expect(forged(r => { r.cumulative.work.tokens += 1; })).toBe(false);
    } finally { await x.h.dispose(); }
  });

  it("admits a retry after the release; the next run inherits only the observed work usage", async () => {
    const { x, id, driver } = await unlimitedUnknown(); try {
      expect(x.body(id).cumulative.work).toEqual({ tokens: 10, activeMs: 5, attempts: 1, sessions: 1 });
      expect(x.service.retryTask(x.h.command("retry-task", { taskId: "a" }))).toMatchObject({ error: { code: "task-not-retryable" } });
      expect(await settleAs(x, id, "release-unmetered")).not.toHaveProperty("error");
      expect(x.service.retryTask(x.h.command("retry-task", { taskId: "a" }))).not.toHaveProperty("error");
      // The group books the conservative non-token charge (ruling 2026-10-13), so a fresh run needs group headroom, as after
      // any remaining-grant settlement (unknownFailure's extraReserve). The token limit stays unlimited.
      const limit = readControlGroup(x.h.store, "epoch", "g").ledger.groupLimit;
      expect(limit.tokens).toBeNull();
      expect(x.service.setLimit(x.h.command("set-limit", { limit: { ...limit, activeMs: limit.activeMs * 4, attempts: limit.attempts * 4, sessions: limit.sessions * 4 } }))).not.toHaveProperty("error");
      await driver.round(); expect((await deliverScheduledStart(x.dispatch, "g")).kind).toBe("claimed");
      const next = String(x.h.store.db.prepare("SELECT id FROM runs WHERE group_id='g' ORDER BY rowid DESC LIMIT 1").get()!.id);
      expect(next).not.toBe(id);
      expect(x.body(next).grant.work.tokens).toBeNull();
      // Lineage counts what the provider observed (the fixture's one reported event), not the conservative charge.
      expect(x.body(next).tokenPolicy.inheritedUsage).toEqual({ tokens: 10, activeMs: 5, attempts: 1, sessions: 1 });
      expect(x.body(next).grant.work).toEqual({ tokens: null, activeMs: 14_399_995, attempts: 2, sessions: 2 });
      expect(readControlGroup(x.h.store, "epoch", "g").ledger.usageUnknown).toBe(false);
    } finally { await driver.stop(); await x.h.dispose(); }
  }, 30_000);

  it("refuses an unmetered release of a finite remainder, and an old marker parses to itself", async () => {
    const { t, runId } = await unknownFailure(); try {
      const refused = await settle(t, runId, t.h.command("settle-unknown-usage" as any, { taskId: "a", runId, generation: 1, acknowledge: "release-unmetered" }));
      expect(refused.error).toMatchObject({ code: "run-usage-not-settleable" });
      expect(refused.error.message).toContain("finite-remainder");
      expect(readControlGroup(t.h.store, "epoch", "g").runs[0]!.unknownUsageSettlement).toMatchObject({ allowed: true, acknowledge: "charge-remaining-grant" });
      expect(readControlGroup(t.h.store, "epoch", "g").ledger.unmeteredRuns).toBe(0);
      expect(await settle(t, runId)).not.toHaveProperty("error");
      expect(readControlGroup(t.h.store, "epoch", "g").ledger.unmeteredRuns).toBe(0);
      const stored = t.body(runId).usageSettlement;
      expect(stored.method).toBe("remaining-grant");
      expect(usageSettlementSchema.parse(stored)).toEqual(stored);
    } finally { await t.h.dispose(); }
  });
});
