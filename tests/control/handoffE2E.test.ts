import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readArtifact } from "../../src/control/archive.js";
import { lookupCommandResult } from "../../src/control/commandLedger.js";
import { DriverCrash, readDriverRun, readStartEnvelope, type CrashPoint } from "../../src/control/executionDriver.js";
import { readStopIntent } from "../../src/control/stopIntent.js";
import type { ControlRuntime } from "../../src/panel/controlAssembly.js";
import { shutdownCommandId } from "../../src/panel/controlLifecycle.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import {
  ccloopWorlds, g, KILL_GRACE_MS, noBlocked, raw, realBinary, startGroup, until, workRuns,
  type RunRow, type ScriptEntry, type Task, type World,
} from "./fixtures/ccloopWorld.js";
import { storeReadings } from "./fixtures/handoffHarness.js";

/**
 * Handoff delivery spec §9.2 (H1-H3, H5, H6, R-H), §12 (the deadline case), §13.1 C-2/C-4 and §13.2 I-6 against
 * the real ccloop build (ORCA_CCLOOP_BIN, which must contain ccloop C1-C7: the scripted fake codex with
 * per-phase `delayMs`, the `<task>#continuation` key and the `<marker>.tasks` log; C6; C7; and for the deadline
 * case C-3 and D-C7'). Everything is relocated under a temporary root. The honest claim (spec §2): with fake
 * codex and a soft group, a human handoff-stop of a group the driver is running closes every frozen run by the
 * step it is at, and a resume-from-handoff continues each selected task from its checkpoint onto orca/<group>,
 * N-way included. Real codex under a handoff is not claimed here.
 */
const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-handoff-e2e-", epochPrefix: "epoch-handoff-e2e-" });
// Retried for the same reason as executionDriverE2E.test.ts: a failed scenario may leave a background
// reconciliation `ccloop run` (or an orphaned fake codex) still writing under the root for a moment.
afterAll(removeRoots);

const isAncestor = (cwd: string, ancestor: string, descendant: string): boolean => {
  try { g(cwd, "merge-base", "--is-ancestor", ancestor, descendant); return true; } catch { return false; }
};

let commandSeq = 0;
/** The person's handoff-stop; answers the request ids it created, one per frozen run. */
async function handoffStop(runtime: ControlRuntime, payload: { handoffDeadlineAt?: string } = {}): Promise<string[]> {
  const stopped = await runtime.service.handoffStop(raw(runtime, `stop-${++commandSeq}`, "handoff-stop", payload));
  if ("error" in stopped || stopped.result.kind !== "handoff-stopped") throw new Error(`handoff-stop refused: ${JSON.stringify(stopped)}`);
  return stopped.result.requestIds;
}

/**
 * The panel's rule (web/src/ControlGroupView.tsx `continuableRuns`, handoff delivery spec §13.1 C-4), applied
 * to the server's read model: a run the server marks continuable, with its non-unknown checkpoint.
 */
function panelSelections(runtime: ControlRuntime): Array<{ taskId: string; predecessorRunId: string; checkpointId: string }> {
  const view = readControlGroup(runtime.store, runtime.epoch, "g");
  return view.runs.flatMap((run) => {
    if (run.taskId === null || run.continuable !== true) return [];
    const checkpoint = view.checkpoints.find((candidate) => candidate.runId === run.runId && candidate.state !== "unknown");
    return checkpoint ? [{ taskId: run.taskId, predecessorRunId: run.runId, checkpointId: checkpoint.checkpointId }] : [];
  });
}

/** One resume-from-handoff command carrying exactly the panel's selections. */
async function resumeAsThePanelWould(runtime: ControlRuntime): Promise<Array<{ taskId: string; predecessorRunId: string; checkpointId: string }>> {
  const selections = panelSelections(runtime);
  const resumed = await runtime.service.resumeFromHandoff(raw(runtime, `resume-${++commandSeq}`, "resume-from-handoff", { selections }));
  expect("error" in resumed ? resumed.error : resumed.result.kind).toBe("resumed-from-handoff");
  return selections;
}

