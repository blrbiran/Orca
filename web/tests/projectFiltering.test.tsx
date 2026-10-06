// @vitest-environment jsdom
/**
 * Project filtering spec §3, §5 (selection lifecycle), §8: the sidebar chooses "All projects" or one project; the
 * choice is this browser's (orca.projectView beside orca.project); a panel with fewer than two projects has no "All";
 * and whatever is open (group, requirement, decision) closes when the scope changes -- but not when the first project
 * list merely resolves. the first describes cover the selector, storage and the open details; "two-project lists" covers Task control, Requirements and the outcome-unknown line; "decision identity and count" covers the Decisions pane following the scope.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { PROJECT_KEY } from "../src/project.js";
import { PROJECT_VIEW_KEY } from "../src/projectScope.js";
import { HIDDEN_BY_FILTER } from "../src/DecisionsView.js";
import { rowKey } from "../src/DecisionList.js";
import { UNCERTAIN_COMMANDS_KEY } from "../src/controlApi.js";
import type { GroupSummaryV1, RequirementViewV1 } from "../src/controlTypes.js";
import { requirementView } from "./fixtures/requirement.js";
import { ALPHA, BETA, TWO_PROJECTS, decisionRow, groupSummary, installFakePanel, planGroupView, twoConfig } from "./fixtures/twoProjects.js";
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

/**
 * Task 4 (spec §5, §6 targets, §7, §8; plan decisions P1, P4, P5): Task control's group list and Requirements' list show
 * only the chosen project's rows, or every row labelled with its repository in All projects; an unresolved project list
 * shows a note instead of rows and offers no import or new requirement; in All projects both forms need an explicit target.
 */
