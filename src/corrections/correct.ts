import { TARGET_NOT_A_GIT_REPO, unlockableTargetRejection } from "../scheduler/preflight.js";
import { parseCorrectArgs } from "./args.js";
import { deriveCorrectionId } from "./fields.js";
import { correctionsDir } from "./paths.js";
import { projectKeyOf } from "./projectKey.js";
import { CorrectRejection } from "./rejection.js";
import { recordCorrection } from "./store.js";

/**
 * 記-2 / 闭-2: ONE read-only preflight, run by both modes (§14.3, third seat).
 * Splitting it was what let a linked worktree accept a row that could never be
 * closed from the checkout the person was standing in.
 *
 * All of it reads: `stat` + `git rev-parse` + `git config`. No lock is taken
 * here, which is what lets record-only run while a round holds the repo lock.
 *
 * §14.9: `unlockableTargetRejection`'s PREDICATE and CODE are reused — writing
 * a second spelling of `target-not-a-git-repo` is a bill this repository has
 * already paid twice (planFile.ts and planReport.ts each record one). Its
 * MESSAGE is not reused: it says "this round … the repo lock it takes before
 * reading anything", and `orca correct` is not a round. Changing the existing
 * message instead would take `runOnNonGitTarget.test.ts` red, and this round
 * has no authority to rewrite an existing criterion.
 */
export async function sharedPreflight(repo: string): Promise<string> {
  const rejection = await unlockableTargetRejection(repo);
  if (rejection !== undefined) {
    throw new CorrectRejection(
      TARGET_NOT_A_GIT_REPO,
      `${repo} is not the root of a git repository (its .git must be a directory): ` +
        `orca correct reads the ledger under <repo>/.decisions and, when it closes a loop, ` +
        `puts its lock at <repo>/.git/orca-lock`,
    );
  }
  return projectKeyOf(repo);
}

export async function correct(argv: string[]): Promise<number> {
  const parsed = await parseCorrectArgs(argv);
  const dir = correctionsDir();
  const projectKey = await sharedPreflight(parsed.repo);

  if (parsed.mode === "record") {
    const row = {
      projectKey,
      decisionId: parsed.decisionId,
      kind: parsed.kind,
      chose_instead: parsed.choseInstead,
      because: parsed.because,
      at: new Date().toISOString(),
      by: parsed.by,
    };
    const id = deriveCorrectionId(row);
    await recordCorrection(dir, { id, ...row }, { again: parsed.again });
    process.stdout.write(`recorded correction ${id} against ${parsed.decisionId} in ${projectKey}\n`);
    return 0;
  }

  // Closing modes land in Task 9 and Task 10.
  throw new Error("unreachable until task 9");
}
