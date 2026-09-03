import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { otherSideOf } from "../../src/scheduler/run.js";
import { git, headOf, makeSandbox } from "./sandbox.js";
import type { Sandbox } from "./sandbox.js";

const ID = ["-c", "user.name=orca-test", "-c", "user.email=orca-test@invalid"];

/**
 * A commit at `base` touching `files`, published at `refs/orca/<run-id>` —
 * exactly the shape `landIntoW` leaves in the target repo for every task that
 * landed. Built by hand rather than by running a round, because a criterion
 * for "two candidates" would otherwise need a three-task layer and a third
 * ccloop spawn to say the same thing.
 */
async function fakeAttempt(s: Sandbox, base: string, runId: string, files: Record<string, string>): Promise<void> {
  await git(s.targetRepo, ["checkout", "--detach", base]);
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(s.targetRepo, name), content);
  }
  await git(s.targetRepo, [...ID, "add", "-A"]);
  await git(s.targetRepo, [...ID, "commit", "-m", `attempt ${runId}`]);
  await git(s.targetRepo, ["update-ref", `refs/orca/${runId}`, await headOf(s.targetRepo)]);
  await git(s.targetRepo, ["checkout", "--detach", base]);
}

describe("spec 5.2: naming the other side of a conflict", () => {
  it("names the one already-landed task in this layer that wrote a conflicted path", async () => {
    const s = await makeSandbox();
    try {
      const base = await headOf(s.targetRepo);
      await fakeAttempt(s, base, "orca-T1-aaa", { "shared.txt": "t1\n" });
      await fakeAttempt(s, base, "orca-T3-ccc", { "elsewhere.txt": "t3\n" });

      const r = await otherSideOf(
        s.targetRepo,
        base,
        [
          { taskId: "T1", runId: "orca-T1-aaa" },
          { taskId: "T3", runId: "orca-T3-ccc" },
        ],
        ["shared.txt"],
      );

      // Identified by what T1 WROTE. T3 landed in the same layer and is not
      // named, so this is not "whichever task landed first".
      expect(r).toEqual({ taskId: "T1" });
    } finally {
      await s.cleanup();
    }
  });

  it("refuses to pick a side when two already-landed tasks both wrote a conflicted path", async () => {
    // Reachable, not defensive padding: three tasks in one layer that all lie
    // about the same path get here on the third one's landing, the first two
    // having landed (the second through 5.2 itself). A contract synthesized
    // from a side this function chose would be exactly the one-sided context
    // 5.2's check exists to prevent, so it refuses and the round escalates.
    // Mutation `M-OTHERSIDE`.
    const s = await makeSandbox();
    try {
      const base = await headOf(s.targetRepo);
      await fakeAttempt(s, base, "orca-T1-aaa", { "shared.txt": "t1\n" });
      await fakeAttempt(s, base, "orca-T2-bbb", { "shared.txt": "t2\n" });

      const r = await otherSideOf(
        s.targetRepo,
        base,
        [
          { taskId: "T1", runId: "orca-T1-aaa" },
          { taskId: "T2", runId: "orca-T2-bbb" },
        ],
        ["shared.txt"],
      );

      expect("escalate" in r).toBe(true);
      // Names both candidates. A refusal that said only "cannot reconcile"
      // would satisfy the line above and tell the human nothing about which
      // two tasks to look at.
      expect((r as { escalate: string }).escalate).toContain("T1");
      expect((r as { escalate: string }).escalate).toContain("T2");
    } finally {
      await s.cleanup();
    }
  });

  it("refuses when no already-landed task in this layer wrote the conflicted path", async () => {
    // The other end, and also reachable: the conflicting change on W's side
    // can come from C's own ledger commits, or from a task whose landing was
    // itself reconciled into a tree that no longer contains the path -- this
    // measures attempts, not landings.
    const s = await makeSandbox();
    try {
      const base = await headOf(s.targetRepo);
      await fakeAttempt(s, base, "orca-T1-aaa", { "elsewhere.txt": "t1\n" });

      const r = await otherSideOf(s.targetRepo, base, [{ taskId: "T1", runId: "orca-T1-aaa" }], ["shared.txt"]);

      expect("escalate" in r).toBe(true);
      expect((r as { escalate: string }).escalate).toContain("no task that already landed");
    } finally {
      await s.cleanup();
    }
  });
});
