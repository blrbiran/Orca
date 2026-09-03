import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface RepoLock {
  release(): Promise<void>;
}

/**
 * spec §1.2 rule 3 / §10.2 S21: at most one orca process may be running
 * against a given target repo at a time — the work branch W is shared
 * mutable state that a second, concurrent orca could check out, commit
 * onto, or merge into mid-run. `mkdir` (non-recursive) is the whole
 * mechanism: creating a directory that already exists is atomic and fails
 * with EEXIST on every platform node runs on, and — unlike `flock`/`fcntl` —
 * it has no platform where it degrades to a no-op. That is precisely why it
 * was chosen over `flock`: a prior-art scheduler (hermes) degrades its lock
 * to a no-op on platforms without `fcntl`, and CLAUDE.md Rule 12 ("fail
 * loud") does not allow that kind of silent degradation here. Failing to
 * acquire throws; this function never returns null and lets a caller
 * continue as if it held the lock (see M-LOCK-b in task-6-brief.md).
 *
 * The lock directory lives at `<targetRepo>/.git/orca-lock` — inside `.git/`,
 * not the worktree. That placement matters because of §4.2.1: S22 judges the
 * target worktree's cleanliness with `git status --porcelain`. A lock
 * directory sitting in the worktree itself would show up as untracked dirt,
 * making the lock check and the cleanliness check fight each other.
 */
export async function acquireRepoLock(targetRepo: string): Promise<RepoLock> {
  const lockDir = join(targetRepo, ".git", "orca-lock");
  try {
    await mkdir(lockDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`orca: another orca process already holds the repo lock on ${targetRepo} (${lockDir})`);
    }
    throw err;
  }

  // Written for a human who goes looking for who is holding the lock — pid
  // and wall-clock time, nothing this module (or any caller) ever reads
  // back. A stale-lock heuristic (e.g. "the pid is dead, so steal the lock")
  // is deliberately out of scope: it is a fresh source of exactly the wrong
  // kind of guess this design otherwise refuses to make.
  await writeFile(join(lockDir, "info"), `pid ${process.pid}\nacquired ${new Date().toISOString()}\n`);

  let released = false;
  return {
    release: async () => {
      if (released) return;
      released = true;
      await rm(lockDir, { recursive: true, force: true });
    },
  };
}
