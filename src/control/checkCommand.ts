import { dispatchedEnv, type DispatchedAs } from "./commandClient.js";
import { ChildTimeout, spawnRunChild } from "./integrationGit.js";
import type { CheckRunCommand } from "./driveRecord.js";
import { parseFailureSummary } from "./failureNames.js";
import { cutUtf8 } from "./noChange.js";
import type { AcceptanceFailureAttempt, AcceptanceFailureIdentity, FailureIdentityParseStatus } from "./acceptanceFailureIdentity.js";
import { failureIdentitiesOf } from "./acceptanceFailureIdentity.js";
import { sameSuiteRetryBranches } from "./fullSuiteRecognition.js";

/**
 * One command Orca runs itself the way ccloop runs a contract's required checks (runLoop.js runRequiredChecks): `sh -lc` in
 * the workspace with the environment inherited unchanged, `as` the run Orca dispatched (CLI v2 spec §15.3-§15.4:
 * ORCA_DISPATCHED_RUN and ORCA_PERSON_DIR over the inherited variables). Human ruling 2026-11-05 (session e2ad4802, "按你的
 * 建议抽公共函数"): the criteria base run, the reproduce-first check and the integration check all run their setup and
 * check commands through here, so the bound, the environment and what a timeout means cannot drift apart.
 */
export interface CheckFailure {
  command: string; exit: string; tail: string;
  /**
   * Tester #391: the failing test names a node:test output gives (failureNames.ts), for a non-zero exit that printed any.
   * Optional so records written before it still parse; `tail` stays as it always was.
   */
  failures?: string[];
  /** Parsed only from complete, supported TAP output; never from the bounded display tail. */
  failureIdentities?: AcceptanceFailureIdentity[];
  failureIdentityStatus?: FailureIdentityParseStatus;
  identityAttempts?: AcceptanceFailureAttempt[];
}

const TAIL_CHARS = 2048;
const tail = (text: string): string => text.length <= TAIL_CHARS ? text : text.slice(text.length - TAIL_CHARS);

/**
 * Reviewed acceptance (spec 2026-11-11 §7): the same run, answering every command's exit and output tail -- a passing one
 * too, because an operator-reviewed acceptance records what each setup and check command printed. `exit` is "0" on a pass.
 */
async function executeCheck(cwd: string, command: string, timeoutMs: number, as: DispatchedAs, signal?: AbortSignal): Promise<ExecutedCommand> {
  try {
    const child = await spawnRunChild("sh", ["-lc", command], { cwd, timeoutMs, inheritEnv: true, env: dispatchedEnv(as), ...(signal ? { signal } : {}) });
    const output = `${child.stdout}\n${child.stderr}`.trim();
    const exit = String(child.code);
    const parsed = failureIdentitiesOf(output, "node-test-tap-v1", cwd);
    const attempt: AcceptanceFailureAttempt = {
      exit, reportedFailures: parsed.reportedFailures, blockCount: parsed.blockCount, tests: testsReported(output), tail: tail(output),
      ...(exit === "0" ? {} : { failureIdentityStatus: parsed.parseStatus, failureIdentities: parsed.identities }),
    };
    const failures = exit === "0" ? [] : parseFailureSummary(output).failures.slice(0, 20).map((name) => cutUtf8(name, 240));
    return { output, answer: { command, exit, tail: tail(output), ...(failures.length === 0 ? {} : { failures }),
      ...(exit === "0" ? {} : { failureIdentities: parsed.identities, failureIdentityStatus: parsed.parseStatus }), identityAttempts: [attempt] } };
  } catch (error) {
    if (!(error instanceof ChildTimeout)) throw error;
    const exit = `timeout ${timeoutMs} ms`;
    const attempt: AcceptanceFailureAttempt = { exit, failureIdentityStatus: "unsupported", failureIdentities: [], reportedFailures: null, blockCount: 0, tests: null };
    return { output: "", answer: { command, exit, tail: "", identityAttempts: [attempt] } };
  }
}

