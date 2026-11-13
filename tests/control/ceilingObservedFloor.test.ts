// Tester follow-up I (G spec §16; human 「Part B 的结算算术 => 按你的建议走」, session d467cbd2): an expectation-model
// run whose work usage is unknown keeps its unused live ceiling held (follow-up H, gap k, ruling R4: the group cap is
// hard). Charging that whole unused part is still what the view offers and what an unattended path would do; but when
// ccloop observed a usage floor, a person or a socket agent may now say explicitly that the floor is the charge
// (`charge-observed-floor`, the finite-group form of #116). The floor is booked and the held ceiling given back in the
// same write. Without a floor the form is refused and the ceiling stays held, so the group cap is never softened.
import { describe, expect, it } from "vitest";
import { renderHelp } from "../../src/commands/help.js";
import { REGISTRY } from "../../src/commands/registry.js";
import { withCommandContext } from "../../src/control/commandClient.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { readGroup } from "../../src/control/queries.js";
import { hasValidUsageSettlement } from "../../src/control/usageSettlement.js";
import { readWebGroup } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { profileSnapshot } from "./fixtures/web.js";

const M = 1_000_000;
const FLOOR = "charge-observed-floor";
type Held = { liveCeilingReserved: number; used: { tokens: number }; reserved: { tokens: number }; limit: { tokens: number } };

/** H9's world: a handoff-stopped expectation-model run whose usage was never reported; `floor` is ccloop's usageLowerBound. */
async function stoppedCeilingRun(floor?: number) {
  const t = await driverHarness([{ taskId: "a" }], { tokenPolicy: "optional-v1", modelVersion: "followup-g", killGraceMs: 0, behaviour: () => "stoppable-usage-unknown" });
  if (floor !== undefined) {
    const collect = t.fake.port.collect;
    t.fake.port.collect = async (envelope, after) => ({ ...(await collect(envelope, after)), usageLowerBound: { tokens: floor } });
    t.deps.router = createExecutionProfileRouter([resolveProfile(profileSnapshot(), t.fake.port)]);
  }
  const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
  const set = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: 10 * M } }));
  if ("error" in set) throw new Error(`set-limit refused: ${JSON.stringify(set)}`);
  const driver = t.driver();
  const id = await t.claim();
  await t.until(driver, () => t.body(id).state === "accepted");
  const outstanding = t.body(id).liveCeiling.tokens - t.body(id).cumulative.work.tokens;
  await t.service.handoffStop(t.h.command("handoff-stop", {}));
  await t.until(driver, () => t.body(id).state === "settled-unrecoverable");
  await driver.round();
  const settle = async (acknowledge?: string) => {
    const payload = { taskId: "a", runId: id, generation: 1, ...(acknowledge === undefined ? {} : { acknowledge }) };
    try {
      const c = t.h.command("settle-unknown-usage" as never, payload as never) as unknown as { commandId: string };
      return await withCommandContext(c.commandId, { client: "web", principal: "user:owner" }, () => (t.service as never as { settleUnknownUsage(c: unknown): Promise<{ error?: { message: string }; result?: unknown }> }).settleUnknownUsage(c));
    } catch (error) { return { thrown: String(error) } as { thrown: string; error?: undefined; result?: undefined }; }
  };
  const group = () => readGroup(t.h.store, "g") as unknown as Held;
  const view = () => readControlGroup(t.h.store, "epoch", "g").runs.find(r => r.runId === id)!.unknownUsageSettlement!;
  const business = () => ["runs", "work_items", "budget_proposals", "usage_ledger", "handoff_requests", "groups"].map(table => t.h.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  return { t, id, driver, outstanding, settle, group, view, business };
}

