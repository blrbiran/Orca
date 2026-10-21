import { describe, expect, it } from "vitest";
import { readRunActivity } from "../../src/control/activity.js";
import { durableCommandErrorStatus } from "../../src/control/errors.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { readWebGroup } from "../../src/control/webService.js";
import { driverHarness } from "./fixtures/driverHarness.js";

/**
 * CLI v2 spec §6.1, §14 R2, §15.6 criterion 8: the CLI stops demanding a revision for `task retry`, so the stale-retry
 * guard moves into the verb. A retry that names the run it saw failing is refused `task-run-moved` (409) once that run is
 * no longer the task's current run, and nothing is retried; a retry without `runId` keeps today's behaviour.
 */
const FAILED_REASON = "Error: codex-result-invalid: /runs/run-x/attempt-1/execute-result.json";

async function failingHarness() {
  const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed", stopReason: () => FAILED_REASON });
  const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
  const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, attempts: limit.attempts + 10, sessions: limit.sessions + 10 } }));
  if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
  return t;
}
type Harness = Awaited<ReturnType<typeof failingHarness>>;
const retry = (t: Harness, payload: { taskId: string; runId?: string }) => t.service.retryTask(t.h.command("retry-task", payload));
const outcome = (result: ReturnType<typeof retry>) => ("error" in result ? result.error.code : "accepted");
const retried = (t: Harness, runId: string): boolean => readRunActivity(t.h.store, runId, 50).some((entry) => entry.kind === "task-retried");

describe("retry-task runId guard (CLI v2 §14 R2)", () => {
  it("accepts the current run, refuses a run that has since moved with task-run-moved, and keeps the no-runId behaviour", async () => {
    const t = await failingHarness(); try {
      const first = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(first).state === "blocked");
      // The run the person saw failing is the current run: accepted.
      expect(outcome(retry(t, { taskId: "a", runId: first }))).toBe("accepted");
      // A re-run moves the task to a second run, which fails too.
      await driver.round();
      const delivered = await deliverScheduledStart(t.dispatch, "g");
      if (delivered.kind !== "claimed") throw new Error(`no claim: ${JSON.stringify(delivered)}`);
      const second = delivered.runId;
      await t.until(driver, () => t.body(second).state === "blocked");
      // A retry based on the first run is stale: refused by name, and the second run is not retried.
      const stale = retry(t, { taskId: "a", runId: first });
      expect(outcome(stale)).toBe("task-run-moved");
      expect(t.body(second).state).toBe("blocked");
      expect(retried(t, second)).toBe(false);
      // Without runId: today's behaviour, the current (second) run is retried.
      expect(outcome(retry(t, { taskId: "a" }))).toBe("accepted");
      expect(retried(t, second)).toBe(true);
    } finally { await t.h.dispose(); }
  }, 30000);

  it("task-run-moved is a durable 409", () => {
    expect(durableCommandErrorStatus("task-run-moved")).toBe(409);
  });
});
