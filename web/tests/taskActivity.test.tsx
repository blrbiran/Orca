// @vitest-environment jsdom
/** Issue-fixes spec §6.5: selecting a task shows its current run's recent activity, above the evidence list. */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskDetail } from "../src/TaskDetail.js";
import { fetchRunActivity } from "../src/controlApi.js";
import i18n from "../src/i18n.js";
import { run, view, workItem } from "./fixtures/board.js";

const AT = Date.UTC(2026, 9, 8, 10, 5, 0);
let entries: unknown[] = [];
let status = 200;
let responseOverride: unknown = undefined;
let urls: string[] = [];
beforeEach(() => {
  urls = []; status = 200; responseOverride = undefined;
  entries = [
    { seq: 4, groupId: "g", taskId: "a", runId: "run-a", at: AT + 1000, kind: "run-settled", body: { state: "settled", outcome: "succeeded" } },
    { seq: 3, groupId: "g", taskId: "a", runId: "run-a", at: AT + 500, kind: "run-blocked", body: { blockedAt: AT, reason: "Error: codex-no-completion" } },
    // ccloop's raw status word, as the driver stores it (pre-flight amendment 4).
    { seq: 2, groupId: "g", taskId: "a", runId: "run-a", at: AT, kind: "phase", body: { step: "executing", attempt: 2 } },
    { seq: 1, groupId: "g", taskId: "a", runId: "run-a", at: AT - 60_000, kind: "run-started", body: { providerAttemptOrdinal: 1 } },
  ];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    // Tester #113: the task's current run also reads its transcript listing; these criteria are about the activity feed.
    if (String(input).endsWith("/transcripts")) return new Response(JSON.stringify({ schema: "orca-run-transcripts-v1", runId: "run-a", available: false, calls: [] }), { status: 200, headers: { "content-type": "application/json" } });
    urls.push(String(input));
    const body = responseOverride !== undefined ? responseOverride : status === 200 ? { schema: "orca-run-activity-v1", runId: "run-a", entries } : { code: "run-not-found", message: "no such run" };
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const detail = (archived = false, runOver: Parameters<typeof run>[0] = {}): void => {
  const item = workItem({ taskId: "a", currentRunId: "run-a", lineageRunIds: ["run-a"] });
  render(<TaskDetail view={view([item], [run(runOver)])} item={item} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} archived={archived} />);
};

describe("the task detail's run activity (spec §6.5)", () => {
  it.each([
    ["en", "The activity response is malformed"],
    ["zh", "活动响应格式无效"],
  ])("names a malformed successful response in %s while retaining its code and run route", async (language, message) => {
    await i18n.changeLanguage(language);
    responseOverride = null;
    try {
      await expect(fetchRunActivity("run-a")).rejects.toMatchObject({ refusal: { status: 200, code: "activity-response-invalid", message } });
      expect(urls).toEqual(["/api/control/runs/run-a/activity"]);
    } finally { await i18n.changeLanguage("en"); }
  });

  it("reads the current run's activity from its route and lists the newest window chronologically, above the runs and their evidence", async () => {
    detail();
    const region = await screen.findByRole("region", { name: "Recent activity of run-a" });
    const lines = await within(region).findAllByRole("listitem");
    const text = lines.map((line) => line.textContent ?? "");
    expect(text[1]).toBe(`${new Date(AT).toISOString()} · phase · execute · attempt 2`);
    expect(text[0]).toBe(`${new Date(AT - 60_000).toISOString()} · started`);
    expect(text[3]).toBe(`${new Date(AT + 1000).toISOString()} · settled · settled`);
    expect(text).toHaveLength(4);
    expect(urls).toEqual(["/api/control/runs/run-a/activity"]);
    const runsHeading = screen.getByRole("heading", { name: "Runs of a" });
    expect(region.compareDocumentPosition(runsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it("explains a blocked row's reason in words, not as the raw ccloop string", async () => {
    detail();
    const region = await screen.findByRole("region", { name: "Recent activity of run-a" });
    const lines = await within(region).findAllByRole("listitem");
    const blocked = lines[2]?.textContent ?? "";
    expect(blocked.startsWith(`${new Date(AT + 500).toISOString()} · blocked · `)).toBe(true);
    expect(blocked).not.toContain("Error: ");
  });

  // Task setup and check retry spec 2026-11-04 §4.7: a run the ladder left out says so on the task page, with the reason.
  it.each([
    ["en", "could-not-run", "Not retried automatically: the check could not run."],
    ["en", "setup-failed", "Not retried automatically: setup failed."],
    ["zh", "could-not-run", "没有自动重试：检查命令根本没能运行。"],
  ])("says in %s why a %s run was not retried automatically", async (language, reason, sentence) => {
    await i18n.changeLanguage(language);
    try {
      entries = [{ seq: 5, groupId: "g", taskId: "a", runId: "run-a", at: AT + 2000, kind: "ladder-skipped", body: { reason } }];
      detail();
      const region = await screen.findByRole("region", { name: language === "en" ? "Recent activity of run-a" : "run-a 的近期活动" });
      const lines = await within(region).findAllByRole("listitem");
      // mutation: render the bare kind (no reason) -> the sentence is missing, red
      // Ruling: 2026-11-04 session af2ceee1, human 「这次批准改写所有必要的判据」: final-review fix wave minor 5 -- the sentence
      // already says "not retried", so the kind word is no longer put before it (mutation M5-1: keep the kind -> red).
      expect(lines.map((line) => line.textContent ?? "")).toEqual([`${new Date(AT + 2000).toISOString()} · ${sentence}`]);
    } finally { await i18n.changeLanguage("en"); }
  });

  // Final-review fix wave (I4): the row names the failing command the ladder read.
  it("names the failing command on a ladder-skipped row", async () => {
    entries = [{ seq: 5, groupId: "g", taskId: "a", runId: "run-a", at: AT + 2000, kind: "ladder-skipped", body: { reason: "could-not-run", command: "npm test" } }];
    detail();
    const region = await screen.findByRole("region", { name: "Recent activity of run-a" });
    const lines = await within(region).findAllByRole("listitem");
    // Mutation I4-M3 (the row leaves the command out) -> red.
    expect(lines.map((line) => line.textContent ?? "")).toEqual([`${new Date(AT + 2000).toISOString()} · Not retried automatically: the check could not run. · npm test`]);
  });

  // Scoped fix (re-review item 3): only a could-not-run row names a command; a setup-failed one shows its sentence alone.
  it("shows no command on a setup-failed row", async () => {
    entries = [{ seq: 5, groupId: "g", taskId: "a", runId: "run-a", at: AT + 2000, kind: "ladder-skipped", body: { reason: "setup-failed", command: "npm test" } }];
    detail();
    const region = await screen.findByRole("region", { name: "Recent activity of run-a" });
    const lines = await within(region).findAllByRole("listitem");
    // Mutation S3-M2 (command for every reason) -> " · npm test" appended, red.
    expect(lines.map((line) => line.textContent ?? "")).toEqual([`${new Date(AT + 2000).toISOString()} · Not retried automatically: setup failed.`]);
  });

  // Final-review fix wave (minor 1): once the ladder left the run out, its reason line no longer says Orca escalates it.
  it("a run the ladder left out does not promise an automatic escalation", async () => {
    const failed = { state: "blocked" as const, outcome: "failed" as const, stopReason: "Error: check failed", failureCause: { cause: "required-check-failed", phase: "verify" as const, retries: 0, detail: null } };
    entries = [{ seq: 5, groupId: "g", taskId: "a", runId: "run-a", at: AT + 2000, kind: "ladder-skipped", body: { reason: "could-not-run" } }];
    detail(false, failed);
    await screen.findByRole("region", { name: "Recent activity of run-a" });
    const runsList = screen.getByRole("heading", { name: "Runs of a" }).parentElement!;
    // Mutation M1-1 (RunReason ignores the skip) -> the escalation sentence is shown, red.
    await vi.waitFor(() => expect(runsList.textContent).toContain("Why it stopped: a required check failed. Not retried automatically: the check could not run."));
    expect(runsList.textContent).not.toContain("Orca escalates it automatically");
  });

  it("a run with no ladder-skipped row keeps the escalation sentence", async () => {
    const failed = { state: "blocked" as const, outcome: "failed" as const, stopReason: "Error: check failed", failureCause: { cause: "required-check-failed", phase: "verify" as const, retries: 0, detail: null } };
    detail(false, failed);
    await screen.findByRole("region", { name: "Recent activity of run-a" });
    expect(screen.getByRole("heading", { name: "Runs of a" }).parentElement!.textContent).toContain("Orca escalates it automatically when the group is orchestrated.");
  });

  it("stays visible on an archived group, which is read-only information", async () => {
    detail(true);
    expect(await screen.findByRole("region", { name: "Recent activity of run-a" })).toBeTruthy();
    expect(urls).toEqual(["/api/control/runs/run-a/activity"]);
  });

  it("names a refusal in place and keeps the rest of the detail", async () => {
    status = 404;
    detail();
    expect(await screen.findByText("activity refused · run-not-found")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Runs of a" })).toBeTruthy();
  });

  it("says so when nothing has been recorded yet", async () => {
    entries = [];
    detail();
    expect(await screen.findByText("no activity recorded yet")).toBeTruthy();
  });

  it.each([null, { schema: "orca-run-activity-v1", runId: "run-a", entries: null }, { schema: "orca-run-activity-v1", runId: "else", entries: [] }, { schema: "orca-run-activity-v1", runId: "run-a", entries: [], extra: true }, { schema: "orca-run-activity-v1", runId: "run-a", entries: [{ seq: 1, groupId: "g", taskId: "a", runId: "run-a", at: AT, kind: "phase", body: {}, extra: true }] }])("refuses a malformed successful activity body instead of reporting no history: %j", async (body) => {
    responseOverride = body;
    detail();
    expect(await screen.findByText("activity refused · activity-response-invalid")).toBeTruthy();
    expect(screen.queryByText("no activity recorded yet")).toBeNull();
  });

  it("reads again when the group's projection moves, so a running task's feed follows it", async () => {
    const item = workItem({ taskId: "a", currentRunId: "run-a", lineageRunIds: ["run-a"] });
    const first = view([item], [run({})]);
    const props = { item, drafts: {}, onDraft: vi.fn(), onCommand: vi.fn() };
    const { rerender } = render(<TaskDetail view={first} {...props} />);
    await screen.findByRole("region", { name: "Recent activity of run-a" });
    expect(urls).toHaveLength(1);
    rerender(<TaskDetail view={{ ...first, changeSeq: first.changeSeq + 1 }} {...props} />);
    await vi.waitFor(() => expect(urls).toHaveLength(2));
  });

  it("reads nothing for a task with no current run", () => {
    const item = workItem({ taskId: "a" });
    render(<TaskDetail view={view([item])} item={item} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.queryByRole("region", { name: "Recent activity of run-a" })).toBeNull();
    expect(urls).toEqual([]);
  });

  // Final fix wave W4 (E11 review minor 1): a retried task's new run must not show the old run's rows under its own label.
  it("drops the previous run's rows when the run changes, before the new run's answer arrives", async () => {
    const itemA = workItem({ taskId: "a", currentRunId: "run-a", lineageRunIds: ["run-a"] });
    const itemB = workItem({ taskId: "a", currentRunId: "run-b", lineageRunIds: ["run-a", "run-b"] });
    const props = { drafts: {}, onDraft: vi.fn(), onCommand: vi.fn() };
    const { rerender } = render(<TaskDetail view={view([itemA], [run({})])} item={itemA} {...props} />);
    const region = await screen.findByRole("region", { name: "Recent activity of run-a" });
    expect((await within(region).findAllByRole("listitem")).length).toBe(4);
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
    rerender(<TaskDetail view={view([itemB], [run({}), run({ runId: "run-b" })])} item={itemB} {...props} />);
    const next = await screen.findByRole("region", { name: "Recent activity of run-b" });
    expect(within(next).queryAllByRole("listitem")).toEqual([]);
    expect(within(next).queryByText("no activity recorded yet")).toBeNull();
  });
});
