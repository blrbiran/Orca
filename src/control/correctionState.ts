import { deriveFixRunId } from "../corrections/fields.js";
import { CorrectRejection } from "../corrections/rejection.js";
import type { Correction } from "../corrections/schema.js";
import { readCorrections } from "../corrections/store.js";
import { CORRECTION_WITHDRAWALS_UNREADABLE, readWithdrawals } from "../corrections/withdrawals.js";
import { git } from "../scheduler/gitExec.js";
import { readDebugMark, type ClosingRecord } from "./debugChecks.js";
import { debugGroupIds, debugGroupLive, repositoryOf } from "./debugGroup.js";
import { ControlError } from "./errors.js";
import { integrationTargetRef, readLedgerAtRef } from "./ledgerAtRef.js";
import { readGroup } from "./queries.js";
import type { ControlStore } from "./store.js";
import { QUIET_GIT } from "./workspace.js";

/**
 * Debug-task design §12.1 (controller ruling C1, plan Task 6): a correction is closed when the ref's tree holds its
 * closing row -- the `decision` row deriveRows writes (src/corrections/derive.ts): id `<fixRunId>/1`, evidence naming
 * `correction <id>`. Read from git objects at `ref` only, never `git log --all`, so the rows a debug group landed on its
 * own branch (`orca/debug-<id>`) do not count until they reach the ref. A ref that does not resolve holds nothing.
 * Task 10 builds the full closed state on this one predicate.
 */
export async function correctionClosedAtRef(repo: string, ref: string, correctionId: string, fixRunId: string): Promise<boolean> {
  const lines = await readLedgerAtRef(repo, ref);
  if (lines === null) return false;
  const id = `${fixRunId}/1`;
  return lines.some(({ value }) => {
    if (typeof value !== "object" || value === null) return false;
    const row = value as { ev?: unknown; id?: unknown; evidence?: unknown };
    return row.ev === "decision" && row.id === id && Array.isArray(row.evidence) && row.evidence.includes(`correction ${correctionId}`);
  });
}

/** The fix run id a correction's closing rows are written under (by `--close` and by a debug landing alike). */
export function fixRunIdOf(correction: Correction): string {
  const { id, ...row } = correction;
  return deriveFixRunId(row, id);
}

export type CorrectionClosedState = { state: "open" } | { state: "closed"; ref: string; via: "debug-group" | "by-hand" };
/** The ref a correction is judged on, and what a closing found there is: a debug group's target, or the current branch. */
export type ClosedTarget = { ref: string; via: "debug-group" | "by-hand" };

/**
 * Plan Task 10, ruling C16 (human-ratified): computed, never stored -- closed when `target.ref`'s tree holds the closing
 * row (correctionClosedAtRef), not when a commit is an ancestor of it: under `squash` the landing commit never is. Reads
 * never fetch; a push scheme is judged on its local `refs/remotes/<remote>/<target>`. No target (`keep`) is open.
 */
export async function correctionClosedState(repo: string, correction: Correction, target: ClosedTarget | null): Promise<CorrectionClosedState> {
  if (target === null || !(await correctionClosedAtRef(repo, target.ref, correction.id, fixRunIdOf(correction)))) return { state: "open" };
  return { state: "closed", ref: target.ref, via: target.via };
}

/** Ruling 6: the repository's current branch (`git symbolic-ref HEAD`); a detached HEAD is read as `HEAD`. */
export async function currentBranchRef(repo: string): Promise<string> {
  try { return (await git(repo, [...QUIET_GIT, "symbolic-ref", "-q", "HEAD"])).trim(); }
  catch { return "HEAD"; }
}

export interface CorrectionListItemV1 {
  correction: Correction;
  repoId: string | null;
  debugGroups: Array<{ groupId: string; ordinal: number; live: boolean; state: string }>;
  closed: CorrectionClosedState;
  /** The newest debug group's closing record (Task 9); null with no debug group, or before its landing. */
  closing: ClosingRecord | null;
  /** Withdraw Amendment items 3, 5: who withdrew it and when, from the withdrawals file; null while it stands. */
  withdrawn: { by: string; at: string } | null;
}

export interface CorrectionListDeps {
  store: ControlStore; correctionsDir: string; listRepositories: () => Array<{ repoId: string; path: string }>;
  /** As correction-debug-open's lookup (debugGroup.ts repositoryOf): the panel's own key first. */
  repoIdOfProjectKey?: (projectKey: string) => string;
}

/**
 * Plan Task 10 / design §12.1: every recorded correction with its repository, debug groups and computed closed state.
 * The ref (ruling 6): the newest debug group's integration target, a closing there being the debug group's; with no
 * debug group, or a newest one under `keep` (no target), the repository's current branch, a closing there being by
 * hand. A correction whose repository is not configured is open. Reads only: no fetch, no write.
 */
export async function readCorrectionList(deps: CorrectionListDeps): Promise<CorrectionListItemV1[]> {
  let withdrawals: Awaited<ReturnType<typeof readWithdrawals>>;
  try { withdrawals = await readWithdrawals(deps.correctionsDir); }
  catch (error) {
    // The booked code (Task 6), not a 500: a damaged file is the person's to fix by hand.
    if (error instanceof CorrectRejection && error.code === CORRECTION_WITHDRAWALS_UNREADABLE) throw new ControlError("correction-withdrawals-unreadable", error.message);
    throw error;
  }
  const withdrawnBy = new Map(withdrawals.map((row) => [row.correctionId, { by: row.by, at: row.at }]));
  const items: CorrectionListItemV1[] = [];
  for (const correction of await readCorrections(deps.correctionsDir)) {
    const repository = await repositoryOf(deps, correction.projectKey);
    const marks = debugGroupIds(deps.store, correction.id).map((groupId) => {
      const group = readGroup(deps.store, groupId);
      return { groupId, mark: readDebugMark(group)!, live: debugGroupLive(deps.store, groupId), state: String((group as { status?: unknown }).status) };
    });
    const newest = marks.at(-1);
    let closed: CorrectionClosedState = { state: "open" };
    if (repository !== null) {
      const groupTarget = newest === undefined ? null : await integrationTargetRef(deps.store, newest.groupId);
      closed = await correctionClosedState(repository.path, correction,
        groupTarget === null ? { ref: await currentBranchRef(repository.path), via: "by-hand" } : { ref: groupTarget, via: "debug-group" });
    }
    items.push({
      correction, repoId: repository?.repoId ?? null,
      debugGroups: marks.map(({ groupId, mark, live, state }) => ({ groupId, ordinal: mark.ordinal, live, state })),
      closed, closing: newest?.mark.closing ?? null, withdrawn: withdrawnBy.get(correction.id) ?? null,
    });
  }
  return items;
}