function testsReported(output: string): number | null {
  const matches = [...output.matchAll(/^# tests (\d+)$/gm)];
  return matches.length === 0 ? null : Number(matches[matches.length - 1]![1]);
}

interface ExecutedCommand { answer: CheckFailure; output: string }

/**
 * Reviewed acceptance (spec 2026-11-11 §7): the same run, answering every command's exit and output tail -- a passing one
 * too, because an operator-reviewed acceptance records what each setup and check command printed. `exit` is "0" on a pass.
 */
export async function runCheckRecorded(cwd: string, command: string, timeoutMs: number, as: DispatchedAs, signal?: AbortSignal): Promise<CheckFailure> {
  const branches = sameSuiteRetryBranches(command);
  if (branches === null) {
    const { answer } = await executeCheck(cwd, command, timeoutMs, as, signal);
    const { identityAttempts: _internalAttempts, ...recorded } = answer;
    return recorded;
  }

  const started = performance.now();
  const executions: ExecutedCommand[] = [];
  for (const branch of branches) {
    const remaining = timeoutMs - Math.ceil(performance.now() - started);
    if (remaining <= 0) {
      const exit = `timeout ${timeoutMs} ms`;
      executions.push({ output: "", answer: { command: branch, exit, tail: "", identityAttempts: [{ exit, failureIdentityStatus: "unsupported", failureIdentities: [], reportedFailures: null, blockCount: 0, tests: null }] } });
      break;
    }
    const execution = await executeCheck(cwd, branch, remaining, as, signal);
    executions.push(execution);
    if (execution.answer.exit === "0") break;
  }
  const attempts = executions.flatMap((execution) => execution.answer.identityAttempts ?? []);
  const red = attempts.filter((attempt) => attempt.exit !== "0");
  const identities = new Map<string, AcceptanceFailureIdentity>();
  for (const attempt of red) for (const identity of attempt.failureIdentities ?? []) identities.set(identity.key, identity);
  const bad = red.find((attempt) => attempt.failureIdentityStatus !== "complete" || (attempt.failureIdentities?.length ?? 0) === 0);
  const status = red.length === 0 ? undefined : bad?.failureIdentityStatus === "unsupported" ? "unsupported" : bad ? "ambiguous" : "complete";
  const failures = [...new Set(executions.filter((execution) => execution.answer.exit !== "0").flatMap((execution) => execution.answer.failures ?? []))].slice(0, 20);
  const final = executions.at(-1)!.answer;
  return {
    command, exit: final.exit, tail: tail(executions.map((execution) => execution.output).filter(Boolean).join("\n")), identityAttempts: attempts,
    ...(failures.length === 0 ? {} : { failures }),
    ...(red.length === 0 ? {} : { failureIdentities: [...identities.values()], failureIdentityStatus: status }),
  };
}

/** Null when the command exits 0; a timeout is a failure and an abort is thrown. */
export async function runAsCheck(cwd: string, command: string, timeoutMs: number, as: DispatchedAs, signal?: AbortSignal): Promise<CheckFailure | null> {
  const outcome = await runCheckRecorded(cwd, command, timeoutMs, as, signal);
  return outcome.exit === "0" ? null : outcome;
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

/** Tester follow-up G §6.2 (#269): every check's outcome, not only the first failure's; `tail` only for a non-zero exit. */
export interface EveryCheckOutcome { setupFailure: CheckFailure | null; commands: Array<{ command: string; exit: string; ms: number; tail?: string }> }

/**
 * The landing watch's run: setup commands in order, stopping at the first that fails (the checks are then not run); otherwise
 * every check runs, red or green, so each one's state is known. A setup command is named `setup: <cmd>`.
 */
export async function runEveryCheck(cwd: string, setup: readonly string[], checks: readonly string[], timeoutMs: number, as: Parameters<typeof runCheckRecorded>[3], signal?: AbortSignal): Promise<EveryCheckOutcome> {
  const commands: EveryCheckOutcome["commands"] = [];
  const run = async (command: string, name: string): Promise<CheckFailure> => {
    const started = performance.now();
    const answer = await runCheckRecorded(cwd, command, timeoutMs, as, signal);
    commands.push({ command: name, exit: answer.exit, ms: Math.round(performance.now() - started), ...(answer.exit === "0" ? {} : { tail: answer.tail }) });
    return { ...answer, command: name };
  };
  for (const command of setup) {
    const answer = await run(command, `setup: ${command}`);
    if (answer.exit !== "0") return { setupFailure: answer, commands };
  }
  for (const command of checks) await run(command, command);
  return { setupFailure: null, commands };
}
