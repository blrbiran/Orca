// @vitest-environment jsdom
/**
 * Tester #293: the open task's detail was rendered below the region tabs on every tab, so it followed the person to
 * Preparation, Runs, Technical details -- and under Live it was a second transcript of a task Live already follows (the two
 * fought over the one open transcript). It belongs to the regions that list tasks: Progress and Results. It also has a
 * visible Close control (before, only pressing the task's name again closed it).
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { DetailRegion } from "../src/detailRegion.js";
import { config, RUN, view } from "./fixtures/transcript.js";

beforeEach(() => {
  globalThis.fetch = (async (): Promise<Response> => new Response("{}", { status: 404, headers: { "content-type": "application/json" } })) as typeof fetch;
});
afterEach(cleanup);

const mount = (region: DetailRegion, onRouteChange = vi.fn()) =>
  render(<ControlGroupView view={view} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} route={{ region, taskId: "a" }} onRouteChange={onRouteChange} />);
const detail = (): HTMLElement | null => document.querySelector('[data-task-id="a"]');

describe("tester #293: the open task's detail lives in Progress and Results only", () => {
  it("shows it in Progress and Results, and in no other region", () => {
    mount("progress");
    // mutation: render the detail only where it was (below the regions) but never in Progress -> red
    expect(detail()).not.toBeNull();
    for (const [tab, shown] of [["Live", false], ["Preparation", false], ["Problems", false], ["Results", true], ["Runs and evidence", false], ["Technical details", false], ["Progress", true]] as const) {
      fireEvent.click(screen.getByRole("tab", { name: tab }));
      // mutation: render it outside the regions again (every tab) -> present under Preparation, red
      expect(detail() !== null, tab).toBe(shown);
      // When shown, it sits inside the selected region's panel.
      if (shown) expect(detail()!.closest('[role="tabpanel"]')).toBe(screen.getByRole("tabpanel"));
    }
  });

  it("leaves Live with one transcript of the task's run, its own", () => {
    mount("live");
    // mutation: render the detail in Live too -> its run list adds a second "Transcript of run-a", red
    expect(document.querySelectorAll(`section[aria-label="Transcript of ${RUN}"]`)).toHaveLength(1);
    expect(detail()).toBeNull();
  });

  it("has a visible Close control that closes the task and drops it from the route", () => {
    const onRouteChange = vi.fn();
    mount("progress", onRouteChange);
    const close = within(detail()!).getByRole("button", { name: "Close task a" });
    // Visible text, not only an accessible name.
    expect(close.textContent).toBe("Close");
    // mutation: drop the onClose wiring -> the detail stays open, red
    fireEvent.click(close);
    expect(detail()).toBeNull();
    expect(onRouteChange).toHaveBeenLastCalledWith("progress", null);
  });
});
