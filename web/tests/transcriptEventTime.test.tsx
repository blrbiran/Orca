// @vitest-environment jsdom
/**
 * Tester #301 (regression from #281): each transcript row led with `new Date(event.at)`, but `event.at` is the byte offset
 * of the event's line in the transcript file (`src/agentTranscript/window.ts`, `ServedEvent.at`), the paging and expand
 * address -- so every row read as a time just after 1970-01-01. An event carries no time of its own, so a row shows none;
 * the call's start (`startedAt`, a real ISO time from the listing) stays on the call's row. The rows keep the list
 * semantics with the browser's numbering hidden (#281: those numbers were a position in the 200-row window).
 *
 * Ruling (2026-11-13, tester follow-up J): 「这次批准改写所有必要的判据」 -- this file replaces the #281 criterion, whose
 * fixture set `at` to epoch milliseconds (`BASE + n * 1000`), a value the server never sends, so it could not go red
 * on the bug it was meant to guard.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunTranscript } from "../src/AgentTranscript.js";
import type { RunTranscriptsV1, TranscriptEventV1, TranscriptWindowV1 } from "../src/controlTypes.js";

const RUN = "run-a";
// Built from local fields, so the expected clock text holds in any time zone the suite runs in.
const STARTED_AT = new Date(2026, 10, 13, 16, 26, 39).toISOString();
const LISTING: RunTranscriptsV1 = { schema: "orca-run-transcripts-v1", runId: RUN, available: true, calls: [{ attempt: 1, phase: "execute", seq: 1, runtime: "claude", recorded: true, bytes: 4000, final: true, truncatedAt: null, startedAt: STARTED_AT }] };
// What the server sends: `at` is a byte offset into the transcript file (the live case had 511, 805, 1571).
const OFFSETS = [511, 805, 1571];
const message = (at: number, n: number): TranscriptEventV1 => ({ at, i: 0, kind: "message", meta: { role: "assistant" }, fields: { text: { text: `event ${n}`, length: 7, more: false } } });
const WINDOW: TranscriptWindowV1 = { schema: "orca-transcript-window-v1", runId: RUN, attempt: 1, phase: "execute", seq: 1, runtime: "claude", source: "run", final: true, truncatedAt: null, events: OFFSETS.map(message), start: 0, end: 4000, indexedEnd: 4000, counted: 0 };

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> =>
    new Response(JSON.stringify(String(input).endsWith("/transcripts") ? LISTING : WINDOW), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const flush = async (): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
const opened = async (): Promise<void> => {
  render(<RunTranscript runId={RUN} active />);
  fireEvent.click(screen.getByRole("button", { name: "Transcript" }));
  await flush();
  fireEvent.click(screen.getByRole("button", { name: /^execute · claude · / }));
  await flush();
};

describe("tester #301: a transcript row shows no time made from a byte offset", () => {
  it("renders no <time> in any row, and no 1970 date anywhere in the transcript", async () => {
    await opened();
    const rows = screen.getAllByTestId("transcript-event");
    expect(rows).toHaveLength(3);
    // mutation: restore the row's eventTime(event.at) -> each row has a <time> (datetime 1970-01-01T00:00:00.511Z), red
    for (const row of rows) expect(row.querySelector("time")).toBeNull();
    // mutation: restore it -> the 1970 date is in the datetime attributes, red
    const box = rows[0]!.closest("ol")!.parentElement!.parentElement!;
    expect(box.innerHTML).not.toContain("1970");
    // The row is the event's line, nothing before it.
    expect(rows[0]!.textContent).toBe("message assistant: event 0");
  });

  it("keeps the call's real start on the call's row, around the open call's rows", async () => {
    await opened();
    const started = screen.getByTestId("transcript-call-started");
    // mutation: drop startedTime from the call row -> no start shown, red
    expect(started.getAttribute("datetime")).toBe(STARTED_AT);
    expect(started.textContent).toBe("16:26:39");
    // The open call's rows sit under that call's row.
    expect(started.closest("li")!.querySelectorAll("[data-testid='transcript-event']")).toHaveLength(3);
  });

  it("keeps the list a list and hides its numbering", async () => {
    await opened();
    const list = screen.getAllByTestId("transcript-event")[0]!.closest("ol")!;
    expect(list.getAttribute("role")).toBe("list");
    // mutation: drop list-none -> the browser's 1. 2. 3. come back, red
    expect(list.className.split(/\s+/)).toContain("list-none");
  });
});
