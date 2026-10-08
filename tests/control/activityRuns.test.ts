import { describe, expect, it } from "vitest";
import { readRunActivity } from "../../src/control/activity.js";
import { settleProviderAttempt, deliverScheduledStart, beginProviderAttempt } from "../../src/control/webDispatch.js";
import { settleHandoffRequest } from "../../src/control/stopIntent.js";
import { WebControlService } from "../../src/control/webService.js";
import { blockRun, LATER_ERROR } from "../../src/control/executionDriver.js";
import type { ControlStore } from "../../src/control/store.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { webFixture } from "./fixtures/web.js";

// Issue-fixes spec §5.2, §5.3: a run's activity rows and wall-clock times, each written in the transaction of the change
// that causes it and stamped by the injected store clock.
type Clock = { value: number };
async function claimedSoft(clock: Clock) {
  const h = await webFixture(undefined, undefined, { storeNow: () => clock.value });
  const service = new WebControlService(h.deps);
  await service.confirm(h.command("confirm", { ...(await h.confirmPayload()), budgetMode: "soft" }));
  await service.start(h.command("start", {}));
  const claim = await deliverScheduledStart({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate }, "g");
  if (claim.kind !== "claimed") throw new Error(`claim refused: ${JSON.stringify(claim)}`);
  return { h, service, runId: claim.runId };
}
const runBody = (store: ControlStore, runId: string) =>
  JSON.parse(String(store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body));
const rowsOf = (store: ControlStore, runId: string, kind: string) =>
  readRunActivity(store, runId, 1_000).filter((entry) => entry.kind === kind).reverse().map((entry) => [entry.at, entry.body]);

describe("run-settled and endedAt (issue-fixes spec §5.2)", () => {
  it("a driver run gets endedAt when it lands, kept through settle, and a run-settled row for each of landed and settled", async () => {
    let clock = 1_000;
    const t = await driverHarness([{ taskId: "a" }], { storeNow: () => clock }); try {
      const runId = await t.claim();
      const driver = t.driver();
      clock = 2_000;
      await t.until(driver, () => t.body(runId).state === "landed");
      expect(t.body(runId).endedAt).toBe(2_000);
      clock = 3_000;
      await t.until(driver, () => t.body(runId).drive?.cleanedUp === true);
      expect(t.body(runId)).toMatchObject({ state: "settled", endedAt: 2_000 });
      expect(rowsOf(t.h.store, runId, "run-settled")).toEqual([
        [2_000, { state: "landed", outcome: "succeeded" }],
        [3_000, { state: "settled", outcome: "succeeded" }],
      ]);
    } finally { await t.h.dispose(); }
  });

  it("a first attempt proved never started settles failed-before-provider with endedAt and its row (saveDispatchRun)", async () => {
    const clock = { value: 1_000 };
    const { h, runId } = await claimedSoft(clock); try {
      clock.value = 4_000;
      await settleProviderAttempt({ store: h.store, profileRouter: h.deps.profileRouter }, { runId, phase: "work", firstAttemptProof: "invalid" });
      expect(runBody(h.store, runId)).toMatchObject({ state: "failed-before-provider", endedAt: 4_000 });
      expect(rowsOf(h.store, runId, "run-settled")).toEqual([[4_000, { state: "failed-before-provider", outcome: null }]]);
    } finally { await h.dispose(); }
  });

  it("a handoff-stopped run settled unrecoverable gets endedAt and its row (saveRunBody)", async () => {
    const clock = { value: 1_000 };
    const { h, service, runId } = await claimedSoft(clock); try {
      await service.handoffStop(h.command("handoff-stop", {}));
      const requestId = String(h.store.db.prepare("SELECT id FROM handoff_requests WHERE run_id=?").get(runId)!.id);
      clock.value = 5_000;
      settleHandoffRequest({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate }, { requestId, outcome: "settled-unrecoverable", reasonCode: "profile-changed" });
      expect(runBody(h.store, runId)).toMatchObject({ state: "settled-unrecoverable", endedAt: 5_000 });
      expect(rowsOf(h.store, runId, "run-settled")).toEqual([[5_000, { state: "settled-unrecoverable", outcome: null }]]);
    } finally { await h.dispose(); }
  });
});

describe("run-blocked (issue-fixes spec §5.2)", () => {
  it("a run entering blocked writes one row with the step and reason, and no second row while it stays blocked", async () => {
    let clock = 1_000;
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "exhausted", storeNow: () => clock }); try {
      const runId = await t.claim();
      const driver = t.driver();
      clock = 6_000;
      await t.until(driver, () => t.body(runId).state === "blocked");
      expect(rowsOf(t.h.store, runId, "run-blocked")).toEqual([[6_000, { blockedAt: "C", reason: "terminal:exhausted" }]]);
      expect(t.body(runId).endedAt).toBeUndefined();
      // A later error on a blocked run re-blocks it where it was (the driver's catch path, executionDriver.ts): the body
      // changes, the state does not, so no second row. Driver rounds alone never touch a blocked run.
      blockRun(t.deps, runId, "C", `terminal:exhausted${LATER_ERROR}later`);
      expect(t.body(runId).drive.blockedReason).toBe(`terminal:exhausted${LATER_ERROR}later`);
      expect(rowsOf(t.h.store, runId, "run-blocked")).toHaveLength(1);
    } finally { await t.h.dispose(); }
  });
});

describe("run-claimed, run-started and startedAt (issue-fixes spec §5.2)", () => {
  it("a claim writes run-claimed with its claim ordinal; the run has no startedAt yet", async () => {
    const clock = { value: 1_000 };
    const { h, runId } = await claimedSoft(clock); try {
      expect(readRunActivity(h.store, runId, 10).map((entry) => [entry.kind, entry.at, entry.taskId, entry.body])).toEqual([["run-claimed", 1_000, "a", { claimOrdinal: 1 }]]);
      expect(runBody(h.store, runId).startedAt).toBeUndefined();
    } finally { await h.dispose(); }
  });

  it("each reserved attempt writes run-started; startedAt is the first reservation's time and never moves", async () => {
    const clock = { value: 1_000 };
    const { h, runId } = await claimedSoft(clock); try {
      const deps = { store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate };
      clock.value = 2_000;
      beginProviderAttempt(deps, runId, "work");
      clock.value = 3_000;
      beginProviderAttempt(deps, runId, "work");
      expect(runBody(h.store, runId).startedAt).toBe(2_000);
      expect(rowsOf(h.store, runId, "run-started")).toEqual([[2_000, { providerAttemptOrdinal: 1 }], [3_000, { providerAttemptOrdinal: 2 }]]);
    } finally { await h.dispose(); }
  });

  it("the driver's A1 sets startedAt with the store clock", async () => {
    let clock = 1_000;
    const t = await driverHarness([{ taskId: "a" }], { storeNow: () => clock }); try {
      const runId = await t.claim();
      clock = 7_000;
      await t.until(t.driver(), () => t.body(runId).state !== "starting");
      expect(t.body(runId).startedAt).toBe(7_000);
      expect(rowsOf(t.h.store, runId, "run-started")).toEqual([[7_000, { providerAttemptOrdinal: 1 }]]);
    } finally { await t.h.dispose(); }
  });
});
