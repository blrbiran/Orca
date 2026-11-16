/**
 * Live transcript spec §6.1-§6.2 / §10.4.1-§10.4.2 / §12.4 C2, C3, C6: windows, follow reads and expand pages.
 *
 * - A window is at most 200 events AND at most 4 MiB of bytes read (C2). The byte count includes lines read but not
 *   served (deltas, omitted `thinking`); an oversized line counts as its scanned 4 KiB prefix; the first line is always
 *   served; a window stopped by a bound returns its continuation offset.
 * - A tail window walks back from the end checkpoint by checkpoint, so it reads at most the last stride plus its lines;
 *   a follow read (`after`) reads from its offset, re-reading the preceding source only when its marker arrives alone.
 * - Every served string passes redaction (`redact.ts`): heads of decoded fields by span (C3), composite values whole.
 * - Expanding a line of 1 MiB or less re-parses that line and pages the decoded field; an oversized line is paged as
 *   decoded text from its decoder checkpoints (C6, review N1).
 */
import type { RawEvent } from "./events.js";
import { longLineAt, STRIDE_BYTES, type LineIndex, type LongLine, type OversizedIndex } from "./lineIndex.js";
import { lineParser, normalizeLine, PARSE_LIMIT, type Runtime } from "./normalize.js";
import { giveScratch, takeScratch, type RangeReader } from "./reader.js";
import { edge, headOf, LOOK, PAGE, pageOf, redactFull, redactValue, render, slicePage, sliceHead, type FieldHead, type Page, type Redactor } from "./redact.js";
import { TranscriptRefusal } from "./refusal.js";
import { createDecoder, initialDecoderState, scanType, type StreamDecoder } from "./unescape.js";

export const WINDOW_EVENTS = 200;
export const WINDOW_BYTES = 4 * 1024 * 1024;
/** An oversized line is read only for its first 4 KiB (§10.4.2) and counts as that much toward the window (C2). */
export const PREFIX_BYTES = 4096;
const CHUNK = PARSE_LIMIT + 1;
/** The count-only reads (a checkpoint pass, the skipped text before a page): no strings, so large chunks cost no heap. */
const COUNT_CHUNK = 256 * 1024;
const META_LIMIT = 256;

export interface ServedEvent {
  /** The byte offset of the line the event came from, and its index among that line's events (the expand address). */
  at: number; i: number;
  /** ccloop's observation of this physical line, in epoch milliseconds; absent on legacy/unpaired lines. */
  ccloopObservedAt?: number;
  kind: RawEvent["kind"];
  meta?: Record<string, string>;
  num?: Record<string, number>;
  flag?: Record<string, boolean>;
  fields?: Record<string, FieldHead>;
}

export interface TranscriptWindow {
  events: ServedEvent[];
  /** The scanned lines are [start, end); a follow may also revise an earlier event when its marker arrives later. */
  start: number; end: number;
  /** The indexed size: nothing at or past it (a partial last line) was served. */
  indexedEnd: number;
  /** Bytes the window counted toward its 4 MiB (C2). */
  counted: number;
}

export interface WindowOptions {
  runtime: Runtime;
  redactor: Redactor;
  includeThinking?: boolean;
  /** Test seams only; the server always uses the defaults (§10.4.1 "enforced on the server"). */
  maxEvents?: number; maxBytes?: number;
}

type Line = { start: number; bytes: Buffer } | { start: number; long: LongLine; prefix: Buffer };

/** The lines in [from, to), both line starts at or before index.end, read chunk by chunk; long lines by prefix only. */
async function* linesIn(index: LineIndex, reader: RangeReader, from: number, to: number): AsyncGenerator<Line> {
  const longs = index.long.filter((line) => line.start >= from && line.start < to);
  let pos = from;
  // The chunk buffer is borrowed: a yielded line's bytes are only valid until the generator resumes.
  const scratch = takeScratch(Math.min(CHUNK, to - from));
  try {
    for (let li = 0; pos < to; li++) {
      const long = longs[li];
      const regionEnd = long === undefined ? to : long.start;
      while (pos < regionEnd) {
        const bytes = await reader.read(pos, Math.min(CHUNK, regionEnd - pos), scratch);
        const last = bytes.lastIndexOf(10);
        if (last === -1) throw new TranscriptRefusal("transcript-offset-invalid", "index");
        let s = 0;
        while (s <= last) {
          const nl = bytes.indexOf(10, s);
          yield { start: pos + s, bytes: bytes.subarray(s, nl) };
          s = nl + 1;
        }
        pos += last + 1;
      }
      if (long !== undefined) {
        yield { start: long.start, long, prefix: await reader.read(long.start, Math.min(PREFIX_BYTES, long.end - long.start)) };
        pos = long.end + 1;
      }
    }
  } finally {
    giveScratch(scratch);
  }
}

