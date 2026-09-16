import { appendFile, chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { REVIEWS_DIR_MODE, REVIEWS_FILE_MODE, reviewsFile } from "./paths.js";
import { acquireReviewsLock } from "./reviewsLock.js";

export type ReviewAction = "opened" | "reviewed";

export interface ReviewRow {
  decisionId: string;
  projectKey: string;
  action: ReviewAction;
  by: string;
  /** Wall clock ISO 8601. An age across days and machines is not a monotonic quantity. */
  at: string;
}

// U+001F INFORMATION SEPARATOR ONE. Not the empty string: an empty separator
// would make ["a","bc"] and ["ab","c"] the same dedupe key, and none of
// decisionId/by/action are otherwise guaranteed free of any particular
// character.
const UNIT_SEPARATOR = "\x1f";
//
// *** ERRATUM (2026-09-16, run orca-dev-5d5c8055, final review of E3, ruling R64) ***
// The key now leads with projectKey: (projectKey, decisionId, by, action).
// Decision ids repeat across clones and forks, and every other join in the
// panel is on (projectKey, id); without it a second repository's `reviewed`
// on a same-id decision was answered `duplicate` and never written (measured
// by the final review's probe). The bound in the class comment below becomes
// two rows per distinct (projectKey, decisionId).
const key = (row: ReviewRow): string =>
  [row.projectKey, row.decisionId, row.by, row.action].join(UNIT_SEPARATOR);

export async function readReviews(dir: string): Promise<ReviewRow[]> {
  let text: string;
  try {
    text = await readFile(reviewsFile(dir), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const rows: ReviewRow[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      rows.push(JSON.parse(line) as ReviewRow);
    } catch {
      // A torn last line is the expected race of reading an append-only file
      // while someone appends; E2 section 5.2 makes the same exemption. Here
      // the file is only ever read to rebuild a dedupe set, so a dropped row
      // costs one duplicate, never a wrong number.
    }
  }
  return rows;
}

export type IdentityOf = (path: string) => Promise<string | undefined>;

/**
 * reviews compaction spec sections 5.2.1 and 5.3. birthtime is in the identity
 * because ext4 reuses inode numbers. Where a filesystem has no birthtime, Node
 * may report ctime or 0 there: 0 degrades this to dev:ino; ctime makes every
 * duplicate check see a change and re-read the file -- slower, never wrong.
 */
export function identityFromStats(stats: { dev: number; ino: number; birthtimeMs: number }): string {
  return `${stats.dev}:${stats.ino}:${stats.birthtimeMs}`;
}

export const statIdentity: IdentityOf = async (path) => {
  try {
    return identityFromStats(await stat(path));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
};

/**
 * spec section 4.3.2: the dedupe set is in-process, seeded once at startup.
 * Its upper bound is two rows per distinct decisionId -- one `opened`, one
 * `reviewed` -- and is therefore independent of how long the process runs. The
 * spec's first draft called it unbounded; it corrects itself there.
 *
 * Two panel processes still write duplicates. Accepted on purpose: the
 * alternative is a cross-process lock on the READ path, and section 4.3.1 is
 * about getting the observation mechanism off that path, not further onto it.
 *
 * *** ERRATUM (2026-09-16, run orca-dev-5e5985bc, reviews compaction spec section 5) ***
 * "seeded once at startup" no longer holds on its own. `orca compact-reviews
 * --apply` replaces reviews.jsonl by rename, so a key this set remembers may no
 * longer be on disk, and answering `duplicate` for it would leave a reviewed
 * decision on the to-do list with a 200. On a duplicate hit the writer now
 * compares the file's identity (dev:ino:birthtimeMs) with the one it loaded;
 * if it changed, it rebuilds the set from disk plus the claims still being
 * written. The non-duplicate path is unchanged.
 */
export class ReviewsWriter {
  private seen = new Set<string>();
  /** Keys claimed and not yet written (or failed). A reload keeps them. */
  private readonly inFlight = new Set<string>();
  private identity: string | undefined;
  private loaded = false;

  constructor(
    private readonly dir: string,
    private readonly identityOf: IdentityOf = statIdentity,
  ) {}

  async load(): Promise<void> {
    // Identity BEFORE the read: a replacement landing between the two is then
    // seen as a change on the next duplicate check, never missed.
    const identity = await this.identityOf(reviewsFile(this.dir));
    const next = new Set<string>();
    for (const row of await readReviews(this.dir)) next.add(key(row));
    // A claim still being written is not on disk yet; dropping it here would
    // let a concurrent append of the same row write it twice.
    for (const claimed of this.inFlight) next.add(claimed);
    // Assigned together, after the read succeeded: a read that throws must not
    // leave the new identity beside the old set, or the next duplicate hit would
    // trust a set it never rebuilt.
    this.identity = identity;
    this.seen = next;
    this.loaded = true;
  }

  async append(row: ReviewRow): Promise<"written" | "duplicate"> {
    if (!this.loaded) throw new Error("orca panel: ReviewsWriter.append called before load()");
    const rowKey = key(row);
    if (this.seen.has(rowKey)) {
      // reviews compaction spec section 5.2: only on this path, so the read
      // path and the non-duplicate write path gain no I/O.
      const current = await this.identityOf(reviewsFile(this.dir));
      if (current === this.identity) return "duplicate";
      await this.load();
      if (this.seen.has(rowKey)) return "duplicate";
    }

    // Claimed HERE, synchronously, before the first `await` -- not after the
    // write finishes. `has` then `add` is a check-then-act pair, and every
    // `await` between them opens a window where a second concurrent `append`
    // call on this SAME instance can also pass the `has` check before either
    // call reaches `add`: both would then write. Task 5 wires one shared
    // ReviewsWriter into the HTTP handlers, where two clicks (or one double
    // click) are exactly two concurrent calls, so this window is reachable in
    // production, not just in theory. Removed again in the `catch` below if
    // the write itself fails, so a failed write does not permanently brand a
    // row as already-written.
    this.seen.add(rowKey);
    this.inFlight.add(rowKey);
    try {
      // `mode` here is masked by the umask, which is why the criterion pins the
      // umask explicitly rather than trusting the developer's. An
      // ALREADY-EXISTING directory keeps whatever mode it already has: a
      // recursive mkdir does not touch a directory that is already there, and
      // there is no chmod on this path -- it is a person's (or another
      // program's) directory, and changing its mode is not this program's
      // decision to make.
      await mkdir(this.dir, { recursive: true, mode: REVIEWS_DIR_MODE });
      const lock = await acquireReviewsLock(this.dir);
      try {
        const file = reviewsFile(this.dir);
        let created = false;
        try {
          await writeFile(file, "", { flag: "wx", mode: REVIEWS_FILE_MODE });
          created = true;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        }
        if (created) await chmod(file, REVIEWS_FILE_MODE);
        await appendFile(file, `${JSON.stringify(row)}\n`, "utf8");
      } finally {
        await lock.release();
      }
    } catch (err) {
      this.seen.delete(rowKey);
      throw err;
    } finally {
      this.inFlight.delete(rowKey);
    }
    return "written";
  }
}
