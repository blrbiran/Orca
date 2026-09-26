import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  captureStdout,
  git,
  makeSandbox,
  runCli,
  seedRunnablePlan,
  showFileAt,
  taskWorkdirs,
  writeFileCheck,
  writeScriptedConfig,
} from "../sandbox.js";

// Seat C (session 8c6302e0, 2026-09-26; follow-up to audit finding R1). `orca run` refuses to harvest and land a
// task by `if (run.outcome !== "succeeded")` in run.ts's per-task loop. The criteria that reach that branch use a
// blocked_waiting_human task (which publishes no attempt ref, so harvest would refuse it anyway) and a cancelled one
// (which stops the round). Narrowing the guard to `failed || blocked_waiting_human` (mutation M3n) left every
// existing criterion green, although an `exhausted` task's attempt commit -- ccloop does publish one -- was then
// harvested and merged onto W: work whose required checks FAILED, landed as if it had succeeded, with only exit code
// 2 to say otherwise. `failed` is the other non-succeeded status real ccloop reaches with an attempt ref. For each,
// the attempt commit must exist (so nothing but the terminal status stands between it and W) and W must not carry it.
describe("a non-succeeded task never lands (spec §6.1, §7)", () => {
  it.each([
    // Measured routes (sandbox.ts ContractSpec, S8): a rejected verification ends `exhausted` under maxAttempts 1
    // and `failed` under maxAttempts 2.
    { status: "exhausted", maxAttempts: 1 },
    { status: "failed", maxAttempts: 2 },
  ])("keeps a task that ended $status off W although it published an attempt commit", async ({ status, maxAttempts }) => {
    const s = await makeSandbox();
    try {
      // The first check writes a.txt into the attempt worktree, so the attempt commit carries real work; the second
      // fails, so ccloop rejects the attempt.
      const p = await seedRunnablePlan(s, [
        {
          taskId: "T1",
          contract: {
            goal: "write a.txt",
            targetPaths: ["a.txt"],
            requiredChecks: [writeFileCheck("a.txt", "a1"), "false"],
            buildTestCommands: ["true"],
            maxAttempts,
          },
        },
      ]);
      const adapterConfig = await writeScriptedConfig(s, "two-frames", [{}, {}]);
      const { result: rc, stdout } = await captureStdout(() => runCli(["run", p.planPath, "--adapter-config", adapterConfig]));

      expect(stdout).toContain(`T1: ccloop reported ${status}`);
      // ccloop's own output, not the test's: the kept copy holds a published attempt ref with a.txt in it.
      const kept = await taskWorkdirs(s);
      expect(kept).toHaveLength(1);
      const clone = join(s.runsDir, kept[0]!, "repo");
      const attempt = (await git(clone, ["for-each-ref", "--format=%(objectname)", `refs/ccloop/${kept[0]}/attempts`])).trim();
      expect(attempt).not.toBe("");
      expect(await showFileAt(clone, attempt.split("\n")[0]!, "a.txt")).toBe("a1\n");
      // The guarded property: the rejected work is not on W.
      expect(await showFileAt(s.targetRepo, p.workBranch, "a.txt")).toBeNull();
      expect(rc).toBe(2);
    } finally {
      await s.cleanup();
    }
  }, 300_000);
});
