import { execFile } from "node:child_process";
import { chmod } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { captureStreams, makeSandbox, refSha, runCli, seedDisjointPlan, writePlan } from "../sandbox.js";

const execFileAsync = promisify(execFile);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// Fix round 1, finding 2. spec §4.2.1 lets C check out a real person's
// worktree only because the design promises to be explicit about having done
// it. An exception escaping mid-round used to break both halves of that at
// once: the repository was left on a branch the person did not choose, and
// the only line that says where it is never ran — the throw went out through
// main() as an unhandled rejection, so node picked the exit code too.
describe("a round that throws (spec §4.2.1 / §6.3)", () => {
  it("exits 3, reports the original error, and still says where the repository was left", async () => {
    const s = await makeSandbox();
    try {
      const p = await seedDisjointPlan(s);
      // The failure is forced AFTER W exists and BEFORE any task runs:
      // allocateRunId's `mkdir` under runsDir is the round's first write
      // there, and a read-only runsDir makes it fail with EACCES rather than
      // the EEXIST it knows how to step past. Chosen over a stub because it
      // is a real git/fs failure on the real code path, not an injected one.
      await chmod(s.runsDir, 0o500);
      let captured;
      try {
        // The rejection is CAPTURED for the same reason S14 captures its
        // round's: with the catch under test deleted, runCli rejects and this
        // line would end the criterion before any of its assertions ran —
        // §10.3's warning that "which assertion went red" is not a reliable
        // signal. Turning the rejection into a value makes each assertion
        // below measure its own claim.
        captured = await captureStreams(() =>
          runCli(["run", p.planPath, "--adapter-config", p.adapterConfig]).catch(
            (err: Error) => err.message,
          ),
        );
      } finally {
        await chmod(s.runsDir, 0o700);
      }

      const tip = await refSha(s.targetRepo, `refs/heads/${p.workBranch}`);
      expect(tip).not.toBeNull();
      // The two halves §4.2.1 owes the person: which branch their repository
      // is on, and where the work branch is. Asserted on the tip's actual sha
      // rather than on wording, so a message that merely mentions the branch
      // name without saying where it is does not pass.
      expect(captured.stdout).toContain(p.workBranch);
      expect(captured.stdout).toContain(tip!);
      // Reported, not swallowed.
      expect(captured.stderr).toContain("the round failed");
      expect(captured.stderr).toMatch(/EACCES|permission denied/i);
      // A defined code from §6.3's scheme, not whatever node would have
      // chosen for an unhandled rejection.
      expect(captured.result).toBe(3);
    } finally {
      await s.cleanup();
    }
  }, 180_000);

  // Measured in a real process, not through main()'s return value: the arm
  // under test is the `.then(onFulfilled, onRejected)` in the CLI bootstrap,
  // and it only exists in a process. Without the rejection arm this is an
  // unhandled promise rejection and node, not orca, decides the status.
  it("a rejection out of main() becomes a defined exit code in a real process", async () => {
    const s = await makeSandbox();
    try {
      // `plan` reads each task's contract file. A plan naming one that does
      // not exist is absolute, outside targetRepo, and passes every one of
      // loadPlan's six rejections — so the ENOENT is thrown, not returned.
      const planPath = await writePlan(s, {
        targetRepo: s.targetRepo,
        ccloopBin: join(s.root, "unused-ccloop-cli.js"),
        runsDir: s.runsDir,
        workBranch: "orca/w/x",
        policy: "local-merge",
        ledgerMode: "in-repo",
        tasks: [{ taskId: "T1", contract: join(s.root, "no-such-contract.json"), dependsOn: [] }],
      });
      await expect(
        execFileAsync("npx", ["tsx", "src/cli.ts", "plan", planPath], { cwd: repoRoot }),
      ).rejects.toMatchObject({ code: 3 });
    } finally {
      await s.cleanup();
    }
  }, 60_000);
});
