// @vitest-environment jsdom
/**
 * T8 (spec §6.4, §10.6.3, §10.7): the transcript list in the browser. Agent text is rendered as React text nodes --
 * markup in it stays text; at most 200 event rows are mounted however many events a long follow delivers (here 10 000);
 * `thinking` is never asked for (`include=thinking` is not sent in v1) and never rendered.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_KEPT, MAX_ROWS, mergeWindow, RunTranscript } from "../src/AgentTranscript.js";
import type { RunTranscriptsV1, TranscriptEventV1, TranscriptWindowV1 } from "../src/controlTypes.js";

const RUN = "run-a";
const LISTING: RunTranscriptsV1 = { schema: "orca-run-transcripts-v1", runId: RUN, available: true, calls: [{ attempt: 1, phase: "execute", seq: 1, runtime: "claude", recorded: true, bytes: 100, final: false, truncatedAt: null }] };
const message = (at: number, text: string, kind: TranscriptEventV1["kind"] = "message"): TranscriptEventV1 => ({ at, i: 0, kind, meta: { role: "assistant" }, fields: { text: { text, length: text.length, more: false } } });
const win = (events: TranscriptEventV1[], start: number, end: number, final = false): TranscriptWindowV1 => ({ schema: "orca-transcript-window-v1", runId: RUN, attempt: 1, phase: "execute", seq: 1, runtime: "claude", source: "run", final, truncatedAt: null, events, start, end, indexedEnd: end, counted: 0 });

let urls: string[];
let answer: (url: string) => unknown;
beforeEach(() => {
  urls = [];
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    urls.push(url);
    return new Response(JSON.stringify(answer(url)), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

const flush = async (): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
async function openCall(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Transcript" }));
  await flush();
  fireEvent.click(screen.getByRole("button", { name: /execute · call 1/ }));
  await flush();
}

describe("T8: the transcript list", () => {
  it("renders agent markup as text: no element is made from it", async () => {
    vi.useFakeTimers();
    const evil = `<img src=x onerror="document.body.dataset.owned='1'"> and <b>bold</b>`;
    answer = (url) => (url.endsWith("/transcripts") ? LISTING : url.includes("tail=1") ? win([message(0, evil)], 0, 100, true) : win([], 100, 100, true));
    const { container } = render(<RunTranscript runId={RUN} active />);
    await openCall();
    const row = screen.getAllByTestId("transcript-event")[0]!;
    fireEvent.click(row.querySelector("button")!);
    await flush();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(row.textContent).toContain("<img src=x onerror=");
    expect(document.body.dataset.owned).toBeUndefined();
  });

  it("keeps at most 200 event rows mounted while a follow delivers 10 000 events", async () => {
    vi.useFakeTimers();
    let next = 0;
    const batch = (): TranscriptEventV1[] => Array.from({ length: 200 }, () => { next += 1; return message(next * 10, `event ${next}`); });
    answer = (url) => {
      if (url.endsWith("/transcripts")) return LISTING;
      const start = next * 10 + 10;
      const events = batch();
      return win(events, url.includes("tail=1") ? 10 : start, next * 10 + 10, false);
    };
    render(<RunTranscript runId={RUN} active />);
    await openCall();
    expect(screen.getAllByTestId("transcript-event")).toHaveLength(MAX_ROWS);
    for (let poll = 0; poll < 49; poll++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(screen.getAllByTestId("transcript-event").length).toBeLessThanOrEqual(MAX_ROWS);
    }
    expect(next).toBe(10_000);
    const rows = screen.getAllByTestId("transcript-event");
    expect(rows).toHaveLength(MAX_ROWS);
    expect(rows.at(-1)!.textContent).toContain("event 10000");
    fireEvent.click(screen.getByRole("button", { name: "Earlier" }));
    fireEvent.click(screen.getByRole("button", { name: "Earlier" }));
    expect(screen.getAllByTestId("transcript-event").length).toBeLessThanOrEqual(MAX_ROWS);
    expect(MAX_ROWS).toBe(200);
  });

  it("never asks for thinking and never renders it", async () => {
    vi.useFakeTimers();
    answer = (url) => (url.endsWith("/transcripts") ? LISTING : win([message(0, "pondering secretly", "thinking"), message(10, "visible answer")], 0, 20, true));
    const { container } = render(<RunTranscript runId={RUN} active />);
    await openCall();
    expect(container.textContent).toContain("visible answer");
    expect(container.textContent).not.toContain("pondering secretly");
    // Not even a collapsed row (whose first line would hide the text) is mounted for it.
    expect(screen.getAllByTestId("transcript-event")).toHaveLength(1);
    expect(container.querySelector(".transcript-thinking")).toBeNull();
    expect(urls.length).toBeGreaterThan(1);
    for (const url of urls) expect(url).not.toContain("include=thinking");
  });

  it("asks for nothing while it is not the active region (review minor 6)", async () => {
    vi.useFakeTimers();
    answer = () => LISTING;
    render(<RunTranscript runId={RUN} active={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Transcript" }));
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(urls).toEqual([]);
  });
});

describe("review 7753e97d: what one open call keeps, and its Earlier/Later", () => {
  const run = (from: number, to: number): TranscriptEventV1[] => Array.from({ length: to - from }, (_, k) => message((from + k) * 10, `event ${from + k}`));

  it("mergeWindow keeps MAX_KEPT events: a follow drops the oldest and moves start; an Earlier drops the newest and moves end", () => {
    const tail = mergeWindow(null, win(run(0, MAX_KEPT), 0, MAX_KEPT * 10), "tail");
    const followed = mergeWindow(tail, win(run(MAX_KEPT, MAX_KEPT + 100), MAX_KEPT * 10, (MAX_KEPT + 100) * 10), "after");
    expect(followed.events).toHaveLength(MAX_KEPT);
    expect(followed.start).toBe(1000);
    expect(followed.events[0]!.at).toBe(followed.start);
    const pinned = mergeWindow(null, win(run(1900, 2100), 19000, 21000, true), "tail");
    const earlier = mergeWindow(pinned, win(run(0, 1900), 0, 19000, true), "before");
    expect(earlier.events).toHaveLength(MAX_KEPT);
    expect(earlier.start).toBe(0);
    expect(earlier.end).toBe(20000);
    expect(earlier.latest).toBe(21000);
  });

  it("Earlier past MAX_KEPT drops the newest; Later at the end reads them back", async () => {
    vi.useFakeTimers();
    answer = (url) => {
      if (url.endsWith("/transcripts")) return LISTING;
      if (url.includes("tail=1")) return win(run(1900, 2100), 19000, 21000, true);
      if (url.includes("before=19000")) return win(run(0, 1900), 0, 19000, true);
      if (url.includes("after=20000")) return win(run(2000, 2100), 20000, 21000, true);
      return win([], 21000, 21000, true);
    };
    const { container } = render(<RunTranscript runId={RUN} active />);
    await openCall();
    fireEvent.click(screen.getByRole("button", { name: "Earlier" }));
    await flush();
    expect(urls.some((url) => url.includes("before=19000"))).toBe(true);
    // The view stays next to where it was: the rows just before the previous first row.
    expect(screen.getAllByTestId("transcript-event")[0]!.textContent).toContain("event 1800");
    for (let k = 0; k < 3 && !urls.some((url) => url.includes("after=")); k++) {
      fireEvent.click(screen.getByRole("button", { name: "Later" }));
      await flush();
    }
    expect(urls.filter((url) => url.includes("after="))).toEqual([expect.stringContaining("after=20000")]);
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    await flush();
    expect(container.textContent).toContain("event 2099");
  });

  it("an Earlier clicked while a follow poll is in flight is queued, not dropped", async () => {
    vi.useFakeTimers();
    let release: (() => void) | null = null;
    const base = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      if (String(input).includes("after=")) await new Promise<void>((resolve) => { release = resolve; });
      return base(input);
    }) as typeof fetch;
    answer = (url) => (url.endsWith("/transcripts") ? LISTING : url.includes("tail=1") ? win([message(100, "newest")], 100, 200) : url.includes("before=") ? win([message(0, "oldest")], 0, 100) : win([], 200, 200));
    const { container } = render(<RunTranscript runId={RUN} active />);
    await openCall();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(release).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Earlier" }));
    await flush();
    release!();
    await flush();
    await flush();
    expect(urls.some((url) => url.includes("before=100"))).toBe(true);
    expect(container.textContent).toContain("oldest");
  });

  it("a composite tool input is summarised by its first key, not `{`", async () => {
    vi.useFakeTimers();
    const input = JSON.stringify({ file_path: "src/x.ts", content: "x" }, null, 2);
    const tool: TranscriptEventV1 = { at: 0, i: 0, kind: "tool_call", meta: { name: "Write" }, fields: { input: { text: input, length: input.length, more: false } } };
    answer = (url) => (url.endsWith("/transcripts") ? LISTING : win([tool], 0, 10, true));
    render(<RunTranscript runId={RUN} active />);
    await openCall();
    expect(screen.getAllByTestId("transcript-event")[0]!.textContent).toContain('Write file_path: "src/x.ts"');
  });
});

