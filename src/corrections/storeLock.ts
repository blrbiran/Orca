import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CORRECTIONS_DIR_MODE, CORRECTIONS_FILE_MODE, storeLockDir } from "./paths.js";
import { CorrectRejection } from "./rejection.js";

export const CORRECTIONS_STORE_BUSY = "corrections-store-busy";

/**
 * spec §7.3: unlike the repo lock — which covers a whole round and is refused
 * outright — this one covers a single append and should retry briefly rather
 * than make a person re-type the command. About a second, then a named
 * refusal. Stale recovery is deliberately NOT done here either: guessing that
 * a pid is dead is exactly the kind of guess repoLock.ts refuses to make. What
 * this gives a person instead is an executable way out — the message says
 * which directory to look at and who claims to hold it.
 */
export const STORE_LOCK_TIMEOUT_MS = 1_000;
const RETRY_INTERVAL_MS = 25;

export interface StoreLock {
  release(): Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function acquireStoreLock(
  dir: string,
  timeoutMs: number = STORE_LOCK_TIMEOUT_MS,
): Promise<StoreLock> {
  // §14.8: the PARENT is created recursively (it may not exist at all on a
  // fresh machine); the lock directory itself stays non-recursive, because
  // that is the entire mutual-exclusion mechanism — a recursive mkdir succeeds
  // against a directory that already exists and would hand two processes the
  // same lock. `flock` was not chosen for the reason repoLock.ts records: it
  // degrades to a no-op on platforms without fcntl, and Rule 12 does not allow
  // a silent degradation.
  await mkdir(dir, { recursive: true, mode: CORRECTIONS_DIR_MODE });

  const lockDir = storeLockDir(dir);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      // Explicit mode here too (Rule 17 / spec §14.17 carry no qualifier):
      // the parent being 0700 only mitigates this by accident, and stops
      // the moment ORCA_CORRECTIONS_DIR points somewhere looser. This must
      // stay non-recursive — EEXIST on this exact call is the only signal
      // that someone else holds the lock.
      await mkdir(lockDir, { mode: CORRECTIONS_DIR_MODE });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (Date.now() >= deadline) {
        const info = await readFile(join(lockDir, "info"), "utf8").catch(() => "(no info file)");
        throw new CorrectRejection(
          CORRECTIONS_STORE_BUSY,
          `another process holds the corrections store lock (${lockDir}) — it says: ${info.trim()}`,
          4,
        );
      }
      await sleep(RETRY_INTERVAL_MS);
    }
  }

  await writeFile(join(lockDir, "info"), `pid ${process.pid}\nacquired ${new Date().toISOString()}\n`, {
    mode: CORRECTIONS_FILE_MODE,
  });

  let released = false;
  return {
    release: async () => {
      if (released) return;
      released = true;
      await rm(lockDir, { recursive: true, force: true });
    },
  };
}

/**
 * The critical section as one shape, so that every caller releases in a
 * `finally` by construction rather than by remembering to. §14.3 (second
 * seat, C-B) is the reason this is not left to call sites: a release written
 * as the last statement is skipped by every rejection in front of it, and the
 * rejections here are the EXPECTED path.
 */
export async function withStoreLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const lock = await acquireStoreLock(dir);
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}
