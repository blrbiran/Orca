// @vitest-environment jsdom
/**
 * Tester #281 (1): a transcript row led with "1. / 2. / 3." -- the <ol>'s own marker, a position in the 200-row window,
 * which changed under Earlier/Later, so the same event read as a different number. Each row now leads with the event's
 * own time (`event.at`: a local hh:mm:ss, the full date on hover); the list keeps its semantics with the marker hidden,
 * and an event shows the same time whatever window holds it.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunTranscript } from "../src/AgentTranscript.js";
import type { RunTranscriptsV1, TranscriptEventV1, TranscriptWindowV1 } from "../src/controlTypes.js";

const RUN = "run-a";
const LISTING: RunTranscriptsV1 = { schema: "orca-run-transcripts-v1", runId: RUN, available: true, calls: [{ attempt: 1, phase: "execute", seq: 1, runtime: "claude", recorded: true, bytes: 100, final: true, truncatedAt: null }] };
// Built from local fields, so the expected clock text holds in any time zone the suite runs in.
const BASE = new Date(2026, 9, 24, 13, 0, 0).getTime();
const message = (n: number): TranscriptEventV1 => ({ at: BASE + n * 1000, i: 0, kind: "message", meta: { role: "assistant" }, fields: { text: { text: `event ${n}`, length: 9, more: false } } });
const EVENTS = Array.from({ length: 400 }, (_, n) => message(n));
const WINDOW: TranscriptWindowV1 = { schema: "orca-transcript-window-v1", runId: RUN, attempt: 1, phase: "execute", seq: 1, runtime: "claude", source: "run", final: true, truncatedAt: null, events: EVENTS, start: 0, end: BASE + 400_000, indexedEnd: BASE + 400_000, counted: 0 };

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> =>
    new Response(JSON.stringify(String(input).endsWith("/transcripts") ? LISTING : WINDOW), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const flush = async (): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
const rowOf = (text: string): HTMLElement => screen.getAllByTestId("transcript-event").find((row) => row.textContent?.includes(text))!;
const timeOf = (text: string): Element => rowOf(text).querySelector("[data-testid='transcript-event-time']")!;

describe("tester #281: a transcript row's time", () => {
  it("leads each row with its event's local hh:mm:ss, the full date on hover, the same across Earlier", async () => {
    render(<RunTranscript runId={RUN} active />);
    fireEvent.click(screen.getByRole("button", { name: "Transcript" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /^execute · claude · / }));
    await flush();
    // event 250 = 13:04:10 local.
    const at = new Date(BASE + 250_000);
    // mutation: drop eventTime from the row -> no <time>, red
    // mutation: show the row's index in the window instead of event.at -> not 13:04:10, red
    expect(timeOf("event 250").textContent).toBe("13:04:10");
    expect(timeOf("event 250").getAttribute("datetime")).toBe(at.toISOString());
    // mutation: drop the title -> the date is not reachable on hover, red
    expect(timeOf("event 250").getAttribute("title")).toBe(at.toLocaleString("en"));
    expect(rowOf("event 399")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Earlier" }));
    await flush();
    // The window moved (event 399 is out of it), and event 250 still shows its own time.
    expect(rowOf("event 399")).toBeUndefined();
    expect(timeOf("event 250").textContent).toBe("13:04:10");
  });

  it("keeps the list a list and hides its numbering", async () => {
    render(<RunTranscript runId={RUN} active />);
    fireEvent.click(screen.getByRole("button", { name: "Transcript" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /^execute · claude · / }));
    await flush();
    const list = screen.getAllByTestId("transcript-event")[0]!.closest("ol")!;
    expect(list.getAttribute("role")).toBe("list");
    // mutation: drop list-none -> the browser's 1. 2. 3. come back, red
    expect(list.className.split(/\s+/)).toContain("list-none");
  });
});
