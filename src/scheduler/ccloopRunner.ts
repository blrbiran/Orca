import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { TaskGraph } from "./graph.js";
import type { PlanFile, PlanTask } from "./planFile.js";

const execFileAsync = promisify(execFile);

/**
 * ccloop's five terminal run statuses (state/types.ts's RunStatus, minus the
 * four non-terminal ones; stateMachine.ts's legalTransitions gives each of
 * these an empty transition list, which is what "terminal" means there).
 * Repeated here rather than imported because ccloop is spawned as a
 * subprocess, never depended on (spec §1.4) — there is nothing to import
 * from.
 */
export type CcloopOutcome = "succeeded" | "blocked_waiting_human" | "exhausted" | "cancelled" | "failed";

const TERMINAL_OUTCOMES: readonly string[] = [
  "succeeded",
  "blocked_waiting_human",
  "exhausted",
  "cancelled",
  "failed",
];

export interface TaskRun {
  runId: string;
  workdir: string;
  outcome: CcloopOutcome;
  /**
   * The commit ccloop published for the last attempt, from
   * `refs/ccloop/<run-id>/attempts/<n>` inside this task's clone — spec §4.4's
   * hard precondition, landed in ccloop by P0. Null when there is no such ref,
   * which is a real and expected state rather than an error: ccloop publishes
   * inside its worktree-cleanup path, and the blocked_waiting_human branch of
   * runLoop deliberately skips cleanup, so a blocked run leaves the worktree
   * in place and no ref behind.
   */
  attemptSha: string | null;
}

export interface RunTaskOptions {
  /**
   * G13 / spec §1.2 rule 6: v1 runs entirely on `scripted` and spends no model
   * money. Passed rather than defaulted so the choice is visible at each call
   * site instead of being a constant buried here.
   */
  adapter: "scripted" | "claude";
  /**
   * ccloop's `--adapter-config`, which it requires for both adapters. The plan
   * file's shape (spec §2.3) has no field for it and this task does not invent
   * one, so the caller supplies it; where it comes from in a real `orca run`
   * is a decision that belongs to the orchestration task, not to this module.
   */
  adapterConfig: string;
}

/**
 * spec §4.3 step 2: every task gets its own clone, and this is where it goes.
 * Exported because the clone outlives runTask — the attempt commit is
 * reachable only from inside it, so harvesting and landing both need the path.
 */
export function cloneDirOf(workdir: string): string {
  return join(workdir, "repo");
}

/**
 * ccloop's `--run-dir`. Nested under the workdir so that disposing of the
 * workdir disposes of the run directory with it, including the attempt
 * worktree a blocked run leaves registered in the clone.
 *
 * The leaf is the run id, not a fixed name, and that is load-bearing:
 * ccloop's attemptRefName derives the ref from the worktree path as
 * `refs/ccloop/<basename of the run dir>/attempts/<n>`, so this is what makes
 * the published refs carry orca's run id instead of a literal "loop".
 */
export function loopDirOf(workdir: string, runId: string): string {
  return join(workdir, "loop", runId);
}

function contractCopyPath(workdir: string): string {
  return join(workdir, "contract.json");
}

interface SpawnResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/**
 * spec §1.4: ccloop is spawned as a subprocess, never imported — its
 * package.json is `private: true` and its bin points at a gitignored
 * dist/cli.js, and depending on it would invite importing its internals and
 * smuggling liveness responsibility back into the scheduler.
 *
 * Launched through process.execPath rather than the shebang so the run does
 * not depend on the bin's execute bit or on which `node` happens to be first
 * on PATH — the criterion for "which ccloop ran" should be the path in the
 * plan file and nothing else.
 */
