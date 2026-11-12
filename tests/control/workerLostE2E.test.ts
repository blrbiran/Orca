import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import { readFundedAllowance } from "../../src/control/fundedAllowance.js";
import { routedCommandContext } from "../../src/panel/controlApi.js";
import type { ExecutionPort, ExecutionReport } from "../../src/control/executionPort.js";
import { WORKER_UNDETERMINED_GRACE_MS } from "../../src/control/executionDriver.js";
import { readWork } from "../../src/control/queries.js";
import { workerLostCommandId } from "../../src/control/systemDebug.js";
import type { ControlRuntime } from "../../src/panel/controlAssembly.js";
import { readControlRecovery } from "../../src/panel/controlViews.js";
import { ccloopWorlds, raw, realBinary, startGroup, until, type RunRow } from "./fixtures/ccloopWorld.js";

/**
 * Worker-lost recovery spec 2026-11-12 §5.1 (#273, Orca half), against the real ccloop build ORCA_CCLOOP_BIN names (ccloop
 * d79f846 or later: collect reports `worker`, `settle-lost-worker` exists). A machine restart or a killed worker used to
 * leave the run accepted forever: ccloop's collect said nothing and Orca waited. Now a lost worker's run is settled as a
 * failed terminal (`worker-lost`), Orca starts the task again by itself without using up its attempts, at most three times
 * in a row; an undetermined worker is waited for, then blocked by name; a live worker is never settled.
 * The worker is killed with SIGKILL while fake codex sleeps in execute (its pid is ccloop's accepted.json `worker.pid`).
 */
const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-worker-lost-", epochPrefix: "epoch-worker-lost-" });
afterAll(removeRoots);

/** The group's work runs in the order they were claimed (run ids are random, so the fixture's id order is not that). */
const workRuns = (runtime: ControlRuntime): RunRow[] => runtime.store.db.prepare("SELECT id,work_item_id,body FROM runs WHERE group_id='g' ORDER BY rowid").all()
  .map((row) => ({ runId: String(row.id), task: String(row.work_item_id), body: JSON.parse(String(row.body)) })).filter((row) => row.body.phase === "work");
/** As `until`, but a timeout names the task's runs, Orca's own commands and the blockers, not only that it timed out. */
async function waitFor(runtime: ControlRuntime, predicate: () => boolean, ms: number, what: string): Promise<void> {
  await until(predicate, ms, what).catch((error: Error) => {
    const runs = workRuns(runtime).map((run) => ({ runId: run.runId, state: run.body.state, blocked: run.body.drive?.blockedReason ?? null, cause: run.body.drive?.failureCause?.cause ?? null, unknown: run.body.unknown }));
    const commands = runtime.store.db.prepare("SELECT id, original_status, body_json FROM commands WHERE group_id='g' AND id LIKE 'orca-auto-%'").all();
    throw new Error(`${error.message}: ${JSON.stringify({ runs, commands, blockers: blockerCodes(runtime), work: readWork(runtime.store, "g", "a").status })}`);
  });
}
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
const workerPid = (run: RunRow): number => JSON.parse(readFileSync(join(run.body.drive.sourceDir, "control", "accepted.json"), "utf8")).worker.pid as number;
async function killWorker(run: RunRow): Promise<void> {
  const pid = workerPid(run);
  process.kill(pid, "SIGKILL");
  await until(() => !alive(pid), 10_000, "the killed worker to exit");
}
/** Orca acts on its own only in a group it orchestrates (`run`); startGroup confirms "only" (hold), as a person drives it. */
const orchestrate = (runtime: ControlRuntime): void => {
  runtime.store.db.prepare("UPDATE group_orchestration SET body=json_set(body,'$.mode','run') WHERE group_id='g'").run();
};
/** The n-th work run (1-based) once fake codex is sleeping in its execute call. */
async function inExecute(runtime: ControlRuntime, w: { scripted: () => string[] }, n: number): Promise<RunRow> {
  await waitFor(runtime, () => workRuns(runtime).length >= n && workRuns(runtime)[n - 1]!.body.state === "accepted"
    && w.scripted().filter((line) => line.startsWith("execute ")).length >= n, 240_000, `run ${n} to be executing`);
  return workRuns(runtime)[n - 1]!;
}
const activity = (runtime: ControlRuntime, runId: string, kind: string): unknown[] =>
  runtime.store.db.prepare("SELECT body FROM activity WHERE run_id=? AND kind=?").all(runId, kind).map((row) => JSON.parse(String(row.body)));
const blockerCodes = (runtime: ControlRuntime): Array<{ runId: string | null; code: string }> =>
  readControlRecovery(runtime.store, runtime.epoch).blockers.map((blocker) => ({ runId: blocker.runId, code: blocker.code }));
