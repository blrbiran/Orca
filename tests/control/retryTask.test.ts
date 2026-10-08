import { describe, expect, it } from "vitest";
import { readRunActivity } from "../../src/control/activity.js";
import { readBudgetProposal } from "../../src/control/queries.js";
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

const DIMENSIONS = ["tokens", "activeMs", "attempts", "sessions"] as const;
type Dimension = typeof DIMENSIONS[number];
const work = (t: Harness, taskId: string) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body));
const active = (t: Harness, runId: string): number => Number(t.h.store.db.prepare("SELECT active FROM runs WHERE id=?").get(runId)!.active);
/** Spec §4.2(2): the failed run's net new reservation per dimension -- its grant minus its remainder, work + handoff. */
const netOf = (run: Record<string, any>): Record<Dimension, number> =>
  Object.fromEntries(DIMENSIONS.map((d) => [d, run.grant.work[d] + run.grant.handoff[d] - run.remaining.work[d] - run.remaining.handoff[d]])) as Record<Dimension, number>;
const retry = (t: Harness, taskId = "a") => t.service.retryTask(t.h.command("retry-task", { taskId }));

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

describe("retry-task (spec §4.2(2))", () => {
  it("settles the failed run, returns the task to ready under the same grant, and the group view reads at once (review C1)", async () => {
    const { t } = await failingHarness(); try {
      const { runId } = await failedRun(t);
      const failed = t.body(runId);
      const before = readWebGroup(t.h.store, "g").ledger;
      const revision = view(t).summary.commandRevision;
      const net = netOf(failed);
      expect(net.tokens).toBe(10);
      const at = Date.now();
      const result = retry(t);
      expect("error" in result ? result.error : result.result).toEqual({ kind: "task-retried", taskId: "a", fromRunId: runId });
      // Effect 1: the run alone moves -- usage booked stays, remainder stays on the run (remaining == grant - cumulative).
      const settled = t.body(runId);
      expect(settled).toMatchObject({ state: "settled-failed", remaining: failed.remaining, cumulative: failed.cumulative, drive: { ...failed.drive, cleanedUp: false } });
      expect(settled.endedAt).toBeGreaterThanOrEqual(at);
      expect(active(t, runId)).toBe(0);
      // Effect 1: remainder released, grant re-reserved -- net change grant - remaining, allocations still confirmed.
      const after = readWebGroup(t.h.store, "g").ledger;
      for (const d of DIMENSIONS) {
        expect(after.committedRemaining[d], d).toBe(before.committedRemaining[d] + net[d]);
        expect(after.explicitUnallocatedReserve[d], d).toBe(before.explicitUnallocatedReserve[d] - net[d]);
      }
      expect(readBudgetProposal(t.h.store, "g").allocations.filter((row) => row.ownerId === "a").map((row) => row.state)).toEqual(["confirmed", "confirmed"]);
      // Effect 2: ready, currentRunId kept on the settled-failed run, grant unchanged.
      expect(work(t, "a")).toMatchObject({ status: "ready", currentRunId: runId, lineageRunIds: [runId], grant: failed.grant });
      // C1: the group view reads immediately, with the run settled-failed and its reason.
      const read = view(t);
      expect(read.summary.commandRevision).toBe(revision + 1);
      expect(read.runs.map((run) => [run.runId, run.state, run.stopReason])).toEqual([[runId, "settled-failed", FAILED_REASON]]);
      expect(read.workItems.find((item) => item.taskId === "a")!.status).toBe("ready");
      // Effect 4: two activity rows, newest first.
      expect(readRunActivity(t.h.store, runId, 10).slice(0, 2).map((entry) => [entry.kind, entry.body])).toEqual([
        ["task-retried", { fromRunId: runId }],
        ["run-settled", { state: "settled-failed", outcome: "failed", stopReason: FAILED_REASON }],
      ]);
      // Part D amendment: the settle row comes once, from saveRunBody's noteRunWrite -- retry-task writes no second one.
      expect(readRunActivity(t.h.store, runId, 50).filter((entry) => entry.kind === "run-settled")).toHaveLength(1);
    } finally { await t.h.dispose(); }
  });
});
