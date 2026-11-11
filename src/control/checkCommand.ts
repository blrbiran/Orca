import { dispatchedEnv, type DispatchedAs } from "./commandClient.js";
import { ChildTimeout, spawnRunChild } from "./integrationGit.js";
import type { CheckRunCommand } from "./driveRecord.js";

/**
 * One command Orca runs itself the way ccloop runs a contract's required checks (runLoop.js runRequiredChecks): `sh -lc` in
 * the workspace with the environment inherited unchanged, `as` the run Orca dispatched (CLI v2 spec §15.3-§15.4:
 * ORCA_DISPATCHED_RUN and ORCA_PERSON_DIR over the inherited variables). Human ruling 2026-11-05 (session e2ad4802, "按你的
 * 建议抽公共函数"): the criteria base run, the reproduce-first check and the integration check all run their setup and
 * check commands through here, so the bound, the environment and what a timeout means cannot drift apart.
 */
export interface CheckFailure { command: string; exit: string; tail: string }

const TAIL_CHARS = 2048;
const tail = (text: string): string => text.length <= TAIL_CHARS ? text : text.slice(text.length - TAIL_CHARS);

/** Null when the command exits 0. A timeout kills its process group and is a failure; an abort is thrown, never read as an exit. */
export async function runAsCheck(cwd: string, command: string, timeoutMs: number, as: DispatchedAs, signal?: AbortSignal): Promise<CheckFailure | null> {
  const outcome = await runCheckRecorded(cwd, command, timeoutMs, as, signal);
  return outcome.exit === "0" ? null : outcome;
}

/**
 * Reviewed acceptance (spec 2026-11-11 §7): the same run, answering every command's exit and output tail -- a passing one
 * too, because an operator-reviewed acceptance records what each setup and check command printed. `exit` is "0" on a pass.
 */
export async function runCheckRecorded(cwd: string, command: string, timeoutMs: number, as: DispatchedAs, signal?: AbortSignal): Promise<CheckFailure> {
  try {
    const answer = await spawnRunChild("sh", ["-lc", command], { cwd, timeoutMs, inheritEnv: true, env: dispatchedEnv(as), ...(signal ? { signal } : {}) });
    return { command, exit: String(answer.code), tail: tail(`${answer.stdout}\n${answer.stderr}`.trim()) };
  } catch (error) {
    if (!(error instanceof ChildTimeout)) throw error;
    return { command, exit: `timeout ${timeoutMs} ms`, tail: "" };
  }
}

/** Task setup spec 2026-11-04 §4.6: a task's setup commands, in order, each as a check runs; the first that fails, or null. */
export async function firstFailingSetup(cwd: string, commands: readonly string[], timeoutMs: number, as: DispatchedAs, signal?: AbortSignal): Promise<CheckFailure | null> {
  for (const command of commands) {
    const failure = await runAsCheck(cwd, command, timeoutMs, as, signal);
    if (failure !== null) return failure;
  }
  return null;
}

/** What a sequence of setup and check commands did: the first failure (null when all passed) and every command that ran. */
export interface PostMergeOutcome { failure: CheckFailure | null; commands: CheckRunCommand[] }

/**
 * Setup commands, then checks, each as ccloop runs a required check; the first that does not exit 0 stops it. Every
 * command that ran is recorded with its exit and wall-clock time (tester follow-up E §4, #245); a setup command is named
 * `setup: <cmd>` there and in the failure.
 */
export async function runCheckSequence(cwd: string, setup: readonly string[], checks: readonly string[], timeoutMs: number, as: Parameters<typeof runCheckRecorded>[3], signal?: AbortSignal): Promise<PostMergeOutcome> {
  const commands: CheckRunCommand[] = [];
  const steps = [...setup.map((command) => ({ command, name: `setup: ${command}` })), ...checks.map((command) => ({ command, name: command }))];
  for (const step of steps) {
    const started = performance.now();
    const answer = await runCheckRecorded(cwd, step.command, timeoutMs, as, signal);
    commands.push({ command: step.name, exit: answer.exit, ms: Math.round(performance.now() - started) });
    if (answer.exit !== "0") return { failure: { ...answer, command: step.name }, commands };
  }
  return { failure: null, commands };
}
