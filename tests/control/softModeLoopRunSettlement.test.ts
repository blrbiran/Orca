// Spec 2026-11-06 soft-mode loop run settlement §3.3-§3.6, criteria O1-O3, O3b, O8-O14, O16-O18 (session 86352010). A loop
// run of a group with no token limit whose usage the tool did not report is booked at its observed floor by orca-auto,
// so the group goes on with no person in between; everything outside that scope keeps the person's path.
import { describe, expect, it } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import { updateRevision } from "../../src/control/commandLedger.js";
import { applySettleUnknownUsage } from "../../src/control/settleUnknownUsage.js";
import { softLoopSettlementPass } from "../../src/control/softLoopSettlement.js";
import { readBudgetProposal, readWork } from "../../src/control/queries.js";
import { groupStopState } from "../../src/control/stopIntent.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { approximateRows, estimatorSized, groupBody, handoff, loopUnknown, pass, settledActivity, since, stoppedUnknown, unlimit, workLedger, type Harness } from "./fixtures/softLoop.js";

const view = (t: Harness) => readControlGroup(t.h.store, "epoch", "g");
const runView = (t: Harness, runId: string) => view(t).runs.find(r => r.runId === runId)!;
const personSettle = (t: Harness, runId: string, acknowledge: string) => {
  const c = t.h.command("settle-unknown-usage", { taskId: "a", runId, generation: 1, acknowledge: acknowledge as never });
  return withCommandContext(c.commandId, { client: "web", principal: "user:owner" }, () => (t.service as any).settleUnknownUsage(c));
};

