import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DecisionEvent, OverturnedEvent } from "../ledger/schema.js";
import { appendEvents } from "../ledger/writer.js";
import { acquireRepoLock } from "../scheduler/repoLock.js";
import { TARGET_NOT_A_GIT_REPO, unlockableTargetRejection } from "../scheduler/preflight.js";
import { CLOSE_ARG_CONFLICT, parseCorrectArgs } from "./args.js";
import type { ParsedCorrect, UndoArgs } from "./args.js";
import { deriveRows } from "./derive.js";
import { deriveFixRunId } from "./fields.js";
import { alreadyCommitted, commitLedgerFile, midOperationRejection } from "./gitState.js";
import { readOriginalDecision } from "./originalDecision.js";
import { correctionsDir } from "./paths.js";
import { projectKeyOf } from "./projectKey.js";
import { CorrectRejection } from "./rejection.js";
import { namesDecision, type Correction, type DecisionCorrection } from "./schema.js";
import { correctionRowFrom, recordNewCorrection } from "./record.js";
import type { NewCorrectionInput } from "./record.js";
import { CORRECTION_TARGET_NOT_A_DECISION, loadCorrection } from "./store.js";
import { withStoreLock } from "./storeLock.js";
import { CORRECTION_WITHDRAWN, readWithdrawals } from "./withdrawals.js";

/**
 * Ruling 2 (task 9): these two are command-level refusals, so they are
 * declared here — next to the code that throws them — rather than in
 * gitState.ts (which is about git state) or store.ts.
 */
export const REPO_LOCKED = "repo-locked";
export const MISSING_CHOSE_INSTEAD = "no-chose-instead";
/**
 * Control run decisions plan Task 10 (debug-task design §12.3): a correction of a decision a landing refused names
 * `{ runId, pendingId }`, and there is no ledger row for --close to overturn. Closing it is that design's own path.
 *
 * Decisions review spec §5.2: now declared in store.ts, beside correction-not-found, because withdrawals.ts throws
 * it too; re-exported here so this module's export surface is unchanged.
 */
export { CORRECTION_TARGET_NOT_A_DECISION };

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
 * reading anything", and `orca dev correct` is not a round. Changing the existing
 * message instead would take `runOnNonGitTarget.test.ts` red, and this round
 * has no authority to rewrite an existing criterion.
 */
export async function sharedPreflight(repo: string): Promise<string> {
  await requireGitRoot(repo);
  return projectKeyOf(repo);
}

/**
 * Debug task plan Task 11: the git-root half of sharedPreflight, alone, for the control service's correction-close,
 * which finds the repository from the correction's projectKey and so has no key to derive.
 */
export async function requireGitRoot(repo: string): Promise<void> {
  const rejection = await unlockableTargetRejection(repo);
  if (rejection !== undefined) {
    throw new CorrectRejection(
      TARGET_NOT_A_GIT_REPO,
      `${repo} is not the root of a git repository (its .git must be a directory): ` +
        `orca dev correct reads the ledger under <repo>/.decisions and, when it closes a loop, ` +
        `puts its lock at <repo>/.git/orca-lock`,
    );
  }
}

/**
 * Maps `parsed` (camelCase `choseInstead`) onto `correctionRowFrom`'s input
 * shape. ONE place, used by both the `record` and `close-new` branches below —
 * the two branches must build a `NewCorrectionInput` the same way, or the
 * criterion that says they agree has nowhere for a mutation to land (E3 spec
 * §2.3, same reasoning fields.ts's comment records for the row constructor
 * itself).
 */
function newCorrectionInputFrom(
  parsed: Extract<ParsedCorrect, { mode: "record" | "close-new" }>,
  projectKey: string,
): NewCorrectionInput {
  return {
    projectKey,
    decisionId: parsed.decisionId,
    kind: parsed.kind,
    chose_instead: parsed.choseInstead,
    because: parsed.because,
    by: parsed.by,
  };
}

