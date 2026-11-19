import { git } from "../scheduler/gitExec.js";
import { QUIET_GIT } from "./workspace.js";

/**
 * Change-sized runs spec 2026-11-19 §5.3 (P2; #363 #366). Every new git command Orca runs in a person's repository carries
 * these as well (review minor 5): Orca never starts a gc or a maintenance task there.
 */
export const NO_GC = ["-c", "gc.auto=0", "-c", "maintenance.auto=false"];
export const runRefOf = (runId: string): string => `refs/orca/runs/${runId}`;

async function revParseOptional(repo: string, name: string): Promise<string | null> {
  try { return (await git(repo, [...QUIET_GIT, "rev-parse", "-q", "--verify", name])).trim() || null; } catch { return null; }
}

/** What step C checks before it uses an attempt (§5.3); a failure names which check, and nothing is pinned. */
export type AttemptCheckFailure = "attempt-missing" | "attempt-not-from-base" | "attempt-tree-mismatch" | "attempt-ref-mismatch";

/**
 * §5.3 "Checks before use", as built against ccloop P1: the attempt must be a commit in `repo` and descend from the run's
 * `base` (never equality: ccloop's `attempt.base` is `attempt^`, which is the agent's own commit when it committed in its
 * worktree). A ccloop-recorded attempt also has the tree and the ref ccloop recorded.
 */
export async function checkAttempt(repo: string, base: string, sha: string, recorded?: { tree: string; ref: string }): Promise<AttemptCheckFailure | null> {
  if (await revParseOptional(repo, `${sha}^{commit}`) !== sha) return "attempt-missing";
  try { await git(repo, [...QUIET_GIT, "merge-base", "--is-ancestor", base, sha]); } catch { return "attempt-not-from-base"; }
  if (recorded === undefined) return null;
  if (await revParseOptional(repo, `${sha}^{tree}`) !== recorded.tree) return "attempt-tree-mismatch";
  if (await revParseOptional(repo, recorded.ref) !== sha) return "attempt-ref-mismatch";
  return null;
}

export type PinResult = { pinned: { ref: string; sha: string } } | { refused: string };

/**
 * §5.3 pin (review I3), idempotent and create-only: `refs/orca/runs/<runId>` in the target repository is set to `sha` only
 * if it does not exist. The attempt's objects are fetched from `source` (C1 or a legacy C5) into FETCH_HEAD only when the
 * target lacks them (clone mode): a fetch with a destination would fast-forward an existing ref to a descendant, rc 0.
 * A ref at any other sha -- an ancestor included -- is `run-ref-conflict`, never forced. Any other failure is git's own
 * words. Rule 17: registered in spec §9 (the ref, the fetched objects and FETCH_HEAD are kept by design).
 */
export async function pinAttempt(targetRepo: string, source: string, runId: string, sha: string): Promise<PinResult> {
  const ref = runRefOf(runId);
  const held = await revParseOptional(targetRepo, ref);
  if (held === sha) return { pinned: { ref, sha } };
  if (held !== null) return { refused: `run-ref-conflict:${held}` };
  try {
    if (await revParseOptional(targetRepo, `${sha}^{commit}`) !== sha) {
      await git(targetRepo, [...QUIET_GIT, ...NO_GC, "fetch", "-q", "--no-tags", "--no-write-fetch-head", source, sha]).catch(async () =>
        // An older git without --no-write-fetch-head, or a source that refuses a bare sha: FETCH_HEAD is the only write.
        git(targetRepo, [...QUIET_GIT, ...NO_GC, "fetch", "-q", "--no-tags", source, sha]));
    }
    for (let tries = 0; ; tries += 1) {
      try {
        // The empty old value makes the update create-only.
        await git(targetRepo, [...QUIET_GIT, ...NO_GC, "update-ref", ref, sha, ""]);
        break;
      } catch (error) {
        const now = await revParseOptional(targetRepo, ref);
        if (now === sha) break; // a concurrent pin of the same attempt
        if (now !== null) return { refused: `run-ref-conflict:${now}` };
        // A person's own gc holding packed-refs.lock is retried in place a few times; anything else is git's words.
        if (tries < 4 && /\.lock'?/.test(String((error as { stderr?: unknown }).stderr ?? ""))) { await new Promise((done) => setTimeout(done, 50 * (tries + 1))); continue; }
        throw error;
      }
    }
  } catch (error) {
    return { refused: `run-ref-failed:${String((error as { stderr?: unknown }).stderr ?? (error as Error).message).trim().slice(0, 300)}` };
  }
  if (await revParseOptional(targetRepo, ref) !== sha) return { refused: "run-ref-failed:not-read-back" };
  return { pinned: { ref, sha } };
}
