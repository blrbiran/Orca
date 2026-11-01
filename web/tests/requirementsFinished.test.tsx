// @vitest-environment jsdom
/**
 * Tester #115, then the human's ruling in session 663fb68e (「Q1 a」, which also authorised rewriting this file's checkboxes):
 * the Requirements list leads with what still needs a person, and one row of three filters says which part is listed, each
 * with its count. One with consensus but no accepted draft is still clarifying: the person still has to review its split.
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
const list = () => within(screen.getByRole("navigation", { name: "Requirement list" }));
const names = (): string[] => list().queryAllByRole("button", { name: /^(open|done|ready|running|gone) · / }).map((button) => button.textContent ?? "");
const filter = () => within(screen.getByRole("group", { name: "Which requirements to list" }));
const pressed = (): string[] => filter().getAllByRole("button").filter((button) => button.getAttribute("aria-pressed") === "true").map((button) => button.textContent ?? "");

afterEach(cleanup);

describe("one row of filters on the requirement list", () => {
  // mutation: the In progress part lists everything -> the finished ones crowd out what needs a person -> red
  it("starts on those still clarifying, with the others counted", () => {
    panel([group("open", "clarifying"), group("done", "done"), group("ready", "ready"), { ...group("gone", "done"), archived: true }]);
    expect(pressed()).toEqual(["In progress (1)"]);
    expect(filter().getAllByRole("button").map((button) => button.textContent)).toEqual(["In progress (1)", "Finished (2)", "Archived (1)"]);
    expect(names()).toEqual(["open · clarifying"]);
  });

  // The boxes could be ticked together, and each added rows; a filter replaces what is listed.
  // mutation: Finished keeps the clarifying rows -> red
  it("lists only the finished ones under Finished", () => {
    panel([group("open", "clarifying"), group("done", "done"), group("ready", "ready")]);
    fireEvent.click(filter().getByRole("button", { name: "Finished (2)" }));
    expect(pressed()).toEqual(["Finished (2)"]);
    expect(names()).toEqual(["done · done", "ready · ready"]);
  });

  // mutation: archived ones count as finished -> an archived row under Finished and its count off by one -> red
  it("lists only the archived ones under Archived, whatever their state", () => {
    panel([{ ...group("gone", "done"), archived: true }, group("ready", "ready"), group("open", "clarifying")]);
    expect(filter().getByRole("button", { name: "Finished (1)" })).toBeTruthy();
    fireEvent.click(filter().getByRole("button", { name: "Archived (1)" }));
    expect(names()).toEqual(["gone · done"]);
  });

  // mutation: the selected test is dropped from the filter -> a link opens a detail with no row in the list -> red
  it("keeps the open finished requirement listed while the others stay folded", () => {
    panel([group("open", "clarifying"), group("done", "done"), group("ready", "ready")], "ready");
    expect(names()).toEqual(["open · clarifying", "ready · ready"]);
  });

  // mutation: a part with nothing in it drops its button -> the row jumps as requirements finish -> red
  it("keeps all three filters when a part is empty", () => {
    panel([group("open", "clarifying")]);
    expect(filter().getAllByRole("button").map((button) => button.textContent)).toEqual(["In progress (1)", "Finished (0)", "Archived (0)"]);
  });

  // mutation: the empty note keeps saying there are none at all -> the person thinks their finished ones are gone -> red
  it("says this part is empty, not that there are no requirements, when others hold some", () => {
    panel([group("done", "done")]);
    expect(names()).toEqual([]);
    expect(list().getByText("Nothing here. The other filters hold the rest.")).toBeTruthy();
    expect(list().queryByText("No requirements yet.")).toBeNull();
  });

  it("says the filters in Chinese too", async () => {
    const { default: i18n } = await import("../src/i18n.js");
    await i18n.changeLanguage("zh");
    try {
      panel([group("done", "done")]);
      const row = within(screen.getByRole("group", { name: "要列出哪些需求" }));
      expect(row.getAllByRole("button").map((button) => button.textContent)).toEqual(["进行中（0）", "已完成（1）", "已归档（0）"]);
    } finally { await i18n.changeLanguage("en"); }
  });
});
