import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { routeOutcome, runTask } from "../../../src/scheduler/ccloopRunner.js";
import { buildGraph } from "../../../src/scheduler/graph.js";
import { allocateRunId } from "../../../src/scheduler/runId.js";
import { headOf, makeSandbox, seedFanOutPlan, writeScriptedConfig } from "../sandbox.js";

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

      // "upstream_not_run" means never started, not started-and-abandoned
      // (spec §6.2, borrowed from Airflow's UPSTREAM_FAILED). A run directory
      // for T2 would mean a run id was claimed and a clone was made.
      const claimed = await readdir(s.runsDir);
      expect(claimed.filter((entry) => entry.startsWith("orca-T2-"))).toEqual([]);
    } finally {
      await s.cleanup();
    }
  }, 180_000);
});
