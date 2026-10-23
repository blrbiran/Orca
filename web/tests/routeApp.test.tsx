// @vitest-environment jsdom
/**
 * Tester round 2 spec §9.3, §9.4 (ruling H11; tester #45/#46/#47/#51/#52; C31-C35, C33a-C33d): the URL hash names what is
 * open -- a group with its region and task, a requirement, a decision, a flow run -- so a reload or Back restores it; a
 * route read on load waits for the first overview read; another project's group is a line and a switch button, never an
 * automatic switch; a jump into another section offers one way back, and a correction says which run it came from.
 */
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { rowKey } from "../src/DecisionList.js";
import type { GroupDecisionsViewV1, OverviewV1 } from "../src/controlTypes.js";
import { requirementView } from "./fixtures/requirement.js";
import { run, workItem } from "./fixtures/board.js";
import { ALPHA, BETA, groupSummary, installFakePanel, planGroupView, type FakePanel } from "./fixtures/twoProjects.js";

// A route waits for three reads (projects, control epoch, overview) before it opens; a loaded machine needs more than 1 s.
configure({ asyncUtilTimeout: 5000 });

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const PROJECT_KEY = "alpha";
const DECISION_ID = "run-a/agent-1";

let overview: OverviewV1;
let overviewGate: Promise<void> | null;
let releaseOverview: () => void;

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  overview = { schema: "orca-control-overview-v1", epoch: "epoch-a", changeSeq: 1, groups: [], steps: [], issues: [] };
  overviewGate = null;
});
afterEach(() => { cleanup(); window.localStorage.clear(); window.sessionStorage.clear(); vi.restoreAllMocks(); window.history.replaceState(null, "", "/"); });

const groupDecisions: GroupDecisionsViewV1 = {
  schema: "orca-group-decisions-v1", groupId: "g", projectKey: PROJECT_KEY, pendingCount: 0,
  tasks: [{ taskId: "a", runs: [{ runId: "run-a", settled: true, reported: "array", pending: [], unlanded: [],
    decisions: [{ id: DECISION_ID, where: "working-tree", question: "Which port?", chose: "8080", kind: "interface", scope: "task" }] }] }],
};

function setup(): FakePanel {
  const panel = installFakePanel();
  const g = groupSummary("g", ALPHA); const g2 = groupSummary("g2", ALPHA); const gb = groupSummary("gb", BETA);
  panel.summary.groups = [g, g2, gb];
  panel.groupViews.g = { ...planGroupView(g), workItems: [workItem({ taskId: "a", currentRunId: "run-a", lineageRunIds: ["run-a"] })], runs: [run({ runId: "run-a" })] };
  panel.groupViews.g2 = planGroupView(g2);
  panel.groupViews.gb = planGroupView(gb);
  const requirement = requirementView("awaiting-answers");
  requirement.epoch = "epoch-a"; requirement.summary.repoId = ALPHA; requirement.requirement.repoId = ALPHA;
  panel.requirementViews.r = requirement;
  panel.decisions[rowKey({ projectKey: PROJECT_KEY, id: DECISION_ID })] = { id: DECISION_ID, question: "the routed decision's question", chose: "8080", because: "why", alternatives: [] };
  overview.groups = [g, g2, gb, requirement.summary];
  const base = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url === "/api/control/overview") { panel.requests.push("GET /api/control/overview"); if (overviewGate !== null) await overviewGate; return json(overview); }
    if (url === "/api/control/groups/g/decisions") return json(groupDecisions);
    if (url === "/api/control/flows") return json({ schema: "orca-flow-list-v1", runs: [] });
    return base(input, init);
  }) as typeof fetch;
  return panel;
}
const gate = (): void => { overviewGate = new Promise((resolve) => { releaseOverview = resolve; }); };
const at = (hash: string): void => { window.history.replaceState(null, "", hash); };
const groupRegion = (groupId: string) => screen.findByRole("region", { name: `Control group ${groupId}` });
const back = async (): Promise<void> => { await act(async () => { window.history.back(); await new Promise((resolve) => setTimeout(resolve, 20)); }); };

