import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { cloneDirOf, runTask } from "../../src/scheduler/ccloopRunner.js";
import { disposition, harvest } from "../../src/scheduler/harvest.js";
import { allocateRunId } from "../../src/scheduler/runId.js";
import type { ClaimedPath } from "../../src/scheduler/writeSet.js";
import { writeSetOf } from "../../src/scheduler/writeSet.js";
import { allRefShas, headOf, makeSandbox, seedTasks, writeScriptedConfig } from "./sandbox.js";

const NO_SIBLINGS = new Map<string, ClaimedPath[]>();

async function declaredOf(contractPath: string): Promise<ClaimedPath[]> {
  return writeSetOf(JSON.parse(await readFile(contractPath, "utf8")));
}

describe("harvest (spec §7.2: C measures the change set itself)", () => {
  it("measures the actual change set itself instead of consuming ccloop's changedFiles", async () => {
    // ccloop's collection is honest -- it shells out to `git status
    // --porcelain=v1 -z --untracked-files=all` rather than asking the model --
    // but its entry point is called observeChangedPathsBestEffort, and a
    // best-effort measurement cannot carry a correctness argument. A diff
    // between two commits is deterministic: it fails loudly or it is right.
    //
    // The scripted frame below therefore reports a changedFiles list that is a
    // LIE -- a path no attempt ever wrote -- while the required check writes a
    // different path for real. Without that divergence an implementation that
    // consumed ccloop's list would agree with one that measured the tree, and
    // this criterion could not go red.
    const s = await makeSandbox();
    try {
      const base = await headOf(s.targetRepo);
      const { plan } = await seedTasks(s, [
        {
          taskId: "T1",
          contract: {
            goal: "write src/a.ts",
            targetPaths: ["src/**"],
            // Runs with cwd = the attempt worktree (runLoop.runRequiredChecks
            // passes context.worktreePath), so this is how a scripted run --
            // whose adapter touches no files at all -- produces a real tree
            // change for publishAttemptCommit's `git add -A` to commit.
            requiredChecks: ["mkdir -p src && printf 'x' > src/a.ts"],
            buildTestCommands: ["true"],
          },
        },
      ]);
      const t1 = plan.tasks[0];
      const runId = await allocateRunId(s.runsDir, "T1", await readFile(t1.contract), base);
      const run = await runTask(plan, t1, base, runId, {
        adapter: "scripted",
        adapterConfig: await writeScriptedConfig(s, "T1", [{ changedFiles: ["ccloop-said-this.txt"] }]),
      });
      expect(run.outcome).toBe("succeeded");

      const r = await harvest(run, base, await declaredOf(t1.contract));
      expect(r.actualPaths).toEqual(["src/a.ts"]);
      expect(r.actualPaths).not.toContain("ccloop-said-this.txt");
      expect(r.empty).toBe(false);
      expect(r.outOfBounds).toEqual([]);
    } finally {
      await s.cleanup();
    }
  }, 180_000);

  it("harvests the highest-numbered attempt ref, not the first one it finds", async () => {
    // Carried from Task 8: latestAttemptSha's "highest attempt wins" selection
    // had no criterion, because every run in that task produced exactly one
    // ref and picking the first, the lowest or the highest were all the same
    // answer. A retried run is the case that separates them, and only the
    // final attempt's tree is the one the terminal status is about.
    //
    // Each attempt writes a file named after its own worktree
    // (<runDir>/worktrees/attempt-<n>), so the two attempts produce
    // DIFFERENT trees and a wrong selection is visible in the change set
    // rather than only in a sha.
    const s = await makeSandbox();
    try {
      const base = await headOf(s.targetRepo);
      const { plan } = await seedTasks(s, [
        {
          taskId: "T1",
          contract: {
            goal: "write one file per attempt",
            targetPaths: ["**"],
            requiredChecks: ['printf x > "$(basename "$(pwd)").txt"'],
            buildTestCommands: ["true"],
            // Two knobs, both required: "agent" is what makes ccloop read the
            // frame's verification at all, and maxAttempts 2 is what keeps
            // stopController's `attemptNumber >= maxAttempts` test -- which is
            // checked BEFORE safeToRetry -- from turning attempt 1 into
            // `exhausted`.
            verifierType: "agent",
            maxAttempts: 2,
          },
        },
      ]);
      const t1 = plan.tasks[0];
      const runId = await allocateRunId(s.runsDir, "T1", await readFile(t1.contract), base);
      const run = await runTask(plan, t1, base, runId, {
        adapter: "scripted",
        adapterConfig: await writeScriptedConfig(s, "T1", [
          { approved: false, safeToRetry: true },
          { approved: true },
        ]),
      });
      expect(run.outcome).toBe("succeeded");

      // Guards the fixture, and it is the whole criterion's premise: on a
      // one-ref run every selection rule agrees and the assertion below could
      // never go red. If ccloop ever stops publishing the rejected attempt,
      // this fails here rather than passing vacuously.
      // Narrowed to the attempt namespace deliberately: the clone also carries
      // refs/heads/main and the origin remotes it was cloned from, and pinning
      // those here would make this criterion fail whenever the sandbox's branch
      // layout changed, for a reason that has nothing to do with attempts.
      const refs = Object.keys(await allRefShas(cloneDirOf(run.workdir)))
        .filter((ref) => ref.startsWith("refs/ccloop/"))
        .sort();
      expect(refs).toEqual([`refs/ccloop/${runId}/attempts/1`, `refs/ccloop/${runId}/attempts/2`]);

      const r = await harvest(run, base, await declaredOf(t1.contract));
      expect(r.actualPaths).toEqual(["attempt-2.txt"]);
    } finally {
      await s.cleanup();
    }
  }, 180_000);

  it("refuses a run that published no attempt ref instead of reporting an empty change set", async () => {
    // Measured in Task 8: `blocked_waiting_human` is the one terminal status
    // that leaves no attempt ref at all -- runLoop persists it and returns
    // WITHOUT going through any cleanup path, and publishAttemptCommit only
    // ever runs from inside cleanup.
    //
    // Reporting that as `empty: true` would be the worst available answer, not
    // a conservative one: disposition would then call a run that needs a human
    // `succeeded_but_empty` and contribute 2, and spec §6.3 says in as many
    // words that downgrading a 3 to a 2 makes the thing a human must do vanish
    // into a pile of failures. §7.5 makes the same point structurally -- the
    // whole of §7 rests on C holding two real commits, and without the result
    // commit direction two cannot tell "ccloop collected nothing" from "the
    // agent did nothing". So harvest refuses, loudly, and the caller routes on
    // the outcome (§6.1) instead.
    const s = await makeSandbox();
    try {
      const base = await headOf(s.targetRepo);
      const { plan } = await seedTasks(s, [
        {
          taskId: "T1",
          contract: {
            goal: "write a.txt",
            targetPaths: ["a.txt"],
            requiredChecks: ["true"],
            denylistPaths: ["forbidden.txt"],
          },
        },
      ]);
      const t1 = plan.tasks[0];
      const runId = await allocateRunId(s.runsDir, "T1", await readFile(t1.contract), base);
      const run = await runTask(plan, t1, base, runId, {
        adapter: "scripted",
        adapterConfig: await writeScriptedConfig(s, "T1", [{ changedFiles: ["forbidden.txt"] }]),
      });
      expect(run.outcome).toBe("blocked_waiting_human");
      expect(run.attemptSha).toBeNull();

      await expect(harvest(run, base, await declaredOf(t1.contract))).rejects.toThrow(
        /published no attempt commit/,
      );
    } finally {
      await s.cleanup();
    }
  }, 180_000);

  it("declared-but-not-produced is a warning and a ledger entry, never a failure", async () => {
    // snakemake fails here (MissingOutputException) and it is right to: its
    // outputs are rule-declared and machine-precise. targetPaths is a
    // human-written intent range, usually written wide. Applying a precise
    // contract's strictness to a coarse one trains people to write targetPaths
    // as narrow as possible -- which is the unsafe direction in spec §3.1,
    // because a narrow declaration is what makes the layering miss a real
    // overlap.
    const s = await makeSandbox();
    try {
      const base = await headOf(s.targetRepo);
      const { plan } = await seedTasks(s, [
        {
          taskId: "T1",
          contract: {
            goal: "write a.txt and d.txt",
            targetPaths: ["a.txt", "d.txt"],
            requiredChecks: ["printf 'x' > a.txt"],
            buildTestCommands: ["true"],
          },
        },
      ]);
      const t1 = plan.tasks[0];
      const runId = await allocateRunId(s.runsDir, "T1", await readFile(t1.contract), base);
      const run = await runTask(plan, t1, base, runId, {
        adapter: "scripted",
        adapterConfig: await writeScriptedConfig(s, "T1", [{}]),
      });
      expect(run.outcome).toBe("succeeded");

      const r = await harvest(run, base, await declaredOf(t1.contract));
      expect(r.actualPaths).toEqual(["a.txt"]);
      expect(r.declaredNotProduced).toEqual(["d.txt"]);
      expect(r.outOfBounds).toEqual([]);
      expect(r.empty).toBe(false);

      const d = disposition(r, NO_SIBLINGS);
      expect(d.land).toBe(true);
      expect(d.exitContribution).toBe(0);
    } finally {
      await s.cleanup();
    }
  }, 180_000);
});
