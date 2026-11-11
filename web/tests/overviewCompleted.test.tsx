// @vitest-environment jsdom
/**
 * Tester #256 (spec 2026-11-11-tester-followup-e-design.md §10): Overview's Progress lists the active groups first; the
 * done groups sit in a collapsed "Completed (N)" block below them, still openable (a done group can still carry
 * delivery work). Without a done group there is no such block.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import i18n from "../src/i18n.js";
import { Overview } from "../src/Overview.js";
import type { OverviewModel, OverviewProgress } from "../src/overviewModel.js";
import { ALPHA, groupSummary } from "./fixtures/twoProjects.js";

afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });
const row = (groupId: string, state: "running" | "done" | "review"): OverviewProgress => ({ group: groupSummary(groupId, ALPHA, { state }), owner: "Orca", ownerUnknown: false, target: { kind: "group", groupId, region: state === "done" ? "results" : "progress", taskId: null, runId: null } });
const model = (progress: OverviewProgress[]): OverviewModel => ({ progress, queue: [], issues: [], sources: [], scopeUnavailable: false, complete: true });
const progressRegion = () => screen.getByRole("region", { name: i18n.t("overview.progress") });
const completedBlock = () => progressRegion().querySelector("details[data-completed]");

it("puts done groups in a collapsed Completed (N) block below the active ones", () => {
  const onOpen = vi.fn();
  render(<Overview model={model([row("g-done-1", "done"), row("g-run", "running"), row("g-done-2", "done"), row("g-review", "review")])} onOpen={onOpen} onImport={() => {}} onRequirement={() => {}} />);
  const block = completedBlock();
  // mutation: render every group in the one flat list (no split) -> no Completed block, red here
  expect(block).not.toBeNull();
  // mutation: open the block by default -> red here
  expect((block as HTMLDetailsElement).open).toBe(false);
  // mutation: count every group in the summary -> "Completed (4)", red here
  expect(within(block as HTMLElement).getByText("Completed (2)").tagName).toBe("SUMMARY");
  const insideBlock = Array.from((block as HTMLElement).querySelectorAll("li")).map((li) => li.textContent ?? "");
  expect(insideBlock.map((text) => text.includes("g-done-1") || text.includes("g-done-2"))).toEqual([true, true]);
  // The active list, outside the block, keeps its order and holds no done group.
  const activeList = progressRegion().querySelector(":scope > ul") as HTMLElement;
  expect(Array.from(activeList.querySelectorAll(":scope > li")).map((li) => (li.textContent ?? "").match(/g-[a-z0-9-]+/)?.[0])).toEqual(["g-run", "g-review"]);
  // mutation: place the block above the active list -> red here
  expect(activeList.compareDocumentPosition(block as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // A done group stays openable at its results.
  (block as HTMLDetailsElement).open = true;
  fireEvent.click(within(block as HTMLElement).getByRole("button", { name: /g-done-2/ }));
  expect(onOpen).toHaveBeenCalledWith({ kind: "group", groupId: "g-done-2", region: "results", taskId: null, runId: null });
});

it("shows no Completed block without a done group, and says no active groups when every group is done", () => {
  const { unmount } = render(<Overview model={model([row("g-run", "running")])} onOpen={() => {}} onImport={() => {}} onRequirement={() => {}} />);
  expect(completedBlock()).toBeNull();
  unmount();
  render(<Overview model={model([row("g-done", "done")])} onOpen={() => {}} onImport={() => {}} onRequirement={() => {}} />);
  expect(completedBlock()).not.toBeNull();
  // mutation: keep the empty state on the whole list's length -> no empty-state line, red here
  expect(progressRegion().textContent).toContain("No active groups.");
});

it("names the block in Chinese", async () => {
  await i18n.changeLanguage("zh");
  render(<Overview model={model([row("g-done", "done")])} onOpen={() => {}} onImport={() => {}} onRequirement={() => {}} />);
  expect(completedBlock()?.querySelector("summary")?.textContent).toBe("已完成（1）");
});
