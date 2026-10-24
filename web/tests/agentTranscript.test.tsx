// @vitest-environment jsdom
/**
 * T8 (spec §6.4, §10.6.3, §10.7): the transcript list in the browser. Agent text is rendered as React text nodes --
 * markup in it stays text; at most 200 event rows are mounted however many events a long follow delivers (here 10 000);
 * `thinking` is never asked for (`include=thinking` is not sent in v1) and never rendered.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_ROWS, RunTranscript } from "../src/AgentTranscript.js";
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
});
