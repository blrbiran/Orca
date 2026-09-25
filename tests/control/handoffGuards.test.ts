import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { settleHandoffCheckpoint, stepH } from "../../src/control/driverHandoff.js";
import { createExecutionDriver, readDriverRun, readStartEnvelope, stepA1, stepA2, type DriverContext, type ExecutionDriverDeps } from "../../src/control/executionDriver.js";
import { readStopIntent, settleCompletedRunRequestInTransaction, settleHandoffRequest } from "../../src/control/stopIntent.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import type { FakeBehaviour } from "./fixtures/driverPort.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { crashingAt, requestBody, requestState, stop, work, type Harness } from "./fixtures/handoffHarness.js";

// Handoff delivery Task 10b: the six guards of step H and the stop-side settles that no earlier criterion saw red
// (mutations.md, "open gaps"). Each criterion below drives the guard's own input and measures what the guard
// prevents, after the call under test.

const checkpointRows = (t: Harness, runId: string) =>
  t.h.store.db.prepare("SELECT id,hash FROM checkpoints WHERE run_id=? ORDER BY id").all(runId).map((row) => ({ id: String(row.id), hash: String(row.hash) }));

/** A stoppable run under handoff-stop whose candidate was read but not yet settled (a death at H-after-candidate). */
async function candidateRead(): Promise<{ t: Harness; runId: string; requestId: string }> {
  const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "stoppable" });
  const runId = await t.claim();
  await t.until(t.driver(), () => t.body(runId).state === "accepted");
  const [requestId] = await stop(t);
  const crashing = crashingAt(t, "H-after-candidate");
  await t.until(crashing, () => crashing.crashed !== null);
  return { t, runId, requestId: requestId! };
}

/** The report the synthetic ccloop answers for the run: the same candidate the crashed round read. */
async function reportOf(t: Harness, runId: string) {
  return t.fake.port.collect(readStartEnvelope(t.h.store, readDriverRun(t.h.store, runId)), 0);
}

describe("H-settle's own checks inside its transaction (spec §11 C2, §13.2 C-1)", { timeout: 60_000 }, () => {
  it("refuses a checkpoint row already stored under the same id with a different hash, and settles nothing (T4-DEFER-1)", async () => {
    const { t, runId, requestId } = await candidateRead(); try {
      const report = await reportOf(t, runId);
      // Another writer's row lands under the id this settle computes, after its canonical file is written and before
      // its transaction: the admission gate's `enter` is the last thing `write` does before the transaction opens.
      const gate = t.deps.admissionGate!;
      const dir = join(t.h.store.stateDir, "checkpoints", runId);
      let planted: string | null = null;
      const hooked: ExecutionDriverDeps = {
        ...t.deps,
        admissionGate: {
          get draining() { return gate.draining; },
          beginDrain: () => gate.beginDrain(),
          enter: () => {
            const file = planted === null && existsSync(dir) ? readdirSync(dir).find((name) => name.startsWith(`settle-${runId}-`) && name.endsWith(".json")) : undefined;
            if (file !== undefined) {
              planted = file.slice(0, -".json".length);
              t.h.store.db.prepare("INSERT INTO checkpoints VALUES (?,?,?,?)").run(planted, runId, "0".repeat(64), "{}");
            }
            return gate.enter();
          },
        },
      };
      const outcome = await settleHandoffCheckpoint(hooked, runId, requestId, report).then((value) => value, (error: unknown) => error);
      expect(outcome).toMatchObject({ code: "checkpoint-id-conflict" });
      expect(planted).not.toBeNull();
      // Nothing was settled on a checkpoint whose stored identity disagrees with its bytes.
      expect(requestState(t, requestId)).toBe("collecting");
      expect(t.body(runId).checkpointId ?? null).toBeNull();
      expect(checkpointRows(t, runId)).toEqual([{ id: planted, hash: "0".repeat(64) }]);
    } finally { await t.h.dispose(); }
  });

  it("refuses a candidate whose usage high-water is not the run's booked high-water, and settles nothing (T4-DEFER-2)", async () => {
    const { t, runId, requestId } = await candidateRead(); try {
      const report = await reportOf(t, runId);
      // The run booked usage events 1 and 2; a candidate that claims to cover only event 1 does not account for all of it.
      const stale = { ...report, candidate: { ...report.candidate!, usageHighWater: report.candidate!.usageHighWater - 1 } };
      const outcome = await settleHandoffCheckpoint(t.deps, runId, requestId, stale).then((value) => value, (error: unknown) => error);
      expect(outcome).toMatchObject({ code: "checkpoint-usage-high-water" });
      expect(requestState(t, requestId)).toBe("collecting");
      expect(t.body(runId)).toMatchObject({ state: "accepted", highWater: 2 });
      expect(t.body(runId).checkpointId ?? null).toBeNull();
      expect(checkpointRows(t, runId)).toEqual([]);
    } finally { await t.h.dispose(); }
  });
});

