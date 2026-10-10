// @vitest-environment jsdom
import { cleanup, render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { requirementView } from "./fixtures/requirement.js";
import { workItem, run } from "./fixtures/board.js";
import { rowKey } from "../src/DecisionList.js";
import { act } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { ALPHA, BETA, decisionRow, groupSummary, installFakePanel, planGroupView } from "./fixtures/twoProjects.js";
import type { OverviewV1 } from "../src/controlTypes.js";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let overview: OverviewV1;
let metricsFail: boolean;
beforeEach(() => { window.location.hash = ""; metricsFail = false;
 overview = { schema: "orca-control-overview-v1", epoch: "epoch-a", changeSeq: 1, groups: [], steps: [], issues: [] }; });
afterEach(() => { cleanup(); window.localStorage.clear(); window.sessionStorage.clear(); vi.restoreAllMocks(); });
function setup() {
 const panel = installFakePanel(); const base = globalThis.fetch;
 globalThis.fetch = (async (input, init) => {
  if (String(input) === "/api/control/overview") { panel.requests.push("GET /api/control/overview"); return json(overview); }
  if (String(input) === "/api/metrics" && metricsFail) return json({ code: "metrics-unavailable", message: "metrics unavailable" }, 503);
  return base(input, init);
 }) as typeof fetch;
 return panel;
}
it("opens Overview for an empty hash with progress before human work, without inventing work for running/dependencies", async () => {
 const panel = setup(); overview.groups = [groupSummary("running", ALPHA, { counts: { idle: 0, running: 1, waiting: 1, blocked: 0, done: 2 }, completion: { done: 2, total: 4 } })];
 render(<App />);
 const page = await screen.findByRole("region", { name: "Overview" });
 expect(screen.getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBe("page");
 const progress = within(page).getByRole("region", { name: "Progress" });
 const queue = within(page).getByRole("region", { name: "Needs your attention" });
 expect(progress.compareDocumentPosition(queue) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 await waitFor(() => expect(progress.textContent).toContain("2 / 4"));
 expect(within(queue).queryAllByRole("button")).toHaveLength(0);
 expect(panel.posts).toHaveLength(0);
});
it("metrics failure leaves healthy todo and control visible and shows metrics failure only in metrics", async () => {
 const panel = setup(); metricsFail = true; panel.todo = [decisionRow("alpha", "owed")]; overview.groups = [groupSummary("healthy", ALPHA)];
 render(<App />);
 const page = await screen.findByRole("region", { name: "Overview" });
 await within(page).findByRole("button", { name: /owed/ });
 expect(within(page).getByText(/healthy/)).toBeTruthy();
 expect(screen.getByTestId("nav-count-decisions").textContent).toBe("1");
 fireEvent.click(screen.getByRole("link", { name: "Metrics" }));
 expect(await screen.findByText(/metrics unavailable/)).toBeTruthy();
});
it("All queue navigation reads the live owner and focuses its requested region without posting", async () => {
 window.localStorage.setItem("orca.projectView", "all");
 const panel = setup(); const ga = groupSummary("ga", ALPHA); const gb = groupSummary("gb", BETA);
 panel.summary.groups = [ga, gb]; panel.groupViews.ga = planGroupView(ga); panel.groupViews.gb = planGroupView(gb);
 overview.groups = [ga, gb]; overview.steps = [{ key: "budget-gb", groupId: "gb", repoId: BETA, taskId: null, runId: null, kind: "budget-review", reason: "budget-review", ownerRequired: false, destination: { kind: "group", groupId: "gb", region: "preparation", taskId: null, runId: null } }];
 render(<App />);
 const page = await screen.findByRole("region", { name: "Overview" });
 fireEvent.click(await within(page).findByRole("button", { name: /budget.*gb/i }));
 await screen.findByRole("region", { name: "Control group gb" });
 await waitFor(() => expect(document.activeElement?.getAttribute("data-overview-region")).toBe("preparation"));
 expect(panel.requests).toContain("GET /api/control/groups/gb");
 expect(panel.requests).not.toContain("GET /api/control/groups/ga");
 expect(panel.posts).toHaveLength(0);
 expect((screen.getByRole("combobox", { name: "Project" }) as HTMLSelectElement).selectedOptions[0]?.textContent).toBe("All projects");
});

it.each(["answers", "draft", "problem"] as const)("opens exact requirement owner at %s region without group GET or POST", async (region) => {
 const panel = setup(); const requirement = requirementView(region === "draft" ? "awaiting-review" : "awaiting-answers");
 requirement.epoch = "epoch-a"; requirement.summary.repoId = ALPHA; requirement.requirement.repoId = ALPHA;
 panel.requirementViews.r = requirement; panel.summary.groups = [requirement.summary]; overview.groups = [requirement.summary];
 overview.steps = [{ key: "requirement-target", groupId: "r", repoId: ALPHA, taskId: null, runId: null, kind: region === "draft" ? "requirement-review" : region === "problem" ? "requirement-attention" : "requirement-answer", reason: "needed", ownerRequired: false, destination: { kind: "requirement", groupId: "r", region } }];
 render(<App />); const page = await screen.findByRole("region", { name: "Overview" });
 fireEvent.click(await within(page).findByRole("button", { name: /^(Answer requirement|Review split|Review requirement problem)/ }));
 await waitFor(() => expect(document.activeElement?.getAttribute("data-overview-region")).toBe(region));
 expect(panel.requests).toContain("GET /api/control/groups/r/requirement"); expect(panel.requests).not.toContain("GET /api/control/groups/r"); expect(panel.posts).toHaveLength(0);
});
it("same-name decision queue entries open their exact composite owner despite ordinary Decisions filters", async () => {
 window.localStorage.setItem("orca.projectView", "all"); const panel = setup(); panel.todo = [decisionRow("alpha", "same"), decisionRow("beta", "same", { kind: "boundary" })];
 for (const row of panel.todo) panel.decisions[rowKey(row)] = { id: row.id, question: row.projectKey + " exact question", chose: "c", because: "b", alternatives: [] };
 render(<App />); const page = await screen.findByRole("region", { name: "Overview" });
 fireEvent.click(screen.getByRole("link", { name: /^Decisions/ }));
 await waitFor(() => expect(document.querySelector('[data-section="decisions"]')?.getAttribute("data-active")).toBe("true"));
 await waitFor(() => expect(document.querySelector('select[name="filter-kind"] option[value="interface"]')).not.toBeNull());
 fireEvent.change(screen.getByRole("combobox", { name: "Kind" }), { target: { value: "interface" } });
 await waitFor(() => expect(document.querySelectorAll(".decision-list button")).toHaveLength(1));
 fireEvent.click(screen.getByRole("link", { name: "Overview" }));
 await waitFor(() => expect(document.querySelector('[data-section="overview"]')?.getAttribute("data-active")).toBe("true"));
 const buttons = await within(page).findAllByRole("button", { name: "Review decision · same" });
 expect(buttons).toHaveLength(2);
 fireEvent.click(buttons[1]!);
 expect((await screen.findByTestId("decision-question")).textContent).toBe("beta exact question");
 await waitFor(() => expect(document.activeElement?.getAttribute("data-overview-region")).toBe("decision"));
 expect(panel.requests.some((r) => r.includes("projectKey=beta") && r.includes("decisionId=same"))).toBe(true);
 expect(panel.posts).toHaveLength(0);
});
function groupQueue(panel: ReturnType<typeof setup>) {
 const ga = groupSummary("ga", ALPHA); const gb = groupSummary("gb", BETA); panel.summary.groups = [ga, gb];
 panel.groupViews.ga = planGroupView(ga); panel.groupViews.gb = planGroupView(gb); overview.groups = [ga, gb];
 overview.steps = [ga, gb].map((g) => ({ key: "budget-" + g.groupId, groupId: g.groupId, repoId: g.repoId, taskId: null, runId: null, kind: "budget-review" as const, reason: "editable", ownerRequired: false, destination: { kind: "group" as const, groupId: g.groupId, region: "preparation" as const, taskId: null, runId: null } }));
}
it.each(["removed", "wrong-body", "archived"])("a %s live owner shows reread/unavailable rather than opening a borrowed detail", async (kind) => {
 window.localStorage.setItem("orca.projectView", "all"); const panel = setup(); groupQueue(panel);
 if (kind === "removed") delete panel.groupViews.gb;
 if (kind === "wrong-body") panel.groupViews.gb = panel.groupViews.ga!;
 if (kind === "archived") panel.groupViews.gb = { ...panel.groupViews.gb!, summary: { ...panel.groupViews.gb!.summary, archived: true } };
 render(<App />); const page = await screen.findByRole("region", { name: "Overview" });
 fireEvent.click(await within(page).findByRole("button", { name: "Review budget · gb" }));
 expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("no longer available"));
 expect(screen.queryByRole("region", { name: "Control group gb" })).toBeNull(); expect(screen.queryByRole("region", { name: "Control group ga" })).toBeNull(); expect(panel.posts).toHaveLength(0);
});
it("an older owner response cannot reopen after a newer navigation", async () => {
 window.localStorage.setItem("orca.projectView", "all"); const panel = setup(); groupQueue(panel); const base = globalThis.fetch;
 let release!: (value: Response) => void; const held = new Promise<Response>((resolve) => { release = resolve; });
 globalThis.fetch = (async (input, init) => String(input) === "/api/control/groups/ga" ? held : base(input, init)) as typeof fetch;
 render(<App />); const page = await screen.findByRole("region", { name: "Overview" });
 fireEvent.click(await within(page).findByRole("button", { name: "Review budget · ga" }));
 fireEvent.click(within(page).getByRole("button", { name: "Review budget · gb" }));
 await screen.findByRole("region", { name: "Control group gb" });
 await act(async () => { release(json(panel.groupViews.ga)); });
 expect(screen.queryByRole("region", { name: "Control group ga" })).toBeNull(); expect(document.activeElement?.getAttribute("data-overview-region")).toBe("preparation");
 expect(panel.posts).toHaveLength(0);
});
it("an owner read older than the live projection cannot reopen after progress refresh", async () => {
 const panel = setup(); groupQueue(panel); const base = globalThis.fetch; let release!: (value: Response) => void;
 const held = new Promise<Response>((resolve) => { release = resolve; });
 globalThis.fetch = (async (input, init) => String(input) === "/api/control/groups/ga" ? held : base(input, init)) as typeof fetch;
 render(<App />); const page = await screen.findByRole("region", { name: "Overview" });
 fireEvent.click(await within(page).findByRole("button", { name: "Review budget · ga" }));
 overview = { ...overview, changeSeq: 8, groups: overview.groups.map((g) => ({ ...g, commandRevision: 9, projectionSeq: 8 })) };
 // Poll the real App active Overview source, then release the earlier owner read (changeSeq 4).
 await new Promise((resolve) => setTimeout(resolve, 2100));
 await act(async () => { release(json(panel.groupViews.ga)); });
 expect(screen.queryByRole("region", { name: "Control group ga" })).toBeNull();
 expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("no longer available"));
});

it.each(["task", "run"])("a disappeared requested %s rejects navigation to a misleading problem region", async (kind) => {
 const panel = setup(); groupQueue(panel); overview.steps = [{ ...overview.steps[0]!, kind: "task-attention", destination: { kind: "group", groupId: "ga", region: "problem", taskId: kind === "task" ? "missing-task" : null, runId: kind === "run" ? "missing-run" : null } }];
 render(<App />); const page = await screen.findByRole("region", { name: "Overview" });
 fireEvent.click(await within(page).findByRole("button", { name: "Review task problem · ga" }));
 expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("no longer available"));
 expect(screen.queryByRole("region", { name: "Control group ga" })).toBeNull(); expect(panel.posts).toHaveLength(0);
});
it("leaving scope while an owner GET is pending cannot reopen its old detail", async () => {
 const panel = setup(); groupQueue(panel); const base = globalThis.fetch; let release!: (value: Response) => void;
 const held = new Promise<Response>((resolve) => { release = resolve; });
 globalThis.fetch = (async (input, init) => String(input) === "/api/control/groups/ga" ? held : base(input, init)) as typeof fetch;
 render(<App />); const page = await screen.findByRole("region", { name: "Overview" });
 fireEvent.click(await within(page).findByRole("button", { name: "Review budget · ga" }));
 fireEvent.change(screen.getByRole("combobox", { name: "Project" }), { target: { value: "beta" } });
 await act(async () => { release(json(panel.groupViews.ga)); });
 expect(screen.queryByRole("region", { name: "Control group ga" })).toBeNull(); expect(panel.posts).toHaveLength(0);
});

it("a task/run attention destination opens the requested task before focusing its problem region", async () => {
 const panel = setup(); groupQueue(panel); panel.groupViews.ga = { ...panel.groupViews.ga!, workItems: [workItem({ taskId: "target-task", currentRunId: "target-run" })], runs: [run({ runId: "target-run", taskId: "target-task" })] };
 overview.steps = [{ ...overview.steps[0]!, kind: "task-attention", destination: { kind: "group", groupId: "ga", region: "problem", taskId: "target-task", runId: "target-run" } }];
 render(<App />); const page = await screen.findByRole("region", { name: "Overview" });
 fireEvent.click(await within(page).findByRole("button", { name: "Review task problem · ga" }));
 const detail = await screen.findByRole("region", { name: "Control group ga" });
 await waitFor(() => expect(within(detail).getByRole("button", { name: "target-task" }).getAttribute("aria-expanded")).toBe("true"));
 await waitFor(() => expect(document.activeElement?.getAttribute("data-overview-region")).toBe("problem"));
 expect(panel.posts).toHaveLength(0);
});
