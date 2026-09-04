// The disposable test harness every scheduler scenario in this plan is built
// on. Each sandbox is a throwaway git repository plus a "runs" directory that
// sits outside it, so scenarios can assert about refs, porcelain output, and
// where files land without touching the developer's machine or a shared fixture
// that could pick up state left behind by a previous test run.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { main } from "../../src/cli.js";
import type { PlanFile } from "../../src/scheduler/planFile.js";

const execFileAsync = promisify(execFile);

export interface Sandbox {
  root: string;
  targetRepo: string;
  runsDir: string;
  ccloopBin: string;
  cleanup(): Promise<void>;
}

// A contract this harness writes must be accepted by ccloop's own `.strict()`
// schema (src/contract/schema.ts) or the first real spawn (Task 8) explodes
// on a shape mismatch neither repo's tests would catch beforehand. This type
// only surfaces the fields a scenario is likely to want to vary; writeContract
// fills in every other required field with a fixed, schema-legal default.
export interface ContractSpec {
  goal: string;
  targetPaths: string[];
  requiredChecks: string[];
  taskId?: string;
  successCondition?: string;
  buildTestCommands?: string[];
  rejectOn?: string[];
  // Task 8: the two knobs that steer a real ccloop run to a terminal status
  // other than `succeeded`. Both are measured routes, not guesses -- see the
  // task-8 report's terminal-status table. maxAttempts picks which of
  // `exhausted` and `failed` a rejected verification lands on
  // (stopController.ts checks `attemptNumber >= maxAttempts` BEFORE it checks
  // safeToRetry, so maxAttempts 1 yields `exhausted` and 2 yields `failed`),
  // and denylistPaths is the only route to `blocked_waiting_human` that works
  // with `verifierType: "command"` -- under that verifier runLoop never calls
  // the adapter's verify at all, so the pauseSignals/pauseOn route is dead.
  maxAttempts?: number;
  denylistPaths?: string[];
  // Task 9: the only route to a run that RETRIES. runRequiredChecks hard-codes
  // `safeToRetry: false` on its own rejection, and under `verifierType:
  // "command"` runLoop never calls adapter.verify at all, so a command-verified
  // run can never reach stopController's `retryable` branch and always
  // publishes exactly one attempt ref. Switching to "agent" makes the scripted
  // frame's verification block the one stopController reads, which is what lets
  // a scenario script "reject attempt 1, approve attempt 2" and get two refs.
  verifierType?: "command" | "agent";
}

// Identity is passed per-invocation rather than configured, so a machine with
// no global user.email — a CI container, a fresh checkout — runs these tests
// identically to a developer's laptop.
const ID = ["-c", "user.name=orca-test", "-c", "user.email=orca-test@invalid"];

// Exported per ruling R1: later tasks' scenarios need a raw git escape hatch
// on the sandbox's repos, and sandbox.ts is the single home for it.
export async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: repo });
  return stdout;
}

// ccloop's package.json is `private: true`, so it is never an npm dependency
// and its bin is only ever this literal path on disk — resolved fresh per
// sandbox rather than cached, since a rebuild while tests are running should
// be picked up. Thrown explicitly and by name: a missing dist/cli.js would
// otherwise surface many stack frames away as an opaque ENOENT from spawn.
// Task 8 (deferred minor carried from Task 1): the sibling layout used to be
// hard-coded with no way out, which was harmless while no scenario spawned
// ccloop and is not harmless now that Task 8's do. A checkout that keeps the
// two repositories anywhere else — a CI image, a second working copy — could
// not run a single scheduler scenario. ORCA_CCLOOP_BIN is read on each call
// rather than captured once, for the same reason the sibling path is resolved
// fresh: a rebuild or a re-export between two tests should be picked up. The
// named error survives the override and says which of the two sources the
// path came from, because "ENOENT spawning /some/path" many frames away is
// exactly the diagnosis this error exists to replace.
function resolveCcloopBin(): string {
  const override = process.env.ORCA_CCLOOP_BIN;
  const bin = override ?? resolve(dirname(new URL(import.meta.url).pathname), "../../../ccloop/dist/cli.js");
  if (!existsSync(bin)) {
    const source = override === undefined ? "the sibling-directory default" : "ORCA_CCLOOP_BIN";
    throw new Error(
      `ccloop bin not found at ${bin} (from ${source}). ccloop's package.json is private and its bin ` +
        `is never an npm dependency — run "npm run build" inside the ccloop repo first, ` +
        `or point ORCA_CCLOOP_BIN at its dist/cli.js.`,
    );
  }
  return bin;
}

