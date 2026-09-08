import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

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

  const refuse = (what: string, why: string): { code: string; message: string } => ({
    code: TARGET_MID_OPERATION,
    message:
      `${repo} is in the middle of ${what} — orca correct commits the ledger by path, and ${why} ` +
      `Finish or abort it and re-run the same command; nothing has been written.`,
  });

  if (await present("MERGE_HEAD")) {
    return refuse("a merge", "git refuses a partial commit in this state.");
  }

  if (await present("CHERRY_PICK_HEAD")) {
    return refuse("a cherry-pick", "git refuses a partial commit in this state.");
  }

  const detached = await execFileAsync("git", ["symbolic-ref", "--quiet", "HEAD"], { cwd: repo })
    .then(() => false)
    .catch(() => true);
  if (!detached) return undefined;

  // Message-only: which words tell the person what to finish or abort. This
  // never changes WHETHER we reject — see the doc comment above.
  const rebasing = (await present("rebase-merge")) || (await present("rebase-apply"));
  return refuse(
    rebasing ? "a rebase" : "a detached HEAD",
    "the resulting commit would not be reachable from any branch, and a later --close cannot tell it already ran.",
  );
}
