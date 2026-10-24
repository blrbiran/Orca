/**
 * T1 + C8 "T1 adds" (spec §6.1, §10.4.1, §12.4 C2): windows read bounded bytes. Bytes are counted through an injected
 * reader. A tail window reads at most the last stride(s) plus its lines; a follow read reads only bytes after its offset
 * (plus the head check of a grown file); a trailing partial line is never served; a window is at most 200 events and at
 * most 4 MiB of bytes read, delta lines included, the first line always, with a continuation offset.
 * Also the per-runtime normalisation (spec §5.1, §10.3, C1) on lines of the real shapes, and `thinking` omitted unless
 * asked (§10.3).
 */
import { describe, expect, it } from "vitest";
import { createIndexCache, HEAD_CHECK_BYTES, STRIDE_BYTES } from "../../src/agentTranscript/lineIndex.js";
import { windowAfter, windowBefore, windowTail, WINDOW_BYTES, WINDOW_EVENTS } from "../../src/agentTranscript/window.js";
import { claude, codex, indexOf, jsonl, memoryReader, omp, prose, redactor } from "./fixtures.js";

const MiB = 1024 * 1024;
const kinds = (events: Array<{ kind: string }>): string[] => events.map((e) => e.kind);

describe("T1: bytes read", () => {
  it("a tail window reads at most 2 strides plus its lines", async () => {
    const lines = Array.from({ length: 2600 }, (_, i) => claude.text(`line ${i} ` + prose(3000, i)));
    const reader = memoryReader(jsonl(lines));
    expect(reader.size).toBeGreaterThan(7 * MiB);
    const index = await indexOf(reader);
    reader.reset();
    const window = await windowTail(index, reader, { runtime: "claude", redactor });
    expect(window.events).toHaveLength(WINDOW_EVENTS);
    expect(window.end).toBe(reader.size);
    expect(reader.bytesRead()).toBeLessThanOrEqual(2 * STRIDE_BYTES + window.counted);
    expect(reader.bytesRead()).toBeLessThan(reader.size / 2);
  });

  it("a follow read reads only the bytes after its offset (and the grown file's head check)", async () => {
    const first = jsonl(Array.from({ length: 2000 }, (_, i) => claude.text(`line ${i} ` + prose(2000, i))));
    const cache = createIndexCache();
    const r1 = memoryReader(first);
    const index = await cache.get("f", r1);
    const tail = await windowTail(index, r1, { runtime: "claude", redactor });
    const added = jsonl([claude.text("new one"), claude.text("new two")]);
    const r2 = memoryReader(Buffer.concat([first, added]));
    const grown = await cache.get("f", r2);
    const follow = await windowAfter(grown, r2, tail.end, { runtime: "claude", redactor });
    expect(follow.events.map((e) => e.fields!.text!.text)).toEqual(["new one", "new two"]);
    expect(follow.end).toBe(r2.size);
    // Allowed before the offset: the grown file's head check at 0, and the one byte proving the offset is a line start.
    for (const [position, length] of r2.reads) {
      if (position === 0) expect(length).toBeLessThanOrEqual(HEAD_CHECK_BYTES);
      else if (position === tail.end - 1) expect(length).toBe(1);
      else expect(position).toBeGreaterThanOrEqual(tail.end);
    }
    expect(r2.bytesRead()).toBeLessThanOrEqual(HEAD_CHECK_BYTES + 1 + 2 * added.length);
  });

  it("a trailing partial line is never indexed or served", async () => {
    const complete = jsonl([claude.text("done")]);
    const reader = memoryReader(Buffer.concat([complete, Buffer.from(JSON.stringify(claude.text("half")).slice(0, 30))]));
    const index = await indexOf(reader);
    expect(index.end).toBe(complete.length);
    const tail = await windowTail(index, reader, { runtime: "claude", redactor });
    expect(tail.events.map((e) => e.fields!.text!.text)).toEqual(["done"]);
    const follow = await windowAfter(index, reader, tail.end, { runtime: "claude", redactor });
    expect(follow.events).toEqual([]);
    expect(follow.end).toBe(complete.length);
  });
});

