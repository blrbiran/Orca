import { createHash } from "node:crypto";
import { chmod, lstat, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LedgerView } from "../../src/panel/compactClassify.js";
import { applyCompaction, dryRunCompaction } from "../../src/panel/compactReviews.js";
import {
  reviewsArchiveFile,
  reviewsBackupFile,
  reviewsFile,
  reviewsLockDir,
} from "../../src/panel/paths.js";
import { acquireReviewsLock } from "../../src/panel/reviewsLock.js";
import { ReviewsWriter } from "../../src/panel/reviewsStore.js";
import type { ReviewRow } from "../../src/panel/reviewsStore.js";

const PK = "github.com/biran/target";
const rl = (decisionId: string, at = "2026-09-10T00:00:00.000Z"): string =>
  JSON.stringify({ decisionId, projectKey: PK, action: "reviewed", by: "amy", at });

const KEPT = rl("orca-dev-1/1");
const DUP = rl("orca-dev-1/1", "2026-09-12T00:00:00.000Z");
const ORPHAN = rl("orca-dev-8/1");
const FIXTURE = `${KEPT}\n${DUP}\n${ORPHAN}\n`;

const VIEWS: ReadonlyMap<string, LedgerView> = new Map([
  [PK, { judged: true, topLevelIds: new Set(["orca-dev-1/1", "orca-dev-1/2"]), archivedIds: new Set(["orca-dev-8/1"]) }],
]);

const sha = async (path: string): Promise<string> =>
  createHash("sha256").update(await readFile(path)).digest("hex");

/** Every entry of the store directory: file name to sha256, directory name to "dir". */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of (await readdir(dir)).sort()) {
    const path = join(dir, name);
    out[name] = (await stat(path)).isDirectory() ? "dir" : await sha(path);
  }
  return out;
}

