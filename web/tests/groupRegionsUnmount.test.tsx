// @vitest-environment jsdom
/**
 * #219 residual (ruling R1, 2026-11-10, extended to a group's regions in tester follow-up G): a group's seven detail regions
 * were all mounted, the others hidden, so the page carried duplicate text and controls a locator could find. Only the
 * selected region is rendered now; every other tab panel stays as an empty hidden marker (each tab's aria-controls still
 * names an element). Unsent input in a region outlives a switch through the group view's region draft store
 * (web/src/regionDraft.ts): the integration form is pinned in detailRegions.test.tsx, the waiver note here.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { DETAIL_REGIONS } from "../src/detailRegion.js";
import type { GroupAcceptanceV1, GroupViewV1 } from "../src/controlTypes.js";
import { config, run, view, workItem } from "./fixtures/board.js";
afterEach(cleanup);

const FAILED: GroupAcceptanceV1 = { tip: "c".repeat(40), result: "failed", commands: [{ command: "npm test", exit: "1", ms: 5 }], tail: "FAIL", at: 1, problem: "group-acceptance-failed:npm test" };
const group = (): GroupViewV1 => {
  const value = view([workItem({ taskId: "a", status: "blocked", category: "blocked", currentRunId: "run-a", lineageRunIds: ["run-a"] })],
    [run({ runId: "run-a", taskId: "a", state: "blocked", outcome: "failed" })]);
  return { ...value, summary: { ...value.summary, acceptance: FAILED } };
};
const mount = (value: GroupViewV1) =>
  render(<ControlGroupView view={value} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} refusal={null} roles={["owner"]} />);
const panel = (region: string): HTMLElement => document.querySelector<HTMLElement>(`[role="tabpanel"][data-overview-region="${region}"]`)!;
const tab = (name: string): HTMLElement => screen.getAllByRole("tab").find((element) => element.textContent?.startsWith(name) === true)!;

describe("a group renders only its selected region (#219, R1)", () => {
  // mutation: GroupDetailRegions renders every region's content again (hidden) -> the other panels are not empty -> red
  it("leaves every other region's panel an empty hidden marker, whichever region is open", () => {
    mount(group());
    for (const element of screen.getAllByRole("tab")) {
      fireEvent.click(element);
      const open = DETAIL_REGIONS.find((region) => element.getAttribute("aria-controls") === panel(region).id)!;
      expect(panel(open).hidden, open).toBe(false);
      expect(panel(open).childElementCount, open).toBeGreaterThan(0);
      for (const region of DETAIL_REGIONS.filter((other) => other !== open)) {
        expect(panel(region).hidden, `${open}: ${region}`).toBe(true);
        expect(panel(region).childElementCount, `${open}: ${region}`).toBe(0);
      }
    }
  });

  // mutation: GroupAcceptanceProblem keeps its note in plain component state -> the note is lost on a switch -> red
  it("keeps an unsent waiver note through a region switch", () => {
    mount(group());
    fireEvent.click(tab("Problems"));
    fireEvent.click(screen.getByRole("button", { name: "Waive…" }));
    fireEvent.change(within(screen.getByRole("group", { name: "Waive…" })).getByRole("textbox"), { target: { value: "flaky on this machine" } });
    fireEvent.click(tab("Progress"));
    expect(screen.queryByRole("group", { name: "Waive…" })).toBeNull();
    fireEvent.click(tab("Problems"));
    expect((within(screen.getByRole("group", { name: "Waive…" })).getByRole("textbox") as HTMLTextAreaElement).value).toBe("flaky on this machine");
  });
});
