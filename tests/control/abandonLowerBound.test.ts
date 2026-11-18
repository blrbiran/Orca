import { describe, expect, it } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { readBudgetProposal, readGroup, readWork } from "../../src/control/queries.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { pass, since } from "./fixtures/softLoop.js";
import { profileSnapshot } from "./fixtures/web.js";

/**
 * Tester #369 (b) (plan 2026-11-18 tester batch D, D4; triage g2 #369): a person abandoned a running attempt; ccloop
 * stopped it with its usage unknown, so it was blocked at C (`usage-unknown`) as every failed run with unknown usage is.
 * Orca's lower-bound settle then booked its floor -- and the run went on as a plain failed run: no `operatorSettlement`,
 * its task `running`, open to the ladder's retry. The person's "abandon" was lost. Now the same settle that books the floor
 * settles it abandoned, as an abandoned run with known usage is settled at its terminal. The floor booking is unchanged.
 */

const OWNER = { client: "web", principal: "user:owner" };
const NOTE = "the provider dropped the model";
const FLOOR = 500;

async function abandonedUnknown() {
  const knobs = { stopped: false };
  const t = await driverHarness([{ taskId: "a" }], { tokenPolicy: "optional-v1", modelVersion: "followup-g", sealedOwnerProof: true,
    behaviour: () => (knobs.stopped ? "failed-usage-unknown" : "stoppable-silent"), stopReason: () => (knobs.stopped ? "omp-exit-error" : null) });
  // ccloop's lower bound for the call whose usage it could not read (an omp run's shape).
  const collect = t.fake.port.collect;
  t.fake.port.collect = async (envelope, after) => { const report = await collect(envelope, after); return report.terminal ? { ...report, usageLowerBound: { tokens: FLOOR } } : report; };
  t.deps.router = createExecutionProfileRouter([resolveProfile(profileSnapshot(), t.fake.port)]);
  const runId = await t.claim();
  const driver = t.driver();
  await t.until(driver, () => t.body(runId).state === "accepted");
  const command = t.h.command("abandon-run", { runId, note: NOTE });
  expect(withCommandContext(command.commandId, OWNER, () => t.service.abandonRun(command as never))).not.toHaveProperty("error");
  knobs.stopped = true;
  await t.until(driver, () => t.body(runId).state === "blocked");
  expect([t.body(runId).drive.blockedReason, t.body(runId).unknown.work]).toEqual(["usage-unknown", true]);
  return { t, driver, runId };
}

describe("an abandoned run settled at its lower bound stays abandoned (#369 b)", { timeout: 120_000 }, () => {
  it("Orca's lower-bound settle books the floor as before and settles the run abandoned", async () => {
    const { t, driver, runId } = await abandonedUnknown();
    try {
      const usedBefore = readGroup(t.h.store, "g").used.tokens;
      since(t);
      expect(pass(t)).toBe(true);
      const run = t.body(runId);
      // The booking: the floor once, on the run and on the group -- the lower-bound settle's arithmetic, untouched.
      expect(run.usageSettlement).toMatchObject({ method: "approximate-floor", floorTokens: FLOOR, charged: { work: { tokens: FLOOR } } });
      expect(run.cumulative.work.tokens).toBe(FLOOR);
      expect(readGroup(t.h.store, "g").used.tokens).toBe(usedBefore + FLOOR);
      // mutation: drop the abandoned settle after the floor -> blocked, no operatorSettlement, task running; red here.
      expect(run.operatorSettlement).toEqual({ kind: "abandoned", by: "user:owner", note: NOTE, at: run.abandon.at });
      expect([run.state, run.failureCode, run.drive.blockedReason, readWork(t.h.store, "g", "a").status]).toEqual(["settled-failed", "run-abandoned", "run-abandoned", "blocked"]);
      // Abandoned as any: its allocations terminal (what task retry's abandoned branch reads), nothing dispatched until a person acts.
      expect(readBudgetProposal(t.h.store, "g").allocations.filter((a) => a.ownerKind === "task" && a.ownerId === "a").map((a) => a.state)).toEqual(["terminal", "terminal"]);
      for (let i = 0; i < 5; i += 1) await driver.round();
      expect(Number(t.h.store.db.prepare("SELECT count(*) AS n FROM runs WHERE group_id='g' AND work_item_id='a'").get()!.n)).toBe(1);
      expect(t.service.retryTask(t.h.command("retry-task", { taskId: "a", runId }))).toMatchObject({ result: { kind: "task-retried" } });
    } finally { await t.h.dispose(); }
  });
});
