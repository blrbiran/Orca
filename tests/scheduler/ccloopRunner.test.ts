import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allocateRunId } from "../../src/scheduler/runId.js";
import { cloneDirOf, disposeWorkdir, routeOutcome, runTask, type TaskRun } from "../../src/scheduler/ccloopRunner.js";
import { buildGraph, type TaskGraph } from "../../src/scheduler/graph.js";
import type { PlanFile, PlanTask } from "../../src/scheduler/planFile.js";
import {
  allRefShas,
  captureStdout,
  commitOnTop,
  git,
  headOf,
  makeSandbox,
  planThatSpawns,
  refSha,
  writeContract,
  writeScriptedConfig,
  type ContractSpec,
  type Sandbox,
  type ScriptedFrameSpec,
} from "./sandbox.js";

// Boilerplate shared by this file's spawning criteria, deliberately NOT in
// sandbox.ts: it calls runTask, the function under test, and a helper that
// wraps the call under test is a helper that can quietly stop making it.
async function spawnOne(
  s: Sandbox,
  taskId: string,
  contractSpec: ContractSpec,
  frames: ScriptedFrameSpec[],
  base: string,
): Promise<{ run: TaskRun; plan: PlanFile; task: PlanTask; contractPath: string }> {
  const contractPath = await writeContract(s, taskId, contractSpec);
  const adapterConfig = await writeScriptedConfig(s, taskId, frames);
  const task: PlanTask = { taskId, contract: contractPath, dependsOn: [] };
  const plan = await planThatSpawns(s, [task]);
  const runId = await allocateRunId(s.runsDir, taskId, await readFile(contractPath), base);
  const run = await runTask(plan, task, base, runId, { adapter: "scripted", adapterConfig });
  return { run, plan, task, contractPath };
}

