import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readStartEnvelope, stepA1, stepA2 } from "../../src/control/executionDriver.js";
import { runningGroupIds } from "../../src/control/orchestration.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { active, committedAndUsed, work } from "./fixtures/handoffHarness.js";
import type { FakeBehaviour } from "./fixtures/driverPort.js";

describe("a terminal blocked run waiting for an explicit remedy (#172)", { timeout: 60_000 }, () => {
  it("does not hold a group slot or create a consumed idle wake when its pause is lifted", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["a"] }], { behaviour: () => "exhausted" });
    try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(t.h.store.db.prepare("SELECT active FROM runs WHERE id=?").get(runId)?.active).toBe(1);
      expect(runningGroupIds(t.h.store)).not.toContain("g");
      expect(await t.service.pauseDispatch(t.h.command("pause-dispatch", {}))).not.toHaveProperty("error");
      expect(await t.service.resumeDispatch(t.h.command("resume-dispatch", {}))).toMatchObject({ result: { kind: "resumed", operation: "resume-dispatch", waitingOn: "blocked-task" } });
      expect(t.h.store.db.prepare("SELECT id FROM scheduler_wakes WHERE group_id='g' AND delivered=0 AND kind IN ('start','no-start','resume')").all()).toEqual([]);
      expect(runningGroupIds(t.h.store)).not.toContain("g");
    } finally { await t.h.dispose(); }
  });

  it("still counts a starting work run as executing", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["a"] }]);
    try {
      await t.claim();
      expect(runningGroupIds(t.h.store)).toContain("g");
    } finally { await t.h.dispose(); }
  });

  it("retires an earlier undelivered start wake when the live run later becomes blocked", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["a"] }], { behaviour: () => "exhausted" });
    try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(await t.service.pauseDispatch(t.h.command("pause-dispatch", {}))).not.toHaveProperty("error");
      // Pause keeps an already armed start wake. Reopen the historical wake to model a prior resume's pending delivery.
      t.h.store.db.prepare("UPDATE scheduler_wakes SET delivered=0 WHERE id=(SELECT id FROM scheduler_wakes WHERE group_id='g' AND kind='start' ORDER BY rowid DESC LIMIT 1)").run();
      const pending = () => t.h.store.db.prepare("SELECT id FROM scheduler_wakes WHERE group_id='g' AND delivered=0 AND kind IN ('start','no-start','resume')").all();
      expect(pending().length).toBeGreaterThan(0);
      expect(await t.service.resumeDispatch(t.h.command("resume-dispatch", {}))).toMatchObject({ result: { kind: "resumed", waitingOn: "blocked-task" } });
      expect(pending()).toEqual([]);
      expect(runningGroupIds(t.h.store)).not.toContain("g");
    } finally { await t.h.dispose(); }
  });
});

/**
 * Stuck-runs spec 2026-11-17 S1 (#343 supplement, #344 item 3): a pause held a run at A1 (`starting`) or B (`start-pending`)
 * for ever -- active=1, no provider call, groupComplete false, so integration never ran. A run that never reached the
 * provider is now settled as a handoff stop settles one; a run ccloop holds (or may hold) is still left to finish.
 */
describe("a pause settles the runs that never reached the provider (#343, #344)", { timeout: 60_000 }, () => {
  const pause = async (t: Awaited<ReturnType<typeof driverHarness>>) =>
    expect(await t.service.pauseDispatch(t.h.command("pause-dispatch", {}))).not.toHaveProperty("error");
  const activeRuns = (t: Awaited<ReturnType<typeof driverHarness>>) => t.h.store.db.prepare("SELECT id FROM runs WHERE group_id='g' AND active=1").all();
  /** A run prepared at A2 and held at B: its envelope and workspace exist, ccloop was never asked. */
  const prepared = async (t: Awaited<ReturnType<typeof driverHarness>>): Promise<string> => {
    const runId = await t.claim();
    expect(stepA1(t.deps, runId)).toBe(true);
    expect(await stepA2(t.deps, runId)).toBe(true);
    expect(t.body(runId)).toMatchObject({ state: "start-pending", drive: { prepared: true } });
    return runId;
  };

  it("settles a prepared start-pending run restartable, frees the group, and resume claims a new run that finishes", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["a"] }]);
    try {
      const runId = await prepared(t);
      const workspace = t.body(runId).drive.workspacePath as string;
      expect(existsSync(workspace)).toBe(true);
      await pause(t);
      // Nothing is booked or given back beyond what a handoff's restart does: the task's commitment is kept for its next claim.
      const ledger = committedAndUsed(t);
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "settled-restartable");
      expect(active(t, runId)).toBe(0);
      expect(activeRuns(t)).toEqual([]);
      expect(work(t, "a").status).toBe("ready");
      expect(t.body(runId).drive).toMatchObject({ cleanedUp: true, cleanupError: null });
      expect(existsSync(workspace)).toBe(false);
      // ccloop was asked whether the envelope reached it (spec §11 C4) and was never sent it.
      expect(t.fake.calls.inspect).toBeGreaterThan(0);
      expect(t.fake.calls.accept.filter((e) => e.claim.runId === runId)).toEqual([]);
      expect(committedAndUsed(t)).toEqual(ledger);
      expect(await t.service.resumeDispatch(t.h.command("resume-dispatch", {}))).toMatchObject({ result: { kind: "scheduled" } });
      const delivered = await deliverScheduledStart(t.dispatch, "g");
      if (delivered.kind !== "claimed") throw new Error(JSON.stringify(delivered));
      expect(delivered.runId).not.toBe(runId);
      await t.until(driver, () => work(t, "a").status === "done");
      expect(t.body(runId).state).toBe("settled-restartable");
    } finally { await t.h.dispose(); }
  });

  it("settles a starting run before it reserves a provider attempt", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["a"] }]);
    try {
      const runId = await t.claim();
      expect(t.body(runId).state).toBe("starting");
      await pause(t);
      await t.until(t.driver(), () => t.body(runId).state === "settled-restartable");
      expect(active(t, runId)).toBe(0);
      expect(work(t, "a").status).toBe("ready");
      expect(t.body(runId).providerAttemptOrdinal).toBe(0);
      expect(t.fake.calls.inspect).toBe(0);
    } finally { await t.h.dispose(); }
  });

  it("leaves a running run and a run whose accept is in doubt where they are", async () => {
    const behaviour = (id: string): FakeBehaviour => id === "b" ? "unknown" : "stoppable";
    const t = await driverHarness([{ taskId: "a", targetPaths: ["a"] }, { taskId: "b", targetPaths: ["b"] }], { behaviour });
    try {
      const running = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(running).state === "accepted");
      const doubtful = await prepared(t);
      await pause(t);
      for (let i = 0; i < 4; i += 1) await driver.round();
      expect(t.body(running).state).toBe("accepted");
      expect(active(t, running)).toBe(1);
      // inspect answers unknown for b: it may have started, so it is not settled.
      expect(t.body(doubtful).state).toBe("start-pending");
      expect(active(t, doubtful)).toBe(1);
    } finally { await t.h.dispose(); }
  });

  it("records an execution ccloop already holds instead of settling its run", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["a"] }]);
    try {
      const runId = await prepared(t);
      // The driver died after ccloop accepted the envelope and before B recorded it.
      await t.fake.port.accept(readStartEnvelope(t.h.store, t.body(runId)));
      await pause(t);
      await t.driver().round();
      expect(t.body(runId)).toMatchObject({ state: "accepted", executionId: `execution-${runId}` });
      expect(active(t, runId)).toBe(1);
    } finally { await t.h.dispose(); }
  });
});