export async function makeSandbox(
  // Test-only seam: the default resolver is the real one, but a scenario that
  // wants to exercise "resolution fails" without ccloop's build state
  // actually being absent on this machine can substitute its own. Nothing in
  // Tasks 2+ is expected to pass this; it exists for sandbox.test.ts itself.
  options: { resolveCcloopBin?: () => string } = {},
): Promise<Sandbox> {
  const root = await mkdtemp(join(tmpdir(), "orca-sched-"));
  const targetRepo = join(root, "repo");
  const runsDir = join(root, "runs");
  await mkdir(targetRepo, { recursive: true });
  await mkdir(runsDir, { recursive: true });
  await git(targetRepo, ["init"]);
  await writeFile(join(targetRepo, "README.md"), "seed\n");
  await git(targetRepo, [...ID, "add", "-A"]);
  await git(targetRepo, [...ID, "commit", "-m", "init"]);
  const resolver = options.resolveCcloopBin ?? resolveCcloopBin;
  // Resolved lazily, on first read, not here. None of this task's three
  // scenarios ever spawn ccloop, so eagerly resolving at construction would
  // make every sandbox — on any machine or CI lacking ccloop's gitignored
  // dist/ build — fail for a reason that has nothing to do with the code
  // under test. The named error resolveCcloopBin throws now surfaces at the
  // point of first real use (Task 8's spawn) instead of at every construction.
  let cached: string | undefined;
  return {
    root,
    targetRepo,
    runsDir,
    get ccloopBin(): string {
      if (cached === undefined) cached = resolver();
      return cached;
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

// spec §2.3 rejects a plan whose contract lives inside the target repo — an
// upstream task could otherwise rewrite the write set the graph was built
// from. Writing here, under runsDir rather than targetRepo, is what makes
// that rejection testable at all.
export async function writeContract(s: Sandbox, taskId: string, spec: ContractSpec): Promise<string> {
  const contract = {
    objective: {
      taskId: spec.taskId ?? taskId,
      goal: spec.goal,
      successCondition: spec.successCondition ?? spec.goal,
      nonGoals: [],
    },
    context: {
      repoPath: s.targetRepo,
      targetPaths: spec.targetPaths,
      relevantDocs: [],
      buildTestCommands: spec.buildTestCommands ?? spec.requiredChecks,
      constraints: [],
    },
    executionPolicy: {
      autonomyLevel: "L2",
      maxAttempts: spec.maxAttempts ?? 1,
      perAttemptTimeoutMs: 60_000,
      totalRuntimeBudgetMs: 60_000,
      tokenBudget: 100_000,
      worktreeRequired: true,
      partialOutcomeRecoveryWindowMs: 0,
    },
    safetyPolicy: {
      allowlistPaths: [],
      denylistPaths: spec.denylistPaths ?? [],
      maxFilesTouched: spec.targetPaths.length,
      humanGateConditions: [],
    },
    verification: {
      verifierType: spec.verifierType ?? "command",
      requiredChecks: spec.requiredChecks,
      rejectOn: spec.rejectOn ?? ["nonzero exit"],
      evidenceRequired: [],
    },
    escalationAndExit: {
      escalationTargets: [],
      pauseOn: [],
      stopOn: [],
      terminalStates: ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"],
    },
  };
  const path = join(s.runsDir, `contract-${taskId}.json`);
  await writeFile(path, JSON.stringify(contract, null, 2));
  return path;
}

export async function writePlan(s: Sandbox, plan: unknown): Promise<string> {
  const path = join(s.runsDir, "plan.json");
  await writeFile(path, JSON.stringify(plan, null, 2));
  return path;
}

export async function refSha(repo: string, ref: string): Promise<string | null> {
  try {
    return (await git(repo, ["rev-parse", ref])).trim();
  } catch {
    // Not a spawn failure worth surfacing: "the ref does not exist yet" is a
    // question scenarios legitimately ask (e.g. before a task has published
    // its attempt branch).
    return null;
  }
}

export async function allRefShas(repo: string): Promise<Record<string, string>> {
  const out = await git(repo, ["for-each-ref", "--format=%(refname) %(objectname)"]);
  const refs: Record<string, string> = {};
  for (const line of out.split("\n")) {
    if (line.trim().length === 0) continue;
    const [refname, objectname] = line.split(" ");
    refs[refname] = objectname;
  }
  return refs;
}

export async function porcelain(repo: string): Promise<string> {
  return git(repo, ["status", "--porcelain"]);
}

/**
 * Task 14 (S10): runs each of `checks` as a plain shell command against a
 * branch's tip, in a throwaway worktree rather than the sandbox's own
 * checked-out one — by the time S10 asks this question the target repo's
 * worktree is sitting wherever the round left it (usually W already), and
 * this must not disturb that. Returns 0 only if every check exits 0,
 * matching the exit-code convention the rest of this file measures with.
 */
export async function runChecksOnBranch(repo: string, branch: string, checks: string[]): Promise<number> {
  const dir = await mkdtemp(join(tmpdir(), "orca-checks-"));
  try {
    await git(repo, ["worktree", "add", "--detach", dir, branch]);
    for (const check of checks) {
      try {
        await execFileAsync("sh", ["-lc", check], { cwd: dir });
      } catch {
        return 1;
      }
    }
    return 0;
  } finally {
    try {
      await git(repo, ["worktree", "remove", "--force", dir]);
    } catch {
      await rm(dir, { recursive: true, force: true });
      await git(repo, ["worktree", "prune"]).catch(() => {});
    }
  }
}

// Ruling R1 (Task 5): the first scenario that needs to invoke the CLI itself
// rather than the pure functions underneath it. `main` already returns the
// exit code directly (tests/cli/cli.test.ts's own pattern) — spawning a real
// `tsx src/cli.ts` subprocess here would work too, but would also make every
// scheduler scenario pay a process-startup cost for no behavioural gain, since
// nothing about `plan`'s zero-side-effect claim depends on it being a
// separate OS process.
export async function runCli(argv: string[]): Promise<number> {
  return main(argv);
}

// Fix round 1, finding 2: the first scenario that needs to assert on what a
// CLI subcommand actually printed, not just its exit code — `main` writes
// through `process.stdout.write` directly rather than returning the text, so
// there is nothing to inspect without capturing it. Restores the real
// `process.stdout.write` in a `finally` even if `fn` throws, so a failing
// assertion inside `fn` cannot leave every later test writing into a swallowed
// buffer.
export async function captureStreams<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; stdout: string; stderr: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    out.push(chunk.toString());
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    err.push(chunk.toString());
    return true;
  }) as typeof process.stderr.write;
  try {
    const result = await fn();
    return { result, stdout: out.join(""), stderr: err.join("") };
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
}

export async function captureStdout<T>(fn: () => Promise<T>): Promise<{ result: T; stdout: string }> {
  const { result, stdout } = await captureStreams(fn);
  return { result, stdout };
}

// Ruling R1 (Task 5): the first scenario that needs a full, schedulable,
// two-task plan file on disk. T1 and T2 claim disjoint paths, so the graph
// `orca plan` builds has no implicit edge — S17 only cares that `plan` never
// mutates the target repo, not about any particular layering.
// Task 6: the first scenarios (S18/S19/S22) that need an actual PlanFile
// object in hand, not a path on disk — `preflight()` takes a PlanFile
// directly, unlike `runCli` which reads plan.json for itself. A single task
// is deliberate: none of those three scenarios care about the task list's
// contents, only about plan.targetRepo and plan.workBranch, so there is
// nothing to gain from a second task here.
export async function seedPlan(s: Sandbox, overrides: Partial<PlanFile> = {}): Promise<PlanFile> {
  const contract = await writeContract(s, "T1", { goal: "write a.txt", targetPaths: ["a.txt"], requiredChecks: ["true"] });
  return {
    targetRepo: s.targetRepo,
    ccloopBin: join(s.root, "unused-ccloop-cli.js"),
    runsDir: s.runsDir,
    workBranch: "orca/preflight-scenario-branch",
    policy: "local-merge",
    ledgerMode: "in-repo",
    tasks: [{ taskId: "T1", contract, dependsOn: [] }],
    ...overrides,
  };
}

/**
 * Task 14 (S11/S12/S13): a plan object with every field the six up-front
 * rejections care about defaulted to something valid, so a scenario for one
 * rejection code only has to override the single field it is about — the
 * same "vary one field off a known-good default" shape as writeContract's
 * ContractSpec. Returns the written path, like writePlan.
 */
export async function seedRejectablePlan(s: Sandbox, overrides: Record<string, unknown> = {}): Promise<string> {
  const contract = await writeContract(s, "T1", { goal: "write a.txt", targetPaths: ["a.txt"], requiredChecks: ["true"] });
  return writePlan(s, {
    targetRepo: s.targetRepo,
    ccloopBin: join(s.root, "unused-ccloop-cli.js"),
    runsDir: s.runsDir,
    workBranch: "orca/w/x",
    policy: "local-merge",
    ledgerMode: "in-repo",
    tasks: [{ taskId: "T1", contract, dependsOn: [] }],
    ...overrides,
  });
}

export async function seedTwoTaskPlan(s: Sandbox): Promise<string> {
  const c1 = await writeContract(s, "T1", { goal: "write a.txt", targetPaths: ["a.txt"], requiredChecks: ["true"] });
  const c2 = await writeContract(s, "T2", { goal: "write b.txt", targetPaths: ["b.txt"], requiredChecks: ["true"] });
  return writePlan(s, {
    targetRepo: s.targetRepo,
    // A syntactically valid absolute path is all loadPlan's schema checks —
    // `orca plan` never spawns ccloop (spec §9.2), so this deliberately does
    // not read s.ccloopBin. Reading it would resolve the lazy getter and fail
    // this scenario on any machine where ccloop has not been built, for a
    // reason that has nothing to do with the code under test.
    ccloopBin: join(s.root, "unused-ccloop-cli.js"),
    runsDir: s.runsDir,
    workBranch: "orca/plan-scenario-branch",
    policy: "local-merge",
    ledgerMode: "in-repo",
    tasks: [
      { taskId: "T1", contract: c1, dependsOn: [] },
      { taskId: "T2", contract: c2, dependsOn: [] },
    ],
  });
}

// Task 8: the first task that spawns ccloop, so the first that needs the
// target repo's HEAD as a value rather than as a side effect of a git call.
export async function headOf(repo: string): Promise<string> {
  return (await git(repo, ["rev-parse", "HEAD"])).trim();
}

// Task 8: moves the target repo's HEAD past a commit a scenario has already
// captured as its base. Load-bearing for the repoPath criterion and nothing
// else: while base === HEAD, a run that ignored the rewrite and worked
// straight in the target repo would produce a clone whose HEAD is the base
// anyway, and the criterion could never go red.
export async function commitOnTop(s: Sandbox, file: string, content: string): Promise<string> {
  await writeFile(join(s.targetRepo, file), content);
  await git(s.targetRepo, [...ID, "add", "-A"]);
  await git(s.targetRepo, [...ID, "commit", "-m", `add ${file}`]);
  return headOf(s.targetRepo);
}

// What a scenario actually varies between one scripted ccloop run and the
// next. Everything else in a frame is fixed boilerplate that ccloop's
// ScriptedAdapter hands back verbatim, so it is filled in below rather than
// retyped per scenario.
export interface ScriptedFrameSpec {
  // Fed to ccloop's evaluatePathPolicy (policy/pathPolicy.ts). This is the
  // handle a scenario uses to trip a denylist and reach
  // `blocked_waiting_human`; it is NOT what the run actually writes, because
  // the scripted adapter touches no files at all.
  changedFiles?: string[];
  // Task 9: read by ccloop only under `verifierType: "agent"` (see
  // ContractSpec.verifierType). `approved: false` with `safeToRetry: true` is
  // the exact pair stopController.evaluateStopDecision turns into `retryable`
  // -- every other combination is terminal on the first attempt -- so these two
  // knobs together are what produces a multi-attempt run.
  approved?: boolean;
  safeToRetry?: boolean;
}

/**
 * ccloop's `--adapter-config` for the `scripted` adapter: `{ frames: [...] }`,
 * one frame consumed per attempt (ScriptedAdapter.plan shifts the queue and
 * throws "no scripted frame remaining" if a run outlives the list). Written
 * outside the target repo for the same reason contracts are.
 *
 * Every frame carries a complete `verification` block even though a contract
 * with `verifierType: "command"` never reaches adapter.verify — runVerification
 * returns its own approved/rejected result from the required checks and only
 * consults the adapter under `verifierType: "agent"`. A half-filled frame
 * would work today and break silently the first time a scenario flips that
 * field, so the fixture stays honest instead of minimal.
 */
export async function writeScriptedConfig(s: Sandbox, name: string, frames: ScriptedFrameSpec[]): Promise<string> {
  const config = {
    frames: frames.map((frame, index) => ({
      plan: { summary: `scripted frame ${index + 1}`, primaryTargetPaths: [] },
      execution: {
        changedFiles: frame.changedFiles ?? [],
        diffPatch: "",
        commandOutputs: [],
        stdoutStderrLog: "",
      },
      verification: {
        approved: frame.approved ?? true,
        rejectCategory: "",
        primaryTargetPaths: [],
        failingCommand: null,
        safeToRetry: frame.safeToRetry ?? false,
        evidence: [],
        pauseSignals: [],
        stopSignals: [],
      },
    })),
  };
  const path = join(s.runsDir, `adapter-${name}.json`);
  await writeFile(path, JSON.stringify(config, null, 2));
  return path;
}

/**
 * A PlanFile whose ccloopBin is the real binary, unlike seedPlan's and
 * seedTwoTaskPlan's deliberately fake one. Reading s.ccloopBin resolves the
 * lazy getter, so this — and only this — is the builder that fails on a
 * machine where ccloop has not been built. That is correct for Task 8's
 * scenarios, which cannot mean anything without it, and would have been wrong
 * for Tasks 2-7's, which never spawn.
 */
export async function planThatSpawns(s: Sandbox, tasks: PlanFile["tasks"]): Promise<PlanFile> {
  return {
    targetRepo: s.targetRepo,
    ccloopBin: s.ccloopBin,
    runsDir: s.runsDir,
    workBranch: "orca/spawn-scenario-branch",
    policy: "local-merge",
    ledgerMode: "in-repo",
    tasks,
  };
}

export interface TaskSpec {
  taskId: string;
  contract: ContractSpec;
  dependsOn?: string[];
}

/**
 * Task 9: the general form of seedFanOutPlan, extracted rather than copied
 * because §7's scenarios need a two-task SAME-LAYER shape and Task 8's
 * fan-out builder hard-codes a T1 -> T2 edge that would put the pair in two
 * different layers -- the one shape §7.3 says its escalation must NOT be
 * about.
 *
 * Returns the parsed contracts alongside the plan because buildGraph needs
 * them: re-reading and re-parsing them in each scenario is how the graph a
 * scenario asserts about drifts away from the contracts it actually ran.
 */
export async function seedTasks(
  s: Sandbox,
  specs: TaskSpec[],
): Promise<{ plan: PlanFile; contracts: Map<string, unknown> }> {
  const tasks: PlanFile["tasks"] = [];
  const contracts = new Map<string, unknown>();
  for (const spec of specs) {
    const contract = await writeContract(s, spec.taskId, spec.contract);
    tasks.push({ taskId: spec.taskId, contract, dependsOn: spec.dependsOn ?? [] });
    contracts.set(spec.taskId, JSON.parse(await readFile(contract, "utf8")));
  }
  return { plan: await planThatSpawns(s, tasks), contracts };
}

/**
 * The three-task fan-out S8 and S9 both need: T1 → T2 by explicit dependsOn,
 * with T3 on its own branch claiming a disjoint path so no implicit edge ties
 * it to either. That shape is the whole point of both scenarios — "descendants
 * stop, other branches continue" is unmeasurable on a graph with only one
 * branch — and T1's contract is the only parameter because the two scenarios
 * drive that one task to two different terminal statuses.
 */
export async function seedFanOutPlan(
  s: Sandbox,
  t1: ContractSpec,
): Promise<{ plan: PlanFile; contracts: Map<string, unknown> }> {
  return seedTasks(s, [
    { taskId: "T1", contract: t1 },
    { taskId: "T2", contract: { goal: "write b.txt", targetPaths: ["b.txt"], requiredChecks: ["true"] }, dependsOn: ["T1"] },
    { taskId: "T3", contract: { goal: "write c.txt", targetPaths: ["c.txt"], requiredChecks: ["true"] } },
  ]);
}

// Task 10: the shell command a task's `requiredChecks` runs to actually
// produce a file.
//
// ⚠️ Non-obvious, and load-bearing for every scenario that has to see real
// work land on W. ccloop's ScriptedAdapter touches no files at all — its
// `execution.changedFiles` is a declaration fed to evaluatePathPolicy, not a
// write. Measured on ccloop 7f2c5f6: runLoop's `runRequiredChecks` executes
// each check with `sh -lc <command>` and `cwd` set to the attempt worktree
// (`src/controller/runLoop.ts:175`), and `publishAttemptCommit` then runs
// `git add -A` in that same worktree before the ref is written. So a required
// check that writes a file is the one route by which a `scripted` run
// produces a non-empty attempt commit — which §7's reconciliation, and
// therefore landing at all, depends on.
export function writeFileCheck(path: string, content: string): string {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const mkdirPrefix = dir === "" ? "" : `mkdir -p ${dir} && `;
  return `${mkdirPrefix}printf '${content}\\n' > ${path}`;
}

export interface RunnablePlan {
  planPath: string;
  adapterConfig: string;
  workBranch: string;
}

/**
 * Task 10: the first builder that produces a plan `orca run` can actually
 * execute end to end — real ccloopBin, contracts whose required checks write
 * real files, and one scripted frame.
 *
 * One adapter config for the whole round rather than one per task: each
 * ccloop spawn constructs its own ScriptedAdapter from a fresh read of the
 * file, so a single one-frame config gives every task exactly one attempt.
 * The plan file (spec §2.3) has no per-task adapter field to hang anything
 * else on.
 */
export async function seedRunnablePlan(
  s: Sandbox,
  specs: TaskSpec[],
  workBranch = "orca/w/x",
): Promise<RunnablePlan> {
  const tasks: PlanFile["tasks"] = [];
  for (const spec of specs) {
    const contract = await writeContract(s, spec.taskId, spec.contract);
    tasks.push({ taskId: spec.taskId, contract, dependsOn: spec.dependsOn ?? [] });
  }
  const planPath = await writePlan(s, {
    targetRepo: s.targetRepo,
    ccloopBin: s.ccloopBin,
    runsDir: s.runsDir,
    workBranch,
    policy: "local-merge",
    ledgerMode: "in-repo",
    tasks,
  });
  return { planPath, adapterConfig: await writeScriptedConfig(s, "round", [{}]), workBranch };
}

/** S1 / S14: two tasks whose write sets do not intersect, so they share a layer. */
export async function seedDisjointPlan(s: Sandbox): Promise<RunnablePlan> {
  return seedRunnablePlan(s, [
    {
      taskId: "T1",
      contract: {
        goal: "write a.txt",
        targetPaths: ["a.txt"],
        requiredChecks: [writeFileCheck("a.txt", "a1")],
        buildTestCommands: ["true"],
      },
    },
    {
      taskId: "T2",
      contract: {
        goal: "write b.txt",
        targetPaths: ["b.txt"],
        requiredChecks: [writeFileCheck("b.txt", "b1")],
        buildTestCommands: ["true"],
      },
    },
  ]);
}

/**
 * S2: two tasks whose write sets DO intersect — "src/**" normalizes to the
 * prefix "src/", which contains "src/a.ts" — so buildGraph puts an implicit
 * edge between them and they land in two layers, not one. They still write
 * different files, so the serialisation is the graph's doing and not a merge
 * conflict's.
 */
export async function seedIntersectingPlan(s: Sandbox): Promise<RunnablePlan> {
  return seedRunnablePlan(s, [
    {
      taskId: "T1",
      contract: {
        goal: "write src/t1.txt",
        targetPaths: ["src/**"],
        requiredChecks: [writeFileCheck("src/t1.txt", "t1")],
        buildTestCommands: ["true"],
      },
    },
    {
      taskId: "T2",
      contract: {
        goal: "write src/a.ts",
        targetPaths: ["src/a.ts"],
        requiredChecks: [writeFileCheck("src/a.ts", "t2")],
        buildTestCommands: ["true"],
      },
    },
  ]);
}

/**
 * Every non-empty line of every ledger file on a branch, read out of the tree
 * rather than off disk: spec §8.0 says C's decisions are committed onto W, and
 * a file that is merely sitting in the worktree has not been committed.
 */
export async function readLedgerOnBranch(repo: string, branch: string): Promise<string[]> {
  // Task 12: reads through ledgerFilesOnBranch rather than repeating the
  // ls-tree/show walk, so the blank-line-dropping this helper does (right for
  // "validate every record") and the line numbering blameCommitOfLine needs
  // (right for "which commit wrote line N") cannot drift apart.
  const lines: string[] = [];
  for (const file of await ledgerFilesOnBranch(repo, branch)) {
    for (const line of file.lines) {
      if (line.trim().length > 0) lines.push(line);
    }
  }
  return lines;
}

/** A file's content at a commit-ish, or null when it is not in that tree. */
export async function showFileAt(repo: string, revision: string, path: string): Promise<string | null> {
  try {
    return await git(repo, ["show", `${revision}:${path}`]);
  } catch {
    return null;
  }
}

/**
 * The `refs/orca/<run-id>` refs landIntoW fetched into the target repo, keyed
 * by run id. A scenario uses them to ask what a task's attempt tree actually
 * contained, which is how "did T2 start from a base that already had T1's
 * work in it" is measured without reading any scheduler internals.
 */
export async function orcaIncomingRefs(repo: string): Promise<Record<string, string>> {
  const out = await git(repo, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/orca"]);
  const refs: Record<string, string> = {};
  for (const line of out.split("\n")) {
    if (line.trim().length === 0) continue;
    const [refname, objectname] = line.split(" ");
    refs[refname.slice("refs/orca/".length)] = objectname;
  }
  return refs;
}

/** The per-task copy directories (spec §4.5) still present under runsDir. */
export async function taskWorkdirs(s: Sandbox): Promise<string[]> {
  const entries = await readdir(s.runsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && e.name.startsWith("orca-"))
    .map((e) => e.name)
    .sort();
}

/**
 * The branch the sandbox repo was initialised on. Read rather than hard-coded
 * as "main": `git init` picks it from init.defaultBranch, so a machine or CI
 * image configured for "master" would otherwise fail S14 for a reason that
 * has nothing to do with the code under test. Must be called BEFORE a run —
 * afterwards HEAD is on the work branch, and this would answer with W.
 */
export async function defaultBranchOf(repo: string): Promise<string> {
  return (await git(repo, ["symbolic-ref", "--short", "HEAD"])).trim();
}

/**
 * Task 11: a contract as `loadRound` holds it — an object, not a path.
 * `writeContract`'s file read back rather than a second literal, because a
 * hand-written object here would be free to drift away from the only shape
 * ccloop's `.strict()` schema accepts, which is the drift F2 was raised about.
 */
export async function contractObject(s: Sandbox, taskId: string, spec: ContractSpec): Promise<unknown> {
  return JSON.parse(await readFile(await writeContract(s, taskId, spec), "utf8"));
}

/** What seedConflictingCopy leaves behind, in the terms land.ts hands on. */
export interface ConflictFixture {
  /** The task's clone (spec §4.3 step 2), which is where §5.2 does its work. */
  copyPath: string;
  /** The work branch's tip in the target repo — the merge's first parent. */
  wTip: string;
  /** `refs/orca/<run-id>` in the target repo — the merge's second parent. */
  incomingRef: string;
  /** The file both sides edited, and therefore the one carrying the markers. */
  path: string;
  workBranch: string;
}

/**
 * The exact state land.ts's failed `git merge` leaves for spec §5 to pick up:
 * a target repo sitting on W whose tip edited two regions of a file, a task
 * clone whose attempt commit edited the same two regions differently, and
 * `refs/orca/<run-id>` in the target repo pointing at that attempt.
 *
 * 🔴 The clone is taken BEFORE the target repo commits its side, and that
 * ordering is load-bearing rather than incidental: it is what makes W's tip
 * genuinely absent from the copy's object store, so a materialisation that
 * skipped fetching it could not check it out. Clone afterwards and the fetch
 * becomes untestable decoration.
 *
 * Two conflicting regions, six unchanged lines apart, because one region
 * cannot tell "enumerate the blocks" apart from "return the first block".
 */
export async function seedConflictingCopy(s: Sandbox, runId = "r1"): Promise<ConflictFixture> {
  const path = "src/a.ts";
  const workBranch = "orca/w/x";
  const lines = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  const withEdits = (suffix: string): string =>
    lines.map((l) => (l === "two" || l === "nine" ? `${l}-${suffix}` : l)).join("\n") + "\n";

  await mkdir(join(s.targetRepo, "src"), { recursive: true });
  await writeFile(join(s.targetRepo, path), lines.join("\n") + "\n");
  await git(s.targetRepo, [...ID, "add", "-A"]);
  await git(s.targetRepo, [...ID, "commit", "-m", "seed the file both sides will edit"]);
  await git(s.targetRepo, ["checkout", "-b", workBranch]);
  const base = await headOf(s.targetRepo);

  const copyPath = join(s.runsDir, runId, "repo");
  await git(s.root, ["clone", "--local", "--no-checkout", s.targetRepo, copyPath]);
  await git(copyPath, ["checkout", "--detach", base]);
  await writeFile(join(copyPath, path), withEdits("copy"));
  await git(copyPath, [...ID, "add", "-A"]);
  await git(copyPath, [...ID, "commit", "-m", "the task's attempt"]);
  const attemptSha = await headOf(copyPath);

  await writeFile(join(s.targetRepo, path), withEdits("target"));
  await git(s.targetRepo, [...ID, "add", "-A"]);
  await git(s.targetRepo, [...ID, "commit", "-m", "what already landed on W"]);
  const wTip = await headOf(s.targetRepo);

  const incomingRef = `refs/orca/${runId}`;
  await git(s.targetRepo, ["fetch", copyPath, `${attemptSha}:${incomingRef}`]);

  return { copyPath, wTip, incomingRef, path, workBranch };
}

/**
 * S3: two tasks whose DECLARED write sets do not intersect -- so buildGraph
 * puts them in one layer and they run in parallel -- and whose required checks
 * both write `shared.txt` with different content.
 *
 * The declaration is the lie spec 3.4 rule 1 is about: the criterion says
 * "disjoint", the merge says otherwise, and 5.0's trunk has to converge
 * anyway. Each task also writes a file it did declare, so the round has
 * something to check landed besides the reconciled file itself.
 *
 * ⚠️ Both tasks are therefore OUT OF BOUNDS on `shared.txt`, and that is not
 * incidental -- it is forced. A path inside BOTH tasks' declared write sets
 * would make their claims intersect (one prefix contains the other, so
 * pathTrie.classify returns non-null), buildGraph would put an implicit edge
 * between them, and they would land in two layers where no merge conflict is
 * possible at all. So "declared disjoint, actually collided" and "every write
 * was in bounds" cannot both hold, which is why S3's round exits 2 (7.3's
 * second tier: out of bounds, no sibling claims it, land anyway) rather than
 * 0. See the S3 criterion's own comment and the task-12 report.
 */
export async function seedLyingPlan(s: Sandbox): Promise<RunnablePlan> {
  return seedRunnablePlan(s, [
    {
      taskId: "T1",
      contract: {
        goal: "write a.txt",
        targetPaths: ["a.txt"],
        requiredChecks: [writeFileCheck("a.txt", "a1"), writeFileCheck("shared.txt", "t1")],
        buildTestCommands: ["true"],
      },
    },
    {
      taskId: "T2",
      contract: {
        goal: "write b.txt",
        targetPaths: ["b.txt"],
        requiredChecks: [writeFileCheck("b.txt", "b1"), writeFileCheck("shared.txt", "t2")],
        buildTestCommands: ["true"],
      },
    },
  ]);
}

/**
 * Every ledger file on a branch, as (repo-relative path, lines), read out of
 * the tree. Line numbers are 1-based indices into `lines`, which is what
 * `git blame -L` counts in -- readLedgerOnBranch drops blank lines and so
 * cannot be used to find one.
 */
export async function ledgerFilesOnBranch(
  repo: string,
  branch: string,
): Promise<Array<{ path: string; lines: string[] }>> {
  // A branch with no .decisions/ in its tree returns no files rather than
  // throwing. Measured while running `M-LEDGER` (Task 10): git's "Not a valid
  // object name" propagated out of the helper and killed the scenario before
  // its own assertion ran, so the red said "the helper crashed" where the
  // criterion means to say "C wrote no decisions onto W".
  let names: string;
  try {
    names = await git(repo, ["ls-tree", "--name-only", `${branch}:.decisions`]);
  } catch {
    return [];
  }
  const files: Array<{ path: string; lines: string[] }> = [];
  for (const name of names.split("\n").filter((n) => n.trim().length > 0)) {
    const text = await git(repo, ["show", `${branch}:.decisions/${name}`]);
    files.push({ path: `.decisions/${name}`, lines: text.split("\n") });
  }
  return files;
}

/**
 * The commit `git blame` attributes one line of one file to, at a revision.
 * spec 8.3 / A' 3.3: this is how "which commit implemented this decision" is
 * answered, so it is also the only honest way to measure that the `bound` line
 * really is in the merge commit's tree rather than in the commit after it.
 */
export async function blameCommitOfLine(
  repo: string,
  revision: string,
  path: string,
  line: number,
): Promise<string> {
  const out = await git(repo, ["blame", "--porcelain", "-L", `${line},${line}`, revision, "--", path]);
  return out.split("\n")[0].split(" ")[0];
}

/**
 * Every `refs/orca/conflict/<run-id>` ref in every task copy still under
 * runsDir, keyed by the copy directory. spec 5.2 step 5 pins the conflicted
 * commit on a ref inside the copy precisely so it has a name that is NOT in
 * the target repository; this reads those names back so a criterion can check
 * the target repository does not have the commit.
 */
export async function conflictRefShas(s: Sandbox): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of await taskWorkdirs(s)) {
    const copy = join(s.runsDir, name, "repo");
    if (!existsSync(copy)) continue;
    const refs = await git(copy, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/orca/conflict"]);
    for (const line of refs.split("\n")) {
      if (line.trim().length === 0) continue;
      const [refname, objectname] = line.split(" ");
      out[`${copy} ${refname}`] = objectname;
    }
  }
  return out;
}

/** Every commit reachable from a revision, as shas. */
export async function reachableCommits(repo: string, revision: string): Promise<string[]> {
  const out = await git(repo, ["rev-list", revision]);
  return out.split("\n").filter((l) => l.trim().length > 0);
}

/**
 * `<commit> <parent...>` for every commit reachable from a revision. The
 * merge commit spec 5.2 step 4 rebuilds is identified by its parents, not by
 * its position or its message, because those are exactly what a wrong
 * implementation would still get right.
 */
export async function commitParents(repo: string, revision: string): Promise<Map<string, string[]>> {
  const out = await git(repo, ["rev-list", "--parents", revision]);
  const parents = new Map<string, string[]>();
  for (const line of out.split("\n")) {
    if (line.trim().length === 0) continue;
    const [sha, ...rest] = line.trim().split(" ");
    parents.set(sha, rest);
  }
  return parents;
}

/**
 * `git rev-list --first-parent` from a revision.
 *
 * Task 12 fix round 1: the criterion for spec 5.2 step 4 used to select the
 * merge commit by its second parent and then assert facts about that same
 * parent, which the selection had already guaranteed. W's first-parent line is
 * the falsifiable form of the same question -- it is what `git log
 * --first-parent` walks and what every later three-way merge treats as "ours",
 * so a merge commit built with its parents the wrong way round moves the
 * incoming attempt onto it and the W tip off it.
 */
export async function firstParentCommits(repo: string, revision: string): Promise<string[]> {
  const out = await git(repo, ["rev-list", "--first-parent", revision]);
  return out.split("\n").filter((l) => l.trim().length > 0);
}

/**
 * A required check that creates a file only if it is not already there.
 *
 * An ordinary shape ("make sure this exists"), and the one that produces a
 * reconciliation which passes every required check and still leaves the
 * conflict markers in place: in each task's own attempt worktree the file is
 * absent and gets written, while in the reconciliation worktree it is present
 * -- as the conflicted text -- so the check is a no-op and reports success.
 * That is exactly the hole spec 5.1's third row cannot see and
 * `markersRemaining` exists to close.
 */
export function createFileIfMissingCheck(path: string, content: string): string {
  return `[ -e ${path} ] || printf '${content}\\n' > ${path}`;
}

/**
 * seedLyingPlan's shape, with the two tasks' conflicting writes made
 * conditional so the synthesized reconciliation cannot clear the markers.
 * Drives the `markersRemaining` escalation (mutation `M-MARKERS-CALL`).
 */
export async function seedUnreconcilableLyingPlan(s: Sandbox): Promise<RunnablePlan> {
  return seedRunnablePlan(s, [
    {
      taskId: "T1",
      contract: {
        goal: "write a.txt",
        targetPaths: ["a.txt"],
        requiredChecks: [writeFileCheck("a.txt", "a1"), createFileIfMissingCheck("shared.txt", "t1")],
        buildTestCommands: ["true"],
      },
    },
    {
      taskId: "T2",
      contract: {
        goal: "write b.txt",
        targetPaths: ["b.txt"],
        requiredChecks: [writeFileCheck("b.txt", "b1"), createFileIfMissingCheck("shared.txt", "t2")],
        buildTestCommands: ["true"],
      },
    },
  ]);
}

/**
 * seedLyingPlan's shape, with one check that passes in each task's own attempt
 * worktree and fails in the reconciliation's.
 *
 * `test ! -e a.txt` is true for T2, which clones at the layer base before T1
 * has landed, and false for the reconciliation, whose base is the conflict
 * commit and therefore already contains T1's file. The synthesized contract
 * pins maxAttempts to 1 (spec 5.1's last note), so the rejected verification
 * lands on `exhausted`.
 *
 * ⚠️ The failing check is LAST in T2's list, deliberately. requiredChecks run
 * in order and the union puts the conflicting task's first, so the two writes
 * above it still run and still clear the conflict markers. Without that, a
 * reconciliation that ended `exhausted` would also be one that left markers
 * behind, and the criterion could not tell which of the two guards caught it.
 */
export async function seedLyingPlanWhoseReconciliationFails(s: Sandbox): Promise<RunnablePlan> {
  return seedRunnablePlan(s, [
    {
      taskId: "T1",
      contract: {
        goal: "write a.txt",
        targetPaths: ["a.txt"],
        requiredChecks: [writeFileCheck("a.txt", "a1"), writeFileCheck("shared.txt", "t1")],
        buildTestCommands: ["true"],
      },
    },
    {
      taskId: "T2",
      contract: {
        goal: "write b.txt",
        targetPaths: ["b.txt"],
        requiredChecks: [
          writeFileCheck("b.txt", "b1"),
          writeFileCheck("shared.txt", "t2"),
          "test ! -e a.txt",
        ],
        buildTestCommands: ["true"],
      },
    },
  ]);
}
