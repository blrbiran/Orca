import { join } from "node:path";
import { ControlError } from "./errors.js";
import { ORCA_IDENTITY, git } from "../scheduler/gitExec.js";
import { blockRun, groupRepoId, readDriverRun, saveDriverRun, write, type ExecutionDriverDeps } from "./executionDriver.js";
import { QUIET_GIT, compareAndSwap, incomingRefOf, landingPathOf, removeOwnPath, revParse, workBranchRef } from "./workspace.js";

/**
 * Execution driver spec §5. Nothing here runs in the person's checkout: every merge happens in a
 * detached worktree the driver names under its own root, and the work branch moves only by
 * compare-and-swap from the tip it was read at.
 */

/**
 * spec §2.2 D's idempotence: a landing the driver already made (it died after the swap, before it
 * recorded it) is found, not repeated. The landing is the first-parent commit whose second parent is
 * this run's attempt; an attempt reachable some other way is not a landing this driver can name.
 */
export async function findLanding(targetRepo: string, base: string, tip: string, attemptSha: string): Promise<string | null> {
  try { await git(targetRepo, [...QUIET_GIT, "merge-base", "--is-ancestor", attemptSha, tip]); }
  catch { return null; }
  const lines = (await git(targetRepo, [...QUIET_GIT, "rev-list", "--first-parent", "--parents", `${base}..${tip}`])).trim().split("\n").filter(Boolean);
  const hit = lines.map((line) => line.split(" ")).find((parts) => parts[2] === attemptSha);
  if (hit === undefined) throw new ControlError("recovery-blocked", "landing-outcome-unknown");
  return hit[0]!;
}

export function markLanded(deps: ExecutionDriverDeps, runId: string, landedCommit: string): void {
  write(deps, () => {
    const run = readDriverRun(deps.store, runId);
    if (run.state !== "collected" && run.state !== "reconciling") return;
    run.state = "landed";
    run.drive = { ...run.drive!, landedCommit };
    saveDriverRun(deps.store, run);
  });
}

/**
 * D (spec §5.1-§5.2). The out-of-bounds check already ran in C. Here: merge the attempt into the
 * current tip in a fresh detached worktree, then swap the branch from that tip. A moved tip is not an
 * error -- the next round lands on the new one. The landing worktree is removed whatever happens.
 */
export async function stepD(deps: ExecutionDriverDeps, runId: string): Promise<boolean> {
  const { store } = deps;
  const run = readDriverRun(store, runId);
  if (run.state !== "collected" || run.drive?.attemptSha == null || run.drive.base === null) return false;
  const drive = run.drive;
  let targetRepo: string;
  try { targetRepo = deps.resolveRepository(groupRepoId(store, run.groupId)); }
  catch { blockRun(deps, runId, "D", "repository-path"); return true; }
  const branch = workBranchRef(run.groupId);
  const old = await revParse(targetRepo, branch);
  const already = await findLanding(targetRepo, drive.base!, old, drive.attemptSha!);
  if (already !== null) { markLanded(deps, runId, already); return true; }
  const landing = landingPathOf(deps.roots, runId);
  await removeOwnPath(targetRepo, deps.roots, landing);
  await git(targetRepo, [...QUIET_GIT, "worktree", "add", "--detach", landing, old]);
  try {
    // Into the target's shared refs: the incoming ref is how the attempt stays reachable until settle.
    await git(landing, [...QUIET_GIT, "fetch", "--no-tags", join(drive.sourceDir, "repo"), `+${drive.attemptSha}:${incomingRefOf(runId)}`]);
    try {
      await git(landing, [...QUIET_GIT, ...ORCA_IDENTITY, "merge", "--no-ff", "-m", `orca: land ${runId}`, incomingRefOf(runId)]);
    } catch {
      await git(landing, [...QUIET_GIT, "merge", "--abort"]).catch(() => undefined);
      blockRun(deps, runId, "D", "merge-conflict");
      return true;
    }
    const next = await revParse(landing, "HEAD");
    await deps.beforeCas?.();
    if (!await compareAndSwap(targetRepo, branch, next, old)) return false;
    deps.crash?.("D-after-cas");
    markLanded(deps, runId, next);
    return true;
  } finally {
    await removeOwnPath(targetRepo, deps.roots, landing);
  }
}
