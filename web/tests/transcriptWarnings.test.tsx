// @vitest-environment jsdom
/**
 * Tester #375: an omp phase's MCP readiness warning used to exist only in the per-call `stderr.log`. ccloop records it on
 * the transcript entry; the transcript list (the place a person actually looks) has to show it beside that call.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunTranscript } from "../src/AgentTranscript.js";
import type { RunTranscriptsV1, TranscriptCallV1 } from "../src/controlTypes.js";
import { RUN } from "./fixtures/transcript.js";

const call = (over: Partial<TranscriptCallV1> = {}): TranscriptCallV1 => ({ attempt: 1, phase: "execute", seq: 1, runtime: "omp", recorded: true, bytes: 100, final: true, truncatedAt: null, ...over });
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

describe("tester #375: an omp call's launch warnings in the transcript list", () => {
  it("shows the warning in that call's row and nowhere else", async () => {
    const warning = 'Warning: MCP server "rea" not ready after 2000ms; its tools are unavailable for this run.';
    listing = { schema: "orca-run-transcripts-v1", runId: RUN, available: true, calls: [
      call({ phase: "plan", warnings: [warning] }), call({ phase: "verify" }),
    ] };
    render(<RunTranscript runId={RUN} active />);
    fireEvent.click(screen.getByRole("button", { name: "Transcript" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    // mutation: drop the warnings render -> not rendered, red
    expect(screen.getByText(warning)).toBeTruthy();
    expect(screen.getByText(warning).closest("li")?.textContent).toContain("plan");
    expect(screen.getByText(warning).closest("li")?.textContent).not.toContain("verify");
  });
});
