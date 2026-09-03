import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { runTask } from "../../../src/scheduler/ccloopRunner.js";
import { buildGraph } from "../../../src/scheduler/graph.js";
import { disposition, harvest, sameLayerWriteSets } from "../../../src/scheduler/harvest.js";
import { allocateRunId } from "../../../src/scheduler/runId.js";
import { headOf, makeSandbox, seedTasks, writeScriptedConfig } from "../sandbox.js";

describe("S5 (spec §6.2 / §7.3: succeeded_but_empty)", () => {
  it("S5: a task ccloop calls succeeded but whose tree equals the base does not land", async () => {
    // Direction two of §7.1's reconciliation, and the more expensive failure in
    // this repository's history: green that is empty. ccloop cannot catch it --
    // publishAttemptCommit commits with `--allow-empty` on purpose, so a run
    // whose agent did nothing still ends `succeeded` with a real commit and a
    // real ref. Nothing below the graph layer knows anything is wrong.
    //
    // The scripted adapter is a faithful model of that failure rather than a
    // contrivance: it touches no files at all, which is exactly the shape of
    // the three silent-empty channels spec §4.4 lists.
    //
    // v1 calls it a failure even though a task can legitimately have nothing to
    // change (§6.5): the contract field that would declare "legitimately empty"
    // does not exist today, and between the two possible mistakes this
    // repository has paid for the other one.
    const s = await makeSandbox();
    try {
      const base = await headOf(s.targetRepo);
      const { plan, contracts } = await seedTasks(s, [
        { taskId: "T1", contract: { goal: "write a.txt", targetPaths: ["a.txt"], requiredChecks: ["true"] } },
        { taskId: "T2", contract: { goal: "write b.txt", targetPaths: ["b.txt"], requiredChecks: ["true"] } },
      ]);
      const graph = buildGraph(plan, contracts);
      // Guards the fixture: the two tasks must be genuinely parallel, so that
      // the verdict below comes from the empty tree and not from an accident of
      // layering.
      expect(graph.layers).toEqual([["T1", "T2"]]);

      const t1 = plan.tasks[0];
      const runId = await allocateRunId(s.runsDir, "T1", await readFile(t1.contract), base);
      const run = await runTask(plan, t1, base, runId, {
        adapter: "scripted",
        adapterConfig: await writeScriptedConfig(s, "T1", [{}]),
      });
      // The premise of the whole scenario: ccloop is happy. If this ever
      // stopped being `succeeded` the scenario would be measuring something
      // else entirely.
      expect(run.outcome).toBe("succeeded");
      expect(run.attemptSha).not.toBeNull();

      const r = await harvest(run, base, graph.writeSets.get("T1")!);
      expect(r.actualPaths).toEqual([]);
      expect(r.empty).toBe(true);

      const d = disposition(r, sameLayerWriteSets(graph, "T1"));
      expect(d.land).toBe(false);
      expect(d.exitContribution).toBe(2);
    } finally {
      await s.cleanup();
    }
  }, 180_000);
});
