// @vitest-environment jsdom
/**
 * Tester #63 (issue-20261023.md): an archived group leaves the list it was opened from, so the detail open on it closes
 * with it and the URL drops its id; archiving another group leaves the open detail, and the page, where they were.
 * Fake fetch only (Rule 17).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { requirementView } from "./fixtures/requirement.js";
import { ALPHA, groupSummary, installFakePanel, planGroupView } from "./fixtures/twoProjects.js";
import type { FakePanel } from "./fixtures/twoProjects.js";

let panel: FakePanel;
const success = (): Response => new Response(JSON.stringify({ schema: "orca-command-success-v1", commandRevision: 7 }), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => {
  panel = installFakePanel();
  const g1 = groupSummary("g1", ALPHA), g2 = groupSummary("g2", ALPHA);
  panel.summary = { ...panel.summary, groups: [g1, g2] };
  panel.groupViews = { g1: planGroupView(g1), g2: planGroupView(g2) };
  panel.onPost = async () => success();
});
afterEach(() => { cleanup(); window.sessionStorage.clear(); window.localStorage.clear(); window.location.hash = ""; vi.restoreAllMocks(); });

async function openGroup(groupId: string): Promise<HTMLElement> {
  const nav = await screen.findByRole("navigation", { name: "Control groups" });
  fireEvent.click(await within(nav).findByRole("button", { name: new RegExp(`^${groupId} · `) }));
  return screen.findByRole("region", { name: `Control group ${groupId}` });
}

describe("archiving closes the detail open on that group (tester #63)", () => {
  it("closes the open group's detail and leaves #tasks once its archive succeeded", async () => {
    render(<App />);
    const g1 = await openGroup("g1");
    expect(window.location.hash).toBe("#tasks/g1");
    fireEvent.click(within(g1).getByRole("button", { name: "Archive group" }));
    await waitFor(() => expect(panel.requests).toContain("POST /api/control/groups/g1/archive"));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Control group g1" })).toBeNull());
    expect(window.location.hash).toBe("#tasks");
  });

  it("keeps the open detail and its URL when another group is archived from the list", async () => {
    render(<App />);
    await openGroup("g1");
    const nav = screen.getByRole("navigation", { name: "Control groups" });
    const card = within(nav).getByRole("button", { name: /^g2 · / }).closest(".group-card-row") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "More actions" }));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Archive group" }));
    await waitFor(() => expect(panel.requests).toContain("POST /api/control/groups/g2/archive"));
    // The archive's answer is read before this settles: the group is re-read after the command.
    await waitFor(() => expect(panel.requests.filter((r) => r === "GET /api/control/groups/g2").length).toBeGreaterThan(1));
    expect(screen.getByRole("region", { name: "Control group g1" })).toBeTruthy();
    expect(window.location.hash).toBe("#tasks/g1");
  });

  it("closes the detail but keeps the page when the URL is elsewhere, as after moving to the Board", async () => {
    render(<App />);
    await openGroup("g1");
    fireEvent.click(screen.getByRole("link", { name: "Board" }));
    await waitFor(() => expect(window.location.hash).toBe("#board"));
    // Every section stays mounted (handoff §5.2.6), so Task control's list is still there to archive from.
    const nav = screen.getByRole("navigation", { name: "Control groups" });
    const card = within(nav).getByRole("button", { name: /^g1 · / }).closest(".group-card-row") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "More actions" }));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Archive group" }));
    await waitFor(() => expect(panel.requests).toContain("POST /api/control/groups/g1/archive"));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Control group g1" })).toBeNull());
    expect(window.location.hash).toBe("#board");
  });

  it("closes the open requirement's detail and leaves #requirements once its archive succeeded", async () => {
    const base = requirementView("awaiting-answers");
    const ra = { ...base, epoch: "epoch-a", summary: { ...base.summary, groupId: "ra", repoId: ALPHA }, requirement: { ...base.requirement, repoId: ALPHA } };
    panel.requirementViews = { ra };
    panel.summary = { ...panel.summary, groups: [ra.summary] };
    // Opened by its URL (as from the Board or Overview): the list itself selects without writing one. A route waits for
    // the overview to name its owner (routeApp.test.tsx), so the overview read answers with this requirement.
    const fake = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, request?: RequestInit): Promise<Response> => String(input) === "/api/control/overview"
      ? new Response(JSON.stringify({ schema: "orca-control-overview-v1", epoch: "epoch-a", changeSeq: 1, groups: [ra.summary], steps: [], issues: [] }), { status: 200, headers: { "content-type": "application/json" } })
      : fake(input, request)) as typeof fetch;
    window.location.hash = "#requirements/ra";
    render(<App />);
    const shown = await screen.findByRole("article", { name: "markdown-export" });
    fireEvent.click(await within(shown).findByRole("button", { name: "Archive group" }));
    await waitFor(() => expect(panel.requests).toContain("POST /api/control/groups/ra/archive"));
    await waitFor(() => expect(screen.queryByRole("article", { name: "markdown-export" })).toBeNull());
    expect(window.location.hash).toBe("#requirements");
  });

  it("closes the open requirement's detail but keeps the page when the URL is elsewhere, as after moving to the Board", async () => {
    const base = requirementView("awaiting-answers");
    const ra = { ...base, epoch: "epoch-a", summary: { ...base.summary, groupId: "ra", repoId: ALPHA }, requirement: { ...base.requirement, repoId: ALPHA } };
    panel.requirementViews = { ra };
    panel.summary = { ...panel.summary, groups: [ra.summary] };
    render(<App />);
    const list = within(await screen.findByRole("navigation", { name: "Requirement list" }));
    fireEvent.click(await list.findByRole("button", { name: /^ra · / }));
    await screen.findByRole("article", { name: "markdown-export" });
    fireEvent.click(screen.getByRole("link", { name: "Board" }));
    await waitFor(() => expect(window.location.hash).toBe("#board"));
    // Every section stays mounted (handoff §5.2.6), so the requirement list is still there to archive from.
    const card = list.getByRole("button", { name: /^ra · / }).closest(".group-card-row") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "More actions" }));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Archive group" }));
    await waitFor(() => expect(panel.requests).toContain("POST /api/control/groups/ra/archive"));
    await waitFor(() => expect(screen.queryByRole("article", { name: "markdown-export" })).toBeNull());
    expect(window.location.hash).toBe("#board");
  });
});
