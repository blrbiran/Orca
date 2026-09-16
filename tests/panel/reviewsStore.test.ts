import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withStoreLock } from "../../src/corrections/storeLock.js";
import { REVIEWS_DIR_MODE, REVIEWS_FILE_MODE, reviewsFile } from "../../src/panel/paths.js";
import { acquireReviewsLock } from "../../src/panel/reviewsLock.js";
import { ReviewsWriter, readReviews } from "../../src/panel/reviewsStore.js";
import type { ReviewRow } from "../../src/panel/reviewsStore.js";

const row = (over: Partial<ReviewRow> = {}): ReviewRow => ({
  decisionId: "orca-dev-1/1",
  projectKey: "github.com/biran/orca",
  action: "opened",
  by: "amy",
  at: "2026-09-10T00:00:00.000Z",
  ...over,
});

describe("the reviews store (spec section 4.3)", () => {
  let dir: string;
  let umaskBefore: number;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "orca-reviews-"));
    // Pinned and restored, the same way storeLock.test.ts does it: a permissive
    // umask on the developer's machine would otherwise let the mode assertions
    // pass for the wrong reason.
    umaskBefore = process.umask(0o022);
  });
  afterEach(async () => {
    process.umask(umaskBefore);
    await rm(dir, { recursive: true, force: true });
  });

  it("gives the directory and the file their modes explicitly, not from the umask", async () => {
    // Both halves of this were empty as first written, and both external
    // review seats measured it independently. Two repairs, and BOTH are needed:
    //
    // 1. The directory must be one THIS CODE created. `dir` comes from mkdtemp,
    //    which independently hands back 0700 (measured: `mkdtemp mode octal =
    //    700`, umask 22) -- so the assertion was pinning mkdtemp's behaviour,
    //    not ReviewsWriter's. Deleting `mode:` from the mkdir call reddened
    //    nothing at all.
    // 2. The expected value must be a LITERAL, not the constant the mutation
    //    edits. Mutation R-9 changes REVIEWS_DIR_MODE and REVIEWS_FILE_MODE;
    //    comparing against those same constants moves both sides of the
    //    equation together, and the file half stayed green under it.
    await rm(dir, { recursive: true, force: true });
    const writer = new ReviewsWriter(dir);
    await writer.load();
    await writer.append(row());
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect((await stat(reviewsFile(dir))).mode & 0o777).toBe(0o600);
  });

  // D2 (controller notes): the brief registered this as a known gap and
  // deferred it to Task 9. This task owns the code, so it owns the criterion.
  // An already-existing directory belongs to whoever created it -- a person,
  // or another program -- and this store does not get to decide its mode.
  // Only the FILE is new here, so only the file half is pinned to 0600; the
  // directory half is pinned to whatever it already was (0755), which must
  // survive untouched.
  it("leaves an already-existing directory's mode alone, even when it is looser than 0700", async () => {
    await chmod(dir, 0o755);
    const writer = new ReviewsWriter(dir);
    await writer.load();
    await writer.append(row());
    expect((await stat(dir)).mode & 0o777).toBe(0o755);
    expect((await stat(reviewsFile(dir))).mode & 0o777).toBe(0o600);
  });

  it("skips a row it already wrote in this process, keyed by decision, person and action", async () => {
    const writer = new ReviewsWriter(dir);
    await writer.load();
    expect(await writer.append(row())).toBe("written");
    expect(await writer.append(row())).toBe("duplicate");
    // The literal count, not "at most one": mutation R-7 deletes the dedupe,
    // and an upper bound stays green when the second write lands.
    expect(await readReviews(dir)).toHaveLength(1);
  });

  // Fix round 1 finding (Important, confirmed in scope): `has` then `add` is a
  // check-then-act pair. The old code only added to `seen` after the write
  // completed, so two concurrent `append` calls on the SAME instance for the
  // SAME row could both pass the `has` check before either reached `add`, and
  // both would write -- the dedupe guarantee does not hold under concurrency.
  // Reachable in production: Task 5 wires one shared ReviewsWriter into the
  // HTTP handlers, so two clicks (or one double click) are two concurrent
  // calls. Mutation R-11 (move `seen.add(key(row))` back to after the write)
  // reverts the fix and must turn this red.
  it("resolves exactly one of two concurrent appends for the same row as written, the other as duplicate", async () => {
    const writer = new ReviewsWriter(dir);
    await writer.load();
    const [a, b] = await Promise.all([writer.append(row()), writer.append(row())]);
    // Order-independent: whichever call wins the race, the OUTCOMES must be
    // exactly one "written" and one "duplicate" -- not "at least one written"
    // and not "both written".
    expect([a, b].sort()).toEqual(["duplicate", "written"]);
    // The literal count, not an upper bound: the bug this pins made this 2.
    expect(await readReviews(dir)).toHaveLength(1);
  });

  // Final review I-1 / ruling R64: decision ids repeat across clones and forks
  // (E2 measured it), so the identity is (projectKey, decisionId) everywhere
  // else in the panel. A key without projectKey silently dropped the second
  // repository's row -- the probe measured `proj-b (same id): duplicate`, one
  // row on disk. The same-projectKey half is the positive control: a key that
  // stopped deduping altogether would also write two rows above.
  it("keys dedupe by projectKey too: the same decision id in two repositories writes two rows", async () => {
    const writer = new ReviewsWriter(dir);
    await writer.load();
    expect(await writer.append(row({ projectKey: "proj-a", action: "reviewed" }))).toBe("written");
    expect(await writer.append(row({ projectKey: "proj-b", action: "reviewed" }))).toBe("written");
    expect(await readReviews(dir)).toHaveLength(2);

    expect(await writer.append(row({ projectKey: "proj-a", action: "reviewed" }))).toBe("duplicate");
    expect(await readReviews(dir)).toHaveLength(2);
  });

  it("treats a different action on the same decision as a different row", async () => {
    const writer = new ReviewsWriter(dir);
    await writer.load();
    await writer.append(row({ action: "opened" }));
    await writer.append(row({ action: "reviewed" }));
    expect(await readReviews(dir)).toHaveLength(2);
  });

  it("picks up rows an earlier process wrote, so dedupe survives a restart", async () => {
    const first = new ReviewsWriter(dir);
    await first.load();
    await first.append(row());
    const second = new ReviewsWriter(dir);
    await second.load();
    expect(await second.append(row())).toBe("duplicate");
    expect(await readReviews(dir)).toHaveLength(1);
  });

  it("does NOT share the corrections lock: holding that one must not block a review", async () => {
    // spec section 4.3. Sharing would answer a review write with
    // `corrections-store-busy`, a refusal naming a subsystem the caller never
    // touched. This is the negative control for mutation R-6; without it,
    // collapsing the two locks into one is invisible.
    const writer = new ReviewsWriter(dir);
    await writer.load();
    await withStoreLock(dir, async () => {
      await expect(writer.append(row())).resolves.toBe("written");
    });
    expect(await readReviews(dir)).toHaveLength(1);
  });

  it("refuses by its OWN name when its OWN lock is held", async () => {
    const writer = new ReviewsWriter(dir);
    await writer.load();
    const held = await acquireReviewsLock(dir);
    try {
      await expect(writer.append(row())).rejects.toMatchObject({ code: "reviews-store-busy" });
    } finally {
      await held.release();
    }
  });

  it("appends whole lines, so a reader never sees two rows glued together", async () => {
    const writer = new ReviewsWriter(dir);
    await writer.load();
    await writer.append(row());
    await writer.append(row({ action: "reviewed" }));
    const text = await readFile(reviewsFile(dir), "utf8");
    // The trailing newline is load-bearing: A' measured that a ledger without
    // one makes the next append glue itself onto the previous record.
    expect(text.endsWith("\n")).toBe(true);
    expect(text.trimEnd().split("\n")).toHaveLength(2);
  });
});

