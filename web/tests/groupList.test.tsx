// @vitest-environment jsdom
/**
 * Issue-fixes spec §6.4: each group is one card (the whole card is the button), the list hides archived groups unless the
 * Archived chip is chosen, and the chosen chip is remembered per viewer when storage works.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GROUP_FILTER_KEY } from "../src/groupCategory.js";
import i18n from "../src/i18n.js";
import { GroupList } from "../src/GroupList.js";
import type { GroupSummaryV1 } from "../src/controlTypes.js";

const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
const zero = { idle: 0, running: 0, waiting: 0, blocked: 0, done: 0 };
const g = (groupId: string, over: Partial<GroupSummaryV1> = {}): GroupSummaryV1 => ({
  groupId, repoId: "orca", state: "ready", commandRevision: 1, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false,
  recoveryBlockerCount: 0, completion: { done: 0, total: 1 }, counts: { ...zero, idle: 1 }, archived: false, ...over,
});
const GROUPS = [
  g("n1"), g("r1", { state: "running", counts: { ...zero, running: 1 } }), g("a1", { counts: { ...zero, blocked: 1 } }),
  g("d1", { completion: { done: 1, total: 1 }, counts: { ...zero, done: 1 } }), g("x1", { archived: true }),
];
const nav = () => screen.getByRole("navigation", { name: "Control groups" });
const ids = () => [...nav().querySelectorAll(":scope > button")].map((card) => (card.textContent ?? "").split(" · ")[0]);
const chip = (name: string) => within(screen.getByRole("group", { name: "Show groups" })).getByRole("button", { name });

afterEach(() => { cleanup(); vi.restoreAllMocks(); try { window.localStorage.clear(); } catch { /* none */ } });

describe("the group list (spec §6.4)", () => {
  it("hides an archived group unless the Archived chip is chosen", () => {
    render(<GroupList groups={GROUPS} selected={null} onSelect={vi.fn()} now={NOW} />);
    expect(ids()).toEqual(["n1", "r1", "a1", "d1"]);
    fireEvent.click(chip("Archived"));
    expect(ids()).toEqual(["x1"]);
    fireEvent.click(chip("All"));
    expect(ids()).toEqual(["n1", "r1", "a1", "d1"]);
  });

  it("files each group under its own chip", () => {
    render(<GroupList groups={GROUPS} selected={null} onSelect={vi.fn()} now={NOW} />);
    for (const [name, id] of [["Not started", "n1"], ["Running", "r1"], ["Needs attention", "a1"], ["Done", "d1"]] as const) {
      fireEvent.click(chip(name));
      expect(ids(), name).toEqual([id]);
      expect(chip(name).getAttribute("aria-pressed")).toBe("true");
    }
  });

  it("remembers the chosen chip in this browser, and still filters when storage throws", () => {
    const first = render(<GroupList groups={GROUPS} selected={null} onSelect={vi.fn()} now={NOW} />);
    fireEvent.click(chip("Done"));
    expect(window.localStorage.getItem(GROUP_FILTER_KEY)).toBe("done");
    first.unmount();
    render(<GroupList groups={GROUPS} selected={null} onSelect={vi.fn()} now={NOW} />);
    expect(ids()).toEqual(["d1"]);
    cleanup();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    render(<GroupList groups={GROUPS} selected={null} onSelect={vi.fn()} now={NOW} />);
    expect(ids()).toEqual(["n1", "r1", "a1", "d1"]);
    fireEvent.click(chip("Running"));
    expect(ids()).toEqual(["r1"]);
  });

  it("draws one card per group: id and state as its name, goal, progress, status chip, attention badge, branch and when it changed", () => {
    const onSelect = vi.fn();
    render(<GroupList groups={[g("g", { goal: "Ship the export", completion: { done: 1, total: 3 }, counts: { ...zero, blocked: 1, done: 1, idle: 1 }, branch: "orca/g", updatedAt: NOW - 5 * 60_000 })]}
      selected={null} onSelect={onSelect} now={NOW} />);
    const card = screen.getByRole("button", { name: "g · ready · 1/3 done" });
    expect(card.textContent).toContain("Ship the export");
    expect(card.querySelector("progress")?.getAttribute("value")).toBe("1");
    expect(card.querySelector("progress")?.getAttribute("max")).toBe("3");
    expect(card.querySelector(".group-chip")?.textContent).toBe("Needs attention");
    expect(card.querySelector(".group-badge")?.textContent).toBe("needs you");
    expect(card.textContent).toContain("orca/g");
    expect(card.textContent).toContain("updated 5 min ago");
    fireEvent.click(within(card).getByText("Ship the export"));
    expect(onSelect).toHaveBeenCalledWith("g");
  });

  // Final review (E8 deferred minor): "4320 min ago" is unreadable; past 120 minutes the card counts hours, past 48 hours days.
  it("says how long ago a group changed in minutes, then hours past 120 minutes, then days past 48 hours, in both languages", async () => {
    const updated = (minutesAgo: number): string => {
      const shown = render(<GroupList groups={[g("g", { updatedAt: NOW - minutesAgo * 60_000 })]} selected={null} onSelect={vi.fn()} now={NOW} />);
      const text = shown.container.querySelector(".group-card-detail")?.textContent ?? "";
      shown.unmount();
      return text;
    };
    expect(updated(119)).toContain("updated 119 min ago");
    expect(updated(120)).toContain("updated 2 h ago");
    expect(updated(47 * 60 + 59)).toContain("updated 47 h ago");
    expect(updated(48 * 60)).toContain("updated 2 days ago");
    expect(updated(4320)).toContain("updated 3 days ago");
    try {
      await i18n.changeLanguage("zh");
      expect(updated(119)).toContain("119 分钟前更新");
      expect(updated(180)).toContain("3 小时前更新");
      expect(updated(4320)).toContain("3 天前更新");
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("says when no group matches the chosen chip", () => {
    render(<GroupList groups={[g("n1")]} selected={null} onSelect={vi.fn()} now={NOW} />);
    fireEvent.click(chip("Done"));
    expect(within(nav()).getByText("No group matches this filter.")).toBeTruthy();
  });
});
