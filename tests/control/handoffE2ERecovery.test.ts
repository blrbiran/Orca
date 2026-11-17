import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readDriverRun } from "../../src/control/executionDriver.js";
import { readStopIntent } from "../../src/control/stopIntent.js";
import { releaseOnly } from "../helpers/releaseGate.js";
import { ccloopWorlds, KILL_GRACE_MS, noBlocked, realBinary, startGroup, until } from "./fixtures/ccloopWorld.js";
import {
  checkpointOf, crashAt, HALVES, HALVES_CALLS, HALVES_SCRIPTED, HALVES_TASKS, handoffStop, inExecute, requestState, resumeAsThePanelWould, runsOf,
  sourceDirs, stopped, work,
} from "./fixtures/handoffE2E.js";

/**
 * Handoff delivery spec §3 grace (G), worker-lost (H-lost), §12 deadline and §9.2 R-H against the real ccloop build;
 * split out of handoffE2E.test.ts (test pruning, 2026-11-17), whose header states the claim and the build these cases
 * need. Bodies moved verbatim.
 */
const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-handoff-e2e-recovery-", epochPrefix: "epoch-handoff-e2e-recovery-" });
// Retried for the same reason as executionDriverE2E.test.ts: a failed scenario may leave a background
// reconciliation `ccloop run` (or an orphaned fake codex) still writing under the root for a moment.
afterAll(removeRoots);

