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
