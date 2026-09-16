// src/panel/compactReviews.ts
import { chmod, lstat, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import { classifyReviews } from "./compactClassify.js";
import type { Classification, LedgerView, LineKind } from "./compactClassify.js";
import {
  REVIEWS_FILE_MODE,
  reviewsArchiveFile,
  reviewsBackupFile,
  reviewsCompactTmpFile,
  reviewsFile,
} from "./paths.js";
import { acquireReviewsLock } from "./reviewsLock.js";
import { PanelRejection } from "./rejection.js";

export const REVIEWS_STORE_IS_SYMLINK = "reviews-store-is-symlink";

export interface CompactHooks {
  /** Test seam (spec C14): after the caller's unlocked work, before the lock is taken. */
  beforeLock?: () => Promise<void>;
  /** Test seam (spec C13): immediately before the archive append; a throw stands in for that write failing. */
  beforeArchiveAppend?: () => Promise<void>;
}

export interface CompactOutcome {
  classification: Classification;
  wrote: boolean;
}

export type CompactMode = "dry-run" | "applied" | "nothing-to-do";
export const DRY_RUN_LAST_LINE = "dry run; nothing was written. Pass --apply to write.";
export const APPLIED_LAST_LINE =
  "written; a running orca panel picks this up on its next duplicate check, no restart needed";
export const NOTHING_TO_DO_LAST_LINE = "nothing to compact; no file was written";

const isEnoent = (err: unknown): boolean => (err as NodeJS.ErrnoException).code === "ENOENT";

async function readOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if (isEnoent(err)) return "";
    throw err;
  }
}

/** Created with an explicit 0600 when absent; an existing file keeps its mode (Rule 17). */
async function ensureFile(path: string): Promise<void> {
  try {
    await writeFile(path, "", { flag: "wx", mode: REVIEWS_FILE_MODE });
    await chmod(path, REVIEWS_FILE_MODE);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
}

async function writeSynced(path: string, flags: "a" | "w", data: string): Promise<void> {
  const handle = await open(path, flags);
  try {
    await handle.writeFile(data, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** spec section 3.2: reads without the lock and writes nothing. */
export async function dryRunCompaction(dir: string, views: ReadonlyMap<string, LedgerView>): Promise<Classification> {
  return classifyReviews(await readOrEmpty(reviewsFile(dir)), views);
}

/**
 * spec section 4.1. The order is load-bearing (section 4.2): the backup, then
 * the archive, then the rename -- so a crash at any point leaves an orphan in
 * at least one file that the next apply will not overwrite.
 */
export async function applyCompaction(
  dir: string,
  views: ReadonlyMap<string, LedgerView>,
  hooks: CompactHooks = {},
): Promise<CompactOutcome> {
  // Rule 17: never the command that creates the store directory. Taking the
  // lock would otherwise fail on a missing parent with a raw ENOENT.
  try {
    await stat(dir);
  } catch (err) {
    if (isEnoent(err)) return { classification: classifyReviews("", views), wrote: false };
    throw err;
  }

  await hooks.beforeLock?.();
  const lock = await acquireReviewsLock(dir);
  try {
    // Read INSIDE the lock: a row the panel appended before this point is in
    // `text`, and nothing can append between here and the rename.
    const live = reviewsFile(dir);
    const text = await readOrEmpty(live);
    const classification = classifyReviews(text, views);
    if (classification.counts.duplicate === 0 && classification.counts.orphan === 0) {
      return { classification, wrote: false };
    }
    if ((await lstat(live)).isSymbolicLink()) {
      throw new PanelRejection(
        REVIEWS_STORE_IS_SYMLINK,
        `${live} is a symbolic link. Compaction replaces the file by rename and would turn the link into a regular file; point ORCA_CORRECTIONS_DIR at the real directory instead.`,
        1,
      );
    }
    const liveMode = (await stat(live)).mode & 0o777;

    const backup = reviewsBackupFile(dir);
    await ensureFile(backup);
    await writeSynced(backup, "w", text);

    await hooks.beforeArchiveAppend?.();
    const archive = reviewsArchiveFile(dir);
    await ensureFile(archive);
    const archived = await readFile(archive, "utf8");
    const already = new Set(archived.split("\n"));
    const fresh = classification.orphanLines.filter((line) => !already.has(line));
    if (fresh.length > 0) {
      // A torn tail from an earlier crash would swallow the first new line.
      const separator = archived.length > 0 && !archived.endsWith("\n") ? "\n" : "";
      await writeSynced(archive, "a", separator + fresh.map((line) => `${line}\n`).join(""));
    }

    // rename gives reviews.jsonl a new inode; the chmod keeps the person's
    // mode on it instead of quietly replacing that mode with ours.
    const tmp = reviewsCompactTmpFile(dir);
    await ensureFile(tmp);
    await writeSynced(tmp, "w", classification.liveText);
    await chmod(tmp, liveMode);
    await rename(tmp, live);
    return { classification, wrote: true };
  } finally {
    await lock.release();
  }
}

const KIND_ORDER: readonly LineKind[] = ["kept", "duplicate", "orphan", "unreadable", "not-judged"];

export function renderCompactionReport(classification: Classification, mode: CompactMode, file: string): string {
  const out = [`orca compact-reviews: ${file}`];
  for (const kind of KIND_ORDER) out.push(`  ${kind.padEnd(11)} ${classification.counts[kind]}`);

  // Derived by parsing the orphan line's own text, not the LineClass type: the
  // classifier only calls a line an orphan after it parsed with string
  // projectKey/decisionId fields, so this is always readable.
  const orphans: string[] = [];
  for (const { text, cls } of classification.lines) {
    if (cls.kind !== "orphan") continue;
    const row = JSON.parse(text) as { projectKey: string; decisionId: string };
    const label = `  ${row.projectKey} ${row.decisionId}`;
    if (!orphans.includes(label)) orphans.push(label);
  }
  if (orphans.length > 0) out.push("orphans:", ...orphans);

  const labels: string[] = [];
  for (const { cls } of classification.lines) {
    if (cls.kind !== "not-judged") continue;
    const label =
      cls.reason === "decision-not-found"
        ? `  ${cls.reason} ${cls.projectKey} ${cls.decisionId}`
        : `  ${cls.reason} ${cls.projectKey}`;
    if (!labels.includes(label)) labels.push(label);
  }
  if (labels.length > 0) out.push("not judged:", ...labels);

  out.push(mode === "applied" ? APPLIED_LAST_LINE : mode === "nothing-to-do" ? NOTHING_TO_DO_LAST_LINE : DRY_RUN_LAST_LINE);
  return `${out.join("\n")}\n`;
}
