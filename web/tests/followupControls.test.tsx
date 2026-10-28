// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GroupList } from "../src/GroupList.js";
import { Shell } from "../src/Shell.js";
import { GlobalSettings } from "../src/GlobalSettings.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { RequirementsPanel } from "../src/RequirementsPanel.js";
import { ChainPanel } from "../src/ChainPanel.js";
import { ADVANCED_KEY, readShowAdvanced, writeShowAdvanced } from "../src/advancedPreference.js";
import { view as boardView, config as boardConfig, run as boardRun } from "./fixtures/board.js";
import { requirementView, config as requirementConfig, summaryWith } from "./fixtures/requirement.js";
import type { GroupSummaryV1 } from "../src/controlTypes.js";

const group = (over: Partial<GroupSummaryV1> = {}): GroupSummaryV1 => ({
  groupId: "g", repoId: "repo", state: "ready", commandRevision: 7, projectionSeq: 1,
  stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0,
  archived: false, ...over,
});
afterEach(() => { cleanup(); window.localStorage.clear(); });
// The Radix menu (ui/Menu.tsx) starts listening for a press outside it one task after it opens, so the press that opened
// it can never close it, moves focus between items one task after an arrow key, and returns focus to its button one task
// after it closes; the criteria below wait that task where they read what follows it.
const tick = (): Promise<void> => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

