/**
 * Live transcript spec §12.4 C6 (review N1): the streaming UTF-8 decoder plus JSON-string unescaper that turns an
 * oversized line (or an unparsable one) into decoded text, so redaction never runs on raw JSON. Its state is exposed so a
 * page can resume from a checkpoint: {inString, escape pending, pending `\u` digits, pending UTF-8 bytes} -- at most 4 hex
 * digits and 3 bytes per checkpoint. JSON structure characters are kept; string contents are unescaped.
 */
export interface DecoderState { inString: boolean; escape: boolean; hex: string | null; pending: Buffer }

export const initialDecoderState = (): DecoderState => ({ inString: false, escape: false, hex: null, pending: Buffer.alloc(0) });

/** The bytes at the end of `bytes` that start a UTF-8 sequence not yet complete (0-3). */
function incompleteTail(bytes: Buffer): number {
  for (let k = 1; k <= Math.min(3, bytes.length); k++) {
    const c = bytes[bytes.length - k]!;
    if ((c & 0xc0) === 0x80) continue;
    const need = c >= 0xf0 ? 4 : c >= 0xe0 ? 3 : c >= 0xc0 ? 2 : 1;
    return need > k ? k : 0;
  }
  return 0;
}

const SIMPLE: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", '"': '"', "/": "/", "\\": "\\" };

const EMPTY = Buffer.alloc(0);

/** The full byte length of the sequence a byte starts (1 for an ASCII byte or a stray continuation). */
function expectedLength(first: number): number {
  return first >= 0xf0 ? 4 : first >= 0xe0 ? 3 : first >= 0xc0 ? 2 : 1;
}

/** One UTF-8 sequence as `Buffer.toString` decodes it: units in UTF-16, bytes consumed (a maximal subpart on error). */
function sequenceAt(bytes: Buffer, i: number): { units: number; size: number } {
  const b = bytes[i]!;
  if (b < 0x80) return { units: 1, size: 1 };
  const cont = (k: number, lo = 0x80, hi = 0xbf): boolean => {
    const c = bytes[i + k];
    return c !== undefined && c >= lo && c <= hi;
  };
  if (b >= 0xc2 && b <= 0xdf) return cont(1) ? { units: 1, size: 2 } : { units: 1, size: 1 };
  if (b >= 0xe0 && b <= 0xef) {
    if (!cont(1, b === 0xe0 ? 0xa0 : 0x80, b === 0xed ? 0x9f : 0xbf)) return { units: 1, size: 1 };
    return cont(2) ? { units: 1, size: 3 } : { units: 1, size: 2 };
  }
  if (b >= 0xf0 && b <= 0xf4) {
    if (!cont(1, b === 0xf0 ? 0x90 : 0x80, b === 0xf4 ? 0x8f : 0xbf)) return { units: 1, size: 1 };
    if (!cont(2)) return { units: 1, size: 2 };
    return cont(3) ? { units: 2, size: 4 } : { units: 1, size: 3 };
  }
  return { units: 1, size: 1 };
}

export interface StreamDecoder {
  feed(bytes: Buffer): string;
  /** The code-unit count of what `feed` would return, without building the strings (§6.5: skipping a stride). */
  feedCount(bytes: Buffer): number;
  end(): string;
  endCount(): number;
  state(): DecoderState;
}