export async function correct(argv: string[], opts: { now?: () => Date } = {}): Promise<number> {
  const now = opts.now ?? (() => new Date());
  const parsed = await parseCorrectArgs(argv);
  const dir = correctionsDir();
  const projectKey = await sharedPreflight(parsed.repo);

  if (parsed.mode === "record") {
    const stored = await recordNewCorrection(
      dir,
      correctionRowFrom(newCorrectionInputFrom(parsed, projectKey), now),
      { again: parsed.again },
    );
    process.stdout.write(
      `recorded correction ${stored.id} against ${parsed.decisionId} in ${projectKey}\n`,
    );
    return 0;
  }

  if (parsed.mode === "close-existing") {
    reportClosed(await closeExistingCorrection({
      repo: parsed.repo, correctionId: parsed.correctionId, choseInstead: parsed.choseInstead, undo: parsed.undo, dir,
    }));
    return 0;
  }

  // 闭-3: read-only guards, all of them before any write.
  await refuseMidOperation(parsed.repo);

  const decisionsDir = join(parsed.repo, ".decisions");

  // 闭-4: for the non---close path the decision id is right there on the
  // command line, so this read costs nothing and moves the "you mistyped
  // --decision" rejection AHEAD of every write. The second seat's I-F ("the
  // original can only be read after the stored row") is true for --close and
  // ONLY for --close; applying it to both paths is what made a typo write a
  // permanent junk correction row first and reject afterwards.
  const original = await readOriginalDecision(decisionsDir, parsed.decisionId);

  const repoLock = await acquireClosingLock(parsed.repo);
  try {
    const row = await recordNewCorrection(
      dir,
      correctionRowFrom(newCorrectionInputFrom(parsed, projectKey), now),
      { again: parsed.again },
    );
    reportClosed(await landClosingRows(parsed.repo, row, parsed.choseInstead, overturnClosing(row as DecisionCorrection, original, parsed.undo)));
    return 0;
  } finally {
    await repoLock.release();
  }
}

/** The two closing lines `orca dev correct` prints; the control service's correction-close answers the same facts instead. */
function reportClosed(closed: ClosedCorrection): void {
  if (closed.committed !== undefined) {
    process.stdout.write(
      `correction ${closed.correctionId} was already closed: ${closed.relPath} at ${closed.committed.commit} (${closed.committed.refs})\n`,
    );
    return;
  }
  process.stdout.write(`closed correction ${closed.correctionId}: ${closed.relPath} committed on the current branch\n`);
}

/** 闭-3's git-state guard, refused by name. */
export async function refuseMidOperation(repo: string): Promise<void> {
  const midOperation = await midOperationRejection(repo);
  if (midOperation !== undefined) {
    throw new CorrectRejection(midOperation.code, midOperation.message);
  }
}

/**
 * 闭-5: the repo lock, and from here on everything is inside try/finally.
 * §14.3 (second seat, C-B): the rejections below are the EXPECTED path — a
 * release written as the last statement is skipped by every one of them, and
 * the leftover lock directory then blocks every future `orca run` on this
 * repository until someone deletes it by hand.
 * *** ERRATUM (consolidation step 3 final review, 2026-10-01, Orca session be653b22, controller ruling FW-8) -- `orca run` is deleted; the leftover lock
 * now blocks every future round on this repository (runPreparedRound takes the same lock, on the control path). ***
 *
 * 闭-6: the store's critical section (its own lock, inside this one —
 * the order is fixed at repo → store, and `orca run` never takes the
 * store lock, so the two cannot deadlock).
 * *** ERRATUM (consolidation step 3, 2026-10-01, Orca session be653b22, controller ruling C-1) -- `orca run` is deleted; the
 * round that takes the repo lock is now `runPreparedRound` (control path), which also never takes the store lock. ***
 */
export async function acquireClosingLock(repo: string): Promise<{ release(): Promise<void> }> {
  return acquireRepoLock(repo).catch((err: unknown) => {
    throw new CorrectRejection(
      REPO_LOCKED,
      `another orca process holds the repo lock on ${repo}: ${(err as Error).message}`,
      4,
    );
  });
}

/** What a closing writes: the ledger rows (given the chose_instead, the write moment and the fix run id) and the commit message. */
export interface ClosingRows {
  rows: (choseInstead: string, at: string, runId: string) => Array<DecisionEvent | OverturnedEvent>;
  message: string;
}

export interface ClosedCorrection {
  correctionId: string;
  relPath: string;
  alreadyClosed: boolean;
  /** Set when the rows were already committed: where (Question 2 below). */
  committed?: { commit: string; refs: string };
}

export interface CloseExistingInput {
  repo: string; correctionId: string; choseInstead?: string; undo: UndoArgs; dir: string;
  /** CLI v2 spec §16: the control verb's `closed by <person> via <channel> ...` evidence line (deriveRows' `attributed`). */
  attributed?: string;
}

/** --close's overturn of a recorded decision: deriveRows' two rows, one landing. */
function overturnClosing(row: DecisionCorrection, original: DecisionEvent, undo: UndoArgs, attributed?: string): ClosingRows {
  return {
    message: `ledger: overturn ${original.id} after ${row.by}'s correction ${row.id}`,
    rows: (choseInstead, at, runId) => {
      const { decision, overturned } = deriveRows({ correction: row, original, choseInstead, undo, at, runId, ...(attributed === undefined ? {} : { attributed }) });
      return [decision, overturned];
    },
  };
}

