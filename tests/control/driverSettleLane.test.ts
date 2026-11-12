import { describe, expect, it } from "vitest";
import { deliverSchedulerWakes } from "../../src/control/dispatch.js";
import { DriverCrash, type ExecutionDriver } from "../../src/control/executionDriver.js";
import { readGroup } from "../../src/control/queries.js";
import { createWebWakeHandlers } from "../../src/control/webDispatch.js";
import { driverHarness } from "./fixtures/driverHarness.js";

// Tester follow-up G Part 6 §6.1 (#192): a landed run's settle (archive, checkpoint, publish, cleanup) runs on a
// serialized lane off the driver round, so later passes claim and advance its dependent meanwhile. `round()` still
// waits for the settles its own pass started; `stop()` waits for every settle in flight.

type Harness = Awaited<ReturnType<typeof driverHarness>>;
const workStatus = (t: Harness, id: string): string => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(id)!.body)).status;
const runOf = (t: Harness, task: string): string | null => {
  const row = t.h.store.db.prepare("SELECT id FROM runs WHERE group_id='g' AND work_item_id=? ORDER BY rowid DESC").get(task);
  return row === undefined ? null : String(row.id);
};

/** Holds `runId`'s settle at the seam until released (or 5 s pass); `fail` makes the held settle throw. */
function holdSettle(t: Harness, runId: string) {
  const hold = { entered: 0, releasedByTimeout: false, fail: null as Error | null, release: () => {}, enteredOnce: null as unknown as Promise<void> };
  let markEntered!: () => void;
  hold.enteredOnce = new Promise<void>((resolve) => { markEntered = resolve; });
  const held = new Promise<void>((resolve) => { hold.release = resolve; });
  const timer = setTimeout(() => { hold.releasedByTimeout = true; hold.release(); }, 5000);
  t.deps.beforeSettle = async (id: string) => {
    if (id !== runId) return;
    hold.entered += 1; markEntered();
    await held; clearTimeout(timer);
    if (hold.fail !== null) throw hold.fail;
  };
  return hold;
}

/**
 * Rounds until the held settle entered its seam; answers the round that started it (still waiting on the settle), boxed so
 * the async function does not adopt (wait for) it.
 */
async function untilEntered(driver: ExecutionDriver, hold: ReturnType<typeof holdSettle>): Promise<{ round: Promise<boolean> }> {
  for (let i = 0; i < 60; i += 1) {
    const round = driver.round();
    const entered = await Promise.race([round.then(() => false), hold.enteredOnce.then(() => true)]);
    if (entered) return { round };
  }
  throw new Error("the settle never reached the lane's seam");
}

async function untilBStarted(t: Harness, driver: ExecutionDriver, start: ReturnType<typeof createWebWakeHandlers>["start"]): Promise<string> {
  for (let i = 0; i < 60; i += 1) {
    await deliverSchedulerWakes(t.h.store, { start });
    await driver.round();
    const b = runOf(t, "b");
    if (b !== null && !["starting", "start-pending", "unknown"].includes(t.body(b).state)) return b;
  }
  throw new Error("b never started");
}

async function untilDone(t: Harness, driver: ExecutionDriver, start: ReturnType<typeof createWebWakeHandlers>["start"], ids: string[]): Promise<void> {
  for (let i = 0; i < 120 && !ids.every((id) => workStatus(t, id) === "done"); i += 1) {
    await deliverSchedulerWakes(t.h.store, { start });
    await driver.round();
  }
}

describe("#192: a landed run settles off the driver round", () => {
  it("the dependent starts while its dependency's settle is held", async () => {
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b", dependsOn: ["a"] }]); try {
      const aRun = await t.claim();
      const hold = holdSettle(t, aRun);
      const driver = t.driver();
      const { start } = createWebWakeHandlers({ ...t.dispatch, service: t.service });
      const { round: first } = await untilEntered(driver, hold);
      await untilBStarted(t, driver, start);
      expect(t.body(aRun).state).toBe("landed");
      expect(hold.releasedByTimeout).toBe(false);
      hold.release();
      await first;
      expect(t.body(aRun).state).toBe("settled");
      await untilDone(t, driver, start, ["a", "b"]);
      expect([workStatus(t, "a"), workStatus(t, "b")]).toEqual(["done", "done"]);
    } finally { await t.h.dispose(); }
  }, 60000);

  it("a settling run is visited by no second pass", async () => {
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b", dependsOn: ["a"] }]); try {
      const aRun = await t.claim();
      const hold = holdSettle(t, aRun);
      const driver = t.driver();
      const { round: first } = await untilEntered(driver, hold);
      for (let i = 0; i < 3; i += 1) await driver.round();
      expect(hold.entered).toBe(1);
      // No pass ran step E beside the lane: the held run is still landed.
      expect(t.body(aRun).state).toBe("landed");
      expect(hold.releasedByTimeout).toBe(false);
      hold.release();
      await first;
      expect(t.body(aRun).state).toBe("settled");
    } finally { await t.h.dispose(); }
  }, 60000);

  it("stop waits for an in-flight settle", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const aRun = await t.claim();
      const hold = holdSettle(t, aRun);
      const driver = t.driver();
      await untilEntered(driver, hold);
      const stopping = driver.stop();
      setTimeout(() => hold.release(), 50);
      await stopping;
      expect(hold.releasedByTimeout).toBe(false);
      expect(t.body(aRun).drive.cleanedUp).toBe(true);
    } finally { await t.h.dispose(); }
  }, 60000);

  it("a dependency whose settle fails after its dependent started blocks only itself", async () => {
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b", dependsOn: ["a"] }]); try {
      const aRun = await t.claim();
      const hold = holdSettle(t, aRun);
      const driver = t.driver();
      const { start } = createWebWakeHandlers({ ...t.dispatch, service: t.service });
      const { round: first } = await untilEntered(driver, hold);
      await untilBStarted(t, driver, start);
      hold.fail = new Error("boom");
      hold.release();
      await first;
      expect(t.body(aRun).state).toBe("blocked");
      expect(t.body(aRun).drive).toMatchObject({ blockedAt: "E", blockedReason: "boom" });
      await untilDone(t, driver, start, ["b"]);
      expect(workStatus(t, "b")).toBe("done");
      expect(workStatus(t, "a")).not.toBe("done");
      expect(readGroup(t.h.store, "g").status).not.toBe("done");
    } finally { await t.h.dispose(); }
  }, 60000);

  it("a settle cut by a crash is finished by the next driver", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const aRun = await t.claim();
      let crashes = 0;
      t.deps.crash = (point) => { if (point === "E-after-acceptance" && crashes === 0) { crashes += 1; throw new DriverCrash(point); } };
      const first = t.driver();
      for (let i = 0; i < 60 && first.crashed === null; i += 1) await first.round();
      expect(first.crashed).toBe("E-after-acceptance");
      expect(t.body(aRun).state).toBe("landed");
      const second = t.driver();
      await t.until(second, () => t.body(aRun).drive?.cleanedUp === true);
      expect(t.body(aRun).state).toBe("settled");
      expect(workStatus(t, "a")).toBe("done");
      expect(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE run_id=?").get(aRun)).toEqual({ n: 1 });
    } finally { await t.h.dispose(); }
  }, 60000);
});
