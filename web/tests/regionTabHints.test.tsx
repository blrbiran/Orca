// @vitest-environment jsdom
/**
 * A group opens on Progress, and nothing on the tab row said that Problems held something to look at or that work was
 * running in Live: the person had to open each tab to find out. The Problems tab now carries a count of what its region
 * lists (recovery blockers, failed or blocked runs, runs with unsettled usage) plus the group's refusal; the Live tab a
 * count of the work running now (the items Live lists). Colour only through data-tone (web/DESIGN.md "Tone, not role"):
 * warn for needs-you, info for running. No tab is hidden or moved, and each tab keeps its name -- the hint is its
 * description.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { ControlRefusal } from "../src/controlState.js";
import type { GroupViewV1 } from "../src/controlTypes.js";
import { config, run, view, workItem } from "./fixtures/board.js";
afterEach(cleanup);

const mount = (value: GroupViewV1, refusal: ControlRefusal | null = null) =>
  render(<ControlGroupView view={value} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} refusal={refusal} />);
const tab = (name: string): HTMLElement => screen.getByRole("tab", { name });
const hint = (name: string): HTMLElement | null => tab(name).querySelector("[data-tab-hint]");
const description = (name: string): string =>
  (tab(name).getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
const TAB_NAMES = ["Progress", "Live", "Preparation", "Problems", "Results", "Runs and evidence", "Technical details"];

const troubled = (): GroupViewV1 => ({
  ...view(
    [workItem({ taskId: "a", status: "active", category: "running", currentRunId: "run-a", lineageRunIds: ["run-a"] }),
      workItem({ taskId: "b", status: "blocked", category: "blocked", currentRunId: "run-b", lineageRunIds: ["run-b"] })],
    [run({ runId: "run-a", taskId: "a", state: "running" }), run({ runId: "run-b", taskId: "b", state: "blocked", outcome: "failed" })],
  ),
  recoveryBlockers: [{ scope: "group", code: "recovery-needed", runId: null, evidenceIds: [] }],
});

describe("region tab hints", () => {
  // mutation: the Problems badge is not rendered -> red
  // mutation: the count leaves out the recovery blockers (or the failed runs) -> 1 instead of 2 -> red
  it("counts what the Problems region lists on its tab, in the warn tone", () => {
    mount(troubled());
    expect(hint("Problems")?.textContent).toBe("2");
    expect(hint("Problems")?.getAttribute("data-tone")).toBe("warn");
    expect(description("Problems")).toContain("2");
  });

  // mutation: the group's refusal is not counted -> 2 instead of 3 -> red
  it("counts the group's refusal among the problems", () => {
    mount(troubled(), { status: 409, code: "stale-revision", message: "stale", commandRevision: 6 });
    expect(hint("Problems")?.textContent).toBe("3");
  });

  // mutation: the Live indicator is not rendered -> red
  // mutation: the indicator counts every work item instead of the running ones -> 2 instead of 1 -> red
  it("marks the Live tab with the work running now, in the info tone", () => {
    mount(troubled());
    expect(hint("Live")?.textContent).toBe("1");
    expect(hint("Live")?.getAttribute("data-tone")).toBe("info");
    expect(description("Live")).toContain("1");
  });

  // mutation: a hint is shown whatever the count -> a quiet group shows 0 badges -> red
  it("shows no hint where there is nothing to look at", () => {
    mount(view([workItem({ taskId: "c", status: "completed", category: "done" })]));
    expect(document.querySelectorAll("[data-tab-hint]")).toHaveLength(0);
  });

  // mutation: the hint becomes part of the tab's name -> "Problems" is not found -> red
  // mutation: the region panel is named by the whole tab again -> its name carries the hint -> red
  it("hides no tab, keeps their order, and keeps each tab's and region's name", () => {
    mount(troubled());
    expect(screen.getAllByRole("tab")).toEqual(TAB_NAMES.map(tab));
    fireEvent.click(tab("Problems"));
    expect(screen.getByRole("tabpanel").getAttribute("data-overview-region")).toBe("problem");
    expect(screen.getByRole("tabpanel", { name: "Problems" })).toBeTruthy();
  });
});
