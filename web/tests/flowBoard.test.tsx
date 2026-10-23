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

// Gaps spec §8.4, plan Task 10-B: the templates read and the effective defaults the start dialog shows.
const TEMPLATES = { schema: "orca-flow-templates-v1", templates: [
  { id: "wechat-article", version: 3, title: { en: "WeChat article", zh: "公众号文章" }, excludes: [".md2publish/cache/"], params: [
    { id: "idea", type: "longtext", required: true }, { id: "slug", type: "slug", required: false, derive: "slug-of-idea" },
    { id: "language", type: "enum", required: false, options: ["zh", "en"], default: "zh" }, { id: "illustrations", type: "bool", required: false, default: false },
    { id: "coverImage", type: "image", required: false }] },
  { id: "demo", version: 1, title: null, excludes: [], params: [{ id: "count", type: "int", required: true }, { id: "target", type: "path", required: false }] },
] };
const PRESET = { value: "/covers/default.png", source: "global", lockedBy: null };

describe("the board reads flow runs and opens them (§14.1, P6)", () => {
  let reads: string[] = [];
  function serve(answer: { status: number; body: unknown } = { status: 200, body: { schema: "orca-command-success-v1", result: { kind: "flow-started", flowRunId: RUN_B, groupId: "flow-parent-b" } } },
    images: { files: string[]; truncated: boolean } = { files: ["covers/a.png", "covers/b.jpg"], truncated: false }): Array<{ url: string; body: { payload: unknown } }> {
    const posts: Array<{ url: string; body: { payload: unknown } }> = [];
    reads = [];
    document.cookie = "orca_csrf=t";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if ((init?.method ?? "GET") === "POST") {
        posts.push({ url, body: JSON.parse(String(init!.body)) });
        return new Response(JSON.stringify(answer.body), { status: answer.status });
      }
      reads.push(url);
      if (url === "/api/control/flows") return new Response(JSON.stringify({ schema: "orca-flow-list-v1", runs: [run({})] }), { status: 200 });
      if (url === "/api/control/flows/templates") return new Response(JSON.stringify(TEMPLATES), { status: 200 });
      if (url === "/api/control/flows/settings") return new Response(JSON.stringify({ paramDefaults: { "wechat-article": { coverImage: PRESET } } }), { status: 200 });
      if (url.startsWith("/api/control/flows/images?")) return new Response(JSON.stringify({ schema: "orca-flow-folder-images-v1", dir: "/home/o/tea", ...images, limit: 200 }), { status: 200 });
      return new Response(JSON.stringify({ error: { code: "flow-run-not-found", message: url } }), { status: 404 });
    }) as typeof fetch;
    return posts;
  }
  const openDialog = async (): Promise<HTMLElement> => {
    fireEvent.click(screen.getByRole("button", { name: "Start a flow" }));
    const dialog = screen.getByRole("dialog", { name: "Start a flow" });
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "Built-in template" })).toBeTruthy());
    return dialog;
  };
  const param = (dialog: HTMLElement, id: string): HTMLElement => within(dialog).getByTestId(`flow-start-param-${id}`);

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
    const dialog = await openDialog();
    const form = within(dialog).getByRole("form", { name: "Start a flow" });
    fireEvent.change(within(form).getByRole("textbox", { name: "Folder (absolute path)" }), { target: { value: "/home/o/tea" } });
    fireEvent.change(within(param(form, "idea")).getByRole("textbox", { name: "idea (required)" }), { target: { value: "Tea for engineers" } });
    fireEvent.click(within(param(form, "illustrations")).getByRole("checkbox", { name: "illustrations" }));
    fireEvent.click(within(form).getByRole("button", { name: "Start" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    // Untouched params are not sent: the server fills them as each field's default line says.
    expect(posts[0]).toEqual({ url: "/api/control/flows", body: expect.objectContaining({ expectedRevision: 0, payload: {
      template: "wechat-article", dir: "/home/o/tea", params: { idea: "Tea for engineers", illustrations: true } } }) });
    await waitFor(() => expect(screen.getByRole("article").getAttribute("aria-label")).toContain(RUN_B));
  });

  it("opens the start dialog from a top-left button on the board; Escape and Cancel close it and start nothing", async () => {
    const posts = serve();
    render(<FlowBoard groups={[]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    const board = screen.getByRole("region", { name: "Board" });
    const button = within(board).getByRole("button", { name: "Start a flow" });
    // Top left: the first control under the board's title, before the board/graph choice.
    // mutation: render the start below the columns (the old bottom-left place) -> not first / not in the board, red
    expect(button.compareDocumentPosition(within(board).getByRole("group", { name: "Board view" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(board.querySelector("h2")!.nextElementSibling!.contains(button)).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("form", { name: "Start a flow" })).toBeNull();
    let dialog = await openDialog();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Folder (absolute path)" }), { target: { value: "/home/o/tea" } });
    fireEvent.change(within(param(dialog, "idea")).getByRole("textbox", { name: "idea (required)" }), { target: { value: "Tea" } });
    fireEvent.keyDown(within(dialog).getByRole("textbox", { name: "Folder (absolute path)" }), { key: "Escape" });
    // mutation: Escape ignored -> dialog still there, red
    expect(screen.queryByRole("dialog")).toBeNull();
    dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    // mutation: Cancel submits -> a post, red
    expect(posts).toEqual([]);
  });

  it("offers the built-ins as a choice and one field per param, typed by the param", async () => {
    const posts = serve();
    render(<FlowBoard groups={[]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    const dialog = await openDialog();
    const choice = within(dialog).getByRole("combobox", { name: "Built-in template" }) as HTMLSelectElement;
    expect([...choice.options].map((o) => [o.value, o.textContent])).toEqual([["wechat-article", "WeChat article"], ["demo", "demo"]]);
    // mutation: the old key=value text area -> found, red
    expect(within(dialog).queryByRole("textbox", { name: "Parameters, one key=value per line" })).toBeNull();
    expect(param(dialog, "idea").querySelector("textarea")).not.toBeNull();
    expect((within(param(dialog, "language")).getByRole("combobox", { name: "language" }) as HTMLSelectElement).value).toBe("");
    expect(within(param(dialog, "illustrations")).getByRole("checkbox", { name: "illustrations" })).toBeTruthy();
    expect(within(param(dialog, "coverImage")).getByRole("textbox", { name: "coverImage: a path inside the folder" })).toBeTruthy();
    fireEvent.change(choice, { target: { value: "demo" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Folder (absolute path)" }), { target: { value: "/home/o/tea" } });
    const count = within(param(dialog, "count")).getByRole("spinbutton", { name: "count (required)" });
    // A required param with no default holds Start back until it is given.
    expect((within(dialog).getByRole("button", { name: "Start" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(count, { target: { value: "3" } });
    fireEvent.change(within(param(dialog, "target")).getByRole("textbox", { name: "target: a path inside the folder" }), { target: { value: "out/notes.md" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    // mutation: send every value as text -> count "3", red
    expect(posts[0]!.body.payload).toEqual({ template: "demo", dir: "/home/o/tea", params: { count: 3, target: "out/notes.md" } });
  });

  it("picks an image param from the folder's images and shows each param's effective default with its source", async () => {
    const posts = serve();
    render(<FlowBoard groups={[]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    const dialog = await openDialog();
    const cover = param(dialog, "coverImage");
    // mutation: show no default / the wrong source -> red
    expect(within(cover).getByTestId("flow-start-default").textContent).toBe("default: /covers/default.png (global preset)");
    expect(within(param(dialog, "language")).getByTestId("flow-start-default").textContent).toBe("default: zh (template)");
    expect(within(param(dialog, "slug")).getByTestId("flow-start-default").textContent).toBe("default: made from the idea (template)");
    expect(within(param(dialog, "idea")).queryByTestId("flow-start-default")).toBeNull();
    expect(cover.textContent).toContain("Enter the folder to pick one of its images.");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Folder (absolute path)" }), { target: { value: "/home/o/tea" } });
    const picker = await waitFor(() => within(cover).getByRole("combobox", { name: "coverImage: an image in the folder" }) as HTMLSelectElement);
    // mutation: list without the template (its excludes) -> url without template, red
    expect(reads).toContain(`/api/control/flows/images?dir=${encodeURIComponent("/home/o/tea")}&template=wechat-article`);
    expect([...picker.options].map((o) => o.value)).toEqual(["", "covers/a.png", "covers/b.jpg"]);
    fireEvent.change(picker, { target: { value: "covers/b.jpg" } });
    expect((within(cover).getByRole("textbox", { name: "coverImage: a path inside the folder" }) as HTMLInputElement).value).toBe("covers/b.jpg");
    fireEvent.change(within(param(dialog, "idea")).getByRole("textbox", { name: "idea (required)" }), { target: { value: "Tea" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    // mutation: the picker does not fill the param -> no coverImage, red
    expect(posts[0]!.body.payload).toEqual({ template: "wechat-article", dir: "/home/o/tea", params: { idea: "Tea", coverImage: "covers/b.jpg" } });
  });

  it("says when the folder's images were cut at 200", async () => {
    serve(undefined, { files: ["a.png"], truncated: true });
    render(<FlowBoard groups={[]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Folder (absolute path)" }), { target: { value: "/home/o/tea" } });
    // mutation: drop the truncated note -> not found, red
    await waitFor(() => expect(param(dialog, "coverImage").textContent).toContain("Only the first 200 image files are listed; type the path of another."));
  });

  it("keeps a refusal in the dialog and opens no run", async () => {
    const posts = serve({ status: 422, body: { error: { code: "flow-param-invalid:coverImage", message: "not a png, jpg, gif or webp image by its bytes", retryable: false } } });
    render(<FlowBoard groups={[]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Folder (absolute path)" }), { target: { value: "/home/o/tea" } });
    fireEvent.change(within(param(dialog, "idea")).getByRole("textbox", { name: "idea (required)" }), { target: { value: "Tea" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    // mutation: close the dialog on a refusal -> no alert in it, red
    await waitFor(() => expect(within(screen.getByRole("dialog", { name: "Start a flow" })).getByTestId("refusal-code").textContent).toBe("flow-param-invalid:coverImage"));
    expect(screen.queryByRole("article")).toBeNull();
  });
});
