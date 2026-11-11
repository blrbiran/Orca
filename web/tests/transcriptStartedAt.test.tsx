// @vitest-environment jsdom
/**
 * Tester #252, second half (spec docs/superpowers/specs/2026-11-12-tester-followup-f-design.md §6): each call in the
 * transcript list shows when it started -- a compact local clock time, the full date on hover -- so a re-plan after an
 * execute reads as later. A call the listing has no time for (an older ccloop) shows none rather than a made-up one.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunTranscript } from "../src/AgentTranscript.js";
import type { RunTranscriptsV1, TranscriptCallV1 } from "../src/controlTypes.js";
import { RUN } from "./fixtures/transcript.js";

const call = (over: Partial<TranscriptCallV1> = {}): TranscriptCallV1 => ({ attempt: 1, phase: "execute", seq: 1, runtime: "claude", recorded: true, bytes: 100, final: true, truncatedAt: null, ...over });
let listing: RunTranscriptsV1;
beforeEach(() => {
  vi.useFakeTimers();
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    return new Response(JSON.stringify(url.endsWith("/transcripts") ? listing : {}), { status: url.endsWith("/transcripts") ? 200 : 404, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});
afterEach(() => { cleanup(); vi.useRealTimers(); Reflect.deleteProperty(document, "visibilityState"); });

describe("tester #252: a call's start time in the transcript list", () => {
  it("shows a known start as the local hh:mm:ss beside its call, and nothing for a call without one", async () => {
    // Built from local fields, so the expected clock text holds in any time zone the suite runs in.
    const startedAt = new Date(2026, 9, 24, 13, 5, 9).toISOString();
    listing = { schema: "orca-run-transcripts-v1", runId: RUN, available: true, calls: [call({ phase: "plan", startedAt }), call()] };
    render(<RunTranscript runId={RUN} active />);
    fireEvent.click(screen.getByRole("button", { name: "Transcript" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    // mutation: drop the <time> from the call row -> none rendered, red
    // mutation: render it for every call (e.g. an empty time for an untimed one) -> two, red
    const times = screen.getAllByTestId("transcript-call-started");
    expect(times).toHaveLength(1);
    const time = times[0]!;
    // mutation: show the ISO string / the UTC clock / a 12-hour clock -> the text is not 13:05:09, red
    expect(time.textContent).toBe("13:05:09");
    expect(time.getAttribute("datetime")).toBe(startedAt);
    // mutation: drop the title -> the date is not reachable on hover, red
    expect(time.getAttribute("title")).toBe(new Date(startedAt).toLocaleString("en"));
    // It sits in the plan call's row, not the execute call's.
    expect(time.closest("li")?.textContent).toContain("plan · claude · 100 B");
    expect(time.closest("li")?.textContent).not.toContain("execute");
  });
});
