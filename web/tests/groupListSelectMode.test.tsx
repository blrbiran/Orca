// @vitest-environment jsdom
/**
 * Tester #390 (human ruling 2026-11-20, 「选择模式」): the unexplained checkbox that sat on every Tasks card by default is
 * gone. A Select toggle in the list's toolbar enters select mode; only then does a card show its box, with its "Select
 * id" name and a 44px hit area, and the bulk toolbar's Exit selection leaves the mode and clears the selection.
 *
 * Ruling: the human approved 「选择模式」 on 2026-11-20 as part of this P0 batch (#390's remaining position/label half).
 * The box rides at the card's start, in the content row beside the card button, with a visible short label ("Select");
 * it is not a floating box anchored to the bottom-right corner.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../src/i18n.js";
import { GroupList, type BulkOutcome, type BulkVerb } from "../src/GroupList.js";
import type { GroupSummaryV1 } from "../src/controlTypes.js";

const zero = { idle: 0, running: 0, waiting: 0, blocked: 0, done: 0 };
const g = (groupId: string, over: Partial<GroupSummaryV1> = {}): GroupSummaryV1 => ({
  groupId, repoId: "orca", state: "ready", commandRevision: 1, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false,
  recoveryBlockerCount: 0, completion: { done: 0, total: 1 }, counts: { ...zero, idle: 1 }, archived: false, ...over,
});
const doneOf = (groupId: string) => g(groupId, { state: "done", completion: { done: 1, total: 1 }, counts: { ...zero, done: 1 } });
const GROUPS = [g("n1"), doneOf("d1"), doneOf("d2")];

const toolbar = () => screen.getByRole("group", { name: "Selected groups" });
const selectToggle = () => screen.getByRole("button", { name: "Select" });
const box = (groupId: string) => screen.getByRole("checkbox", { name: `Select ${groupId}` });

/** A page owner, as App is: it answers the list's bulk calls through `calls`. */
function Owner(props: { calls: Array<[string, BulkVerb]> }) {
  const onBulkAction = async (groupId: string, verb: BulkVerb): Promise<BulkOutcome> => {
    props.calls.push([groupId, verb]);
    return "succeeded";
  };
  return <GroupList groups={GROUPS} selected={null} onSelect={vi.fn()} now={0} onBulkAction={onBulkAction} />;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); try { window.localStorage.clear(); } catch { /* none */ } });

describe("select mode is entered explicitly (#390)", () => {
  it("renders no checkbox by default, with or without a bulk handler", () => {
    render(<Owner calls={[]} />);
    expect(screen.queryAllByRole("checkbox")).toEqual([]);
    expect(screen.queryByRole("group", { name: "Selected groups" })).toBeNull();
    cleanup();
    render(<GroupList groups={GROUPS} selected={null} onSelect={vi.fn()} now={0} />);
    expect(screen.queryAllByRole("checkbox")).toEqual([]);
    // No bulk handler, no Select toggle: there is nothing to select for.
    expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
  });

  it("shows each card's labelled box at its start, and the toolbar, once Select is pressed", () => {
    render(<Owner calls={[]} />);
    fireEvent.click(selectToggle());
    expect(screen.queryAllByRole("checkbox")).toHaveLength(GROUPS.length);
    // A clear accessible name, and a visible short label beside the native box.
    expect(box("d1")).toBeTruthy();
    const label = box("d1").closest("label")!;
    expect(within(label).getByText("Select")).toBeTruthy();
    // The label is a 44px hit area (DESIGN.md touch rule).
    expect(label.className).toContain("min-h-[44px]");
    expect(label.className).toContain("min-w-[44px]");
    // Ruling (2026-11-20): the box sits in the card's content row at its start, never anchored to the bottom-right.
    expect(label.className).not.toContain("absolute");
    expect(label.className).not.toContain("bottom-3");
    const row = label.closest(".group-card-row");
    expect(row).not.toBeNull();
    const card = row!.querySelector("button.group-card");
    expect(card).not.toBeNull();
    // Left of the card: the box comes first in the row, then the card button.
    expect(card!.previousElementSibling).toBe(label);
    expect(toolbar()).toBeTruthy();
    expect(within(toolbar()).getByRole("button", { name: "Exit selection" })).toBeTruthy();
    // The toggle is the pressed state of the mode, not a second primary.
    expect(selectToggle().getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("group", { name: "Show groups" }).querySelector(".btn-primary")).toBeNull();
  });

  it("Exit selection leaves the mode and clears the selection", () => {
    render(<Owner calls={[]} />);
    fireEvent.click(selectToggle());
    fireEvent.click(box("d1"));
    expect(within(toolbar()).getByText("1 selected")).toBeTruthy();
    fireEvent.click(within(toolbar()).getByRole("button", { name: "Exit selection" }));
    // mutation: exit keeps the selection -> the toolbar stays and d1 is still checked, red here
    expect(screen.queryByRole("group", { name: "Selected groups" })).toBeNull();
    expect(screen.queryAllByRole("checkbox")).toEqual([]);
    fireEvent.click(selectToggle());
    expect((box("d1") as HTMLInputElement).checked).toBe(false);
  });

  it("switching chips clears the selection but keeps the mode", () => {
    render(<Owner calls={[]} />);
    fireEvent.click(selectToggle());
    fireEvent.click(box("d1"));
    // mutation: choose() keeps picked -> d1 is still checked under Done, red here
    fireEvent.click(screen.getByRole("button", { name: /^Done \(\d+\)$/ }));
    expect((box("d1") as HTMLInputElement).checked).toBe(false);
    expect(within(toolbar()).queryByText(/\d+ selected/)).toBeNull();
  });

  it("a selected card's bulk action still fires", async () => {
    const calls: Array<[string, BulkVerb]> = [];
    render(<Owner calls={calls} />);
    fireEvent.click(selectToggle());
    fireEvent.click(box("d1"));
    fireEvent.click(within(toolbar()).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(screen.getByTestId("bulk-outcome-d1").textContent).toBe("d1: archived"));
    expect(calls).toEqual([["d1", "archive-group"]]);
  });
});