it("the visible and context affordances open the same owner menu without nesting buttons", async () => {
  const onSelect = vi.fn(), onAction = vi.fn();
  render(<GroupList groups={[group()]} selected={null} onSelect={onSelect} onAction={onAction} />);
  const more = screen.getByRole("button", { name: "More actions" });
  expect(more.closest("button button")).toBeNull();
  fireEvent.click(more);
  const menu = screen.getByRole("menu");
  fireEvent.click(within(menu).getByRole("menuitem", { name: "Open details" }));
  expect(onSelect).toHaveBeenCalledWith("g");
  fireEvent.contextMenu(screen.getByRole("button", { name: /g · ready/ }));
  expect(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Copy group ID" })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  // Ruling: human 「这次批准改写所有必要的判据」 (tester round 2026-10-28, controller session a9f9d6de; Radix first): focus comes back one task after the close.
  await tick();
  expect(document.activeElement).toBe(more);
});

// Issue #81: a menu left open covers the list; it closes on a press outside it and on Escape wherever focus is, as the
// requirement list's menus do (the same GroupActionsMenu), while a press inside it keeps it open for its item.
it("closes an open menu on a press outside it or Escape anywhere, and keeps it open for a press inside", async () => {
  render(<><p>elsewhere</p><GroupList groups={[group()]} selected={null} onSelect={vi.fn()} onAction={vi.fn()} /></>);
  const more = screen.getByRole("button", { name: "More actions" });
  fireEvent.click(more);
  // Ruling: human 「这次批准改写所有必要的判据」 (tester round 2026-10-28, controller session a9f9d6de; Radix first): the presses below come one task after the open, as a person's do (Radix ignores a press in the opening task).
  await tick();
  fireEvent.pointerDown(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Copy group ID" }));
  expect(screen.getByRole("menu")).toBeTruthy();
  fireEvent.pointerDown(screen.getByText("elsewhere"));
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.click(more);
  (document.activeElement as HTMLElement).blur();
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  // Ruling: human 「这次批准改写所有必要的判据」 (tester round 2026-10-28, controller session a9f9d6de; Radix first): the focus return after a close lands one task later; a person's next press comes after it.
  await tick();
  // Its own button still toggles it: the press on the button is not "outside".
  fireEvent.pointerDown(more);
  fireEvent.click(more);
  expect(screen.getByRole("menu")).toBeTruthy();
  await tick();
  // mutation: drop the Menu's onPointerDownOutside trigger check -> this press closes it and the click reopens it, red
  fireEvent.pointerDown(more);
  fireEvent.click(more);
  expect(screen.queryByRole("menu")).toBeNull();
});

it("closes the requirement list's menu on a press outside it", async () => {
  render(<RequirementsPanel config={requirementConfig} summary={summaryWith(requirementView("awaiting-answers"))} views={{}} selected={null} agents={null} language="en" onSelect={vi.fn()} onCommand={vi.fn()} />);
  fireEvent.click(screen.getAllByRole("button", { name: "More actions" })[0]!);
  expect(screen.getByRole("menu")).toBeTruthy();
  // Ruling: human 「这次批准改写所有必要的判据」 (tester round 2026-10-28, controller session a9f9d6de; Radix first): the outside press comes one task after the open.
  await tick();
  fireEvent.pointerDown(screen.getByRole("heading", { name: "Requirements" }));
  expect(screen.queryByRole("menu")).toBeNull();
});

it("menu archives the exact owner and never offers permanent deletion", () => {
  const onAction = vi.fn();
  render(<GroupList groups={[group()]} selected={null} onSelect={vi.fn()} onAction={onAction} />);
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Archive group" }));
  expect(onAction).toHaveBeenCalledWith("g", "archive-group", "repo");
  expect(screen.queryByText(/permanent.*delete/i)).toBeNull();
});

it("pending requirement work disables archive with a reason", () => {
  const requirement = requirementView("awaiting-review").summary;
  requirement.requirement!.draftState = "drafting";
  render(<GroupList groups={[requirement]} selected={null} onSelect={vi.fn()} onAction={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  const archive = within(screen.getByRole("menu")).getByRole("menuitem", { name: "Archive group" }) as HTMLButtonElement;
  expect(archive.disabled).toBe(true);
  expect(archive.getAttribute("aria-describedby")).toBeTruthy();
});

it("each More actions trigger describes its own group and supports menu arrow navigation", async () => {
  render(<GroupList groups={[group({ groupId: "g" }), group({ groupId: "h" })]} selected={null} onSelect={vi.fn()} onAction={vi.fn()} />);
  const triggers = screen.getAllByRole("button", { name: "More actions" });
  expect(triggers).toHaveLength(2);
  expect(document.getElementById(triggers[0]!.getAttribute("aria-describedby")!)?.textContent).toContain("g");
  expect(document.getElementById(triggers[1]!.getAttribute("aria-describedby")!)?.textContent).toContain("h");
  fireEvent.click(triggers[0]!);
  const menu = screen.getByRole("menu");
  const items = within(menu).getAllByRole("menuitem");
  // mutation: drop the Menu's first-item focus (the content ref) -> Radix focuses the box, red
  expect(document.activeElement).toBe(items[0]);
  // Ruling: human 「这次批准改写所有必要的判据」 (tester round 2026-10-28, controller session a9f9d6de; Radix first): a key goes to the focused item, as a keyboard sends it (the hand-rolled menu read keys on the box; Radix's
  // roving focus reads them on the item and moves focus one task later).
  const key = async (name: string): Promise<void> => { fireEvent.keyDown(document.activeElement!, { key: name }); await tick(); };
  await key("ArrowDown");
  expect(document.activeElement).toBe(items[1]);
  await key("End");
  expect(document.activeElement).toBe(items[2]);
  await key("Home");
  expect(document.activeElement).toBe(items[0]);
  // mutation: drop `loop` from the Menu -> ArrowUp on the first item stays there, red
  await key("ArrowUp");
  expect(document.activeElement).toBe(items[2]);
  expect(menu.isConnected).toBe(true);
  await key("Escape");
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(triggers[0]);
});

it("advanced navigation is opt-in, but a running chain remains linked", () => {
  expect(readShowAdvanced(window.localStorage)).toBe(false);
  writeShowAdvanced(window.localStorage, true);
  expect(window.localStorage.getItem(ADVANCED_KEY)).toBe("true");
  expect(readShowAdvanced(window.localStorage)).toBe(true);
  const common = { active: "overview" as const, footer: [], badges: { unreviewed: 0, chainRunning: false, controlAlert: false }, children: <p>content</p> };
  const first = render(<Shell {...common} showAdvanced={false} />);
  expect(screen.queryByRole("link", { name: "Continuous improvement (advanced)" })).toBeNull();
  first.rerender(<Shell {...common} showAdvanced={true} />);
  expect(screen.getByRole("link", { name: "Continuous improvement (advanced)" }).getAttribute("href")).toBe("#chains");
  first.rerender(<Shell {...common} showAdvanced={false} badges={{ ...common.badges, chainRunning: true }} />);
  expect(screen.getByRole("link", { name: "Continuous improvement (advanced)" })).toBeTruthy();
});

it("global settings edits the advanced preference", () => {
  const onAdvanced = vi.fn();
  // H6(b): the global settings show one category at a time; the advanced switch is under Appearance. Ruling: human approved rewriting all necessary criteria, Orca session 7753e97d, 2026-10-27
  render(<GlobalSettings category="appearance" theme="system" onTheme={vi.fn()} language="en" onLanguage={vi.fn()} agents={null} showAdvanced={false} onAdvanced={onAdvanced} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Show continuous improvement" }));
  expect(onAdvanced).toHaveBeenCalledWith(true);
});

it("the advanced chain page states its current Orca development scope", () => {
  render(<ChainPanel repos={[]} banners={[]} outcome={null} />);
  expect(screen.getByText(/Orca development/)).toBeTruthy();
});

it("an accepted requirement offers preparation for its exact group and keeps its source readable", () => {
  const accepted = requirementView("awaiting-review");
  accepted.summary.state = "draft";
  accepted.requirement.acceptedDraftNo = 1;
  accepted.drafts[0]!.state = "accepted";
  const onPrepare = vi.fn();
  const onCommand = vi.fn();
  render(<RequirementsPanel config={requirementConfig} summary={summaryWith(accepted)} views={{ r: accepted }} selected="r"
    agents={null} language="en" onSelect={vi.fn()} onCommand={onCommand} onPrepare={onPrepare} />);
  fireEvent.click(screen.getByRole("button", { name: "Go to task preparation" }));
  expect(onPrepare).toHaveBeenCalledWith("r");
  expect(onCommand).not.toHaveBeenCalled();
  expect(screen.getByText("People can export a note as Markdown.")).toBeTruthy();
});

it("execution controls name pause and safe stop without implying completion", () => {
  const shown = boardView([]);
  shown.summary.state = "ready";
  render(<ControlGroupView view={shown} config={boardConfig} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
  fireEvent.click(screen.getByRole("tab", { name: "Preparation" }));
  expect(screen.getByRole("heading", { name: "Execution controls" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Pause new tasks" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Save progress and stop" })).toBeTruthy();
  // Issue #47: the execution controls are a bar above the tabs, no longer inside the Preparation tab.
  const region = screen.getByRole("heading", { name: "Execution controls" }).closest<HTMLElement>('[data-overview-region="dispatch"]')!;
  expect(within(region).getByText("Continuable work")).toBeTruthy();
  expect(within(region).getByText("Retryable work")).toBeTruthy();
  expect(within(region).getByText("Unresolved work")).toBeTruthy();
});

it("unresolved work counts distinct affected runs, not duplicate or group blockers", () => {
  const shown = boardView([], [boardRun({ runId: "run-a", state: "unknown" })]);
  shown.summary.state = "ready";
  shown.recoveryBlockers = [
    { scope: "run", code: "unresolved", runId: "run-a", evidenceIds: [] },
    { scope: "group", code: "group-blocked", runId: null, evidenceIds: [] },
  ];
  render(<ControlGroupView view={shown} config={boardConfig} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
  fireEvent.click(screen.getByRole("tab", { name: "Preparation" }));
  expect(screen.getByText("Unresolved work").nextElementSibling?.textContent).toBe("1");
});

it("unresolved Agent selections give a destination before confirmation", () => {
  const shown = boardView([]);
  shown.summary.state = "draft";
  shown.proposal.state = "editable";
  render(<ControlGroupView view={shown} config={boardConfig} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
  const region = screen.getByRole("tabpanel", { name: "Preparation" });
  // H6(b): the link opens the Agents category of the one Settings page. Ruling: human approved rewriting all necessary criteria, Orca session 7753e97d, 2026-10-27
  // The link names the page and category it opens. Ruling: human 「同意修改判据」 for the "Global settings" link label, Orca
  // session 3cd8fb02, 2026-10-27 (this fifth criterion was found after the four named ones; same label, same assertion).
  expect(within(region).getByRole("link", { name: "Settings › Agents" }).getAttribute("href")).toBe("#settings/agents");
  expect((within(region).getByRole("button", { name: "Confirm task plan" }) as HTMLButtonElement).disabled).toBe(true);
});

it("pending stop is stopping and settled stop is stopped only from stop facts", () => {
  const shown = boardView([]);
  shown.summary.stopMode = "handoff";
  shown.summary.stopState = "handoff-pending";
  shown.stop = { mode: "handoff", state: "handoff-pending", frozenRunIds: [], acceptedAt: null, deadlineAt: null };
  const mounted = render(<ControlGroupView view={shown} config={boardConfig} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
  expect(screen.getByTestId("stop-banner").textContent).toContain("Stopping");
  expect(screen.getByTestId("stop-banner").textContent).not.toContain("Stopped");
  mounted.rerender(<ControlGroupView view={{ ...shown, summary: { ...shown.summary, stopState: "handoff-complete" }, stop: { ...shown.stop, state: "handoff-complete" } }}
    config={boardConfig} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
  expect(screen.getByTestId("stop-banner").textContent).toContain("Stopped");
});