describe("applying and dry-running compaction (reviews compaction spec section 4)", () => {
  let dir: string;
  let umaskBefore: number;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "orca-compact-"));
    // Pinned so the mode assertions cannot pass because of the developer's umask.
    umaskBefore = process.umask(0o022);
  });
  afterEach(async () => {
    process.umask(umaskBefore);
    await rm(dir, { recursive: true, force: true });
  });

  const seed = async (text = FIXTURE, mode = 0o600): Promise<void> => {
    await writeFile(reviewsFile(dir), text, { mode });
    await chmod(reviewsFile(dir), mode);
  };

  it("C2 moves an orphan byte for byte into the archive and out of reviews.jsonl", async () => {
    await seed();
    const outcome = await applyCompaction(dir, VIEWS);
    expect(outcome.wrote).toBe(true);
    expect(await readFile(reviewsArchiveFile(dir), "utf8")).toBe(`${ORPHAN}\n`);
    expect(await readFile(reviewsFile(dir), "utf8")).toBe(`${KEPT}\n`);
  });

  it("C2b never glues a new orphan onto a torn archive tail, and adds no blank line after a clean one", async () => {
    await seed();
    await writeFile(reviewsArchiveFile(dir), '{"torn');
    await applyCompaction(dir, VIEWS);
    const archive = await readFile(reviewsArchiveFile(dir), "utf8");
    expect(archive).toBe(`{"torn\n${ORPHAN}\n`);
    expect(JSON.parse(archive.split("\n")[1] ?? "")).toMatchObject({ decisionId: "orca-dev-8/1" });

    // Must-not: a clean tail gets no extra newline in front of the new line.
    const other = rl("orca-dev-5/1");
    await seed();
    await writeFile(reviewsArchiveFile(dir), `${other}\n`);
    await applyCompaction(dir, VIEWS);
    expect(await readFile(reviewsArchiveFile(dir), "utf8")).toBe(`${other}\n${ORPHAN}\n`);
  });

  it("C7 a dry run writes nothing, even while the lock is held, and the same fixture under apply does", async () => {
    await seed();
    const before = await snapshot(dir);
    const report = await dryRunCompaction(dir, VIEWS);
    expect(report.counts).toEqual({ kept: 1, duplicate: 1, orphan: 1, unreadable: 0, "not-judged": 0 });
    expect(await snapshot(dir)).toEqual(before);

    // It takes no lock, so a held lock does not stop it.
    const held = await acquireReviewsLock(dir);
    try {
      await expect(dryRunCompaction(dir, VIEWS)).resolves.toMatchObject({ liveText: `${KEPT}\n` });
    } finally {
      await held.release();
    }

    // Positive control: the same fixture is not a no-op under apply.
    const liveBefore = await sha(reviewsFile(dir));
    await applyCompaction(dir, VIEWS);
    expect(await sha(reviewsFile(dir))).not.toBe(liveBefore);
  });

  it("C8 an apply with nothing to remove writes nothing and creates no backup", async () => {
    await seed(`${KEPT}\n`);
    const before = await snapshot(dir);
    const outcome = await applyCompaction(dir, VIEWS);
    expect(outcome.wrote).toBe(false);
    expect(await snapshot(dir)).toEqual(before);
  });

  it("C8b an apply against a store directory that does not exist creates nothing", async () => {
    // Rule 17: `orca compact-reviews --apply` on a machine with no ~/.orca must
    // not be the thing that creates one.
    const absent = join(dir, "absent");
    const outcome = await applyCompaction(absent, VIEWS);
    expect(outcome.wrote).toBe(false);
    await expect(stat(absent)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("C9 the backup holds the original bytes, not the compacted ones", async () => {
    await seed();
    await applyCompaction(dir, VIEWS);
    expect(await readFile(reviewsBackupFile(dir), "utf8")).toBe(FIXTURE);
  });

  it("C10 appends an orphan once even when an earlier run already archived it", async () => {
    // The crash between the archive append and the rename leaves the orphan in
    // both files; the re-run must not archive it twice. The not-pre-seeded
    // half of this pair is C2.
    await seed();
    await writeFile(reviewsArchiveFile(dir), `${ORPHAN}\n`);
    await applyCompaction(dir, VIEWS);
    expect(await readFile(reviewsArchiveFile(dir), "utf8")).toBe(`${ORPHAN}\n`);
  });

  it("C11 keeps the live file's own mode, creates the archive and backup 0600, and leaves an existing backup's mode alone", async () => {
    await seed(FIXTURE, 0o644);
    await applyCompaction(dir, VIEWS);
    // Literals, not the constants a mutation would edit on both sides.
    expect((await stat(reviewsFile(dir))).mode & 0o777).toBe(0o644);
    expect((await stat(reviewsArchiveFile(dir))).mode & 0o777).toBe(0o600);
    expect((await stat(reviewsBackupFile(dir))).mode & 0o777).toBe(0o600);

    await seed(FIXTURE, 0o644);
    await chmod(reviewsBackupFile(dir), 0o640);
    await applyCompaction(dir, VIEWS);
    expect((await stat(reviewsBackupFile(dir))).mode & 0o777).toBe(0o640);
  });

  it("C11b refuses by name to replace a symlinked reviews.jsonl, and leaves the link and its target alone", async () => {
    const target = join(dir, "real-reviews.jsonl");
    await writeFile(target, FIXTURE);
    await symlink(target, reviewsFile(dir));
    await expect(applyCompaction(dir, VIEWS)).rejects.toMatchObject({ code: "reviews-store-is-symlink", exitCode: 1 });
    expect((await lstat(reviewsFile(dir))).isSymbolicLink()).toBe(true);
    expect(await readFile(target, "utf8")).toBe(FIXTURE);
    await expect(stat(reviewsBackupFile(dir))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(reviewsLockDir(dir))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("C12 refuses by name while the lock is held and touches nothing", async () => {
    await seed();
    const before = await snapshot(dir);
    const held = await acquireReviewsLock(dir);
    try {
      await expect(applyCompaction(dir, VIEWS)).rejects.toMatchObject({ code: "reviews-store-busy", exitCode: 5 });
    } finally {
      await held.release();
    }
    expect(await snapshot(dir)).toEqual(before);
  });

  it("C13 a failed archive write leaves reviews.jsonl byte for byte as it was and releases the lock", async () => {
    await seed();
    const liveBefore = await sha(reviewsFile(dir));
    await expect(
      applyCompaction(dir, VIEWS, {
        beforeArchiveAppend: async () => {
          throw new Error("simulated archive failure");
        },
      }),
    ).rejects.toThrow("simulated archive failure");
    expect(await sha(reviewsFile(dir))).toBe(liveBefore);
    await expect(stat(reviewsLockDir(dir))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("C14 keeps a row a running panel appended just before the lock was taken", async () => {
    await seed();
    const late: ReviewRow = {
      decisionId: "orca-dev-1/2",
      projectKey: PK,
      action: "reviewed",
      by: "amy",
      at: "2026-09-13T00:00:00.000Z",
    };
    await applyCompaction(dir, VIEWS, {
      // A REAL append through the panel's writer, taking the real lock: the
      // lock is free at this point, so this is the window a read outside the
      // lock would lose.
      beforeLock: async () => {
        const writer = new ReviewsWriter(dir);
        await writer.load();
        expect(await writer.append(late)).toBe("written");
      },
    });
    expect(await readFile(reviewsFile(dir), "utf8")).toBe(`${KEPT}\n${JSON.stringify(late)}\n`);
  });
});