const cost = (line: Line): number => ("long" in line ? line.prefix.length : line.bytes.length + 1);

function servedMeta(redactor: Redactor, meta: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(meta)) {
    const redacted = redactFull(redactor, value);
    out[key] = redacted.length <= META_LIMIT ? redacted : redacted.slice(0, edge(redacted, META_LIMIT));
  }
  return out;
}

/** A composite value (a tool input, an unknown line) as served text: every decoded string redacted, then stringified. */
export const compositeText = (redactor: Redactor, value: unknown): string => JSON.stringify(redactValue(redactor, value), null, 2) ?? "null";

function serve(redactor: Redactor, at: number, i: number, raw: RawEvent, observedAt?: number): ServedEvent {
  const out: ServedEvent = { at, i, kind: raw.kind };
  if (observedAt !== undefined) out.ccloopObservedAt = observedAt;
  if (raw.meta) out.meta = servedMeta(redactor, raw.meta);
  if (raw.num) out.num = raw.num;
  if (raw.flag) out.flag = raw.flag;
  if (raw.fields) {
    out.fields = {};
    for (const [name, field] of Object.entries(raw.fields)) {
      out.fields[name] = "plain" in field ? headOf(redactor, field.plain) : sliceHead(compositeText(redactor, field.composite));
    }
  }
  return out;
}

type ObservedMarker = { atBytes: number; ccloopObservedAt: number | undefined };

/** Only a complete marker immediately after its physical source line may supply a timestamp. */
function markerOf(line: Line): ObservedMarker | null {
  if ("long" in line || !line.bytes.includes('"ccloop.line-observed"')) return null;
  let parsed: unknown;
  try { parsed = lineParser.parse(line.bytes.toString("utf8")); } catch { return null; }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const value = parsed as Record<string, unknown>;
  if (value.type !== "ccloop.line-observed") return null;
  return {
    atBytes: typeof value.atBytes === "number" && Number.isSafeInteger(value.atBytes) && value.atBytes >= 0 ? value.atBytes : -1,
    ccloopObservedAt: typeof value.ccloopObservedAt === "number" && Number.isSafeInteger(value.ccloopObservedAt) && value.ccloopObservedAt >= 0 ? value.ccloopObservedAt : undefined,
  };
}

const lineEnd = (line: Line): number => "long" in line ? line.long.end + 1 : line.start + line.bytes.length + 1;
const observable = (events: ServedEvent[]): boolean => events.length > 0 && events.every((event) =>
  event.kind !== "unknown" && !["oversized", "truncated", "line-dropped"].includes(event.meta?.notice ?? ""));

function eventsOf(line: Line, options: WindowOptions, observedAt?: number): ServedEvent[] {
  if ("long" in line) {
    const type = scanType(line.prefix);
    return [{ at: line.start, i: 0, kind: "notice", ...(observedAt === undefined ? {} : { ccloopObservedAt: observedAt }), meta: { notice: "oversized", ...(type === undefined ? {} : { type }) }, num: { bytes: line.long.end - line.long.start } }];
  }
  const raw = normalizeLine(options.runtime, line.bytes);
  const out: ServedEvent[] = [];
  raw.forEach((event, i) => { if (event.kind !== "thinking" || options.includeThinking === true) out.push(serve(options.redactor, line.start, i, event, observedAt)); });
  return out;
}

