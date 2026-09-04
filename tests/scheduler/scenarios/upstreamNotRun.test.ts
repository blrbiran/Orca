import { describe, expect, it } from "vitest";
import {
  captureStreams,
  makeSandbox,
  runCli,
  seedRunnablePlan,
  seedUnreconcilableLyingPlanWithDownstream,
  showFileAt,
  taskWorkdirs,
  writeFileCheck,
  writePlan,
  writeRawContract,
  writeScriptedConfig,
} from "../sandbox.js";

// Final review, Important 3. spec §6.2 says `upstream_not_run` and "ran and
// broke" are different facts — and only ccloop's own terminal statuses ever
// produced the first one. The two branches where C ITSELF refuses a result
// both just `continue`d, so a downstream task whose upstream's work had been
// REFUSED went on to clone a W lacking that work, spawn ccloop against it, and
// be reported as its own failure. On a scripted round that is misleading; on a
// real one it is money spent on a task whose premise is known-false.
//
// Both criteria measure the same three things, because between them they are
// what makes "never ran" distinguishable from "ran and produced nothing":
//   - the downstream task's own output is NOT on W (it would be, if it ran),
//   - the round said `upstream_not_run` about it by name,
//   - it has no run directory under runsDir at all (S8's own control shape).
describe("a result C refuses blocks its descendants (spec §6.2)", () => {
  it("a task that succeeded_but_empty stops its downstream from starting", async () => {
    // run.ts's `!verdict.land` branch: ccloop says `succeeded`, the net change
    // set is empty (§6.2's succeeded_but_empty), C refuses to land it.
    //
    // Mutation `M-NOTRUN-LAND`: delete the `cannotStart(descendantsOf(graph,
    // taskId))` line from that branch. T2 then runs against a W missing T1's
    // work, lands b.txt, and BOTH the `showFileAt` assertion and the
    // `upstream_not_run` assertion go red.
    const s = await makeSandbox();
    try {
      const p = await seedRunnablePlan(s, [
        {
          taskId: "T1",
          // `true` writes nothing: the scripted adapter touches no files, and
          // required checks are the only route by which a scripted run
          // produces a non-empty tree. This is spec §4.4's silent-empty shape.
          contract: { goal: "write a.txt", targetPaths: ["a.txt"], requiredChecks: ["true"], buildTestCommands: ["true"] },
        },
        {
          taskId: "T2",
          contract: {
            goal: "write b.txt",
            targetPaths: ["b.txt"],
            requiredChecks: [writeFileCheck("b.txt", "b1")],
            buildTestCommands: ["true"],
          },
          dependsOn: ["T1"],
        },
      ]);

      const { result: rc, stdout } = await captureStreams(() =>
        runCli(["run", p.planPath, "--adapter-config", p.adapterConfig]),
      );

      // §6.3: T1's empty result contributes 2; T2 never ran and contributes
      // nothing at all.
      expect(rc).toBe(2);
      expect(stdout).toContain("T1: refusing to land");
      expect(stdout).toContain("T2: upstream_not_run");
      expect(await showFileAt(s.targetRepo, p.workBranch, "b.txt")).toBeNull();
      // S8's control shape: T1's refused copy is kept, so "no directory" here
      // demonstrably means "never started" rather than "cleaned up".
      const dirs = await taskWorkdirs(s);
      expect(dirs.some((d) => d.includes("-T1-"))).toBe(true);
      expect(dirs.some((d) => d.includes("-T2-"))).toBe(false);
    } finally {
      await s.cleanup();
    }
  }, 180_000);

  it("a conflict C could not reconcile stops its downstream from starting", async () => {
    // run.ts's `!reconciled.landed` branch — a genuinely different route to
    // the same §6.2 fact, reached through §5's whole conflict main line: T1
    // and T2 both write shared.txt without declaring it, T2's merge
    // conflicts, and the reconciliation leaves markers behind (S3's own
    // fixture shape), so C refuses to land T2 and escalates.
    //
    // Mutation `M-NOTRUN-RECONCILE`: delete the `cannotStart` line from that
    // branch. T3 runs, lands c.txt, and the `showFileAt` and `upstream_not_run`
    // assertions go red. A mutation of the OTHER branch cannot redden this
    // one, which is why the two criteria are separate.
    const s = await makeSandbox();
    try {
      const p = await seedUnreconcilableLyingPlanWithDownstream(s);
      const { result: rc, stdout } = await captureStreams(() =>
        runCli(["run", p.planPath, "--adapter-config", p.adapterConfig]),
      );

      expect(rc).toBe(3);
      // The fixture's own premise: T1 landed, T2 did not.
      expect(await showFileAt(s.targetRepo, p.workBranch, "a.txt")).toBe("a1\n");
      expect(await showFileAt(s.targetRepo, p.workBranch, "b.txt")).toBeNull();
      // The property under test.
      expect(stdout).toContain("T3: upstream_not_run");
      expect(await showFileAt(s.targetRepo, p.workBranch, "c.txt")).toBeNull();
      const dirs = await taskWorkdirs(s);
      expect(dirs.some((d) => d.includes("-T3-"))).toBe(false);
    } finally {
      await s.cleanup();
    }
  }, 300_000);
});

