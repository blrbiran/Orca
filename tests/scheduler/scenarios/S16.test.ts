import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { runTask } from "../../../src/scheduler/ccloopRunner.js";
import { buildGraph } from "../../../src/scheduler/graph.js";
import { harvest } from "../../../src/scheduler/harvest.js";
import { allocateRunId } from "../../../src/scheduler/runId.js";
import { headOf, makeSandbox, seedTasks, writeScriptedConfig } from "../sandbox.js";

describe("S16 (spec §4.4: a change larger than ten megabytes is not a silent success)", () => {
  it("S16: harvest sees the real net change set of an eleven-megabyte write, not an empty one", async () => {
    // spec §4.4's measured bug lives in ccloop's OWN patch-collection path
    // (scripts/claude-phase-runner.mjs's readGitDiff): a 10MB maxBuffer, and a
    // catch that returns "" for any git failure other than exit code 1 — so a
    // diff over the buffer arrives indistinguishable from "nothing changed".
    // C never calls that path at all: harvest.ts's netChangeSet reads
    // `git diff --name-only`, whose output size is proportional to the
    // number of changed paths, not their content — one huge file is one
    // short line — with its own generous 64MB buffer on top. This scenario is
    // what proves that channel is really gone, with a real file over the
    // 10MB line and a real git diff, not a mocked one.
    const s = await makeSandbox();
    try {
      const base = await headOf(s.targetRepo);
      const { plan, contracts } = await seedTasks(s, [
        {
          taskId: "T1",
          contract: {
            goal: "write an eleven-megabyte file",
            targetPaths: ["big.bin"],
            // dd, not printf/base64: it writes exactly the requested byte
            // count regardless of shell quoting limits, and 11 MiB clears
            // the 10 MB (decimal) line spec §4.4 measured with room to spare.
            requiredChecks: ["dd if=/dev/zero of=big.bin bs=1048576 count=11 2>/dev/null"],
            buildTestCommands: ["true"],
          },
        },
      ]);
      const graph = buildGraph(plan, contracts);

      const t1 = plan.tasks[0];
      const runId = await allocateRunId(s.runsDir, "T1", await readFile(t1.contract), base);
      const run = await runTask(plan, t1, base, runId, {
        adapter: "scripted",
        adapterConfig: await writeScriptedConfig(s, "T1", [{}]),
      });
      expect(run.outcome).toBe("succeeded");
      expect(run.attemptSha).not.toBeNull();

      const d = await harvest(run, base, graph.writeSets.get("T1")!);
      expect(d.empty).toBe(false);
      expect(d.actualPaths.length).toBeGreaterThan(0);
      expect(d.actualPaths).toContain("big.bin");
    } finally {
      await s.cleanup();
    }
  }, 60_000);
});
