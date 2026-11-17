import { describe, expect, it } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import type { ControlStore } from "../../src/control/store.js";
import { persistedRunProblem } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { quotaProbeWorld } from "./fixtures/quotaProbeWorld.js";

/**
 * Tester #348 guard: a writer that puts a new top-level key on a run body, without the group view's strict run read
 * schema (controlViews.ts persistedRunSchema) learning it, makes that run unreadable -- #282 (estimateId), #294
 * (operatorNote), #348 (quotaProbe, probeVerdict) were each found in the field. Here the production writers run for real
 * and every run row the store then holds must decode. Each world also asserts the keys its writers add are present, so a
 * world that stopped reaching a writer fails instead of passing on fewer rows.
 *
 * Writers reached (src/control): the task claim (webDispatch.ts createStartingRun), the driver's drive record and block
 * (driveRecord.ts, executionDriver.ts), the probe claim (quotaProbeCall.ts claimQuotaProbeInTransaction via
 * singleCallLedger.ts insertSingleCallRun), the probe's completion (completeInTransaction) and its block
 * (blockedRunFields), a person's retry-task (retryTask.ts), orca-auto's quota-probe retry (webService.ts), and abandon-run
 * with its settlement (abandonRun.ts, driver).
 */
function unreadableRuns(store: ControlStore): string[] {
  return store.db.prepare("SELECT id, body FROM runs ORDER BY rowid").all().flatMap((row) => {
    const problem = persistedRunProblem(JSON.parse(String(row.body)));
    return problem === null ? [] : [`${String(row.id)}: ${problem}`];
  });
}
function storedKeys(store: ControlStore): Set<string> {
  return new Set(store.db.prepare("SELECT body FROM runs").all().flatMap((row) => Object.keys(JSON.parse(String(row.body)) as object)));
}

describe("every run body a production writer stores decodes under the run read schema (#348 guard)", { timeout: 300_000 }, () => {
  it("claim, drive, quota probe (claim, verdict), a person's retry, orca-auto's probe retry and the next claim", async () => {
    const w = await quotaProbeWorld({ tasks: [{ taskId: "a", agent: { agent: "codex" } }], failing: ["a"] });
    try {
      w.restEnds();
      await w.pass();
      // A second pass sends orca-auto's retry of `a` on the installation the probe found back.
      await w.pass();
      await w.t.claim();
      const keys = storedKeys(w.t.h.store);
      for (const key of ["drive", "purpose", "quotaProbe", "probeVerdict", "startedAt", "endedAt"]) expect(keys, key).toContain(key);
      // mutation: drop `probeVerdict` from persistedRunSchema -> the probe row is listed, red
      expect(unreadableRuns(w.t.h.store)).toEqual([]);
    } finally { await w.t.h.dispose(); }
  });

  it("a probe blocked with unknown usage keeps its verdict through the driver's block (blockedRunFields)", async () => {
    const w = await quotaProbeWorld({ tasks: [{ taskId: "a", agent: { agent: "codex" } }], failing: ["a"],
      answers: [{ outcome: "failed", failureCause: { cause: "auth", detail: "last status: 401" }, tokens: null }] });
    try {
      w.restEnds();
      await w.pass();
      expect(w.probes()[0]!.body).toMatchObject({ state: "blocked", probeVerdict: { verdict: "failed", cause: "auth" } });
      expect(unreadableRuns(w.t.h.store)).toEqual([]);
    } finally { await w.t.h.dispose(); }
  });

  it("abandon-run and the settlement the driver writes when ccloop stops the run", async () => {
    const knobs = { stopped: false };
    const sent: Array<{ revision: number; tokens: number }> = [];
    const t = await driverHarness([{ taskId: "a" }], {
      tokenPolicy: "optional-v1", modelVersion: "followup-g",
      behaviour: () => (knobs.stopped ? "exhausted" : "stoppable-silent"),
      stopReason: () => (knobs.stopped ? "live token ceiling reached" : null),
      setLiveCeiling: async (_input, ceiling) => { sent.push(ceiling); if (ceiling.tokens <= 10) knobs.stopped = true; return { revision: ceiling.revision, tokens: ceiling.tokens }; },
      liveCeilingStop: () => (knobs.stopped ? { revision: sent.at(-1)!.revision, tokens: sent.at(-1)!.tokens, cause: "group", observedTokens: 10, phase: "execute", at: "mid-call" } : undefined),
    });
    try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "accepted");
      const command = t.h.command("abandon-run", { runId, note: "the guard's abandon" });
      expect(withCommandContext(command.commandId, { client: "web", principal: "user:owner" }, () => t.service.abandonRun(command as never))).not.toHaveProperty("error");
      await t.until(driver, () => Number(t.h.store.db.prepare("SELECT active FROM runs WHERE id=?").get(runId)!.active) === 0, 120);
      const keys = storedKeys(t.h.store);
      for (const key of ["abandon", "operatorSettlement", "liveCeiling"]) expect(keys, key).toContain(key);
      expect(unreadableRuns(t.h.store)).toEqual([]);
    } finally { await t.h.dispose(); }
  });
});
