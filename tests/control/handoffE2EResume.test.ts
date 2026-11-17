import { afterAll, describe, expect, it } from "vitest";
import { lookupCommandResult } from "../../src/control/commandLedger.js";
import { readDriverRun } from "../../src/control/executionDriver.js";
import { readStopIntent } from "../../src/control/stopIntent.js";
import { shutdownCommandId } from "../../src/panel/controlLifecycle.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { ccloopWorlds, noBlocked, realBinary, startGroup, until, workRuns } from "./fixtures/ccloopWorld.js";
import {
  crashAt, HALVES, HALVES_CALLS, HALVES_SCRIPTED, HALVES_TASKS, handoffStop, inExecute, isAncestor, requestState, resumeAsThePanelWould, runsOf,
  stopped, work,
} from "./fixtures/handoffE2E.js";

/**
 * Handoff delivery spec §9.2 (H3, H5, H6) against the real ccloop build; split out of handoffE2E.test.ts (test pruning,
 * 2026-11-17), whose header states the claim and the build these cases need. Bodies moved verbatim.
 */
const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-handoff-e2e-resume-", epochPrefix: "epoch-handoff-e2e-resume-" });
// Retried for the same reason as executionDriverE2E.test.ts: a failed scenario may leave a background
// reconciliation `ccloop run` (or an orphaned fake codex) still writing under the root for a moment.
afterAll(removeRoots);

describe.skipIf(!realBinary)("handoff delivery against real ccloop (spec §9.2) -- dependents, a landing run, shutdown", { timeout: 420_000 }, () => {
  relocateHome("orca-handoff-e2e-resume-home-");

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
      // spec §4.1: `held`, then continuing, is not `done` -- every poll until c appears proves a's whole work landed by then.
      // Ruling (2026-11-12, tester follow-up G): 「这次批准改写所有必要的判据」 — §6.1 (#192) claims a dependent once its
      // dependency's run landed, before that run settles, so "landed" replaces "done" here; parked or continuing still
      // holds c back (neither has a landed commit). Was: c claimed only once a is `done`.
      const aLanded = () => work(runtime, "a").status === "done" || runsOf(runtime, "a").some((run) => run.body.continuationIntentId && typeof run.body.drive?.landedCommit === "string");
      await until(() => {
        noBlocked(runtime);
        if (runsOf(runtime, "c").length > 0 && !aLanded()) throw new Error(`c was claimed while a is ${work(runtime, "a").status}`);
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
});