describe("delivery while the panel drains (spec §3, shutdown order)", { timeout: 60_000 }, () => {
  it("does not send ccloop the request once draining has begun: no delivery, the request stays request-pending (T4-DEFER-3)", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "stoppable" }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "accepted");
      const [requestId] = await stop(t);
      // A round's own first write (replenishStartWakes) is refused once draining, so a round never reaches H then;
      // a drain that begins mid-round does. That is H entered with the gate already draining.
      t.deps.admissionGate!.beginDrain();
      const context: DriverContext = { reconciling: new Map(), stopped: false };
      const outcome = await stepH(t.deps, runId, context).then((value) => value, (error: unknown) => error);
      expect(t.fake.calls.handoff).toEqual([]);
      expect(outcome).toBe(false);
      expect(requestState(t, requestId!)).toBe("request-pending");
    } finally { await t.h.dispose(); }
  });
});

describe("a restart whose workspace cannot be removed (spec §11 I9, §13.2 C-6)", { timeout: 60_000 }, () => {
  it("still settles restartable, and records why the removal failed on the run instead of calling it cleaned up (T4-DEFER-4)", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "stoppable" }); try {
      const runId = await t.claim();
      expect(stepA1(t.deps, runId)).toBe(true);
      expect(await stepA2(t.deps, runId)).toBe(true);
      const workspace = t.body(runId).drive.workspacePath as string;
      const [requestId] = await stop(t);
      // The repository cannot be resolved at H: the run never started (inspect answers absent), so it is restarted,
      // and cleanupRunWorkspace never gets a repository to remove the workspace from.
      const blind = createExecutionDriver({ ...t.deps, resolveRepository: () => { throw new Error("repository gone"); } });
      await t.until(blind, () => requestState(t, requestId!) === "settled-restartable");
      expect(t.body(runId).drive).toMatchObject({ cleanedUp: false, cleanupError: "repository gone" });
      expect(existsSync(workspace)).toBe(true);
      expect(work(t, "a").status).toBe("ready");
    } finally { await t.h.dispose(); }
  });
});

describe("the stop-side settles refuse what is not theirs (spec §11 C1, §13.2 C-6)", { timeout: 60_000 }, () => {
  it("leaves a request another settle already closed as it was: a completed run's settle does not reopen it as recoverable (T3-DEFER-2)", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      await t.claim();
      const [requestId] = await stop(t);
      settleHandoffRequest({ store: t.h.store, profileRouter: t.h.deps.profileRouter }, { requestId: requestId!, outcome: "settled-restartable" });
      const stopState = readStopIntent(t.h.store, "g")!.state;
      t.h.store.transaction(() => settleCompletedRunRequestInTransaction(t.h.store, "g", requestId!));
      // A restartable run gave its task back to be claimed afresh; calling it recoverable would claim a checkpoint it never had.
      expect(requestBody(t, requestId!)).toMatchObject({ state: "settled-restartable", failureCode: null });
      expect(readStopIntent(t.h.store, "g")!.state).toBe(stopState);
    } finally { await t.h.dispose(); }
  });

  it("refuses to restart a continuation the task does not register as its own: the task is not handed to the registered predecessor (T3-DEFER-1)", async () => {
    const behaviour = { value: "stoppable" as FakeBehaviour };
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => behaviour.value }); try {
      const predecessor = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(predecessor).state === "accepted");
      const [first] = await stop(t);
      await t.until(driver, () => requestState(t, first!) === "settled-recoverable");
      const checkpointId = t.body(predecessor).checkpointId as string;
      const resumed = await t.service.resumeFromHandoff(t.h.command("resume-from-handoff", { selections: [{ taskId: "a", predecessorRunId: predecessor, checkpointId }] } as never));
      if ("error" in resumed) throw new Error(`resume-from-handoff refused: ${JSON.stringify(resumed.error)}`);
      const claimed = await deliverScheduledStart(t.dispatch, "g");
      if (claimed.kind !== "claimed") throw new Error(`resume claim refused: ${JSON.stringify(claimed)}`);
      const continuation = claimed.runId;
      // As driverContinuation.test.ts's A2 criterion: the run names a continuation the task did not register. No public
      // path writes this; it is the stored inconsistency A2 and terminaliseRun both refuse by name.
      const body = t.body(continuation);
      body.continuationIntentId = "continuation-other";
      t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(body), continuation);
      const registered = work(t, "a").continuation;
      await t.until(driver, () => t.body(continuation).state === "blocked");
      expect(t.body(continuation).drive).toMatchObject({ blockedAt: "A2", blockedReason: "continuation-registration" });
      const [second] = await stop(t);
      // H sees a run blocked at A2 (provably never started) and restarts it; the restart is what must be refused. One
      // round: the refusal re-blocks the run under the round's generic step label, and later rounds read it from there.
      await driver.round();
      expect(requestState(t, second!)).toBe("request-pending");
      expect(work(t, "a")).toMatchObject({ currentRunId: continuation, continuation: registered });
      expect(t.body(continuation).drive.blockedReason).toContain(`restartable-continuation:${continuation}`);
    } finally { await t.h.dispose(); }
  });
});
