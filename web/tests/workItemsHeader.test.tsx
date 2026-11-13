// @vitest-environment jsdom
/**
 * Tester #303: the work-items list had two names -- a "Work items" heading and, beside it, a "Tasks (n)" button that
 * folded the table -- so it read as two lists. It has one now: the heading IS the disclosure, "Work items (n)".
 * Tester #304: the label filter sat above the dependency graph as "Labels (n)", so it read as a graph or group control,
 * not a filter of the table. It is now in the work-items header row, below the graph, named "Filter by label (n)".
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { config, view, workItem } from "./fixtures/board.js";

afterEach(cleanup);
const mount = () => render(<ControlGroupView view={view([workItem({ taskId: "a", labels: ["bug"] }), workItem({ taskId: "b" })])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
const follows = (a: Element, b: Element): boolean => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe("tester #303/#304: the work items' one name, and its filter", () => {
  it("names the list once, as the heading that opens and closes it", () => {
    mount();
    const heading = screen.getByRole("heading", { name: "Work items (2)" });
    const disclosure = within(heading).getByRole("button", { name: "Work items (2)" });
    // mutation: restore the separate "Tasks (n)" button -> a second name for the list, red
    expect(screen.queryByRole("button", { name: /^Tasks \(/ })).toBeNull();
    // mutation: restore the bare "Work items" heading -> two headings name the list, red
    expect(screen.getAllByRole("heading").filter((h) => /Work items/.test(h.textContent ?? ""))).toHaveLength(1);
    const table = screen.getByRole("table", { name: "Tasks" });
    expect(disclosure.getAttribute("aria-controls")).toBe(table.id);
    const before = disclosure.getAttribute("aria-expanded");
    fireEvent.click(disclosure);
    // mutation: drop the onClick -> the table does not fold, red
    expect(disclosure.getAttribute("aria-expanded")).not.toBe(before);
    expect(table.getAttribute("data-collapsed")).toBe(String(before === "true"));
  });

  it("puts the label filter in the work items' header row, below the graph, named as a filter", () => {
    mount();
    const filter = screen.getByRole("button", { name: "Filter by label (0)" });
    // mutation: move the filter back above the graph -> it precedes the graph and leaves the header row, red
    expect(filter.closest("[data-testid='work-items-header']")).not.toBeNull();
    expect(follows(screen.getByRole("figure", { name: "Dependency graph" }), filter)).toBe(true);
    fireEvent.click(filter);
    fireEvent.click(screen.getByRole("checkbox", { name: "bug" }));
    expect(screen.getByRole("button", { name: "Filter by label (1)" })).toBeTruthy();
    // The one name counts the rows the filter leaves.
    expect(screen.getByRole("heading", { name: "Work items (1)" })).toBeTruthy();
  });

  it("says the same in Chinese: 工作项（n） and 按标签筛选（n）", async () => {
    await i18n.changeLanguage("zh");
    try {
      mount();
      expect(screen.getByRole("heading", { name: "工作项（2）" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "按标签筛选（0）" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /^任务（/ })).toBeNull();
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
