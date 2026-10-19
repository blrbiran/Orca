// @vitest-environment jsdom
/**
 * Issue #47: the group's execution controls were found only by opening the one tab they lived in (Preparation or
 * Problems). They are one persistent bar above the region tabs, shown whatever tab is open, and never repeated inside a
 * tab -- which buttons the bar offers is still decided by the existing gates.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { config, view } from "./fixtures/board.js";
import type { GroupViewV1 } from "../src/controlTypes.js";

afterEach(cleanup);
const mount = (value: GroupViewV1) => render(<ControlGroupView view={value} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
const TABS = ["Progress", "Preparation", "Problems", "Results", "Runs and evidence", "Technical details"];

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