describe.skipIf(!realBinary)("handoff delivery against real ccloop (spec §9.2) -- grace, lost worker, deadline, crash points", { timeout: 420_000 }, () => {
  relocateHome("orca-handoff-e2e-recovery-home-");

  // Ruling (2026-11-12, tester follow-up H): G killed ccloop's worker to make "nothing arrive"; with #273 a dead worker is
  // settled as worker-lost (and its open request closes from that terminal, "H-lost" below), so G now freezes the worker
  // instead (SIGSTOP): it is alive -- ccloop reports no lost worker -- and yields nothing. G's point, the grace timing, is
  // unchanged; the worker is killed after the assertions.
  //
  // Ruling: human 2026-11-17 (test pruning) -- G no longer waits the production 60 s: the driver's fixed extra grace is
  // injected short (G_EXTRA_GRACE_MS, through the handoffExtraGraceMs seam), and the run's frozen killGraceMs is still
  // what G measures. The 60 s value is pinned by tests/panel/assemblyHandoffGrace.test.ts and, as the driver's default,
  // by driverHandoff.test.ts "does not call a request outcome-unknown before the killGraceMs ...".
  it("G: a delivered stop that yields nothing turns outcome-unknown only past deadline + the adapter's killGraceMs + the fixed extra grace", async () => {
    const G_EXTRA_GRACE_MS = 5_000;
    const w = await world([{ taskId: "a", targetPaths: ["a1.txt"] }], { a: { files: { "a1.txt": "A1\n" }, delayMs: { execute: 8_000 } } });
    let frozen: number | null = null;
    const runtime = await w.boot(undefined, undefined, { handoffExtraGraceMs: G_EXTRA_GRACE_MS }); try {
      await startGroup(runtime, w.repoId);
      runtime.startPump(50);
      await inExecute(w, runtime, ["a"]);
      const [a] = runsOf(runtime, "a");
      // ccloop's worker is frozen, so no candidate can be written while it stays alive: nothing arrives, by construction.
      const accepted = JSON.parse(readFileSync(join(a!.body.drive.sourceDir, "control", "accepted.json"), "utf8")) as { worker: { pid: number } };
      frozen = accepted.worker.pid;
      process.kill(frozen, "SIGSTOP");
      const deadlineAt = new Date(Date.now() + 2_000).toISOString();
      const [requestId] = await handoffStop(runtime, { handoffDeadlineAt: deadlineAt });
      await until(() => requestState(runtime, requestId!) === "outcome-unknown", 180_000, "the request to turn outcome-unknown");
      const observed = Date.now();
      // The grace is the run's frozen killGraceMs (the world's installation table answers 5 s at confirmation):
      // the extra grace alone would have turned it at deadline + G_EXTRA_GRACE_MS.
      // mutation: the driver ignores deps.handoffExtraGraceMs -> waits 60 s, past the upper bound, red
      expect(observed).toBeGreaterThanOrEqual(Date.parse(deadlineAt) + KILL_GRACE_MS + G_EXTRA_GRACE_MS);
      expect(observed).toBeLessThan(Date.parse(deadlineAt) + KILL_GRACE_MS + G_EXTRA_GRACE_MS + 30_000);
      // spec §11 I3: outcome-unknown never kills anything and never lands anything; the run is left as it was.
      expect(readDriverRun(runtime.store, a!.runId).state).toBe("accepted");
      expect(w.landings()).toBe(0);
      expect(await runtime.shutdown()).toBe(true);
    } finally { if (frozen !== null) { try { process.kill(frozen, "SIGKILL"); } catch { /* already gone */ } } await w.teardown(); }
  });

  // Worker-lost recovery spec, as-built Orca half item 9 (#273): a delivered stop whose run then loses its worker cannot be
  // answered by that worker. ccloop settles the run as worker-lost, the run blocks on that failed terminal, and the request
  // closes from it at once -- not outcome-unknown at the grace, which here (a deadline 10 min away) is far off. The group
  // is stopped, so Orca does not start the task again.
  it("H-lost: a stop open on a run whose worker dies closes from the worker-lost terminal, long before the grace", async () => {
    const w = await world([{ taskId: "a", targetPaths: ["a1.txt"] }], { a: { files: { "a1.txt": "A1\n" }, delayMs: { execute: 120_000 } } });
    const runtime = await w.boot(); try {
      await startGroup(runtime, w.repoId);
      runtime.startPump(50);
      await inExecute(w, runtime, ["a"]);
      const [a] = runsOf(runtime, "a");
      const [requestId] = await handoffStop(runtime, { handoffDeadlineAt: new Date(Date.now() + 600_000).toISOString() });
      await until(() => requestState(runtime, requestId!) === "collecting", 60_000, "the stop to be delivered");
      const accepted = JSON.parse(readFileSync(join(a!.body.drive.sourceDir, "control", "accepted.json"), "utf8")) as { worker: { pid: number } };
      process.kill(accepted.worker.pid, "SIGKILL");
      // mutation: deliverAndCollect ignores `worker: lost` -> the request stays collecting until the grace (timeout), red
      await until(() => !["request-pending", "collecting"].includes(requestState(runtime, requestId!)), 120_000, "the request to close");
      expect(requestState(runtime, requestId!)).toBe("settled-unrecoverable");
      const run = readDriverRun(runtime.store, a!.runId);
      expect({ outcome: run.drive?.outcome, cause: run.drive?.failureCause?.cause }).toEqual({ outcome: "failed", cause: "worker-lost" });
      expect(runsOf(runtime, "a")).toHaveLength(1);
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
      const stoppedAt = Date.now();
      const [requestId] = await handoffStop(runtime, { handoffDeadlineAt: new Date(stoppedAt + 3_000).toISOString() });
      await until(() => ["settled-recoverable", "settled-unrecoverable", "outcome-unknown"].includes(requestState(runtime, requestId!)), 120_000, "the request to settle");
      // The execute phase was cut at the deadline, not waited out: the request settled long before the phase's
      // own 120 s sleep would have ended, and ccloop recorded the interruption of that phase (D-C7').
      expect(Date.now() - stoppedAt).toBeLessThan(60_000);
      const ccloopEvents = readFileSync(join(a!.body.drive.sourceDir, "run", "events.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as { type: string; detail: unknown });
      expect(ccloopEvents).toContainEqual(expect.objectContaining({ type: "handoff_interrupted", detail: "handoff deadline interrupted execute in attempt 1" }));
      const parked = readDriverRun(runtime.store, a!.runId) as unknown as Record<string, any>;
      const checkpoint = checkpointOf(runtime, parked.checkpointId);
      // ccloop C6: its own request is answered even though the phase was cut; C-3: the cut phase's usage was observed.
      expect(checkpoint).toMatchObject({ result: "partial", unresolvedRequestIds: [], missing: [] });
      // C-3, scoped to the cut phase: the plan phase's work event alone would satisfy "every event is known", so
      // the run's work usage must be known and a later work event must have grown past the plan phase's -- the
      // execute phase's own observation, reported although the phase was aborted.
      expect(parked.unknown.work).toBe(false);
      const workUsage = runtime.store.db.prepare("SELECT body FROM usage_events WHERE run_id=? ORDER BY seq").all(a!.runId)
        .map((row) => JSON.parse(String(row.body)) as { bucket: string; cumulative: { tokens: number } | null })
        .filter((event) => event.bucket === "work");
      expect(workUsage.length).toBeGreaterThanOrEqual(2);
      expect(workUsage.every((event) => event.cumulative !== null)).toBe(true);
      expect(workUsage.at(-1)!.cumulative!.tokens).toBeGreaterThan(workUsage[0]!.cumulative!.tokens);
      expect(requestState(runtime, requestId!)).toBe("settled-recoverable");
      await resumeAsThePanelWould(runtime);
      await until(() => { noBlocked(runtime); return work(runtime, "a").status === "done" && runsOf(runtime, "a").every((run) => run.body.drive?.cleanedUp === true); }, 240_000, "the continuation to land");
      expect([w.show("a1.txt"), w.show("a2.txt")]).toEqual(["A1", "A2"]);
      expect(w.calls()).toEqual(HALVES_CALLS);
      expect(w.scripted()).toEqual(HALVES_SCRIPTED);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });

  // Ruling: human 2026-11-17 (test pruning) -- one real-ccloop crash case stays daily (B-after-accept); the other R-H
  // points run in the release gate only, each covered daily by a driver-harness test (named at each case below).
  const rhCase = async (point: "H-after-deliver" | "H-after-candidate" | "A2-after-bundle" | "B-after-accept"): Promise<void> => {
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
    };
  const RH_TITLE = "R-H %s: a death between a handoff action and its record ends where H1 ends, spending no more";
  it.each(["B-after-accept"] as const)(RH_TITLE, rhCase);
  // Release-only. Daily cover: driverHandoff.test.ts "re-delivers the identical request after a death between delivery and
  // its record (H-after-deliver) ..." and "settles once after a death between reading the candidate and settling
  // (H-after-candidate)"; driverContinuation.test.ts "A2 of a continuation after a death (... R-H A2-after-bundle)".
  it.runIf(releaseOnly).each(["H-after-deliver", "H-after-candidate", "A2-after-bundle"] as const)(RH_TITLE, rhCase);

  // Release-only. Daily cover: driverHandoff.test.ts "settles the request after a death between the run's settle and the
  // request's (R-H H-between-commit-and-settle)".
  it.runIf(releaseOnly)("R-H H-between-commit-and-settle: a death after a landed run settled and before its request did ends settled, and an empty resume reopens the group", async () => {
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
