import { mkdir, rmdir } from "node:fs/promises";
import { REVIEWS_DIR_MODE, reviewsLockDir } from "./paths.js";
import { PanelRejection } from "./rejection.js";

export const REVIEWS_STORE_BUSY = "reviews-store-busy";

/** The same budget as the corrections lock (storeLock.ts: STORE_LOCK_TIMEOUT_MS). */
export const REVIEWS_LOCK_TIMEOUT_MS = 1_000;

export interface ReviewsLock {
  release(): Promise<void>;
}

/**
 * mkdir is the atomic primitive: it either creates the directory or fails with
 * EEXIST, with no window in between. Shaped after storeLock.ts rather than
 * imported from it, because that module's refusal is named for corrections and
 * being separately named is the entire point here.
 */
export async function acquireReviewsLock(
  dir: string,
  now: () => number = () => performance.now(),
): Promise<ReviewsLock> {
  const lockPath = reviewsLockDir(dir);
  const deadline = now() + REVIEWS_LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      await mkdir(lockPath, { mode: REVIEWS_DIR_MODE });
      return { release: () => rmdir(lockPath).catch(() => undefined) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (now() >= deadline) {
        throw new PanelRejection(
          REVIEWS_STORE_BUSY,
          `another orca panel is writing ${lockPath}. It is released as soon as that write ` +
            `finishes; if the directory is stale, remove it by hand.`,
          5,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}
