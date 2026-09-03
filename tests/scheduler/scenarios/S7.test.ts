import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { runTask } from "../../../src/scheduler/ccloopRunner.js";
import { buildGraph } from "../../../src/scheduler/graph.js";
import { disposition, harvest, sameLayerWriteSets } from "../../../src/scheduler/harvest.js";
import { allocateRunId } from "../../../src/scheduler/runId.js";
import { headOf, makeSandbox, seedTasks, writeScriptedConfig } from "../sandbox.js";

describe("S7 (spec §7.3 direction one, first tier: out of bounds and intersecting)", () => {
  it("S7: out-of-bounds writes that intersect a sibling in the same layer refuse to land and escalate", async () => {
    // The one case where an out-of-bounds write is not merely untidy: only
    // SAME-LAYER tasks start from the same W HEAD unable to see each other, so
    // only there can one task silently break another. The layering decision
    // that put these two in the same layer was made from their DECLARATIONS,
    // and this run just proved that declaration wrong -- which means the
    // parallelism verdict itself may already be invalid, and no landing order
    // can be argued to be safe. Refuse to land, escalate (exit 3).
    //
    // A later layer's overlap is deliberately NOT this case: it starts from a W
    // that already contains this task's result, so it inherits rather than
    // races, and its overlap surfaces as an ordinary merge conflict that §5
    // handles.
    const s = await makeSandbox();
    try {
      const base = await headOf(s.targetRepo);
      const { plan, contracts } = await seedTasks(s, [
        {
          taskId: "T1",
          contract: {
            goal: "write a.txt",
            targetPaths: ["a.txt"],
            // b.txt is exactly what T2 declares. T1 never declares it, so the
            // graph has no reason to serialise the pair -- this is "declared
            // disjoint, actually collided", detectable only after the fact.
            requiredChecks: ["printf 'x' > a.txt && printf 'y' > b.txt"],
            buildTestCommands: ["true"],
          },
        },
        { taskId: "T2", contract: { goal: "write b.txt", targetPaths: ["b.txt"], requiredChecks: ["true"] } },
      ]);
      const graph = buildGraph(plan, contracts);
      // Load-bearing, not decoration: if the declarations had overlapped, the
      // graph would have serialised the pair and there would be no unsafe
      // parallelism for §7.3 to catch. The scenario only means anything while
      // these two are in one layer.
      expect(graph.layers).toEqual([["T1", "T2"]]);

      const t1 = plan.tasks[0];
      const runId = await allocateRunId(s.runsDir, "T1", await readFile(t1.contract), base);
      const run = await runTask(plan, t1, base, runId, {
        adapter: "scripted",
        adapterConfig: await writeScriptedConfig(s, "T1", [{}]),
      });
      expect(run.outcome).toBe("succeeded");

      const r = await harvest(run, base, graph.writeSets.get("T1")!);
      expect(r.actualPaths).toEqual(["a.txt", "b.txt"]);
      expect(r.outOfBounds).toEqual(["b.txt"]);

      const siblings = sameLayerWriteSets(graph, "T1");
      // Guards the fixture: with an empty or self-only sibling map the
      // intersection can never be found and this scenario degenerates into S6.
      expect([...siblings.keys()]).toEqual(["T2"]);

      const d = disposition(r, siblings);
      expect(d.land).toBe(false);
      expect(d.exitContribution).toBe(3);
    } finally {
      await s.cleanup();
    }
  }, 180_000);
});
