// @vitest-environment jsdom
/**
 * Project filtering spec §3, §5 (selection lifecycle), §8: the sidebar chooses "All projects" or one project; the
 * choice is this browser's (orca.projectView beside orca.project); a panel with fewer than two projects has no "All";
 * and whatever is open (group, requirement, decision) closes when the scope changes -- but not when the first project
 * list merely resolves. Task 3 filters no list yet: these criteria cover the selector, storage and the details.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { PROJECT_KEY } from "../src/project.js";
import { PROJECT_VIEW_KEY } from "../src/projectScope.js";
import { rowKey } from "../src/DecisionList.js";
import type { RequirementViewV1 } from "../src/controlTypes.js";
import { requirementView } from "./fixtures/requirement.js";
import { ALPHA, BETA, TWO_PROJECTS, decisionRow, groupSummary, installFakePanel, planGroupView } from "./fixtures/twoProjects.js";
import type { FakePanel } from "./fixtures/twoProjects.js";

let panel: FakePanel;
beforeEach(() => { panel = installFakePanel(); });
afterEach(() => { cleanup(); window.sessionStorage.clear(); window.localStorage.clear(); vi.restoreAllMocks(); });

const projectSelect = (): HTMLSelectElement => screen.getByRole("combobox", { name: "Project" }) as HTMLSelectElement;
const optionNames = (): string[] => Array.from(projectSelect().options).map((option) => option.textContent ?? "");
const selectedText = (): string | undefined => projectSelect().selectedOptions[0]?.textContent ?? undefined;
const chooseAll = (): void => { fireEvent.change(projectSelect(), { target: { value: projectSelect().options[0]!.value } }); };
const ready = async (): Promise<void> => { await screen.findByRole("combobox", { name: "Project" }); };

/** One group per project, plus a requirement of alpha, one decision per project; every one of them openable. */
function seedOpenables(): void {
  const requirement: RequirementViewV1 = requirementView("awaiting-answers");
  const rSummary = { ...requirement.summary, groupId: "r", repoId: ALPHA };
  panel.requirementViews["r"] = { ...requirement, epoch: "epoch-a", summary: rSummary, requirement: { ...requirement.requirement, repoId: ALPHA } };
  const ga = groupSummary("ga", ALPHA);
  const gb = groupSummary("gb", BETA);
  panel.summary = { ...panel.summary, groups: [ga, gb, rSummary] };
  panel.groupViews["ga"] = planGroupView(ga);
  panel.groupViews["gb"] = planGroupView(gb);
  panel.todo = [decisionRow("alpha", "run-a/1"), decisionRow("beta", "run-b/1")];
  for (const row of panel.todo) {
    panel.decisions[rowKey(row)] = { id: row.id, question: `question of ${row.id}`, chose: "c", because: "b", alternatives: [] };
  }
}
const openGroup = async (groupId: string): Promise<void> => {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${groupId} · `) }));
  await screen.findByRole("region", { name: `Control group ${groupId}` });
};
const openDecision = async (id: string): Promise<void> => {
  const button = (await screen.findAllByRole("button")).find((candidate) => candidate.closest(".decision-list") !== null && candidate.textContent?.includes(id));
  fireEvent.click(button!);
  expect((await screen.findByTestId("decision-question")).textContent).toBe(`question of ${id}`);
};

describe("view mode and persistence", () => {
  it("1: two projects offer All projects first; choosing it stores the view and keeps the project", async () => {
    render(<App />);
    await ready();
    expect(optionNames()).toEqual(["All projects", "Alpha", "Beta"]);
    expect(selectedText()).toBe("Alpha");
    // The project is stored when the person picks one (a first start stores nothing); All must leave that choice alone.
    fireEvent.change(projectSelect(), { target: { value: "beta" } });
    fireEvent.change(projectSelect(), { target: { value: "alpha" } });
    chooseAll();
    await waitFor(() => expect(selectedText()).toBe("All projects"));
    expect(window.localStorage.getItem(PROJECT_VIEW_KEY)).toBe("all");
    expect(window.localStorage.getItem(PROJECT_KEY)).toBe("alpha");
  });

  it("2: a stored All survives a reload; choosing a project leaves All and survives a reload too", async () => {
    window.localStorage.setItem(PROJECT_VIEW_KEY, "all");
    window.localStorage.setItem(PROJECT_KEY, "beta");
    const first = render(<App />);
    await ready();
    expect(selectedText()).toBe("All projects");
    fireEvent.change(projectSelect(), { target: { value: "beta" } });
    await waitFor(() => expect(selectedText()).toBe("Beta"));
    expect(window.localStorage.getItem(PROJECT_VIEW_KEY)).toBe("project");
    expect(window.localStorage.getItem(PROJECT_KEY)).toBe("beta");
    first.unmount();
    render(<App />);
    await ready();
    expect(selectedText()).toBe("Beta");
  });

  it("3: with one project there is no All option, and a stored All is normalised to project", async () => {
    panel.projects = { status: 200, body: { projects: [TWO_PROJECTS[0]] } };
    window.localStorage.setItem(PROJECT_VIEW_KEY, "all");
    render(<App />);
    await ready();
    expect(optionNames()).toEqual(["Alpha"]);
    expect(selectedText()).toBe("Alpha");
    await waitFor(() => expect(window.localStorage.getItem(PROJECT_VIEW_KEY)).toBe("project"));
  });

  it("4: a bogus stored view means project; storage that throws still renders and switches", async () => {
    window.localStorage.setItem(PROJECT_VIEW_KEY, "bogus");
    const first = render(<App />);
    await ready();
    expect(selectedText()).toBe("Alpha");
    first.unmount();
    window.localStorage.clear();

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    render(<App />);
    await ready();
    expect(optionNames()).toEqual(["All projects", "Alpha", "Beta"]);
    chooseAll();
    await waitFor(() => expect(selectedText()).toBe("All projects"));
    fireEvent.change(projectSelect(), { target: { value: "beta" } });
    await waitFor(() => expect(selectedText()).toBe("Beta"));
  });
});

describe("selection lifecycle", () => {
  it("5: a project that disappears from the list falls back to the first, and its open group and decision close", async () => {
    seedOpenables();
    render(<App />);
    await ready();
    fireEvent.change(projectSelect(), { target: { value: "beta" } });
    await openGroup("gb");
    await openDecision("run-b/1");

    panel.projects = { status: 200, body: { projects: [TWO_PROJECTS[0]] } };
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(selectedText()).toBe("Alpha"));
    await waitFor(() => expect(screen.queryByRole("region", { name: /Control group/ })).toBeNull());
    expect(screen.queryByTestId("decision-question")).toBeNull();
    expect(screen.getByText("Select a decision to read it.")).toBeTruthy();
  });

  it("7: a decision opened before the project list answers stays open when the list resolves", async () => {
    seedOpenables();
    let release!: () => void;
    panel.holdProjects = new Promise<void>((resolve) => { release = resolve; });
    render(<App />);
    await openDecision("run-a/1");
    expect(screen.queryByRole("combobox", { name: "Project" })).toBeNull();
    release();
    await ready();
    await waitFor(() => expect(selectedText()).toBe("Alpha"));
    expect(screen.getByTestId("decision-question").textContent).toBe("question of run-a/1");
  });

  it("8: a failed project re-read neither closes the open group nor counts as a scope change when the list returns", async () => {
    seedOpenables();
    render(<App />);
    await ready();
    await openGroup("ga");
    const focus = async (): Promise<void> => { await act(async () => { window.dispatchEvent(new Event("focus")); }); };
    const good = panel.projects;
    panel.projects = { status: 500, body: { code: "boom", message: "boom" } };
    await focus();
    await waitFor(() => expect(screen.queryByRole("combobox", { name: "Project" })).toBeNull());
    expect(screen.getByRole("region", { name: "Control group ga" })).toBeTruthy();
    panel.projects = good;
    await focus();
    await ready();
    await waitFor(() => expect(selectedText()).toBe("Alpha"));
    expect(screen.getByRole("region", { name: "Control group ga" })).toBeTruthy();
  });

  it("6: changing the scope closes the open group, requirement and decision; the initial resolution closes nothing", async () => {
    seedOpenables();
    render(<App />);
    await ready();
    await openGroup("ga");
    fireEvent.click(await within(await screen.findByRole("navigation", { name: "Requirement list" })).findByRole("button", { name: /^r · clarifying/ }));
    await screen.findByRole("article", { name: "markdown-export" });
    await openDecision("run-a/1");
    expect(screen.getByRole("region", { name: "Control group ga" })).toBeTruthy();

    chooseAll();
    await waitFor(() => expect(screen.queryByRole("region", { name: /Control group/ })).toBeNull());
    expect(screen.queryByRole("article", { name: "markdown-export" })).toBeNull();
    expect(screen.queryByTestId("decision-question")).toBeNull();
    expect(screen.getByText("Select a decision to read it.")).toBeTruthy();
  });
});