describe("ccloopRunner (spec §4.3 steps 2-3, §6.1)", () => {
  it("reads the terminal status from loop-state.json, not from the exit code", async () => {
    // ccloop's run/resume both return `status === "succeeded" ? 0 : 2`, which
    // flattens four distinct non-success terminal states into one number.
    // Those four route four different ways in section 6.1, so the exit code
    // cannot be the source of truth.
    //
    // The two runs below are chosen so that the exit code is the ONLY thing
    // they share: measured on ccloop 7f2c5f6, a denylist hit exits 2 with
    // status blocked_waiting_human and a failing required check under
    // maxAttempts 1 exits 2 with status exhausted. A runner that read the
    // exit code would have to report the same outcome for both, so this pair
    // — not either run alone — is what pins the claim.
    const s = await makeSandbox();
    try {
      const base = await headOf(s.targetRepo);

      const blocked = await spawnOne(
        s,
        "TBLOCKED",
        { goal: "trip the denylist", targetPaths: ["a.txt"], requiredChecks: ["true"], denylistPaths: ["forbidden.txt"] },
        [{ changedFiles: ["forbidden.txt"] }],
        base,
      );
      const exhausted = await spawnOne(
        s,
        "TEXHAUSTED",
        { goal: "fail its checks", targetPaths: ["b.txt"], requiredChecks: ["false"], maxAttempts: 1 },
        [{}],
        base,
      );

      expect(blocked.run.outcome).toBe("blocked_waiting_human");
      expect(exhausted.run.outcome).toBe("exhausted");
      expect(blocked.run.outcome).not.toBe(exhausted.run.outcome);

      // Measured ccloop behaviour Task 9 has to plan around, pinned here
      // rather than left as a footnote: runLoop skips worktree cleanup on the
      // blocked_waiting_human path, and publishAttemptCommit runs only inside
      // that cleanup — so a blocked run leaves no attempt ref to harvest,
      // while every other terminal decision does.
      expect(blocked.run.attemptSha).toBeNull();
      expect(exhausted.run.attemptSha).not.toBeNull();
    } finally {
      await s.cleanup();
    }
  }, 120_000);

  it("rewrites the contract's repoPath to the per-task clone", async () => {
    // ccloop has no field for "start from this commit": worktree add --detach
    // takes no commit-ish, and the contract schema is .strict() with no base
    // ref. Controlling repoPath is therefore the only way to control the base,
    // and it is the entire reason for a clone per task.
    const s = await makeSandbox();
    try {
      const base = await headOf(s.targetRepo);
      // The target repo's HEAD is deliberately moved PAST the base. Without
      // this the whole criterion is vacuous: a run that ignored the rewrite
      // and worked in the target repo would still leave a clone sitting at
      // the base, and every assertion below would pass for the wrong reason.
      const laterHead = await commitOnTop(s, "later.txt", "later\n");
      expect(laterHead).not.toBe(base);

      const { run, contractPath } = await spawnOne(
        s,
        "T1",
        { goal: "write a.txt", targetPaths: ["a.txt"], requiredChecks: ["true"] },
        [{}],
        base,
      );

      expect(run.outcome).toBe("succeeded");
      expect(await headOf(cloneDirOf(run.workdir))).toBe(base);

      // The three assertions that actually measure where ccloop ran. The
      // clone's own HEAD above does not: the clone is created either way, so
      // it reads back a value this code wrote before ccloop was ever spawned.
      // The attempt ref exists only in the repository ccloop's worktree came
      // from, and its parent is that repository's HEAD at worktree-add time.
      expect(run.attemptSha).not.toBeNull();
      expect(await refSha(cloneDirOf(run.workdir), `${run.attemptSha}^`)).toBe(base);
      expect(Object.keys(await allRefShas(s.targetRepo)).filter((r) => r.startsWith("refs/ccloop/"))).toEqual([]);

      // The contract a plan names is shared, lives outside the target repo,
      // and may be read again by a later task: the rewrite must produce a
      // copy, never edit it in place.
      expect(JSON.parse(await readFile(contractPath, "utf8")).context.repoPath).toBe(s.targetRepo);
      expect(JSON.parse(await readFile(join(run.workdir, "contract.json"), "utf8")).context.repoPath).toBe(
        cloneDirOf(run.workdir),
      );
    } finally {
      await s.cleanup();
    }
  }, 120_000);

  it("fails loud when ccloop leaves no terminal status behind", async () => {
    // Rule 12: the exit code is not the source of truth, so a run that wrote
    // no loop-state.json at all has no truth to report. Returning some
    // plausible outcome here would be the exact silent-degradation shape
    // spec §0.1 forbids. The fixture points ccloopBin at a script that exits
    // non-zero having written nothing, which is what a ccloop that died on
    // its own argument parsing looks like from here.
    const s = await makeSandbox();
    try {
      const base = await headOf(s.targetRepo);
      const contractPath = await writeContract(s, "T1", {
        goal: "x",
        targetPaths: ["a.txt"],
        requiredChecks: ["true"],
      });
      const adapterConfig = await writeScriptedConfig(s, "T1", [{}]);
      const task: PlanTask = { taskId: "T1", contract: contractPath, dependsOn: [] };
      const plan = { ...(await planThatSpawns(s, [task])), ccloopBin: join(s.root, "exploding-ccloop.mjs") };
      await writeFile(plan.ccloopBin, 'process.stderr.write("boom\\n");\nprocess.exit(1);\n');
      const runId = await allocateRunId(s.runsDir, "T1", await readFile(contractPath), base);

      await expect(runTask(plan, task, base, runId, { adapter: "scripted", adapterConfig })).rejects.toThrow(
        /loop-state\.json/,
      );
    } finally {
      await s.cleanup();
    }
  }, 120_000);

  it("fails loud when ccloop leaves a status that is not terminal", async () => {
    // Fix round 1, finding 1: a status like "executing" means the process was
    // killed mid-run, which is not an outcome. Without the guard the string
    // flows straight into routeOutcome, falls through to its default row and
    // is reported as a failure that counts against the round — spec §0.1's
    // silent degradation, with nothing anywhere to notice it happened.
    //
    // The stub exits 0 on purpose: a runner reading the exit code would call
    // this a success, and one that trusted whatever string it found would call
    // it a failure. Both are wrong, and neither is what this asserts.
    const s = await makeSandbox();
    try {
      const base = await headOf(s.targetRepo);
      const contractPath = await writeContract(s, "T1", {
        goal: "x",
        targetPaths: ["a.txt"],
        requiredChecks: ["true"],
      });
      const adapterConfig = await writeScriptedConfig(s, "T1", [{}]);
      const task: PlanTask = { taskId: "T1", contract: contractPath, dependsOn: [] };
      const plan = { ...(await planThatSpawns(s, [task])), ccloopBin: join(s.root, "half-finished-ccloop.mjs") };
      await writeFile(
        plan.ccloopBin,
        [
          'import { writeFileSync } from "node:fs";',
          'import { join } from "node:path";',
          'const runDir = process.argv[process.argv.indexOf("--run-dir") + 1];',
          'writeFileSync(join(runDir, "loop-state.json"), JSON.stringify({ status: "executing" }));',
          "process.exit(0);",
          "",
        ].join("\n"),
      );
      const runId = await allocateRunId(s.runsDir, "T1", await readFile(contractPath), base);

      await expect(runTask(plan, task, base, runId, { adapter: "scripted", adapterConfig })).rejects.toThrow(
        /non-terminal status "executing"/,
      );
    } finally {
      await s.cleanup();
    }
  }, 120_000);

  it("refuses an empty run id before it builds anything", async () => {
    // Fix round 1, finding 2, the runTask half: join(runsDir, "") is runsDir,
    // so an empty id would make this task's work copy the directory that holds
    // every other task's, and the TaskRun handed downstream would name it.
    // Refused before the clone, which is what the second assertion measures.
    const s = await makeSandbox();
    try {
      const base = await headOf(s.targetRepo);
      const contractPath = await writeContract(s, "T1", {
        goal: "x",
        targetPaths: ["a.txt"],
        requiredChecks: ["true"],
      });
      const adapterConfig = await writeScriptedConfig(s, "T1", [{}]);
      const task: PlanTask = { taskId: "T1", contract: contractPath, dependsOn: [] };
      const plan = await planThatSpawns(s, [task]);

      await expect(runTask(plan, task, base, "", { adapter: "scripted", adapterConfig })).rejects.toThrow(
        /non-empty run id/,
      );
      expect(existsSync(cloneDirOf(s.runsDir))).toBe(false);
    } finally {
      await s.cleanup();
    }
  }, 120_000);
});

