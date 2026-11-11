// @vitest-environment jsdom
/**
 * Tester follow-up E §6 (spec docs/superpowers/specs/2026-11-11-tester-followup-e-design.md): the transcript reads like a
 * transcript. #244 its text wraps and it keeps its own type; #252 a phase with one call is not "call 1"; #253 a tool call and
 * its result are one toned row; #254 a result row shows its numbers and a row with nothing to show does not open; #255 the
 * paging controls say where the view is.
 *
 * jsdom lays nothing out (no widths, no computed type), so #244's "no horizontal overflow at 390px" is pinned on the
 * classes that carry it and on the structure (the transcript is not inside the runs table); a browser check is the
 * measurement, and none was made here.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunTranscript } from "../src/AgentTranscript.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { RunTranscriptsV1, TranscriptCallV1, TranscriptEventV1, TranscriptWindowV1 } from "../src/controlTypes.js";
import { config, RUN, view } from "./fixtures/transcript.js";

const call = (over: Partial<TranscriptCallV1> = {}): TranscriptCallV1 => ({ attempt: 1, phase: "execute", seq: 1, runtime: "claude", recorded: true, bytes: 100, final: true, truncatedAt: null, ...over });
const listingOf = (calls: TranscriptCallV1[]): RunTranscriptsV1 => ({ schema: "orca-run-transcripts-v1", runId: RUN, available: true, calls });
const field = (text: string) => ({ text, length: text.length, more: false });
const win = (events: TranscriptEventV1[], over: Partial<TranscriptWindowV1> = {}): TranscriptWindowV1 => ({ schema: "orca-transcript-window-v1", runId: RUN, attempt: 1, phase: "execute", seq: 1, runtime: "claude", source: "run", final: true, truncatedAt: null, events, start: 0, end: 1000, indexedEnd: 1000, counted: 0, ...over });
const toolCall = (at: number, id: string, command: string): TranscriptEventV1 => ({ at, i: 0, kind: "tool_call", meta: { id, name: "Bash" }, fields: { input: field(command) } });
const toolResult = (at: number, id: string, output: string, error = false): TranscriptEventV1 => ({ at, i: 0, kind: "tool_result", meta: { id }, flag: { error }, fields: { output: field(output) } });
const message = (at: number, text: string): TranscriptEventV1 => ({ at, i: 0, kind: "message", meta: { role: "assistant" }, fields: { text: field(text) } });

let listing: RunTranscriptsV1;
let window: (url: string) => TranscriptWindowV1;
beforeEach(() => {
  vi.useFakeTimers();
  listing = listingOf([call()]);
  window = () => win([]);
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    const body = url.endsWith("/transcripts") ? listing : url.includes("/transcripts/") ? window(url) : {};
    return new Response(JSON.stringify(body), { status: url.includes("/transcripts") ? 200 : 404, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});
afterEach(() => { cleanup(); vi.useRealTimers(); Reflect.deleteProperty(document, "visibilityState"); });

const flush = async (): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
/** Mounts the transcript and opens its first listed call (the follow view opens the newest by itself). */
async function opened(): Promise<HTMLElement> {
  const { container } = render(<RunTranscript runId={RUN} active follow />);
  await flush();
  await flush();
  return container;
}
const rows = (): HTMLElement[] => screen.getAllByTestId("transcript-event");
const classes = (element: Element | null): string[] => (element?.getAttribute("class") ?? "").split(/\s+/);

describe("#244: the transcript wraps and keeps its own type", () => {
  it("wraps an expanded field, keeps the list from scrolling sideways, and sets the body's 14px / 1.55 on itself", async () => {
    const long = `${"x".repeat(3000)}\n${"/very/long/path/".repeat(100)}`;
    window = () => win([message(0, long)]);
    const container = await opened();
    // mutation: drop text-base / leading-[1.55] from the section -> the runs table's 13px reaches it again -> red
    expect(classes(container.querySelector("section.run-transcript"))).toEqual(expect.arrayContaining(["min-w-0", "text-base", "leading-[1.55]"]));
    // mutation: drop min-w-0 / overflow-x-hidden from the list -> a long line can scroll it sideways -> red
    const list = container.querySelector("ol.transcript-events");
    expect(classes(list)).toEqual(expect.arrayContaining(["min-w-0", "overflow-y-auto", "overflow-x-hidden"]));
    expect(classes(list)).not.toContain("overflow-x-auto");
    fireEvent.click(within(rows()[0]!).getByRole("button"));
    const pre = container.querySelector("pre.transcript-field");
    // mutation: drop whitespace-pre-wrap / wrap-anywhere from the field -> the bare <pre> keeps a 3000-character line -> red
    expect(classes(pre)).toEqual(expect.arrayContaining(["whitespace-pre-wrap", "wrap-anywhere"]));
    expect(pre?.textContent).toBe(long);
  });

  it("in the Runs pane, renders the open run's transcript below the table in its own box, not in a cell", async () => {
    window = () => win([message(0, "hello")]);
    const { container } = render(<ControlGroupView view={view} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} route={{ region: "runs", taskId: null }} />);
    const pane = container.querySelector('[data-overview-region="runs"]') as HTMLElement;
    fireEvent.click(pane.querySelector(`tr[data-run-id="${RUN}"] button[aria-expanded]`)!);
    await flush();
    const transcript = within(pane).getByRole("region", { name: `Transcript of ${RUN}` });
    // mutation: render the detail back inside the table -> the table's 40rem narrow-screen width widens it -> red
    expect(transcript.closest("table")).toBeNull();
    // The table scrolls in its own box; the detail is not inside that box, so the box's scroll never moves the transcript.
    const box = pane.querySelector(".runs-table-box");
    expect(classes(box)).toEqual(expect.arrayContaining(["max-w-full", "overflow-x-auto"]));
    expect(box?.contains(transcript)).toBe(false);
    expect(transcript.closest("[data-run-detail]")?.getAttribute("data-run-detail")).toBe(RUN);
  });
});

