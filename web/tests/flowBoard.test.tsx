// @vitest-environment jsdom
/**
 * Flow engine spec §14.1 (plan Task 16): a flow run is one card on the kanban -- its parent, with a template badge --
 * read from the run list, never from the summary (whose flow groups, parent and hidden `work` children, are not plan
 * groups). The card sits where the run is (waiting on the person, running, finished), opens the run page, and is scoped
 * like a group: a run tied to a project shows in that project's scope, a folder run in every scope. A flow can be
 * started from the board (P6).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardView } from "../src/BoardView.js";
import type { FlowListV1, GroupSummaryV1 } from "../src/controlTypes.js";
import { FlowBoard } from "../src/FlowBoard.js";
import "../src/i18n.js";

afterEach(cleanup);
const g = (over: Partial<GroupSummaryV1>): GroupSummaryV1 => ({
  groupId: "g", repoId: "r", state: "ready", commandRevision: 7, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0,
  completion: { done: 0, total: 2 }, counts: { idle: 2, running: 1, waiting: 0, blocked: 0, done: 0 }, executionPending: false, ...over,
});
const RUN_A = "fr-00000000-0000-4000-8000-00000000000a";
const RUN_B = "fr-00000000-0000-4000-8000-00000000000b";
const run = (over: Partial<FlowListV1["runs"][number]>): FlowListV1["runs"][number] => ({
  flowRunId: RUN_A, groupId: "flow-parent-a", templateRef: "builtin/wechat-article@1", state: "running", poolTokens: 2_000_000, poolDrawn: 500_000,
  projectId: null, dir: "/home/o/tea", needsYou: 0, ...over,
});
const column = (name: string): HTMLElement => screen.getByRole("region", { name });

describe("flow runs on the board (§14.1)", () => {
  it("shows each run as one card with its template badge, in the column of where it is", () => {
    render(<BoardView groups={[g({ groupId: "plan-1" })]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()}
      flows={[run({}), run({ flowRunId: RUN_B, needsYou: 2 }), run({ flowRunId: "fr-00000000-0000-4000-8000-00000000000c", state: "done" })]} />);
    const running = column("Running");
    expect(within(running).getByTestId(`board-flow-${RUN_A}`)).toBeTruthy();
    // mutation: drop the template badge -> not found, red
    expect(within(within(running).getByTestId(`board-flow-${RUN_A}`)).getByTestId("board-flow-badge").textContent).toBe("flow: wechat-article");
    expect(within(running).getByTestId("board-card-plan-1")).toBeTruthy();
    // mutation: put every run in Running -> RUN_B not in Needs you, red
    expect(within(column("Needs you")).getByTestId(`board-flow-${RUN_B}`).textContent).toContain("2 steps wait for you");
    expect(within(column("Done")).getByTestId("board-flow-fr-00000000-0000-4000-8000-00000000000c")).toBeTruthy();
    expect(within(running).getByTestId(`board-flow-${RUN_A}`).textContent).toContain("500K of 2M tokens drawn");
  });

  it("scopes a project's run to that project, and shows a folder run in every scope", () => {
    render(<BoardView groups={[]} scope={{ kind: "project", repoId: "other" }} onOpen={vi.fn()} onCommand={vi.fn()}
      flows={[run({}), run({ flowRunId: RUN_B, projectId: "mine" })]} />);
    expect(screen.getByTestId(`board-flow-${RUN_A}`)).toBeTruthy();
    // mutation: ignore the scope -> RUN_B shown, red
    expect(screen.queryByTestId(`board-flow-${RUN_B}`)).toBeNull();
  });
});

describe("the board reads flow runs and opens them (§14.1, P6)", () => {
  function serve(): Array<{ url: string; body: { payload: unknown } }> {
    const posts: Array<{ url: string; body: { payload: unknown } }> = [];
    document.cookie = "orca_csrf=t";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if ((init?.method ?? "GET") === "POST") {
        posts.push({ url, body: JSON.parse(String(init!.body)) });
        return new Response(JSON.stringify({ schema: "orca-command-success-v1", result: { kind: "flow-started", flowRunId: RUN_B, groupId: "flow-parent-b" } }), { status: 200 });
      }
      if (url === "/api/control/flows") return new Response(JSON.stringify({ schema: "orca-flow-list-v1", runs: [run({})] }), { status: 200 });
      return new Response(JSON.stringify({ error: { code: "flow-run-not-found", message: url } }), { status: 404 });
    }) as typeof fetch;
    return posts;
  }

  it("lists the runs from GET /api/control/flows and opens a run's page from its card", async () => {
    serve();
    render(<FlowBoard groups={[g({ groupId: "plan-1" })]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId(`board-flow-${RUN_A}`)).toBeTruthy());
    expect(screen.getAllByTestId(/^board-flow-fr-/)).toHaveLength(1);
    fireEvent.click(within(screen.getByTestId(`board-flow-${RUN_A}`)).getByRole("button"));
    await waitFor(() => expect(screen.getByRole("article").getAttribute("aria-label")).toContain(RUN_A));
    fireEvent.click(screen.getByRole("button", { name: "Back to the board" }));
    await waitFor(() => expect(screen.getByTestId(`board-flow-${RUN_A}`)).toBeTruthy());
  });

  it("starts a flow on a folder with the template's parameters, then opens it", async () => {
    const posts = serve();
    render(<FlowBoard groups={[]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    const form = screen.getByRole("form", { name: "Start a flow" });
    fireEvent.change(within(form).getByRole("textbox", { name: "Folder (absolute path)" }), { target: { value: "/home/o/tea" } });
    fireEvent.change(within(form).getByRole("textbox", { name: "Parameters, one key=value per line" }), { target: { value: "idea=Tea for engineers\nillustrations=true" } });
    fireEvent.click(within(form).getByRole("button", { name: "Start" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ url: "/api/control/flows", body: expect.objectContaining({ expectedRevision: 0, payload: {
      template: "wechat-article", dir: "/home/o/tea", params: { idea: "Tea for engineers", illustrations: true } } }) });
    await waitFor(() => expect(screen.getByRole("article").getAttribute("aria-label")).toContain(RUN_B));
  });
});
