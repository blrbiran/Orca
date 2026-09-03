import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { runTask } from "../../../src/scheduler/ccloopRunner.js";
import { buildGraph } from "../../../src/scheduler/graph.js";
import { disposition, harvest, sameLayerWriteSets } from "../../../src/scheduler/harvest.js";
import { allocateRunId } from "../../../src/scheduler/runId.js";
import { headOf, makeSandbox, seedTasks, writeScriptedConfig } from "../sandbox.js";

describe("S6 (spec §7.3 direction one, second tier: out of bounds but disjoint)", () => {
  it("S6: out-of-bounds writes that touch nobody else land anyway, with a boundary decision", async () => {
    // The money is already spent -- §7.0's point is that C cannot detect drift
    // until after the run has been paid for, and there is no "un-write" to roll
    // back to. All that is left to decide is whether the work enters W.
    //
    // Declaring too narrowly is common and usually harmless, so throwing the
    // work away here would be enormous waste for no safety gain: nobody else in
    // this layer claims the stray path, so nobody else can have been broken by
    // it. It lands, and the judgement is recorded (tier 1, `kind: boundary`)
    // and contributes exit 2 -- visible, not silent.
    const s = await makeSandbox();
    try {
      const base = await headOf(s.targetRepo);
      const { plan, contracts } = await seedTasks(s, [
        {
          taskId: "T1",
          contract: {
            goal: "write a.txt",
            targetPaths: ["a.txt"],
            // Writes one declared path and one that nothing in the plan
            // declares. Both are real files in the attempt worktree, so the
            // out-of-bounds write is measured from the tree rather than
            // asserted by the fixture.
            requiredChecks: ["printf 'x' > a.txt && printf 'y' > stray.txt"],
            buildTestCommands: ["true"],
          },
        },
        { taskId: "T2", contract: { goal: "write b.txt", targetPaths: ["b.txt"], requiredChecks: ["true"] } },
      ]);
      const graph = buildGraph(plan, contracts);
      // Guards the fixture twice over: the pair must be same-layer (otherwise
      // §7.3's escalation tier could not apply even in principle, and S6 would
      // be green for the wrong reason), and T2 must claim something the stray
      // path misses.
      expect(graph.layers).toEqual([["T1", "T2"]]);

      const t1 = plan.tasks[0];
      const runId = await allocateRunId(s.runsDir, "T1", await readFile(t1.contract), base);
      const run = await runTask(plan, t1, base, runId, {
        adapter: "scripted",
        adapterConfig: await writeScriptedConfig(s, "T1", [{}]),
      });
      expect(run.outcome).toBe("succeeded");

      const r = await harvest(run, base, graph.writeSets.get("T1")!);
      expect(r.actualPaths).toEqual(["a.txt", "stray.txt"]);
      expect(r.outOfBounds).toEqual(["stray.txt"]);
      expect(r.empty).toBe(false);

      const d = disposition(r, sameLayerWriteSets(graph, "T1"));
      expect(d.land).toBe(true);
      expect(d.exitContribution).toBe(2);
    } finally {
      await s.cleanup();
    }
  }, 180_000);
});
