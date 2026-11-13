// @vitest-environment jsdom
/**
 * Tester #285: during a codex execute `used` and the activity row stay frozen for minutes (codex reports usage only when a
 * phase ends), so a person took the run for stuck and its cost for small. The panel now says what the figure is (Live,
 * runs table, group budget), that the run is still producing output when its transcript is being written, and, once the
 * run has ended, its usage by kind. A run whose agent observes usage live reads as before.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n.js";
import { BudgetEditor } from "../src/BudgetEditor.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { RunTranscript } from "../src/AgentTranscript.js";
import type { GroupViewV1, RunTranscriptsV1, RunViewV1 } from "../src/controlTypes.js";
import { config, run, view, workItem } from "./fixtures/board.js";

const NOW = Date.UTC(2026, 10, 12, 2, 50, 0);
const BOOKED = NOW - 9 * 60_000, WRITTEN = NOW - 12_000;
const clock = (ms: number, seconds = false): string => new Date(ms).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), hourCycle: "h23" });
let lastTranscriptAt: number | undefined;
beforeEach(() => {
  // Ruling: 「这次批准改写所有必要的判据」 (human, tester follow-up J, 2026-11-13): web/tests/usagePhaseEnd.test.tsx:21 faked the
  // timers at the real clock, a day after WRITTEN; #285's second half bounds "producing output" by TRANSCRIPT_STALE_MS, so the
  // clock now starts at NOW (12 s after the write), the moment these views are rendered at.
  vi.useFakeTimers({ now: NOW });
  lastTranscriptAt = WRITTEN;
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    const runId = decodeURIComponent(url.split("/runs/")[1]?.split("/")[0] ?? "");
    const body = url.endsWith("/transcripts")
      ? { schema: "orca-run-transcripts-v1", runId, available: true, calls: [{ attempt: 1, phase: "execute", seq: 1, runtime: "codex", recorded: false, bytes: 0, final: false, truncatedAt: null }],
        ...(lastTranscriptAt === undefined ? {} : { lastTranscriptAt }) } satisfies RunTranscriptsV1
      : {};
    return new Response(JSON.stringify(body), { status: url.endsWith("/transcripts") ? 200 : 404, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});
afterEach(async () => { cleanup(); vi.useRealTimers(); Reflect.deleteProperty(document, "visibilityState"); await i18n.changeLanguage("en"); });
const flush = async (): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
const mount = (value: GroupViewV1) => render(<ControlGroupView view={value} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} now={NOW} />);

const executing = (over: Partial<RunViewV1> = {}): GroupViewV1 => view(
  [workItem({ taskId: "a", status: "active", category: "running", currentRunId: "run-a", lineageRunIds: ["run-a"] })],
  [run({ runId: "run-a", taskId: "a", state: "running", phase: "work", used: { tokens: 9544, activeMs: 0, attempts: 1, sessions: 1 }, startedAt: NOW - 10 * 60_000,
    endedAt: null, usageObservation: "phase-end", usageAt: BOOKED, ...over })],
);

describe("a run whose agent reports usage only at phase end (#285)", () => {
  it("Live says the tokens are the last phase end's, and that the transcript is still being written", async () => {
    mount(executing());
    fireEvent.click(screen.getByRole("tab", { name: "Live" }));
    await flush();
    const item = within(screen.getByRole("tabpanel", { name: "Live" })).getByRole("region", { name: "Running: a" });
    // mutation: drop phaseEndNote from the Live facts -> red
    expect(item.textContent).toContain(`9.5K tokens (as of the last phase end at ${clock(BOOKED)}; this agent reports usage only when a phase ends)`);
    // mutation: drop the producing line from RunTranscript -> red
    expect(item.querySelector("[data-testid=transcript-producing]")?.textContent).toBe(`producing output, last at ${clock(WRITTEN, true)}`);
  });

  it("says no phase has ended yet before any usage was booked; says nothing for an agent that observes usage live", async () => {
    mount(executing({ usageAt: undefined }));
    fireEvent.click(screen.getByRole("tab", { name: "Live" }));
    await flush();
    expect(screen.getByRole("tabpanel", { name: "Live" }).textContent).toContain("no phase has ended yet; this agent reports usage only when a phase ends");
    cleanup();
    lastTranscriptAt = undefined;
    mount(executing({ usageObservation: "realtime" }));
    fireEvent.click(screen.getByRole("tab", { name: "Live" }));
    await flush();
    const panel = screen.getByRole("tabpanel", { name: "Live" });
    // mutation: phaseEndNote ignores usageObservation -> red
    expect(panel.textContent).not.toContain("phase ends");
    expect(panel.querySelector("[data-testid=transcript-producing]")).toBeNull();
  });

  it("the runs table notes it beside the used figure, in Chinese too", async () => {
    await i18n.changeLanguage("zh");
    mount(executing());
    fireEvent.click(screen.getByRole("tab", { name: "运行与证据" }));
    // mutation: drop the runs-table note -> red
    expect(screen.getByTestId("usage-phase-end").textContent).toBe(`截至 ${clock(BOOKED)} 上一阶段结束时；该 agent 只在阶段结束时上报用量`);
  });

  it("an ended run's detail shows its usage by kind; a run under way does not", async () => {
    const ended = view([workItem({ taskId: "a", status: "completed", category: "done", currentRunId: "run-a", lineageRunIds: ["run-a"] })],
      [run({ runId: "run-a", taskId: "a", state: "landed", endedAt: NOW - 60_000, usageObservation: "phase-end", usageAt: BOOKED,
        usageBreakdown: { input: 211_395, output: 122_592, cacheRead: 6_563_840, cacheWrite: 0 } })]);
    mount(ended);
    fireEvent.click(screen.getByRole("tab", { name: "Runs and evidence" }));
    fireEvent.click(screen.getByRole("button", { name: /Open/ }));
    // mutation: drop usageByKind from the run detail -> red
    expect(screen.getByTestId("usage-by-kind").textContent).toBe("usage by kind: input 211.4K / output 122.6K / cache read 6.6M");
    // the run under way reads its figure's footing instead.
    expect(screen.queryByTestId("usage-phase-end")).toBeNull();
  });

  it("the group budget says used lags while such a run is under way", () => {
    const { container } = render(<BudgetEditor view={executing()} config={config} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    // mutation: drop the phaseEnd note from the ledger line -> red
    expect(container.textContent).toContain(`used is as of the last phase end at ${clock(BOOKED)}: a run under way reports usage only when a phase ends`);
    cleanup();
    const { container: live } = render(<BudgetEditor view={executing({ usageObservation: "realtime" })} config={config} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(live.textContent).not.toContain("phase end");
  });
});

// Tester #285 (follow-up J): a blocked run's transcript, or one silent for over TRANSCRIPT_STALE_MS, says when its output
// stopped instead of "producing output".
describe("the transcript of a blocked or silent run is not producing output (#285, follow-up J)", () => {
  it("a blocked run's transcript says no output since its last write", async () => {
    render(<RunTranscript runId="run-a" active follow blocked />);
    await flush();
    const panel = screen.getByRole("region", { name: "Transcript of run-a" });
    // mutation: RunTranscript ignores `blocked` -> red here.
    expect(panel.querySelector("[data-testid=transcript-producing]")).toBeNull();
    expect(panel.querySelector("[data-testid=transcript-quiet]")?.textContent).toBe(`no output since ${clock(WRITTEN, true)}`);
  });
  it("a run under way whose last write is over ten minutes old says no output since it", async () => {
    vi.setSystemTime(WRITTEN + 10 * 60_000 + 1);
    mount(executing());
    fireEvent.click(screen.getByRole("tab", { name: "Live" }));
    await flush();
    const item = within(screen.getByRole("tabpanel", { name: "Live" })).getByRole("region", { name: "Running: a" });
    // mutation: transcriptLive ignores the age -> red here.
    expect(item.querySelector("[data-testid=transcript-producing]")).toBeNull();
    expect(item.querySelector("[data-testid=transcript-quiet]")?.textContent).toBe(`no output since ${clock(WRITTEN, true)}`);
  });
});
