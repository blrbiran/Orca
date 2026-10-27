/**
 * Live transcript spec §10.4.1 / §10.6.3: where a transcript's bytes come from. Every read is a ranged read through a
 * `RangeReader` (T1 counts bytes through an injected one); the server never loads a whole transcript.
 *
 * - The run directory: the listing's path resolves under `<sourceDir>/run/`, every component is `lstat`-checked as a
 *   real directory (never a symlink), and the file is opened `O_NOFOLLOW` and `fstat`-checked as a regular file.
 * - The archive (after cleanup): the artifact's `data` file under `$ORCA_CONTROL_DIR/artifacts/<id>/`, opened the same
 *   way. Its hash is checked once by a streaming pass, cached by `(dev, ino)`; never through `readArtifact`, which reads
 *   the whole file into memory (`archive.ts`).
 */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { TranscriptRefusal } from "./refusal.js";

export interface RangeReader {
  /** The byte size observed when the source was opened. */
  readonly size: number;
  /** When `into` is at least `length` bytes, the bytes are read into it and a view of it is returned (no allocation). */
  read(position: number, length: number, into?: Buffer): Promise<Buffer>;
}

/**
 * Streaming passes take one buffer and reuse it for every chunk (spec §6.5: peak memory while serving a 512 MiB
 * transcript stays under 64 MiB; a fresh buffer per chunk leaves tens of MiB of external memory waiting for GC).
 * A caller must be done with a taken buffer before it awaits anything that takes another one.
 */
const freeScratch: Buffer[] = [];
const SCRATCH_BUFFERS = 4;
const SCRATCH_LIMIT = 4 * 1024 * 1024;

/** A buffer of at least `length` bytes; pass it back with `giveScratch` (never a subarray of it, or the pool shrinks). */
export function takeScratch(length: number): Buffer {
  if (length <= 0) return Buffer.alloc(0);
  const at = freeScratch.findIndex((buffer) => buffer.length >= length);
  return at === -1 ? Buffer.allocUnsafe(length) : freeScratch.splice(at, 1)[0]!;
}

export function giveScratch(buffer: Buffer): void {
  if (buffer.length > 0 && buffer.length < SCRATCH_LIMIT && freeScratch.length < SCRATCH_BUFFERS) freeScratch.push(buffer);
}

export interface OpenSource { reader: RangeReader; key: string; close(): Promise<void> }

/** ccloop's listing path shape (ccloop `src/control/transcripts.ts`): `<kind>/<attempt>/<phase>/call-<id>/transcript.jsonl`. */
export const LISTING_PATH = /^(claude|codex|omp)\/([1-9][0-9]{0,8})\/([a-z][a-z-]{0,31})\/(call-[A-Za-z0-9]{1,64})\/transcript\.jsonl$/;

function handleReader(handle: FileHandle, size: number): RangeReader {
  return {
    size,
    async read(position, length, into) {
      const wanted = Math.max(0, Math.min(length, size - position));
      const buffer = into !== undefined && into.length >= wanted ? into.subarray(0, wanted) : Buffer.allocUnsafe(wanted);
      let done = 0;
      while (done < buffer.length) {
        const { bytesRead } = await handle.read(buffer, done, buffer.length - done, position + done);
        if (bytesRead === 0) break;
        done += bytesRead;
      }
      return done === buffer.length ? buffer : buffer.subarray(0, done);
    },
  };
}

async function openRegular(path: string): Promise<{ handle: FileHandle; dev: number; ino: number; size: number }> {
  let handle: FileHandle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ELOOP" || code === "EMLINK") throw new TranscriptRefusal("transcript-path-invalid", "symlink");
    throw error;
  }
  const stat = await handle.stat();
  if (!stat.isFile()) { await handle.close(); throw new TranscriptRefusal("transcript-path-invalid", "not-regular"); }
  return { handle, dev: stat.dev, ino: stat.ino, size: stat.size };
}

/**
 * The call directory of a listing path under `<sourceDir>/run/`, every component `lstat`-checked as a real directory
 * (never a symlink). Everything that touches a listed call's files goes through it (review 7753e97d: the listing's live
 * size and the `final` check once joined the path and followed a symlinked directory).
 */
export async function callDirOf(sourceDir: string, listingPath: string): Promise<string> {
  if (!LISTING_PATH.test(listingPath)) throw new TranscriptRefusal("transcript-path-invalid", "shape");
  let current = sourceDir;
  for (const part of ["run", ...listingPath.split("/").slice(0, -1)]) {
    current = join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new TranscriptRefusal("transcript-path-invalid", "component");
  }
  return current;
}

/**
 * Open a listed transcript under the run directory. ENOENT anywhere is rethrown as is (the caller falls back to the
 * archive); a symlink or a non-directory component is `transcript-path-invalid` (never followed, never a fallback).
 */
export async function openRunTranscript(sourceDir: string, listingPath: string): Promise<OpenSource> {
  const file = await openRegular(join(await callDirOf(sourceDir, listingPath), "transcript.jsonl"));
  return { reader: handleReader(file.handle, file.size), key: `${file.dev}:${file.ino}`, close: () => file.handle.close() };
}

const verifiedArchives = new Map<string, string>();

/** Open an archived transcript: one streaming hash check per `(dev, ino)`, then ranged reads. */
export async function openArchiveTranscript(stateDir: string, ref: { artifactId: string; hash: string }): Promise<OpenSource> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(ref.artifactId)) throw new TranscriptRefusal("transcript-path-invalid", "artifact");
  for (const dir of [join(stateDir, "artifacts"), join(stateDir, "artifacts", ref.artifactId)]) {
    const stat = await lstat(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new TranscriptRefusal("transcript-path-invalid", "artifact");
  }
  const file = await openRegular(join(stateDir, "artifacts", ref.artifactId, "data"));
  const key = `${file.dev}:${file.ino}`;
  const reader = handleReader(file.handle, file.size);
  if (verifiedArchives.get(key) !== ref.hash) {
    const hash = createHash("sha256");
    const scratch = takeScratch(Math.min(1024 * 1024, file.size));
    try {
      for (let pos = 0; pos < file.size;) {
        const chunk = await reader.read(pos, scratch.length, scratch);
        if (chunk.length === 0) break;
        hash.update(chunk);
        pos += chunk.length;
      }
    } finally {
      giveScratch(scratch);
    }
    if (hash.digest("hex") !== ref.hash) { await file.handle.close(); throw new TranscriptRefusal("transcript-archive-invalid", "hash"); }
    if (verifiedArchives.size >= 64) verifiedArchives.delete(verifiedArchives.keys().next().value!);
    verifiedArchives.set(key, ref.hash);
  }
  return { reader, key: `archive:${key}`, close: () => file.handle.close() };
}