describe("T1 / C2: a window is at most 200 events and at most 4 MiB of bytes read", () => {
  it("lines over 4 MiB in total: the window stops at 4 MiB with a continuation, and the next window continues", async () => {
    const reader = memoryReader(jsonl(Array.from({ length: 10 }, (_, i) => claude.text(`big ${i} ` + prose(900 * 1024, i)))));
    const index = await indexOf(reader);
    const tail = await windowTail(index, reader, { runtime: "claude", redactor });
    expect(tail.counted).toBeLessThanOrEqual(WINDOW_BYTES);
    expect(tail.events.length).toBeLessThan(10);
    expect(tail.events.length).toBeGreaterThan(0);
    expect(tail.start).toBeGreaterThan(0);
    const earlier = await windowBefore(index, reader, tail.start, { runtime: "claude", redactor });
    expect(earlier.end).toBe(tail.start);
    expect(earlier.events.length + tail.events.length).toBeLessThanOrEqual(10);
    const forward = await windowAfter(index, reader, 0, { runtime: "claude", redactor });
    expect(forward.counted).toBeLessThanOrEqual(WINDOW_BYTES);
    expect(forward.end).toBeLessThan(reader.size);
  });

  it("the first line is always served, alone, when it is over the byte bound", async () => {
    const reader = memoryReader(jsonl([claude.text("a" + prose(500)), claude.text("b" + prose(500))]));
    const index = await indexOf(reader);
    const tail = await windowTail(index, reader, { runtime: "claude", redactor, maxBytes: 100 });
    expect(tail.events).toHaveLength(1);
    expect(tail.start).toBeGreaterThan(0);
  });

  it("delta lines count toward the 4 MiB though nothing of them is served", async () => {
    const lines: unknown[] = [];
    for (let i = 0; i < 6; i++) lines.push(omp.messageEnd(`message ${i}`), omp.delta(prose(900 * 1024, i)));
    const reader = memoryReader(jsonl(lines));
    const index = await indexOf(reader);
    const tail = await windowTail(index, reader, { runtime: "omp", redactor });
    expect(kinds(tail.events).every((kind) => kind === "message")).toBe(true);
    expect(tail.counted).toBeLessThanOrEqual(WINDOW_BYTES);
    expect(tail.events.length).toBeLessThan(6);
    expect(tail.start).toBeGreaterThan(0);
  });

  it("at most 200 events", async () => {
    const reader = memoryReader(jsonl(Array.from({ length: 450 }, (_, i) => claude.text(`m${i}`))));
    const index = await indexOf(reader);
    const forward = await windowAfter(index, reader, 0, { runtime: "claude", redactor });
    expect(forward.events).toHaveLength(200);
    const next = await windowAfter(index, reader, forward.end, { runtime: "claude", redactor });
    expect(next.events[0]!.fields!.text!.text).toBe("m200");
  });
});

