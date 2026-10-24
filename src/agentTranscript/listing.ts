/**
 * Live transcript spec §10.4.1 "Source" / §12.3 "Listing source": Orca keeps the last `transcripts` listing ccloop's
 * `collect` answered for each run, on the run's body in the control store (an existing path; plan D1), for every run it
 * collects -- flow children, plain groups, single calls and estimates alike. Paths come only from this listing (or the
 * archive manifest after cleanup); the browser never sees one.
 *
 * Plan D1: the body is rewritten only when an entry changed other than the `bytes` of a non-final entry, so a live call's
 * growth does not move the group's projection every collect; the listing route reads such an entry's size by `fstat`.
 */
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { readRun, saveRun } from "../control/budget.js";
import type { TranscriptEntry } from "../control/schema.js";
import type { ControlStore } from "../control/store.js";
import { readArtifact } from "../control/archive.js";
import { LISTING_PATH, openArchiveTranscript, openRunTranscript, type OpenSource } from "./reader.js";
import { TranscriptRefusal } from "./refusal.js";
import type { Runtime } from "./normalize.js";

export interface StoredListing { sourceDir: string; entries: TranscriptEntry[] }

const comparable = (entries: readonly TranscriptEntry[]): string =>
  JSON.stringify(entries.map((entry) => (entry.final ? entry : { ...entry, bytes: null })));

export function storedListing(store: ControlStore, runId: string): StoredListing | null {
  const listing = (readRun(store, runId) as unknown as { transcripts?: StoredListing }).transcripts;
  return listing === undefined ? null : listing;
}

/** Called inside the transaction that books a collect: keep the listing ccloop answered (absent: nothing to keep). */
export function noteTranscriptListing(store: ControlStore, runId: string, sourceDir: string, entries: readonly TranscriptEntry[] | undefined): void {
  if (entries === undefined) return;
  const run = readRun(store, runId) as unknown as Record<string, unknown> & { transcripts?: StoredListing };
  const before = run.transcripts;
  if (before !== undefined && before.sourceDir === sourceDir && comparable(before.entries) === comparable(entries)) return;
  run.transcripts = { sourceDir, entries: [...entries] };
  saveRun(store, run as never);
}

/** One listing row as the browser gets it (§12.3): no `path`; the runtime and whether a transcript was recorded. */
export interface ListingRow { attempt: number; phase: string; seq: number; runtime: Runtime | null; recorded: boolean; bytes: number; final: boolean; truncatedAt: number | null }

export const runtimeOf = (entry: TranscriptEntry): Runtime | null => (entry.path === null ? null : (LISTING_PATH.exec(entry.path)?.[1] as Runtime | undefined) ?? null);

export function findEntry(listing: StoredListing, attempt: number, phase: string, seq: number): TranscriptEntry {
  const found = listing.entries.filter((entry) => entry.attempt === attempt && entry.phase === phase && entry.seq === seq);
  if (found.length === 0) throw new TranscriptRefusal("transcript-not-found");
  if (found.length > 1) throw new TranscriptRefusal("transcript-ambiguous");
  return found[0]!;
}

/** The archive manifest's ref for `<sourceDir>/run/<path>`, from the run's newest archive (archive.ts archiveRun). */
async function archivedRef(store: ControlStore, runId: string, path: string): Promise<{ artifactId: string; hash: string } | null> {
  const rows = store.db.prepare("SELECT body FROM outbox WHERE kind='archive'").all().map((row) => JSON.parse(String(row.body)) as { runId?: string; artifacts?: Array<{ artifactId: string; hash: string }> });
  const mine = rows.filter((row) => row.runId === runId);
  for (const row of mine.reverse()) {
    const manifestRef = row.artifacts?.find((ref) => ref.artifactId.startsWith("archive-"));
    if (manifestRef === undefined) continue;
    const manifest = JSON.parse((await readArtifact(store, manifestRef)).toString("utf8")) as { logs?: Array<{ path: string; kind: string; ref?: { artifactId: string; hash: string } }> };
    const entry = manifest.logs?.find((log) => log.kind === "file" && log.path === `run/${path}`);
    if (entry?.ref !== undefined) return entry.ref;
  }
  return null;
}

export interface ResolvedSource { open: OpenSource; source: "run" | "archive" }

/**
 * §10.4.1: the run directory while the file exists, the archive after cleanup (a file gone between polls switches on the
 * next request), `transcript-gone` with neither. A symlink or a bad component is refused, never a fallback.
 */
export async function openEntry(store: ControlStore, runId: string, listing: StoredListing, entry: TranscriptEntry): Promise<ResolvedSource> {
  if (entry.path === null) throw new TranscriptRefusal("transcript-not-found", "not recorded");
  if (!LISTING_PATH.test(entry.path)) throw new TranscriptRefusal("transcript-path-invalid", "shape");
  try { return { open: await openRunTranscript(listing.sourceDir, entry.path), source: "run" }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const ref = await archivedRef(store, runId, entry.path);
  if (ref === null) throw new TranscriptRefusal("transcript-gone");
  return { open: await openArchiveTranscript(store.stateDir, ref), source: "archive" };
}

/** A non-final row's size read now (D1); a stored size when the file is not there. */
export async function liveBytes(listing: StoredListing, entry: TranscriptEntry): Promise<number> {
  if (entry.final || entry.path === null || !LISTING_PATH.test(entry.path)) return entry.bytes;
  const stat = await lstat(join(listing.sourceDir, "run", entry.path)).catch(() => null);
  return stat?.isFile() ? stat.size : entry.bytes;
}
