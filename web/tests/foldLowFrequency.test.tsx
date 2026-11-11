// @vitest-environment jsdom
/**
 * Tester follow-up F §3 (#81, human 「要收起来」; D21): low-frequency controls leave the main paths and wait one step away
 * -- a menu or a closed disclosure -- while staying reachable by keyboard; a member is offered no project change; and a
 * new requirement with no agent installed says so before submit. Each "not on the first screen" assertion is paired with
 * the step that reaches the control, so a criterion cannot pass by the control simply being gone.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountContext } from "../src/AuthGate.js";
import type { Me } from "../src/auth.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { FlowBoard } from "../src/FlowBoard.js";
import { Overview } from "../src/Overview.js";
import { ProjectControl } from "../src/ProjectControl.js";
import { RequirementsPanel } from "../src/RequirementsPanel.js";
import type { AgentsViewV1, RequirementViewV1 } from "../src/controlTypes.js";
import type { ProjectsAnswerV1 } from "../src/project.js";
import "../src/i18n.js";
import { config as boardConfig, view as boardView } from "./fixtures/board.js";
import { config, requirementView, summaryWith } from "./fixtures/requirement.js";

afterEach(cleanup);

const owner: Me = { user: { id: "u1", name: "olga", roles: ["owner"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };
const member: Me = { user: { id: "u2", name: "amy", roles: ["member"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };
const as = (me: Me | null, node: JSX.Element): JSX.Element => <AccountContext.Provider value={me}>{node}</AccountContext.Provider>;
const primaries = (): string[] => [...document.querySelectorAll<HTMLElement>(".btn-primary")].map((b) => b.textContent ?? "");
/** Opens the menu behind the button named `trigger` and returns its items' names. */
const menuItems = (trigger: string): string[] => {
  fireEvent.click(screen.getByRole("button", { name: trigger }));
  return within(screen.getByRole("menu")).getAllByRole("menuitem").map((item) => item.textContent ?? "");
};

