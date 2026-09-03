// The disposable test harness every scheduler scenario in this plan is built
// on. Each sandbox is a throwaway git repository plus a "runs" directory that
// sits outside it, so scenarios can assert about refs, porcelain output, and
// where files land without touching the developer's machine or a shared fixture
// that could pick up state left behind by a previous test run.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
export async function captureStdout<T>(fn: () => Promise<T>): Promise<{ result: T; stdout: string }> {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(chunk.toString());
    return true;
  }) as typeof process.stdout.write;
  try {
    const result = await fn();
    return { result, stdout: chunks.join("") };
  } finally {
    process.stdout.write = original;
  }
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