/** --close identifies an already-stored row: a chose_instead it already carries is not re-supplied. */
export function refuseChoseInsteadConflict(row: Correction, choseInstead: string | undefined): void {
  if (row.chose_instead !== undefined && choseInstead !== undefined) {
    throw new CorrectRejection(
      CLOSE_ARG_CONFLICT,
      `correction ${row.id} already says what was chosen instead (${row.chose_instead}); ` +
        `--chose-instead may only supply one that is missing`,
    );
  }
}

/**
 * `orca dev correct --close <correctionId>`, extracted (debug task plan Task 11) so the control service's correction-close
 * runs the very same guards in the same order. Decision-only, as the CLI is (cross-plan resolution 2): a correction
 * naming a pending item is refused correction-target-not-a-decision here; the control verb closes those itself.
 */
export async function closeExistingCorrection(input: CloseExistingInput): Promise<ClosedCorrection> {
  return closeStoredCorrection(input, async (row) => {
    if (!namesDecision(row)) {
      throw new CorrectRejection(
        CORRECTION_TARGET_NOT_A_DECISION,
        `correction ${row.id} names pending decision ${row.pendingId} of run ${row.runId}, which was never ` +
          `recorded in the ledger: --close has no decision to overturn`,
      );
    }
    refuseChoseInsteadConflict(row, input.choseInstead);
    return overturnClosing(row, await readOriginalDecision(join(input.repo, ".decisions"), row.decisionId), input.undo, input.attributed);
  });
}

/**
 * The guards of closing a stored correction, in --close's order: the git state, the repo lock, the stored row, its
 * withdrawal; then `closing` (the target's own checks, and what it writes); then the shared tail.
 */
export async function closeStoredCorrection(
  input: CloseExistingInput,
  closing: (row: Correction) => Promise<ClosingRows>,
): Promise<ClosedCorrection> {
  // 闭-3: read-only guards, all of them before any write.
  await refuseMidOperation(input.repo);
  const repoLock = await acquireClosingLock(input.repo);
  try {
    const row = await loadCorrection(input.dir, input.correctionId);
    // Decisions review spec §5.3: a withdrawn correction is not closed — the person took it back, and landing its
    // overturn would make it count as both withdrawn and closed. The read takes the store lock for itself (a
    // withdrawal's append must not be read half-written); it is a second hold, after loadCorrection's, and a
    // withdrawal landing between the two is the same accepted window §5.2 records for the panel route.
    const withdrawal = (await withStoreLock(input.dir, () => readWithdrawals(input.dir))).find(
      (candidate) => candidate.correctionId === row.id,
    );
    if (withdrawal !== undefined) {
      throw new CorrectRejection(
        CORRECTION_WITHDRAWN,
        `correction ${row.id} was withdrawn by ${withdrawal.by} at ${withdrawal.at}: --close refuses a ` +
          `withdrawn correction. To overturn the decision after all, record a new correction`,
      );
    }
    return await landClosingRows(input.repo, row, input.choseInstead, await closing(row));
  } finally {
    await repoLock.release();
  }
}

/**
 * The tail every closing shares (close-new, close-existing, and the control verb's pending close): the chose_instead,
 * the two idempotence questions, one landing, one commit. Called under the repo lock.
 */
async function landClosingRows(
  repo: string,
  row: Correction,
  suppliedChoseInstead: string | undefined,
  closing: ClosingRows,
): Promise<ClosedCorrection> {
  const decisionsDir = join(repo, ".decisions");
  const choseInstead = row.chose_instead ?? suppliedChoseInstead;
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
  const relPath = join(".decisions", `${runId}.jsonl`);

  // Question 2 first: if the rows are already committed somewhere, both
  // halves are done and there is nothing left to do. §14.1 (second seat,
  // C-D): exit 0 here must mean landed AND committed — a friendly "already
  // done" that only checked the file would make a hook-refused commit
  // permanently unrecoverable, because every re-run would report success.
  const committed = await alreadyCommitted(repo, relPath, row.id);
  if (committed !== undefined) {
    return { correctionId: row.id, relPath, alreadyClosed: true, committed };
  }

  // Question 1: written in this worktree but not committed — finish the
  // commit rather than writing the rows a second time.
  const alreadyWritten = await readFile(join(decisionsDir, `${runId}.jsonl`), "utf8")
    .then((text) => text.includes(row.id))
    .catch(() => false);

  // 闭-7: ONE landing, both rows, one appendFile.
  if (!alreadyWritten) {
    const at = new Date().toISOString();
    await appendEvents(decisionsDir, runId, closing.rows(choseInstead, at, runId));
  }

  // 闭-8: commit only the ledger file, leaving the person's own staging intact.
  await commitLedgerFile(repo, relPath, closing.message, row.id);
  return { correctionId: row.id, relPath, alreadyClosed: false };
}