describe("two-project lists", () => {
  const requirementBlock = requirementView("awaiting-answers").summary.requirement;
  /** a1 (alpha, ready), b1 (beta, running), and the requirement-bearing ra (alpha) and rb (beta), both clarifying. */
  function seedLists(extra: GroupSummaryV1[] = []): void {
    const a1 = groupSummary("a1", ALPHA, { state: "ready" });
    const b1 = groupSummary("b1", BETA);
    const ra = groupSummary("ra", ALPHA, { state: "clarifying", requirement: requirementBlock });
    const rb = groupSummary("rb", BETA, { state: "clarifying", requirement: requirementBlock });
    panel.summary = { ...panel.summary, groups: [a1, b1, ra, rb, ...extra] };
    panel.groupViews["a1"] = planGroupView(a1);
    panel.groupViews["b1"] = planGroupView(b1);
  }
  const controlNav = (): HTMLElement => screen.getByRole("navigation", { name: "Control groups" });
  const requirementNav = (): HTMLElement => screen.getByRole("navigation", { name: "Requirement list" });
  /** Every row's text in a nav: Task control's buttons and links, or Requirements' buttons. */
  const rows = (nav: HTMLElement): string[] =>
    Array.from(nav.querySelectorAll(":scope > button, :scope > a")).map((row) => row.textContent ?? "");
  const rowIds = (nav: HTMLElement): string[] => rows(nav).map((text) => text.split(" · ")[0]!);
  const listsReady = async (): Promise<void> => {
    await ready();
    await waitFor(() => expect(rows(controlNav()).length).toBeGreaterThan(0));
  };
  const importRegion = (): HTMLElement => screen.getByRole("region", { name: "Import plan" });
  const newRequirement = (): HTMLElement => screen.getByRole("form", { name: "New requirement" });
  const repositorySelect = (scope: HTMLElement): HTMLSelectElement => within(scope).getByRole("combobox", { name: "Repository" }) as HTMLSelectElement;
  const storeUncertain = (groupId: string, commandId: string): void => {
    window.sessionStorage.setItem(UNCERTAIN_COMMANDS_KEY, JSON.stringify([{ groupId, commandId }]));
  };

  it("1: Alpha lists only alpha's groups and requirements; Beta only beta's", async () => {
    seedLists();
    render(<App />);
    await listsReady();
    expect(rowIds(controlNav())).toEqual(["a1", "ra"]);
    expect(rowIds(requirementNav())).toEqual(["ra"]);
    fireEvent.change(projectSelect(), { target: { value: "beta" } });
    await waitFor(() => expect(rowIds(controlNav())).toEqual(["b1", "rb"]));
    expect(rowIds(requirementNav())).toEqual(["rb"]);
  });

  it("2: All projects lists every row, each ending with its project's name", async () => {
    seedLists();
    render(<App />);
    await listsReady();
    chooseAll();
    await waitFor(() => expect(rowIds(controlNav())).toEqual(["a1", "b1", "ra", "rb"]));
    const control = rows(controlNav());
    expect(control[0]).toMatch(/^a1 · ready.* · Alpha$/);
    expect(control[1]).toMatch(/^b1 · running.* · Beta$/);
    expect(control[2]).toMatch(/^ra · clarifying.* · Alpha$/);
    expect(control[3]).toMatch(/^rb · clarifying.* · Beta$/);
    expect(rows(requirementNav())).toEqual(["ra · clarifying · Alpha", "rb · clarifying · Beta"]);
  });

  it("3: a repository no project names is labelled by config's display name, else by its raw repoId", async () => {
    panel.config = { ...twoConfig, repositories: [...twoConfig.repositories, { repoId: "gamma-3", displayName: "Gamma" }] };
    seedLists([groupSummary("c1", "gamma-3"), groupSummary("z1", "zeta-9")]);
    render(<App />);
    await listsReady();
    chooseAll();
    await waitFor(() => expect(rowIds(controlNav())).toContain("z1"));
    const byId = Object.fromEntries(rows(controlNav()).map((text) => [text.split(" · ")[0]!, text]));
    expect(byId["c1"]).toMatch(/ · Gamma$/);
    expect(byId["z1"]).toMatch(/ · zeta-9$/);
    for (const id of ["c1", "z1"]) expect(byId[id]).not.toMatch(/Alpha|Beta/);
  });

  it("4: a project the control plane does not hold lists no groups and says it is not under task control", async () => {
    panel.projects = { status: 200, body: { projects: [...TWO_PROJECTS, { projectKey: "gamma", name: "Gamma", controlRepoId: null, editable: true }] } };
    seedLists();
    render(<App />);
    await listsReady();
    fireEvent.change(projectSelect(), { target: { value: "gamma" } });
    await waitFor(() => expect(rows(controlNav())).toEqual([]));
    expect(rows(requirementNav())).toEqual([]);
    expect(within(importRegion()).getByText(/not under task control/)).toBeTruthy();
    expect(within(importRegion()).queryByRole("button", { name: "Import plan" })).toBeNull();
    expect(within(requirementNav()).getByRole("note").textContent).toMatch(/not under task control.*start requirements/);
    expect(screen.queryByRole("button", { name: "Start clarifying" })).toBeNull();
  });

  it("5: an unresolved project list shows a note instead of rows and no import or new requirement; recovery and uncertain commands stay", async () => {
    panel.projects = { status: 500, body: { code: "boom", message: "boom" } };
    panel.recovery = { ...panel.recovery, blockers: [{ scope: "group", groupId: "b1", runId: null, code: "blocker-x", evidenceIds: [] }] };
    storeUncertain("b1", "cmd-b");
    seedLists();
    render(<App />);
    await screen.findByText(/blocker-x/);
    await waitFor(() => expect(panel.requests).toContain("GET /api/projects"));
    expect(within(controlNav()).getByRole("note").textContent).toBe("The project list is unavailable; groups are not shown until it is read.");
    expect(rows(controlNav())).toEqual([]);
    expect(rows(requirementNav())).toEqual([]);
    expect(within(requirementNav()).getByRole("note").textContent).toBe("The project list is unavailable; groups are not shown until it is read.");
    expect(within(importRegion()).queryByRole("button", { name: "Import plan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start clarifying" })).toBeNull();
    expect(screen.getByText(/Command outcome unknown, being looked up: cmd-b \(b1/)).toBeTruthy();
  });

  it("6: in All projects the import needs a chosen repository, lists only its plans, imports there and stays in All", async () => {
    // gamma-3 is configured but no registered project holds it: not a target.
    panel.config = { ...twoConfig, repositories: [...twoConfig.repositories, { repoId: "gamma-3", displayName: "Gamma" }], plans: [...twoConfig.plans, { planId: "pa2", repoId: ALPHA, displayName: "Alpha plan 2" }, { planId: "pb2", repoId: BETA, displayName: "Beta plan 2" }] };
    seedLists();
    render(<App />);
    await listsReady();
    chooseAll();
    await waitFor(() => expect(repositorySelect(importRegion()).value).toBe(""));
    expect(repositorySelect(importRegion()).selectedOptions[0]!.textContent).toBe("Choose a repository");
    expect(Array.from(repositorySelect(importRegion()).options).map((option) => [option.value, option.textContent])).toEqual([["", "Choose a repository"], [ALPHA, "Alpha"], [BETA, "Beta"]]);
    expect((within(importRegion()).getByRole("button", { name: "Import plan" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(repositorySelect(importRegion()), { target: { value: BETA } });
    const plan = within(importRegion()).getByRole("combobox", { name: "Plan" }) as HTMLSelectElement;
    expect(Array.from(plan.options).map((option) => option.value)).toEqual(["pb", "pb2"]);
    const button = within(importRegion()).getByRole("button", { name: "Import plan" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(panel.posts.some((post) => post.url === "/api/control/groups/import-plan")).toBe(true));
    const sent = panel.posts.find((post) => post.url === "/api/control/groups/import-plan")!.body as { payload: { repoId: string; planId: string } };
    expect(sent.payload).toMatchObject({ repoId: BETA, planId: "pb" });
    expect(selectedText()).toBe("All projects");
  });

  it("7: in All projects a new requirement needs a chosen repository and stays in All; in project mode the select moves the project", async () => {
    panel.config = { ...twoConfig, repositories: [...twoConfig.repositories, { repoId: "gamma-3", displayName: "Gamma" }] };
    seedLists();
    render(<App />);
    await listsReady();
    // Project mode: today's select, which moves the global project.
    expect(repositorySelect(newRequirement()).value).toBe(ALPHA);
    fireEvent.change(repositorySelect(newRequirement()), { target: { value: BETA } });
    await waitFor(() => expect(selectedText()).toBe("Beta"));

    chooseAll();
    await waitFor(() => expect(repositorySelect(newRequirement()).value).toBe(""));
    expect(Array.from(repositorySelect(newRequirement()).options).map((option) => [option.value, option.textContent])).toEqual([["", "Choose a repository"], [ALPHA, "Alpha"], [BETA, "Beta"]]);
    // A target chosen in All is forgotten when the person leaves All and comes back (no silent reuse, spec §6).
    fireEvent.change(repositorySelect(newRequirement()), { target: { value: ALPHA } });
    fireEvent.change(projectSelect(), { target: { value: "beta" } });
    await waitFor(() => expect(selectedText()).toBe("Beta"));
    chooseAll();
    await waitFor(() => expect(selectedText()).toBe("All projects"));
    await waitFor(() => expect(repositorySelect(newRequirement()).value).toBe(""));
    fireEvent.change(within(newRequirement()).getByRole("textbox", { name: "Idea" }), { target: { value: "export notes" } });
    const start = within(newRequirement()).getByRole("button", { name: "Start clarifying" }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.change(repositorySelect(newRequirement()), { target: { value: BETA } });
    expect(selectedText()).toBe("All projects");
    expect(start.disabled).toBe(false);
    fireEvent.click(start);
    await waitFor(() => expect(panel.posts.some((post) => post.url === "/api/control/requirements")).toBe(true));
    const sent = panel.posts.find((post) => post.url === "/api/control/requirements")!.body as { payload: { repoId: string; idea: string } };
    expect(sent.payload).toMatchObject({ repoId: BETA, idea: "export notes" });
    expect(selectedText()).toBe("All projects");
  });

  it("8: a partial summary that moves another project's group reads nothing whole again, and All then shows it moved", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      seedLists();
      render(<App />);
      await listsReady();
      const complete = (): number => panel.requests.filter((request) => request === "GET /api/control/summary").length;
      const partial = (): number => panel.requests.filter((request) => request.startsWith("GET /api/control/summary?sinceChangeSeq=")).length;
      const before = complete();
      expect(before).toBeGreaterThan(0);
      panel.summary = { ...panel.summary, changeSeq: panel.summary.changeSeq + 1, groups: [groupSummary("b1", BETA, { state: "done" })] };
      const partialBefore = partial();
      await act(async () => { await vi.advanceTimersByTimeAsync(3 * 2_000); });
      expect(partial()).toBeGreaterThanOrEqual(partialBefore + 3);
      expect(complete()).toBe(before);
      expect(rowIds(controlNav())).toEqual(["a1", "ra"]);
      chooseAll();
      await waitFor(() => expect(rows(controlNav()).find((text) => text.startsWith("b1 · "))).toMatch(/^b1 · done.* · Beta$/));
      expect(screen.queryByText(/projection refetch required/)).toBeNull();
      expect(complete()).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("9: the outcome-unknown line names every uncertain command with its repository, not only the open group's", async () => {
    storeUncertain("b1", "cmd-b");
    seedLists();
    render(<App />);
    await listsReady();
    fireEvent.click(within(controlNav()).getByRole("button", { name: /^a1 · / }));
    await screen.findByRole("region", { name: "Control group a1" });
    expect(screen.getByText(/Command outcome unknown, being looked up/).textContent).toContain("cmd-b (b1 · Beta)");
  });

  it("10: a requirement opened before a project switch does not open its detail when its answer arrives after", async () => {
    seedLists();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const base = panel.onPost;
    panel.onPost = async (url, body) => {
      if (url !== "/api/control/requirements") return base(url, body);
      // The new requirement is readable, so only the guard can keep its detail closed.
      const groupId = (body as { payload: { groupId: string } }).payload.groupId;
      const view = requirementView("awaiting-answers");
      panel.requirementViews[groupId] = { ...view, epoch: "epoch-a", summary: { ...view.summary, groupId, repoId: ALPHA }, requirement: { ...view.requirement, repoId: ALPHA } };
      await held;
      return base(url, body);
    };
    render(<App />);
    await listsReady();
    fireEvent.change(within(newRequirement()).getByRole("textbox", { name: "Idea" }), { target: { value: "export notes" } });
    fireEvent.click(within(newRequirement()).getByRole("button", { name: "Start clarifying" }));
    await waitFor(() => expect(panel.posts.some((post) => post.url === "/api/control/requirements")).toBe(true));
    fireEvent.change(projectSelect(), { target: { value: "beta" } });
    await waitFor(() => expect(selectedText()).toBe("Beta"));
    await act(async () => { release(); });
    const groupId = (panel.posts.find((post) => post.url === "/api/control/requirements")!.body as { payload: { groupId: string } }).payload.groupId;
    await waitFor(() => expect(panel.requests).toContain(`GET /api/control/groups/${groupId}/requirement`));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(within(screen.getByRole("region", { name: "Requirements" })).queryByRole("article")).toBeNull();
  });
});

describe("decision identity and count", () => {
  const pane = (): HTMLElement => document.querySelector(".decisions") as HTMLElement;
  const count = (): string => within(pane()).getByTestId("decision-count").textContent ?? "";
  const listRows = (): string[] => Array.from(pane().querySelectorAll(".decision-list button")).map((row) => row.textContent ?? "");
  const kindSelect = (): HTMLSelectElement => pane().querySelector("select[name=filter-kind]") as HTMLSelectElement;
  const decisionsSelect = (): HTMLSelectElement => within(pane()).getByRole("combobox", { name: "Repository" }) as HTMLSelectElement;
  const optionsOf = (select: HTMLSelectElement): string[] => Array.from(select.options).map((option) => option.textContent ?? "");
  /** alpha/d1, beta/d1 (same id) and beta/d2; each readable, answering with its own project as the question. */
  function seedDecisions(): void {
    panel.todo = [decisionRow("alpha", "d1"), decisionRow("beta", "d1", { kind: "boundary" }), decisionRow("beta", "d2")];
    for (const row of panel.todo) {
      panel.decisions[rowKey(row)] = { id: row.id, question: `question of ${row.projectKey}/${row.id}`, chose: "c", because: "b", alternatives: [] };
    }
  }
  const settled = async (text: string): Promise<void> => { await waitFor(() => expect(count()).toBe(text)); };

  it("1: the pane lists only the chosen project's rows, counted within it; All lists every row of both, d1 twice", async () => {
    seedDecisions();
    render(<App />);
    await ready();
    await settled("1 of 1");
    expect(listRows()).toHaveLength(1);
    fireEvent.change(projectSelect(), { target: { value: "beta" } });
    await settled("2 of 2");
    chooseAll();
    await settled("3 of 3");
    expect(listRows().filter((text) => text.includes("d1"))).toHaveLength(2);
  });

  it("2: the kind filter narrows within the project, and an open decision filtered away is still named by the note", async () => {
    seedDecisions();
    window.localStorage.setItem(PROJECT_KEY, "beta");
    render(<App />);
    await ready();
    await settled("2 of 2");
    fireEvent.click(Array.from(pane().querySelectorAll(".decision-list button")).find((row) => row.textContent?.includes("boundary"))!);
    await screen.findByTestId("decision-question");
    expect(within(pane()).queryByRole("note")).toBeNull();
    fireEvent.change(kindSelect(), { target: { value: "interface" } });
    await settled("1 of 2");
    expect(within(pane()).getByRole("note").textContent).toBe(HIDDEN_BY_FILTER);
  });

  it("3: a project with no rows shows Nothing to review and none of the others' rows", async () => {
    seedDecisions();
    panel.projects = { status: 200, body: { projects: [...TWO_PROJECTS, { projectKey: "gamma", name: "Gamma", controlRepoId: null, editable: true }] } };
    render(<App />);
    await ready();
    fireEvent.change(projectSelect(), { target: { value: "gamma" } });
    await settled("0 of 0");
    expect(within(pane()).getByText(/^Nothing to review/)).toBeTruthy();
    expect(listRows()).toEqual([]);
  });

  it("4: the Decisions repository select and the sidebar selector are one state, in both directions", async () => {
    seedDecisions();
    render(<App />);
    await ready();
    expect(optionsOf(decisionsSelect())).toEqual(optionsOf(projectSelect()));
    fireEvent.change(decisionsSelect(), { target: { value: decisionsSelect().options[0]!.value } });
    await waitFor(() => expect(selectedText()).toBe("All projects"));
    expect(decisionsSelect().selectedOptions[0]?.textContent).toBe("All projects");
    expect(window.localStorage.getItem(PROJECT_VIEW_KEY)).toBe("all");
    fireEvent.change(projectSelect(), { target: { value: "beta" } });
    await waitFor(() => expect(decisionsSelect().selectedOptions[0]?.textContent).toBe("Beta"));
    fireEvent.change(decisionsSelect(), { target: { value: "alpha" } });
    await waitFor(() => expect(selectedText()).toBe("Alpha"));
    expect(window.localStorage.getItem(PROJECT_VIEW_KEY)).toBe("project");
  });

  it("5: opening alpha/d1 reads alpha's decision, not beta's, though both are d1", async () => {
    seedDecisions();
    window.localStorage.setItem(PROJECT_VIEW_KEY, "all");
    render(<App />);
    await ready();
    await settled("3 of 3");
    const alphaRow = Array.from(pane().querySelectorAll(".decision-list button")).find((row) => row.textContent?.includes("Alpha"))!;
    fireEvent.click(alphaRow);
    expect((await screen.findByTestId("decision-question")).textContent).toBe("question of alpha/d1");
    const reads = panel.requests.filter((request) => request.startsWith("GET /api/decision?"));
    expect(reads).toHaveLength(1);
    expect(reads[0]).toContain("projectKey=alpha");
  });

  it("6: the kind filter survives a project switch, and the pane never keeps a repository filter of its own", async () => {
    seedDecisions();
    window.localStorage.setItem(PROJECT_KEY, "beta");
    render(<App />);
    await ready();
    await settled("2 of 2");
    fireEvent.change(kindSelect(), { target: { value: "boundary" } });
    await settled("1 of 2");
    chooseAll();
    await settled("1 of 3");
  });

  it("7: without a project list the pane keeps today's behaviour: every row, its own repository filter", async () => {
    seedDecisions();
    panel.projects = { status: 500, body: {} };
    render(<App />);
    await waitFor(() => expect(count()).toBe("3 of 3"));
    const select = within(pane()).getByRole("combobox", { name: "Repository" }) as HTMLSelectElement;
    expect(optionsOf(select)).toEqual(["any", "alpha", "beta"]);
    fireEvent.change(select, { target: { value: "beta" } });
    await waitFor(() => expect(count()).toBe("2 of 3"));
  });

  it("8: a repository filter set before the project list arrived does not hide rows once the scope takes over", async () => {
    seedDecisions();
    let release!: () => void;
    panel.holdProjects = new Promise<void>((resolve) => { release = resolve; });
    render(<App />);
    await waitFor(() => expect(count()).toBe("3 of 3"));
    fireEvent.change(within(pane()).getByRole("combobox", { name: "Repository" }), { target: { value: "beta" } });
    await waitFor(() => expect(count()).toBe("2 of 3"));
    await act(async () => { release(); });
    await ready();
    // Alpha is the chosen project: its one row shows, though the old filter named beta.
    await settled("1 of 1");
    expect(listRows()).toHaveLength(1);
  });
});