const runsOf = (runtime: ControlRuntime, taskId: string): RunRow[] => workRuns(runtime).filter((run) => run.task === taskId);
const work = (runtime: ControlRuntime, taskId: string) => storeReadings.work(runtime.store, taskId);
const requestState = (runtime: ControlRuntime, requestId: string): string => storeReadings.requestState(runtime.store, requestId);
const active = (runtime: ControlRuntime, runId: string): number => storeReadings.active(runtime.store, runId);
const committedAndUsed = (runtime: ControlRuntime): number[] => storeReadings.committedAndUsed(runtime.store);
const allocation = (runtime: ControlRuntime, taskId: string) => storeReadings.allocation(runtime.store, taskId);
const stopped = (runtime: ControlRuntime): boolean => JSON.parse(String(runtime.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).stopped;
const checkpointOf = (runtime: ControlRuntime, checkpointId: string) =>
  JSON.parse(String(runtime.store.db.prepare("SELECT body FROM checkpoints WHERE id=?").get(checkpointId)!.body));
/** The snapshot a checkpoint points at (an archived artifact, src/control/snapshot.ts): its `head` is ccloop's result HEAD. */
const snapshotHead = async (runtime: ControlRuntime, checkpoint: { snapshot: { artifactId: string; hash: string } }): Promise<string> =>
  (JSON.parse((await readArtifact(runtime.store, checkpoint.snapshot)).toString("utf8")) as { head: string }).head;
/** ccloop source directories the driver created: one per run it prepared (reconciliation runs live elsewhere). */
const sourceDirs = (runtime: ControlRuntime): string[] => readdirSync(`${runtime.store.stateDir}.runs`).sort();

/**
 * The one-task script H1 and every R-H point share. The predecessor writes the first half while its execute
 * phase sleeps long enough for the stop to arrive in the middle of it; the continuation (ccloop C5's
 * `#continuation` key, chosen by the continuation constraint in its plan and execute prompts) writes the
 * second half. Its verify prompt carries no constraint, so that call is answered by `a` -- which has no
 * verify delay.
 */
const HALVES: Record<string, ScriptEntry> = {
  a: { files: { "a1.txt": "A1\n" }, delayMs: { execute: 6_000 } },
  "a#continuation": { files: { "a2.txt": "A2\n" } },
};
const HALVES_TASKS: Task[] = [{ taskId: "a", targetPaths: ["a1.txt", "a2.txt"] }];
/**
 * Stopped at the boundary after execute (ccloop stops at every phase boundary, spec §11 M1): plan and
 * execute. The continuation runs a whole attempt with the agent verifier: plan, execute, verify.
 */
const HALVES_CALLS = ["plan", "execute", "plan", "execute", "verify"];
const HALVES_SCRIPTED = ["plan a", "execute a", "plan a#continuation", "execute a#continuation", "verify a"];

/** Waits until the predecessor of each of `taskIds` is in its execute phase (its execute call is logged before it sleeps). */
async function inExecute(w: World, runtime: ControlRuntime, taskIds: string[]): Promise<void> {
  await until(() => { noBlocked(runtime); return taskIds.every((id) => w.scripted().includes(`execute ${id}`)); }, 120_000, `${taskIds.join(",")} to enter execute`, 20);
}

/** Test-only fault injection (execution driver spec §7.2 R1): the driver dies at `point`, as a process death would. */
const crashAt = (point: CrashPoint) => (at: CrashPoint): void => { if (at === point) throw new DriverCrash(at); };

describe.skipIf(!realBinary)("handoff delivery against real ccloop (spec §9.2)", { timeout: 420_000 }, () => {
  relocateHome("orca-handoff-e2e-home-");

  it("H1: a run stopped mid-execute parks its half in a checkpoint, and its continuation lands the whole task on the predecessor's base", async () => {
    const w = await world(HALVES_TASKS, HALVES);
    const runtime = await w.boot(); try {
      await startGroup(runtime, w.repoId);
      runtime.startPump(50);
      await inExecute(w, runtime, ["a"]);
      const [predecessor] = runsOf(runtime, "a");
      expect(predecessor!.body.state).toBe("accepted");
      const tipBefore = w.tip();
      const ledgerBefore = committedAndUsed(runtime);
      const [requestId] = await handoffStop(runtime);
      await until(() => { noBlocked(runtime); return requestState(runtime, requestId!) === "settled-recoverable"; }, 120_000, "the request to settle recoverable");
      // spec §3 accepted row, §11 C2: the run is parked whole -- held, inactive, nothing landed.
      const parked = readDriverRun(runtime.store, predecessor!.runId) as unknown as Record<string, any>;
      expect(parked).toMatchObject({ state: "settled-recoverable", recoverable: true });
      expect(active(runtime, predecessor!.runId)).toBe(0);
      expect(work(runtime, "a")).toMatchObject({ status: "held", currentRunId: predecessor!.runId });
      expect(w.tip()).toBe(tipBefore);
      expect(readStopIntent(runtime.store, "g")!.state).toBe("handoff-complete");
      // spec §13.1 C-2 (ccloop C7) and §11 C3/C6: nothing the run never entered is missing, its own request is
      // answered, and a request with no landing is an Orca `partial` checkpoint.
      const checkpoint = checkpointOf(runtime, parked.checkpointId);
      expect(checkpoint).toMatchObject({ result: "partial", missing: [], unresolvedRequestIds: [] });
      // spec §11 C2 ledger conservation: the commitment is parked, not released.
      expect(committedAndUsed(runtime)).toEqual(ledgerBefore);
      expect(allocation(runtime, "a")).toMatchObject({ state: "held", amount: parked.remaining.work });
      // spec §13.1 C-4: the read model offers exactly this run, and the panel's selection resumes it.
      const selections = await resumeAsThePanelWould(runtime);
      expect(selections).toEqual([{ taskId: "a", predecessorRunId: predecessor!.runId, checkpointId: parked.checkpointId }]);
      // Registering the continuation moves the parked commitment to it, amount unchanged; nothing is released.
      expect(committedAndUsed(runtime)).toEqual(ledgerBefore);
      expect(allocation(runtime, "a")).toMatchObject({ state: "continuing", amount: parked.remaining.work });
      await until(() => { noBlocked(runtime); return work(runtime, "a").status === "done" && runsOf(runtime, "a").every((run) => run.body.drive?.cleanedUp === true); }, 240_000, "the continuation to land and settle");
      const continuation = runsOf(runtime, "a").find((run) => run.runId !== predecessor!.runId)!;
      // The whole task: the predecessor's half from its checkpoint plus the continuation's part, landed once.
      expect(w.show("a1.txt")).toBe("A1");
      expect(w.show("a2.txt")).toBe("A2");
      expect(w.landings()).toBe(1);
      // spec §4 plan X and §11 I6: the continuation keeps the predecessor's base, and that base is an ancestor of
      // the snapshot HEAD ccloop rebuilt the first attempt on.
      expect(continuation.body.drive.base).toBe(predecessor!.body.drive.base);
      const head = await snapshotHead(runtime, checkpoint);
      expect(isAncestor(w.repo, predecessor!.body.drive.base, head)).toBe(true);
      // The first attempt's workspace HEAD, read as the parent of the attempt commit ccloop published from it
      // (ccloop publishAttemptCommit commits on the attempt worktree's HEAD; materializeFirstWorkspace created
      // that worktree at snapshot.head and verified it).
      expect(g(w.repo, "rev-parse", `${continuation.body.drive.attemptSha}^1`)).toBe(head);
      const envelope = readStartEnvelope(runtime.store, continuation.body as never) as unknown as { inputCheckpoint: Record<string, string> | null };
      expect(envelope.inputCheckpoint).toMatchObject({ predecessorRunId: predecessor!.runId, checkpointId: parked.checkpointId,
        checkpointHash: String(runtime.store.db.prepare("SELECT hash FROM checkpoints WHERE id=?").get(parked.checkpointId)!.hash) });
      expect(envelope.inputCheckpoint!.bundlePath.startsWith(join(continuation.body.drive.sourceDir, "input"))).toBe(true);
      expect(w.calls()).toEqual(HALVES_CALLS);
      expect(w.scripted()).toEqual(HALVES_SCRIPTED);
      expect(sourceDirs(runtime)).toEqual([predecessor!.runId, continuation.runId].sort());
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });

  it("H3: a dependent is not claimed while its dependency is parked or continuing, and then starts on top of the whole landing", async () => {
    const w = await world([...HALVES_TASKS, { taskId: "c", dependsOn: ["a"], targetPaths: ["c.txt"], verifierType: "command" }], {
      ...HALVES, c: { files: { "c.txt": "C\n" } },
    });
    const runtime = await w.boot(); try {
      await startGroup(runtime, w.repoId);
      runtime.startPump(50);
      await inExecute(w, runtime, ["a"]);
      const [requestId] = await handoffStop(runtime);
      await until(() => requestState(runtime, requestId!) === "settled-recoverable", 120_000, "the request to settle recoverable");
      expect(work(runtime, "a").status).toBe("held");
      expect(runsOf(runtime, "c")).toEqual([]);
      await resumeAsThePanelWould(runtime);
      // spec §4.1: `held`, then continuing, is not `done` -- every poll until c appears proves a is done by then.
      await until(() => {
        noBlocked(runtime);
        if (runsOf(runtime, "c").length > 0 && work(runtime, "a").status !== "done") throw new Error(`c was claimed while a is ${work(runtime, "a").status}`);
        return work(runtime, "c").status === "done" && workRuns(runtime).every((run) => run.body.drive?.cleanedUp === true);
      }, 300_000, "the continuation and then c to settle", 20);
      const continuation = runsOf(runtime, "a").find((run) => run.body.continuationIntentId)!;
      const [c] = runsOf(runtime, "c");
      // The base c started from holds a's whole landing, not a half of it.
      expect(isAncestor(w.repo, continuation.body.drive.landedCommit, c!.body.drive.base)).toBe(true);
      expect([w.show("a1.txt"), w.show("a2.txt"), w.show("c.txt")]).toEqual(["A1", "A2", "C"]);
      // c's command verifier calls no provider (executionDriverE2E.test.ts E1).
      expect(w.calls()).toEqual([...HALVES_CALLS, "plan", "execute"]);
      expect(w.scripted()).toEqual([...HALVES_SCRIPTED, "plan c", "execute c"]);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });

  it("H2: three parallel runs stopped mid-execute all continue; the landings are serial and reconcile exactly twice, the second against both", async () => {
    const own = (id: string): ScriptEntry => ({ files: { "shared.txt": `${id.toUpperCase()}\n`, [`${id}.txt`]: `${id.toUpperCase()}\n` }, delayMs: { execute: 8_000 } });
    const script: Record<string, ScriptEntry> = {
      a: own("a"), b: own("b"), d: own("d"),
      "a#continuation": { files: { "a.txt": "A2\n" } }, "b#continuation": { files: { "b.txt": "B2\n" } }, "d#continuation": { files: { "d.txt": "D2\n" } },
    };
    // Which task lands first is the driver's runId order, so every name the synthesized contracts can carry is
    // scripted (spec §11 M5): `reconcile-<self>-<others sorted, joined by ->`, each writing the union in task order.
    for (const [self, other] of [["a", "b"], ["b", "a"], ["a", "d"], ["d", "a"], ["b", "d"], ["d", "b"]] as const) {
      script[`reconcile-${self}-${other}`] = { files: { "shared.txt": [self, other].sort().map((id) => `${id.toUpperCase()}\n`).join("") } };
    }
    for (const [self, x, y] of [["a", "b", "d"], ["b", "a", "d"], ["d", "a", "b"]] as const) script[`reconcile-${self}-${x}-${y}`] = { files: { "shared.txt": "A\nB\nD\n" } };
    const w = await world(["a", "b", "d"].map((id) => ({ taskId: id, targetPaths: ["shared.txt", `${id}.txt`] })), script);
    const runtime = await w.boot(); try {
      // Execution driver deviation D12: the default reserve cannot afford a reconciliation until another run settles.
      await startGroup(runtime, w.repoId, 10_000_000);
      runtime.startPump(50);
      await inExecute(w, runtime, ["a", "b", "d"]);
      const requestIds = await handoffStop(runtime);
      expect(requestIds).toHaveLength(3);
      await until(() => requestIds.every((id) => requestState(runtime, id) === "settled-recoverable"), 120_000, "three requests to settle recoverable");
      expect(w.landings()).toBe(0);
      const selections = await resumeAsThePanelWould(runtime);
      // The read model lists runs in runId order, which is not task order: all three are offered, in whatever order.
      expect(selections.map((selection) => selection.taskId).sort()).toEqual(["a", "b", "d"]);
      await until(() => { noBlocked(runtime); return ["a", "b", "d"].every((id) => work(runtime, id).status === "done") && workRuns(runtime).every((run) => run.body.drive?.cleanedUp === true); }, 360_000, "three continuations to land");
      expect(w.show("shared.txt")).toBe("A\nB\nD");
      expect([w.show("a.txt"), w.show("b.txt"), w.show("d.txt")]).toEqual(["A2", "B2", "D2"]);
      // spec §9.2 H2 (N2): one landing per task along orca/g's first parent -- no "tip moved, land again".
      expect(w.landings()).toBe(3);
      // spec §13.2 I-6: reconciliations counted from fake codex's own log, never from spawnSeq or a runs directory.
      expect(w.scripted().filter((line) => line.startsWith("execute reconcile-"))).toHaveLength(2);
      // spec §5.2 N1: the second reconciliation's other side is both earlier landings.
      const reconciled = workRuns(runtime).filter((run) => run.body.drive.reconcile !== null);
      expect(reconciled.map((run) => (run.body.drive.reconcile.otherTaskIds ?? [run.body.drive.reconcile.otherTaskId]).length).sort()).toEqual([1, 2]);
      // spec §11 I7: every reconciliation's spend is booked on the group, under its own key.
      expect(Number(runtime.store.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE id LIKE 'reconcile-usage:%'").get()!.n)).toBe(2);
      // Three stopped predecessors (plan, execute), three continuations (plan, execute, verify), two
      // reconciliations (plan, execute; their synthesized command verifier calls no provider): 6 + 9 + 4 = 19.
      expect(["plan", "execute", "verify"].map((phase) => w.calls().filter((call) => call === phase).length)).toEqual([8, 8, 3]);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });

  it("H5: a run already landing when the stop arrives lands, its request settles beside it, the panel offers only the stopped one, and one resume continues it and claims the dependent", async () => {
    const w = await world([
      { taskId: "a", targetPaths: ["a.txt"], verifierType: "command" },
      { taskId: "b", targetPaths: ["b1.txt", "b2.txt"] },
      { taskId: "c", dependsOn: ["a"], targetPaths: ["c.txt"], verifierType: "command" },
    ], {
      a: { files: { "a.txt": "A\n" } }, c: { files: { "c.txt": "C\n" } },
      b: { files: { "b1.txt": "B1\n" }, delayMs: { execute: 20_000 } }, "b#continuation": { files: { "b2.txt": "B2\n" } },
    });
    try {
      // a is caught between its landing and the record of it (execution driver R1's D-after-cas), so at the
      // stop it is `collected` with orca/g already moved -- the "already landing" row of spec §3.
      const first = await w.boot(crashAt("D-after-cas"));
      await startGroup(first, w.repoId);
      first.startPump(50);
      await until(() => first.driver?.crashed === "D-after-cas", 120_000, "a to reach its compare-and-swap");
      await inExecute(w, first, ["b"]);
      const [a] = runsOf(first, "a"), [b] = runsOf(first, "b");
      expect([a!.body.state, b!.body.state]).toEqual(["collected", "accepted"]);
      const requestIds = await handoffStop(first);
      expect(requestIds).toHaveLength(2);
      w.die(first);
      const second = await w.boot();
      second.startPump(50);
      await until(() => requestIds.every((id) => requestState(second, id) === "settled-recoverable"), 120_000, "both requests to settle recoverable");
      // spec §11 C1: a settled normally -- done, settled, cleaned up -- and its request settled beside it.
      expect(work(second, "a").status).toBe("done");
      expect(readDriverRun(second.store, a!.runId)).toMatchObject({ state: "settled", drive: { cleanedUp: true } });
      expect(w.show("a.txt")).toBe("A");
      expect(w.landings()).toBe(1);
      expect(readStopIntent(second.store, "g")!.state).toBe("handoff-complete");
      // spec §13.1 C-4: both display settled-recoverable; only the stopped one is continuable.
      const view = readControlGroup(second.store, second.epoch, "g");
      expect(view.runs.filter((run) => run.taskId !== null).map((run) => [run.taskId, run.state, run.continuable]).sort())
        .toEqual([["a", "settled-recoverable", false], ["b", "settled-recoverable", true]]);
      const selections = await resumeAsThePanelWould(second);
      expect(selections.map((selection) => selection.taskId)).toEqual(["b"]);
      await until(() => { noBlocked(second); return ["a", "b", "c"].every((id) => work(second, id).status === "done") && workRuns(second).every((run) => run.body.drive?.cleanedUp === true); }, 300_000, "b's continuation and c to settle");
      const [c] = runsOf(second, "c");
      expect(isAncestor(w.repo, readDriverRun(second.store, a!.runId).drive!.landedCommit!, c!.body.drive.base)).toBe(true);
      expect([w.show("b1.txt"), w.show("b2.txt"), w.show("c.txt")]).toEqual(["B1", "B2", "C"]);
      expect(w.landings()).toBe(3);
      expect([...w.scripted()].sort()).toEqual(["execute a", "execute b", "execute b#continuation", "execute c", "plan a", "plan b", "plan b#continuation", "plan c", "verify b"]);
      expect(await second.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });

  it("H6: a graceful shutdown freezes nothing in a driver-owned group, and the restarted panel dispatches the next task with no command", async () => {
    const w = await world([
      { taskId: "a", targetPaths: ["a.txt"], verifierType: "command" },
      { taskId: "b", dependsOn: ["a"], targetPaths: ["b.txt"], verifierType: "command" },
    ], { a: { files: { "a.txt": "A\n" }, delayMs: { execute: 4_000 } }, b: { files: { "b.txt": "B\n" } } });
    try {
      const first = await w.boot();
      await startGroup(first, w.repoId);
      first.startPump(50);
      await inExecute(w, first, ["a"]);
      expect(await first.shutdown()).toBe(true);
      // spec §12(3), §13.2 I-8: the shutdown's own ledger entry says why the group was left alone.
      const recorded = lookupCommandResult(first.store, "@global", shutdownCommandId(first.epoch))!.body as { result: { groups: Array<{ groupId: string; disposition: string }> } };
      expect(recorded.result.groups).toEqual([expect.objectContaining({ groupId: "g", disposition: "skipped-driver-owned" })]);
      expect(Number(first.store.db.prepare("SELECT COUNT(*) AS n FROM stop_intents").get()!.n)).toBe(0);
      expect(stopped(first)).toBe(false);
      w.die(first);
      const second = await w.boot();
      second.startPump(50);
      await until(() => { noBlocked(second); return work(second, "b").status === "done" && workRuns(second).every((run) => run.body.drive?.cleanedUp === true); }, 240_000, "a and then b to settle after the restart");
      expect(workRuns(second).map((run) => [run.task, run.body.state])).toEqual(expect.arrayContaining([["a", "settled"], ["b", "settled"]]));
      expect(readStopIntent(second.store, "g")).toBeNull();
      expect(stopped(second)).toBe(false);
      expect([w.show("a.txt"), w.show("b.txt")]).toEqual(["A", "B"]);
      expect(w.calls()).toEqual(["plan", "execute", "plan", "execute"]);
      expect(await second.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });

  // H7 (a non-driver run still active at shutdown freezes the group as before) needs an active estimate run,
  // which this world cannot make: the estimator here is blocked-capability (execution driver deviation D1).
  // It is covered by T7's unit criterion in tests/panel/shutdownDriverGroup.test.ts
  // ("H7: freezes a driver-owned group as before while a non-driver run (an estimate) is active in it").

  it("G: a delivered stop that yields nothing turns outcome-unknown only past deadline + the adapter's killGraceMs + 60 s", async () => {
    const w = await world([{ taskId: "a", targetPaths: ["a1.txt"] }], { a: { files: { "a1.txt": "A1\n" }, delayMs: { execute: 8_000 } } });
    const runtime = await w.boot(); try {
      await startGroup(runtime, w.repoId);
      runtime.startPump(50);
      await inExecute(w, runtime, ["a"]);
      const [a] = runsOf(runtime, "a");
      // ccloop's worker is killed, so no candidate can ever be written: nothing arrives, by construction.
      const accepted = JSON.parse(readFileSync(join(a!.body.drive.sourceDir, "control", "accepted.json"), "utf8")) as { worker: { pid: number } };
      process.kill(accepted.worker.pid, "SIGKILL");
      const deadlineAt = new Date(Date.now() + 2_000).toISOString();
      const [requestId] = await handoffStop(runtime, { handoffDeadlineAt: deadlineAt });
      await until(() => requestState(runtime, requestId!) === "outcome-unknown", 180_000, "the request to turn outcome-unknown");
      const observed = Date.now();
      // The grace the assembly read from this world's adapter config (killGraceMs 5 s) is what the driver used:
      // HANDOFF_EXTRA_GRACE_MS alone would have turned it at deadline + 60 s.
      expect(observed).toBeGreaterThanOrEqual(Date.parse(deadlineAt) + KILL_GRACE_MS + 60_000);
      expect(observed).toBeLessThan(Date.parse(deadlineAt) + KILL_GRACE_MS + 60_000 + 30_000);
      // spec §11 I3: outcome-unknown never kills anything and never lands anything; the run is left as it was.
      expect(readDriverRun(runtime.store, a!.runId).state).toBe("accepted");
      expect(w.landings()).toBe(0);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });

  // Handoff delivery spec §12 (criteria additions) and §13.1 C-3, under the controller's rulings D-C3 (ccloop T2:
  // an aborted phase reports the usage it was observed spending) and D-C7' (a phase the handoff deadline
  // interrupted is not listed missing).
  it("deadline: a phase aborted at the request's deadline still leaves a recoverable checkpoint, and its continuation lands", async () => {
    const w = await world(HALVES_TASKS, {
      a: { files: { "a1.txt": "A1\n" }, delayMs: { execute: 120_000 }, usageBeforeDelay: true },
      "a#continuation": { files: { "a1.txt": "A1\n", "a2.txt": "A2\n" } },
    });
    const runtime = await w.boot(); try {
      await startGroup(runtime, w.repoId);
      runtime.startPump(50);
      await inExecute(w, runtime, ["a"]);
      const [a] = runsOf(runtime, "a");
      const [requestId] = await handoffStop(runtime, { handoffDeadlineAt: new Date(Date.now() + 3_000).toISOString() });
      await until(() => ["settled-recoverable", "settled-unrecoverable", "outcome-unknown"].includes(requestState(runtime, requestId!)), 120_000, "the request to settle");
      const parked = readDriverRun(runtime.store, a!.runId) as unknown as Record<string, any>;
      const checkpoint = checkpointOf(runtime, parked.checkpointId);
      // ccloop C6: its own request is answered even though the phase was cut; C-3: the cut phase's usage was observed.
      expect(checkpoint).toMatchObject({ result: "partial", unresolvedRequestIds: [], missing: [] });
      const usage = runtime.store.db.prepare("SELECT body FROM usage_events WHERE run_id=? ORDER BY seq").all(a!.runId).map((row) => JSON.parse(String(row.body)));
      expect(usage.length).toBeGreaterThan(0);
      expect(usage.every((event) => event.cumulative !== null)).toBe(true);
      expect(requestState(runtime, requestId!)).toBe("settled-recoverable");
      await resumeAsThePanelWould(runtime);
      await until(() => { noBlocked(runtime); return work(runtime, "a").status === "done" && runsOf(runtime, "a").every((run) => run.body.drive?.cleanedUp === true); }, 240_000, "the continuation to land");
      expect([w.show("a1.txt"), w.show("a2.txt")]).toEqual(["A1", "A2"]);
      expect(w.calls()).toEqual(HALVES_CALLS);
      expect(w.scripted()).toEqual(HALVES_SCRIPTED);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });

  it.each(["H-after-deliver", "H-after-candidate", "A2-after-bundle", "B-after-accept"] as const)(
    "R-H %s: a death between a handoff action and its record ends where H1 ends, spending no more", async (point) => {
      const w = await world(HALVES_TASKS, HALVES);
      try {
        const first = await w.boot(crashAt(point));
        await startGroup(first, w.repoId);
        first.startPump(50);
        if (point === "B-after-accept") await until(() => first.driver?.crashed === point, 120_000, `the crash at ${point}`);
        // ccloop runs on without the driver; the stop is sent once its execute has begun, as in H1.
        await inExecute(w, first, ["a"]);
        const [requestId] = await handoffStop(first);
        if (point === "A2-after-bundle") {
          await until(() => requestState(first, requestId!) === "settled-recoverable", 120_000, "the request to settle recoverable");
          await resumeAsThePanelWould(first);
        }
        await until(() => first.driver?.crashed === point, 120_000, `the crash at ${point}`);
        w.die(first);
        const second = await w.boot();
        second.startPump(50);
        if (point !== "A2-after-bundle") {
          await until(() => requestState(second, requestId!) === "settled-recoverable", 120_000, "the request to settle recoverable after the restart");
          await resumeAsThePanelWould(second);
        }
        await until(() => { noBlocked(second); return work(second, "a").status === "done" && runsOf(second, "a").every((run) => run.body.drive?.cleanedUp === true); }, 240_000, "the continuation to land after the restart");
        expect([w.show("a1.txt"), w.show("a2.txt")]).toEqual(["A1", "A2"]);
        expect(w.landings()).toBe(1);
        // No more provider calls and no more ccloop runs than the uncrashed H1.
        expect(w.calls()).toEqual(HALVES_CALLS);
        expect(w.scripted()).toEqual(HALVES_SCRIPTED);
        expect(sourceDirs(second)).toHaveLength(2);
        expect(await second.shutdown()).toBe(true);
      } finally { await w.teardown(); }
    });

  it("R-H H-between-commit-and-settle: a death after a landed run settled and before its request did ends settled, and an empty resume reopens the group", async () => {
    const w = await world([{ taskId: "a", targetPaths: ["a.txt"], verifierType: "command" }], { a: { files: { "a.txt": "A\n" } } });
    try {
      const first = await w.boot(crashAt("D-after-cas"));
      await startGroup(first, w.repoId);
      first.startPump(50);
      await until(() => first.driver?.crashed === "D-after-cas", 120_000, "a to reach its compare-and-swap");
      const [requestId] = await handoffStop(first);
      w.die(first);
      const second = await w.boot(crashAt("H-between-commit-and-settle"));
      second.startPump(50);
      await until(() => second.driver?.crashed === "H-between-commit-and-settle", 120_000, "the crash between settle and request");
      // The run settled through E; its request, never delivered (a landing run is not interrupted), is still open.
      expect(runsOf(second, "a")[0]!.body.state).toBe("settled");
      expect(requestState(second, requestId!)).toBe("request-pending");
      w.die(second);
      const third = await w.boot();
      third.startPump(50);
      await until(() => requestState(third, requestId!) === "settled-recoverable", 120_000, "the request to settle after the restart");
      const [a] = runsOf(third, "a");
      expect(a!.body).toMatchObject({ state: "settled", drive: { cleanedUp: true } });
      expect(work(third, "a").status).toBe("done");
      expect(w.show("a.txt")).toBe("A");
      expect(w.landings()).toBe(1);
      expect(w.calls()).toEqual(["plan", "execute"]);
      expect(sourceDirs(third)).toHaveLength(1);
      // spec §13.1 I-4: nothing is continuable, and the panel's "Resume (no continuation)" -- no selections -- reopens it.
      expect(readStopIntent(third.store, "g")!.state).toBe("handoff-complete");
      expect(await resumeAsThePanelWould(third)).toEqual([]);
      expect(stopped(third)).toBe(false);
      expect(await third.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });
});