describe("disposeWorkdir (spec §4.5)", () => {
  // These build a real clone rather than a bare directory, because that is
  // what deletion has to cope with: `git clone --local` hard-links the object
  // store but materialises a real working tree, and a blocked run additionally
  // leaves a registered ccloop worktree behind inside the same workdir.
  async function seedWorkdir(s: Sandbox, outcome: TaskRun["outcome"]): Promise<TaskRun> {
    const workdir = join(s.runsDir, `orca-DISPOSE-${outcome}`);
    await git(s.root, ["clone", "--local", s.targetRepo, cloneDirOf(workdir)]);
    return { runId: `orca-DISPOSE-${outcome}`, workdir, outcome, attemptSha: null };
  }

  it("removes a successful task's clone", async () => {
    // §4.5: `clone --local` hard-links the object store but the working tree
    // is real files, which is what makes "keep everything" the wrong default.
    const s = await makeSandbox();
    try {
      const run = await seedWorkdir(s, "succeeded");
      expect(existsSync(run.workdir)).toBe(true);
      const { result } = await captureStdout(() => disposeWorkdir(run));
      expect(result.removed).toBe(true);
      expect(existsSync(run.workdir)).toBe(false);
    } finally {
      await s.cleanup();
    }
  });

  it("keeps a task's clone when it did not succeed, and says where it is", async () => {
    // The copy is the only evidence left of what a failed task did: ccloop's
    // run directory, its attempt artefacts and the attempt refs all live
    // inside it. Deleting it makes the failure unexaminable, and keeping it
    // without printing the path makes it unfindable.
    const s = await makeSandbox();
    try {
      const run = await seedWorkdir(s, "failed");
      const { result, stdout } = await captureStdout(() => disposeWorkdir(run));
      expect(result.removed).toBe(false);
      expect(existsSync(run.workdir)).toBe(true);
      expect(stdout).toContain(run.workdir);
    } finally {
      await s.cleanup();
    }
  });

  it("keeps a successful task's clone under --keep-workdirs", async () => {
    const s = await makeSandbox();
    try {
      const run = await seedWorkdir(s, "succeeded");
      const { result, stdout } = await captureStdout(() => disposeWorkdir(run, { keepWorkdirs: true }));
      expect(result.removed).toBe(false);
      expect(existsSync(run.workdir)).toBe(true);
      expect(stdout).toContain(run.workdir);
    } finally {
      await s.cleanup();
    }
  });

  it("refuses a workdir that is not the run's own directory, and deletes nothing", async () => {
    // Fix round 1, finding 2. This is the scheduler's only recursive delete,
    // and the path it takes is a plain field on a value it did not build: the
    // orchestrator carries a TaskRun across spec §4.3's steps 4-6, and the
    // criteria above already hand-build them. A TaskRun naming the runs
    // directory itself — what an empty run id produces — would take out every
    // other task's clone and every contract copy in the round.
    //
    // The second and third assertions are the point of the criterion, not
    // decoration: a guard that throws AFTER the rm has run would satisfy the
    // rejects assertion alone while the damage was already done, so the
    // decoy directory is what proves the refusal happened first.
    const s = await makeSandbox();
    try {
      const decoy = join(s.runsDir, "orca-SOMEONE-ELSE-1");
      await mkdir(join(decoy, "repo"), { recursive: true });
      const forged: TaskRun = {
        runId: "orca-T1-deadbeef",
        workdir: s.runsDir,
        outcome: "succeeded",
        attemptSha: null,
      };

      await expect(disposeWorkdir(forged)).rejects.toThrow(/refusing to dispose/);
      expect(existsSync(s.runsDir)).toBe(true);
      expect(existsSync(join(decoy, "repo"))).toBe(true);
    } finally {
      await s.cleanup();
    }
  });
});