// Appended by the reviews compaction round (spec section 5). Nothing above this line is edited.
import { mkdir as mkdirRaw, rename as renameFile, writeFile as writeFileRaw } from "node:fs/promises";
import { identityFromStats } from "../../src/panel/reviewsStore.js";

describe("the reviews writer after reviews.jsonl is replaced (reviews compaction spec section 5)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "orca-reviews-identity-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const reviewed = (over: Partial<ReviewRow> = {}): ReviewRow => row({ action: "reviewed", ...over });

  it("C17 writes a key again after reviews.jsonl was replaced by a rename that no longer holds it", async () => {
    const writer = new ReviewsWriter(dir);
    await writer.load();
    expect(await writer.append(reviewed())).toBe("written");
    // What `orca compact-reviews --apply` does when it moves this row out.
    const replacement = join(dir, "replacement");
    await writeFileRaw(replacement, "");
    await renameFile(replacement, reviewsFile(dir));
    expect(await writer.append(reviewed())).toBe("written");
    expect(await readReviews(dir)).toHaveLength(1);
  });

  it("C17b a reload that fails does not leave the new identity beside the old set", async () => {
    let identity = "before";
    const writer = new ReviewsWriter(dir, async () => identity);
    await writer.load();
    expect(await writer.append(reviewed())).toBe("written");
    // The file is replaced by something that cannot be read as a file: the
    // reload the changed identity triggers must fail loudly.
    identity = "after";
    await rm(reviewsFile(dir));
    await mkdirRaw(reviewsFile(dir));
    await expect(writer.append(reviewed())).rejects.toMatchObject({ code: "EISDIR" });
    // Readable again, identity still "after" and still not what was loaded.
    await rm(reviewsFile(dir), { recursive: true });
    await writeFileRaw(reviewsFile(dir), "");
    expect(await writer.append(reviewed())).toBe("written");
    expect(await readReviews(dir)).toHaveLength(1);
  });

  it("C18 identityFromStats tells two files apart by birthtime even when dev and ino match", () => {
    // ext4 reuses inode numbers; two compactions in a row can hand the new
    // file the old one's ino. This machine (APFS) cannot produce that, which is
    // why the spelling is pinned here directly.
    expect(identityFromStats({ dev: 1, ino: 2, birthtimeMs: 3 })).not.toBe(identityFromStats({ dev: 1, ino: 2, birthtimeMs: 4 }));
    // The equal half, or a function that never answers equal would pass.
    expect(identityFromStats({ dev: 1, ino: 2, birthtimeMs: 3 })).toBe(identityFromStats({ dev: 1, ino: 2, birthtimeMs: 3 }));
  });

  it("C19 answers duplicate without reloading when the identity is unchanged, and it did check", async () => {
    let calls = 0;
    const writer = new ReviewsWriter(dir, async () => {
      calls += 1;
      return "same";
    });
    await writer.load();
    expect(await writer.append(reviewed())).toBe("written");
    expect(calls).toBe(1); // load only: the non-duplicate path does not look
    expect(await writer.append(reviewed())).toBe("duplicate");
    expect(calls).toBe(2); // exactly one check, and no reload (a reload would make it 3)
    expect(await readReviews(dir)).toHaveLength(1);
  });

  it("C19b keeps a claim still being written when a changed identity forces a reload", async () => {
    let calls = 0;
    const writer = new ReviewsWriter(dir, async () => (calls++ === 0 ? "before" : "after"));
    await writer.load();
    // Holding the lock parks the first append after its claim and before its
    // write, deterministically -- no sleeps.
    const held = await acquireReviewsLock(dir);
    const first = writer.append(reviewed());
    // Under the mutation that drops in-flight claims, `first` can time out on
    // the lock while `second` is awaited; mark it handled so that shows up as
    // THIS test's red, not as an unhandled rejection elsewhere in the run.
    first.catch(() => undefined);
    try {
      const second = writer.append(reviewed());
      // The second call hits memory, sees the identity change, and reloads from
      // a disk that does not hold the row yet. Only the in-flight claim can
      // still answer duplicate -- without it, it claims and waits on the lock.
      expect(await second).toBe("duplicate");
    } finally {
      await held.release();
    }
    expect(await first).toBe("written");
    expect(await readReviews(dir)).toHaveLength(1);
  });

  it("C20 writes a key again after reviews.jsonl was deleted by hand", async () => {
    // Seeded by ANOTHER writer, so this one loads a file that exists: a writer
    // that loaded "no file" and then sees "no file" has, correctly, nothing to
    // reload -- that would not be the case this criterion is about.
    const seeder = new ReviewsWriter(dir);
    await seeder.load();
    expect(await seeder.append(reviewed())).toBe("written");
    const writer = new ReviewsWriter(dir);
    await writer.load();
    await rm(reviewsFile(dir));
    expect(await writer.append(reviewed())).toBe("written");
    expect(await readReviews(dir)).toHaveLength(1);
  });

  it("C19c a claim whose write failed does not come back on a later reload", async () => {
    let identity = "before";
    const writer = new ReviewsWriter(dir, async () => identity);
    await writer.load();
    // The write fails: the person sees a 409 while compaction holds the lock.
    const held = await acquireReviewsLock(dir);
    try {
      await expect(writer.append(reviewed())).rejects.toMatchObject({ code: "reviews-store-busy" });
    } finally {
      await held.release();
    }
    const other = reviewed({ decisionId: "orca-dev-1/2" });
    expect(await writer.append(other)).toBe("written");
    // The file is replaced (compaction's rename); a duplicate hit on another
    // key forces the reload that would merge a leaked claim back in.
    identity = "after";
    expect(await writer.append(other)).toBe("duplicate");
    // The retry of the failed click must write.
    expect(await writer.append(reviewed())).toBe("written");
    expect((await readReviews(dir)).filter((r) => r.decisionId === "orca-dev-1/1")).toHaveLength(1);
  });
});
