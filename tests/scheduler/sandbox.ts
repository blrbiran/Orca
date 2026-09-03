// The disposable test harness every scheduler scenario in this plan is built
// on. Each sandbox is a throwaway git repository plus a "runs" directory that
// sits outside it, so scenarios can assert about refs, porcelain output, and
// where files land without touching the developer's machine or a shared fixture
// that could pick up state left behind by a previous test run.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { main } from "../../src/cli.js";

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
function resolveCcloopBin(): string {
  const bin = resolve(dirname(new URL(import.meta.url).pathname), "../../../ccloop/dist/cli.js");
  if (!existsSync(bin)) {
    throw new Error(
      `ccloop bin not found at ${bin}. ccloop's package.json is private and its bin ` +
        `is never an npm dependency — run "npm run build" inside the ccloop repo first.`,
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
      maxAttempts: 1,
      perAttemptTimeoutMs: 60_000,
      totalRuntimeBudgetMs: 60_000,
      tokenBudget: 100_000,
      worktreeRequired: true,
      partialOutcomeRecoveryWindowMs: 0,
    },
    safetyPolicy: {
      allowlistPaths: [],
      denylistPaths: [],
      maxFilesTouched: spec.targetPaths.length,
      humanGateConditions: [],
    },
    verification: {
      verifierType: "command",
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
