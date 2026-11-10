// @vitest-environment jsdom
/**
 * Tester #229 (plan 2026-11-10 follow-up B, T1 and T10): a run blocked after landing is not a ccloop failure -- task retry
 * refuses it -- and `orca recovery retry --run <id>` resumes it in place. T1 put that command on the board card's
 * `firstFailure.next`; the card shows it as code a person can copy, and shows nothing when the failure names no command.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardView } from "../src/BoardView.js";
import type { GroupSummaryV1 } from "../src/controlTypes.js";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const g = (groupId: string, firstFailure: NonNullable<GroupSummaryV1["card"]>["firstFailure"]): GroupSummaryV1 => ({
  groupId, repoId: "r", state: "running", commandRevision: 7, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0,
  completion: { done: 0, total: 2 }, counts: { idle: 1, running: 0, waiting: 0, blocked: 1, done: 0 }, executionPending: false,
  card: { budget: { usedTokens: 1, limitTokens: null }, pendingDecisions: 0, firstFailure },
});
const NEXT = "orca recovery retry --run run-e7";

describe("the board card names the command a blocked run's failure gives (#229)", () => {
  it("shows next as copyable code, and Copy puts exactly that command on the clipboard", () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<BoardView groups={[g("blocked", { taskId: "a", cause: "artifact-id-conflict:acceptance-re:hash-row", next: NEXT })]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    const line = within(screen.getByTestId("board-card-blocked")).getByTestId("board-card-failure-next");
    expect(line.querySelector("code")!.textContent).toBe(NEXT);
    fireEvent.click(within(line).getByRole("button", { name: "Copy command" }));
    expect(writeText).toHaveBeenCalledWith(NEXT);
  });

  it("shows no command when the failure names none, nor when there is no failure", () => {
    render(<BoardView groups={[g("failed", { taskId: "a", cause: "required-check-failed" }), g("clean", null)]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    for (const id of ["board-card-failed", "board-card-clean"]) {
      const card = screen.getByTestId(id);
      expect(within(card).queryByTestId("board-card-failure-next")).toBeNull();
      expect(card.querySelector("code")).toBeNull();
      expect(card.textContent).not.toContain("orca ");
    }
  });
});
