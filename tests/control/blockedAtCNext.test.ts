import { describe, expect, it, vi } from "vitest";
import { ControlError } from "../../src/control/errors.js";
import { driverHarness } from "./fixtures/driverHarness.js";

/**
 * Tester #267: a run blocked at C before ccloop stated an outcome (here: its collect kept timing out) had five commands
 * that each said no -- task retry (`outcome:none`), close-run, recovery retry --group (a silent no-op) -- and none named
 * the one that works, `orca recovery retry --run <id>`. The refusals now name it, and the group retry resumes the run.
 */
type Harness = Awaited<ReturnType<typeof driverHarness>>;
const code = (answer: unknown) => (answer as { error?: { code: string; message: string } }).error ?? null;
const workStatus = (t: Harness): string => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body)).status;

async function blockedAtC() {
  let asleep = false;
  const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "succeed", duringCollect: async () => { if (asleep) throw new ControlError("control-peer-timeout"); } });
  const runId = await t.claim();
  const driver = t.driver();
  await t.until(driver, () => t.body(runId).state === "accepted");
  asleep = true;
  const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try { for (let i = 0; i < 20 && t.body(runId).state !== "blocked"; i += 1) await driver.round(); } finally { spy.mockRestore(); }
  expect({ state: t.body(runId).state, blockedAt: t.body(runId).drive.blockedAt, outcome: t.body(runId).drive.outcome, reason: t.body(runId).drive.blockedReason })
    .toEqual({ state: "blocked", blockedAt: "C", outcome: null, reason: "control-peer-timeout" });
  return { t, driver, runId, wake: () => { asleep = false; } };
}

describe("a run blocked at C with no outcome names recovery retry --run (#267)", { timeout: 120_000 }, () => {
  it("task retry and close-run refuse it naming the command", async () => {
    const { t, runId } = await blockedAtC(); try {
      expect(code(t.service.retryTask(t.h.command("retry-task", { taskId: "a" }))))
        .toMatchObject({ code: "task-not-retryable", message: `task-not-retryable:outcome:none:orca recovery retry --run ${runId}` });
      expect(code(t.service.closeRun(t.h.command("close-run", { runId }))))
        .toMatchObject({ code: "run-closure-not-terminal", message: `run-closure-not-terminal:orca recovery retry --run ${runId}` });
    } finally { await t.h.dispose(); }
  });

  it("recovery retry --group resumes it, and the run lands", async () => {
    const { t, driver, runId, wake } = await blockedAtC(); try {
      wake();
      const answer = await t.service.recoveryRetry(t.h.command("recovery-retry", { scope: "group", groupId: "g" }));
      expect("error" in answer ? answer.error : answer.result).toMatchObject({ kind: "recovery-observed", resolved: true });
      expect(t.body(runId).state).toBe("accepted");
      for (let i = 0; i < 40 && t.body(runId).drive?.cleanedUp !== true; i += 1) await driver.round();
      expect({ state: t.body(runId).state, work: workStatus(t) }).toEqual({ state: "settled", work: "done" });
    } finally { await t.h.dispose(); }
  });

  it("recovery retry --group leaves a run ccloop ended failed to task retry", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed" }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(t.body(runId).drive.outcome).not.toBeNull();
      const answer = await t.service.recoveryRetry(t.h.command("recovery-retry", { scope: "group", groupId: "g" }));
      expect("error" in answer ? answer.error : answer.result).toMatchObject({ kind: "recovery-observed", resolved: false });
      expect(t.body(runId).state).toBe("blocked");
    } finally { await t.h.dispose(); }
  });
});
