import { appendFile, chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { parseRow } from "./compactClassify.js";
import { REVIEWS_DIR_MODE, REVIEWS_FILE_MODE, reviewsFile } from "./paths.js";
import { acquireReviewsLock } from "./reviewsLock.js";
import { isDuplicateStateRow, isStateAction } from "./reviewState.js";
import type { ReviewStateAction } from "./reviewState.js";

/** decisions review withdraw spec section 4.1: `withdrawn` ends the same person's `reviewed`. */
export type ReviewAction = "opened" | "reviewed" | "withdrawn";

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
//
// (decisions review withdraw spec section 4.3) This key now dedupes only rows
// that carry no review state (`opened`). A reviewed/withdrawn row is keyed by
// `stateKey` -- the person on the decision, without the action -- and is a
// duplicate only when it equals that person's current state.
const key = (row: ReviewRow): string =>
  [row.projectKey, row.decisionId, row.by, row.action].join(UNIT_SEPARATOR);
const stateKey = (projectKey: string, decisionId: string, by: string): string =>
  [projectKey, decisionId, by].join(UNIT_SEPARATOR);

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
    const parsed = parseRow(line);
    // A torn last line is the expected race of reading an append-only file
    // while someone appends; E2 section 5.2 makes the same exemption. Here
    // the file is only ever read to rebuild a dedupe set, so a dropped row
    // costs one duplicate, never a wrong number.
    //
    // (reviews compaction spec section 8 item 11) A line that parses but is not
    // a row -- `null`, a number, an array, a non-string key field -- is dropped
    // the same way: it is exactly what `orca compact-reviews` counts as
    // unreadable and keeps, and every caller reads fields off each element, so
    // keeping it made load() and /api/metrics and /api/todo throw.
    if (parsed === undefined) continue;
    rows.push(parsed as unknown as ReviewRow);
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
 *
 * *** ERRATUM (2026-10-18, session b304f167, decisions review withdraw spec section 4.3) ***
 * The bound above is no longer two rows per decision. `opened` keeps its
 * one-per-(projectKey, decisionId, by) set, but reviewed/withdrawn rows are now
 * a per-person STATE (`states`, the latest of the two), and a state row is
 * written whenever it differs from that state -- so reviewed -> withdrawn ->
 * reviewed is three rows. The memory stays one entry per person per decision;
 * the FILE grows with real withdraw and re-review acts only, never with
 * repeated clicks. `stateOf` exposes the in-memory state to the routes.
 */
export class ReviewsWriter {
  /** Rows without review state (`opened`), by `key`. */
  private seen = new Set<string>();
  /** Per-person review state, by `stateKey`: the latest reviewed/withdrawn row. */
  private states = new Map<string, ReviewStateAction>();
  /** Keys claimed and not yet written (or failed). A reload keeps them. */
  private readonly inFlight = new Set<string>();
  /** State claims not yet written (or failed). A reload lets them override the disk state. */
  private readonly inFlightStates = new Map<string, ReviewStateAction>();
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
    const nextStates = new Map<string, ReviewStateAction>();
    for (const row of await readReviews(this.dir)) {
      // File order: a later state row overwrites an earlier one.
      if (isStateAction(row.action)) nextStates.set(stateKey(row.projectKey, row.decisionId, row.by), row.action);
      else next.add(key(row));
    }
    // A claim still being written is not on disk yet; dropping it here would
    // let a concurrent append of the same row write it twice.
    for (const claimed of this.inFlight) next.add(claimed);
    for (const [claimed, action] of this.inFlightStates) nextStates.set(claimed, action);
    // Assigned together, after the read succeeded: a read that throws must not
    // leave the new identity beside the old set, or the next duplicate hit would
    // trust a set it never rebuilt.
    this.identity = identity;
    this.seen = next;
    this.states = nextStates;
    this.loaded = true;
  }

  /** In memory, after `load()`: the person's current review state on the decision, if any. */
  stateOf(projectKey: string, decisionId: string, by: string): ReviewStateAction | undefined {
    if (!this.loaded) throw new Error("orca panel: ReviewsWriter.stateOf called before load()");
    return this.states.get(stateKey(projectKey, decisionId, by));
  }

  private isDuplicate(row: ReviewRow): boolean {
    if (isStateAction(row.action)) {
      return isDuplicateStateRow(this.states.get(stateKey(row.projectKey, row.decisionId, row.by)), row.action);
    }
    return this.seen.has(key(row));
  }

  async append(row: ReviewRow): Promise<"written" | "duplicate"> {
    if (!this.loaded) throw new Error("orca panel: ReviewsWriter.append called before load()");
    if (this.isDuplicate(row)) {
      // reviews compaction spec section 5.2: only on this path, so the read
      // path and the non-duplicate write path gain no I/O.
      const current = await this.identityOf(reviewsFile(this.dir));
      if (current === this.identity) return "duplicate";
      await this.load();
      if (this.isDuplicate(row)) return "duplicate";
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
    //
    // (decisions review withdraw spec section 4.3) A state row claims the same
    // way: the person's state is set to the new action now, and the previous
    // state is remembered so a failed write can give it back.
    const rowKey = key(row);
    const state = isStateAction(row.action) ? row.action : undefined;
    const rowStateKey = stateKey(row.projectKey, row.decisionId, row.by);
    const previousState = this.states.get(rowStateKey);
    if (state === undefined) {
      this.seen.add(rowKey);
      this.inFlight.add(rowKey);
    } else {
      this.states.set(rowStateKey, state);
      this.inFlightStates.set(rowStateKey, state);
    }
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
      if (state === undefined) this.seen.delete(rowKey);
      else if (previousState === undefined) this.states.delete(rowStateKey);
      else this.states.set(rowStateKey, previousState);
      throw err;
    } finally {
      if (state === undefined) this.inFlight.delete(rowKey);
      else this.inFlightStates.delete(rowStateKey);
    }
    return "written";
  }
}
