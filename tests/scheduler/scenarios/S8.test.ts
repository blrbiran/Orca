import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { routeOutcome, runTask } from "../../../src/scheduler/ccloopRunner.js";
import { buildGraph } from "../../../src/scheduler/graph.js";
import { allocateRunId } from "../../../src/scheduler/runId.js";
import {
  headOf,
  makeSandbox,
  runCli,
  seedFanOutPlan,
  seedRunnablePlan,
  taskWorkdirs,
  writeFileCheck,
  writeScriptedConfig,
} from "../sandbox.js";

describe("S8 (spec §6.1: a failed task)", () => {
  it("S8: a failed task marks its descendants upstream_not_run and lets other branches continue", async () => {
    // spec §6.1 withdrew the crude rule "non-succeeded ⇒ all descendants
    // blocked" because the four non-success terminal states carry completely
    // different information. This scenario pins the `failed` row of that
    // table: the task counts as a failure, only ITS descendants stop, and the
    // unrelated branch is still schedulable — and really does run green,
    // rather than merely being reported as runnable.
    const s = await makeSandbox();
    try {
      const base = await headOf(s.targetRepo);
      // Measured on ccloop 7f2c5f6: a rejected verification with maxAttempts 2
      // lands on `failed`, because stopController's `attemptNumber >=
      // maxAttempts` test (which would give `exhausted`) is checked before the
      // safeToRetry test that produces `failed`. maxAttempts 1 would therefore
      // give the wrong terminal state for this scenario.
      const { plan, contracts } = await seedFanOutPlan(s, {
        goal: "write a.txt",
        targetPaths: ["a.txt"],
        requiredChecks: ["false"],
        maxAttempts: 2,
      });
      const graph = buildGraph(plan, contracts);
      // Guards the fixture itself: if T3 ever acquired an edge to T1 or T2,
      // "other branches continue" would have no other branch to continue on
      // and every assertion below would still pass.
      expect(graph.layers).toEqual([["T1", "T3"], ["T2"]]);

      const t1 = plan.tasks.find((t) => t.taskId === "T1")!;
      const id1 = await allocateRunId(s.runsDir, "T1", await readFile(t1.contract), base);
      const r1 = await runTask(plan, t1, base, id1, {
        adapter: "scripted",
        adapterConfig: await writeScriptedConfig(s, "T1", [{}, {}]),
      });
      expect(r1.outcome).toBe("failed");

      const route = routeOutcome(graph, "T1", r1.outcome);
      expect(route.countsAsFailure).toBe(true);
      expect(route.escalates).toBe(false);
      expect(route.stopRound).toBe(false);
      expect(route.upstreamNotRun).toEqual(["T2"]);

      const stillRunnable = plan.tasks
        .filter((t) => t.taskId !== "T1" && !route.upstreamNotRun.includes(t.taskId))
        .map((t) => t.taskId);
      expect(stillRunnable).toEqual(["T3"]);

      const t3 = plan.tasks.find((t) => t.taskId === "T3")!;
      const id3 = await allocateRunId(s.runsDir, "T3", await readFile(t3.contract), base);
      const r3 = await runTask(plan, t3, base, id3, {
        adapter: "scripted",
        adapterConfig: await writeScriptedConfig(s, "T3", [{}]),
      });
      expect(r3.outcome).toBe("succeeded");

      // Fix round 1, finding 4: an assertion that T2 has no run directory used
      // to sit here. Nothing in this task decides what to run, so this test
      // never creates one and no mutation of this module could make it red.
      // "a task whose upstream failed is never started" becomes measurable
      // only once an orchestrator exists to decide — proved below, now that
      // Task 14's `runRound` is that orchestrator. (S9's identical deferral
      // comment shares this exact mechanism — the same `notRun` set and the
      // same `route.upstreamNotRun` propagation in run.ts — so one criterion
      // and one mutation here cover both.)
    } finally {
      await s.cleanup();
    }
  }, 180_000);

  it("S8 (deferred property, Task 14): a task whose upstream failed gets no run directory at all", async () => {
    // T1 fails (requiredChecks ["false"], maxAttempts 2 -> `failed`, per the
    // measured routing table above). T2 depends on T1 and would itself fail
    // if it ever ran (requiredChecks ["false"], maxAttempts 1 -> `exhausted`,
    // which is KEPT rather than deleted) -- deliberately, so "T2 never got a
    // run directory" is distinguishable from "T2 ran, failed, and its kept
    // directory happens to look the same as never having run". T3 is
    // independent and succeeds, so it lands and its (successful) copy IS
    // deleted -- a second, opposite control on the same measurement.
    const s = await makeSandbox();
    try {
      const p = await seedRunnablePlan(s, [
        {
          taskId: "T1",
          contract: { goal: "write a.txt", targetPaths: ["a.txt"], requiredChecks: ["false"], maxAttempts: 2, buildTestCommands: ["true"] },
        },
        {
          taskId: "T2",
          contract: { goal: "write b.txt", targetPaths: ["b.txt"], requiredChecks: ["false"], maxAttempts: 1, buildTestCommands: ["true"] },
          dependsOn: ["T1"],
        },
        {
          taskId: "T3",
          contract: { goal: "write c.txt", targetPaths: ["c.txt"], requiredChecks: [writeFileCheck("c.txt", "c1")], buildTestCommands: ["true"] },
        },
      ]);

      const rc = await runCli(["run", p.planPath, "--adapter-config", p.adapterConfig]);
      // T1 failed (contributes 2), T3 succeeded and landed (contributes 0);
      // T2 never ran, so it contributes nothing at all. 3>2>1>0 gives 2.
      expect(rc).toBe(2);

      const dirs = await taskWorkdirs(s);
      // The deferred property itself: T2 never even got a run directory --
      // not "got one and it was cleaned up", which taskWorkdirs cannot tell
      // apart from "never created" on its own. The two controls below are
      // what make that distinction real: T1's kept (non-succeeded) copy IS
      // there, and T3's successful copy is NOT (deleted after landing), so
      // "absent" demonstrably means two different things depending on which
      // task it is about, and T2 lands on the "never ran" side of that.
      expect(dirs.some((d) => d.includes("-T1-"))).toBe(true);
      expect(dirs.some((d) => d.includes("-T3-"))).toBe(false);
      expect(dirs.some((d) => d.includes("-T2-"))).toBe(false);
    } finally {
      await s.cleanup();
    }
  }, 60_000);
});
