/**
 * T3 (spec §10.4.2, §12.4 C6 and C8 "T3 adds", reviews N1-N3, N6): a line over 1 MiB is never parsed; it is served as
 * `notice{oversized}` and expanded as decoded pages resumed from decoder checkpoints. Multi-byte text at every edge gives
 * no U+FFFD and no lone surrogate, in heads and in pages.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { STRIDE_BYTES } from "../../src/agentTranscript/lineIndex.js";
import { lineParser } from "../../src/agentTranscript/normalize.js";
import { HEAD, headOf, PAGE, pageOf } from "../../src/agentTranscript/redact.js";
import { createDecoder, decodeAll } from "../../src/agentTranscript/unescape.js";
import { expandOversized, windowTail } from "../../src/agentTranscript/window.js";
import { badUnits, claude, indexOf, jsonl, memoryReader, prose, redactor } from "./fixtures.js";

afterEach(() => { vi.restoreAllMocks(); });
const EMOJI = "\u{1F600}"; // 4 UTF-8 bytes, 2 code units

/** A raw JSON line whose string content is built from raw pieces (escapes kept as written). */
const rawLine = (rawContent: string, type = "user"): Buffer => Buffer.from(`{"type":"${type}","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"big","content":"${rawContent}"}]}}\n`);

async function allPages(bytes: Buffer, at: number) {
  const reader = memoryReader(bytes);
  const index = await indexOf(reader);
  const pages: string[] = [];
  for (let page = 0, total = 1; page < total; page++) {
    const p = await expandOversized(index, reader, at, page, redactor);
    total = p.pages;
    pages.push(p.text);
  }
  return { pages, index, reader };
}

describe("T3: an oversized line", () => {
  it("a 2 MiB line becomes notice{oversized} with its type, and JSON.parse is never called on it", async () => {
    const big = claude.toolResult("t", prose(2 * 1024 * 1024));
    const bytes = jsonl([claude.text("a"), big, claude.text("b")]);
    const parse = vi.spyOn(lineParser, "parse");
    const reader = memoryReader(bytes);
    const window = await windowTail(await indexOf(reader), reader, { runtime: "claude", redactor });
    expect(window.events.map((e) => e.kind)).toEqual(["message", "notice", "message"]);
    const notice = window.events[1]!;
    expect(notice.meta).toEqual({ notice: "oversized", type: "user" });
    expect(notice.num!.bytes).toBe(JSON.stringify(big).length);
    expect(parse).toHaveBeenCalledTimes(2);
    for (const [text] of parse.mock.calls) expect(text.length).toBeLessThan(1024 * 1024);
    // C2: it counted as its 4 KiB prefix.
    expect(window.counted).toBeLessThan(8192);
  });

  it("N6: a line whose first 4 KiB holds a type outside [A-Za-z0-9_./-]{1,64} gives a notice without type", async () => {
    for (const type of ["<img src=x onerror=alert(1)>", "a".repeat(65), "has space"]) {
      const bytes = rawLine(prose(1_100_000), type);
      const reader = memoryReader(bytes);
      const window = await windowTail(await indexOf(reader), reader, { runtime: "claude", redactor });
      expect(window.events).toHaveLength(1);
      expect(window.events[0]!.meta).toEqual({ notice: "oversized" });
    }
  });

  it("N2: escaped surrogate pairs and raw 4-byte characters straddle every checkpoint; page k from its checkpoint equals the page from byte 0", async () => {
    // Before each 1 MiB raw stride (counted from the line start) a straddler starts 1-11 bytes before it, so the
    // checkpoint falls inside a raw UTF-8 sequence, inside a \u escape, between the two escapes, or after a backslash.
    const prefix = rawLine("").toString().split('"content":"')[0] + '"content":"';
    const parts: string[] = [];
    let bytes = Buffer.byteLength(prefix);
    const put = (piece: string): void => { parts.push(piece); bytes += Buffer.byteLength(piece); };
    const filler = prose(96, 5) + " ";
    for (let k = 1; k <= 5; k++) {
      const target = k * STRIDE_BYTES - (k % 2 === 0 ? 1 + (k % 3) : 1 + (k % 11));
      while (bytes + filler.length <= target) put(filler);
      put("b".repeat(target - bytes));
      put(k % 2 === 0 ? EMOJI : "\\ud83d\\ude00");
    }
    put(prose(1000));
    const raw = parts.join("");
    const line = Buffer.from(prefix + raw + '"}]}}\n');
    const { pages, index } = await allPages(line, 0);
    expect(index.oversized.get(0)!.checkpoints.length).toBeGreaterThanOrEqual(5);
    const full = decodeAll(line.subarray(0, line.length - 1));
    const expected = Array.from({ length: Math.ceil(full.length / PAGE) }, (_, page) => pageOf(redactor, full, page).text);
    expect(pages.length).toBe(expected.length);
    let differ = 0;
    pages.forEach((page, i) => { if (page !== expected[i]) differ++; });
    expect(differ).toBe(0);
    expect(pages.reduce((n, page) => n + badUnits(page), 0)).toBe(0);
  });

  it("N3: an emoji exactly at 65536·k in an oversized line, and at 4096 in a field, gives no lone surrogate and no U+FFFD", async () => {
    const prefix = rawLine("").toString().split('"content":"')[0] + '"content":"';
    const decodedPrefix = decodeAll(Buffer.from(prefix)).length;
    let content = "";
    for (let page = 1; page <= 20; page++) {
      content += prose(page * PAGE - 1 - decodedPrefix - content.length) + EMOJI; // high surrogate at 65536·k - 1
    }
    content += prose(100);
    const line = Buffer.from(prefix + content + '"}]}}\n');
    expect(line.length).toBeGreaterThan(1024 * 1024);
    const { pages } = await allPages(line, 0);
    expect(pages.join("")).toContain(EMOJI);
    expect(pages.reduce((n, page) => n + badUnits(page), 0)).toBe(0);
    const field = prose(HEAD - 1) + EMOJI + prose(5000);
    expect(field.charCodeAt(HEAD - 1)).toBe(0xd83d);
    const head = headOf(redactor, field);
    expect(badUnits(head.text)).toBe(0);
    expect(head.text.length).toBe(HEAD - 1);
  });

  it("multi-byte characters at every 4 KiB boundary give no U+FFFD in heads or pages", async () => {
    // Raw: a 3-byte CJK character straddling every 4 KiB raw boundary of an oversized line (the read chunks are
    // multiples of 4 KiB). Decoded: an emoji straddling every 4096-unit boundary of a parsed field.
    const prefix = rawLine("").toString().split('"content":"')[0] + '"content":"';
    const parts: string[] = [];
    let at = Buffer.byteLength(prefix);
    while (at < 1_300_000) {
      const next = (Math.floor(at / 4096) + 1) * 4096 - 1;
      parts.push("c".repeat(next - at) + "\u6771"); // 東 (3 bytes), starting one byte before the boundary
      at = next + 3;
    }
    const raw = parts.join("");
    const { pages } = await allPages(Buffer.from(prefix + raw + '"}]}}\n'), 0);
    expect(pages.join("")).toContain("東");
    expect(pages.reduce((n, page) => n + badUnits(page), 0)).toBe(0);
    let field = "";
    while (field.length < 3 * HEAD) field += prose(HEAD - 1 - (field.length % HEAD)) + EMOJI;
    const bytes = jsonl([claude.text(field)]);
    const reader = memoryReader(bytes);
    const window = await windowTail(await indexOf(reader), reader, { runtime: "claude", redactor });
    expect(badUnits(window.events[0]!.fields!.text!.text)).toBe(0);
    for (let page = 0; page < 1; page++) expect(badUnits(pageOf(redactor, field, page).text)).toBe(0);
  });
});