/** A marker arriving after the previous follow window revises only its adjacent, known provider line. */
async function revisitMarker(reader: RangeReader, markerStart: number, marker: ObservedMarker, options: WindowOptions): Promise<{ served: ServedEvent[]; cost: number }> {
  const at = marker.atBytes;
  const length = markerStart - at;
  if (marker.ccloopObservedAt === undefined || at < 0 || length < 2 || length > PARSE_LIMIT + 1) return { served: [], cost: 0 };
  if (at > 0 && (await reader.read(at - 1, 1))[0] !== 10) return { served: [], cost: 0 };
  const bytes = await reader.read(at, length);
  if (bytes.length !== length || bytes[length - 1] !== 10 || bytes.indexOf(10) !== length - 1) return { served: [], cost: bytes.length };
  const served = eventsOf({ start: at, bytes: bytes.subarray(0, -1) }, options);
  if (!observable(served)) return { served: [], cost: bytes.length };
  for (const event of served) event.ccloopObservedAt = marker.ccloopObservedAt;
  return { served, cost: bytes.length };
}

/** Does a line start at `offset`? (0, or the byte before it is `\n`, and it is before the indexed end.) */
async function assertLineStart(index: LineIndex, reader: RangeReader, offset: number): Promise<void> {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > index.end) throw new TranscriptRefusal("transcript-offset-invalid");
  if (offset === 0 || offset === index.end) return;
  const before = await reader.read(offset - 1, 1);
  if (before[0] !== 10) throw new TranscriptRefusal("transcript-offset-invalid");
}

interface Budget { events: number; bytes: number; served: number; counted: number }
/** Whether a line is taken: the first always; any other only within both bounds (C2). */
function take(budget: Budget, lineCost: number, events: number, first: boolean): boolean {
  if (!first && (budget.counted + lineCost > budget.bytes || budget.served + events > budget.events)) return false;
  budget.counted += lineCost;
  budget.served += events;
  return true;
}

/** `after`: the lines from `offset` forward (a follow read when `offset` is the last served end). */
export async function windowAfter(index: LineIndex, reader: RangeReader, offset: number, options: WindowOptions): Promise<TranscriptWindow> {
  await assertLineStart(index, reader, offset);
  const budget: Budget = { events: options.maxEvents ?? WINDOW_EVENTS, bytes: options.maxBytes ?? WINDOW_BYTES, served: 0, counted: 0 };
  const events: ServedEvent[] = [];
  let end = offset;
  let pending: { start: number; end: number; cost: number; served: ServedEvent[] } | null = null;
  for await (const line of linesIn(index, reader, offset, index.end)) {
    const marker = markerOf(line);
    if (pending !== null) {
      if (marker !== null) {
        if (marker.atBytes === pending.start && marker.ccloopObservedAt !== undefined && pending.end === line.start && observable(pending.served)) {
          for (const event of pending.served) event.ccloopObservedAt = marker.ccloopObservedAt;
        }
        pending.cost += cost(line);
        pending.end = lineEnd(line);
      }
      if (!take(budget, pending.cost, pending.served.length, end === offset)) break;
      events.push(...pending.served.slice(0, budget.events - events.length));
      end = pending.end;
      pending = null;
      if (marker !== null) continue;
    }
    const revision = marker === null ? null : await revisitMarker(reader, line.start, marker, options);
    pending = { start: line.start, end: lineEnd(line), cost: cost(line) + (revision?.cost ?? 0), served: revision?.served ?? eventsOf(line, options) };
  }
  if (pending !== null && take(budget, pending.cost, pending.served.length, end === offset)) {
    events.push(...pending.served.slice(0, budget.events - events.length));
    end = pending.end;
  }
  return { events, start: offset, end, indexedEnd: index.end, counted: budget.counted };
}

