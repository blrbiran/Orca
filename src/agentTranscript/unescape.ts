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

export interface StreamDecoder { feed(bytes: Buffer): string; end(): string; state(): DecoderState }

export function createDecoder(from: DecoderState = initialDecoderState()): StreamDecoder {
  let { inString, escape, hex } = from;
  let pending = Buffer.from(from.pending);
  const special = /["\\]/g;
  const unescape = (chunk: string): string => {
    const parts: string[] = [];
    let i = 0;
    while (i < chunk.length) {
      if (hex !== null) {
        const need = 4 - hex.length;
        hex += chunk.slice(i, i + need);
        i += need;
        if (hex.length === 4) { parts.push(String.fromCharCode(parseInt(hex, 16))); hex = null; }
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
    return parts.join("");
  };
  return {
    feed(bytes) {
      const all = pending.length > 0 ? Buffer.concat([pending, bytes]) : bytes;
      const tail = incompleteTail(all);
      pending = Buffer.from(all.subarray(all.length - tail));
      return unescape(all.subarray(0, all.length - tail).toString("utf8"));
    },
    end() {
      const rest = pending.length > 0 ? unescape(pending.toString("utf8")) : "";
      pending = Buffer.alloc(0);
      return rest;
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
