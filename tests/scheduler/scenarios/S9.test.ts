import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { routeOutcome, runTask } from "../../../src/scheduler/ccloopRunner.js";
import { buildGraph } from "../../../src/scheduler/graph.js";
import { allocateRunId } from "../../../src/scheduler/runId.js";
import { headOf, makeSandbox, seedFanOutPlan, writeScriptedConfig } from "../sandbox.js";

describe("S9 (spec §6.1: a blocked task)", () => {
  it("S9: a blocked task escalates without counting as a failure, and siblings keep running", async () => {
    // `blocked_waiting_human` is the row of spec §6.1's table that a collapsed
    // "non-succeeded ⇒ failure" rule gets wrong in BOTH directions at once: it
    // needs a human (exit code 3, which §6.3 ranks above 2 precisely so the
    // thing a human must do cannot vanish into a pile of failures) and it is
    // not a failure. It is also terminal and not resumable in ccloop
    // (resumeLoop's RESUMABLE_STATUSES is planning/executing/verifying only),
    // so the escalation below is C's own and never a `ccloop resume`.
    const s = await makeSandbox();
    try {
      const base = await headOf(s.targetRepo);
      // Measured on ccloop 7f2c5f6: with `verifierType: "command"` runLoop
      // never calls the adapter's verify, so verification.pauseSignals is
      // always empty and the pauseOn route to blocked_waiting_human is dead.
      // evaluatePathPolicy over the scripted frame's changedFiles is the route
      // that works — runLoop checks it right after execute and persists
      // blocked_waiting_human before verification runs at all.
      const { plan, contracts } = await seedFanOutPlan(s, {
        goal: "write a.txt",
        targetPaths: ["a.txt"],
        requiredChecks: ["true"],
        denylistPaths: ["forbidden.txt"],
      });
      const graph = buildGraph(plan, contracts);
      // Guards the fixture: without a genuinely independent T3 there is no
      // sibling for "siblings keep running" to be about.
      expect(graph.layers).toEqual([["T1", "T3"], ["T2"]]);

      const t1 = plan.tasks.find((t) => t.taskId === "T1")!;
      const id1 = await allocateRunId(s.runsDir, "T1", await readFile(t1.contract), base);
      const r1 = await runTask(plan, t1, base, id1, {
        adapter: "scripted",
        adapterConfig: await writeScriptedConfig(s, "T1", [{ changedFiles: ["forbidden.txt"] }]),
      });
      expect(r1.outcome).toBe("blocked_waiting_human");

      const route = routeOutcome(graph, "T1", r1.outcome);
      expect(route.escalates).toBe(true);
      expect(route.countsAsFailure).toBe(false);
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

      // Fix round 1, finding 4: same as S8 — the assertion that T2 has no run
      // directory could never go red here, because nothing in this task decides
      // what to run. Deferred to Task 14, where an orchestrator makes it
      // measurable.
    } finally {
      await s.cleanup();
    }
  }, 180_000);
});
