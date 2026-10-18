import type { z } from "zod";
import type { taskContractSchema } from "../scheduler/planFile.js";
import { DEBUG_DEFAULT_BUILD_TEST_COMMANDS, DEBUG_TEST_DIRS } from "./debugPlan.js";
import { ChildTimeout, gitChild, oneLine, spawnRunChild } from "./integrationGit.js";
import type { DebugResult } from "./reportedDecisions.js";

type TaskContract = z.infer<typeof taskContractSchema>;

/**
 * Debug-task design §4.3, §12.8 / plan Task 8: Orca's own code, not the agent, checks that a debug run reproduced the
 * correction before it fixed it -- a test it added fails at the run's base and passes at its attempt. No model call.
 */

export type ReproFailure = "no-tests" | "no-command" | "green-at-base" | "red-at-head" | "result-invalid";
export type ReproVerdict = { kind: "passed"; tests: string[]; command: string } | { kind: "skipped"; reason: string }
  | { kind: "failed"; reason: ReproFailure };

/** What the restore puts back: the symbolic ref HEAD was on (null when detached) and the untracked paths that were there. */
export interface WorkspaceSnapshot { headRef: string | null; untrackedBefore: string[] }

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
const untracked = async (workdir: string): Promise<string[]> => paths(await git(workdir, ["ls-files", "--others", "--exclude-standard", "-z"]));

/** The test files the attempt added: under a test directory at the root, or named like a test. */
async function addedTests(workdir: string, base: string, attemptSha: string): Promise<string[]> {
  const added = paths(await git(workdir, ["diff", "--name-only", "--no-renames", "--diff-filter=A", "-z", base, attemptSha]));
  return added.filter((path) => TEST_ROOTS.has(path.split("/", 1)[0]!) || TEST_FILE.test(path)).sort();
}

/**
 * True when the command exits 0. It runs as ccloop runs a contract's required checks (runLoop.js runRequiredChecks):
 * `sh -lc` in the workspace with the environment inherited unchanged. A timeout kills its process group and counts as a
 * non-zero exit, at head and at base alike; an abort (the driver's stop) is thrown, never read as an exit.
 */
async function exitsZero(workdir: string, command: string, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
  try {
    return (await spawnRunChild("sh", ["-lc", command], { cwd: workdir, timeoutMs, inheritEnv: true, ...(signal ? { signal } : {}) })).code === 0;
  } catch (error) {
    if (error instanceof ChildTimeout) return false;
    throw error;
  }
}

export async function snapshotWorkspace(workdir: string): Promise<WorkspaceSnapshot> {
  const symbolic = (await gitChild(workdir, ["symbolic-ref", "-q", "HEAD"])).stdout.trim();
  return { headRef: symbolic.startsWith("refs/heads/") ? symbolic : null, untrackedBefore: await untracked(workdir) };
}

/**
 * HEAD back at `attemptSha` on the snapshot's ref, and every untracked non-ignored path that was not there before removed
 * (never `-x`, never the whole tree: ignored build output cannot ride into Step D's merge of `attemptSha`). Both steps are
 * always tried; the first failure is answered, not thrown, so a caller with an error of its own keeps that one.
 */
export async function restoreWorkspace(workdir: string, attemptSha: string, snapshot: WorkspaceSnapshot): Promise<Error | null> {
  let failure: Error | null = null;
  try {
    await git(workdir, ["checkout", "--force", ...(snapshot.headRef !== null ? [snapshot.headRef.slice("refs/heads/".length), "--"] : ["--detach", attemptSha])]);
  } catch (error) { failure = error as Error; }
  try {
    const before = new Set(snapshot.untrackedBefore);
    const stray = (await untracked(workdir)).filter((path) => !before.has(path));
    if (stray.length > 0) await git(workdir, ["clean", "-fdq", "--", ...stray.map(literal)]);
  } catch (error) { failure ??= error as Error; }
  return failure;
}

/**
 * The check, in the run's own workspace (controller call 3; its dependencies are installed there), at `attemptSha`.
 * `resultMalformed`: the agent reported a `debug` value the schema refused; the check then proceeds with `{}` only when
 * Orca can compute the tests itself (controller ruling C14), and answers `result-invalid` otherwise. `snapshot` is the one
 * the driver persisted before the check started (taken here when absent); the workspace is restored to it whatever
 * happens.
 */
export async function checkReproduction(input: {
  workdir: string; base: string; attemptSha: string; result: DebugResult; contract: TaskContract; timeoutMs: number;
  resultMalformed?: boolean; snapshot?: WorkspaceSnapshot; signal?: AbortSignal;
}): Promise<ReproVerdict> {
  const { workdir, base, attemptSha, result, timeoutMs, signal } = input;
  if (result.reproduction === "not-expressible") {
    return result.reproductionReason === undefined ? { kind: "failed", reason: "result-invalid" } : { kind: "skipped", reason: result.reproductionReason };
  }
  if (result.reproTests !== undefined) {
    // Fix round 1 (R2): a named test the attempt does not hold cannot be applied at base; refused before any checkout.
    for (const path of result.reproTests) {
      if ((await gitChild(workdir, ["cat-file", "-e", `${attemptSha}:${path}`])).code !== 0) return { kind: "failed", reason: "result-invalid" };
    }
  }
  const tests = result.reproTests ?? await addedTests(workdir, base, attemptSha);
  if (tests.length === 0) return { kind: "failed", reason: input.resultMalformed ? "result-invalid" : "no-tests" };
  // The placeholder T4 put in a contract with no original names no check: it does not count (controller ruling 3).
  const command = result.reproCommand ?? input.contract.context.buildTestCommands[0];
  // `undefined` is defensive only: the contract schema requires at least one buildTestCommands entry.
  if (command === undefined || PLACEHOLDER.has(command)) return { kind: "failed", reason: "no-command" };
  const snapshot = input.snapshot ?? await snapshotWorkspace(workdir);
  let verdict: ReproVerdict;
  try {
    // stepC's commitAttempt has just made HEAD `attemptSha`, every change committed; a resumed check restored it first.
    if (!(await exitsZero(workdir, command, timeoutMs, signal))) verdict = { kind: "failed", reason: "red-at-head" };
    else {
      await git(workdir, ["checkout", "--force", "--detach", base]);
      await git(workdir, ["checkout", attemptSha, "--", ...tests.map(literal)]);
      verdict = (await exitsZero(workdir, command, timeoutMs, signal)) ? { kind: "failed", reason: "green-at-base" } : { kind: "passed", tests, command };
    }
  } catch (error) {
    // The check's own failure is the one reported; a restore failure after it would only hide it (the next round restores).
    await restoreWorkspace(workdir, attemptSha, snapshot);
    throw error;
  }
  const restoreFailure = await restoreWorkspace(workdir, attemptSha, snapshot);
  if (restoreFailure !== null) throw restoreFailure;
  return verdict;
}
