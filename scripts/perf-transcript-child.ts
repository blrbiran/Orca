// The measured process of `npm run perf:transcript` (scripts/perf-transcript.mjs): run under
// `node --max-old-space-size=96 --import tsx`, it serves windows, a follow read and expand pages from one transcript
// through the real modules, samples heapUsed+external+arrayBuffers every 100 ms, and prints one JSON line.
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { createIndexCache } from "../src/agentTranscript/lineIndex.js";
import { openRunTranscript } from "../src/agentTranscript/reader.js";
import { createRedactor, pageOf } from "../src/agentTranscript/redact.js";
import { expandOversized, oversizedIndex, windowAfter, windowBefore, windowTail, type TranscriptWindow } from "../src/agentTranscript/window.js";

const MARK = "Zq9X";
const PATH = "claude/1/execute/call-perf/transcript.jsonl";
const sourceDir = process.argv[2]!;
let peak = 0;
const sample = (): void => { const m = process.memoryUsage(); peak = Math.max(peak, m.heapUsed + m.external + m.arrayBuffers); };
const timer = setInterval(sample, 100);
const now = (): number => Number(process.hrtime.bigint()) / 1e6;
const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  return { n: values.length, median: +at(0.5).toFixed(2), p95: +at(0.95).toFixed(2), max: +(sorted.at(-1) ?? 0).toFixed(2) };
};
const count = (text: string): number => text.split(MARK).length - 1;
/** Marks in every served string: the same count as `JSON.stringify`, without building the string. */
const countMarks = (value: unknown): number => {
  if (typeof value === "string") return count(value);
  if (Array.isArray(value)) return value.reduce<number>((n, item) => n + countMarks(item), 0);
  if (typeof value === "object" && value !== null) return Object.values(value).reduce<number>((n, item) => n + countMarks(item), 0);
  return 0;
};
const MARK_BYTES = Buffer.from(MARK);
/** Marks starting in [from, to) of the raw bytes, read in 4 MiB chunks that overlap by the mark's length - 1. */
const RAW_CHUNK = 256 * 1024;
const rawScratch = Buffer.allocUnsafe(RAW_CHUNK + MARK_BYTES.length - 1);
async function rawCount(from: number, to: number): Promise<number> {
  let n = 0;
  for (let pos = from; pos < to; pos += RAW_CHUNK) {
    const len = Math.min(RAW_CHUNK, to - pos);
    const bytes = await source.reader.read(pos, Math.min(len + MARK_BYTES.length - 1, to - pos), rawScratch);
    for (let at = bytes.indexOf(MARK_BYTES); at !== -1 && at < len; at = bytes.indexOf(MARK_BYTES, at + 1)) n++;
  }
  return n;
}

// The redaction pass's own cost (§12.2 budget: <= 100 ms per window): every match pass is timed through this wrapper.
const base = createRedactor({});
let redactMs = 0;
const redactor = { intervals(s: string, a: number) { const t = now(); const out = base.intervals(s, a); redactMs += now() - t; return out; } };
const cache = createIndexCache();
let marksIn = 0, marksOut = 0;
const open = async () => openRunTranscript(sourceDir, PATH);

let source = await open();
let t0 = now();
let index = await cache.get(source.key, source.reader);
const indexMs = +(now() - t0).toFixed(0);
sample();

/** Marks in the raw bytes of the parsed lines a window served (the decoded source of what was redacted). */
async function rawMarks(window: TranscriptWindow): Promise<number> {
  let n = 0;
  for (let pos = window.start; pos < window.end;) {
    const long = index.long.find((line) => line.start >= pos && line.start < window.end);
    const stop = long === undefined ? window.end : long.start;
    n += await rawCount(pos, stop);
    pos = long === undefined ? window.end : long.end + 1;
  }
  return n;
}

const windowMs: number[] = [];
const windowRedactMs: number[] = [];
/** Serve one window, recording its latency and the redaction time inside it. */
async function timed(serve: () => Promise<TranscriptWindow>): Promise<TranscriptWindow> {
  redactMs = 0;
  const t = now();
  const served = await serve();
  windowMs.push(now() - t);
  windowRedactMs.push(redactMs);
  return served;
}
const options = { runtime: "claude" as const, redactor };
let window = await timed(() => windowTail(index, source.reader, options));
marksIn += await rawMarks(window); marksOut += countMarks(window.events);
for (let k = 0; k < 40 && window.start > 0; k++) {
  const start = window.start;
  window = await timed(() => windowBefore(index, source.reader, start, options));
  marksIn += await rawMarks(window); marksOut += countMarks(window.events);
  sample();
}
for (const fraction of [0.1, 0.3, 0.5, 0.7, 0.9]) {
  const target = Math.floor(index.end * fraction);
  const checkpoint = [...index.checkpoints].reverse().find((c) => c.offset <= target)!;
  const forward = await timed(() => windowAfter(index, source.reader, checkpoint.offset, options));
  marksIn += await rawMarks(forward); marksOut += countMarks(forward.events);
  sample();
}

// Follow: the file grows by ~1 MiB; the index extends and the follow read serves only the new lines.
const before = index.end;
const line = JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "appended ".repeat(100) }] } }) + "\n";
appendFileSync(join(sourceDir, "run", PATH), line.repeat(Math.ceil((1024 * 1024) / line.length)));
await source.close();
source = await open();
t0 = now();
index = await cache.get(source.key, source.reader);
const follow = await windowAfter(index, source.reader, before, options);
const followMs = +(now() - t0).toFixed(2);
if (follow.events.length === 0) throw new Error("follow served nothing");
sample();

// Forward page redaction of a decoded field (65 536 units with look-around).
const field = "the agent reads 東京 file ".repeat(40000);
const forwardMs: number[] = [];
for (let k = 0; k < 10; k++) { t0 = now(); pageOf(redactor, field, k); forwardMs.push(now() - t0); }

let oversized: null | { buildMs: number; n: number; median: number; p95: number; max: number } = null;
const long = index.long.find((line) => line.end - line.start > 100 * 1024 * 1024);
if (long !== undefined) {
  t0 = now();
  const over = await oversizedIndex(index, source.reader, long);
  const buildMs = +(now() - t0).toFixed(0);
  const pages = Math.ceil(over.length / 65536);
  const pageMs: number[] = [];
  for (let page = 0; page < pages; page++) {
    t0 = now();
    const served = await expandOversized(index, source.reader, long.start, page, redactor);
    pageMs.push(now() - t0);
    marksOut += count(served.text);
    if (page % 64 === 0) sample();
  }
  marksIn += await rawCount(long.start, long.end);
  oversized = { buildMs, ...stats(pageMs) };
}
await source.close();
sample();
clearInterval(timer);
process.stdout.write(JSON.stringify({
  indexMs, window: stats(windowMs), windowRedaction: stats(windowRedactMs), followMs, forwardPage: stats(forwardMs), oversized, marksIn, marksOut, peakMiB: +(peak / 1024 / 1024).toFixed(1),
}) + "\n");
