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
const key = (row: ReviewRow): string =>
  [row.decisionId, row.by, row.action].join(UNIT_SEPARATOR);

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
    if (this.seen.has(key(row))) return "duplicate";

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
    this.seen.add(key(row));
    return "written";
  }
}
