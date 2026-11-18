// @vitest-environment jsdom
/**
 * #355 review (minor 8): the card actions read the terminal mark's kind -- App's sendGroupCardAction decides from the
 * group's fresh view whether a verb has anything to do (archive and close each convert the other kind, human ruling
 * 「同意允许互转」), and a card's menu offers the conversion with the undo of its own kind. Fake fetch only (Rule 17).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { GroupActionsMenu } from "../src/GroupActionsMenu.js";
import type { GroupSummaryV1 } from "../src/controlTypes.js";
import { ALPHA, groupSummary, installFakePanel, planGroupView } from "./fixtures/twoProjects.js";
import type { FakePanel } from "./fixtures/twoProjects.js";

let panel: FakePanel;
const done = { state: "done" as const, completion: { done: 1, total: 1 } };
const answer = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  panel = installFakePanel();
  // c1 closed, x1 archived (both done); d1 done with no mark in the list, but archived by the time it is read again.
  const c1 = groupSummary("c1", ALPHA, { ...done, archived: true, archiveKind: "closed" });
  const x1 = groupSummary("x1", ALPHA, { ...done, archived: true, archiveKind: "archived" });
  const d1 = groupSummary("d1", ALPHA, done);
  panel.summary = { ...panel.summary, groups: [c1, x1, d1] };
  panel.groupViews = { c1: planGroupView(c1), x1: planGroupView(x1), d1: planGroupView({ ...d1, archived: true, archiveKind: "archived" }) };
  panel.onPost = async () => answer(200, { schema: "orca-command-success-v1", commandRevision: 7 });
});
afterEach(() => { cleanup(); window.sessionStorage.clear(); window.localStorage.clear(); window.location.hash = ""; vi.restoreAllMocks(); });

const nav = () => screen.getByRole("navigation", { name: "Control groups" });
const chip = (name: string) => within(screen.getByRole("group", { name: "Show groups" })).getByRole("button", { name: new RegExp(`^${name} \\(\\d+\\)$`) });
const toolbar = () => screen.getByRole("group", { name: "Selected groups" });

async function bulk(chipName: string, groupId: string, verb: "Archive" | "Close"): Promise<string> {
  window.location.hash = "#tasks";
  render(<App />);
  await within(await screen.findByRole("navigation", { name: "Control groups" })).findAllByRole("button");
  fireEvent.click(chip(chipName));
  fireEvent.click(await within(nav()).findByRole("checkbox", { name: `Select ${groupId}` }));
  fireEvent.click(within(toolbar()).getByRole("button", { name: verb }));
  await waitFor(() => expect(screen.getByTestId(`bulk-outcome-${groupId}`)).toBeTruthy());
  return screen.getByTestId(`bulk-outcome-${groupId}`).textContent ?? "";
}

describe("App's card action reads the mark's kind (#355 review, minor 8)", () => {
  it("archives a closed group (the conversion is sent, not skipped)", async () => {
    // mutation: `already` for archive-group is `archived === true` (either kind) -> skipped, nothing sent, red here
    expect(await bulk("Closed", "c1", "Archive")).toBe("c1: archived");
    expect(panel.requests).toContain("POST /api/control/groups/c1/archive");
  });

  it("closes an archived done group (the conversion is sent, not skipped)", async () => {
    // mutation: `already` for close-group is `archived === true` -> skipped, red here
    expect(await bulk("Archived", "x1", "Close")).toBe("x1: closed");
    expect(panel.requests).toContain("POST /api/control/groups/x1/close");
  });

  it("sends nothing for a group whose fresh view is already archived", async () => {
    // mutation: `already` for archive-group is `kind === "closed"` -> the archive is sent again, red here
    expect(await bulk("Done", "d1", "Archive")).toBe("d1: already archived or changed; nothing sent");
    expect(panel.requests).not.toContain("POST /api/control/groups/d1/archive");
  });

  it("says a command the panel did not answer is unknown, not refused", async () => {
    panel.onPost = async () => answer(503, { error: { code: "unavailable", message: "unavailable" } });
    // mutation: sendGroupCardAction maps every null to refused -> "c1: not archived", red here
    expect(await bulk("Closed", "c1", "Archive")).toBe("c1: no answer -- it may or may not be archived; check the group");
  });
});

describe("a card's menu offers the other kind as a conversion (#355 review, minor 8)", () => {
  const items = (group: GroupSummaryV1) => {
    const onAction = vi.fn();
    render(<GroupActionsMenu group={group} onOpen={vi.fn()} onAction={onAction}>{(onContextMenu) => <button type="button" onContextMenu={onContextMenu}>{group.groupId}</button>}</GroupActionsMenu>);
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const menu = within(screen.getByRole("menu"));
    return { onAction, labels: menu.getAllByRole("menuitem").map((item) => item.textContent), click: (name: string) => fireEvent.click(menu.getByRole("menuitem", { name })) };
  };

  it("a closed group: Archive group (converts) and Unclose", () => {
    const { onAction, labels, click } = items(groupSummary("c1", ALPHA, { ...done, archived: true, archiveKind: "closed" }));
    // mutation: the archive item reads `archived` alone -> Unarchive on a closed card, red here
    expect(labels).toEqual(expect.arrayContaining(["Archive group", "Unclose"]));
    expect(labels).not.toContain("Unarchive");
    click("Archive group");
    expect(onAction).toHaveBeenCalledWith("c1", "archive-group", ALPHA);
  });

  it("an archived done group: Unarchive and Close group (converts); an archived group not done offers no close", () => {
    const { onAction, labels, click } = items(groupSummary("x1", ALPHA, { ...done, archived: true, archiveKind: "archived" }));
    // mutation: closeVerb only for a group with no mark -> no Close group on an archived done card, red here
    expect(labels).toEqual(expect.arrayContaining(["Unarchive", "Close group"]));
    click("Close group");
    expect(onAction).toHaveBeenCalledWith("x1", "close-group", ALPHA);
    cleanup();
    expect(items(groupSummary("x2", ALPHA, { state: "ready", archived: true, archiveKind: "archived" })).labels).not.toContain("Close group");
  });
});
