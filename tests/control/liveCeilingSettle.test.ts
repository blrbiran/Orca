// Tester follow-up G spec §2.1 / §2.5 / §10.3 (plan Part B, O4, review focus 2 and 5): what a run ccloop stopped at its live
// ceiling becomes. At the group cap it keeps its work and continues at once while the group has room (1M or more), else
// waits for a top-up, which continues it; at its pause line it waits for a decision; at a person's hard cap it ends
// exhausted as today. A lowered limit never lowers a running ceiling: the next claim is refused instead.
import { describe, expect, it } from "vitest";
import { readGroupActivity } from "../../src/control/activity.js";
import { readStartEnvelope } from "../../src/control/executionDriver.js";
import { readGroup, readWork } from "../../src/control/queries.js";
import { readWebGroup } from "../../src/control/webService.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import type { StartEnvelope } from "../../src/control/executionPort.js";
import { driverHarness } from "./fixtures/driverHarness.js";

type Harness = Awaited<ReturnType<typeof driverHarness>>;
const M = 1_000_000;

interface Knobs { exhausted: boolean; workTokens: number; cause: "group" | "pause-line" | "task-cap"; only?: string }
async function harness(tasks: string[], limit: number, knobs: Knobs): Promise<Harness> {
  const t = await driverHarness(tasks.map(taskId => ({ taskId })), {
    tokenPolicy: "optional-v1", modelVersion: "followup-g",
    behaviour: (id: string) => knobs.exhausted && (knobs.only === undefined || knobs.only === id) ? "exhausted" : "stoppable",
    workTokens: () => knobs.workTokens,
    liveCeilingStop: (id: string, envelope: StartEnvelope) => knobs.exhausted && (knobs.only === undefined || knobs.only === id) && envelope.liveCeiling !== undefined
      ? { revision: envelope.liveCeiling.revision, tokens: envelope.liveCeiling.tokens, cause: knobs.cause, observedTokens: knobs.workTokens, phase: "execute" as const, at: "mid-call" as const }
      : undefined,
    stopReason: () => knobs.exhausted ? "live token ceiling reached" : null,
  });
  setLimit(t, limit);
  return t;
}
function setLimit(t: Harness, tokens: number): unknown {
  const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
  return t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens } }));
}
const setIntent = (t: Harness, taskId: string, intent: unknown) => {
  const work = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body));
  work.tokenIntent = intent;
  t.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id=?").run(JSON.stringify(work), taskId);
};
const work = (t: Harness, taskId = "a") => readWork(t.h.store, "g", taskId) as unknown as Record<string, unknown> & { status: string };
const kinds = (t: Harness, kind: string) => readGroupActivity(t.h.store, "g", 50).filter(entry => entry.kind === kind);
async function settled(t: Harness, driver: ReturnType<Harness["driver"]>, runId: string, state: string): Promise<void> {
  await t.until(driver, () => t.body(runId).state === state, 200);
}
async function nextRun(t: Harness, driver: ReturnType<Harness["driver"]>): Promise<string> {
  await driver.round();
  const delivered = await deliverScheduledStart(t.dispatch, "g");
  if (delivered.kind !== "claimed") throw new Error(`no claim: ${JSON.stringify(delivered)}`);
  return delivered.runId;
}

