import { join } from "node:path";
import type { DecisionEvent } from "../ledger/schema.js";
import { appendEvents } from "../ledger/writer.js";
import { acquireRepoLock } from "../scheduler/repoLock.js";
import { TARGET_NOT_A_GIT_REPO, unlockableTargetRejection } from "../scheduler/preflight.js";
import { CLOSE_ARG_CONFLICT, parseCorrectArgs } from "./args.js";
import { deriveRows } from "./derive.js";
import { deriveCorrectionId, deriveFixRunId } from "./fields.js";
import { midOperationRejection } from "./gitState.js";
import { readOriginalDecision } from "./originalDecision.js";
import { correctionsDir } from "./paths.js";
import { projectKeyOf } from "./projectKey.js";
import { CorrectRejection } from "./rejection.js";
import type { Correction } from "./schema.js";
import { loadCorrection, recordCorrection } from "./store.js";

/**
 * Ruling 2 (task 9): these two are command-level refusals, so they are
 * declared here — next to the code that throws them — rather than in
 * gitState.ts (which is about git state) or store.ts.
 */
export const REPO_LOCKED = "repo-locked";
export const MISSING_CHOSE_INSTEAD = "no-chose-instead";

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

  // 闭-3: read-only guards, all of them before any write.
  const midOperation = await midOperationRejection(parsed.repo);
  if (midOperation !== undefined) {
    throw new CorrectRejection(midOperation.code, midOperation.message);
  }

  const decisionsDir = join(parsed.repo, ".decisions");

  // 闭-4: for the non---close path the decision id is right there on the
  // command line, so this read costs nothing and moves the "you mistyped
  // --decision" rejection AHEAD of every write. The second seat's I-F ("the
  // original can only be read after the stored row") is true for --close and
  // ONLY for --close; applying it to both paths is what made a typo write a
  // permanent junk correction row first and reject afterwards.
  let original =
    parsed.mode === "close-new" ? await readOriginalDecision(decisionsDir, parsed.decisionId) : undefined;

  // 闭-5: the repo lock, and from here on everything is inside try/finally.
  // §14.3 (second seat, C-B): the rejections below are the EXPECTED path — a
  // release written as the last statement is skipped by every one of them, and
  // the leftover lock directory then blocks every future `orca run` on this
  // repository until someone deletes it by hand.
  const repoLock = await acquireRepoLock(parsed.repo).catch((err: unknown) => {
    throw new CorrectRejection(
      REPO_LOCKED,
      `another orca process holds the repo lock on ${parsed.repo}: ${(err as Error).message}`,
      4,
    );
  });

  try {
    // 闭-6: the store's critical section (its own lock, inside this one —
    // the order is fixed at repo → store, and `orca run` never takes the
    // store lock, so the two cannot deadlock).
    let row: Correction;
    if (parsed.mode === "close-existing") {
      row = await loadCorrection(dir, parsed.correctionId);
      if (row.chose_instead !== undefined && parsed.choseInstead !== undefined) {
        throw new CorrectRejection(
          CLOSE_ARG_CONFLICT,
          `correction ${row.id} already says what was chosen instead (${row.chose_instead}); ` +
            `--chose-instead may only supply one that is missing`,
        );
      }
      original = await readOriginalDecision(decisionsDir, row.decisionId);
    } else {
      const base = {
        projectKey,
        decisionId: parsed.decisionId,
        kind: parsed.kind,
        chose_instead: parsed.choseInstead,
        because: parsed.because,
        at: new Date().toISOString(),
        by: parsed.by,
      };
      row = { id: deriveCorrectionId(base), ...base };
      await recordCorrection(dir, row, { again: parsed.again });
    }

    const choseInstead = row.chose_instead ?? parsed.choseInstead;
    if (choseInstead === undefined) {
      // §14.4 (C4): a `wrong`/`stale` row recorded in record-only mode has no
      // chose_instead, and the new decision's `chose` can come from nowhere
      // else. Refused by name here rather than four layers down in the schema.
      throw new CorrectRejection(
        MISSING_CHOSE_INSTEAD,
        `correction ${row.id} does not say what was chosen instead — pass --chose-instead to supply it`,
      );
    }

    const { id: _id, ...rowFields } = row;
    const runId = deriveFixRunId(rowFields, row.id);

    // 闭-7 (Task 10 adds the branch-independent idempotence questions in front
    // of this): ONE landing, both rows, one appendFile.
    const at = new Date().toISOString();
    const { decision, overturned } = deriveRows({
      correction: row,
      original: original as DecisionEvent,
      choseInstead,
      undo: parsed.undo,
      at,
      runId,
    });
    await appendEvents(decisionsDir, runId, [decision, overturned]);

    // 闭-8 lands in Task 10.
    return 0;
  } finally {
    await repoLock.release();
  }
}
