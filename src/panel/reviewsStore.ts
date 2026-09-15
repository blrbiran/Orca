import { appendFile, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
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

/**
 * spec section 4.3.2: the dedupe set is in-process, seeded once at startup.
 * Its upper bound is two rows per distinct decisionId -- one `opened`, one
 * `reviewed` -- and is therefore independent of how long the process runs. The
 * spec's first draft called it unbounded; it corrects itself there.
 *
 * Two panel processes still write duplicates. Accepted on purpose: the
 * alternative is a cross-process lock on the READ path, and section 4.3.1 is
 * about getting the observation mechanism off that path, not further onto it.
 */
export class ReviewsWriter {
  private readonly seen = new Set<string>();
  private loaded = false;

  constructor(private readonly dir: string) {}

  async load(): Promise<void> {
    for (const row of await readReviews(this.dir)) this.seen.add(key(row));
    this.loaded = true;
  }

  async append(row: ReviewRow): Promise<"written" | "duplicate"> {
    if (!this.loaded) throw new Error("orca panel: ReviewsWriter.append called before load()");
    const rowKey = key(row);
    if (this.seen.has(rowKey)) return "duplicate";

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
    }
    return "written";
  }
}