describe("a run stopped at its live ceiling (spec §2.1, §2.5)", { timeout: 300_000 }, () => {
  it("a group stop with room left continues the task with its work", async () => {
    const knobs: Knobs = { exhausted: true, workTokens: 2 * M, cause: "group" };
    const t = await harness(["a"], 20 * M, knobs);
    try {
      const driver = t.driver();
      const first = await t.claim();
      await settled(t, driver, first, "settled-recoverable");
      expect(t.body(first).liveCeilingStop).toMatchObject({ cause: "group", observedTokens: 2 * M });
      expect(work(t)).toMatchObject({ status: "ready", allowancePredecessorRunId: first });
      expect(work(t)).not.toHaveProperty("groupCapStop");
      expect(kinds(t, "group-cap-reached").map(entry => entry.body)).toEqual([expect.objectContaining({ autoContinued: true, observedTokens: 2 * M })]);
      knobs.exhausted = false;
      const second = await nextRun(t, driver);
      for (let i = 0; i < 400 && t.body(second).drive?.prepared !== true; i++) await driver.round();
      // It continues from the stopped run's checkpoint, with a fresh ceiling.
      expect(readStartEnvelope(t.h.store, t.body(second)).inputCheckpoint).not.toBeNull();
      expect(t.body(second).liveCeiling).toMatchObject({ cause: "group" });
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("a group stop without room waits as group-cap-reached, and a top-up continues it", async () => {
    const knobs: Knobs = { exhausted: true, workTokens: 0, cause: "group" };
    const t = await harness(["a"], 3 * M, knobs);
    try {
      const driver = t.driver();
      const first = await t.claim();
      knobs.workTokens = t.body(first).liveCeiling.tokens - 100_000;
      await settled(t, driver, first, "settled-recoverable");
      expect(work(t)).toMatchObject({ status: "blocked", groupCapStop: { runId: first, observedTokens: knobs.workTokens } });
      expect(kinds(t, "group-cap-reached").map(entry => entry.body)).toEqual([expect.objectContaining({ autoContinued: false })]);
      // Nothing is claimed while it waits.
      await driver.round();
      expect((await deliverScheduledStart(t.dispatch, "g")).kind).not.toBe("claimed");
      expect(setLimit(t, 13 * M)).toMatchObject({ result: { kind: "limit-set" } });
      expect(work(t).status).toBe("ready");
      expect(work(t)).not.toHaveProperty("groupCapStop");
      knobs.exhausted = false;
      const second = await nextRun(t, driver);
      expect(t.body(second).liveCeiling.tokens).toBeGreaterThan(9 * M);
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("a stop that passed the cap by its last request can still be topped up", async () => {
    const knobs: Knobs = { exhausted: true, workTokens: 0, cause: "group" };
    const t = await harness(["a"], 3 * M, knobs);
    try {
      const driver = t.driver();
      const first = await t.claim();
      // ccloop stops mid-call: the request in flight is booked past the ceiling, and past the group limit.
      knobs.workTokens = t.body(first).liveCeiling.tokens + 400_000;
      await settled(t, driver, first, "settled-recoverable");
      const g = readGroup(t.h.store, "g");
      expect(g.used.tokens + g.reserved.tokens).toBeGreaterThan(3 * M);
      expect(setLimit(t, 13 * M)).toMatchObject({ result: { kind: "limit-set" } });
      expect(work(t).status).toBe("ready");
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("a top-up continues a group-cap-stopped task while another runs, and the group holds no more than its limit", async () => {
    const knobs: Knobs = { exhausted: true, workTokens: 0, cause: "group", only: "a" };
    const t = await harness(["a", "b"], 4 * M, knobs);
    try {
      const driver = t.driver();
      const runA = await t.claim();
      const runB = await t.claim();
      // a stops at the cap with no room left; b keeps running.
      knobs.workTokens = t.body(runA).liveCeiling.tokens;
      await settled(t, driver, runA, "settled-recoverable");
      const before = t.body(runB).liveCeiling;
      expect(work(t, "a").status).toBe("blocked");
      expect(setLimit(t, 14 * M)).toMatchObject({ result: { kind: "limit-set" } });
      expect(work(t, "a").status).toBe("ready");
      knobs.exhausted = false;
      // The waiting task is claimed first (its claim takes the headroom); it continues from its stopped run.
      const again = await nextRun(t, driver);
      for (let i = 0; i < 400 && t.body(again).drive?.prepared !== true; i++) await driver.round();
      expect(readStartEnvelope(t.h.store, t.body(again)).inputCheckpoint).not.toBeNull();
      expect(t.body(runB).state).toBe("accepted");
      expect(t.body(runB).liveCeiling.tokens).toBeGreaterThanOrEqual(before.tokens);
      const g = readGroup(t.h.store, "g");
      expect(g.used.tokens + g.reserved.tokens).toBeLessThanOrEqual(14 * M);
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("a lowered limit leaves running ceilings unchanged and the next claim is refused group-budget-unavailable", async () => {
    const knobs: Knobs = { exhausted: false, workTokens: 10, cause: "group" };
    const t = await harness(["a", "b"], 20 * M, knobs);
    try {
      const runA = await t.claim();
      const ceiling = t.body(runA).liveCeiling;
      const g = readGroup(t.h.store, "g");
      expect(setLimit(t, g.used.tokens + g.reserved.tokens)).toMatchObject({ result: { kind: "limit-set" } });
      expect(t.body(runA).liveCeiling).toEqual(ceiling);
      const driver = t.driver();
      await driver.round();
      expect(t.body(runA).liveCeiling).toEqual(ceiling);
      expect(await deliverScheduledStart(t.dispatch, "g")).toMatchObject({ reason: "group-budget-unavailable" });
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("a pause-line stop waits for a decision, with the ratio to its expectation", async () => {
    const knobs: Knobs = { exhausted: true, workTokens: 10_400_000, cause: "pause-line" };
    const t = await harness(["a"], 100 * M, knobs);
    try {
      setIntent(t, "a", { tokens: M, hard: false, provenance: "human", estimateId: null });
      const driver = t.driver();
      const first = await t.claim();
      expect(t.body(first).liveCeiling).toMatchObject({ tokens: 10 * M, cause: "pause-line" });
      await settled(t, driver, first, "settled-recoverable");
      expect(work(t)).toMatchObject({ status: "blocked", usagePause: { multiple: 1, line: 10 * M, usedTokens: 10_400_000, expectationTokens: M, runId: first } });
      expect(kinds(t, "usage-paused").map(entry => entry.body)).toEqual([expect.objectContaining({ ratio: 10.4, usedTokens: 10_400_000, expectationTokens: M })]);
      expect(kinds(t, "group-cap-reached")).toEqual([]);
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("a task-cap stop ends exhausted as today: no pause, no group-cap wait, no new activity", async () => {
    const knobs: Knobs = { exhausted: true, workTokens: 400_000, cause: "task-cap" };
    const t = await harness(["a"], 20 * M, knobs);
    try {
      setIntent(t, "a", { tokens: 400_000, hard: true, provenance: "human", estimateId: null });
      const driver = t.driver();
      const first = await t.claim();
      expect(t.body(first).liveCeiling).toMatchObject({ tokens: 400_000, cause: "task-cap" });
      await settled(t, driver, first, "blocked");
      expect(t.body(first).drive.blockedReason).toBe("terminal:exhausted");
      expect(work(t)).not.toHaveProperty("usagePause");
      expect(work(t)).not.toHaveProperty("groupCapStop");
      expect([...kinds(t, "usage-paused"), ...kinds(t, "group-cap-reached")]).toEqual([]);
      await driver.stop();
    } finally { await t.h.dispose(); }
  });
});
