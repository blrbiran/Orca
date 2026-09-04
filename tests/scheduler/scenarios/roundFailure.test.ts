import { execFile } from "node:child_process";
import { chmod, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { undoHowIsExecutable } from "../../../src/ledger/undoExecutable.js";
import { captureStreams, makeSandbox, refSha, runCli, writeContract, writePlan } from "../sandbox.js";

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
      // ⚠️ Fixture changed by the final review's fix wave; every claim below
      // is the one this criterion always made. It used to force the failure
      // with `chmod(runsDir, 0o500)` alone, so that `allocateRunId`'s mkdir
      // failed with EACCES — but that is now a PER-TASK exception (Important
      // 5: one task's throw settles into §6.1's `failed` row instead of
      // taking the round), so it no longer produces a round-level exception
      // at all. The round-level failure is therefore forced by an
      // unresolvable ccloopBin, which `ccloopEvidence` throws on immediately
      // after `roundId` is derived — i.e. still AFTER W exists and BEFORE any
      // task runs. runsDir stays unwritable, which is what this criterion's
      // second half is about.
      const contract = await writeContract(s, "T1", {
        goal: "write a.txt",
        targetPaths: ["a.txt"],
        requiredChecks: ["true"],
      });
      const workBranch = "orca/w/x";
      const planPath = await writePlan(s, {
        targetRepo: s.targetRepo,
        ccloopBin: join(s.root, "no-such-ccloop-checkout", "dist", "cli.js"),
        runsDir: s.runsDir,
        workBranch,
        policy: "local-merge",
        ledgerMode: "in-repo",
        tasks: [{ taskId: "T1", contract, dependsOn: [] }],
      });
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
          runCli(["run", planPath, "--adapter-config", join(s.root, "unused-adapter-config.json")]).catch(
            (err: Error) => err.message,
          ),
        );
      } finally {
        await chmod(s.runsDir, 0o700);
      }

      const tip = await refSha(s.targetRepo, `refs/heads/${workBranch}`);
      expect(tip).not.toBeNull();
      // The two halves §4.2.1 owes the person: which branch their repository
      // is on, and where the work branch is. Asserted on the tip's actual sha
      // rather than on wording, so a message that merely mentions the branch
      // name without saying where it is does not pass.
      //
      // ⚠️ Scoped to describeRepoState's OWN line, not to stdout as a whole
      // (found by the fix wave's self-review, running `M-ROUND-STATE`): the
      // plan report now prints the base branch's sha too (Important 7), and
      // in this fixture nothing lands, so W's tip IS the base sha — a
      // whole-stdout `toContain(tip)` went on passing with
      // `log(await describeRepoState(plan))` deleted, i.e. it had stopped
      // being a criterion. The line must carry BOTH facts, which is what
      // §4.2.1 actually owes.
      const stateLine = captured.stdout.split("\n").find((l) => l.includes("is left on branch"));
      expect(stateLine).toBeDefined();
      expect(stateLine).toContain(workBranch);
      expect(stateLine).toContain(tip!);
      // Reported, not swallowed.
      expect(captured.stderr).toContain("the round failed");
      expect(captured.stderr).toContain("cannot find ccloop's repository root");
      // A defined code from §6.3's scheme, not whatever node would have
      // chosen for an unhandled rejection.
      expect(captured.result).toBe(3);

      // NOT spec §5.4's escalation file: runsDir is unwritable for the whole
      // of this round, so the catch block's own attempt to write one under
      // runsDir fails too — caught, logged, and does not mask the original
      // error or the exit code. See the next test for the exception path that
      // DOES leave a file behind.
      expect(captured.stderr).toContain("could not record the escalation file");
      expect(captured.stderr).toMatch(/EACCES|permission denied/i);
      await expect(readdir(join(s.runsDir, "escalations"))).rejects.toThrow();
    } finally {
      await s.cleanup();
    }
  }, 180_000);

  it("still writes spec §5.4's escalation file when the round dies somewhere runsDir CAN be written to", async () => {
    // The EACCES test above forces the exception by making runsDir
    // unwritable, which also makes the escalation file's own write fail —
    // a real and correctly-handled case, but not one that can prove the
    // mechanism itself works. This fixture forces the exception a different
    // way — an unresolvable ccloopBin, which `ccloopEvidence` (called right
    // after roundId is derived, before any ccloop spawn) throws on — so
    // runsDir stays writable for the whole round and the escalation file
    // actually lands.
    const s = await makeSandbox();
    try {
      const contract = await writeContract(s, "T1", {
        goal: "write a.txt",
        targetPaths: ["a.txt"],
        requiredChecks: ["true"],
      });
      const planPath = await writePlan(s, {
        targetRepo: s.targetRepo,
        ccloopBin: join(s.root, "no-such-ccloop-checkout", "dist", "cli.js"),
        runsDir: s.runsDir,
        workBranch: "orca/w/x",
        policy: "local-merge",
        ledgerMode: "in-repo",
        tasks: [{ taskId: "T1", contract, dependsOn: [] }],
      });

      const captured = await captureStreams(() =>
        runCli(["run", planPath, "--adapter-config", join(s.root, "unused-adapter-config.json")]).catch(
          (err: Error) => err.message,
        ),
      );

      expect(captured.result).toBe(3);
      expect(captured.stderr).toContain("the round failed");

      // spec §5.4: the copy, under runsDir, never on W, never inside the
      // target repository. Mutation: delete the escalation write in the
      // catch block — this goes red on `readdir` finding zero files.
      const dir = join(s.runsDir, "escalations");
      const names = await readdir(dir);
      expect(names).toHaveLength(1);
      const escalationPath = join(dir, names[0]);
      expect(escalationPath.startsWith(s.targetRepo)).toBe(false);

      const text = await readFile(escalationPath, "utf8");
      expect(text).toMatch(/cannot find ccloop's repository root/);
      const how = /- how: `([^`]+)`/.exec(text)?.[1];
      expect(how).not.toBeUndefined();
      // Mutation: replace the exception path's `rm -rf <escalation file>`
      // with prose ("clean this up once resolved") — undoHowIsExecutable
      // rejects it while the file-existence assertions above stay green.
      expect(undoHowIsExecutable(how!)).toBe(true);
    } finally {
      await s.cleanup();
    }
  }, 60_000);

  // Measured in a real process, not through main()'s return value: the arm
  // under test is the `.then(onFulfilled, onRejected)` in the CLI bootstrap,
  // and it only exists in a process. Without the rejection arm this is an
  // unhandled promise rejection and node, not orca, decides the status.
  it("a rejection out of main() becomes a defined exit code in a real process", async () => {
    const s = await makeSandbox();
    try {
      // ⚠️ Fixture changed by the final review's fix wave, criterion
      // unchanged. This used to force the rejection with a plan naming a
      // contract file that does not exist — which is now `loadRound`'s
      // `unreadable-contract` rejection and a clean exit 1 (Important 1), so
      // that input can no longer reach the bootstrap's rejection arm at all.
      // The arm still has to be measured, so the rejection is forced somewhere
      // the fix wave deliberately did not touch: `orca validate` reads each
      // ledger file with an unguarded `readFile`, and a file `stat` can see
      // but nobody may read throws EACCES out of main().
      //
      // Mutation `M-BOOTSTRAP`: delete the `.then(…, onRejected)` arm in
      // src/cli.ts — node then picks the status for an unhandled rejection
      // (1, not 3) and `toMatchObject({ code: 3 })` goes red.
      const unreadable = join(s.runsDir, "unreadable.jsonl");
      await writeFile(unreadable, '{"ev":"decision"}\n');
      await chmod(unreadable, 0o000);
      try {
        await expect(
          execFileAsync("npx", ["tsx", "src/cli.ts", "validate", unreadable], { cwd: repoRoot }),
        ).rejects.toMatchObject({ code: 3 });
      } finally {
        await chmod(unreadable, 0o600);
      }
    } finally {
      await s.cleanup();
    }
  }, 60_000);
});
