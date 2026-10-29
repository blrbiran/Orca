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
import { optionsOf, pickOption, shownText } from "./selectControl.js";

afterEach(cleanup);
const g = (over: Partial<GroupSummaryV1>): GroupSummaryV1 => ({
  groupId: "g", repoId: "r", state: "ready", commandRevision: 7, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0,
  completion: { done: 0, total: 2 }, counts: { idle: 2, running: 1, waiting: 0, blocked: 0, done: 0 }, executionPending: false, ...over,
});
const RUN_A = "fr-00000000-0000-4000-8000-00000000000a";
const RUN_B = "fr-00000000-0000-4000-8000-00000000000b";
const run = (over: Partial<FlowListV1["runs"][number]>): FlowListV1["runs"][number] => ({
  flowRunId: RUN_A, groupId: "flow-parent-a", templateRef: "builtin/wechat-article@1", state: "running", poolTokens: 2_000_000, poolDrawn: 500_000,
  projectId: null, dir: "/home/o/tea", needsYou: 0, scheduled: null, ...over,
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
    images: { files: string[]; truncated: boolean } = { files: ["covers/a.png", "covers/b.jpg"], truncated: false },
    // Task 10-B fix round 1: a read answered by the test (the settings or images read), else the defaults above.
    custom: (url: string) => Promise<Response> | null = () => null): Array<{ url: string; body: { payload: unknown } }> {
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
      const answered = custom(url);
      if (answered !== null) return answered;
      if (url === "/api/control/flows/settings" || url.startsWith("/api/control/flows/settings?dir=")) return new Response(JSON.stringify({ paramDefaults: { "wechat-article": { coverImage: PRESET } } }), { status: 200 });
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
    // Ruling: human 「这次批准改写所有必要的判据」 (session b999cc81): the built-ins offered in order, the template picker focused on open, an enum param left on "use the default", and the picked template is the one the start sends
    const choice = within(dialog).getByRole("combobox", { name: "Built-in template" });
    expect(document.activeElement).toBe(choice);
    expect(await optionsOf(choice)).toEqual([["WeChat article", false], ["demo", false]]);
    // Escape that closes the list is the list's, not the dialog's -- mutation: FlowBoard closes on every Escape -> dialog gone, red
    expect(screen.getByRole("dialog", { name: "Start a flow" })).toBe(dialog);
    // mutation: the old key=value text area -> found, red
    expect(within(dialog).queryByRole("textbox", { name: "Parameters, one key=value per line" })).toBeNull();
    expect(param(dialog, "idea").querySelector("textarea")).not.toBeNull();
    expect(shownText(within(param(dialog, "language")).getByRole("combobox", { name: "language" }))).toBe("use the default");
    expect(within(param(dialog, "illustrations")).getByRole("checkbox", { name: "illustrations" })).toBeTruthy();
    expect(within(param(dialog, "coverImage")).getByRole("textbox", { name: "coverImage: a path inside the folder" })).toBeTruthy();
    await pickOption(choice, "demo");
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

  // Task 11 acceptance (session ffec7b28): an image param with no default offered "none picked (use the default)".
  // Mutation "one empty-option text": the no-default picker says "use the default" again.
  it("offers 'use the default' in the picker only when the param has one", async () => {
    serve(undefined, undefined, (url) => url.startsWith("/api/control/flows/settings") ? Promise.resolve(new Response(JSON.stringify({ paramDefaults: {} }), { status: 200 })) : null);
    render(<FlowBoard groups={[]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Folder (absolute path)" }), { target: { value: "/home/o/tea" } });
    const picker = await waitFor(() => within(param(dialog, "coverImage")).getByRole("combobox", { name: "coverImage: an image in the folder" }) as HTMLSelectElement);
    expect(picker.options[0]!.textContent).toBe("choose an image");
    cleanup();
    serve();
    render(<FlowBoard groups={[]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    const again = await openDialog();
    fireEvent.change(within(again).getByRole("textbox", { name: "Folder (absolute path)" }), { target: { value: "/home/o/tea" } });
    const withDefault = await waitFor(() => within(param(again, "coverImage")).getByRole("combobox", { name: "coverImage: an image in the folder" }) as HTMLSelectElement);
    expect(withDefault.options[0]!.textContent).toBe("none picked (use the default)");
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

  describe("fix round 1 (Task 10-B review I2, minors)", () => {
    const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
    // Fix round 2 (the controller's corrected ruling): the start names no project; the server derives it from the folder.
    it("a start from a repository project's board on a registered dir folder sends no projectId", async () => {
      const posts = serve();
      render(<FlowBoard groups={[]} scope={{ kind: "project", repoId: "orca-22222222" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
      const dialog = await openDialog();
      fireEvent.change(within(dialog).getByRole("textbox", { name: "Folder (absolute path)" }), { target: { value: "/home/o/tea" } });
      fireEvent.change(within(param(dialog, "idea")).getByRole("textbox", { name: "idea (required)" }), { target: { value: "Tea" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));
      await waitFor(() => expect(posts).toHaveLength(1));
      // mutation: send the board's repoId -> projectId "orca-22222222" (the server refuses it flow-dir-unregistered), red
      expect(posts[0]!.body.payload).toEqual({ template: "wechat-article", dir: "/home/o/tea", params: { idea: "Tea" } });
      await waitFor(() => expect(screen.getByRole("article").getAttribute("aria-label")).toContain(RUN_B));
    });

    it("shows the global presets until a folder is chosen, then the presets of the folder's dir project", async () => {
      serve(undefined, undefined, (url) => url === `/api/control/flows/settings?dir=${encodeURIComponent("/home/o/tea")}`
        ? json({ paramDefaults: { "wechat-article": { coverImage: { value: "/covers/mine.png", source: "project", lockedBy: null } } } }) : null);
      render(<FlowBoard groups={[]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
      const dialog = await openDialog();
      await waitFor(() => expect(within(param(dialog, "coverImage")).getByTestId("flow-start-default").textContent).toBe("default: /covers/default.png (global preset)"));
      fireEvent.change(within(dialog).getByRole("textbox", { name: "Folder (absolute path)" }), { target: { value: "/home/o/tea" } });
      // mutation: never read by folder -> stays "(global preset)", red
      await waitFor(() => expect(within(param(dialog, "coverImage")).getByTestId("flow-start-default").textContent).toBe("default: /covers/mine.png (project preset)"));
      expect(reads).toContain(`/api/control/flows/settings?dir=${encodeURIComponent("/home/o/tea")}`);
    });

    it("drops a presets answer for a folder the person has since changed", async () => {
      let releaseOld: () => void = () => undefined;
      const preset = (value: string) => ({ paramDefaults: { "wechat-article": { coverImage: { value, source: "project", lockedBy: null } } } });
      serve(undefined, undefined, (url) => {
        if (url === `/api/control/flows/settings?dir=${encodeURIComponent("/old")}`)
          return new Promise((resolve) => { releaseOld = () => resolve(new Response(JSON.stringify(preset("/covers/old.png")), { status: 200 })); });
        if (url === `/api/control/flows/settings?dir=${encodeURIComponent("/new")}`) return json(preset("/covers/new.png"));
        return null;
      });
      render(<FlowBoard groups={[]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
      const dialog = await openDialog();
      const folder = within(dialog).getByRole("textbox", { name: "Folder (absolute path)" });
      fireEvent.change(folder, { target: { value: "/old" } });
      await waitFor(() => expect(reads).toContain(`/api/control/flows/settings?dir=${encodeURIComponent("/old")}`));
      fireEvent.change(folder, { target: { value: "/new" } });
      const line = () => within(param(dialog, "coverImage")).getByTestId("flow-start-default").textContent;
      await waitFor(() => expect(line()).toBe("default: /covers/new.png (project preset)"));
      releaseOld();
      await new Promise((resolve) => setTimeout(resolve, 50));
      // mutation: apply every answer -> the old folder's preset replaces the new one, red
      expect(line()).toBe("default: /covers/new.png (project preset)");
    });

    it("says the default is not available when the presets cannot be read, never a source it did not read", async () => {
      serve(undefined, undefined, (url) => url.startsWith("/api/control/flows/settings") ? json({ error: { code: "panel-internal-error", message: "" } }, 500) : null);
      render(<FlowBoard groups={[]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
      const dialog = await openDialog();
      // mutation: treat a failed read as no presets -> "default: zh (template)", red
      await waitFor(() => expect(within(param(dialog, "language")).getByTestId("flow-start-default").textContent).toBe("default: not available (the presets could not be read)"));
      expect(within(param(dialog, "coverImage")).getByTestId("flow-start-default").textContent).toBe("default: not available (the presets could not be read)");
    });

    it("holds Start back for an int param that is not an integer", async () => {
      const posts = serve();
      render(<FlowBoard groups={[]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
      const dialog = await openDialog();
      // Ruling: human 「这次批准改写所有必要的判据」 (session b999cc81): the int param of the picked template (demo) holds Start back when it is not an integer
      await pickOption(within(dialog).getByRole("combobox", { name: "Built-in template" }), "demo");
      fireEvent.change(within(dialog).getByRole("textbox", { name: "Folder (absolute path)" }), { target: { value: "/home/o/tea" } });
      fireEvent.change(within(param(dialog, "count")).getByRole("spinbutton", { name: "count (required)" }), { target: { value: "3.5" } });
      // mutation: typed() takes any number -> Start enabled, red
      expect((within(dialog).getByRole("button", { name: "Start" }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));
      expect(posts).toEqual([]);
    });

    it("drops the picker's answer for a folder the person has since changed", async () => {
      let releaseOld: () => void = () => undefined;
      serve(undefined, undefined, (url) => {
        if (url.startsWith(`/api/control/flows/images?dir=${encodeURIComponent("/old")}&`))
          return new Promise((resolve) => { releaseOld = () => resolve(new Response(JSON.stringify({ schema: "orca-flow-folder-images-v1", dir: "/old", files: ["old.png"], truncated: false, limit: 200 }), { status: 200 })); });
        if (url.startsWith(`/api/control/flows/images?dir=${encodeURIComponent("/new")}&`)) return json({ schema: "orca-flow-folder-images-v1", dir: "/new", files: ["new.png"], truncated: false, limit: 200 });
        return null;
      });
      render(<FlowBoard groups={[]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
      const dialog = await openDialog();
      const folder = within(dialog).getByRole("textbox", { name: "Folder (absolute path)" });
      fireEvent.change(folder, { target: { value: "/old" } });
      await waitFor(() => expect(reads.some((r) => r.includes(encodeURIComponent("/old")))).toBe(true));
      fireEvent.change(folder, { target: { value: "/new" } });
      const picker = await waitFor(() => within(param(dialog, "coverImage")).getByRole("combobox", { name: "coverImage: an image in the folder" }) as HTMLSelectElement);
      expect([...picker.options].map((o) => o.value)).toEqual(["", "new.png"]);
      releaseOld();
      await new Promise((resolve) => setTimeout(resolve, 50));
      // mutation: apply every answer -> the old folder's list replaces the new one, red
      expect([...(within(param(dialog, "coverImage")).getByRole("combobox", { name: "coverImage: an image in the folder" }) as HTMLSelectElement).options].map((o) => o.value)).toEqual(["", "new.png"]);
    });

    it("says a folder is too large to list, not that it cannot be listed", async () => {
      serve(undefined, undefined, (url) => url.startsWith("/api/control/flows/images?")
        ? json({ error: { code: "flow-folder-too-large", message: "/home/o holds more than 20000 files", commandRevision: null, evidenceIds: [], retryable: false } }, 400) : null);
      render(<FlowBoard groups={[]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
      const dialog = await openDialog();
      fireEvent.change(within(dialog).getByRole("textbox", { name: "Folder (absolute path)" }), { target: { value: "/home/o" } });
      // mutation: show every failure as "could not be listed" -> red
      await waitFor(() => expect(param(dialog, "coverImage").textContent).toContain("This folder is too large to list its images; type the path instead."));
    });

    it("shows the start's refusal for a folder that is no registered dir project's (final review M4)", async () => {
      serve(undefined, undefined, (url) => url.startsWith("/api/control/flows/images?")
        ? json({ error: { code: "flow-dir-unregistered", message: "/home/o is not a registered dir project's folder", commandRevision: null, evidenceIds: [], retryable: false } }, 422) : null);
      render(<FlowBoard groups={[]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
      const dialog = await openDialog();
      fireEvent.change(within(dialog).getByRole("textbox", { name: "Folder (absolute path)" }), { target: { value: "/home/o" } });
      // mutation: show the refusal as "could not be listed" -> red
      await waitFor(() => expect(param(dialog, "coverImage").textContent).toContain("A flow runs only on the folder of a registered folder project"));
    });
  });
});
