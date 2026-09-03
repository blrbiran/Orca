import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { undoHowIsExecutable } from "../../../src/ledger/undoExecutable.js";
import { runTask } from "../../../src/scheduler/ccloopRunner.js";
import { buildGraph } from "../../../src/scheduler/graph.js";
import { disposition, harvest, sameLayerWriteSets } from "../../../src/scheduler/harvest.js";
import { allocateRunId } from "../../../src/scheduler/runId.js";
import {
  headOf,
  makeSandbox,
  runCli,
  seedRunnablePlan,
  seedTasks,
  writeFileCheck,
  writeScriptedConfig,
} from "../sandbox.js";

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

  it("S7 end to end: the escalation is recorded under runsDir, never on W, with an executable undo.how", async () => {
    // Same shape as the unit-level criterion above, but through `orca run`
    // itself: this is the one call site (run.ts's `if (!verdict.land)` when
    // `verdict.exitContribution === 3`) spec §5.4's escalation file owes to
    // the "out-of-bounds-intersecting-sibling disposition" cause, distinct
    // from the reconcileAndLand convergence point S3escalations.test.ts and
    // roundFailure.test.ts exercise.
    const s = await makeSandbox();
    try {
      const p = await seedRunnablePlan(s, [
        {
          taskId: "T1",
          contract: {
            goal: "write a.txt",
            targetPaths: ["a.txt"],
            // b.txt is exactly what T2 declares; T1 never declares it.
            requiredChecks: [writeFileCheck("a.txt", "a1"), writeFileCheck("b.txt", "stolen")],
            buildTestCommands: ["true"],
          },
        },
        {
          taskId: "T2",
          contract: {
            goal: "write b.txt",
            targetPaths: ["b.txt"],
            requiredChecks: [writeFileCheck("b.txt", "b1")],
            buildTestCommands: ["true"],
          },
        },
      ]);

      const rc = await runCli(["run", p.planPath, "--adapter-config", p.adapterConfig]);
      // T1 refuses to land (escalates); T2's own write is in bounds and
      // lands independently — max(3, 0) = 3.
      expect(rc).toBe(3);

      const dir = join(s.runsDir, "escalations");
      const names = await readdir(dir);
      expect(names).toHaveLength(1);
      const escalationPath = join(dir, names[0]);
      // Never on W: runsDir and targetRepo are sandbox siblings, so this
      // alone proves the file never entered the target repository at all.
      expect(escalationPath.startsWith(s.targetRepo)).toBe(false);

      const text = await readFile(escalationPath, "utf8");
      expect(text).toContain("T1");
      expect(text).toContain("b.txt");
      const how = /- how: `([^`]+)`/.exec(text)?.[1];
      expect(how).not.toBeUndefined();
      // Mutation: delete the `writeEscalationFile` call in run.ts's
      // disposition-collide branch — this whole test goes red on the
      // `readdir` above finding zero files, before this line is even
      // reached.
      expect(undoHowIsExecutable(how!)).toBe(true);
    } finally {
      await s.cleanup();
    }
  }, 180_000);
});