function spawnCcloop(bin: string, args: string[]): Promise<SpawnResult> {
  return new Promise<SpawnResult>((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

/**
 * spec §6.0, the whole point of this module's status handling: ccloop's cli.ts
 * ends both `run` and `resume` with `status === "succeeded" ? 0 : 2`, so four
 * terminal states that route four different ways in §6.1 arrive as the same
 * number. The exit code is therefore read only for the error message below,
 * never for the outcome.
 *
 * Anything other than a terminal status throws (Rule 12). A missing
 * loop-state.json means ccloop died before it wrote one — its own catch
 * returns 1 on an unreadable contract or config — and a non-terminal status
 * means the process was killed mid-run. Neither has an outcome to report, and
 * inventing one here is exactly the silent degradation spec §0.1 forbids.
 */
async function readTerminalStatus(loopDir: string, spawned: SpawnResult): Promise<CcloopOutcome> {
  const statePath = join(loopDir, "loop-state.json");
  let raw: string;
  try {
    raw = await readFile(statePath, "utf8");
  } catch (err) {
    throw new Error(
      `orca: ccloop wrote no loop-state.json at ${statePath} ` +
        `(exit ${String(spawned.code)}, signal ${String(spawned.signal)}); ` +
        `stderr: ${spawned.stderr.trim() || "<empty>"} (${(err as Error).message})`,
    );
  }

  const status: unknown = (JSON.parse(raw) as { status?: unknown }).status;
  if (typeof status !== "string" || !TERMINAL_OUTCOMES.includes(status)) {
    throw new Error(
      `orca: ccloop left a non-terminal status ${JSON.stringify(status)} in ${statePath} ` +
        `(exit ${String(spawned.code)}, signal ${String(spawned.signal)})`,
    );
  }
  return status as CcloopOutcome;
}

/**
 * The last attempt's published commit. "Last" is by attempt number, not by ref
 * iteration order: a run that retried publishes one ref per attempt, and only
 * the final attempt's tree is the one the terminal status is about.
 */
async function latestAttemptSha(clone: string, runId: string): Promise<string | null> {
  const { stdout } = await execFileAsync(
    "git",
    ["for-each-ref", "--format=%(refname) %(objectname)", `refs/ccloop/${runId}/attempts`],
    { cwd: clone },
  );

  let highest = -1;
  let sha: string | null = null;
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    const [refname, objectname] = line.split(" ");
    const attempt = Number.parseInt(refname.slice(refname.lastIndexOf("/") + 1), 10);
    if (!Number.isFinite(attempt) || attempt <= highest) continue;
    highest = attempt;
    sha = objectname;
  }
  return sha;
}

/**
 * spec §4.3 steps 2 and 3: clone the target repo at the layer's base, point
 * the contract at that clone, spawn ccloop, and read the real terminal status.
 *
 * The clone is not an optimisation or an isolation nicety. Measured (spec
 * §4.1 rule 2, re-confirmed against ccloop 7f2c5f6 while writing this):
 * `git worktree add --detach <path>` takes no commit-ish and the contract
 * schema is `.strict()` with no base-ref field, so ccloop's attempt always
 * starts from the current HEAD of `context.repoPath`. Rewriting repoPath is
 * the only handle on the base commit that exists.
 *
 * The rewrite writes a COPY into the workdir and never touches the contract
 * the plan names: that file lives outside the target repo on purpose (spec
 * §2.4.1) and the graph's write sets were computed from it, so editing it in
 * place would invalidate the graph mid-round.
 *
 * `runId` is already allocated by the caller (runId.ts claimed the directory
 * with a non-recursive mkdir); the recursive mkdir here is for the case where
 * this is called against a directory that exists, and never for claiming one.
 */
export async function runTask(
  plan: PlanFile,
  task: PlanTask,
  base: string,
  runId: string,
  options: RunTaskOptions,
): Promise<TaskRun> {
  const workdir = join(plan.runsDir, runId);
  const clone = cloneDirOf(workdir);
  const loopDir = loopDirOf(workdir, runId);
  await mkdir(workdir, { recursive: true });

  // --no-checkout because the very next command materialises the tree at the
  // base anyway; without it `clone --local` writes the whole working tree
  // twice. §4.5's cost note applies to the tree, not the object store: the
  // objects are hard-linked, the files are real.
  await execFileAsync("git", ["clone", "--local", "--no-checkout", plan.targetRepo, clone]);
  await execFileAsync("git", ["checkout", "--detach", base], { cwd: clone });

  const original = JSON.parse(await readFile(task.contract, "utf8")) as {
    context?: Record<string, unknown>;
    [key: string]: unknown;
  };
  const rewritten = { ...original, context: { ...original.context, repoPath: clone } };
  const contractPath = contractCopyPath(workdir);
  await writeFile(contractPath, JSON.stringify(rewritten, null, 2));

  await mkdir(loopDir, { recursive: true });
  const spawned = await spawnCcloop(plan.ccloopBin, [
    "run",
    "--contract",
    contractPath,
    "--run-dir",
    loopDir,
    "--adapter",
    options.adapter,
    "--adapter-config",
    options.adapterConfig,
  ]);

  const outcome = await readTerminalStatus(loopDir, spawned);
  const attemptSha = await latestAttemptSha(clone, runId);
  return { runId, workdir, outcome, attemptSha };
}

export interface OutcomeRouting {
  /** Contributes exit code 2 (spec §6.3): "this path is dead, read the log". */
  countsAsFailure: boolean;
  /** Contributes exit code 3: "a human has to come back and do something". */
  escalates: boolean;
  /**
   * The tasks this outcome puts into spec §6.2's `upstream_not_run` — never
   * ran, as distinct from ran and failed. For every outcome but `cancelled`
   * this is exactly the failed task's descendants; `cancelled` stops the whole
   * round, so it names every other task in the graph and the caller intersects
   * that with whatever has not started yet.
   */
  upstreamNotRun: string[];
  /**
   * spec §6.1's `cancelled` row, pinned there against its own ambiguity: stop
   * LAUNCHING new tasks; do not kill the ones already running. A stop signal
   * goes to the process group, so the siblings already running receive it and
   * land on `cancelled` themselves; killing them again from here would only
   * race ccloop's lease and owner-transfer handling.
   */
  stopRound: boolean;
}

// Sorted, like descendantsOf below: layers.flat() is layer order, so without
// this the two branches of routeOutcome would return the same set of task ids
// in different orders and every caller that compares or prints one would have
// to know which branch produced it.
function allTaskIds(graph: TaskGraph): string[] {
  return graph.layers.flat().sort();
}

/**
 * Everything reachable from `taskId` along explicit dependsOn edges and the
 * implicit write-set edges buildGraph derived — both, because a downstream
 * task that never declared a dependency but claims an overlapping path is just
 * as unable to start from a base its upstream never produced.
 */
function descendantsOf(graph: TaskGraph, taskId: string): string[] {
  const out = new Map<string, string[]>();
  for (const [from, to] of graph.explicit) out.set(from, [...(out.get(from) ?? []), to]);
  for (const edge of graph.implicit) out.set(edge.from, [...(out.get(edge.from) ?? []), edge.to]);

  const seen = new Set<string>();
  const queue = [...(out.get(taskId) ?? [])];
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (next === taskId || seen.has(next)) continue;
    seen.add(next);
    queue.push(...(out.get(next) ?? []));
  }
  return [...seen].sort();
}

/**
 * spec §6.1's four-row routing table. Its own headline is that the crude rule
 * it replaced — "anything but succeeded ⇒ the descendants are all blocked" —
 * throws away everything the four states say:
 *
 *  - `blocked_waiting_human` needs a human and is NOT a failure. It is also
 *    terminal and unresumable in ccloop (resumeLoop's RESUMABLE_STATUSES is
 *    planning/executing/verifying), so the escalation is the scheduler's own
 *    and there is deliberately no `ccloop resume` call anywhere in this file.
 *  - `exhausted` and `failed` are failures, and stop only their own branch.
 *  - `cancelled` is a human pressing stop, so letting other tasks start would
 *    be acting against the intent that produced it.
 *
 * Pure: it takes the graph and an outcome and returns a verdict. Nothing here
 * runs, kills, or writes anything — the caller applies the verdict.
 */
export function routeOutcome(graph: TaskGraph, taskId: string, outcome: CcloopOutcome): OutcomeRouting {
  if (outcome === "succeeded") {
    return { countsAsFailure: false, escalates: false, upstreamNotRun: [], stopRound: false };
  }
  if (outcome === "cancelled") {
    return {
      countsAsFailure: true,
      escalates: false,
      upstreamNotRun: allTaskIds(graph).filter((id) => id !== taskId),
      stopRound: true,
    };
  }
  return {
    countsAsFailure: outcome !== "blocked_waiting_human",
    escalates: outcome === "blocked_waiting_human",
    upstreamNotRun: descendantsOf(graph, taskId),
    stopRound: false,
  };
}

export interface DisposeOptions {
  /** `--keep-workdirs` (spec §4.5): keep every copy, including successful ones. */
  keepWorkdirs?: boolean;
  log?: (line: string) => void;
}

export interface Disposal {
  removed: boolean;
  workdir: string;
}

/**
 * spec §4.5's copy-retention rule: a successful task's copy is deleted, a
 * copy that is kept has its path printed. `clone --local` hard-links the
 * object store but writes a real working tree, so keeping every copy of a
 * large repository is a genuine cost — and a kept copy nobody is told about
 * is a cost with no benefit.
 *
 * Deliberately NOT called by runTask, and this is the one place this module
 * departs from a literal reading of "runTask deletes a successful clone": the
 * attempt commit is reachable only from inside the clone, and spec §4.3 runs
 * harvest (step 4) and the fetch into W (step 6) after the spawn. Deleting a
 * successful task's copy at the end of step 3 would delete the only copy of
 * the thing steps 4-6 exist to read. Disposal is therefore a separate call the
 * orchestrator makes once the run's result has been landed.
 *
 * `/bin/rm -rf`, by absolute path, per G8: this machine aliases `rm` to
 * `rm -i`, where a plain `rm -rf` hangs silently on a confirmation prompt
 * until it times out. execFile runs no shell so no alias could apply here
 * anyway; the absolute path is what makes that independent of how this
 * function is ever called.
 */
export async function disposeWorkdir(run: TaskRun, options: DisposeOptions = {}): Promise<Disposal> {
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const keep = options.keepWorkdirs === true || run.outcome !== "succeeded";

  if (keep) {
    const why = options.keepWorkdirs === true ? "--keep-workdirs" : `outcome ${run.outcome}`;
    log(`orca: kept the work copy for ${run.runId} (${why}): ${run.workdir}`);
    return { removed: false, workdir: run.workdir };
  }

  await execFileAsync("/bin/rm", ["-rf", run.workdir]);
  return { removed: true, workdir: run.workdir };
}
