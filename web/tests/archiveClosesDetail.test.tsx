// @vitest-environment jsdom
/**
 * Tester #63 (issue-20261023.md): an archived group leaves Task control's list, so the detail open on it closes with it
 * and the URL drops its id (a requirement's view keeps its Unarchive: requirementsApp.test.tsx); archiving another group leaves the open detail, and the page, where they were.
 * Fake fetch only (Rule 17).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
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
});
