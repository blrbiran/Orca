import { describe, expect, it } from "vitest";
import { readRunActivity } from "../../src/control/activity.js";
import { readBudgetProposal } from "../../src/control/queries.js";
import { writeHandoffRequest } from "../../src/control/stopIntent.js";
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
/** A direct edit of one run body, for a state no fake produces on its own. */
const poke = (t: Harness, runId: string, change: (run: Record<string, any>) => void): void => t.h.store.transaction(() => {
  const run = t.body(runId);
  change(run);
  t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(run), runId);
});
const refusal = (result: ReturnType<typeof retry>) => ("error" in result ? { code: result.error.code, message: result.error.message } : { code: "accepted", message: "" });
/** Nothing moved: the run is still blocked and active, and no task-retried row was written. */
const unchanged = (t: Harness, runId: string): void => {
  expect(t.body(runId).state).toBe("blocked");
  expect(active(t, runId)).toBe(1);
  expect(readRunActivity(t.h.store, runId, 50).some((entry) => entry.kind === "task-retried")).toBe(false);
};

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

describe("retry-task refusals (spec §4.2(2), §4.4)", () => {
  it("refuses a task with no run, and a task whose run is still healthy", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "stoppable" }); try {
      expect(refusal(retry(t))).toEqual({ code: "task-not-retryable", message: "task-not-retryable:no-run" });
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "accepted");
      expect(refusal(retry(t))).toEqual({ code: "task-not-retryable", message: "task-not-retryable:run-state:accepted" });
      expect(active(t, runId)).toBe(1);
    } finally { await t.h.dispose(); }
  });

  it("refuses a run blocked for any other reason: a succeeded run out of bounds, a transient failure, another step", async () => {
    const outOfBounds = await failingHarness([{ taskId: "a" }], () => ({ "elsewhere.txt": "x\n" })); try {
      outOfBounds.succeedNext();
      const { runId } = await failedRun(outOfBounds.t);
      expect(outOfBounds.t.body(runId).drive).toMatchObject({ blockedAt: "C", outcome: "succeeded" });
      expect(refusal(retry(outOfBounds.t))).toEqual({ code: "task-not-retryable", message: "task-not-retryable:outcome:succeeded" });
      unchanged(outOfBounds.t, runId);
    } finally { await outOfBounds.t.h.dispose(); }
    const { t } = await failingHarness(); try {
      const { runId } = await failedRun(t);
      // A collect that failed transiently blocks at C with no outcome (blockedStaysPut.test.ts).
      poke(t, runId, (run) => { run.drive.outcome = null; run.drive.blockedReason = "control-peer-timeout"; });
      expect(refusal(retry(t))).toEqual({ code: "task-not-retryable", message: "task-not-retryable:outcome:none" });
      poke(t, runId, (run) => { run.drive.outcome = "failed"; run.drive.blockedAt = "E"; });
      expect(refusal(retry(t))).toEqual({ code: "task-not-retryable", message: "task-not-retryable:blocked-at:E" });
      unchanged(t, runId);
    } finally { await t.h.dispose(); }
  });

  it("refuses while a handoff request is open, usage is unknown, or a usage event is pending (releaseRunReserve's conditions)", async () => {
    const { t } = await failingHarness(); try {
      const { runId } = await failedRun(t);
      t.h.store.transaction(() => writeHandoffRequest(t.h.store, { requestId: "handoff-open", runId, state: "request-pending", deadlineAt: "2099-01-01T00:00:00.000Z", phaseAttemptOrdinal: 2, failureCode: null, evidenceIds: [] }, "g"));
      expect(refusal(retry(t))).toEqual({ code: "task-not-retryable", message: "task-not-retryable:handoff-request-open:handoff-open" });
      t.h.store.transaction(() => t.h.store.db.prepare("DELETE FROM handoff_requests WHERE id='handoff-open'").run());
      poke(t, runId, (run) => { run.unknown.work = true; });
      expect(refusal(retry(t))).toEqual({ code: "task-not-retryable", message: "task-not-retryable:usage-unknown" });
      poke(t, runId, (run) => { run.unknown.work = false; });
      t.h.store.transaction(() => t.h.store.db.prepare("INSERT INTO usage_events VALUES (?,?,?,?)").run(runId, t.body(runId).highWater + 1, "0".repeat(64), "{}"));
      expect(refusal(retry(t))).toEqual({ code: "task-not-retryable", message: "task-not-retryable:usage-pending" });
      unchanged(t, runId);
    } finally { await t.h.dispose(); }
  });

  it("refuses a stopped group with stop-mode-conflict and a clarifying group with group-state-invalid", async () => {
    const { t } = await failingHarness(); try {
      const { runId } = await failedRun(t);
      const paused = await t.service.pauseDispatch(t.h.command("pause-dispatch", {}));
      expect("error" in paused ? paused.error : "paused").toBe("paused");
      expect(refusal(retry(t)).code).toBe("stop-mode-conflict");
      unchanged(t, runId);
    } finally { await t.h.dispose(); }
    const clarifying = await failingHarness(); try {
      const { runId } = await failedRun(clarifying.t);
      clarifying.t.h.store.transaction(() => clarifying.t.h.store.db.prepare("UPDATE groups SET body=json_set(body,'$.status','clarifying') WHERE id='g'").run());
      expect(refusal(retry(clarifying.t))).toEqual({ code: "group-state-invalid", message: "group-state-invalid:clarifying" });
      unchanged(clarifying.t, runId);
    } finally { await clarifying.t.h.dispose(); }
  });

  it("refuses when the reserve cannot cover the new run, naming the dimension and the shortfall, and changes nothing", async () => {
    const { t } = await failingHarness(); try {
      const { runId } = await failedRun(t);
      const ledger = readWebGroup(t.h.store, "g").ledger;
      // No token left unallocated: the limit is what is used plus what is committed.
      const lowered = t.service.setLimit(t.h.command("set-limit", { limit: { ...ledger.groupLimit, tokens: ledger.used.tokens + ledger.committedRemaining.tokens } }));
      expect("error" in lowered ? lowered.error : "lowered").toBe("lowered");
      const before = readWebGroup(t.h.store, "g").ledger;
      expect(before.explicitUnallocatedReserve.tokens).toBe(0);
      expect(netOf(t.body(runId)).tokens).toBe(10);
      expect(refusal(retry(t))).toEqual({ code: "group-reserve-insufficient", message: "group-reserve-insufficient:tokens:10" });
      expect(readWebGroup(t.h.store, "g").ledger).toEqual(before);
      unchanged(t, runId);
    } finally { await t.h.dispose(); }
  });
});

