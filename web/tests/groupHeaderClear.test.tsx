// @vitest-environment jsdom
/**
 * Tester #81/#228: the first screen of a group led with internal counters (revision, projection sequence, plan hash, graph
 * version), Tasks' header with the server session and its sequence, every group page carried the same generic "Review
 * progress, preparation or problems" line, and the New requirement form an always-on capability note. The counters move to
 * the Technical region (Tasks has none: its line folds behind a closed "Technical details"), the generic line goes, and the
 * note folds away. Nothing is dropped: each value is still on the page.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { ControlPanel } from "../src/ControlPanel.js";
import { RequirementsPanel } from "../src/RequirementsPanel.js";
import type { ControlSummaryV1, RecoveryViewV1 } from "../src/controlTypes.js";
import { config, view } from "./fixtures/board.js";
import { config as reqConfig, requirementView, summaryWith } from "./fixtures/requirement.js";
afterEach(cleanup);

/** The page outside the group's region panels: what a reader sees before choosing a tab. */
const firstScreen = (root: HTMLElement): string => {
  const copy = root.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[role="tabpanel"]').forEach((panel) => panel.remove());
  return copy.textContent ?? "";
};
const technical = (): string => document.querySelector('[role="tabpanel"][data-overview-region="technical"]')?.textContent ?? "";
const insideClosedDetails = (element: Element): boolean => { const details = element.closest("details"); return details !== null && !details.open; };

describe("the group header carries no internal counters (#81/#228)", () => {
  // mutation: the h2 keeps revision and projection -> red
  it("names the group and its state only", () => {
    render(<ControlGroupView view={view([])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("g · running");
  });

  // mutation: the counters are dropped instead of moved -> the Technical region lacks them -> red
  // mutation: the plan line keeps hash and graph version on the first screen -> red
  it("shows revision, projection, plan hash and graph version in Technical, and the goal on the first screen", () => {
    const { container } = render(<ControlGroupView view={view([])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(technical()).toContain("revision 6 · projection 4");
    expect(technical()).toContain("plan aaaaaaaaaaaa · graph v1");
    const first = firstScreen(container);
    expect(first).toContain("Ship");
    for (const counter of ["projection 4", "revision 6", "aaaaaaaaaaaa", "graph v1"]) expect(first, counter).not.toContain(counter);
  });

  // mutation: the generic next-action paragraph is rendered again -> red
  it("drops the generic next-action line every group page carried", () => {
    render(<ControlGroupView view={view([])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(document.body.textContent).not.toContain("Review progress, preparation or problems");
  });
});

describe("Tasks' header folds its session line (#81)", () => {
  const recovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [] };
  const summary: ControlSummaryV1 = { schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq: 4, resetRequired: false, dispatchBlocked: false, groups: [] };
  // mutation: the summary line stays a bare paragraph under the h2 -> not inside a closed details -> red
  it("keeps epoch and sequence behind a closed Technical details", () => {
    render(<ControlPanel config={config} summary={summary} recovery={recovery} groups={{}} selected={null} drafts={{}} uncertain={[]} refusal={null}
      refetchRequired={false} onSelect={vi.fn()} onCommand={vi.fn()} onDraft={vi.fn()} />);
    const line = screen.getByText(/^epoch epoch-a · projection 4/);
    expect(insideClosedDetails(line)).toBe(true);
    expect(line.closest("details")!.querySelector("summary")!.textContent).toBe("Technical details");
  });
});

describe("the New requirement form folds its capability note (#81)", () => {
  // mutation: the note is an always-on paragraph again -> not inside a closed details -> red
  it("keeps the note behind a closed details", () => {
    const v = requirementView("failed");
    render(<RequirementsPanel config={reqConfig} summary={summaryWith(v)} views={{ r: v }} selected={null} agents={null} language="en" onSelect={vi.fn()} onCommand={vi.fn()} />);
    const note = screen.getByText(/^Clarification uses a bounded single call/);
    expect(insideClosedDetails(note)).toBe(true);
  });
});
