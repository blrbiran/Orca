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
import { LISTING_POLL_MS } from "../src/AgentTranscript.js";
import type { GroupViewV1, RunTranscriptsV1, TranscriptCallV1, TranscriptWindowV1 } from "../src/controlTypes.js";
import { config, run, view, workItem } from "./fixtures/board.js";

vi.mock("../src/controlApi.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/controlApi.js")>();
  return { ...real, fetchRunTranscripts: vi.fn(real.fetchRunTranscripts) };
});

const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);
let transcriptUrls: string[];
/** The call listing each run answers with; null: one recorded execute call (what the first four criteria read). */
let listing: Record<string, TranscriptCallV1[]> | null;
const recorded = (phase: string, seq: number): TranscriptCallV1 => ({ attempt: 1, phase, seq, runtime: "codex", recorded: true, bytes: 100, final: false, truncatedAt: null });
beforeEach(() => {
  vi.useFakeTimers();
  transcriptUrls = [];
  listing = null;
  vi.mocked(api.fetchRunTranscripts).mockClear();
  let end = 10;
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    let body: unknown = {};
    if (url.includes("/transcripts")) {
      transcriptUrls.push(url);
      const runId = decodeURIComponent(url.split("/runs/")[1]?.split("/")[0] ?? "");
      if (url.endsWith("/transcripts")) {
        body = { schema: "orca-run-transcripts-v1", runId, available: true, calls: listing?.[runId] ?? [recorded("execute", 1)] } satisfies RunTranscriptsV1;
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
  // Ruling (2026-11-11, session f958ec3f): human approved rewriting necessary criteria; this now encodes the tab order by
  // each tab's accessible name -- a running group's Live tab also carries a count badge, which is not part of its name.
  expect(screen.getAllByRole("tab").slice(0, 2)).toEqual([screen.getByRole("tab", { name: "Progress" }), liveTab()]);
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

// Tester D19: nothing said which agent and model a run actually ran on; its line names the frozen selection.
it("names the agent and model the running task's run was frozen with", async () => {
  const value = running();
  value.runs = value.runs.map((r) => r.runId === "run-a" ? { ...r, agent: { installation: "codex", model: "gpt-5.1-codex" } } : r);
  mount(value);
  fireEvent.click(liveTab());
  await flush();
  expect(within(livePanel()).getByRole("region", { name: "Running: a" }).textContent).toContain("codex · gpt-5.1-codex");
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

// Human, 2026-11-11 (real-browser check of T7): the Live region shows the transcript by default -- no press of "Transcript".
// autoOpen read the listing once, so a run whose first call was not yet recorded stayed closed, and execute never replaced
// plan. The Live region now follows: it re-reads the listing every LISTING_POLL_MS while shown.
const callButton = (scope: HTMLElement, phase: string, seq: number): HTMLElement =>
  within(scope).getByRole("button", { name: new RegExp(`^${phase} · call ${seq} `) });

it("opens a call recorded after Live was shown, without a press", async () => {
  // mutation: drop the listing re-read (setInterval) -> the first, empty listing is the last one read -> red
  listing = { "run-a": [] };
  mount(running());
  fireEvent.click(liveTab());
  await flush();
  expect(within(livePanel()).queryAllByTestId("transcript-call"), "nothing recorded yet").toHaveLength(0);
  listing = { "run-a": [recorded("plan", 1)] };
  await flush(LISTING_POLL_MS);
  expect(within(livePanel()).getAllByTestId("transcript-call")).toHaveLength(1);
  expect(callButton(livePanel(), "plan", 1).getAttribute("aria-expanded")).toBe("true");
});

it("moves to a newer call by itself, until the person picks one", async () => {
  // mutation: open the latest only while nothing is open -> execute never replaces plan -> red at the second check
  // mutation: ignore the person's pick -> verify replaces the plan call they chose -> red at the last check
  listing = { "run-a": [recorded("plan", 1)] };
  mount(running());
  fireEvent.click(liveTab());
  await flush();
  expect(callButton(livePanel(), "plan", 1).getAttribute("aria-expanded")).toBe("true");
  listing = { "run-a": [recorded("plan", 1), recorded("execute", 2)] };
  await flush(LISTING_POLL_MS);
  expect(callButton(livePanel(), "execute", 2).getAttribute("aria-expanded"), "the newer call is followed").toBe("true");
  expect(callButton(livePanel(), "plan", 1).getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(callButton(livePanel(), "plan", 1));
  await flush();
  listing = { "run-a": [recorded("plan", 1), recorded("execute", 2), recorded("verify", 3)] };
  await flush(LISTING_POLL_MS * 2);
  expect(callButton(livePanel(), "plan", 1).getAttribute("aria-expanded"), "the person's pick stays").toBe("true");
  expect(within(livePanel()).getAllByTestId("transcript-call")).toHaveLength(1);
});

it("keeps one followed transcript when two tasks run, instead of the two taking it from each other on every read", async () => {
  // mutation: drop heldByOtherFollower -> each listing read reopens the other run's call, re-reading its tail -> red
  const value = view(
    [workItem({ taskId: "a", status: "active", category: "running", currentRunId: "run-a", lineageRunIds: ["run-a"] }),
      workItem({ taskId: "c", status: "active", category: "running", currentRunId: "run-c", lineageRunIds: ["run-c"] })],
    [run({ runId: "run-a", taskId: "a", state: "running", startedAt: NOW - 60_000 }), run({ runId: "run-c", taskId: "c", state: "running", startedAt: NOW - 60_000 })],
  );
  mount(value);
  fireEvent.click(liveTab());
  await flush();
  await flush(LISTING_POLL_MS * 3);
  expect(within(livePanel()).getAllByTestId("transcript-call"), "one open transcript per tab (spec §10.4.4)").toHaveLength(1);
  expect(transcriptUrls.filter((url) => url.includes("tail=1")), "the open call is read from its tail once").toHaveLength(1);
});