/** `before` (and the tail, `before = index.end`): the lines ending at `offset`, walking back checkpoint by checkpoint. */
export async function windowBefore(index: LineIndex, reader: RangeReader, offset: number, options: WindowOptions): Promise<TranscriptWindow> {
  await assertLineStart(index, reader, offset);
  const budget: Budget = { events: options.maxEvents ?? WINDOW_EVENTS, bytes: options.maxBytes ?? WINDOW_BYTES, served: 0, counted: 0 };
  const chunks: ServedEvent[][] = [];
  let start = offset;
  let segmentEnd = offset;
  let stopped = false;
  let pendingMarker: { start: number; cost: number; marker: ObservedMarker } | null = null;
  while (!stopped && segmentEnd > 0) {
    let k = index.checkpoints.length - 1;
    while (k > 0 && index.checkpoints[k]!.offset >= segmentEnd) k--;
    const segmentStart = index.checkpoints[k]!.offset;
    // Each line is served as read (the chunk buffer is borrowed), then the segment is taken from its end backwards.
    const servedLines: Array<{ start: number; end: number; cost: number; served: ServedEvent[]; marker: ObservedMarker | null }> = [];
    for await (const line of linesIn(index, reader, segmentStart, segmentEnd)) {
      const marker = markerOf(line);
      servedLines.push({ start: line.start, end: lineEnd(line), cost: cost(line), served: marker === null ? eventsOf(line, options) : [], marker });
    }
    for (let j = servedLines.length - 1; j >= 0; j--) {
      const line = servedLines[j]!;
      if (line.marker !== null) {
        if (pendingMarker !== null) {
          if (!take(budget, pendingMarker.cost, 0, start === offset)) { stopped = true; break; }
          start = pendingMarker.start;
        }
        pendingMarker = { start: line.start, cost: line.cost, marker: line.marker };
        continue;
      }
      const adjacent = pendingMarker?.start === line.end;
      if (adjacent && pendingMarker?.marker.atBytes === line.start && pendingMarker.marker.ccloopObservedAt !== undefined && observable(line.served)) {
        for (const event of line.served) event.ccloopObservedAt = pendingMarker.marker.ccloopObservedAt;
      }
      const lineCost = line.cost + (adjacent ? pendingMarker!.cost : 0);
      if (!take(budget, lineCost, line.served.length, start === offset)) { stopped = true; break; }
      chunks.push(line.served.length > budget.events ? line.served.slice(line.served.length - budget.events) : line.served);
      start = line.start;
      pendingMarker = null;
    }
    segmentEnd = segmentStart;
  }
  if (!stopped && pendingMarker !== null && take(budget, pendingMarker.cost, 0, start === offset)) start = pendingMarker.start;
  return { events: chunks.reverse().flat(), start, end: offset, indexedEnd: index.end, counted: budget.counted };
}

export const windowTail = (index: LineIndex, reader: RangeReader, options: WindowOptions): Promise<TranscriptWindow> => windowBefore(index, reader, index.end, options);

/** Expand one decoded field of a line of 1 MiB or less: the line is re-parsed and the field paged (C3). */
export async function expandField(index: LineIndex, reader: RangeReader, at: number, i: number, field: string, page: number, options: WindowOptions): Promise<Page> {
  await assertLineStart(index, reader, at);
  if (at === index.end || longLineAt(index, at) !== undefined) throw new TranscriptRefusal("transcript-offset-invalid", "not a parsed line");
  const bytes = await reader.read(at, Math.min(CHUNK, index.end - at));
  const nl = bytes.indexOf(10);
  if (nl === -1) throw new TranscriptRefusal("transcript-offset-invalid");
  const event = normalizeLine(options.runtime, bytes.subarray(0, nl))[i];
  if (event === undefined || (event.kind === "thinking" && options.includeThinking !== true)) throw new TranscriptRefusal("transcript-not-found", "event");
  const value = event.fields?.[field];
  if (value === undefined) throw new TranscriptRefusal("transcript-not-found", "field");
  const result = "plain" in value ? pageOf(options.redactor, value.plain, page) : slicePage(compositeText(options.redactor, value.composite), page);
  if (!Number.isSafeInteger(page) || page < 0 || page >= result.pages) throw new TranscriptRefusal("transcript-offset-invalid", "page");
  return result;
}

