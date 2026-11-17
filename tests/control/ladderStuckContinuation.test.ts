import { describe, expect, it } from "vitest";
import { replenishStartWakes } from "../../src/control/executionDriver.js";
import { escalationsOf, readSystemDebugMark, systemDebugGroupId } from "../../src/control/systemDebug.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { readWebGroup, WebControlService } from "../../src/control/webService.js";
import { driverHarness } from "./fixtures/driverHarness.js";

/**
 * Tester #332, review of branch 86dd952c (the reviewer's probe, kept as the regression): a debug run stopped at its live
 * ceiling is settled `settled-recoverable` / exhausted and inactive, and its task continues from that checkpoint
 * (usagePause.ts classifyCeilingStop) -- `ready` with `allowancePredecessorRunId` (auto-continued), or `blocked` waiting
 * at its pause line. That debug run is not stuck: the ladder must stay `debugging`, not be ended `debug-settle-failed`.
 */
const LADDER = systemDebugGroupId({ kind: "ladder", groupId: "g", taskId: "a", runId: null });

describe("a ladder whose debug run stopped at its live ceiling keeps debugging (#332 review)", { timeout: 180_000 }, () => {
  for (const variant of ["auto-continued", "pause-line"] as const) it(`a ${variant} ceiling stop on the debug run does not end the ladder`, async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: (id) => id === "a" ? "failed" : "succeed" });
    try {
      const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
      const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, attempts: limit.attempts + 10, sessions: limit.sessions + 10 } }));
      if ("error" in raised) throw new Error(JSON.stringify(raised.error));
      const service = new WebControlService({ ...t.h.deps, knownRepository: (r: string) => r === "repo", resolveRepository: () => t.repo });
      const driver = t.driver();
      const first = await t.claim();
      await t.until(driver, () => t.body(first).state === "blocked");
      await service.systemDebugPass();
      replenishStartWakes({ store: t.h.store, admissionGate: t.h.deps.admissionGate });
      const levelOne = await deliverScheduledStart(t.dispatch, "g");
      if (levelOne.kind !== "claimed") throw new Error("level-1");
      await t.until(driver, () => t.body(levelOne.runId).state === "blocked", 120);
      await service.systemDebugPass();
      await service.autoStart();
      const debug = await deliverScheduledStart(t.dispatch, LADDER);
      if (debug.kind !== "claimed") throw new Error("debug claim");
      await t.until(driver, () => t.body(debug.runId).state === "landed", 60);
      // The post-ceiling shape (executionDriver.ts settleCeilingStopOnce, usagePause.ts classifyCeilingStop).
      const row = t.h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(debug.runId)!;
      const run = JSON.parse(String(row.body)) as Record<string, unknown> & { drive: Record<string, unknown> };
      run.state = "settled-recoverable";
      run.drive = { ...run.drive, outcome: "exhausted", blockedAt: null, blockedReason: null };
      run.liveCeilingStop = { cause: variant === "auto-continued" ? "group" : "pause-line", tokens: 1000, observedTokens: 1000, phase: "work", at: 1 };
      t.h.store.db.prepare("UPDATE runs SET body=?, active=0 WHERE id=?").run(JSON.stringify(run), debug.runId);
      const wrow = t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id='debug'").get(LADDER)!;
      const work = JSON.parse(String(wrow.body)) as Record<string, unknown>;
      work.status = variant === "auto-continued" ? "ready" : "blocked";
      work.allowancePredecessorRunId = debug.runId;
      t.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id='debug'").run(JSON.stringify(work), LADDER);
      const pass = await service.systemDebugPass();
      const mark = readSystemDebugMark(JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(LADDER)!.body)));
      // mutation: restore 86dd952c's settled branch (startsWith("settled"), no exclusions) -> debug-settle-failed, red.
      // Each exclusion alone is covered by the partial-result test in ladderSettleFold.test.ts.
      expect(pass.settled).toEqual([]);
      expect(mark?.settled).toBeNull();
      expect(escalationsOf(t.h.store, "g")).toEqual([{ taskId: "a", debugGroupId: LADDER, state: "debugging", reason: null }]);
    } finally { await t.h.dispose(); }
  });
});