describe("routeOutcome (spec §6.1's four-row table)", () => {
  // Pure: no clone, no spawn. The scenarios above prove the table is wired to
  // real ccloop outcomes; these prove every row of it exists, including the
  // two rows no scenario in this task can reach — `cancelled` needs a human
  // pressing stop, and `exhausted`'s routing is identical to `failed`'s but
  // must not be assumed to be.
  function graphOf(tasks: Array<{ taskId: string; dependsOn: string[]; targetPaths: string[] }>): TaskGraph {
    const plan: PlanFile = {
      targetRepo: "/target",
      ccloopBin: "/ccloop/dist/cli.js",
      runsDir: "/runs",
      workBranch: "orca/w",
      policy: "local-merge",
      ledgerMode: "in-repo",
      tasks: tasks.map((t) => ({ taskId: t.taskId, contract: `/contracts/${t.taskId}.json`, dependsOn: t.dependsOn })),
    };
    const contracts = new Map<string, unknown>(
      tasks.map((t) => [t.taskId, { context: { targetPaths: t.targetPaths } }]),
    );
    return buildGraph(plan, contracts);
  }

  const chain = () =>
    graphOf([
      { taskId: "T1", dependsOn: [], targetPaths: ["a.txt"] },
      { taskId: "T2", dependsOn: ["T1"], targetPaths: ["b.txt"] },
      { taskId: "T3", dependsOn: [], targetPaths: ["c.txt"] },
    ]);

  it("gives each of ccloop's five terminal states its own verdict", () => {
    // spec §6.1 withdrew "non-succeeded ⇒ descendants all blocked" because the
    // five states say five different things. The pairs below are the ones a
    // collapsed rule gets wrong: blocked escalates and is not a failure, while
    // exhausted and failed are failures that escalate nothing.
    const g = chain();
    expect(routeOutcome(g, "T1", "succeeded")).toEqual({
      countsAsFailure: false,
      escalates: false,
      upstreamNotRun: [],
      stopRound: false,
    });
    expect(routeOutcome(g, "T1", "blocked_waiting_human")).toEqual({
      countsAsFailure: false,
      escalates: true,
      upstreamNotRun: ["T2"],
      stopRound: false,
    });
    expect(routeOutcome(g, "T1", "exhausted")).toEqual({
      countsAsFailure: true,
      escalates: false,
      upstreamNotRun: ["T2"],
      stopRound: false,
    });
    expect(routeOutcome(g, "T1", "failed")).toEqual({
      countsAsFailure: true,
      escalates: false,
      upstreamNotRun: ["T2"],
      stopRound: false,
    });
  });

  it("stops the whole round when a task is cancelled", () => {
    // spec §6.1's cancelled row: a human pressed stop, so starting more tasks
    // acts against the intent that produced it — unlike every other
    // non-success state, where the unrelated branches keep going. This is the
    // only branch of the table S8 and S9 cannot reach, so without this it
    // would be a branch with no criterion.
    expect(routeOutcome(chain(), "T1", "cancelled")).toEqual({
      countsAsFailure: true,
      escalates: false,
      upstreamNotRun: ["T2", "T3"],
      stopRound: true,
    });
  });

  it("counts an implicitly-downstream task as a descendant", () => {
    // The write-set edges buildGraph derives are edges (spec §2.4: edges are
    // dependsOn ∪ write-set intersection). A task that claims an overlapping
    // path but declared no dependency is just as unable to start from a base
    // its upstream never produced, so following only dependsOn here would let
    // it run against a base that does not exist.
    const g = graphOf([
      { taskId: "A", dependsOn: [], targetPaths: ["src/**"] },
      { taskId: "B", dependsOn: [], targetPaths: ["src/a.ts"] },
    ]);
    expect(g.implicit.map((e) => [e.from, e.to])).toEqual([["A", "B"]]);
    expect(routeOutcome(g, "A", "failed").upstreamNotRun).toEqual(["B"]);
  });
});
