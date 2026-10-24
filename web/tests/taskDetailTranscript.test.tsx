// @vitest-environment jsdom
/**
 * T12 (spec §12.3, §12.4 C8): the transcript is mounted on the task detail's run list and in the group's runs table.
 * Each renders a collapsed disclosure that asks nothing until opened; opening calls the shared helper the flow page
 * uses (a spy on the shared module); an open, non-final call polls, and stops when it is final, when `active` turns
 * false (task detail: the group pane hidden; runs table: another region), and when the document is hidden. Opening a
 * transcript in one place closes the one open in the other (one per tab). An archived group still opens it.
 */
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/controlApi.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { GroupViewV1, RunTranscriptsV1, TranscriptWindowV1 } from "../src/controlTypes.js";
import { config, RUN, view } from "./fixtures/transcript.js";

vi.mock("../src/controlApi.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/controlApi.js")>();
  return { ...real, fetchRunTranscripts: vi.fn(real.fetchRunTranscripts), fetchTranscriptWindow: vi.fn(real.fetchTranscriptWindow) };
});

const LISTING: RunTranscriptsV1 = { schema: "orca-run-transcripts-v1", runId: RUN, available: true, calls: [{ attempt: 1, phase: "execute", seq: 1, runtime: "codex", recorded: true, bytes: 100, final: false, truncatedAt: null }] };
let finalNow = false;
let transcriptUrls: string[];
const win = (start: number, end: number): TranscriptWindowV1 => ({
  schema: "orca-transcript-window-v1", runId: RUN, attempt: 1, phase: "execute", seq: 1, runtime: "codex", source: "run", final: finalNow, truncatedAt: null,
  events: start === end ? [] : [{ at: start, i: 0, kind: "message", meta: { role: "assistant" }, fields: { text: { text: `at ${start}`, length: 5, more: false } } }], start, end, indexedEnd: end, counted: 0,
});

beforeEach(() => {
  vi.useFakeTimers();
  finalNow = false;
  transcriptUrls = [];
  vi.mocked(api.fetchRunTranscripts).mockClear();
  vi.mocked(api.fetchTranscriptWindow).mockClear();
  let end = 10;
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    let body: unknown = {};
    if (url.includes("/transcripts")) {
      transcriptUrls.push(url);
      if (url.endsWith("/transcripts")) body = LISTING;
      else if (url.includes("tail=1")) body = win(0, end);
      else { const start = end; end += 10; body = win(start, end); }
    }
    return new Response(JSON.stringify(body), { status: url.includes("/transcripts") ? 200 : 404, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});
afterEach(() => { cleanup(); vi.useRealTimers(); Reflect.deleteProperty(document, "visibilityState"); });

const flush = async (ms = 0): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const props = (over: Partial<Parameters<typeof ControlGroupView>[0]> = {}, groupView: GroupViewV1 = view): Parameters<typeof ControlGroupView>[0] =>
  ({ view: groupView, config, uncertain: [], drafts: {}, onDraft: vi.fn(), onCommand: vi.fn(), route: { region: "runs", taskId: "a" }, ...over });
const taskDetail = (root: HTMLElement): HTMLElement => root.querySelector('[data-task-id="a"]') as HTMLElement;
const runsRow = (root: HTMLElement): HTMLElement => root.querySelector(`tr[data-run-id="${RUN}"]`) as HTMLElement;
async function openIn(scope: HTMLElement): Promise<void> {
  fireEvent.click(within(scope).getByRole("button", { name: "Transcript" }));
  await flush();
  fireEvent.click(within(scope).getByRole("button", { name: /execute · call 1/ }));
  await flush();
}
const polls = (): number => transcriptUrls.filter((url) => url.includes("after=")).length;

describe("T12: the task detail and the runs table", () => {
  it("each renders a collapsed disclosure that asks nothing until opened, then calls the shared helper with its run id", async () => {
    const { container } = render(<ControlGroupView {...props()} />);
    await flush(5000);
    expect(within(taskDetail(container)).getByRole("button", { name: "Transcript" }).getAttribute("aria-expanded")).toBe("false");
    expect(within(runsRow(container)).getByRole("button", { name: "Transcript" }).getAttribute("aria-expanded")).toBe("false");
    expect(transcriptUrls).toEqual([]);
    fireEvent.click(within(taskDetail(container)).getByRole("button", { name: "Transcript" }));
    await flush();
    expect(api.fetchRunTranscripts).toHaveBeenCalledWith(RUN);
    fireEvent.click(within(runsRow(container)).getByRole("button", { name: "Transcript" }));
    await flush();
    expect(api.fetchRunTranscripts).toHaveBeenCalledTimes(2);
    expect(transcriptUrls).toEqual([`/api/control/runs/${RUN}/transcripts`, `/api/control/runs/${RUN}/transcripts`]);
  });

  it("an open, non-final call polls, and stops when the call is final", async () => {
    const { container } = render(<ControlGroupView {...props()} />);
    await openIn(taskDetail(container));
    expect(api.fetchTranscriptWindow).toHaveBeenCalledWith(RUN, { attempt: 1, phase: "execute", seq: 1 }, { tail: true });
    await flush(3000);
    expect(polls()).toBe(3);
    finalNow = true;
    await flush(1000);
    const settled = polls();
    await flush(5000);
    expect(polls()).toBe(settled);
  });

  it("task detail: stops polling when the group pane is hidden (active false)", async () => {
    const { container, rerender } = render(<ControlGroupView {...props()} />);
    await openIn(taskDetail(container));
    await flush(2000);
    expect(polls()).toBe(2);
    rerender(<ControlGroupView {...props({ active: false })} />);
    await flush(5000);
    expect(polls()).toBe(2);
  });

  it("runs table: stops polling when another region is selected", async () => {
    const { container } = render(<ControlGroupView {...props({ route: { region: "runs", taskId: null } })} />);
    await openIn(runsRow(container));
    await flush(2000);
    expect(polls()).toBe(2);
    fireEvent.click(within(container).getByRole("tab", { name: "Progress" }));
    await flush(5000);
    expect(polls()).toBe(2);
  });

  it("stops polling when the document is hidden", async () => {
    const { container } = render(<ControlGroupView {...props()} />);
    await openIn(taskDetail(container));
    await flush(2000);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    const hidden = polls();
    await flush(5000);
    expect(polls()).toBe(hidden);
  });

  it("opening a transcript in the runs table closes the one open in the task detail (one per tab)", async () => {
    const { container } = render(<ControlGroupView {...props()} />);
    await openIn(taskDetail(container));
    expect(within(taskDetail(container)).getAllByTestId("transcript-call")).toHaveLength(1);
    await openIn(runsRow(container));
    expect(within(runsRow(container)).getAllByTestId("transcript-call")).toHaveLength(1);
    expect(within(taskDetail(container)).queryAllByTestId("transcript-call")).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid="transcript-call"]')).toHaveLength(1);
  });

  it("an archived group still opens it (read-only)", async () => {
    const archived: GroupViewV1 = { ...view, summary: { ...view.summary, archived: true } };
    const { container } = render(<ControlGroupView {...props({}, archived)} />);
    await openIn(taskDetail(container));
    expect(within(taskDetail(container)).getAllByTestId("transcript-event")[0]!.textContent).toContain("at 0");
  });
});
