import { cloneDirOf } from "./ccloopRunner.js";
import type { TaskRun } from "./ccloopRunner.js";
import { ORCA_IDENTITY, git } from "./gitExec.js";
import type { PlanFile } from "./planFile.js";

/**
 * The ref that makes a task's attempt commit reachable inside the TARGET
 * repository. Before the fetch, that commit is reachable only from inside the
 * task's own clone (spec §4.4: ccloop pins it with a ref in whatever
 * repository `context.repoPath` names, which is the clone). Exported because
 * the round's report prints it and spec §5.2's reconciliation needs it by
 * name as the second parent of the merge it rebuilds.
 */
export function incomingRefOf(runId: string): string {
  return `refs/orca/${runId}`;
}

/**
 * What a failed merge leaves for spec §5's conflict main line to pick up.
 *
 * Deliberately narrow: these are the four facts `land.ts` actually holds at
 * the moment `git merge` reports a conflict. Materialising the conflict as a
 * commit inside the copy (§5.2 step 2) and enumerating its blocks belong to
 * `reconcile.ts`, which this task does not own — `copyPath` is the handle it
 * needs to do that, and `wTip` plus `incomingRef` are the two parents §5.2
 * step 4 has to rebuild the merge commit from.
 */
export interface ConflictState {
  copyPath: string;
  wTip: string;
  incomingRef: string;
  conflictedPaths: string[];
}

/**
 * spec §4.2.1: C checks out the target repository's own worktree onto W.
 * That is the main path, not a side effect — §4.3 step 6's `git merge`
 * requires the main repository to be sitting on W — and it is the only place
 * in this codebase that moves a real user's HEAD.
 *
 * The guard is the whole reason this is a named function rather than two
 * inline git calls: `orca` must never check out, and therefore can never
 * commit onto or merge into, the branch the round is cut from (spec §4.5 —
 * that is Tier 0, mechanically forbidden). loadPlan already rejects a plan
 * whose workBranch equals that branch, but that check runs against a name
 * read from a plan file minutes earlier and several layers away. This one
 * runs against the argument the checkout is actually about to use,
 * immediately before it runs, which is the only position from which it can be
 * the last gate. It is mutation `M-MAIN`'s target: delete it, pass the base
 * branch, and S14 goes red because the round's merges land on that branch's
 * ref.
 *
 * `baseBranch`, not `defaultBranch` (final review, Important 7): run.ts reads
 * it from `git symbolic-ref --short HEAD`, so it is whatever the target
 * repository currently has checked out, which is not necessarily the
 * repository's default branch.
 *
 * `checkout -b` rather than `branch` + `checkout`: W must not already exist
 * (preflight's `work-branch-already-exists` rejection), and `-b` fails loudly
 * if it does instead of silently reusing someone else's branch.
 */
export async function checkoutWorkBranch(plan: PlanFile, baseBranch: string, base: string): Promise<void> {
  if (plan.workBranch === baseBranch) {
    throw new Error(
      `orca: refusing to check out ${JSON.stringify(plan.workBranch)} — it is the branch ` +
        `${plan.targetRepo} is currently on and the round's base, and landing onto it is Tier 0 (spec §4.5)`,
    );
  }
  await git(plan.targetRepo, ["checkout", "-b", plan.workBranch, base]);
}

/**
 * spec §4.3 step 6, the whole of it: `git fetch <copy> <sha>:refs/orca/<run-id>`
 * then `git merge --no-ff` into W.
 *
 * The fetch is what moves the attempt commit out of the copy's object store
 * and into the target repository's. It is not optional bookkeeping: `git
 * clone --local` hardlinks the object store, so the attempt commit's objects
 * live in a directory this round is about to delete (§4.5), and a merge of a
 * commit only reachable through the copy would leave W pointing at objects
 * that disappear with it.
 *
 * `--no-ff` because a fast-forward would erase the fact that this task's work
 * was a separate branch of history at all — §4.3's "attribution is free" rests
 * on every landing being one merge commit with two parents.
 */
