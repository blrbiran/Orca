import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readDriverRun, readStartEnvelope } from "../../src/control/executionDriver.js";
import { readStopIntent } from "../../src/control/stopIntent.js";
import { ccloopWorlds, g, noBlocked, PARALLEL_STOP_HOLD_MS, parallelStopPremise, realBinary, startGroup, until, workRuns, type ScriptEntry } from "./fixtures/ccloopWorld.js";
import {
  active, allocation, checkpointOf, committedAndUsed, HALVES, HALVES_CALLS, HALVES_SCRIPTED, HALVES_TASKS, handoffStop, inExecute, isAncestor,
  requestState, resumeAsThePanelWould, runsOf, snapshotHead, sourceDirs, work,
} from "./fixtures/handoffE2E.js";

/**
 * Handoff delivery spec §9.2 (H1-H3, H5, H6, R-H), §12 (the deadline case), §13.1 C-2/C-4 and §13.2 I-6 against
 * the real ccloop build (ORCA_CCLOOP_BIN, which must contain ccloop C1-C7: the scripted fake codex with
 * per-phase `delayMs`, the `<task>#continuation` key and the `<marker>.tasks` log; C6; C7; and for the deadline
 * case C-3 and D-C7'). Everything is relocated under a temporary root. The honest claim (spec §2): with fake
 * codex and a soft group, a human handoff-stop of a group the driver is running closes every frozen run by the
 * step it is at, and a resume-from-handoff continues each selected task from its checkpoint onto orca/<group>,
 * N-way included. Real codex under a handoff is not claimed here.
 */
// Split (test pruning, 2026-11-17) into this file (H1, H2), handoffE2EResume.test.ts (H3, H5, H6) and
// handoffE2ERecovery.test.ts (G, H-lost, deadline, R-H), so the cases run on parallel workers; bodies moved verbatim.
// The shared helpers live in fixtures/handoffE2E.ts.
const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-handoff-e2e-", epochPrefix: "epoch-handoff-e2e-" });
// Retried for the same reason as executionDriverE2E.test.ts: a failed scenario may leave a background
// reconciliation `ccloop run` (or an orphaned fake codex) still writing under the root for a moment.
afterAll(removeRoots);

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

  it("H2: three parallel runs stopped mid-execute all continue; the landings are serial and reconcile exactly twice, the second against both", async () => {
    const own = (id: string): ScriptEntry => ({ files: { "shared.txt": `${id.toUpperCase()}\n`, [`${id}.txt`]: `${id.toUpperCase()}\n` }, delayMs: { execute: PARALLEL_STOP_HOLD_MS } });
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
      await until(() => { parallelStopPremise(w.scripted()); return requestIds.every((id) => requestState(runtime, id) === "settled-recoverable"); }, 120_000, "three requests to settle recoverable");
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
});
