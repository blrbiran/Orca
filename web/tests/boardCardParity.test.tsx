// @vitest-environment jsdom
/**
 * Tester #17 / #94 (keyboard half): a Board card led with `groupId · state` while a Tasks card leads with the goal, and its
 * only way to pause, resume or archive was a drag. A Board card now leads with the goal (the id and state are the small
 * line and stay its accessible name, as on Tasks), and carries the same GroupActionsMenu: Open, Archive, Copy ID, plus
 * Pause or Resume where a drag would allow it (boardDrop). Each item sends the one command the drag sends.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { BoardView } from "../src/BoardView.js";
import type { GroupSummaryV1 } from "../src/controlTypes.js";
import { config } from "./fixtures/board.js";
afterEach(cleanup);

/** The card's Radix menu opens on a click of its button (followupControls.test.tsx does the same). */
const openMenu = async (button: HTMLElement): Promise<HTMLElement> => { fireEvent.click(button); return screen.getByRole("menu"); };

const g = (over: Partial<GroupSummaryV1>): GroupSummaryV1 => ({
  groupId: "g", repoId: "r", state: "running", commandRevision: 7, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0,
  completion: { done: 0, total: 2 }, counts: { idle: 1, running: 1, waiting: 0, blocked: 0, done: 0 }, executionPending: false, goal: "Ship the export", ...over,
});
const card = (groupId = "g") => within(screen.getByTestId(`board-card-${groupId}`));

describe("a Board card leads with its goal (#17)", () => {
  // mutation: the goal is rendered after the open button again -> the button's first text is the id -> red
  it("shows the goal first and the id and state on the small line, which stays the card's name", () => {
    render(<BoardView groups={[g({})]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    const open = card().getByRole("button", { name: /^g · running/ });
    const goal = open.querySelector(".card-goal");
    expect(goal?.textContent).toBe("Ship the export");
    expect(open.textContent?.startsWith("Ship the export")).toBe(true);
  });
});

describe("a Board card's actions without a drag (#94)", () => {
  const mount = (group: GroupSummaryV1, refusals?: Parameters<typeof BoardView>[0]["groupRefusals"]) => {
    const onCommand = vi.fn(), onGroupAction = vi.fn();
    render(<BoardView groups={[group]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={onCommand} onGroupAction={onGroupAction}
      {...(refusals === undefined ? {} : { groupRefusals: refusals })} />);
    return { onCommand, onGroupAction };
  };

  // mutation: BoardCard is not wrapped in GroupActionsMenu -> no More actions button -> red
  // mutation: the pause item sends another verb or a stale revision -> red
  it("pauses a running group from its menu with the command a drag to Queued sends", async () => {
    const { onCommand } = mount(g({}));
    const menu = await openMenu(card().getByRole("button", { name: "More actions" }));
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Pause new tasks" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "pause-dispatch", groupId: "g", expectedRevision: 7, payload: {} });
  });

  // mutation: the resume item is not offered for a paused group -> red
  it("resumes a paused group from its menu, and offers no pause there", async () => {
    const { onCommand } = mount(g({ stopMode: "pause", stopState: "paused" }));
    const menu = await openMenu(card().getByRole("button", { name: "More actions" }));
    expect(within(menu).queryByRole("menuitem", { name: "Pause new tasks" })).toBeNull();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Continue execution" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "resume-dispatch", groupId: "g", expectedRevision: 7, payload: {} });
  });

  // mutation: pause is offered whatever the column -> a done group's menu pauses -> red
  it("offers neither pause nor resume where a drag allows neither (a done group)", async () => {
    mount(g({ completion: { done: 2, total: 2 }, counts: { idle: 0, running: 0, waiting: 0, blocked: 0, done: 2 } }));
    const menu = await openMenu(card().getByRole("button", { name: "More actions" }));
    expect(within(menu).queryByRole("menuitem", { name: "Pause new tasks" })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "Continue execution" })).toBeNull();
  });

  // mutation: onGroupAction is not handed to the menu -> Archive is disabled -> red
  it("archives through the same channel as a Tasks card", async () => {
    const { onGroupAction } = mount(g({ completion: { done: 2, total: 2 }, counts: { idle: 0, running: 0, waiting: 0, blocked: 0, done: 2 } }));
    const menu = await openMenu(card().getByRole("button", { name: "More actions" }));
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Archive group" }));
    await waitFor(() => expect(onGroupAction).toHaveBeenCalledWith("g", "archive-group", "r"));
  });

  // mutation: the card's refusal is not passed -> a refused menu action is silent on the Board -> red
  it("says a refused card action on the card", () => {
    mount(g({}), { g: { status: 409, code: "archive-run-active", message: "a run is active", commandRevision: 7 } });
    expect(screen.getByTestId("card-refusal-g")).toBeTruthy();
  });
});

describe("App wires the Board card's menu (#94)", () => {
  const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const done = g({ repoId: "orca", completion: { done: 2, total: 2 }, counts: { idle: 0, running: 0, waiting: 0, blocked: 0, done: 2 } });
  afterEach(() => { window.history.replaceState(null, "", window.location.pathname); window.sessionStorage.clear(); });

  // mutation: App does not pass onGroupAction to FlowBoard -> Archive is disabled on the Board -> red
  it("enables Archive on a Board card, as on a Tasks card", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url === "/api/control/config") return json(config);
      if (url.startsWith("/api/control/summary")) return json({ schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq: 4, resetRequired: false, dispatchBlocked: false, groups: [done] });
      if (url === "/api/control/recovery") return json({ schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [] });
      if (url === "/api/projects") return json({ projects: [{ projectKey: "orca", controlRepoId: "orca" }] });
      return json({ error: { code: "not-here", message: url, commandRevision: null, evidenceIds: [], retryable: false } }, 404);
    }) as typeof fetch;
    window.location.hash = "#board";
    render(<App />);
    const more = within(await screen.findByTestId("board-card-g")).getByRole("button", { name: "More actions" });
    const menu = await openMenu(more);
    expect(within(menu).getByRole("menuitem", { name: "Archive group" }).getAttribute("aria-disabled")).toBeNull();
  });
});