export async function landIntoW(
  plan: PlanFile,
  run: TaskRun,
): Promise<{ merged: true } | { merged: false; conflict: ConflictState }> {
  if (run.attemptSha === null) {
    // Reaching here means the caller routed a run with no published attempt
    // ref (spec §6.1's `blocked_waiting_human`) into landing instead of into
    // escalation. There is nothing to fetch, and inventing an empty merge
    // would turn a §6.3 escalation into a silent success.
    throw new Error(
      `orca: run ${run.runId} (outcome ${run.outcome}) published no attempt commit, so there is nothing to land`,
    );
  }

  // The second half of `M-MAIN`'s target, and the reason it is checked here
  // and not only at checkout time: `git merge` acts on whatever branch the
  // repository happens to be on right now. Between checkoutWorkBranch and
  // this call the round spawns ccloop, clones, and runs required checks — a
  // stretch of minutes in which a bug (or a person) could leave HEAD
  // somewhere else. Merging onto the wrong branch is exactly the failure
  // §4.5 forbids, and it is invisible afterwards except as a moved ref.
  const head = (await git(plan.targetRepo, ["symbolic-ref", "--short", "HEAD"])).trim();
  if (head !== plan.workBranch) {
    throw new Error(
      `orca: refusing to merge into ${JSON.stringify(head)} — the target repo must be on the work branch ` +
        `${JSON.stringify(plan.workBranch)} before anything lands (spec §4.2.1)`,
    );
  }

  const copyPath = cloneDirOf(run.workdir);
  const incomingRef = incomingRefOf(run.runId);
  await git(plan.targetRepo, ["fetch", copyPath, `${run.attemptSha}:${incomingRef}`]);

  const wTip = (await git(plan.targetRepo, ["rev-parse", "HEAD"])).trim();

  try {
    await git(plan.targetRepo, [
      ...ORCA_IDENTITY,
      "merge",
      "--no-ff",
      "-m",
      `orca: land ${run.runId}`,
      incomingRef,
    ]);
    return { merged: true };
  } catch (err) {
    // Enumerated before the abort, because `--abort` is what destroys the
    // index the unmerged entries live in. Read with `--diff-filter=U` against
    // the index rather than parsed out of git's message text.
    const unmerged = await git(plan.targetRepo, ["diff", "--name-only", "--diff-filter=U", "-z"]);
    const conflictedPaths = unmerged.split("\0").filter((p) => p.length > 0).sort();

    // `git merge` fails for reasons that are not content conflicts too —
    // "not something we can merge", a refusal to overwrite an untracked file,
    // a broken index. Those leave no unmerged entries, and reporting them as
    // a conflict would hand §5's reconciliation an empty block list and turn
    // a hard failure into a quiet escalation. The original error is the one
    // worth seeing; `merge --abort` below would only replace it with its own
    // "there is no merge in progress".
    if (conflictedPaths.length === 0) throw err;

    // Aborting is not tidiness. Conflict state lives in the index, and the
    // index in question belongs to a real person's repository (§4.2.1) — the
    // reconciliation main line (§5.2) deliberately re-creates the conflict
    // inside the COPY, so leaving the target repo mid-merge would strand a
    // user in a conflicted worktree for a state nothing downstream reads.
    await git(plan.targetRepo, ["merge", "--abort"]);

    return { merged: false, conflict: { copyPath, wTip, incomingRef, conflictedPaths } };
  }
}

/**
 * spec §8.0: the orchestrator's own decisions live on W, in the main
 * repository, and get their own commit — separate from any task's landing so
 * that `git blame` attributes them to C rather than to whoever's task
 * happened to land next. §8.6 registers the cost (accounting commits are in
 * W's history) and accepts it for v1.
 *
 * Staged by path, not `add -A`: everything else in this worktree belongs to
 * the merges, and a stray `add -A` here would sweep in anything a task left
 * behind and commit it under an accounting message.
 */
export async function commitLedgerOnW(plan: PlanFile, message: string): Promise<void> {
  await git(plan.targetRepo, ["add", "--", ".decisions"]);
  await git(plan.targetRepo, [...ORCA_IDENTITY, "commit", "-m", message]);
}

/** spec §4.5: W is never deleted, and the round prints its name and tip. */
export async function workBranchTip(plan: PlanFile): Promise<string> {
  return (await git(plan.targetRepo, ["rev-parse", plan.workBranch])).trim();
}
