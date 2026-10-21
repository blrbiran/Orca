// @vitest-environment jsdom
/**
 * Kanban spec 2026-10-20 §4 (session 9ec98639): the board tab. Columns come from the summary only; a drag sends exactly
 * one existing command or is refused on the page; the group graph adds and removes a person's edges.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardView } from "../src/BoardView.js";
import type { ControlAction } from "../src/controlApi.js";
import type { GroupSummaryV1 } from "../src/controlTypes.js";
import { boardColumn, boardDrop } from "../src/groupCategory.js";

afterEach(cleanup);

const g = (over: Partial<GroupSummaryV1>): GroupSummaryV1 => ({
  groupId: "g", repoId: "r", state: "ready", commandRevision: 7, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0,
  completion: { done: 0, total: 2 }, counts: { idle: 2, running: 0, waiting: 0, blocked: 0, done: 0 }, executionPending: false, ...over,
});
const queued = { mode: "run" as const, state: "queued" as const, waitingFor: [], refusal: null };

describe("board columns (kanban spec §4)", () => {
  it("puts each group in exactly the column its summary says", () => {
    const cases: Array<[Partial<GroupSummaryV1>, string]> = [
      [{ state: "clarifying" }, "clarifying"],
      [{ state: "draft" }, "awaiting-confirmation"],
      [{ orchestration: queued }, "queued"],
      [{ orchestration: { ...queued, mode: "hold", state: "held" } }, "queued"],
      [{ orchestration: { ...queued, state: "waiting-slot" } }, "queued"],
      // mutation: drop the orchestration branch -> a started group whose tasks are all idle reads queued, red
      [{ orchestration: { ...queued, state: "started" } }, "running"],
      [{ executionPending: true, orchestration: { ...queued, state: "started" } }, "running"],
      [{ state: "running" }, "running"],
      [{ counts: { idle: 1, running: 0, waiting: 0, blocked: 1, done: 0 } }, "needs-you"],
      [{ stopMode: "pause", stopState: "paused" }, "needs-you"],
      [{ completion: { done: 2, total: 2 } }, "done"],
      [{ completion: { done: 2, total: 2 }, archived: true }, "archived"],
      // A ready group confirmed before start-on-confirm: queued until anything ran.
      [{}, "queued"],
      [{ counts: { idle: 1, running: 0, waiting: 0, blocked: 0, done: 1 } }, "running"],
    ];
    expect(cases.map(([over]) => boardColumn(g(over)))).toEqual(cases.map(([, column]) => column));
  });

  it("allows only pause, resume, archive and unarchive by drag", () => {
    const running = g({ state: "running" }), paused = g({ stopMode: "pause", stopState: "paused" }), done = g({ completion: { done: 2, total: 2 } });
    expect(boardDrop(running, "queued")).toEqual({ verb: "pause-dispatch" });
    expect(boardDrop(paused, "running")).toEqual({ verb: "resume-dispatch" });
    expect(boardDrop(done, "archived")).toEqual({ verb: "archive-group" });
    expect(boardDrop({ ...done, archived: true }, "done")).toEqual({ verb: "unarchive-group" });
    // mutation: allow any drop on running -> a draft is "started" by drag, red
    expect(boardDrop(g({ state: "draft" }), "running")).toEqual({ refused: "not-allowed" });
    expect(boardDrop(running, "done")).toEqual({ refused: "not-allowed" });
    expect(boardDrop(running, "running")).toEqual({ refused: "same" });
  });
});

const dataTransfer = () => { const store = new Map<string, string>(); return { setData: (k: string, v: string) => store.set(k, v), getData: (k: string) => store.get(k) ?? "" }; };

describe("the board tab (kanban spec §4)", () => {
  it("shows cards in columns with their facts, and a drop sends the one command or is refused on the page", () => {
    const onCommand = vi.fn<(action: ControlAction) => void>();
    const groups = [
      g({ groupId: "run1", state: "running", goal: "Do X", card: { budget: { usedTokens: 1200, limitTokens: 5000 }, pendingDecisions: 2, firstFailure: { taskId: "a", cause: "required-check-failed" } } }),
      g({ groupId: "wait", orchestration: { ...queued, state: "waiting-prerequisite", waitingFor: ["run1"] } }),
      g({ groupId: "draft1", state: "draft" }),
    ];
    render(<BoardView groups={groups} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={onCommand} />);
    const running = screen.getByRole("region", { name: "Running" });
    const card = within(running).getByTestId("board-card-run1");
    expect(card.textContent).toContain("Do X");
    // Failure-cause spec 2026-10-21 §5: a cause ccloop typed is worded (was the raw code; Ruling in the commit body).
    // Issue #84: the budget's figures short (was "1200 of 5000 tokens"), the exact ones in the title.
    expect(card.textContent).toContain("1.2K of 5K tokens · 2 decisions to review · a failed: a required check failed");
    expect(within(card).getByTitle("1,200 / 5,000")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Queued" })).getByTestId("board-card-wait").textContent).toContain("waiting for run1");
    const transfer = dataTransfer();
    fireEvent.dragStart(card, { dataTransfer: transfer });
    fireEvent.drop(screen.getByRole("region", { name: "Queued" }), { dataTransfer: transfer });
    expect(onCommand.mock.calls).toEqual([[{ verb: "pause-dispatch", groupId: "run1", expectedRevision: 7, payload: {} }]]);
    const draftTransfer = dataTransfer();
    fireEvent.dragStart(screen.getByTestId("board-card-draft1"), { dataTransfer: draftTransfer });
    fireEvent.drop(screen.getByRole("region", { name: "Running" }), { dataTransfer: draftTransfer });
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("board-refusal").textContent).toContain("draft1 cannot be moved to Running");
  });

  it("keeps a failure the panel cannot word (an Orca reason, or a cause it does not know) as written", () => {
    const card = (cause: string) => g({ groupId: `g-${cause}`, state: "running", card: { budget: { usedTokens: 0, limitTokens: null }, pendingDecisions: 0, firstFailure: { taskId: "a", cause } } });
    render(<BoardView groups={[card("terminal:failed"), card("a-newer-cause")]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.getByTestId("board-card-g-terminal:failed").textContent).toContain("a failed: terminal:failed");
    expect(screen.getByTestId("board-card-g-a-newer-cause").textContent).toContain("a failed: a-newer-cause");
  });

  it("hides the archived column until asked, and the group graph adds and removes a person's edge", () => {
    const onCommand = vi.fn<(action: ControlAction) => void>();
    render(<BoardView groups={[g({ groupId: "a", dependsOn: ["b"] }), g({ groupId: "b", commandRevision: 3 })]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={onCommand} />);
    expect(screen.queryByRole("region", { name: "Archived" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show archived" }));
    expect(screen.getByRole("region", { name: "Archived" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Group graph" }));
    expect(screen.getByRole("list", { name: "Dependencies" }).textContent).toContain("a waits for b");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Group" }), { target: { value: "b" } });
    fireEvent.change(screen.getByRole("combobox", { name: "waits for" }), { target: { value: "a" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onCommand.mock.calls).toEqual([
      [{ verb: "remove-group-dependency", groupId: "a", expectedRevision: 7, payload: { dependsOn: "b" } }],
      [{ verb: "add-group-dependency", groupId: "b", expectedRevision: 3, payload: { dependsOn: "a" } }],
    ]);
  });
});