describe("Overview: Import plan waits in More (#81)", () => {
  const overview = (onImport = vi.fn()) => render(<Overview model={{ progress: [], queue: [], issues: [], sources: [], complete: true, scopeUnavailable: false } as never}
    onOpen={vi.fn()} onImport={onImport} onRequirement={vi.fn()} />);

  // mutation: keep the Import plan button beside New requirement -> a button named Import plan on the first screen -> red
  // mutation: drop the Import plan item from More -> the item is not found -> red
  it("shows only New requirement in the heading and reaches Import plan through More", () => {
    const onImport = vi.fn();
    overview(onImport);
    expect(screen.queryByRole("button", { name: "Import plan" })).toBeNull();
    expect(primaries()).toEqual(["New requirement"]);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Import plan" }));
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  // mutation: the More trigger is not a button (a span with onClick) -> no keyboard open -> red
  it("opens More from the keyboard", () => {
    overview();
    const more = screen.getByRole("button", { name: "More" });
    more.focus();
    fireEvent.keyDown(more, { key: "Enter" });
    expect(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Import plan" })).toBeTruthy();
  });
});

describe("a group's library actions wait in its ⋯ menu (#81)", () => {
  // mutation: render Save plan / Schedule as header buttons again -> found as buttons on the first screen -> red
  // mutation: drop either item from the menu -> the item list differs -> red
  it("keeps Save plan and Schedule off the header and lists both in the menu", () => {
    render(as(owner, <ControlGroupView view={boardView([])} config={boardConfig} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />));
    expect(screen.queryByRole("button", { name: "Save plan to library" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Schedule this group…" })).toBeNull();
    expect(menuItems("More group actions")).toEqual(["Save plan to library", "Schedule this group…"]);
  });
});

describe("a split draft's Save split waits in its ⋯ menu (#81)", () => {
  // mutation: render Save split as a button in the action row again -> found on the first screen -> red
  it("keeps Save split off the review row and lists it in the draft's menu", () => {
    const view = requirementView("awaiting-review");
    render(as(owner, <RequirementsPanel config={config} summary={summaryWith(view)} views={{ r: view }} selected="r" agents={null} language="en" onSelect={vi.fn()} onCommand={vi.fn()} />));
    expect(screen.queryByRole("button", { name: "Save split to library" })).toBeNull();
    expect(screen.getByRole("button", { name: "Accept this split" })).toBeTruthy();
    expect(menuItems("More split actions")).toEqual(["Save split to library"]);
  });
});

describe("the new-requirement form folds its options (#81, #220)", () => {
  const agents = (installations: AgentsViewV1["installations"]): AgentsViewV1 => ({ schema: "orca-agents-view-v1", installations });
  const codex: AgentsViewV1["installations"][number] = { id: "codex", kind: "codex", defaults: { model: "gpt-6-sol", contextWindow: "agent-default" }, contextOptions: ["agent-default"], version: "0.155.1" };
  const form = (with_: AgentsViewV1 | null, me: Me | null = owner): HTMLElement => {
    const view: RequirementViewV1 = requirementView("answered");
    render(as(me, <RequirementsPanel config={config} summary={summaryWith(view)} views={{}} selected={null} agents={with_} language="en" onSelect={vi.fn()} onCommand={vi.fn()} />));
    return screen.getByRole("form", { name: "New requirement" });
  };

  // mutation: render the limit and the language outside the Options block -> their closest details is null -> red
  // mutation: start the Options block open -> `open` is true -> red
  // mutation: move the agent select into the Options block -> the agent's closest details is the block -> red
  it("puts token limit and content language in a closed Options block and keeps the agent on the first screen", () => {
    const shown = form(agents([codex]));
    const options = shown.querySelector<HTMLDetailsElement>("details[data-requirement-options]")!;
    expect(options.open).toBe(false);
    expect(within(options).getByText("Options")).toBeTruthy();
    expect(within(shown).getByRole("textbox", { name: "Token limit" }).closest("details")).toBe(options);
    expect(within(shown).getByRole("combobox", { name: "Content language" }).closest("details")).toBe(options);
    expect(within(shown).getByRole("combobox", { name: "Agent" }).closest("details")).toBeNull();
    // The summary names the language in force, so a folded choice is not a hidden one.
    expect(options.querySelector("summary")!.textContent).toContain("English");
    fireEvent.click(options.querySelector("summary")!);
    expect(options.open).toBe(true);
  });

  // mutation: drop the no-agent notice -> the testid is not found -> red
  // mutation: show it whatever is installed -> the one-installation case finds it -> red
  // mutation: link elsewhere than #settings/agents -> red
  it("says before submit that no agent is installed, and links to Settings > Agents", () => {
    const shown = form(agents([]));
    const note = within(shown).getByTestId("requirement-no-agent");
    expect(note.textContent).toContain("No agent is installed");
    expect(within(note).getByRole("link").getAttribute("href")).toBe("#settings/agents");
    cleanup();
    expect(within(form(agents([codex]))).queryByTestId("requirement-no-agent")).toBeNull();
    cleanup();
    // Not read yet is not "none installed".
    expect(within(form(null)).queryByTestId("requirement-no-agent")).toBeNull();
  });
});

describe("the Board has no primary of its own (#81)", () => {
  // mutation: give Start a flow btn-primary again -> one primary on the Board -> red
  it("offers Start a flow as a secondary button", () => {
    render(<FlowBoard groups={[]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Start a flow" })).toBeTruthy();
    expect(primaries()).toEqual([]);
  });
});

describe("D21: a member is offered no project change", () => {
  const answer: ProjectsAnswerV1 = {
    source: "file", editable: true, pendingRestart: [], fileError: null,
    projects: [{ projectKey: "orca", name: "Orca", path: "/r/orca", controlRepoId: "orca-22222222" }],
  };
  const control = (me: Me | null): void => {
    render(as(me, <ProjectControl answer={answer} project="orca" onProject={vi.fn()} onAdd={vi.fn()} onRename={vi.fn()} onAddMulti={vi.fn()} onSetDirs={vi.fn()} />));
  };
  const changes = ["Add project", "Rename project", "Group several projects", "Edit order"];

  // mutation: drop the member check -> a member sees Add / Rename / Group -> red
  // mutation: hide them for everyone -> the owner and the no-account cases find none -> red
  it("hides Add, Rename and the folder controls for a member, and keeps them for an owner and without accounts", () => {
    control(member);
    for (const name of changes) expect(screen.queryByRole("button", { name }), name).toBeNull();
    expect(screen.getByRole("combobox", { name: "Project" })).toBeTruthy();
    cleanup();
    control(owner);
    for (const name of changes) expect(screen.getByRole("button", { name }), name).toBeTruthy();
    cleanup();
    control(null);
    expect(screen.getByRole("button", { name: "Add project" })).toBeTruthy();
  });
});