export function createDecoder(from: DecoderState = initialDecoderState()): StreamDecoder {
  let { inString, escape, hex } = from;
  let pending = Buffer.from(from.pending);
  const special = /["\\]/g;
  /** One pass over decoded text, appending the unescaped result. */
  const walk = (chunk: string, parts: string[]): void => {
    let i = 0;
    while (i < chunk.length) {
      if (hex !== null) {
        const need = 4 - hex.length;
        hex += chunk.slice(i, i + need);
        i += need;
        if (hex.length === 4) {
          parts.push(String.fromCharCode(parseInt(hex, 16)));
          hex = null;
        }
        continue;
      }
      if (escape) {
        const ch = chunk[i++]!;
        escape = false;
        if (ch === "u") hex = "";
        else parts.push(SIMPLE[ch] ?? ch);
        continue;
      }
      special.lastIndex = i;
      const m = special.exec(chunk);
      const k = m === null ? chunk.length : m.index;
      if (k > i) parts.push(chunk.slice(i, k));
      if (m === null) break;
      if (m[0] === "\\" && inString) escape = true;
      else { if (m[0] === '"') inString = !inString; parts.push(m[0]); }
      i = k + 1;
    }
  };
  /** The head (at most 4 bytes) that completes a sequence held in `pending`; reused for every read. */
  const head = Buffer.allocUnsafe(8);
  /**
   * Split `bytes` into the completion of the sequence `pending` holds (decoded together with it) and the rest minus an
   * incomplete tail, which becomes the new `pending`. Copying at most 4 bytes into `head` instead of concatenating whole
   * reads keeps tens of MiB of external memory from waiting for a major GC (§6.5).
   */
  const split = (bytes: Buffer): { headBytes: number; body: Buffer } => {
    let rest = bytes;
    let headBytes = 0;
    if (pending.length > 0) {
      const need = expectedLength(pending[0]!) - pending.length;
      const take = Math.min(need, rest.length);
      headBytes = pending.length + take;
      pending.copy(head, 0);
      rest.copy(head, pending.length, 0, take);
      rest = rest.subarray(take);
      if (take < need) { pending = Buffer.from(head.subarray(0, headBytes)); return { headBytes: -1, body: EMPTY }; }
      pending = EMPTY;
    }
    const tail = incompleteTail(rest);
    pending = tail > 0 ? Buffer.from(rest.subarray(rest.length - tail)) : EMPTY;
    return { headBytes, body: rest.subarray(0, rest.length - tail) };
  };
  /** `walk` over bytes: the same state changes and the same code-unit count, without building strings. */
  const countBytes = (bytes: Buffer): number => {
    let units = 0;
    let i = 0;
    const n = bytes.length;
    while (i < n) {
      if (hex !== null) {
        const from = i;
        let taken = 0;
        while (hex.length + taken < 4 && i < n) {
          const { units: u, size } = sequenceAt(bytes, i);
          taken += Math.min(u, 4 - hex.length - taken);
          i += size;
        }
        if (taken > 0) hex += bytes.subarray(from, i).toString("utf8").slice(0, taken);
        if (hex.length === 4) { hex = null; units += 1; }
        continue;
      }
      const b = bytes[i]!;
      if (escape) {
        const { units: u, size } = sequenceAt(bytes, i);
        i += size;
        escape = false;
        if (b === 0x75 && size === 1) hex = "";
        else units += u;
        continue;
      }
      if (b === 0x22) { inString = !inString; units += 1; i += 1; continue; }
      if (b === 0x5c) { if (inString) escape = true; else units += 1; i += 1; continue; }
      if (b < 0x80) {
        // An ordinary ASCII run: one unit per byte, up to the next quote, backslash or multi-byte lead byte.
        let j = i + 1;
        while (j < n) { const c = bytes[j]!; if (c === 0x22 || c === 0x5c || c >= 0x80) break; j += 1; }
        units += j - i;
        i = j;
        continue;
      }
      if (b >= 0xc2 && b <= 0xdf) {
        const c1 = bytes[i + 1];
        if (c1 !== undefined && c1 >= 0x80 && c1 <= 0xbf) { units += 1; i += 2; } else { units += 1; i += 1; }
        continue;
      }
      if (b >= 0xe0 && b <= 0xef) {
        const c1 = bytes[i + 1];
        const ok1 = c1 !== undefined && c1 >= (b === 0xe0 ? 0xa0 : 0x80) && c1 <= (b === 0xed ? 0x9f : 0xbf);
        if (!ok1) { units += 1; i += 1; continue; }
        const c2 = bytes[i + 2];
        if (c2 !== undefined && c2 >= 0x80 && c2 <= 0xbf) { units += 1; i += 3; } else { units += 1; i += 2; }
        continue;
      }
      if (b >= 0xf0 && b <= 0xf4) {
        const c1 = bytes[i + 1];
        const ok1 = c1 !== undefined && c1 >= (b === 0xf0 ? 0x90 : 0x80) && c1 <= (b === 0xf4 ? 0x8f : 0xbf);
        if (!ok1) { units += 1; i += 1; continue; }
        const c2 = bytes[i + 2];
        if (c2 === undefined || c2 < 0x80 || c2 > 0xbf) { units += 1; i += 2; continue; }
        const c3 = bytes[i + 3];
        if (c3 !== undefined && c3 >= 0x80 && c3 <= 0xbf) { units += 2; i += 4; } else { units += 1; i += 3; }
        continue;
      }
      units += 1;
      i += 1;
    }
    return units;
  };
  return {
    feed(bytes) {
      const parts: string[] = [];
      const { headBytes, body } = split(bytes);
      if (headBytes < 0) return "";
      if (headBytes > 0) walk(head.toString("utf8", 0, headBytes), parts);
      if (body.length > 0) walk(body.toString("utf8"), parts);
      return parts.join("");
    },
    feedCount(bytes) {
      const { headBytes, body } = split(bytes);
      if (headBytes < 0) return 0;
      return (headBytes > 0 ? countBytes(head.subarray(0, headBytes)) : 0) + (body.length > 0 ? countBytes(body) : 0);
    },
    end() {
      const rest = pending;
      pending = Buffer.alloc(0);
      const parts: string[] = [];
      if (rest.length > 0) walk(rest.toString("utf8"), parts);
      return parts.join("");
    },
    endCount() {
      const rest = pending;
      pending = Buffer.alloc(0);
      return rest.length > 0 ? countBytes(rest) : 0;
    },
    state: () => ({ inString, escape, hex, pending: Buffer.from(pending) }),
  };
}

/** Decode a whole (bounded) buffer. */
export function decodeAll(bytes: Buffer): string {
  const decoder = createDecoder();
  return decoder.feed(bytes) + decoder.end();
}

/** C6 (review N6): the notice's `type` is copied only when it matches this allow-list; otherwise it is omitted. */
export const NOTICE_TYPE = /^[A-Za-z0-9_./-]{1,64}$/;

/** The `type` value scanned from an oversized line's first 4 KiB (a bounded scan; never a parse of the line). */
export function scanType(prefix: Buffer): string | undefined {
  const text = decodeAll(prefix);
  const match = /"type"\s*:\s*"([^"]{0,200})"/.exec(text);
  const value = match?.[1];
  return value !== undefined && NOTICE_TYPE.test(value) ? value : undefined;
}