// Final review, Important 5, the half of it that is about `Promise.all`
// rejecting on the first failure rather than about the missing bound. The
// unit-level properties of the pool itself are in tests/scheduler/pool.test.ts;
// this is the production wiring — that run.ts really settles per task instead
// of letting one task's exception take the round.
describe("one task's exception is that task's failure (spec §6.1 / §1.3)", () => {
  it("a task that throws before ccloop reports anything does not discard its layer", async () => {
    // T2's contract is valid JSON — so `loadRound` accepts it and the graph is
    // built from it — but is not a contract ccloop will accept, so ccloop's own
    // catch exits without writing a loop-state.json and `runTask` throws rather
    // than inventing a terminal status. T1 is an ordinary task in the SAME
    // layer (their declared write sets are disjoint).
    //
    // Mutation `M-SETTLE`: restore `await Promise.all(runnable.map(...))`. The
    // throw then escapes the layer, the round's catch turns it into exit 3, and
    // T1's finished result is discarded un-harvested — so `rc` and the
    // `showFileAt` assertion both go red, and T1's copy is left behind
    // undisposed as well.
    const s = await makeSandbox();
    try {
      const t1 = await writeRawContract(
        s,
        "ok-t1",
        JSON.stringify(
          {
            objective: { taskId: "T1", goal: "write a.txt", successCondition: "a.txt exists", nonGoals: [] },
            context: {
              repoPath: s.targetRepo,
              targetPaths: ["a.txt"],
              relevantDocs: [],
              buildTestCommands: ["true"],
              constraints: [],
            },
            executionPolicy: {
              autonomyLevel: "L2",
              maxAttempts: 1,
              perAttemptTimeoutMs: 60_000,
              totalRuntimeBudgetMs: 60_000,
              tokenBudget: 100_000,
              worktreeRequired: true,
              partialOutcomeRecoveryWindowMs: 0,
            },
            safetyPolicy: { allowlistPaths: [], denylistPaths: [], maxFilesTouched: 1, humanGateConditions: [] },
            verification: {
              verifierType: "command",
              requiredChecks: [writeFileCheck("a.txt", "a1")],
              rejectOn: ["nonzero exit"],
              evidenceRequired: [],
            },
            escalationAndExit: {
              escalationTargets: [],
              pauseOn: [],
              stopOn: [],
              terminalStates: ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"],
            },
          },
          null,
          2,
        ),
      );
      // Valid JSON, no contract ccloop can run. Its write set is empty, so the
      // graph puts it in T1's layer rather than serialising the pair — which is
      // the whole point: the sibling has to be genuinely concurrent.
      const t2 = await writeRawContract(s, "broken-t2", JSON.stringify({ notAContract: true }));

      const planPath = await writePlan(s, {
        targetRepo: s.targetRepo,
        ccloopBin: s.ccloopBin,
        runsDir: s.runsDir,
        workBranch: "orca/w/x",
        policy: "local-merge",
        ledgerMode: "in-repo",
        tasks: [
          { taskId: "T1", contract: t1, dependsOn: [] },
          { taskId: "T2", contract: t2, dependsOn: [] },
        ],
      });
      const adapterConfig = await writeScriptedConfig(s, "settle", [{}]);

      const { result: rc, stdout, stderr } = await captureStreams(() =>
        runCli(["run", planPath, "--adapter-config", adapterConfig]).catch((err: Error) => err.message),
      );

      // §6.1's `failed` row, applied to a task that never got as far as a
      // status: exit 2, not the 3 an escaped exception produces.
      expect(rc).toBe(2);
      expect(stderr).toContain("T2: the task threw before ccloop could report a terminal status");
      // And its sibling's work still landed, which is the part `Promise.all`
      // threw away.
      expect(await showFileAt(s.targetRepo, "orca/w/x", "a.txt")).toBe("a1\n");
      expect(stdout).toContain("T1: ccloop reported succeeded");
    } finally {
      await s.cleanup();
    }
  }, 180_000);

  it("a layer larger than the concurrency bound still lands every one of its tasks", async () => {
    // The pool's cap is a cap, not a cut. MAX_PARALLEL_TASKS is 4 and this
    // layer has 5 disjoint tasks, so at least one of them is only started
    // after another has finished — a pool that dropped, reordered, or
    // double-ran the tail would show up here as a missing file on W.
    //
    // ⚠️ Honest limit, recorded rather than implied: this criterion proves the
    // pool is wired into run.ts and loses no work. It does NOT observe the
    // cap's numeric value end to end — measuring real overlap across five
    // ccloop spawns is timing-dependent, and a flaky criterion is worse than
    // none. The cap itself is measured in tests/scheduler/pool.test.ts
    // (`M-POOL-CAP`).
    const s = await makeSandbox();
    try {
      const p = await seedRunnablePlan(
        s,
        Array.from({ length: 5 }, (_, i) => ({
          taskId: `T${i + 1}`,
          contract: {
            goal: `write f${i + 1}.txt`,
            targetPaths: [`f${i + 1}.txt`],
            requiredChecks: [writeFileCheck(`f${i + 1}.txt`, `v${i + 1}`)],
            buildTestCommands: ["true"],
          },
        })),
      );

      const rc = await runCli(["run", p.planPath, "--adapter-config", p.adapterConfig]);
      expect(rc).toBe(0);
      for (let i = 1; i <= 5; i += 1) {
        expect(await showFileAt(s.targetRepo, p.workBranch, `f${i}.txt`)).toBe(`v${i}\n`);
      }
    } finally {
      await s.cleanup();
    }
  }, 300_000);
});