describe("soft mode: a loop run's unknown usage is booked at its floor by Orca", { timeout: 60_000 }, () => {
  it("O1: failed omp-shaped run, floor F -- booked under orca-auto and the next task is claimed with no person command", async () => {
    const { t, runId, driver } = await loopUnknown({ tokenPolicy: "optional-v1", floor: 500 }); try {
      expect(view(t).ledger.usageUnknown).toBe(true);
      await expect(t.claim()).rejects.toThrow("usage-unknown");
      since(t);
      await driver.round();
      const run = t.body(runId);
      expect(run.usageSettlement).toMatchObject({ method: "approximate-floor", principal: "orca-auto", floorTokens: 500, reservationDisposition: "committed" });
      expect(run.usageApproximate).toMatchObject({ floorTokens: 500 });
      expect(approximateRows(t)).toMatchObject([{ id: `orca-auto-approximate-${runId}-1`, principal: "orca-auto", client: "panel", verb: "settle-approximate-usage", original_status: 200 }]);
      expect(view(t).ledger.usageUnknown).toBe(false);
      expect(t.body(await t.claim()).taskId).toBe("b");
    } finally { await driver.stop(); await t.h.dispose(); }
  });

  it("O2: no floor -- books 0 and shows the floor as unknown", async () => {
    const { t, runId, driver } = await loopUnknown({ tokenPolicy: "optional-v1" }); try {
      since(t);
      const used = groupBody(t).used.tokens, before = t.body(runId).cumulative.work.tokens;
      expect(pass(t)).toBe(true);
      expect(t.body(runId).usageApproximate).toMatchObject({ floorTokens: null });
      expect(t.body(runId).cumulative.work.tokens).toBe(before);
      expect(groupBody(t).used.tokens).toBe(used);
      expect(runView(t, runId).usageApproximate).toEqual({ floorTokens: null });
    } finally { await driver.stop(); await t.h.dispose(); }
  });

  it("O8: floor arithmetic -- baseline B and floor F count disjoint calls, so F is booked (cumulative B + F)", async () => {
    const { t, runId, driver } = await loopUnknown({ tokenPolicy: "optional-v1", floor: 500 }); try {
      since(t);
      expect(t.body(runId).cumulative.work.tokens).toBe(10);
      const used = groupBody(t).used.tokens, rows = workLedger(t, runId);
      pass(t);
      expect(t.body(runId).cumulative.work.tokens).toBe(510);
      expect(t.body(runId).usageSettlement.charged).toEqual({ work: { tokens: 500, activeMs: 0, attempts: 0, sessions: 0 }, handoff: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 } });
      expect(groupBody(t).used.tokens).toBe(used + 500);
      expect(workLedger(t, runId)).toEqual([...rows, 500]);
      expect(settledActivity(t, runId)).toEqual([{ method: "approximate-floor", floorTokens: 500, reason: "terminal:failed", principal: "orca-auto", at: t.body(runId).usageApproximate.at }]);
    } finally { await driver.stop(); await t.h.dispose(); }
  });

  it("O3: a finite group blocks and flags as today", async () => {
    const { t, runId, driver } = await loopUnknown({ floor: 500 }); try {
      // Estimator-sized, so only the group's finite limit keeps it out of scope.
      estimatorSized(t, "a"); since(t);
      expect(groupBody(t).limit.tokens).not.toBeNull();
      expect(pass(t)).toBe(false);
      expect(t.body(runId)).toMatchObject({ state: "blocked", unknown: { work: true } });
      expect(t.body(runId).usageSettlement).toBeUndefined();
      expect(approximateRows(t)).toEqual([]);
      // The fixture's provenance edit is not in the frozen snapshot, so the group view refuses to read; its ledger is read.
      expect(groupBody(t).ledger.usageUnknown).toBe(true);
    } finally { await driver.stop(); await t.h.dispose(); }
  });

  it("O3b: an authored task budget in an unlimited group keeps the person's path", async () => {
    const { t, runId, driver } = await loopUnknown({ tokenPolicy: "optional-v1", floor: 500, tasks: [{ taskId: "a", tokenBudget: 99_000 }, { taskId: "b", tokenBudget: null }] }); try {
      since(t);
      expect(groupBody(t).limit.tokens).toBeNull();
      expect(readBudgetProposal(t.h.store, "g").allocations.find(a => a.ownerId === "a" && a.bucket === "work")!.fieldProvenance.tokens.provenance).toBe("complex-1m-default");
      expect(pass(t)).toBe(false);
      expect(t.body(runId).usageSettlement).toBeUndefined();
      expect(approximateRows(t)).toEqual([]);
      expect(view(t).ledger.usageUnknown).toBe(true);
      expect(runView(t, runId).unknownUsageSettlement).toMatchObject({ allowed: true, acknowledge: "charge-remaining-grant" });
    } finally { await driver.stop(); await t.h.dispose(); }
  });

  it("O9: released disposition -- the stop already gave the reservation back, so reserved is unchanged", async () => {
    const { t, runId, driver } = await loopUnknown({ floor: 500, tasks: [{ taskId: "a" }, { taskId: "b" }] }); try {
      await handoff(t, runId, driver);
      expect(t.body(runId).state).toBe("settled-unrecoverable");
      unlimit(t); const restore = estimatorSized(t, "a"); since(t);
      const before = groupBody(t);
      expect(pass(t)).toBe(true);
      restore();
      const after = groupBody(t);
      expect(t.body(runId)).toMatchObject({ state: "settled-failed", recoverable: false, usageSettlement: { method: "approximate-floor", reservationDisposition: "released" } });
      expect(after.reserved).toEqual(before.reserved);
      expect(after.used).toEqual({ ...before.used, tokens: before.used.tokens + 500 });
      expect(await t.service.resumeFromHandoff(t.h.command("resume-from-handoff", { selections: [] }))).not.toHaveProperty("error");
      expect(t.service.retryTask(t.h.command("retry-task", { taskId: "a" }))).not.toHaveProperty("error");
    } finally { await driver.stop(); await t.h.dispose(); }
  });

  it("O10: recovered optional-v1 -- the whole remainder is released as for a known-usage stop, then it continues", async () => {
    const { t, runId, driver } = await stoppedUnknown("optional-v1", null); try {
      since(t);
      const before = groupBody(t), remaining = t.body(runId).remaining, allocations = readBudgetProposal(t.h.store, "g").allocations.filter(a => a.ownerKind === "task");
      expect(pass(t)).toBe(true);
      const after = groupBody(t);
      expect(t.body(runId)).toMatchObject({ state: "settled-recoverable", recoverable: true, usageSettlement: { method: "approximate-floor", reservationDisposition: "recovered" } });
      expect(after.used).toEqual(before.used);
      const released = { tokens: remaining.work.tokens ?? 0, activeMs: remaining.work.activeMs, attempts: remaining.work.attempts, sessions: remaining.work.sessions };
      for (const d of ["tokens", "activeMs", "attempts", "sessions"] as const) expect(after.reserved[d]).toBe(before.reserved[d] - released[d] - remaining.handoff[d]);
      expect(readWork(t.h.store, "g", "a")).toMatchObject({ status: "held", fundingReleased: true });
      expect(readBudgetProposal(t.h.store, "g").allocations.filter(a => a.ownerKind === "task")).toEqual(allocations.map(a => ({ ...a, state: "held" })));
      expect(groupStopState(t.h.store, "g")).toBe("handoff-complete");
      expect(await t.service.resumeFromHandoff(t.h.command("resume-from-handoff", { selections: [{ taskId: "a", predecessorRunId: runId, checkpointId: t.body(runId).checkpointId }] }))).not.toHaveProperty("error");
      expect((await deliverScheduledStart(t.dispatch, "g")).kind).toBe("claimed");
    } finally { await driver.stop(); await t.h.dispose(); }
  });

  it("O11: recovered finite-legacy -- the continuation is parked at the remainder after the floor", async () => {
    const { t, runId, driver } = await stoppedUnknown(undefined, 99_000); try {
      unlimit(t, 8); const restore = estimatorSized(t, "a"); since(t);
      const before = groupBody(t), run = t.body(runId);
      expect(pass(t)).toBe(true);
      restore();
      const parked = t.body(runId).remaining;
      expect(t.body(runId).usageSettlement).toMatchObject({ method: "approximate-floor", reservationDisposition: "recovered" });
      expect(parked.work.tokens).toBe(run.grant.work.tokens - run.cumulative.work.tokens);
      expect(readWork(t.h.store, "g", "a")).toMatchObject({ status: "held", grant: parked });
      expect(Object.fromEntries(readBudgetProposal(t.h.store, "g").allocations.filter(a => a.ownerKind === "task").map(a => [a.bucket, [a.state, a.amount]]))).toEqual({ work: ["held", parked.work], handoff: ["held", parked.handoff] });
      for (const d of ["tokens", "activeMs", "attempts", "sessions"] as const) expect(groupBody(t).reserved[d]).toBe(before.reserved[d] + parked.work[d] + parked.handoff[d]);
      expect(await t.service.resumeFromHandoff(t.h.command("resume-from-handoff", { selections: [{ taskId: "a", predecessorRunId: runId, checkpointId: t.body(runId).checkpointId }] }))).not.toHaveProperty("error");
    } finally { await driver.stop(); await t.h.dispose(); }
  });

  it("O12: idempotent -- two passes book one marker, one row, one activity, one usage row", async () => {
    const { t, runId, driver } = await loopUnknown({ tokenPolicy: "optional-v1", floor: 500 }); try {
      since(t);
      const used = groupBody(t).used.tokens, rows = workLedger(t, runId).length;
      expect(pass(t)).toBe(true);
      const marker = t.body(runId).usageSettlement;
      expect(pass(t)).toBe(false);
      expect(t.body(runId).usageSettlement).toEqual(marker);
      expect(approximateRows(t)).toHaveLength(1);
      expect(settledActivity(t, runId)).toHaveLength(1);
      expect(workLedger(t, runId)).toHaveLength(rows + 1);
      expect(groupBody(t).used.tokens).toBe(used + 500);
    } finally { await driver.stop(); await t.h.dispose(); }
  });

  it("O13: race, person second -- the pass commits after the person read the evidence, the person is refused", async () => {
    const { t, runId, driver } = await loopUnknown({ tokenPolicy: "optional-v1", floor: 500 }); try {
      since(t);
      let settled: unknown;
      // Sent at the revision the pass leaves (it bumps the group revision by one), so the person's transaction reaches admission.
      const sent = t.h.command("settle-unknown-usage", { taskId: "a", runId, generation: 1, acknowledge: "release-unmetered" }), c = { ...sent, expectedRevision: sent.expectedRevision + 1 };
      const result = await withCommandContext(c.commandId, { client: "web", principal: "user:owner" }, () => applySettleUnknownUsage({
        store: t.h.store, afterEvidence: async () => { expect(softLoopSettlementPass({ store: t.h.store })).toBe(true); settled = structuredClone(t.body(runId)); },
      }, c as never));
      expect(result).toMatchObject({ error: { code: "run-usage-settled" } });
      expect(t.body(runId)).toEqual(settled);
      expect(settledActivity(t, runId)).toHaveLength(1);
    } finally { await driver.stop(); await t.h.dispose(); }
  });

  it("O14: race, person first -- the pass skips, no second activity and no row", async () => {
    const { t, runId, driver } = await loopUnknown({ tokenPolicy: "optional-v1", floor: 500 }); try {
      since(t);
      expect(await personSettle(t, runId, "release-unmetered")).not.toHaveProperty("error");
      const body = t.body(runId);
      expect(pass(t)).toBe(false);
      expect(t.body(runId)).toEqual(body);
      expect(approximateRows(t)).toEqual([]);
      expect(settledActivity(t, runId)).toHaveLength(1);
    } finally { await driver.stop(); await t.h.dispose(); }
  });

  it("O16: a permanent refusal is booked once and named on the run; the person's path stays", async () => {
    const { t, runId, driver } = await loopUnknown({ tokenPolicy: "optional-v1", floor: 500 }); try {
      since(t);
      t.h.store.db.prepare("DELETE FROM outbox WHERE id=?").run(`report:${runId}`);
      expect(pass(t)).toBe(false);
      const rows = approximateRows(t);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.original_status).toBeGreaterThanOrEqual(400);
      expect(JSON.parse(String(rows[0]!.body_json)).error.code).toBe("run-stop-proof-required");
      expect(t.body(runId).unknown.work).toBe(true);
      expect(view(t).ledger.usageUnknown).toBe(true);
      expect(runView(t, runId).unknownUsageSettlement).toMatchObject({ approximateRefusal: "run-stop-proof-required" });
      expect(runView(t, runId).unknownUsageSettlement!.settlement).toBeUndefined();
      // Booked once: a later round at another group revision does not send it again.
      updateRevision(t.h.store, "g", Number(groupBody(t).revision) + 1);
      expect(pass(t)).toBe(false);
      expect(approximateRows(t)).toHaveLength(1);
    } finally { await driver.stop(); await t.h.dispose(); }
  });

  it("O17: saved-result verification and recovery runs are out of scope", async () => {
    const { t, runId, driver } = await loopUnknown({ tokenPolicy: "optional-v1", floor: 500 }); try {
      since(t);
      for (const patch of [{ mode: "verify-saved-result" }, { recoveryOf: { runId: "earlier" } }]) {
        t.h.store.transaction(() => { const run = { ...t.body(runId), ...patch }; delete (run as any)[Object.keys(patch)[0] === "mode" ? "recoveryOf" : "mode"]; t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(run), runId); });
        expect(pass(t)).toBe(false);
        expect(t.body(runId).usageSettlement).toBeUndefined();
        expect(approximateRows(t)).toEqual([]);
      }
    } finally { await driver.stop(); await t.h.dispose(); }
  });

  it("O18: D4 cutoff -- a run that stopped before the release is left for a person, one after is settled", async () => {
    const { t, runId, driver } = await loopUnknown({ tokenPolicy: "optional-v1", floor: 500 }); try {
      expect(pass(t)).toBe(false);
      since(t, Date.now() + 86_400_000);
      expect(pass(t)).toBe(false);
      expect(t.body(runId).usageSettlement).toBeUndefined();
      t.h.store.db.prepare("UPDATE meta SET value='0' WHERE key='softLoopSince'").run();
      expect(pass(t)).toBe(true);
      expect(t.body(runId).usageSettlement).toMatchObject({ method: "approximate-floor" });
    } finally { await driver.stop(); await t.h.dispose(); }
  });
});