describe("an expectation-model run's unknown usage may settle at ccloop's observed floor (tester follow-up I)", { timeout: 120_000 }, () => {
  it("I1: with a floor, the explicit form books exactly the floor and frees the held ceiling in the same write", async () => {
    const x = await stoppedCeilingRun(500);
    try {
      const before = x.t.body(x.id), held = x.group();
      expect(before.unknown.work).toBe(true);
      expect(before.remaining.work.tokens).toBeNull();
      expect(x.outstanding).toBeGreaterThan(500);
      expect(held.liveCeilingReserved).toBe(x.outstanding);
      // The default the view offers stays the whole unused ceiling; the floor is offered beside it, never instead of it.
      // mutation: drop the live-ceiling case from settlementPreview's observedFloor condition -> undefined, red
      expect(x.view()).toMatchObject({ acknowledge: "charge-remaining-grant", allowed: true, observedFloor: { tokens: 500, allowed: true, refusalReason: null } });
      // mutation: settlementAdmission keeps refusing the floor form for a null remainder -> unlimited-remainder, red
      const answer = await x.settle(FLOOR);
      expect(answer.error).toBeUndefined();
      expect(answer.result).toMatchObject({ kind: "usage-settled", method: "observed-floor", charged: { work: { tokens: 500, activeMs: 0, attempts: 0, sessions: 0 } } });
      const run = x.t.body(x.id), after = x.group();
      // Exactly the floor is booked: on the run (cumulative B + F) and on the group's used; not the unused ceiling.
      expect(run.cumulative.work.tokens).toBe(before.cumulative.work.tokens + 500);
      expect(after.used.tokens - held.used.tokens).toBe(500);
      expect(run.usageSettlement).toMatchObject({ method: "observed-floor", principal: "user:owner", floorTokens: 500, reservationDisposition: "recovered",
        charged: { work: { tokens: 500, activeMs: 0, attempts: 0, sessions: 0 }, handoff: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 } } });
      expect(run.usageApproximate).toMatchObject({ floorTokens: 500 });
      expect(run.unknown).toEqual({ work: false, handoff: false });
      // The hold is given back in the same write.
      // mutation: drop the syncCeilingReserve after bookObservedFloor -> liveCeilingReserved stays the outstanding, red
      expect(after.liveCeilingReserved).toBe(0);
      // The group cap: used + reserved moves by + floor - held ceiling - the run's handoff remainder (released, as any
      // recovered optional-v1 settlement releases it), and stays under the limit.
      expect(after.used.tokens + after.reserved.tokens).toBe(held.used.tokens + held.reserved.tokens + 500 - x.outstanding - before.remaining.handoff.tokens);
      expect(after.used.tokens + after.reserved.tokens).toBeLessThanOrEqual(after.limit.tokens);
      expect(hasValidUsageSettlement(x.t.h.store, run)).toBe(true);
      expect(x.view().observedFloor).toBeUndefined();
    } finally { await x.driver.stop(); await x.t.h.dispose(); }
  });

  it("I2: the floor is never taken without the explicit form; the remaining-grant charge is unchanged", async () => {
    const x = await stoppedCeilingRun(500);
    try {
      const before = x.business(), held = x.group();
      // No acknowledgement: the command does not parse; nothing written, the ceiling still held.
      expect(await x.settle(undefined)).not.toMatchObject({ result: expect.anything() });
      // Another driver round (the unattended path) does not settle it either.
      await x.driver.round();
      expect(x.t.body(x.id).usageSettlement).toBeUndefined();
      expect(x.business()).toEqual(before);
      // charge-remaining-grant still charges the whole unused ceiling (follow-up H, H9), even with a floor known.
      expect((await x.settle("charge-remaining-grant")).error).toBeUndefined();
      const after = x.group();
      expect(x.t.body(x.id).usageSettlement).toMatchObject({ method: "remaining-grant", charged: { work: { tokens: x.outstanding } } });
      expect(after.liveCeilingReserved).toBe(0);
      expect(after.used.tokens + after.reserved.tokens).toBe(held.used.tokens + held.reserved.tokens);
    } finally { await x.driver.stop(); await x.t.h.dispose(); }
  });

  it("I3: without a floor the form is refused observed-floor-unknown and the unused ceiling stays held", async () => {
    const x = await stoppedCeilingRun();
    try {
      expect(x.view().observedFloor).toBeUndefined();
      const before = x.business();
      // mutation: drop the floor check in settlementAdmission -> books 0 approximate and frees the ceiling, red
      expect((await x.settle(FLOOR)).error?.message).toBe("run-usage-not-settleable:observed-floor-unknown");
      expect(x.business()).toEqual(before);
      expect(x.group().liveCeilingReserved).toBe(x.outstanding);
    } finally { await x.driver.stop(); await x.t.h.dispose(); }
  });

  it("I4: the CLI names the live-ceiling case and, on observed-floor-unknown, points to charge-remaining-grant", () => {
    expect(renderHelp(["task", "settle-usage"])).toContain("a live ceiling, with a known floor");
    const def = REGISTRY.find((d) => d.domain === "task" && d.action === "settle-usage")!;
    // mutation: drop the observed-floor-unknown hint -> undefined, red
    expect(def.hint?.({ code: "run-usage-not-settleable", message: "run-usage-not-settleable:observed-floor-unknown" })).toContain("--acknowledge charge-remaining-grant");
    expect(def.hint?.({ code: "run-usage-not-settleable", message: "run-usage-not-settleable:finite-remainder" })).toBeUndefined();
  });
});
