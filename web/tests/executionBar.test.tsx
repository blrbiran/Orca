// @vitest-environment jsdom
/**
 * Issue #47: the group's execution controls were found only by opening the one tab they lived in (Preparation or
 * Problems). They are one persistent bar above the region tabs, shown whatever tab is open, and never repeated inside a
 * tab -- which buttons the bar offers is still decided by the existing gates.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { config, run, view } from "./fixtures/board.js";
import type { GroupViewV1 } from "../src/controlTypes.js";

afterEach(cleanup);
const mount = (value: GroupViewV1) => render(<ControlGroupView view={value} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
// Ruling: plan 2026-11-10-tester-followup-b T7 (#228/#226): the Live region is among the tabs.
const TABS = ["Progress", "Live", "Preparation", "Problems", "Results", "Runs and evidence", "Technical details"];

it.each(["draft", "ready", "running"] as const)("a %s group shows its execution controls once, above the tabs, on every tab", (state) => {
  const value = view([]); value.summary.state = state; mount(value);
  for (const name of TABS) {
    fireEvent.click(screen.getByRole("tab", { name }));
    const pause = screen.getAllByRole("button", { name: "Pause new tasks" });
    expect(pause, `Pause on ${name}`).toHaveLength(1);
    expect(pause[0]!.closest('[role="tabpanel"]'), `Pause inside a tab on ${name}`).toBeNull();
    expect(screen.getAllByRole("heading", { name: "Execution controls" }), `heading on ${name}`).toHaveLength(1);
  }
  const tablist = screen.getByRole("tablist");
  const bar = screen.getByRole("heading", { name: "Execution controls" });
  expect(bar.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING, "bar precedes the tabs").toBeTruthy();
});

it("keeps the existing gates: a ready group offers Start; a running one does not", () => {
  const ready = view([]); ready.summary.state = "ready"; mount(ready);
  fireEvent.click(screen.getByRole("tab", { name: "Results" }));
  expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
  cleanup();
  mount(view([]));
  expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
});

// #228 (plan 2026-11-10-tester-followup-b T7): the bar sits above every tab, so it must stay short. Its three counts
// were stacked label/number pairs shown even at 0, and its recent-command ids (a technical fact) pushed the tabs down.
const bar = (): HTMLElement => screen.getByRole("heading", { name: "Execution controls" }).closest<HTMLElement>('[data-overview-region="dispatch"]')!;

it("shows no work count when every count is zero, and keeps the actions as an always-visible toolbar", () => {
  const value = view([]); value.summary.state = "ready"; mount(value);
  for (const label of ["Continuable work", "Retryable work", "Unresolved work"]) expect(within(bar()).queryByText(label), label).toBeNull();
  const actions = within(bar()).getByRole("toolbar", { name: "Execution actions" });
  expect(within(actions).getByRole("button", { name: "Pause new tasks" })).toBeTruthy();
  expect(actions.closest("details"), "actions are not folded away").toBeNull();
});

it("puts the non-zero counts on one wrapping row of chips and leaves the zero ones out", () => {
  const value = view([], [run({ runId: "run-a", state: "unknown" })]); value.summary.state = "ready"; mount(value);
  const counts = within(bar()).getByRole("list", { name: "Work counts" });
  expect(counts.className.split(" "), "one wrapping row, not a stacked list").toEqual(expect.arrayContaining(["flex", "flex-wrap"]));
  expect(within(counts).getAllByRole("listitem").map((chip) => chip.textContent)).toEqual(["Unresolved work 1"]);
});

it("shows the recent commands under Technical details, not in the bar", () => {
  const value = view([]); value.recentCommandIds = ["start-1"]; mount(value);
  expect(within(bar()).queryByText(/Recent commands/)).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "Technical details" }));
  expect(within(screen.getByRole("tabpanel")).getByText("Recent commands: start-1")).toBeTruthy();
});
