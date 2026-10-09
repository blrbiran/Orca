// @vitest-environment jsdom
/** Issue-fixes spec §6.5: selecting a task shows its current run's recent activity, above the evidence list. */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskDetail } from "../src/TaskDetail.js";
import { run, view, workItem } from "./fixtures/board.js";

const AT = Date.UTC(2026, 9, 8, 10, 5, 0);
let entries: unknown[] = [];
let status = 200;
let urls: string[] = [];
beforeEach(() => {
  urls = []; status = 200;
  entries = [
    { seq: 4, groupId: "g", taskId: "a", runId: "run-a", at: AT + 1000, kind: "run-settled", body: { state: "settled", outcome: "succeeded" } },
    { seq: 3, groupId: "g", taskId: "a", runId: "run-a", at: AT + 500, kind: "run-blocked", body: { blockedAt: AT, reason: "Error: codex-no-completion" } },
    // ccloop's raw status word, as the driver stores it (pre-flight amendment 4).
    { seq: 2, groupId: "g", taskId: "a", runId: "run-a", at: AT, kind: "phase", body: { step: "executing", attempt: 2 } },
    { seq: 1, groupId: "g", taskId: "a", runId: "run-a", at: AT - 60_000, kind: "run-started", body: { providerAttemptOrdinal: 1 } },
  ];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    urls.push(String(input));
    const body = status === 200 ? { schema: "orca-run-activity-v1", runId: "run-a", entries } : { code: "run-not-found", message: "no such run" };
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const detail = (archived = false): void => {
  const item = workItem({ taskId: "a", currentRunId: "run-a", lineageRunIds: ["run-a"] });
  render(<TaskDetail view={view([item], [run({})])} item={item} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} archived={archived} />);
};

describe("the task detail's run activity (spec §6.5)", () => {
  it("reads the current run's activity from its route and lists it, newest first, above the runs and their evidence", async () => {
    detail();
    const region = await screen.findByRole("region", { name: "Recent activity of run-a" });
    const lines = await within(region).findAllByRole("listitem");
    const text = lines.map((line) => line.textContent ?? "");
    expect(text[2]).toBe(`${new Date(AT).toISOString()} · phase · execute · attempt 2`);
    expect(text[3]).toBe(`${new Date(AT - 60_000).toISOString()} · started`);
    expect(text[0]).toBe(`${new Date(AT + 1000).toISOString()} · settled · settled`);
    expect(text).toHaveLength(4);
    expect(urls).toEqual(["/api/control/runs/run-a/activity"]);
    const runsHeading = screen.getByRole("heading", { name: "Runs of a" });
    expect(region.compareDocumentPosition(runsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it("explains a blocked row's reason in words, not as the raw ccloop string", async () => {
    detail();
    const region = await screen.findByRole("region", { name: "Recent activity of run-a" });
    const lines = await within(region).findAllByRole("listitem");
    const blocked = lines[1]?.textContent ?? "";
    expect(blocked.startsWith(`${new Date(AT + 500).toISOString()} · blocked · `)).toBe(true);
    expect(blocked).not.toContain("Error: ");
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

  it("reads nothing for a task with no current run", () => {
    const item = workItem({ taskId: "a" });
    render(<TaskDetail view={view([item])} item={item} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.queryByRole("region", { name: "Recent activity of run-a" })).toBeNull();
    expect(urls).toEqual([]);
  });
});
