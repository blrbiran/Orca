import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ORCA_IDENTITY, git } from "../scheduler/gitExec.js";
import { CorrectRejection } from "./rejection.js";

const execFileAsync = promisify(execFile);

export const TARGET_MID_OPERATION = "target-mid-git-operation";

/**
 * 闭-3: every one of these reads, and all of them run BEFORE anything is
 * written (§14.3, third seat). This is the third measurement of this guard's
 * boundary — see the task-9 report for the full table — and it corrects the
 * previous one rather than repeating it: the first measurement (design doc,
 * an earlier day) named five state files; task 9's own remeasurement of that
 * exact five-way list on 2026-09-08 (git 2.50.1) found only three of them
 * actually govern whether `git commit -m … -- <path>` — the PARTIAL commit
 * `orca correct --close` makes — gets refused.
 *
 * The three rejected states, each for its own, DIFFERENT reason (ruling,
 * task-9 coordinator, 2026-09-08):
 *
 * 1. `MERGE_HEAD` present — measured: git itself refuses the partial commit
 *    with `fatal: cannot do a partial commit during a merge.`, exit 128.
 * 2. `CHERRY_PICK_HEAD` present — measured: same refusal, worded for a
 *    cherry-pick, exit 128. (This is the case the design doc's original
 *    five-item list was built to catch: a guard of "the obvious three" —
 *    merge, rebase, detached — lets a resolved-but-not-`--continue`d
 *    cherry-pick straight through, because CHERRY_PICK_HEAD exists while none
 *    of MERGE_HEAD, a rebase directory, or a detached HEAD do.)
 * 3. HEAD detached — NOT because git refuses the commit (measured: it does
 *    not), but because the resulting ledger commit would not be reachable
 *    from any branch. Task 10's idempotence check walks refs
 *    (`git log --all -S<correctionId> -- <path>`), and `--all` cannot see a
 *    commit no ref points at — so a later `--close` would wrongly conclude
 *    "not yet closed" and append the two rows a SECOND time into an
 *    append-only file. A rebase always detaches HEAD, so this one condition
 *    covers an in-progress rebase too, by construction rather than by a
 *    second, parallel check.
 *
 * DROPPED from the five-item list, on the strength of the same measurement:
 * `REVERT_HEAD`, `rebase-merge`, `rebase-apply`. Measured: a partial commit
 * SUCCEEDS in every one of those states (clean `revert -n`, a
 * resolved-but-not-continued revert conflict, a resolved-but-not-continued
 * rebase conflict on both the ort/merge and the legacy apply/am backends) —
 * and the revert cases leave HEAD attached, so rejecting them would refuse
 * `orca correct --close` in a target repo where the exact write it needs to
 * make would go through cleanly. Spec §14.3's governing sentence is "守卫只拦
 * 真正拦得住的那几种，不做过度拒绝" — the five-item list was a measurement
 * taken on a different day; the principle survives correcting it.
 *
 * ⚠️ Deliberately NO fourth, separate check for "a rebase is in progress":
 * a rebase always detaches HEAD, so a parallel rebase-marker verdict could
 * never be killed by a mutation that deletes only itself — the detached-HEAD
 * check would still catch it, and the criterion would stay green. This
 * repository has already paid for that shape once (see the comment in
 * src/ledger/validateLine.ts about a downgrade sitting behind two independent
 * guards that no criterion can pin) and is not paying for it twice. The
 * rebase markers are read ONLY to choose what the message SAYS — never
 * whether this function rejects.
 */
export async function midOperationRejection(
  repo: string,
): Promise<{ code: string; message: string } | undefined> {
  const gitDir = join(repo, ".git");
  const present = async (name: string): Promise<boolean> =>
    stat(join(gitDir, name)).then(() => true, () => false);

  const refuse = (state: string, why: string): { code: string; message: string } => ({
    code: TARGET_MID_OPERATION,
    message:
      `${repo} ${state} — orca correct commits the ledger by path, and ${why} ` +
      `Finish or abort it and re-run the same command; nothing has been written.`,
  });

  if (await present("MERGE_HEAD")) {
    return refuse("is in the middle of a merge", "git refuses a partial commit in this state.");
  }

  if (await present("CHERRY_PICK_HEAD")) {
    return refuse("is in the middle of a cherry-pick", "git refuses a partial commit in this state.");
  }

  const detached = await execFileAsync("git", ["symbolic-ref", "--quiet", "HEAD"], { cwd: repo })
    .then(() => false)
    .catch(() => true);
  if (!detached) return undefined;

  // Message-only: which words tell the person what to finish or abort. This
  // never changes WHETHER we reject — see the doc comment above.
  const rebasing = (await present("rebase-merge")) || (await present("rebase-apply"));
  return refuse(
    rebasing ? "is in the middle of a rebase" : "has a detached HEAD",
    "the resulting commit would not be reachable from any branch, and a later --close cannot tell it already ran.",
  );
}

export const LEDGER_COMMIT_REFUSED = "ledger-commit-refused";