describe("#252: a call's label", () => {
  it("drops \"call N\" when the phase has one call in that attempt, and keeps it when it has more", async () => {
    listing = listingOf([call({ phase: "plan" }), call({ seq: 1 }), call({ seq: 2 }), call({ attempt: 2, seq: 1 })]);
    render(<RunTranscript runId={RUN} active />);
    fireEvent.click(screen.getByRole("button", { name: "Transcript" }));
    await flush();
    const labels = screen.getAllByRole("button").map((button) => button.textContent ?? "").filter((text) => / · claude · /.test(text));
    // mutation: always use callLine -> "plan · call 1 · …" -> red; never use it -> the two execute calls read alike -> red
    expect(labels).toEqual(["plan · claude · 100 B", "execute · call 1 · claude · 100 B", "execute · call 2 · claude · 100 B", "execute · claude · 100 B"]);
  });
});

describe("#253: a tool call and its result are one row", () => {
  it("joins a call and its result by id, tones it by the outcome, and says running while no result is loaded", async () => {
    window = () => win([toolCall(0, "t1", "npm test"), message(10, "between"), toolResult(20, "t1", "12 passed"),
      toolCall(30, "t2", "npm run lint"), toolResult(40, "t2", "3 errors", true), toolCall(50, "t3", "npm run build")]);
    await opened();
    const shown = rows();
    // mutation: render one row per event -> 6 rows, the results apart from their calls -> red
    expect(shown).toHaveLength(4);
    expect(shown[0]!.textContent).toContain("Bash npm test · done");
    // mutation: drop the data-tone -> a failed command looks like a finished one -> red
    expect(shown.map((row) => row.getAttribute("data-tone"))).toEqual(["ok", null, "danger", "info"]);
    expect(shown[2]!.textContent).toContain("Bash npm run lint · failed");
    expect(shown[3]!.textContent).toContain("Bash npm run build · running");
    // Expanded, the joined row shows the call's input and the result's output.
    fireEvent.click(within(shown[0]!).getByRole("button"));
    expect([...shown[0]!.querySelectorAll("pre")].map((pre) => pre.textContent)).toEqual(["npm test", "12 passed"]);
  });

  it("keeps a result whose call is not loaded as its own row", async () => {
    window = () => win([toolResult(0, "gone", "late output"), message(10, "after")]);
    await opened();
    // mutation: drop every tool_result that has an id -> the orphan output disappears -> red
    expect(rows()).toHaveLength(2);
    expect(rows()[0]!.textContent).toContain("tool result");
    expect(rows()[0]!.textContent).toContain("late output");
    expect(rows()[0]!.getAttribute("data-tone")).toBe("ok");
  });
});

describe("#254: result rows", () => {
  it("shows a result's token counts in its line", async () => {
    window = () => win([{ at: 0, i: 0, kind: "result", num: { inputTokens: 1200, cachedInputTokens: 800, outputTokens: 90, reasoningOutputTokens: 40 } }]);
    await opened();
    // mutation: summary reads fields.text only -> the codex result row says just "result" -> red
    expect(rows()[0]!.textContent).toBe("result input tokens 1200 · cached 800 · output tokens 90 · reasoning 40");
  });

  it("does not offer to open a row with nothing to show (omp agent_end, a turn-end notice)", async () => {
    window = () => win([{ at: 0, i: 0, kind: "result" }, { at: 10, i: 0, kind: "notice", meta: { notice: "turn-end" } }, message(20, "text")]);
    await opened();
    // mutation: every row is a button -> pressing an empty result opens an empty body -> red
    expect(within(rows()[0]!).queryByRole("button")).toBeNull();
    expect(within(rows()[1]!).queryByRole("button")).toBeNull();
    expect(within(rows()[2]!).getByRole("button").getAttribute("aria-expanded")).toBe("false");
  });
});

describe("#255: the paging controls", () => {
  it("are ‹ › icon buttons with names and tooltips, beside the loaded range and where the view is", async () => {
    window = () => win([message(0, "a"), message(10, "b"), message(20, "c")]);
    await opened();
    const earlier = screen.getByRole("button", { name: "Earlier" });
    const later = screen.getByRole("button", { name: "Later" });
    // mutation: back to text buttons -> "Earlier" / "Later" text -> red
    expect([earlier.textContent, later.textContent]).toEqual(["‹", "›"]);
    expect([earlier.title, later.title]).toEqual(["previous 200 events", "next 200 events"]);
    // mutation: drop the range -> red; drop at newest / at oldest -> red
    expect(screen.getByText("rows 1–3 of 3")).toBeTruthy();
    expect(screen.getByText("at newest")).toBeTruthy();
    expect(screen.getByText("at oldest")).toBeTruthy();
  });

  it("says the range counts only what is loaded when older lines are not, and is not at oldest", async () => {
    window = () => win([message(500, "a"), message(510, "b")], { start: 500, end: 1000 });
    await opened();
    // mutation: always say "of n" -> a partial call reads as if it had 2 rows -> red
    expect(screen.getByText("rows 1–2 of 2 loaded")).toBeTruthy();
    expect(screen.queryByText("at oldest")).toBeNull();
    expect(screen.getByText("at newest")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Earlier" }).hasAttribute("disabled")).toBe(false);
  });
});
