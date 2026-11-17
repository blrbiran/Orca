import { describe, expect, it } from "vitest";
import { replenishStartWakes } from "../../src/control/executionDriver.js";
import { escalationsOf, readSystemDebugMark, systemDebugGroupId } from "../../src/control/systemDebug.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { readWebGroup, WebControlService } from "../../src/control/webService.js";
import { readGroupSummary } from "../../src/panel/controlViews.js";
import { needsAttention } from "../../web/src/groupCategory.js";
import type { GroupSummaryV1 } from "../../web/src/controlTypes.js";
import { driverHarness } from "./fixtures/driverHarness.js";

/**
 * Tester #332: a ladder's debug run landed, and the ladder then sat `ready` with its task `running` and
 * `systemDebug.settled` null while the original task stayed locked (`debug-in-progress`). Two causes, both by code:
 * - the fold is the pump's (systemDebugPass), but the settle that makes it possible (step E, which marks the task done)
 *   is the driver's, and it told the pump nothing -- the fold waited for whatever pump pass came next;
 * - a debug run that ended without failing but could not complete its task (a settle that failed, a partial or empty
 *   result) was neither done nor failed, so no pass ever settled the ladder, and nothing said it was stuck.
 * Driven through the driver's synthetic ccloop over a real repository; every assertion reads the store.
 */
const LADDER = systemDebugGroupId({ kind: "ladder", groupId: "g", taskId: "a", runId: null });

type Mode = "succeed" | "partial" | "settle-throws";

async function ladderWorld(mode: Mode) {
  const t = await driverHarness([{ taskId: "a" }], {
    behaviour: (id) => id === "a" ? "failed" : "succeed",
    ...(mode === "partial" ? { candidateMissing: (id: string) => id === "debug" ? ["evidence/lost"] : [] } : {}),
  });
  const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
  const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, attempts: limit.attempts + 10, sessions: limit.sessions + 10 } }));
  if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
  const service = new WebControlService({ ...t.h.deps, knownRepository: (repoId: string) => repoId === "repo", resolveRepository: () => t.repo });
  const driver = t.driver();
  const first = await t.claim();
  await t.until(driver, () => t.body(first).state === "blocked");
  expect((await service.systemDebugPass()).redispatched).toEqual(["g:a"]);
  replenishStartWakes({ store: t.h.store, admissionGate: t.h.deps.admissionGate });
  const levelOne = await deliverScheduledStart(t.dispatch, "g");
  if (levelOne.kind !== "claimed") throw new Error(`level-1 claim refused: ${JSON.stringify(levelOne)}`);
  await t.until(driver, () => t.body(levelOne.runId).state === "blocked", 120);
  expect((await service.systemDebugPass()).confirmed).toEqual([LADDER]);
  expect((await service.autoStart()).started).toContain(LADDER);
  const debug = await deliverScheduledStart(t.dispatch, LADDER);
  if (debug.kind !== "claimed") throw new Error(`debug claim refused: ${JSON.stringify(debug)}`);
  const ladderBody = () => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(LADDER)!.body)) as Record<string, unknown>;
  const work = (groupId: string, taskId: string) => (JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(groupId, taskId)!.body)) as { status: string }).status;
  return {
    t, service, driver, failedRunId: levelOne.runId, debugRunId: debug.runId, work,
    mark: () => readSystemDebugMark(ladderBody()), ladderStatus: () => String(ladderBody().status),
    summary: (groupId: string) => readGroupSummary(t.h.store, groupId) as unknown as GroupSummaryV1,
    manualRetry: () => t.service.retryTask(t.h.command("retry-task", { taskId: "a", runId: levelOne.runId })),
  };
}

