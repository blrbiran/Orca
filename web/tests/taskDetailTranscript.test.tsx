// @vitest-environment jsdom
/**
 * T12 (spec §12.3, §12.4 C8): the transcript is mounted on the task detail's run list and in the group's runs table.
 * The runs table's is a collapsed disclosure that asks nothing until opened; the task detail's, for the task's current
 * run, opens by itself on the latest call while its pane is active (tester #113; ruling: human 「这次批准改写所有必要的判据」).
 * Opening calls the shared helper the flow page uses (a spy on the shared module); an open, non-final call polls, and stops when it is final, when `active` turns
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
const runsRow = (root: HTMLElement): HTMLElement => {
  const row = root.querySelector(`tr[data-run-id="${RUN}"]`) as HTMLElement;
  const detail = root.querySelector(`tr[data-run-detail="${RUN}"]`) as HTMLElement | null;
  if (detail !== null) return detail;
  // Ruling: one run-row disclosure opens the full-width transcript and evidence detail.
  fireEvent.click(row.querySelector('button[aria-expanded]')!);
  return root.querySelector(`tr[data-run-detail="${RUN}"]`) as HTMLElement;
};
async function openIn(scope: HTMLElement): Promise<void> {
  // Ruling: the task's current run and an expanded run row both open the latest recorded call.
  await flush();
}
const polls = (): number => transcriptUrls.filter((url) => url.includes("after=")).length;

describe("the task's current run opens by itself (tester #113)", () => {
  const disclosure = (scope: HTMLElement): HTMLElement => within(scope).getByRole("button", { name: "Transcript" });
  const useCalls = (calls: RunTranscriptsV1["calls"], available = true): void => {
    vi.mocked(api.fetchRunTranscripts).mockResolvedValueOnce({ ...LISTING, available, calls });
  };
  const call = LISTING.calls[0]!;

  // mutation: the auto read is removed -> the person has to press twice again to see what the agent is doing -> red
  it("reads the listing once and shows the latest call, without the person pressing anything", async () => {
    const { container } = render(<ControlGroupView {...props()} />);
    await flush();
    expect(disclosure(taskDetail(container)).getAttribute("aria-expanded")).toBe("true");
    expect(api.fetchRunTranscripts).toHaveBeenCalledTimes(1);
    expect(within(taskDetail(container)).getAllByTestId("transcript-call")).toHaveLength(1);
    expect(api.fetchTranscriptWindow).toHaveBeenCalledWith(RUN, { attempt: 1, phase: "execute", seq: 1 }, { tail: true });
  });

  // mutation: .at(-1) becomes [0], or the recorded filter is dropped -> the oldest call, or a call with nothing to read -> red
  it("picks the last recorded call of the last attempt", async () => {
    useCalls([call, { ...call, attempt: 2, seq: 2 }, { ...call, attempt: 2, seq: 3, recorded: false }]);
    render(<ControlGroupView {...props()} />);
    await flush();
    expect(api.fetchTranscriptWindow).toHaveBeenCalledTimes(1);
    expect(api.fetchTranscriptWindow).toHaveBeenCalledWith(RUN, { attempt: 2, phase: "execute", seq: 2 }, { tail: true });
  });

  // mutation: autoOpen is passed for every run -> each old run reads its listing and steals the one open transcript -> red
  it("leaves an older run of the same task closed and unread", async () => {
    const older = { ...view.runs[0]!, runId: "run-older" };
    const both: GroupViewV1 = { ...view, runs: [older, ...view.runs] };
    const { container } = render(<ControlGroupView {...props({ route: { region: "progress", taskId: "a" } }, both)} />);
    await flush();
    expect(within(taskDetail(container).querySelector('section[aria-label="Transcript of run-older"]') as HTMLElement).getByRole("button", { name: "Transcript" }).getAttribute("aria-expanded")).toBe("false");
    expect(vi.mocked(api.fetchRunTranscripts).mock.calls).toEqual([[RUN]]);
  });

  // mutation: the active test is dropped from the read -> a hidden pane asks for transcripts and starts a poll -> red
  it("asks nothing from a hidden pane, and opens when the pane shows", async () => {
    const { container, rerender } = render(<ControlGroupView {...props({ active: false })} />);
    await flush(5000);
    expect(transcriptUrls).toEqual([]);
    rerender(<ControlGroupView {...props({ active: true })} />);
    await flush();
    expect(within(taskDetail(container)).getAllByTestId("transcript-call")).toHaveLength(1);
  });

  // mutation: the available test is dropped -> a provider without transcripts opens an empty panel on every task -> red
  it("stays closed when the listing is not available, and says why when pressed", async () => {
    useCalls([call], false);
    const { container } = render(<ControlGroupView {...props()} />);
    await flush();
    expect(disclosure(taskDetail(container)).getAttribute("aria-expanded")).toBe("false");
    expect(api.fetchTranscriptWindow).not.toHaveBeenCalled();
    useCalls([], false);
    fireEvent.click(disclosure(taskDetail(container)));
    await flush();
    expect(api.fetchRunTranscripts).toHaveBeenCalledTimes(2);
    expect(within(taskDetail(container)).getByText(/too old to record transcripts/)).toBeTruthy();
  });

  // mutation: setAutoDone is dropped from the press -> the answer still on its way opens it against the person's choice -> red
  it("stays closed when the person opens and closes it before the first answer arrives", async () => {
    const { container } = render(<ControlGroupView {...props()} />);
    fireEvent.click(disclosure(taskDetail(container)));
    fireEvent.click(disclosure(taskDetail(container)));
    await flush();
    expect(disclosure(taskDetail(container)).getAttribute("aria-expanded")).toBe("false");
    expect(within(taskDetail(container)).queryAllByTestId("transcript-call")).toHaveLength(0);
  });

  // mutation: setAutoDone is dropped from the answer -> closing makes it read and open again against the person's choice -> red
  it("stays closed once the person closes it, through polls and pane switches, until they reopen it", async () => {
    const { container, rerender } = render(<ControlGroupView {...props()} />);
    await flush();
    fireEvent.click(disclosure(taskDetail(container)));
    await flush();
    const reads = vi.mocked(api.fetchRunTranscripts).mock.calls.length;
    rerender(<ControlGroupView {...props({}, { ...view, changeSeq: view.changeSeq + 1 })} />);
    rerender(<ControlGroupView {...props({ active: false })} />);
    rerender(<ControlGroupView {...props({ active: true })} />);
    await flush(3000);
    expect(disclosure(taskDetail(container)).getAttribute("aria-expanded")).toBe("false");
    expect(within(taskDetail(container)).queryAllByTestId("transcript-call")).toHaveLength(0);
    expect(api.fetchRunTranscripts).toHaveBeenCalledTimes(reads);
    fireEvent.click(disclosure(taskDetail(container)));
    await flush();
    expect(disclosure(taskDetail(container)).getAttribute("aria-expanded")).toBe("true");
    expect(within(taskDetail(container)).getByRole("button", { name: /execute · call 1/ })).toBeTruthy();
    expect(within(taskDetail(container)).queryAllByTestId("transcript-call")).toHaveLength(0);
  });
});

describe("T12: the task detail and the runs table", () => {
  it("the runs table reads the latest recorded call after one run-row disclosure", async () => {
    const { container } = render(<ControlGroupView {...props({ route: { region: "runs", taskId: null } })} />);
    await flush(5000);
    expect(transcriptUrls).toEqual([]);
    const detail = runsRow(container);
    await flush();
    expect(within(detail).getByRole("button", { name: "Transcript" }).getAttribute("aria-expanded")).toBe("true");
    expect(api.fetchRunTranscripts).toHaveBeenCalledWith(RUN);
    expect(api.fetchTranscriptWindow).toHaveBeenCalledWith(RUN, { attempt: 1, phase: "execute", seq: 1 }, { tail: true });
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
