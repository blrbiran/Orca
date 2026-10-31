// @vitest-environment jsdom
/**
 * Tester #115: the Requirements list leads with what still needs a person. A requirement past clarifying folds behind
 * one toggle; one with consensus but no accepted draft is still clarifying, and the person still has to review its split.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequirementsPanel } from "../src/RequirementsPanel.js";
import type { ControlConfigV1, ControlSummaryV1, GroupSummaryV1, RequirementSummaryV1 } from "../src/controlTypes.js";
import { config, view } from "./fixtures/board.js";

const requirement = { roundNo: 1, roundState: "answered", openQuestions: 0, draftNo: null, draftState: null, waiting: null, reasonCode: null, exportState: "not-due" } as RequirementSummaryV1;
const group = (groupId: string, state: GroupSummaryV1["state"]): GroupSummaryV1 => ({ ...view([]).summary, groupId, state, requirement });
const summary = (groups: GroupSummaryV1[]): ControlSummaryV1 => ({ schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq: 1, resetRequired: false, dispatchBlocked: false, groups });
const panel = (groups: GroupSummaryV1[], selected: string | null = null) => render(
  <RequirementsPanel config={config as ControlConfigV1} summary={summary(groups)} views={{}} selected={selected} agents={null} language="en" onSelect={vi.fn()} onCommand={vi.fn()} />,
);
const names = (): string[] => within(screen.getByRole("navigation", { name: "Requirement list" })).queryAllByRole("button", { name: /^(open|done|ready|running) · / }).map((button) => button.textContent ?? "");
const toggle = (n: number): HTMLElement => screen.getByRole("checkbox", { name: `Show finished (${n})` });

afterEach(cleanup);

describe("finished requirements fold (tester #115)", () => {
  // A requirement with consensus but no accepted draft is state "clarifying": the summary state is the whole test.
  // mutation: the filter lists everything -> the finished ones crowd out what needs a person -> red
  it("lists only those still clarifying by default, and shows the rest behind the toggle", () => {
    panel([group("open", "clarifying"), group("done", "done"), group("ready", "ready")]);
    expect(names()).toEqual(["open · clarifying"]);
    fireEvent.click(toggle(2));
    expect(names()).toEqual(["open · clarifying", "done · done", "ready · ready"]);
  });

  // mutation: the selected test is dropped from the filter -> a link opens a detail with no row in the list -> red
  it("keeps the open finished requirement listed while the others stay folded", () => {
    panel([group("open", "clarifying"), group("done", "done"), group("ready", "ready")], "ready");
    expect(names()).toEqual(["open · clarifying", "ready · ready"]);
  });

  // mutation: archived ones count as finished -> ticking "Show archived" shows nothing new -> red
  it("leaves an archived requirement to the Show archived box alone", () => {
    panel([{ ...group("done", "done"), archived: true }, group("ready", "ready")]);
    expect(names()).toEqual([]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Show archived requirements" }));
    expect(names()).toEqual(["done · done"]);
    expect(toggle(1)).toBeTruthy();
  });

  // mutation: the toggle is rendered unconditionally -> a "Show finished (0)" that does nothing -> red
  it("offers no toggle when nothing is finished", () => {
    panel([group("open", "clarifying")]);
    expect(screen.queryByRole("checkbox", { name: /finished/ })).toBeNull();
  });

  it("says the toggle in Chinese too", async () => {
    const { default: i18n } = await import("../src/i18n.js");
    await i18n.changeLanguage("zh");
    try {
      panel([group("done", "done")]);
      expect(screen.getByRole("checkbox", { name: "显示已完成（1）" })).toBeTruthy();
    } finally { await i18n.changeLanguage("en"); }
  });
});
