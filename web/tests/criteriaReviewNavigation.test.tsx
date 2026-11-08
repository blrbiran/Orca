// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import type { GroupSummaryV1 } from "../src/controlTypes.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import i18n from "../src/i18n.js";
import { config, view } from "./fixtures/board.js";
import { ALPHA, groupSummary, installFakePanel, planGroupView } from "./fixtures/twoProjects.js";
import type { FakePanel } from "./fixtures/twoProjects.js";

afterEach(async () => { cleanup(); vi.unstubAllGlobals(); await i18n.changeLanguage("en"); window.location.hash = ""; });

let panel: FakePanel;
beforeEach(() => { panel = installFakePanel(); });
/** The overview route the fixture does not serve; the real one lists no archived group, so callers pass the live ones. */
function serveOverview(groups: GroupSummaryV1[]): void {
  const base = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => String(input) === "/api/control/overview"
    ? new Response(JSON.stringify({ schema: "orca-control-overview-v1", epoch: panel.summary.epoch, changeSeq: panel.summary.changeSeq, groups, steps: [], issues: [] }), { status: 200, headers: { "content-type": "application/json" } })
    : base(input, init)) as typeof fetch;
}

it("opens an archived criteria-review judge from its parent, read-only (#179)", async () => {
  const parent = groupSummary("g1", ALPHA, {
    criteriaReviews: [{ taskId: "t-doc", debugGroupId: "judge-7", state: "justified", reason: null }],
  });
  const judge = groupSummary("judge-7", ALPHA, {
    archived: true,
    systemDebug: { source: { kind: "criteria-review", groupId: "g1", taskId: "t-doc", runId: null }, stackOn: "g1", settled: { state: "justified", at: 1, detail: null } },
  });
  panel.summary = { ...panel.summary, groups: [parent, judge] };
  panel.groupViews = { g1: planGroupView(parent), "judge-7": planGroupView(judge) };
  serveOverview([parent]);
  render(<App />);
  const nav = await screen.findByRole("navigation", { name: "Control groups" });
  fireEvent.click(await within(nav).findByRole("button", { name: /^g1 · / }));
  const parentView = await screen.findByRole("region", { name: "Control group g1" });
  fireEvent.click(within(parentView).getByRole("button", { name: /Open criteria review judge-7/i }));
  const judgeView = await screen.findByRole("region", { name: "Control group judge-7" });
  expect(within(judgeView).getByRole("status", { name: "Archived" }).textContent).toMatch(/keeps every record and takes no new work/);
  expect(window.location.hash).toBe("#tasks/judge-7");
});

it("opens an archived criteria-review judge by its own URL, read-only (#179)", async () => {
  const judge = groupSummary("judge-7", ALPHA, {
    archived: true,
    systemDebug: { source: { kind: "criteria-review", groupId: "g1", taskId: "t-doc", runId: null }, stackOn: "g1", settled: { state: "restored", at: 1, detail: null } },
  });
  panel.summary = { ...panel.summary, groups: [judge] };
  panel.groupViews = { "judge-7": planGroupView(judge) };
  serveOverview([]);
  window.location.hash = "#tasks/judge-7";
  render(<App />);
  const judgeView = await screen.findByRole("region", { name: "Control group judge-7" });
  expect(within(judgeView).getByRole("status", { name: "Archived" }).textContent).toMatch(/keeps every record and takes no new work/);
  expect(window.location.hash).toBe("#tasks/judge-7");
});

it("still refuses an archived group that is not a criteria-review judge", async () => {
  const ordinary = groupSummary("old", ALPHA, { archived: true });
  panel.summary = { ...panel.summary, groups: [ordinary] };
  panel.groupViews = { old: planGroupView(ordinary) };
  window.location.hash = "#tasks/old";
  render(<App />);
  await waitFor(() => expect(window.location.hash).toBe("#tasks"));
  expect(screen.queryByRole("region", { name: "Control group old" })).toBeNull();
});

it("opens a failed criteria review from its parent group and shows the reason (#179)", () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
  const parent = view([]);
  parent.summary.criteriaReviews = [{ taskId: "t-doc", debugGroupId: "judge-7", state: "failed", reason: "check did not run" }];
  const onSelectGroup = vi.fn();
  render(<ControlGroupView view={parent} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} onSelectGroup={onSelectGroup} />);
  expect(screen.getByText(/check did not run/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Open criteria review judge-7/i }));
  expect(onSelectGroup).toHaveBeenCalledExactlyOnceWith("judge-7");
});

it("shows an ongoing review without inventing a failure and no review entry when absent", () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
  const parent = view([]);
  parent.summary.criteriaReviews = [{ taskId: "t-doc", debugGroupId: "judge-8", state: "debugging", reason: null }];
  const mounted = render(<ControlGroupView view={parent} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} onSelectGroup={vi.fn()} />);
  expect(screen.getByRole("button", { name: /Open criteria review judge-8/i })).toBeTruthy();
  expect(screen.queryByText(/check did not run/)).toBeNull();
  mounted.rerender(<ControlGroupView view={{ ...parent, summary: { ...parent.summary, criteriaReviews: [] } }} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} onSelectGroup={vi.fn()} />);
  expect(screen.queryByRole("button", { name: /Open criteria review/i })).toBeNull();
});
