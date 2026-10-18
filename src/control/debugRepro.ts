import type { z } from "zod";
import type { taskContractSchema } from "../scheduler/planFile.js";
import { DEBUG_DEFAULT_BUILD_TEST_COMMANDS, DEBUG_TEST_DIRS } from "./debugPlan.js";
import { savedReport } from "./executionDriver.js";
import { ChildTimeout, gitChild, oneLine, spawnRunChild } from "./integrationGit.js";
import { reportedDebugOf, type DebugResult } from "./reportedDecisions.js";
import type { ControlStore } from "./store.js";

type TaskContract = z.infer<typeof taskContractSchema>;

/**
 * Debug-task design §4.3, §12.8 / plan Task 8: Orca's own code, not the agent, checks that a debug run reproduced the
 * correction before it fixed it -- a test it added fails at the run's base and passes at its attempt. No model call.
 */

/** Landing (Task 9) reads the stored report's `debug` value; a malformed one reads as absent, since landing only needs choseInstead. */
export async function readDebugResult(store: ControlStore, runId: string): Promise<DebugResult> {
  const reported = reportedDebugOf(await savedReport(store, runId));
  return reported.kind === "object" ? reported.value : {};
}

export type ReproFailure = "no-tests" | "no-command" | "green-at-base" | "red-at-head" | "result-invalid";
export type ReproVerdict = { kind: "passed"; tests: string[]; command: string } | { kind: "skipped"; reason: string }
  | { kind: "failed"; reason: ReproFailure };

/** Rule 5's test-file shapes, for an attempt whose agent named no reproTests. */
const TEST_FILE = /(\.test|\.spec|_test)\.[^/]+$|(^|\/)test_[^/]+\.py$/;
const TEST_ROOTS = new Set<string>(DEBUG_TEST_DIRS);
const PLACEHOLDER = new Set<string>(DEBUG_DEFAULT_BUILD_TEST_COMMANDS);

async function git(workdir: string, args: string[]): Promise<string> {
  const answer = await gitChild(workdir, args);
  if (answer.code !== 0) throw new Error(`debug-repro-git:${args[0]}: ${oneLine(answer.stderr)}`);
  return answer.stdout;
}
const paths = (stdout: string): string[] => stdout.split("\0").filter((path) => path !== "");
/** A path as git reads it on the command line: literally, never as a glob. */
const literal = (path: string): string => `:(literal)${path}`;

/** The test files the attempt added: under a test directory at the root, or named like a test. */
async function addedTests(workdir: string, base: string, attemptSha: string): Promise<string[]> {
  const added = paths(await git(workdir, ["diff", "--name-only", "--no-renames", "--diff-filter=A", "-z", base, attemptSha]));
  return added.filter((path) => TEST_ROOTS.has(path.split("/", 1)[0]!) || TEST_FILE.test(path)).sort();
}

/** True when the command exits 0. A timeout kills its process group and counts as a non-zero exit, at head and at base alike. */
async function exitsZero(workdir: string, command: string, timeoutMs: number): Promise<boolean> {
  try {
    return (await spawnRunChild("sh", ["-c", command], { cwd: workdir, timeoutMs })).code === 0;
  } catch (error) {
    if (error instanceof ChildTimeout) return false;
    throw error;
  }
}

/**
 * The check, in the run's own workspace (controller call 3; its dependencies are installed there), at `attemptSha`.
 * `resultMalformed`: the agent reported a `debug` value the schema refused; the check then proceeds with `{}` only when
 * Orca can compute the tests itself (controller ruling C14), and answers `result-invalid` otherwise.
 * The workspace is restored whatever happens: HEAD at `attemptSha` on the same symbolic ref, and no untracked path that
 * was not there before (ignored build output is left alone; it cannot ride into Step D's merge of `attemptSha`).
 */
export async function checkReproduction(input: {
  workdir: string; base: string; attemptSha: string; result: DebugResult; contract: TaskContract; timeoutMs: number; resultMalformed?: boolean;
}): Promise<ReproVerdict> {
  const { workdir, base, attemptSha, result, timeoutMs } = input;
  if (result.reproduction === "not-expressible") {
    return result.reproductionReason === undefined ? { kind: "failed", reason: "result-invalid" } : { kind: "skipped", reason: result.reproductionReason };
  }
  const tests = result.reproTests ?? await addedTests(workdir, base, attemptSha);
  if (tests.length === 0) return { kind: "failed", reason: input.resultMalformed ? "result-invalid" : "no-tests" };
  // The placeholder T4 put in a contract with no original names no check: it does not count (controller ruling 3).
  const command = result.reproCommand ?? input.contract.context.buildTestCommands[0];
  if (command === undefined || PLACEHOLDER.has(command)) return { kind: "failed", reason: "no-command" };
  const symbolic = (await gitChild(workdir, ["symbolic-ref", "-q", "HEAD"])).stdout.trim();
  const untrackedBefore = new Set(paths(await git(workdir, ["ls-files", "--others", "--exclude-standard", "-z"])));
  try {
    // stepC's commitAttempt has just made HEAD `attemptSha`, every change committed.
    if (!(await exitsZero(workdir, command, timeoutMs))) return { kind: "failed", reason: "red-at-head" };
    await git(workdir, ["checkout", "--force", "--detach", base]);
    await git(workdir, ["checkout", attemptSha, "--", ...tests.map(literal)]);
    if (await exitsZero(workdir, command, timeoutMs)) return { kind: "failed", reason: "green-at-base" };
    return { kind: "passed", tests, command };
  } finally {
    await git(workdir, ["checkout", "--force", ...(symbolic.startsWith("refs/heads/") ? [symbolic.slice("refs/heads/".length), "--"] : ["--detach", attemptSha])]);
    const stray = paths(await git(workdir, ["ls-files", "--others", "--exclude-standard", "-z"])).filter((path) => !untrackedBefore.has(path));
    if (stray.length > 0) await git(workdir, ["clean", "-fdq", "--", ...stray.map(literal)]);
  }
}