/** C6 / N1: one streaming pass over an oversized line, recording the decoder state at every 1 MiB raw stride. */
export async function oversizedIndex(index: LineIndex, reader: RangeReader, line: LongLine): Promise<OversizedIndex> {
  const known = index.oversized.get(line.start);
  if (known !== undefined) return known;
  const decoder = createDecoder();
  const checkpoints = [{ raw: 0, dec: 0, state: initialDecoderState() }];
  let length = 0;
  const total = line.end - line.start;
  const scratch = takeScratch(Math.min(COUNT_CHUNK, total));
  try {
    for (let raw = 0; raw < total;) {
      // Chunks end on every 1 MiB stride, so a checkpoint's state is exact. They are large because each read allocates a
      // promise and a Buffer object (churn that the heap keeps until a collection): 8 KiB chunks over 200 MiB leave tens
      // of MiB unreclaimed; this counting pass builds no strings, so a large chunk costs no heap.
      const step = Math.min(COUNT_CHUNK, STRIDE_BYTES - (raw % STRIDE_BYTES), total - raw);
      const bytes = await reader.read(line.start + raw, step, scratch);
      if (bytes.length === 0) break;
      length += decoder.feedCount(bytes);
      raw += bytes.length;
      if (raw < total && raw % STRIDE_BYTES === 0) checkpoints.push({ raw, dec: length, state: decoder.state() });
    }
  } finally {
    giveScratch(scratch);
  }
  length += decoder.endCount();
  const built = { checkpoints, length };
  index.oversized.set(line.start, built);
  return built;
}

/** Page k of an oversized line's decoded text, resumed from the last checkpoint at or before k·PAGE - LOOK (C6). */
export async function expandOversized(index: LineIndex, reader: RangeReader, at: number, page: number, redactor: Redactor): Promise<Page> {
  const line = longLineAt(index, at);
  if (line === undefined) throw new TranscriptRefusal("transcript-offset-invalid", "not an oversized line");
  const over = await oversizedIndex(index, reader, line);
  const pages = Math.max(1, Math.ceil(over.length / PAGE));
  if (!Number.isSafeInteger(page) || page < 0 || page >= pages) throw new TranscriptRefusal("transcript-offset-invalid", "page");
  const want = Math.max(0, page * PAGE - LOOK);
  let checkpoint = over.checkpoints[0]!;
  for (const candidate of over.checkpoints) { if (candidate.dec <= want) checkpoint = candidate; else break; }
  const decoder = createDecoder(checkpoint.state);
  const total = line.end - line.start;
  const nominalEnd = (page + 1) * PAGE;
  let text = "";
  let raw = checkpoint.raw;
  let base = checkpoint.dec;
  let tail: StreamDecoder | null = null;
  const scratch = takeScratch(Math.min(Math.max(COUNT_CHUNK, PAGE + 2 * LOOK), total));
  try {
    // Skip the text before `want` by counting only. Decoding a chunk yields at most one unit more than its byte count
    // (bytes held back at a checkpoint complete a 4-byte sequence), so leaving two units of room per read keeps every
    // bulk read short of `want`; the crossing read is then at most 2 bytes, decoded again from a snapshot and sliced
    // exactly, so no large transient string is built for text that is thrown away.
    while (base < want && raw < total) {
      const bytes = await reader.read(line.start + raw, Math.min(COUNT_CHUNK, Math.max(1, want - base - 2), total - raw), scratch);
      if (bytes.length === 0) break;
      const before = decoder.state();
      const counted = decoder.feedCount(bytes);
      raw += bytes.length;
      if (base + counted < want) { base += counted; continue; }
      tail = createDecoder(before);
      text = tail.feed(bytes).slice(want - base);
      base = want;
      break;
    }
    tail ??= decoder;
    const need = nominalEnd + LOOK - base;
    while (text.length < need && raw < total) {
      const bytes = await reader.read(line.start + raw, Math.min(need - text.length, total - raw), scratch);
      if (bytes.length === 0) break;
      text += tail.feed(bytes);
      raw += bytes.length;
    }
  } finally {
    giveScratch(scratch);
  }
  if (raw >= total) text += (tail ?? decoder).end();
  const span = base === want && text.length <= nominalEnd + LOOK - want ? text : text.slice(Math.max(0, want - base), nominalEnd + LOOK - base);
  const endUnits = Math.min(nominalEnd, base + text.length) - want;
  // Review minor 3: a text shorter than the look-around (a truncated or drifted line) would put `b` before `a`.
  const from = edge(span, page * PAGE - want);
  return { text: render(redactor, span, from, Math.max(from, edge(span, endUnits))), page, pages, length: over.length };
}
