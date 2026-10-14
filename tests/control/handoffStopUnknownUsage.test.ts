// Spec 2026-10-14-handoff-stop-unknown-usage-design.md §4: a run handoff-stopped while working, whose usage the provider
// never reported, is settled by the owner and then continued from its checkpoint. Expected values are literals.
import { describe, expect, it } from "vitest";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { withCommandContext } from "../../src/control/commandClient.js";
import { readBudgetProposal, readWork } from "../../src/control/queries.js";
import { groupStopState, latestRequestForRun } from "../../src/control/stopIntent.js";
import { usageSettlementSchema } from "../../src/control/usageSettlement.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";

type Harness = Awaited<ReturnType<typeof driverHarness>>;

async function stopped(tokenPolicy: "optional-v1" | undefined, tokenBudget: number | null) {
  const x = await driverHarness([{ taskId: "a", tokenBudget }], { ...(tokenPolicy ? { tokenPolicy } : {}), killGraceMs: 0, behaviour: () => "stoppable-usage-unknown" });
  const driver = x.driver();
  const id = await x.claim();
  await x.until(driver, () => x.body(id).state === "accepted");
  await x.service.handoffStop(x.h.command("handoff-stop", {}));
  await x.until(driver, () => x.body(id).state === "settled-unrecoverable");
  return { x, driver, id };
}
const settle = (x: Harness, id: string, acknowledge: string) => {
  const c = x.h.command("settle-unknown-usage" as any, { taskId: "a", runId: id, generation: 1, acknowledge });
  return withCommandContext(c.commandId, { client: "web", principal: "user:owner" }, () => (x.service as any).settleUnknownUsage(c));
};
const taskAllocations = (x: Harness) => readBudgetProposal(x.h.store, "g").allocations.filter(a => a.ownerKind === "task" && a.ownerId === "a");
const group = (x: Harness) => JSON.parse(String(x.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
const business = (x: Harness) => ["runs", "work_items", "budget_proposals", "usage_ledger", "handoff_requests", "stop_intents", "groups"]
  .map(table => x.h.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());

async function resumeAndClaim(x: Harness, id: string) {
  expect(groupStopState(x.h.store, "g")).toBe("handoff-complete");
  const resumed = await x.service.resumeFromHandoff(x.h.command("resume-from-handoff", { selections: [{ taskId: "a", predecessorRunId: id, checkpointId: x.body(id).checkpointId }] }));
  expect(resumed).not.toHaveProperty("error");
  const continued = await deliverScheduledStart(x.dispatch, "g");
  expect(continued.kind).toBe("claimed");
  if (continued.kind !== "claimed") throw new Error("unreachable");
  expect((readWork(x.h.store, "g", "a") as any).continuation).toMatchObject({ predecessorRunId: id, pendingRunId: continued.runId });
  return continued.runId;
}

/**
 * D's ruling, kept here: the conservative charge stays in the group's books, so continuing needs non-token headroom for the
 * continuation's whole grant (work remainder plus handoff); the owner raises the group limit by exactly that.
 */
function raiseNonTokenLimit(x: Harness) {
  const g = group(x), grant = readWork(x.h.store, "g", "a").grant as any;
  const limit = { ...g.limit, ...Object.fromEntries(["activeMs", "attempts", "sessions"].map(d => [d, g.used[d] + g.reserved[d] + grant.work[d] + grant.handoff[d]])) };
  expect(x.service.setLimit(x.h.command("set-limit", { limit: limit as any }))).not.toHaveProperty("error");
}

function expectRecovered(x: Harness, id: string) {
  expect(x.body(id)).toMatchObject({ state: "settled-recoverable", recoverable: true, failureCode: null, unknown: { work: false, handoff: false }, usageSettlement: { reservationDisposition: "recovered" } });
  expect(latestRequestForRun(x.h.store, "g", id)).toMatchObject({ state: "settled-recoverable", failureCode: null });
  expect(readWork(x.h.store, "g", "a").status).toBe("held");
  expect(taskAllocations(x).map(a => a.state)).toEqual(["held", "held"]);
}

describe("handoff-stopped run with unknown usage", { timeout: 60_000 }, () => {
  it("optional-v1, unlimited: releases unmetered, then continues from the checkpoint inheriting only observed usage", async () => {
    const { x, driver, id } = await stopped("optional-v1", null); try {
      const before = group(x);
      const result = await settle(x, id, "release-unmetered");
      expect(result.error).toBeUndefined();
      expect(result.result).toMatchObject({ kind: "usage-settled", method: "owner-acknowledged-unmetered" });
      expectRecovered(x, id);
      // Work tokens book nothing; the other work dimensions and the handoff bucket are charged from the reservation.
      expect(group(x).used).toEqual({ tokens: before.used.tokens + 300000, activeMs: before.used.activeMs + 14400000 + 1800000, attempts: before.used.attempts + 3, sessions: before.used.sessions + 3 });
      expect(group(x).reserved).toEqual({ tokens: before.reserved.tokens - 300000, activeMs: before.reserved.activeMs - 14400000 - 1800000, attempts: before.reserved.attempts - 3, sessions: before.reserved.sessions - 3 });
      expect(readControlGroup(x.h.store, "epoch", "g").ledger.unmeteredRuns).toBe(1);
      raiseNonTokenLimit(x);
      const next = await resumeAndClaim(x, id);
      expect(x.body(next).tokenPolicy.inheritedUsage).toMatchObject({ tokens: 0, attempts: 0, sessions: 0 });
    } finally { await driver.stop(); await x.h.dispose(); }
  });

  it("optional-v1, finite: charges the remaining grant from the reservation, then continues", async () => {
    const { x, driver, id } = await stopped("optional-v1", 1_000_000); try {
      const before = group(x);
      expect((await settle(x, id, "release-unmetered")).error.message).toBe("run-usage-not-settleable:finite-remainder");
      expect((await settle(x, id, "charge-remaining-grant")).error).toBeUndefined();
      expectRecovered(x, id);
      expect(group(x).used.tokens).toBe(before.used.tokens + 1_000_000 + 300000);
      expect(group(x).reserved.tokens).toBe(before.reserved.tokens - 1_000_000 - 300000);
      raiseNonTokenLimit(x);
      const next = await resumeAndClaim(x, id);
      // A finite task under optional-v1 is funded at its authored grant; the conservative charge does not shrink it.
      expect(x.body(next).grant.work).toEqual({ tokens: 1_000_000, activeMs: 14400000, attempts: 3, sessions: 3 });
    } finally { await driver.stop(); await x.h.dispose(); }
  });

  it("finite-legacy: charges to used, re-reserves the grant minus observed usage as the held commitment, then continues", async () => {
    const { x, driver, id } = await stopped(undefined, 1_000_000); try {
      const run = x.body(id), g = group(x);
      expect(run.remaining.work).toEqual({ tokens: 3000000, activeMs: 14400000, attempts: 3, sessions: 3 });
      // Exactly room for the 3,300,000 charge plus the 3,300,000 parked again (the next criterion is 300,000 short).
      const twice = { tokens: 6600000, activeMs: 2 * (14400000 + 1800000), attempts: 6, sessions: 6 } as Record<string, number>;
      const limit = Object.fromEntries(Object.keys(twice).map(d => [d, g.used[d] + g.reserved[d] + twice[d]]));
      expect(x.service.setLimit(x.h.command("set-limit", { limit: limit as any }))).not.toHaveProperty("error");
      const before = group(x);
      expect((await settle(x, id, "charge-remaining-grant")).error).toBeUndefined();
      expectRecovered(x, id);
      const parked = { work: { tokens: 3000000, activeMs: 14400000, attempts: 3, sessions: 3 }, handoff: { tokens: 300000, activeMs: 1800000, attempts: 0, sessions: 0 } };
      expect(group(x).used.tokens).toBe(before.used.tokens + 3300000);
      expect(group(x).reserved.tokens).toBe(before.reserved.tokens + 3300000);
      expect(Object.fromEntries(taskAllocations(x).map(a => [a.bucket, a.amount]))).toEqual(parked);
      expect(readWork(x.h.store, "g", "a").grant).toEqual(parked);
      const next = await resumeAndClaim(x, id);
      expect(x.body(next).grant.work).toEqual(parked.work);
    } finally { await driver.stop(); await x.h.dispose(); }
  });

  it("finite-legacy without enough group reserve: refused with the shortfall and no business writes", async () => {
    const { x, driver, id } = await stopped(undefined, 1_000_000); try {
      // Room for the 3,300,000 charge plus all but 300,000 of the 3,300,000 parked again for the continuation.
      const g = group(x);
      const twice = { tokens: 6600000 - 300000, activeMs: 2 * (14400000 + 1800000), attempts: 6, sessions: 6 } as Record<string, number>;
      const limit = Object.fromEntries(Object.keys(twice).map(d => [d, g.used[d] + g.reserved[d] + twice[d]]));
      expect(x.service.setLimit(x.h.command("set-limit", { limit: limit as any }))).not.toHaveProperty("error");
      const before = business(x);
      expect((await settle(x, id, "charge-remaining-grant")).error.message).toBe("group-reserve-insufficient:tokens:300000");
      expect(business(x)).toEqual(before);
    } finally { await driver.stop(); await x.h.dispose(); }
  });
});

describe("handoff-stopped run: continuation headroom", { timeout: 60_000 }, () => {
  it("optional-v1: without non-token headroom for the continuation the claim is held, not funded", async () => {
    const { x, driver, id } = await stopped("optional-v1", null); try {
      expect((await settle(x, id, "release-unmetered")).error).toBeUndefined();
      expect(await x.service.resumeFromHandoff(x.h.command("resume-from-handoff", { selections: [{ taskId: "a", predecessorRunId: id, checkpointId: x.body(id).checkpointId }] }))).not.toHaveProperty("error");
      expect(await deliverScheduledStart(x.dispatch, "g")).toEqual({ kind: "blocked", reason: "funded-allowance-unavailable" });
    } finally { await driver.stop(); await x.h.dispose(); }
  });
});

describe("recovered marker schema", () => {
  const base = { method: "remaining-grant", commandId: "c", principal: "user:owner", at: 1, groupId: "g", taskId: "a", workItemId: "a", runId: "r", generation: 1, highWater: 1,
    charged: { work: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 }, handoff: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 } },
    report: { artifactId: "x", hash: "a".repeat(64) }, stopProof: { executionId: "e", generation: 1, isolated: true, source: { artifactId: "y", hash: "b".repeat(64) } } };
  const resolution = { requestId: "q", previousState: "settled-unrecoverable", previousFailureCode: "usage-unsettled", checkpointId: "k", checkpointHash: "c".repeat(64) };
  it("requires the handoff resolution exactly for released and recovered", () => {
    expect(usageSettlementSchema.safeParse({ ...base, reservationDisposition: "recovered", handoffResolution: resolution }).success).toBe(true);
    expect(usageSettlementSchema.safeParse({ ...base, reservationDisposition: "recovered" }).success).toBe(false);
    expect(usageSettlementSchema.safeParse({ ...base, reservationDisposition: "released", handoffResolution: resolution }).success).toBe(true);
    expect(usageSettlementSchema.safeParse({ ...base, reservationDisposition: "committed", handoffResolution: resolution }).success).toBe(false);
    expect(usageSettlementSchema.safeParse({ ...base, reservationDisposition: "committed" }).success).toBe(true);
  });
});
