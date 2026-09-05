import { describe, expect, it } from "vitest";
import { MAX_PARALLEL_TASKS } from "../../../src/scheduler/pool.js";
import { captureStreams, makeSandbox, runCli, seedRunnablePlan, showFileAt, taskWorkdirs, writeFileCheck, writeScriptedConfig } from "../sandbox.js";

// The other half of the parked pool finding. pool.test.ts pins that the pool
// stops handing out work when its caller says to; this pins that a real round
// ever says so. Without it the stop signal is a seam nothing production fills
// in -- the shape this repository has shipped twice already
// (`emptyRequiredChecksPairs`, and `core.hooksPath` before it), where a
// mechanism exists, is tested in isolation, and is wired to nothing.
//
// The layer is deliberately one wider than the pool's bound, because that is
// the only arrangement in which "queued but not yet launched" exists at all:
// with MAX_PARALLEL_TASKS in flight, the last task is still in the queue when
// the first one's status comes back.
describe("a cancelled task stops the pool from launching a queued sibling", () => {
  it("never starts the task that was still queued when the round was cancelled", async () => {
    const s = await makeSandbox();
    try {
      // ⚠️ The names are load-bearing: a layer is ordered by taskId, not by
      // the order the plan file lists them (measured — a first draft named
      // these T1/S1-S3/QUEUED and the round ran QUEUED first, because Q sorts
      // before T). "a1" must be the layer's first task and "z1" its last, or
      // the canceller is itself the queued one and this criterion measures
      // nothing.
      const slowTasks = Array.from({ length: MAX_PARALLEL_TASKS - 1 }, (_, i) => {
        const name = `b${i + 1}`;
        return {
          taskId: name,
          contract: {
            goal: `write ${name}.txt`,
            targetPaths: [`${name}.txt`],
            // Unequal on purpose: the cancelling task must finish first, and
            // a criterion whose colour depends on which of several equal-length
            // subprocesses returns first is a flake, not a measurement. Three
            // seconds is the margin.
            requiredChecks: ["sleep 3", writeFileCheck(`${name}.txt`, "s")],
            buildTestCommands: ["true"],
          },
        };
      });

      const p = await seedRunnablePlan(s, [
        {
          taskId: "a1",
          contract: {
            goal: "write a.txt",
            targetPaths: ["a.txt"],
            requiredChecks: [writeFileCheck("a.txt", "a1")],
            buildTestCommands: ["true"],
            verifierType: "agent",
            stopOn: ["orca-stop"],
          },
        },
        ...slowTasks,
        {
          // Disjoint from all of the above, so all five share one layer and
          // this one is the queued task: MAX_PARALLEL_TASKS slots are taken.
          taskId: "z1",
          contract: {
            goal: "write queued.txt",
            targetPaths: ["queued.txt"],
            requiredChecks: [writeFileCheck("queued.txt", "q")],
            buildTestCommands: ["true"],
          },
        },
      ]);
      const adapterConfig = await writeScriptedConfig(s, "round", [{ stopSignals: ["orca-stop"] }]);

      const { result: rc, stdout } = await captureStreams(() =>
        runCli(["run", p.planPath, "--adapter-config", adapterConfig]),
      );

      expect(rc).toBe(2);
      expect(stdout).toContain("a1: ccloop reported cancelled");
      // The load-bearing pair: the queued task is reported as never having
      // run, and it left no run directory -- which is what tells "never
      // launched" apart from "launched and cleaned up".
      expect(stdout).toContain("z1: upstream_not_run");
      const dirs = await taskWorkdirs(s);
      expect(dirs.some((d) => d.includes("-z1-"))).toBe(false);
      expect(await showFileAt(s.targetRepo, p.workBranch, "queued.txt")).toBeNull();
      // The control: the tasks that WERE already in flight are not
      // interrupted. Nothing here can interrupt work already running, and a
      // criterion that let them vanish would be pinning a claim this code
      // does not make. Measured on W rather than by run directory, because
      // §4.5 disposes a successful task's copy — "no directory" is ambiguous
      // for them in exactly the way it is not for z1, which has no result to
      // dispose.
      expect(await showFileAt(s.targetRepo, p.workBranch, "b1.txt")).not.toBeNull();
    } finally {
      await s.cleanup();
    }
  }, 180_000);
});
