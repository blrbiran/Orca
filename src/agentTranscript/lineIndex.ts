/**
 * Live transcript spec §6.1 as amended by §10.4.1: a sparse line index per transcript, built by one streaming pass and
 * kept in memory only (no new path).
 *
 * - Cache key: the file's `(dev, ino)` (an archive source's own key). One LRU of at most 8 per panel process, shared by
 *   every viewer.
 * - Growth is a larger size with the first indexed bytes unchanged (their hash is kept): the index extends from its last
 *   complete line. A shrink or a changed head (at any size, the same one included) means a rebuild; a new inode is a new
 *   key.
 * - A checkpoint falls every 256 lines or every 1 MiB, whichever comes first. A line over 1 MiB (never parsed, §10.4.2)
 *   is kept in `long`, so a window reads only its scanned prefix.
 * - A trailing partial line (no `\n` yet) is never indexed or served.
 */
import { createHash } from "node:crypto";
import { giveScratch, takeScratch, type RangeReader } from "./reader.js";
import { PARSE_LIMIT } from "./normalize.js";
import type { DecoderState } from "./unescape.js";

export const STRIDE_LINES = 256;
export const STRIDE_BYTES = 1024 * 1024;
/** The head whose hash identifies a growing file (read again only when the size changed). */
export const HEAD_CHECK_BYTES = 4096;
export const INDEX_CACHE_SIZE = 8;
/** A read chunk one byte over the parse limit, so a chunk of ordinary lines always holds a `\n`. */
const CHUNK = PARSE_LIMIT + 1;

export interface Checkpoint { offset: number; line: number }
export interface LongLine { start: number; end: number }
/** C6 / review N1: an oversized line's decoder checkpoints, one per 1 MiB raw stride (plan D4: built on first expand). */
export interface DecodedCheckpoint { raw: number; dec: number; state: DecoderState }
export interface OversizedIndex { checkpoints: DecodedCheckpoint[]; length: number }

export interface LineIndex {
  key: string;
  /** The size the index last observed. */
  size: number;
  /** The offset after the last complete line: everything before it is indexed, nothing after it is served. */
  end: number;
  lines: number;
  headLength: number;
  headHash: string;
  checkpoints: Checkpoint[];
  long: LongLine[];
  /** Lines and bytes since the last checkpoint, so growth extends with the same stride. */
  sinceLines: number;
  sinceBytes: number;
  oversized: Map<number, OversizedIndex>;
}

const headDigest = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/** Index [index.end, reader.size): one pass, appending checkpoints and long lines. */
async function extend(index: LineIndex, reader: RangeReader): Promise<void> {
  let lineStart = index.end;
  let pos = index.end;
  const scratch = takeScratch(Math.min(CHUNK, reader.size - index.end));
  try {
    while (pos < reader.size) {
      const bytes = await reader.read(pos, Math.min(CHUNK, reader.size - pos), scratch);
      if (bytes.length === 0) break;
      let from = 0;
      for (;;) {
        const nl = bytes.indexOf(10, from);
        if (nl === -1) break;
        const lineEnd = pos + nl;
        const length = lineEnd - lineStart;
        if (length > PARSE_LIMIT) index.long.push({ start: lineStart, end: lineEnd });
        index.lines += 1;
        index.sinceLines += 1;
        index.sinceBytes += length + 1;
        lineStart = lineEnd + 1;
        index.end = lineStart;
        if (index.sinceLines >= STRIDE_LINES || index.sinceBytes >= STRIDE_BYTES) {
          index.checkpoints.push({ offset: lineStart, line: index.lines });
          index.sinceLines = 0;
          index.sinceBytes = 0;
        }
        from = nl + 1;
      }
      pos += bytes.length;
    }
  } finally {
    giveScratch(scratch);
  }
  index.size = reader.size;
}

async function build(key: string, reader: RangeReader): Promise<LineIndex> {
  const headLength = Math.min(HEAD_CHECK_BYTES, reader.size);
  const index: LineIndex = {
    key, size: 0, end: 0, lines: 0, headLength, headHash: headDigest(await reader.read(0, headLength)),
    checkpoints: [{ offset: 0, line: 0 }], long: [], sinceLines: 0, sinceBytes: 0, oversized: new Map(),
  };
  await extend(index, reader);
  return index;
}

export interface IndexCache {
  /** The index of this source, built, extended or rebuilt as its size and head say. */
  get(key: string, reader: RangeReader): Promise<LineIndex>;
  has(key: string): boolean;
  readonly size: number;
}

export function createIndexCache(capacity = INDEX_CACHE_SIZE): IndexCache {
  const entries = new Map<string, LineIndex>();
  const remember = (index: LineIndex): LineIndex => {
    entries.delete(index.key);
    entries.set(index.key, index);
    while (entries.size > capacity) entries.delete(entries.keys().next().value!);
    return index;
  };
  const refresh = async (key: string, reader: RangeReader): Promise<LineIndex> => {
    const known = entries.get(key);
    if (known === undefined) return remember(await build(key, reader));
    if (reader.size < known.size) return remember(await build(key, reader));
    // Growth, or the same size: the head that was indexed must be unchanged (review 7753e97d: a file rewritten in place to
    // the same size keeps its inode); then only the bytes after the last complete line are read.
    if (headDigest(await reader.read(0, known.headLength)) !== known.headHash) return remember(await build(key, reader));
    if (reader.size === known.size) return remember(known);
    if (known.headLength < HEAD_CHECK_BYTES && reader.size > known.headLength) {
      known.headLength = Math.min(HEAD_CHECK_BYTES, reader.size);
      known.headHash = headDigest(await reader.read(0, known.headLength));
    }
    await extend(known, reader);
    return remember(known);
  };
  // Review 7753e97d: one request per key at a time. Two growth requests at once both extended the same cached index from
  // the same `end`, appending its lines and checkpoints twice; the second now runs after the first and finds it current.
  const inFlight = new Map<string, Promise<LineIndex>>();
  return {
    async get(key, reader) {
      const run = (inFlight.get(key) ?? Promise.resolve()).catch(() => undefined).then(() => refresh(key, reader));
      inFlight.set(key, run);
      try { return await run; } finally { if (inFlight.get(key) === run) inFlight.delete(key); }
    },
    has: (key) => entries.has(key),
    get size() { return entries.size; },
  };
}

/** The panel's one index cache (§10.4.1: one LRU of at most 8 per panel process). */
export const panelIndexCache = createIndexCache();

/** The long line starting at `offset`, if any. */
export const longLineAt = (index: LineIndex, offset: number): LongLine | undefined => index.long.find((line) => line.start === offset);