/** A loop task with no token budget of its own, in a group with no token limit: Orca's approximate floor settles its usage. */
const unlimitedTask = [{ taskId: "a", targetPaths: ["answer.txt"], loop: { goal: "write answer", successCondition: "answer is 42", targetPaths: ["answer.txt"], checks: ["test -f answer.txt"], tokenBudget: null } }];

describe.skipIf(!realBinary)("a run whose ccloop worker died (#273)", { timeout: 600_000 }, () => {
  relocateHome("orca-worker-lost-home-");

  it("ends worker-lost, is started again by itself with the task's attempts intact, and the group finishes", async () => {
    const w = await world(unlimitedTask, { a: { files: { "answer.txt": "42\n" }, delayMs: { execute: 8_000 } } }, { tokenPolicy: "optional-v1" });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const runtime = await w.boot(); try {
      await startGroup(runtime, w.repoId);
      orchestrate(runtime);
      runtime.startPump(50);
      const first = await inExecute(runtime, w, 1);
      await killWorker(first);
      await waitFor(runtime, () => readWork(runtime.store, "g", "a").status === "done", 300_000, "the restarted task to finish");
      const [lost, again] = workRuns(runtime);
      // mutation: stepC never calls settle-lost-worker -> the first run waits accepted forever (timeout), red
      expect({ outcome: lost!.body.drive.outcome, cause: lost!.body.drive.failureCause?.cause }).toEqual({ outcome: "failed", cause: "worker-lost" });
      expect(activity(runtime, lost!.runId, "worker-lost")).toHaveLength(1);
      expect(runtime.store.db.prepare("SELECT 1 FROM commands WHERE group_id='g' AND id=?").get(workerLostCommandId("a", lost!.runId))).toBeDefined();
      expect(again!.body.drive.landedCommit).toMatch(/^[0-9a-f]{40}$/);
      // §5.4: the machine lost the work, the task did not fail -- the restart is funded with the attempts the lost run had.
      // mutation: workerLostWant returns its input (no credit) -> fewer attempts, or the retry refused authored-budget-exhausted, red
      const attempts = (row: RunRow): number => readFundedAllowance(runtime.store, row.body as never)!.grant.work.attempts;
      expect(attempts(again!)).toBe(attempts(lost!));
      expect(blockerCodes(runtime)).toEqual([]);
      expect(await runtime.shutdown()).toBe(true);
    } finally { stderr.mockRestore(); await w.teardown(); }
  });

  it("restarts a task at most three times in a row; the fourth loss blocks with worker-lost-repeated", async () => {
    const w = await world(unlimitedTask, { a: { files: { "answer.txt": "42\n" }, delayMs: { execute: 30_000 } } }, { tokenPolicy: "optional-v1" });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const runtime = await w.boot(); try {
      await startGroup(runtime, w.repoId);
      orchestrate(runtime);
      runtime.startPump(50);
      for (let n = 1; n <= 4; n++) await killWorker(await inExecute(runtime, w, n));
      const fourth = workRuns(runtime)[3]!.runId;
      await waitFor(runtime, () => blockerCodes(runtime).some((blocker) => blocker.code === "worker-lost-repeated"), 120_000, "the fourth loss to block");
      // mutation: no WORKER_LOST_RESTARTS bound (or the ladder taking a worker-lost run) -> a fifth run starts, red
      expect(blockerCodes(runtime)).toEqual([{ runId: fourth, code: "worker-lost-repeated" }]);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      expect(workRuns(runtime).map((run) => run.body.drive?.failureCause?.cause)).toEqual(["worker-lost", "worker-lost", "worker-lost", "worker-lost"]);
      expect(readWork(runtime.store, "g", "a").status).not.toBe("done");
      expect(await runtime.shutdown()).toBe(true);
    } finally { stderr.mockRestore(); await w.teardown(); }
  });

  // §5.5 names finite groups; the same person path holds for a task whose budget a person set (approximateLoopScope), which
  // is the world here: no group token limit, a task with its own token budget.
  it("when a person set the task's budget, waits for the killed call's usage to be settled before deciding the restart", async () => {
    const w = await world([{ ...unlimitedTask[0]!, loop: { ...unlimitedTask[0]!.loop, tokenBudget: 1_000_000 } }], { a: { files: { "answer.txt": "42\n" }, delayMs: { execute: 8_000 } } }, { tokenPolicy: "optional-v1" });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const runtime = await w.boot(); try {
      await startGroup(runtime, w.repoId);
      orchestrate(runtime);
      runtime.startPump(50);
      const first = await inExecute(runtime, w, 1);
      await killWorker(first);
      // §5.5 (#116 ruling): a finite group's unknown usage is settled explicitly; the blocker says so, and nothing restarts yet.
      // mutation: no worker-lost-usage-unknown blocker -> red
      await waitFor(runtime, () => blockerCodes(runtime).some((blocker) => blocker.code === "worker-lost-usage-unknown"), 120_000, "the usage blocker");
      expect(blockerCodes(runtime)).toEqual([{ runId: first.runId, code: "worker-lost-usage-unknown" }]);
      expect(workRuns(runtime)).toHaveLength(1);
      // As an agent on the socket would send it (charge-remaining-grant needs no person token).
      const settled = await withCommandContext("settle", routedCommandContext("cli", { kind: "agent", client: "cli" }, { by: "agent", via: "cli" }),
        () => runtime.service.settleUnknownUsage(raw(runtime, "settle", "settle-unknown-usage", { taskId: "a", runId: first.runId, generation: first.body.generation, acknowledge: "charge-remaining-grant" })));
      expect("error" in settled ? settled.error : "settled").toBe("settled");
      // Charging the remaining grant used up the task's own budget: no restart is sent (none would be funded); the run stays
      // with the person, noted as the ladder notes a funding skip, and the usage blocker is gone.
      await waitFor(runtime, () => activity(runtime, first.runId, "ladder-skipped").length > 0, 120_000, "the funding note");
      expect(activity(runtime, first.runId, "ladder-skipped")).toEqual([{ reason: "authored-budget-exhausted" }]);
      expect(runtime.store.db.prepare("SELECT 1 FROM commands WHERE group_id='g' AND id=?").get(workerLostCommandId("a", first.runId))).toBeUndefined();
      expect(workRuns(runtime)).toHaveLength(1);
      expect(blockerCodes(runtime)).toEqual([]);
      expect(await runtime.shutdown()).toBe(true);
    } finally { stderr.mockRestore(); await w.teardown(); }
  });

  it("never settles a worker ccloop cannot tell alive; past the grace it blocks by name, listed by recovery list", async () => {
    const w = await world([{ taskId: "a", targetPaths: ["shared.txt"] }], { a: { files: { "shared.txt": "A\n" }, delayMs: { execute: 20_000 } } });
    let undetermined = false, settles = 0;
    const wrap = (port: ExecutionPort): ExecutionPort => new Proxy(port, { get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      if (key === "settleLostWorker") return async (...args: unknown[]) => { settles += 1; return (value as (...a: unknown[]) => unknown).apply(target, args); };
      if (key !== "collect") return value.bind(target);
      return async (...args: unknown[]) => {
        const report = await (value as (...a: unknown[]) => Promise<ExecutionReport>).apply(target, args);
        return undetermined && report.terminal === null && report.candidate === null ? { ...report, worker: { state: "undetermined", reason: "owner start time unreadable" } } : report;
      };
    } });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const runtime = await w.boot(undefined, wrap); try {
      await startGroup(runtime, w.repoId, 10_000_000);
      runtime.startPump(50);
      const run = await inExecute(runtime, w, 1);
      const pid = workerPid(run);
      undetermined = true;
      await until(() => typeof workRuns(runtime)[0]!.body.workerUndeterminedSince === "number", 60_000, "the grace to start");
      // Within the grace the run waits.
      expect(workRuns(runtime)[0]!.body.state).toBe("accepted");
      // The grace runs out (its start moved back past WORKER_UNDETERMINED_GRACE_MS).
      const body = workRuns(runtime)[0]!.body;
      runtime.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...body, workerUndeterminedSince: body.workerUndeterminedSince - WORKER_UNDETERMINED_GRACE_MS - 1 }), run.runId);
      // mutation: workerUndetermined never blocks -> timeout, red
      await until(() => workRuns(runtime)[0]!.body.state === "blocked", 60_000, "the run to block");
      expect(workRuns(runtime)[0]!.body.drive).toMatchObject({ blockedAt: "C", blockedReason: "worker-undetermined:owner start time unreadable", outcome: null });
      expect(blockerCodes(runtime)).toEqual([{ runId: run.runId, code: "worker-undetermined" }]);
      // mutation: the undetermined branch settles too -> a settle call, the worker reaped, red
      expect(settles).toBe(0);
      expect(alive(pid)).toBe(true);
      // `orca recovery retry --run` checks again; a worker that answers alive runs on to its own end.
      undetermined = false;
      const resumed = await runtime.service.recoveryRetry(raw(runtime, "resume", "recovery-retry", { scope: "run", runId: run.runId }, { kind: "run", groupId: "g", runId: run.runId }));
      expect("error" in resumed ? resumed.error : resumed.result).toMatchObject({ kind: "recovery-observed", resolved: true, blockerCodes: ["worker-undetermined"] });
      await until(() => workRuns(runtime)[0]!.body.drive.outcome !== null, 240_000, "the run to end");
      expect(workRuns(runtime)[0]!.body.drive.outcome).toBe("succeeded");
      expect(blockerCodes(runtime)).toEqual([]);
      expect(await runtime.shutdown()).toBe(true);
    } finally { stderr.mockRestore(); await w.teardown(); }
  });
});
