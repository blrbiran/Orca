/**
 * T2 (spec §10.4.1): the line index's identity and life. The cache key is the file's (dev, ino) -- a file replaced at the
 * same path with the same size and mtime is a new file, and an index keyed by path, size and mtime would serve the old
 * line boundaries over the new bytes. A shrink and a changed head rebuild; growth extends; the LRU holds 8.
 */
import { appendFileSync, mkdirSync, renameSync, statSync, truncateSync, utimesSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createIndexCache, HEAD_CHECK_BYTES, INDEX_CACHE_SIZE } from "../../src/agentTranscript/lineIndex.js";
import { openRunTranscript } from "../../src/agentTranscript/reader.js";
import { windowTail } from "../../src/agentTranscript/window.js";
import { claude, jsonl, memoryReader, redactor } from "./fixtures.js";

const PATH = "claude/1/plan/call-a/transcript.jsonl";

async function runDir(): Promise<{ sourceDir: string; file: string }> {
  const sourceDir = await mkdtemp(join(tmpdir(), "lt-src-"));
  mkdirSync(join(sourceDir, "run", "claude", "1", "plan", "call-a"), { recursive: true });
  return { sourceDir, file: join(sourceDir, "run", PATH) };
}

async function texts(cache: ReturnType<typeof createIndexCache>, sourceDir: string): Promise<string[]> {
  const open = await openRunTranscript(sourceDir, PATH);
  try {
    const index = await cache.get(open.key, open.reader);
    const window = await windowTail(index, open.reader, { runtime: "claude", redactor });
    return window.events.map((event) => event.fields?.text?.text ?? event.kind);
  } finally { await open.close(); }
}

describe("T2: the index cache", () => {
  it("a replaced inode (same path, same size, same mtime) rebuilds the index", async () => {
    const { sourceDir, file } = await runDir();
    const cache = createIndexCache();
    // Same total size, different line boundaries: the old index's checkpoint (after line 256) falls inside a line of
    // the new file, so a stale index would serve a cut line.
    const oldTexts = Array.from({ length: 300 }, (_, i) => `old ${String(i).padStart(3, "0")} ` + "x".repeat(40));
    const newTexts = oldTexts.map((_, i) => `new ${String(i).padStart(3, "0")} ` + "y".repeat(i === 0 ? 47 : i === 299 ? 33 : 40));
    const before = jsonl(oldTexts.map((text) => claude.text(text)));
    const after = jsonl(newTexts.map((text) => claude.text(text)));
    expect(before.length).toBe(after.length);
    writeFileSync(file, before);
    // Whole seconds, so both files carry exactly the same mtime (mtimeMs included).
    const mtime = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000);
    utimesSync(file, mtime, mtime);
    expect((await texts(cache, sourceDir)).slice(-2)).toEqual(oldTexts.slice(-2));
    writeFileSync(file + ".new", after);
    utimesSync(file + ".new", mtime, mtime);
    renameSync(file + ".new", file);
    expect(statSync(file).size).toBe(before.length);
    expect(statSync(file).mtimeMs).toBe(mtime.getTime());
    expect(await texts(cache, sourceDir)).toEqual(newTexts.slice(-200));
  });

  it("a shrink rebuilds the index", async () => {
    const { sourceDir, file } = await runDir();
    const cache = createIndexCache();
    writeFileSync(file, jsonl([claude.text("one"), claude.text("two"), claude.text("three")]));
    expect(await texts(cache, sourceDir)).toEqual(["one", "two", "three"]);
    truncateSync(file, 0);
    writeFileSync(file, jsonl([claude.text("x")]));
    expect(await texts(cache, sourceDir)).toEqual(["x"]);
  });

  it("a changed head rebuilds the index, even when the file grew", async () => {
    const reader1 = memoryReader(jsonl([claude.text("first-" + "a".repeat(5000)), claude.text("second")]));
    const cache = createIndexCache();
    const index1 = await cache.get("same", reader1);
    expect(index1.lines).toBe(2);
    // Same key, longer, but the indexed head differs: the old checkpoints cannot be trusted.
    const reader2 = memoryReader(jsonl([claude.text("other"), claude.text("lines-" + "b".repeat(5000)), claude.text("more")]));
    const index2 = await cache.get("same", reader2);
    expect(index2.lines).toBe(3);
    const window = await windowTail(index2, reader2, { runtime: "claude", redactor });
    expect(window.events.map((e) => [e.fields!.text!.text.slice(0, 6), e.fields!.text!.length])).toEqual([["other", 5], ["lines-", 5006], ["more", 4]]);
  });

  it("growth extends the index from its last complete line, reading only the new bytes (and the head check)", async () => {
    const { sourceDir, file } = await runDir();
    const cache = createIndexCache();
    const first = jsonl(Array.from({ length: 300 }, (_, i) => claude.text(`line ${i} ` + "x".repeat(100))));
    writeFileSync(file, first);
    const open1 = await openRunTranscript(sourceDir, PATH);
    const index = await cache.get(open1.key, open1.reader);
    await open1.close();
    expect(index.lines).toBe(300);
    const checkpoints = index.checkpoints.length;
    appendFileSync(file, jsonl([claude.text("appended")]));
    const open2 = await openRunTranscript(sourceDir, PATH);
    const reads: Array<[number, number]> = [];
    const counted = { size: open2.reader.size, read: async (p: number, n: number) => { const b = await open2.reader.read(p, n); reads.push([p, b.length]); return b; } };
    const grown = await cache.get(open2.key, counted);
    await open2.close();
    expect(grown).toBe(index);
    expect(grown.lines).toBe(301);
    expect(grown.checkpoints.length).toBeGreaterThanOrEqual(checkpoints);
    for (const [position, length] of reads) {
      if (position === 0) expect(length).toBeLessThanOrEqual(HEAD_CHECK_BYTES);
      else expect(position).toBeGreaterThanOrEqual(first.length);
    }
  });

  it("the LRU holds 8 indexes, evicting the least recently used", async () => {
    const cache = createIndexCache();
    const reader = memoryReader(jsonl([claude.text("x")]));
    for (let i = 0; i < INDEX_CACHE_SIZE; i++) await cache.get(`k${i}`, reader);
    await cache.get("k0", reader);
    await cache.get("k8", reader);
    expect(INDEX_CACHE_SIZE).toBe(8);
    expect(cache.size).toBe(8);
    expect(cache.has("k0")).toBe(true);
    expect(cache.has("k1")).toBe(false);
  });

  it("review 7753e97d: two growth requests at once extend the index once (no line or checkpoint counted twice)", async () => {
    const line = (i: number): string => JSON.stringify(claude.text(`m${i} ` + "y".repeat(5000))) + "\n";
    const first = Array.from({ length: 300 }, (_, i) => line(i)).join("");
    const all = Buffer.from(first + Array.from({ length: 600 }, (_, i) => line(300 + i)).join(""));
    // Slow reads, so the second request starts while the first is still extending.
    const slow = (size: number) => ({ size, read: async (p: number, n: number) => { await new Promise((r) => setTimeout(r, 1)); return Buffer.from(all.subarray(p, Math.min(size, p + n))); } });
    const cache = createIndexCache();
    await cache.get("k", slow(Buffer.byteLength(first)));
    const [a, b] = await Promise.all([cache.get("k", slow(all.length)), cache.get("k", slow(all.length))]);
    const fresh = await createIndexCache().get("k", slow(all.length));
    expect(a).toBe(b);
    expect(fresh.lines).toBe(900);
    expect(a.lines).toBe(fresh.lines);
    expect(a.checkpoints).toEqual(fresh.checkpoints);
  });
});