describe("a ladder's debug run that lands is folded or visibly stuck, never silently held (#332)", { timeout: 180_000 }, () => {
  it("the settle that completes the debug task kicks the pump, whose pass folds the ladder without waiting for another event", async () => {
    const w = await ladderWorld("succeed"); const { t } = w; try {
      // The pump as the panel wires it (controlAssembly.ts kickPump): one system debug pass per kick.
      const pumps: Array<Promise<unknown>> = [];
      t.deps.kickPump = () => { pumps.push(w.service.systemDebugPass()); };
      await t.until(w.driver, () => t.body(w.debugRunId).state === "landed", 60);
      expect(w.mark()?.settled).toBeNull();
      // One round: the landed run settles on the lane (its task done), and the pump it kicks folds the ladder.
      await w.driver.round();
      await Promise.all(pumps);
      expect(t.body(w.debugRunId).state).toBe("settled");
      expect(w.work(LADDER, "debug")).toBe("done");
      // mutation: drop the kickPump call after the settle in stepE -> no pump pass ran, settled stays null, red
      expect(w.mark()?.settled?.state).toBe("folded");
      // The original task is released (the fold retried it) and the ladder completes on the next round.
      expect(w.work("g", "a")).toBe("ready");
      await w.driver.round();
      expect(w.ladderStatus()).toBe("done");
    } finally { await t.h.dispose(); }
  });

  it("a debug run that settled without completing its task ends the ladder as debug-settle-failed and releases the original task", async () => {
    const w = await ladderWorld("partial"); const { t } = w; try {
      await t.until(w.driver, () => t.body(w.debugRunId).state === "settled", 60);
      expect(w.work(LADDER, "debug")).toBe("blocked");
      const pass = await w.service.systemDebugPass();
      // mutation: drop the stuck-run settle in systemDebugPass -> settled stays null and the ladder holds the task, red
      expect(pass.settled).toEqual([LADDER]);
      expect(w.mark()?.settled).toMatchObject({ state: "debug-settle-failed", detail: expect.stringContaining(`${w.debugRunId} settled`) });
      expect(escalationsOf(t.h.store, "g")).toEqual([{ taskId: "a", debugGroupId: LADDER, state: "exhausted", reason: "debug-settle-failed" }]);
      expect(needsAttention(w.summary("g"))).toBe(true);
      // Level 3 is the person's: their retry of the original task is no longer refused debug-in-progress.
      expect(w.manualRetry()).not.toHaveProperty("error");
    } finally { await t.h.dispose(); }
  });

  it("a debug run whose settle failed stays the ladder's, shows as stuck with the run's recovery retry, and folds once that ran", async () => {
    const w = await ladderWorld("settle-throws"); const { t } = w; try {
      let failing = true;
      t.deps.beforeSettle = async (runId: string) => { if (runId === w.debugRunId && failing) throw new Error("disk full"); };
      await t.until(w.driver, () => t.body(w.debugRunId).state === "blocked", 60);
      expect(t.body(w.debugRunId).drive).toMatchObject({ blockedAt: "E", outcome: "succeeded" });
      const held = await w.service.systemDebugPass();
      // A run-scoped recovery retry can still settle it: the ladder is not ended under it (its fix would be lost).
      // mutation: settle a resumable stuck run too -> the mark settles debug-settle-failed and nothing folds below, red
      expect([held.folded, held.settled]).toEqual([[], []]);
      expect(w.mark()?.settled).toBeNull();
      // mutation: drop the stuck branch in escalationsOf -> state debugging, needsAttention false, red
      expect(escalationsOf(t.h.store, "g")).toEqual([{ taskId: "a", debugGroupId: LADDER, state: "exhausted", reason: "debug-settle-failed" }]);
      expect(needsAttention(w.summary("g"))).toBe(true);
      // mutation: drop the stuck next in confirmedLadderFor -> the refusal names no command, red
      expect(w.manualRetry()).toMatchObject({ error: { code: "task-not-retryable", message: expect.stringContaining(`debug-in-progress:${LADDER}; stuck: orca recovery retry --run ${w.debugRunId}`) } });
      // The named step works: the run resumes its settle, and the ladder folds.
      failing = false;
      const revision = Number(t.h.store.db.prepare("SELECT revision FROM groups WHERE id=?").get(LADDER)!.revision);
      const resumed = await t.service.recoveryRetry(t.h.rawCommand("resume-ladder-run", revision, "recovery-retry", { kind: "run", groupId: LADDER, runId: w.debugRunId }, { scope: "run", runId: w.debugRunId }) as never);
      expect(resumed).not.toHaveProperty("error");
      await t.until(w.driver, () => w.work(LADDER, "debug") === "done", 60);
      expect((await w.service.systemDebugPass()).folded).toEqual([LADDER]);
    } finally { await t.h.dispose(); }
  });
});