describe("T3: the streaming decoder equals one whole-buffer decode at any chunk split", () => {
  /** `feed` and `feedCount` over the same chunks, from two decoders; returns the text, the counted units and both decoders. */
  const stream = (chunks: readonly Buffer[]) => {
    const text = createDecoder(), count = createDecoder();
    let out = "", units = 0;
    for (const chunk of chunks) { out += text.feed(chunk); units += count.feedCount(chunk); }
    out += text.end();
    units += count.endCount();
    return { out, units, text, count };
  };

  it("N1/T-F: seeded random bytes, random chunks: same text and count as decoding the whole buffer", () => {
    let seed = 0x5eed1234;
    const next = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    const alphabet = [0x22, 0x5c, 0x75, 0x6e, 0x30, 0x31, 0x41, 0x0a, 0x80, 0x9f, 0xa9, 0xc0, 0xc3, 0xe0, 0xed, 0xef, 0xf0, 0xf4, 0x98];
    for (let caseNo = 0; caseNo < 500; caseNo++) {
      const bytes = Buffer.from(Array.from({ length: Math.floor(next() * 48) }, () => alphabet[Math.floor(next() * alphabet.length)]!));
      const chunks: Buffer[] = [];
      for (let at = 0; at < bytes.length;) { const size = 1 + Math.floor(next() * 6); chunks.push(bytes.subarray(at, at + size)); at += size; }
      const { out, units, text, count } = stream(chunks);
      expect(out, `case ${caseNo}`).toBe(decodeAll(bytes));
      expect(units, `case ${caseNo}`).toBe(out.length);
      expect(count.state(), `case ${caseNo}`).toEqual(text.state());
    }
  });

  it("N1/T-F: a dangling lead followed by a lead keeps the following character", () => {
    const bytes = Buffer.from([0xc3, 0xc3, 0xa9]);
    expect(decodeAll(bytes)).toBe("\uFFFD\u00e9");
    const { out, units } = stream([bytes.subarray(0, 1), bytes.subarray(1)]);
    expect(out).toBe(decodeAll(bytes));
    expect(units).toBe(out.length);
  });

  it("N1/T-F: a \\u escape completed inside a 4-byte character counts the character's other unit", () => {
    const bytes = Buffer.concat([Buffer.from('"\\uD80'), Buffer.from("\u{1F600}"), Buffer.from('x"')]);
    const chunks = Array.from(bytes, (byte) => Buffer.from([byte]));
    const { out, units } = stream(chunks);
    expect(out).toBe(decodeAll(bytes));
    expect(units).toBe(out.length);
  });
});