describe("a group's region and open task are in the route (C31, C35)", () => {
  it("re-mounting on #tasks/g/preparation/a restores the group, the region and the open task; a tab click replaces, opening a group pushes", async () => {
    setup(); at("#tasks/g/preparation/a");
    render(<App />);
    await groupRegion("g");
    await waitFor(() => expect(screen.getByRole("tab", { selected: true }).textContent).toBe("Preparation"));
    expect(screen.getByRole("region", { name: "Task a" })).toBeTruthy();
    const length = window.history.length;
    fireEvent.click(screen.getByRole("tab", { name: "Runs and evidence" }));
    expect(window.location.hash).toBe("#tasks/g/runs/a");
    expect(window.history.length).toBe(length);
    fireEvent.click(screen.getByRole("button", { name: /^g2 ·/ }));
    expect(window.location.hash).toBe("#tasks/g2");
    await waitFor(() => expect(window.history.length).toBe(length + 1));
  });

  it("an old bare #tasks link still opens Task control", async () => {
    setup(); at("#tasks");
    render(<App />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Task control" }).getAttribute("aria-current")).toBe("page"));
    expect(await screen.findByRole("button", { name: /^g ·/ })).toBeTruthy();
  });
});

describe("a flow run is in the route (C32)", () => {
  it("#board/flow/f1 mounts on that run page; leaving and Back returns to it", async () => {
    setup(); at("#board/flow/f1");
    render(<App />);
    expect(await screen.findByRole("button", { name: "Back to the board" })).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Task control" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Back to the board" })).toBeNull());
    await back();
    expect(window.location.hash).toBe("#board/flow/f1");
    expect(await screen.findByRole("button", { name: "Back to the board" })).toBeTruthy();
  });
});

describe("another project's group (C33)", () => {
  it("leaves the project unchanged, shows the line and the switch button; the button switches and opens the group", async () => {
    const panel = setup(); at("#tasks/gb");
    render(<App />);
    const notice = await screen.findByTestId("route-notice");
    expect(notice.textContent).toContain("gb belongs to project Beta.");
    expect((screen.getByRole("combobox", { name: "Project" }) as HTMLSelectElement).value).toBe("alpha");
    expect(panel.requests).not.toContain("GET /api/control/groups/gb");
    fireEvent.click(within(notice).getByRole("button", { name: "Switch to Beta" }));
    await groupRegion("gb");
    expect((screen.getByRole("combobox", { name: "Project" }) as HTMLSelectElement).value).toBe("beta");
  });
});

