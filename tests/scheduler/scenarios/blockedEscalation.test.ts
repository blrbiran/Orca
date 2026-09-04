import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { undoHowIsExecutable } from "../../../src/ledger/undoExecutable.js";
import { captureStreams, makeSandbox, runCli, seedRunnablePlan, writeScriptedConfig } from "../sandbox.js";

// Final review, Important 6 — a REVERSAL of an earlier controller ruling.
//
// That ruling said `blocked_waiting_human` should not get spec §5.4's
// escalation file, on the grounds that §5.4's mandated content (both sides'
// intent, the conflict blocks) does not exist for a blocked run. The premise
// is false: `writeEscalationFile` already renders the degraded shape —
// `sides: []` becomes "no side's declared intent is known", `conflictBlocks:
// []` becomes "not about a merge conflict" — and the round-exception path in
// run.ts's catch block already uses exactly that form. Giving one non-conflict
// escalation a file and not the other was arbitrary, and it left the ONE
// terminal status §6.1 calls "needs a human and is not a failure" with nothing
// on disk saying a human is needed.
describe("a blocked_waiting_human run writes spec §5.4's escalation file", () => {
  it("records the escalation under runsDir, naming the task and the copy the person has to look at", async () => {
    // Measured on ccloop 7f2c5f6 and reused verbatim from S9: with
    // `verifierType: "command"` runLoop never calls the adapter's verify, so
    // the pauseOn route to blocked_waiting_human is dead. evaluatePathPolicy
    // over the scripted frame's `changedFiles` is the route that works —
    // runLoop checks it right after execute and persists
    // blocked_waiting_human before verification runs at all.
    const s = await makeSandbox();
    try {
      const p = await seedRunnablePlan(s, [
        {
          taskId: "T1",
          contract: {
            goal: "write a.txt",
            targetPaths: ["a.txt"],
            requiredChecks: ["true"],
            buildTestCommands: ["true"],
            denylistPaths: ["forbidden.txt"],
          },
        },
      ]);
      // seedRunnablePlan's own config declares no changed files; this one
      // declares the denylisted path, which is what trips the policy.
      const adapterConfig = await writeScriptedConfig(s, "blocked", [{ changedFiles: ["forbidden.txt"] }]);

      const { result: rc, stdout } = await captureStreams(() =>
        runCli(["run", p.planPath, "--adapter-config", adapterConfig]),
      );

      // The premise: without this the criterion is measuring some other
      // terminal status entirely.
      expect(stdout).toContain("T1: ccloop reported blocked_waiting_human");
      // §6.3: blocked_waiting_human escalates (3) and is not a failure.
      expect(rc).toBe(3);

      // Mutation `M-BLOCKED-ESC`: delete the `writeEscalationFile` call from
      // run.ts's `route.escalates` branch — the escalations directory is then
      // never created at all, and `expect(names).toHaveLength(1)` below is the
      // assertion that goes red.
      const dir = join(s.runsDir, "escalations");
      // `.catch(() => [])` on purpose: without it, the mutation's red is a
      // thrown ENOENT from readdir rather than a failed assertion, and §0.3
      // does not accept a crash as evidence about an assertion.
      const names = await readdir(dir).catch(() => [] as string[]);
      expect(names).toHaveLength(1);
      const escalationPath = join(dir, names[0]);
      // §5.4: under runsDir, never on W, never inside the target repository.
      expect(escalationPath.startsWith(s.runsDir)).toBe(true);
      expect(escalationPath.startsWith(s.targetRepo)).toBe(false);

      const text = await readFile(escalationPath, "utf8");
      expect(text).toContain("blocked_waiting_human");
      // Names the task, through the "What each side intended" section rather
      // than as a bare substring: `**T1**` is `intentOfContract`'s rendering,
      // so passing `sides: []` (the fully degraded form, which would still
      // produce a file and still mention T1 in the reason) reddens this line
      // and nothing above it.
      expect(text).toContain("**T1**");
      // §5.4 step 3: the copy directory, because that is where the person
      // works. `disposeWorkdir` keeps every non-succeeded run's copy, so this
      // path is one that still exists when they go looking.
      const kept = (await readdir(s.runsDir)).filter((n) => n.startsWith("orca-T1-"));
      expect(kept).toHaveLength(1);
      expect(text).toContain(join(s.runsDir, kept[0]));

      const how = /- how: `([^`]+)`/.exec(text)?.[1];
      expect(how).not.toBeUndefined();
      expect(undoHowIsExecutable(how!)).toBe(true);
    } finally {
      await s.cleanup();
    }
  }, 180_000);
});