describe("recovery-retry on a terminally failed run (spec §4.2(3))", () => {
  it("refuses it with run-terminal-failed and leaves it blocked at C; a transiently blocked run still resumes", async () => {
    const { t } = await failingHarness(); try {
      const { runId } = await failedRun(t);
      t.h.store.db.prepare("INSERT INTO recovery_blockers(id,group_id,run_id,scope,code,body) VALUES ('blk-d5','g',?,'run','handoff-request-already-settled',?)")
        .run(runId, JSON.stringify({ evidenceIds: [] }));
      const refused = await t.service.recoveryRetry(t.h.runCommand("recovery-retry", runId, { scope: "run", runId }));
      expect("error" in refused ? refused.error.code : "resumed").toBe("run-terminal-failed");
      expect(t.h.store.db.prepare("SELECT id FROM recovery_blockers WHERE id='blk-d5'").get()).toBeDefined();
      expect(t.body(runId)).toMatchObject({ state: "blocked", drive: { blockedAt: "C", outcome: "failed", blockedReason: "terminal:failed" } });
      poke(t, runId, (run) => { run.drive.outcome = null; run.drive.blockedReason = "control-peer-timeout"; });
      const resumed = await t.service.recoveryRetry(t.h.runCommand("recovery-retry", runId, { scope: "run", runId }));
      expect("error" in resumed ? resumed.error : resumed.result).toMatchObject({ kind: "recovery-observed", resolved: true });
      expect(t.body(runId)).toMatchObject({ state: "accepted", drive: { blockedAt: null, blockedReason: null } });
    } finally { await t.h.dispose(); }
  });
});
