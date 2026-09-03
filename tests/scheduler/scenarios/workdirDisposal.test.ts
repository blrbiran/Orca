import { describe, expect, it } from "vitest";
import {
  captureStdout,
  makeSandbox,
  runCli,
  seedDisjointPlan,
  seedRunnablePlan,
  taskWorkdirs,
  writeFileCheck,
} from "../sandbox.js";

// spec §4.5's copy-retention rule, landing here rather than in Task 8 for the
// reason Task 8 wrote down: `git clone --local` hardlinks the object store, so
// the attempt commit is reachable only from inside the copy until the fetch in
// §4.3 step 6 puts it in the target repo. Deleting a successful copy any
// earlier deletes the only thing steps 4-6 exist to read. `disposeWorkdir`
// therefore existed with no caller until now; these three criteria are what
// make its three branches reachable from a real round.
describe("task copy retention (spec §4.5)", () => {
  it("deletes a successful task's copy once its result has landed on W", async () => {
    const s = await makeSandbox();
    try {
      const p = await seedDisjointPlan(s);
      const rc = await runCli(["run", p.planPath, "--adapter-config", p.adapterConfig]);
      expect(rc).toBe(0);
      // Nothing named after a run id is left under runsDir. Asserted on the
      // real directory listing rather than on a printed line, because the
      // cost §4.5 is about is real files on disk.
      expect(await taskWorkdirs(s)).toEqual([]);
    } finally {
      await s.cleanup();
    }
  }, 180_000);

  it("keeps a non-successful task's copy and prints where it is", async () => {
    const s = await makeSandbox();
    try {
      // A required check that exits non-zero is rejected by runRequiredChecks
      // with safeToRetry: false; with maxAttempts 1, stopController checks
      // `attemptNumber >= maxAttempts` before it checks safeToRetry, so the
      // run ends `exhausted` (measured in Task 8's terminal-status table).
      const p = await seedRunnablePlan(s, [
        {
          taskId: "T1",
          contract: {
            goal: "write a.txt",
            targetPaths: ["a.txt"],
            requiredChecks: [writeFileCheck("a.txt", "a1"), "false"],
            buildTestCommands: ["true"],
            maxAttempts: 1,
          },
        },
      ]);
      const { result: rc, stdout } = await captureStdout(() =>
        runCli(["run", p.planPath, "--adapter-config", p.adapterConfig]),
      );

      const kept = await taskWorkdirs(s);
      expect(kept.length).toBe(1);
      // A copy nobody is told about is a cost with no benefit — the path is
      // the whole point of keeping it.
      expect(stdout).toContain(kept[0]);
      // And spec §6.3 has no mode in which a task fails and the round is 0.
      expect(rc).toBe(2);
    } finally {
      await s.cleanup();
    }
  }, 180_000);

  it("--keep-workdirs keeps even the copies of tasks that landed", async () => {
    const s = await makeSandbox();
    try {
      const p = await seedDisjointPlan(s);
      const rc = await runCli(["run", p.planPath, "--adapter-config", p.adapterConfig, "--keep-workdirs"]);
      expect(rc).toBe(0);
      expect((await taskWorkdirs(s)).length).toBe(2);
    } finally {
      await s.cleanup();
    }
  }, 180_000);
});
