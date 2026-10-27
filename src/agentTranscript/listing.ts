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
import { callDirOf, LISTING_PATH, openArchiveTranscript, openRunTranscript, type OpenSource } from "./reader.js";
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

type ArtifactRef = { artifactId: string; hash: string };
/**
 * Review 7753e97d: archived refs per store, keyed by run and path, valid while the run's newest archive row is the same.
 * Archive rows and artifacts are content-addressed and never rewritten, so only a new archive can change the answer.
 */
const archivedRefs = new WeakMap<ControlStore, Map<string, { newest: number; ref: ArtifactRef | null }>>();
const ARCHIVED_REFS = 256;

/** The archive manifest's ref for `<sourceDir>/run/<path>`, from the run's newest archive (archive.ts archiveRun). */
async function archivedRef(store: ControlStore, runId: string, path: string): Promise<ArtifactRef | null> {
  const mineOnly = "FROM outbox WHERE kind='archive' AND json_valid(body) AND json_extract(body,'$.runId')=?";
  const newest = Number(store.db.prepare(`SELECT coalesce(max(rowid), 0) AS n ${mineOnly}`).get(runId)!.n);
  let cache = archivedRefs.get(store);
  if (cache === undefined) archivedRefs.set(store, cache = new Map());
  const key = `${runId}\0${path}`;
  const known = cache.get(key);
  if (known !== undefined && known.newest === newest) return known.ref;
  const ref = await manifestRef(store, runId, path, mineOnly);
  cache.delete(key);
  cache.set(key, { newest, ref });
  if (cache.size > ARCHIVED_REFS) cache.delete(cache.keys().next().value!);
  return ref;
}

async function manifestRef(store: ControlStore, runId: string, path: string, mineOnly: string): Promise<ArtifactRef | null> {
  const mine = store.db.prepare(`SELECT body ${mineOnly} ORDER BY rowid`).all(runId).map((row) => JSON.parse(String(row.body)) as { artifacts?: ArtifactRef[] });
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
  const stat = await callFile(listing, entry.path, "transcript.jsonl");
  return stat?.isFile() ? stat.size : entry.bytes;
}

/** `final` from the driver's last collect, or the call's outcome.json appearing (§10.4.3), or an archived source. */
export async function finalNow(listing: StoredListing, entry: TranscriptEntry, source: "run" | "archive"): Promise<boolean> {
  if (entry.final || source === "archive" || entry.path === null) return true;
  return (await callFile(listing, entry.path, "outcome.json"))?.isFile() === true;
}

/** The `lstat` of a file in a listed call's directory, reached by the component walk; null when it is not there. */
const callFile = async (listing: StoredListing, path: string, name: string) =>
  callDirOf(listing.sourceDir, path).then((dir) => lstat(join(dir, name))).catch(() => null);