describe("a route read on load waits for the first overview read (C33a, C33d)", () => {
  it("#requirements/r shows the bare section first, then opens the requirement once the overview answers", async () => {
    const panel = setup(); gate(); at("#requirements/r");
    render(<App />);
    await waitFor(() => expect(panel.requests).toContain("GET /api/control/overview"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole("link", { name: "Requirements" }).getAttribute("aria-current")).toBe("page");
    expect(panel.requests).not.toContain("GET /api/control/groups/r/requirement");
    await act(async () => { releaseOverview(); });
    await waitFor(() => expect(document.getElementById("overview-requirement-r-answers")).not.toBeNull());
  });

  it("#decisions/<pk>/<id> fetches that decision by id and opens it with no list row, after the overview answers", async () => {
    const panel = setup(); gate(); at(`#decisions/${PROJECT_KEY}/${encodeURIComponent(DECISION_ID)}`);
    render(<App />);
    await waitFor(() => expect(panel.requests).toContain("GET /api/control/overview"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(panel.requests.some((request) => request.startsWith("GET /api/decision?"))).toBe(false);
    await act(async () => { releaseOverview(); });
    expect(await screen.findByText("the routed decision's question")).toBeTruthy();
    expect(panel.todo).toEqual([]);
  });

  it("a navigation before the first read answers cancels the pending route; the late answer opens nothing", async () => {
    const panel = setup(); gate(); at("#tasks/g");
    render(<App />);
    await waitFor(() => expect(panel.requests).toContain("GET /api/control/overview"));
    fireEvent.click(screen.getByRole("link", { name: "Metrics" }));
    await waitFor(() => expect(window.location.hash).toBe("#metrics"));
    await act(async () => { releaseOverview(); await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(panel.requests).not.toContain("GET /api/control/groups/g");
    expect(screen.getByRole("link", { name: "Metrics" }).getAttribute("aria-current")).toBe("page");
  });
});

describe("a missing owner and bare sections (C33b, C33c)", () => {
  it("a group that does not exist shows routeMissing with the id and the bare section", async () => {
    setup(); at("#tasks/nope");
    render(<App />);
    expect((await screen.findByTestId("route-notice")).textContent).toBe("nope was not found; showing Task control.");
    expect(window.location.hash).toBe("#tasks");
  });

  it("Back from #tasks/g to a bare #tasks keeps group g open", async () => {
    setup(); at("#tasks");
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^g ·/ }));
    await groupRegion("g");
    expect(window.location.hash).toBe("#tasks/g");
    await back();
    expect(window.location.hash).toBe("#tasks");
    expect(screen.getByRole("region", { name: "Control group g" })).toBeTruthy();
  });
});

describe("the back line and the correction's origin (C34)", () => {
  async function correctFromRun(): Promise<void> {
    fireEvent.click(await screen.findByRole("button", { name: "Correct" }));
    await waitFor(() => expect(window.location.hash).toBe(`#decisions/${PROJECT_KEY}/${encodeURIComponent(DECISION_ID)}`));
  }
  async function openTaskA(): Promise<void> {
    at("#tasks/g/progress/a");
    render(<App />);
    await groupRegion("g");
    await screen.findByRole("region", { name: "Task a" });
  }

  it("a jump from a group to Decisions shows the back line, which goes back; the origin names group, task and run", async () => {
    setup(); await openTaskA();
    await correctFromRun();
    expect(screen.getByTestId("decision-origin").textContent).toBe("From g / a / run-a");
    const line = screen.getByRole("button", { name: "← Back to Task control" });
    expect(await screen.findByText("the routed decision's question")).toBeTruthy();
    fireEvent.click(line);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(window.location.hash).toBe("#tasks/g/progress/a");
    expect(screen.queryByRole("button", { name: /^← Back to/ })).toBeNull();
  });

  it("stays across a replace within the section, and disappears after a sidebar link", async () => {
    setup(); await openTaskA();
    await correctFromRun();
    fireEvent.click(screen.getByRole("button", { name: "Corrections" }));
    expect(window.location.hash).toBe("#decisions/corrections");
    expect(screen.getByRole("button", { name: "← Back to Task control" })).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Metrics" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /^← Back to/ })).toBeNull());
  });

  it("disappears after Back to another hash and after a project switch", async () => {
    setup(); await openTaskA();
    await correctFromRun();
    window.location.hash = "#memory";
    await waitFor(() => expect(screen.queryByRole("button", { name: /^← Back to/ })).toBeNull());
    await back();
    expect(window.location.hash).toBe(`#decisions/${PROJECT_KEY}/${encodeURIComponent(DECISION_ID)}`);
    expect(screen.queryByRole("button", { name: /^← Back to/ })).toBeNull();
    cleanup(); setup(); await openTaskA();
    await correctFromRun();
    expect(screen.getByRole("button", { name: "← Back to Task control" })).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Project" }), { target: { value: "beta" } });
    await waitFor(() => expect(screen.queryByRole("button", { name: /^← Back to/ })).toBeNull());
  });
});
