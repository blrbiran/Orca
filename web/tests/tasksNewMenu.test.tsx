// @vitest-environment jsdom
/**
 * Tester #306: only the Board could start a flow, while the CLI and the skill already could. The Tasks page now has a
 * secondary "New" menu: Import a plan (the existing dialog) and Start a flow (the Board's FlowStartDialog, in a modal).
 * Tasks hides flow groups, so a started flow is opened on its own page (the caller navigates; App sends it to
 * #board/flow/<id>). The menu is secondary: one primary per view (DESIGN.md), the dialog's Start while it is open.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ControlPanel } from "../src/ControlPanel.js";
import type { ControlSummaryV1, RecoveryViewV1 } from "../src/controlTypes.js";
import { config } from "./fixtures/board.js";

const RUN = "fr-new";
const TEMPLATES = { schema: "orca-flow-templates-v1", templates: [
  { id: "demo", version: 1, title: null, excludes: [], params: [{ id: "count", type: "int", required: true }] },
] };
const summary: ControlSummaryV1 = { schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq: 0, resetRequired: false, dispatchBlocked: false, groups: [] };
const recovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [] };
let posts: string[];
beforeEach(() => {
  posts = [];
  document.cookie = "orca_csrf=t";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if ((init?.method ?? "GET") === "POST") {
      posts.push(url);
      return new Response(JSON.stringify({ schema: "orca-command-success-v1", result: { kind: "flow-started", flowRunId: RUN, groupId: "flow-parent" } }), { status: 200 });
    }
    if (url === "/api/control/flows/templates") return new Response(JSON.stringify(TEMPLATES), { status: 200 });
    if (url.startsWith("/api/control/flows/settings")) return new Response(JSON.stringify({ paramDefaults: {} }), { status: 200 });
    return new Response(JSON.stringify({ error: { code: "not-found", message: url } }), { status: 404 });
  }) as typeof fetch;
});
afterEach(cleanup);

const mount = (onFlowStarted = vi.fn()) => render(<ControlPanel config={config} summary={summary} recovery={recovery} groups={{}} selected={null}
  drafts={{}} uncertain={[]} refusal={null} refetchRequired={false} onSelect={vi.fn()} onCommand={vi.fn()} onDraft={vi.fn()} onFlowStarted={onFlowStarted} />);
const openNew = (): HTMLElement => {
  fireEvent.click(screen.getByRole("button", { name: "New" }));
  return screen.getByRole("menu");
};

describe("tester #306: Start a flow from the Tasks page", () => {
  it("offers Import a plan and Start a flow in a secondary New menu", () => {
    mount();
    // mutation: give New btn-primary -> a second primary beside an open group's Start, red
    expect(screen.getByRole("button", { name: "New" }).classList.contains("btn-primary")).toBe(false);
    // mutation: drop the Start a flow item -> red
    expect(within(openNew()).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Import a plan…", "Start a flow…"]);
  });

  it("opens the import dialog from the menu", () => {
    mount();
    fireEvent.click(within(openNew()).getByRole("menuitem", { name: "Import a plan…" }));
    expect(screen.getByRole("dialog", { name: "Import plan" })).toBeTruthy();
  });

  it("starts a flow from the menu, then hands its run id on so the flow's page opens", async () => {
    const onFlowStarted = vi.fn();
    mount(onFlowStarted);
    fireEvent.click(within(openNew()).getByRole("menuitem", { name: "Start a flow…" }));
    // mutation: drop the flow Dialog -> no start form, red
    const form = await screen.findByRole("form", { name: "Start a flow" });
    await waitFor(() => expect(within(form).getByRole("combobox", { name: "Built-in template" })).toBeTruthy());
    // While it is open its Start is the one primary on the page.
    expect([...document.querySelectorAll(".btn-primary")].map((button) => button.textContent)).toEqual(["Start"]);
    fireEvent.change(within(form).getByRole("textbox", { name: "Folder (absolute path)" }), { target: { value: "/home/o/tea" } });
    fireEvent.change(within(screen.getByTestId("flow-start-param-count")).getByRole("spinbutton"), { target: { value: "3" } });
    fireEvent.click(within(form).getByRole("button", { name: "Start" }));
    await waitFor(() => expect(posts).toEqual(["/api/control/flows"]));
    // mutation: drop props.onFlowStarted from onStarted -> the flow is started but its page never opens, red
    await waitFor(() => expect(onFlowStarted).toHaveBeenCalledWith(RUN));
    // mutation: keep the dialog open after the start -> red
    expect(screen.queryByRole("form", { name: "Start a flow" })).toBeNull();
  });
});