describe("normalisation per runtime (real shapes, synthetic content)", () => {
  const tail = async (runtime: "claude" | "codex" | "omp", lines: unknown[], includeThinking = false) => {
    const reader = memoryReader(jsonl(lines));
    return (await windowTail(await indexOf(reader), reader, { runtime, redactor, includeThinking })).events;
  };

  it("claude: deltas never served; tool start and end linked by id; an edit tool's input is a file_change", async () => {
    const events = await tail("claude", [claude.init(), claude.delta("par"), claude.toolUse("t1", "ls -la"), claude.toolResult("t1", "a b"), claude.write("t2", "src/x.ts", "export {}"), claude.thinking("hmm"), claude.text("done"), claude.result("done")]);
    expect(kinds(events)).toEqual(["notice", "tool_call", "tool_result", "tool_call", "file_change", "message", "result"]);
    expect(events[1]!.meta).toEqual({ id: "t1", name: "Bash" });
    expect(events[1]!.fields!.input!.text).toBe("ls -la");
    expect(events[2]!.meta).toEqual({ id: "t1" });
    expect(events[2]!.fields!.output!.text).toBe("a b");
    expect(events[4]!.fields!.path!.text).toBe("src/x.ts");
    expect(events[4]!.meta).toEqual({ change: "write" });
  });

  it("codex: item.started / item.completed linked by id, item.updated not served, file_change from codex", async () => {
    const events = await tail("codex", [codex.thread(), codex.turn(), codex.reasoning("r0", "think"), codex.message("m1", "hi"), codex.cmdStart("c1", "npm test"), codex.cmdUpdate("c1", "npm test", "partial"), codex.cmdDone("c1", "npm test", "ok", 1), codex.fileChange("f1", "a.ts"), codex.done()]);
    expect(kinds(events)).toEqual(["message", "tool_call", "tool_result", "file_change", "result"]);
    expect(events[1]!.meta!.id).toBe("c1");
    expect(events[2]!.meta!.id).toBe("c1");
    expect(events[2]!.flag!.error).toBe(true);
    expect(events[2]!.num!.exitCode).toBe(1);
  });

  it("omp (C1): one source per piece of text -- message_end, tool_execution_end; deltas and toolResult messages never", async () => {
    const events = await tail("omp", [omp.session(), omp.start(), omp.messageStart("hel"), omp.delta("hel"), omp.textEnd("hello"), omp.messageEnd("hello", "pondering"), omp.toolStart("c1", "ls"), omp.toolUpdate("c1", "partial"), omp.toolEnd("c1", "a b"), omp.toolResultEnd("c1", "a b"), omp.userEnd("next"), omp.turnEnd(), omp.end()]);
    expect(kinds(events)).toEqual(["notice", "message", "tool_call", "tool_result", "message", "notice", "result"]);
    expect(events.filter((e) => e.fields?.text?.text === "hello")).toHaveLength(1);
    expect(events.filter((e) => e.fields?.output?.text === "a b")).toHaveLength(1);
    expect(events[5]!.meta).toEqual({ notice: "turn-end" });
  });

  it("thinking is omitted unless asked (include=thinking), for every runtime", async () => {
    expect(kinds(await tail("claude", [claude.thinking("t")]))).toEqual([]);
    expect(kinds(await tail("claude", [claude.thinking("t")], true))).toEqual(["thinking"]);
    expect(kinds(await tail("codex", [codex.reasoning("r", "t")]))).toEqual([]);
    expect(kinds(await tail("codex", [codex.reasoning("r", "t")], true))).toEqual(["thinking"]);
    expect(kinds(await tail("omp", [omp.messageEnd("x", "t")]))).toEqual(["message"]);
    expect(kinds(await tail("omp", [omp.messageEnd("x", "t")], true))).toEqual(["thinking", "message"]);
  });

  it("ccloop's markers, an unknown line and an unparsable line", async () => {
    const reader = memoryReader(Buffer.from([
      JSON.stringify({ type: "ccloop.line-dropped", bytes: 12_000_000 }),
      JSON.stringify({ type: "mystery", detail: "x" }),
      "not json {\\n",
      JSON.stringify({ type: "ccloop.transcript-truncated", atBytes: 134217000 }),
    ].join("\n") + "\n"));
    const events = (await windowTail(await indexOf(reader), reader, { runtime: "codex", redactor })).events;
    expect(kinds(events)).toEqual(["notice", "unknown", "unknown", "notice"]);
    expect(events[0]!.meta).toEqual({ notice: "line-dropped" });
    expect(events[0]!.num).toEqual({ bytes: 12_000_000 });
    expect(events[1]!.fields!.raw!.text).toContain('"mystery"');
    expect(events[2]!.fields!.raw!.text).toBe("not json {\\n");
    expect(events[3]!.num).toEqual({ atBytes: 134217000 });
  });
});
