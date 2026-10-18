// @vitest-environment jsdom
/**
 * Control run decisions plan Task 11, fix round 1: the page's own wiring of a group's decisions. App reads the open
 * group's decisions and reads them again when the group's revision moves (an approve moves it without a new
 * changeSeq), so a settled item's 需要人确认 goes away; 纠正 opens the decision's detail in Decisions, read by its
 * (projectKey, id); a failed read is said in place, never a silently missing badge (Rule 12). Fake fetch only (Rule 17).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { rowKey } from "../src/DecisionList.js";
import type { GroupDecisionsViewV1 } from "../src/controlTypes.js";
import { run, view, workItem } from "./fixtures/board.js";
import { ALPHA, groupSummary, installFakePanel } from "./fixtures/twoProjects.js";
import type { FakePanel } from "./fixtures/twoProjects.js";

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const DECISION_ID = "run-a/agent-1";
const decisionsRead = (state: "pending" | "approved"): GroupDecisionsViewV1 => ({
  schema: "orca-group-decisions-v1", groupId: "g", projectKey: "alpha", pendingCount: state === "pending" ? 1 : 0,
  tasks: [{ taskId: "a", runs: [{
    runId: "run-a", settled: true, reported: "array",
    decisions: [{ id: DECISION_ID, where: "working-tree", question: "Which port?", chose: "8080", kind: "interface", scope: "task" }],
    pending: [{ pendingId: "pending-run-a-0", reason: 'kind-unknown:"opinion"', question: "Which store?", chose: "sqlite", undoHow: `git revert --no-edit ${"a".repeat(40)}`, state }],
    unlanded: [],
  }] }],
});

let panel: FakePanel;
/** What GET /api/control/groups/g/decisions answers next. */
let decisions: () => Response;

beforeEach(() => {
  window.location.hash = "";
  panel = installFakePanel();
  const fake = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, request?: RequestInit): Promise<Response> => {
    if (String(input) === "/api/control/groups/g/decisions" && (request?.method ?? "GET") === "GET") {
      panel.requests.push(`GET ${String(input)}`);
      return decisions();
    }
    return fake(input, request);
  }) as typeof fetch;
  const summary = groupSummary("g", ALPHA);
  panel.summary = { ...panel.summary, groups: [summary] };
  const groupView = view([workItem({ taskId: "a", currentRunId: "run-a" })], [run({ runId: "run-a", state: "settled-recoverable" })]);
  panel.groupViews = { g: { ...groupView, summary, plan: { ...groupView.plan, repoId: ALPHA } } };
  panel.decisions[rowKey({ projectKey: "alpha", id: DECISION_ID })] = { id: DECISION_ID, question: "Which port?", chose: "8080", because: "b", alternatives: [] } as never;
});
afterEach(() => { cleanup(); window.sessionStorage.clear(); window.localStorage.clear(); vi.restoreAllMocks(); });

async function openTask(): Promise<HTMLElement> {
  const nav = await screen.findByRole("navigation", { name: "Control groups" });
  fireEvent.click(await within(nav).findByRole("button", { name: /^g · / }));
  const detail = await screen.findByRole("region", { name: "Control group g" });
  fireEvent.click(within(detail).getByRole("button", { name: "a", expanded: false }));
  return detail;
}

describe("a group's decisions in the page (control run decisions Task 11, fix round 1)", () => {
  it("drops 需要人确认 once an approve moves the revision, and 纠正 opens the decision in Decisions", async () => {
    let current: "pending" | "approved" = "pending";
    decisions = () => json(decisionsRead(current));
    panel.onPost = async (url) => {
      if (url !== "/api/control/groups/g/decisions/approve") return json({ schema: "orca-command-success-v1", commandRevision: 7 });
      // The approve moves the group's revision but not its changeSeq; only a re-read on the revision sees it settled.
      current = "approved";
      const moved = { ...panel.groupViews.g!.summary, commandRevision: 7 };
      panel.groupViews.g = { ...panel.groupViews.g!, summary: moved };
      panel.summary = { ...panel.summary, groups: [moved] };
      return json({ schema: "orca-command-success-v1", commandRevision: 7 });
    };
    render(<App />);
    const detail = await openTask();
    await within(detail).findByTestId("group-needs-human");
    const item = await within(detail).findByRole("listitem", { name: "pending-run-a-0" });
    fireEvent.click(within(item).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(panel.posts.map((post) => post.url)).toContain("/api/control/groups/g/decisions/approve"));
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Control group g" })).queryByTestId("group-needs-human")).toBeNull());

    fireEvent.click(within(screen.getByRole("region", { name: "Control group g" })).getByRole("button", { name: "Correct" }));
    await waitFor(() => expect(document.querySelector('[data-section="decisions"]')?.getAttribute("data-active")).toBe("true"));
    await waitFor(() => expect(screen.getByTestId("decision-question").textContent).toBe("Which port?"));
    const reads = panel.requests.filter((request) => request.startsWith("GET /api/decision?")).map((request) => {
      const params = new URL(request.slice(4), "http://panel.test").searchParams;
      return [params.get("projectKey"), params.get("decisionId")];
    });
    expect(reads).toEqual([["alpha", DECISION_ID]]);
  });

  it("says a failed decisions read in place of the decisions", async () => {
    decisions = () => json({ error: { code: "panel-unavailable", message: "down" } }, 503);
    render(<App />);
    const detail = await openTask();
    // mutation: drop the failed read's entry (the earlier behaviour) -> no line, red
    expect((await within(detail).findByTestId("decisions-read-failed")).textContent).toContain("panel-unavailable");
    expect(within(detail).queryByTestId("group-needs-human")).toBeNull();
  });

  it("says a failed decisions read under the group heading with no task open", async () => {
    // Final review T11 (Rule 12): the failure is visible without opening a task.
    decisions = () => json({ error: { code: "panel-unavailable", message: "down" } }, 503);
    render(<App />);
    const nav = await screen.findByRole("navigation", { name: "Control groups" });
    fireEvent.click(await within(nav).findByRole("button", { name: /^g · / }));
    const detail = await screen.findByRole("region", { name: "Control group g" });
    // mutation T11: drop the group-level line -> nothing names the failure until a task is opened, red
    expect((await within(detail).findByTestId("group-decisions-read-failed")).textContent).toContain("panel-unavailable");
    expect(within(detail).queryByTestId("decisions-read-failed")).toBeNull();
  });
});
