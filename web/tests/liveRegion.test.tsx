// @vitest-environment jsdom
/**
 * #226 (i) (plan 2026-11-10-tester-followup-b T7): to see what an agent is doing the person had to open Runs, find the
 * row and expand it. The group detail's Live region lists the work running now, each with its run's transcript open and
 * its phase, attempt, tokens and elapsed time; with nothing running it shows the most recent run. Hidden panes stay
 * mounted, so the transcript must ask nothing while Live is not the region shown.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as api from "../src/controlApi.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { GroupViewV1, RunTranscriptsV1, TranscriptWindowV1 } from "../src/controlTypes.js";
import { config, run, view, workItem } from "./fixtures/board.js";

vi.mock("../src/controlApi.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/controlApi.js")>();
  return { ...real, fetchRunTranscripts: vi.fn(real.fetchRunTranscripts) };
});

const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);
let transcriptUrls: string[];
beforeEach(() => {
  vi.useFakeTimers();
  transcriptUrls = [];
  vi.mocked(api.fetchRunTranscripts).mockClear();
  let end = 10;
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    let body: unknown = {};
    if (url.includes("/transcripts")) {
      transcriptUrls.push(url);
      const runId = decodeURIComponent(url.split("/runs/")[1]?.split("/")[0] ?? "");
      if (url.endsWith("/transcripts")) {
        body = { schema: "orca-run-transcripts-v1", runId, available: true, calls: [{ attempt: 1, phase: "execute", seq: 1, runtime: "codex", recorded: true, bytes: 100, final: false, truncatedAt: null }] } satisfies RunTranscriptsV1;
      } else {
        const start = url.includes("tail=1") ? 0 : end; end = start + 10;
        body = { schema: "orca-transcript-window-v1", runId, attempt: 1, phase: "execute", seq: 1, runtime: "codex", source: "run", final: false, truncatedAt: null,
          events: [{ at: start, i: 0, kind: "message", meta: { role: "assistant" }, fields: { text: { text: `at ${start}`, length: 5, more: false } } }], start, end, indexedEnd: end, counted: 0 } satisfies TranscriptWindowV1;
      }
    }
    return new Response(JSON.stringify(body), { status: url.includes("/transcripts") ? 200 : 404, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});
afterEach(() => { cleanup(); vi.useRealTimers(); Reflect.deleteProperty(document, "visibilityState"); });

const flush = async (ms = 0): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const mount = (value: GroupViewV1) =>
  render(<ControlGroupView view={value} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} now={NOW} />);
const liveTab = (): HTMLElement => screen.getByRole("tab", { name: "Live" });
const livePanel = (): HTMLElement => screen.getByRole("tabpanel", { name: "Live" });

const running = (): GroupViewV1 => view(
  [workItem({ taskId: "a", status: "active", category: "running", currentRunId: "run-a", lineageRunIds: ["run-a"] }),
    workItem({ taskId: "b", status: "completed", category: "done", currentRunId: "run-b", lineageRunIds: ["run-b"] })],
  [run({ runId: "run-a", taskId: "a", state: "running", phase: "work", providerAttemptOrdinal: 2, used: { tokens: 1234, activeMs: 0, attempts: 2, sessions: 1 }, startedAt: NOW - 7 * 60_000 }),
    run({ runId: "run-b", taskId: "b", state: "landed", startedAt: NOW - 60 * 60_000 })],
);

it("sits right after Progress among the region tabs", () => {
  mount(running());
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent).slice(0, 2)).toEqual(["Progress", "Live"]);
});

it("lists the running task with its run's facts and its transcript open, and leaves finished work out", async () => {
  mount(running());
  fireEvent.click(liveTab());
  await flush();
  const item = within(livePanel()).getByRole("region", { name: "Running: a" });
  expect(item.textContent).toContain("work");
  expect(item.textContent).toContain("attempt 2");
  expect(item.textContent).toContain("1.2K tokens");
  expect(item.textContent).toContain("7 min");
  const transcript = within(item).getByRole("region", { name: "Transcript of run-a" });
  expect(within(transcript).getByRole("button", { name: "Transcript" }).getAttribute("aria-expanded")).toBe("true");
  expect(within(transcript).getAllByTestId("transcript-call")).toHaveLength(1);
  expect(within(livePanel()).queryByRole("region", { name: "Running: b" })).toBeNull();
  expect(within(livePanel()).queryByRole("region", { name: "Transcript of run-b" })).toBeNull();
});

it("asks nothing for the transcript while Live is hidden, and stops polling when the person leaves it", async () => {
  mount(running());
  await flush(5000);
  expect(transcriptUrls, "nothing asked while another region shows").toEqual([]);
  expect(api.fetchRunTranscripts).not.toHaveBeenCalled();
  fireEvent.click(liveTab());
  await flush();
  expect(vi.mocked(api.fetchRunTranscripts).mock.calls).toEqual([["run-a"]]);
  await flush(5000);
  expect(transcriptUrls.filter((url) => url.includes("after=")).length, "an open live call polls while shown").toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("tab", { name: "Progress" }));
  await flush();
  const asked = transcriptUrls.length;
  await flush(10_000);
  expect(transcriptUrls.slice(asked), "no poll once Live is hidden").toEqual([]);
});

it("shows the most recent run when nothing runs", async () => {
  const value = view([workItem({ taskId: "a", status: "completed", category: "done", currentRunId: "run-2", lineageRunIds: ["run-1", "run-2"] })],
    [run({ runId: "run-2", state: "landed", createdOrdinal: 2 }), run({ runId: "run-1", state: "landed", createdOrdinal: 1 })]);
  value.summary.state = "done";
  mount(value);
  fireEvent.click(liveTab());
  await flush();
  expect(within(livePanel()).getByText("Nothing is running. The most recent run:")).toBeTruthy();
  expect(within(livePanel()).getByRole("region", { name: "Transcript of run-2" })).toBeTruthy();
  expect(within(livePanel()).queryByRole("region", { name: "Transcript of run-1" })).toBeNull();
});
