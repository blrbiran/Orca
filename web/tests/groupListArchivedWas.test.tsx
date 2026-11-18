// @vitest-environment jsdom
// Tester #370 (plan 2026-11-18 tester batch D, V3): an archived group's card said `running` -- its stored state, frozen by
// the archive -- next to the Archived chip. It now reads `archived (was running)`; a live group's card is unchanged.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../src/i18n.js";
import { BoardView } from "../src/BoardView.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { GroupList } from "../src/GroupList.js";
import { config, view } from "./fixtures/board.js";
import type { GroupSummaryV1 } from "../src/controlTypes.js";

const zero = { idle: 0, running: 0, waiting: 0, blocked: 0, done: 0 };
const g = (groupId: string, over: Partial<GroupSummaryV1> = {}): GroupSummaryV1 => ({
  groupId, repoId: "orca", state: "running", commandRevision: 1, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false,
  recoveryBlockerCount: 0, completion: { done: 0, total: 1 }, counts: { ...zero, idle: 1 }, archived: false, ...over,
});
const nav = () => screen.getByRole("navigation", { name: "Control groups" });
// Ruling (2026-11-19 #355/#357): 「这次批准改写所有必要的判据」 -- every chip names its count now (tester #357), so the
// Archived chip is found by its word and a count, and the board's box by its new label (closed groups too).

afterEach(() => { cleanup(); try { window.localStorage.clear(); } catch { /* none */ } });

describe("an archived group's card (#370)", () => {
  it("reads archived (was <state>); a live one keeps its state word", () => {
    render(<GroupList groups={[g("live"), g("old", { archived: true })]} selected={null} onSelect={vi.fn()} now={0} />);
    const name = () => nav().querySelector(".group-card-name")!.textContent ?? "";
    expect(name()).toContain("live · running");
    fireEvent.click(within(screen.getByRole("group", { name: "Show groups" })).getByRole("button", { name: /^Archived \(\d+\)$/ }));
    // mutation: show enumText(state) for an archived group again -> "old · running", red
    expect(name()).toContain("old · archived (was running)");
  });

  // #361 review (I4/M4): a summary that derived `running` beside a stored `ready` (as the panel did for an archived group
  // with a queued start before I4) reads the stored word.
  it("reads the stored state, never the derived running, in the card and the board", () => {
    render(<GroupList groups={[g("old", { archived: true, state: "running", storedState: "ready" })]} selected={null} onSelect={vi.fn()} now={0} />);
    fireEvent.click(within(screen.getByRole("group", { name: "Show groups" })).getByRole("button", { name: /^Archived \(\d+\)$/ }));
    // mutation: archivedWas from `state` instead of `storedState ?? state` -> "archived (was running)", red here
    expect(nav().querySelector(".group-card-name")!.textContent).toContain("old · archived (was ready)");
    cleanup();
    render(<BoardView groups={[g("old", { archived: true, state: "running", storedState: "ready" })]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Show closed and archived" }));
    expect(screen.getByTestId("board-card-old").textContent).toContain("old · archived (was ready)");
    cleanup();
    // #370 review M4: the group page's heading too.
    const archived = view([]);
    render(<ControlGroupView view={{ ...archived, summary: { ...archived.summary, archived: true, state: "running", storedState: "ready" } }} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    // mutation: the heading keeps enumText(view.summary.state) -> "g · running", red here
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("g · archived (was ready)");
  });
});
