import { join } from "node:path";

/**
 * spec section 4.3: reviews live beside corrections, under the SAME
 * ORCA_CORRECTIONS_DIR override. One environment variable, not two. A second
 * one would give a criterion a way to redirect corrections and still write the
 * developer's real ~/.orca/reviews.jsonl, which is the exact hazard Rule 17
 * exists to remove.
 *
 * This module does not resolve the environment variable itself -- the caller
 * passes the directory in, the same `correctionsDir(env)` the corrections
 * store resolves (src/corrections/paths.ts), so one environment variable
 * redirects both stores. Wiring that call site is Task 3's.
 */
export const reviewsFile = (dir: string): string => join(dir, "reviews.jsonl");

/**
 * Its OWN lock directory, not .corrections-lock. Sharing would answer a review
 * write with `corrections-store-busy`: a refusal naming a subsystem the caller
 * never touched. spec section 4.3, mutation R-6.
 */
export const reviewsLockDir = (dir: string): string => join(dir, ".reviews-lock");

/** Given explicitly, never inherited from the umask. Same rule as corrections/paths.ts. */
export const REVIEWS_DIR_MODE = 0o700;
export const REVIEWS_FILE_MODE = 0o600;

/**
 * reviews compaction spec section 7: the three paths only
 * `orca compact-reviews --apply` writes. The panel itself only appends
 * reviews.jsonl and takes .reviews-lock.
 */
export const reviewsArchiveFile = (dir: string): string => join(dir, "reviews-archive.jsonl");
export const reviewsBackupFile = (dir: string): string => join(dir, "reviews.jsonl.pre-compact");
export const reviewsCompactTmpFile = (dir: string): string => join(dir, "reviews.jsonl.compact-tmp");
