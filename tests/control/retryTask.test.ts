import { describe, expect, it } from "vitest";
import { recordUsage } from "../../src/control/usage.js";
import { readWebGroup } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import type { WebFixtureTask } from "./fixtures/web.js";

/**
 * Issue fixes spec §4 (issue 16, Orca's side of issue 15): ccloop's failure reason is kept, `retry-task` settles a run
 * ccloop ended failed as `settled-failed` and returns its task to `ready`, the driver archives and cleans that run, and
 * normal dispatch starts the task again from the group branch. Driven through the driver's synthetic ccloop
 * (fixtures/driverPort.ts); the real-ccloop scenario is in executionDriverE2E.test.ts.
 */

/** What ccloop reports for issue 15: PhaseExecutionError's message is String(error), so `Error: ` comes first. */
const FAILED_REASON = "Error: codex-result-invalid: /runs/run-x/attempt-1/execute-result.json";
type Harness = Awaited<ReturnType<typeof driverHarness>>;

/**
 * Task `a`'s runs end `failed` with FAILED_REASON until `succeedNext()`; every other task succeeds. The group limit gets
 * ten more attempts and sessions, so several retries fit (each re-reserves the failed run's one attempt and one session).
 */
async function failingHarness(tasks: readonly WebFixtureTask[] = [{ taskId: "a" }], files?: (workItemId: string) => Record<string, string>) {
  let failing = true;
  const t = await driverHarness(tasks, {
    behaviour: (id) => (id === "a" && failing ? "failed" : "succeed"),
    stopReason: (id) => (id === "a" && failing ? FAILED_REASON : null),
    ...(files === undefined ? {} : { files }),
  });
  const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
  const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, attempts: limit.attempts + 10, sessions: limit.sessions + 10 } }));
  if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
  return { t, succeedNext: (): void => { failing = false; } };
}
const view = (t: Harness) => readControlGroup(t.h.store, "epoch-test", "g");
/** Claim task a's run and drive it until ccloop's terminal blocks it at C. */
async function failedRun(t: Harness): Promise<{ runId: string; driver: ReturnType<Harness["driver"]> }> {
  const runId = await t.claim();
  const driver = t.driver();
  await t.until(driver, () => t.body(runId).state === "blocked");
  return { runId, driver };
}

describe("keeping ccloop's failure reason (spec §4.2(1))", () => {
  it("stores ccloop's stop reason on the drive record and gives it, with the outcome, to the run view", async () => {
    const { t } = await failingHarness(); try {
      const { runId } = await failedRun(t);
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "C", blockedReason: "terminal:failed", outcome: "failed", stopReason: FAILED_REASON });
      expect(view(t).runs.find((run) => run.runId === runId)).toMatchObject({ state: "blocked", blockedReason: "terminal:failed", outcome: "failed", stopReason: FAILED_REASON });
    } finally { await t.h.dispose(); }
  });

  it("stores no stop reason when ccloop stated none, and the view says null", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "exhausted" }); try {
      const { runId } = await failedRun(t);
      expect("stopReason" in t.body(runId).drive).toBe(false);
      expect(view(t).runs.find((run) => run.runId === runId)).toMatchObject({ outcome: "exhausted", stopReason: null });
    } finally { await t.h.dispose(); }
  });
});

describe("settled-failed in every reader (spec §4.2(4), review C2)", () => {
  it("renders a settled-failed run in the group view and refuses it any further usage", async () => {
    const { t } = await failingHarness(); try {
      const { runId } = await failedRun(t);
      // A stand-in for retry-task (Task D3), the state's only writer: the run alone, made inactive.
      t.h.store.transaction(() => {
        const run = t.body(runId);
        run.state = "settled-failed";
        t.h.store.db.prepare("UPDATE runs SET body=?, active=0 WHERE id=?").run(JSON.stringify(run), runId);
      });
      expect(view(t).runs.map((run) => [run.runId, run.state])).toEqual([[runId, "settled-failed"]]);
      expect(() => recordUsage(t.h.store, { runId, generation: 1, eventSeq: 3, bucket: "work", cumulative: { tokens: 11, activeMs: 5, attempts: 1, sessions: 1 }, source: { artifactId: "late-usage", hash: "0".repeat(64) } }))
        .toThrow("run-already-settled");
    } finally { await t.h.dispose(); }
  });
});