/**
 * 闭-8. Two halves, both required (measured 2026-09-06 in a throwaway repo,
 * re-measured at implementation time):
 *
 *   git add -- <path> ; git commit -m …            → commits the WHOLE index,
 *                                                    sweeping in what the
 *                                                    person had staged
 *   git commit -m … -- <path>   (alone)            → `error: pathspec … did
 *                                                    not match any file(s)
 *                                                    known to git` — the
 *                                                    ledger file is untracked
 *   git add -- <path> ; git commit -m … -- <path>  → only the ledger file,
 *                                                    the person's staging intact
 *
 * ORCA_IDENTITY for the same reason land.ts uses it: this is an accounting
 * commit. WHO made the correction is carried by the row's `by` and by the
 * message, not by the committer.
 *
 * No `--no-verify`: the target repository's hooks are not orca's to bypass
 * (registered, CLAUDE.md Rule 15 / spec §14.19 item 16). No `git reset` on
 * failure either — undoing a person's index is not this program's business.
 *
 * ⚠️ `add` and `commit` each get their OWN catch (round-4 review, item 2;
 * refined after the scoped re-review's minor below). Measured: a target repo
 * whose `.gitignore` lists `.decisions/` makes `git add` itself fail, and
 * `git status --porcelain` then reports nothing (the file is ignored) — so a
 * caller outside a try/catch let that escape as an untyped exception (exit
 * 3, a stack trace) even though the honest answer is the same CODE a refused
 * commit gives: the rows are written, the commit did not happen. Both
 * branches throw the same `LEDGER_COMMIT_REFUSED` at exit 5 — on BOTH, the
 * rows are written and uncommitted, which is exactly what that code means.
 *
 * ⚠️ The two branches do NOT share one message string (re-review minor, the
 * first version of this fix did): when `add` is what failed, the file was
 * NEVER staged — that is precisely why `add` refused — so a message that
 * says "written … and staged" on that branch asserts something false about
 * what is on disk, the same shape of bug this whole review round exists to
 * fix. Only the "staged" claim and which command's error text is quoted
 * differ between the branches; the "written to disk" fact and the recovery
 * sentence are identical bytes on both.
 *
 * ⚠️ The recovery text names `--close <correctionId>` explicitly (round-4
 * review, item 1), never "re-run the same command". Measured: for a person
 * who closed the loop in one shot (`--decision … --chose-instead …
 * --undo-how …`), re-running THAT same command hits
 * `correction-already-recorded` on the second try and, followed to
 * `--again`, commits a SECOND `decision`+`overturned` pair into a new ledger
 * file while the first pair — from the hook-refused run — stays on disk,
 * staged and uncommitted forever (append-only: neither pair can be removed
 * after the fact). `--close <correctionId>` is the one command that reuses
 * the already-recorded row instead of deriving a new one, so it is the only
 * recovery that does not duplicate rows.
 */
export async function commitLedgerFile(
  repo: string,
  relPath: string,
  message: string,
  correctionId: string,
): Promise<void> {
  const recovery =
    `fix that and run \`orca correct --repo ${repo} --close ${correctionId} --undo-how '<the same undo>'\`, ` +
    `which will finish this step`;

  try {
    await git(repo, ["add", "--", relPath]);
  } catch (err) {
    throw new CorrectRejection(
      LEDGER_COMMIT_REFUSED,
      `the ledger rows are written to ${relPath}, but git refused to stage it: ` +
        `${(err as Error).message.trim()} — ${recovery}`,
      5,
    );
  }

  try {
    await git(repo, [...ORCA_IDENTITY, "commit", "-m", message, "--", relPath]);
  } catch (err) {
    throw new CorrectRejection(
      LEDGER_COMMIT_REFUSED,
      `the ledger rows are written to ${relPath} and staged, but git refused the commit: ` +
        `${(err as Error).message.trim()} — ${recovery}`,
      5,
    );
  }
}

/**
 * 🔴 The idempotence question, asked of the REPOSITORY rather than of this
 * worktree (§14.1, third seat). A closing commit lands on whatever branch the
 * person is standing on — after a round that is usually W — so asking only
 * "is the row in the file in front of me" answers "no" the moment they switch
 * back to the main line, and the same correction gets written a second time.
 * With §14.5's real write moments the two versions differ byte for byte, which
 * turns an append-only file that was supposed to be structurally
 * conflict-proof into a content conflict at merge time.
 *
 * `-S<correctionId>` is a pickaxe over every ref: it finds the commit that
 * introduced this correction id into that path, wherever it lives. This is
 * exactly why midOperationRejection above refuses a detached HEAD: a close
 * made there would be invisible to `--all`, and this question would wrongly
 * answer "not yet closed" for a correction that already is.
 */
export async function alreadyCommitted(
  repo: string,
  relPath: string,
  correctionId: string,
): Promise<{ commit: string; refs: string } | undefined> {
  const log = await git(repo, ["log", "--all", `-S${correctionId}`, "--format=%H", "--", relPath]).catch(
    () => "",
  );
  const commit = log.trim().split("\n")[0];
  if (commit === undefined || commit.length === 0) return undefined;

  const refs = await git(repo, ["for-each-ref", "--contains", commit, "--format=%(refname)"]).catch(() => "");
  return { commit, refs: refs.trim().split("\n").filter((r) => r.length > 0).join(", ") || "(no ref)" };
}
