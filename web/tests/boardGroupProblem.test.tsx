// @vitest-environment jsdom
/**
 * Tester #359 review (I3): the summary's `groupProblem` -- a failed group or delivered acceptance, or a requirement review
 * that did not pass, on a group whose tasks are all done -- reached the CLI and `orca status` but not the Board card, whose
 * firstFailure is the tasks' own and empty. The card now names the problem's code and the first command that answers it,
 * copyable like firstFailure's.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n.js";
import { BoardView } from "../src/BoardView.js";
import type { GroupAcceptanceV1, GroupSummaryV1 } from "../src/controlTypes.js";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const NEXT = "orca group recheck g-acc";
// As readGroupSummaryFromSnapshot sends it for every task done and the acceptance failed (groupProblemVisible.test.ts):
// the failed `acceptance` record (its `problem` the group problem's code) beside the `groupProblem` it yields.
// Ruling (2026-11-18 tester batch D review 2): the fixture carried `groupProblem` without the `acceptance` it comes from
// (a shape the summary never sends), which hid the card naming the failure twice (M-e1); it now carries both.
const FAILED: GroupAcceptanceV1 = { tip: "c".repeat(40), result: "failed", commands: [{ command: "npm test", exit: "1", ms: 5 }], at: 1, problem: "group-acceptance-failed:npm test" };
const g = (groupId: string, groupProblem?: GroupSummaryV1["groupProblem"]): GroupSummaryV1 => ({
  groupId, repoId: "r", state: "review", commandRevision: 7, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0,
  completion: { done: 2, total: 2 }, counts: { idle: 0, running: 0, waiting: 0, blocked: 0, done: 2 }, executionPending: false,
  card: { budget: { usedTokens: 1, limitTokens: null, reservedTokens: 0, headroomTokens: null }, pendingDecisions: 0, firstFailure: null },
  ...(groupProblem === undefined ? {} : { acceptance: FAILED, groupProblem }),
});
const PROBLEM = { code: "group-acceptance-failed:npm test", why: "group-acceptance-failed", next: [NEXT, "orca group waive-acceptance g-acc --note '<why>'"] };

describe("the board card names the group's own problem (#359 review)", () => {
  it("shows the code and the first answer as copyable code; Copy puts exactly that command on the clipboard", () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<BoardView groups={[g("g-acc", PROBLEM)]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    // mutation: drop the groupProblem line from the card -> red here
    const line = within(screen.getByTestId("board-card-g-acc")).getByTestId("board-card-group-problem");
    expect(line.textContent).toContain("Group problem: group-acceptance-failed:npm test. To answer it:");
    expect(line.querySelector("code")!.textContent).toBe(NEXT);
    fireEvent.click(within(line).getByRole("button", { name: "Copy command" }));
    expect(writeText).toHaveBeenCalledWith(NEXT);
  });

  it("names a failed acceptance once: the group problem line, not also the acceptance note (#370 review 2, M-e1)", () => {
    render(<BoardView groups={[g("g-acc", PROBLEM)]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    const card = screen.getByTestId("board-card-g-acc");
    // mutation: drop the groupProblem.why guard on the acceptance note -> the note shows too, red here
    expect(within(card).queryByTestId("board-card-acceptance")).toBeNull();
    expect(card.textContent!.match(/npm test/g)).toHaveLength(1);
  });

  it("shows nothing when the group has no problem", () => {
    render(<BoardView groups={[g("clean")]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    expect(within(screen.getByTestId("board-card-clean")).queryByTestId("board-card-group-problem")).toBeNull();
  });

  it("renders in Chinese", async () => {
    await i18n.changeLanguage("zh");
    try {
      render(<BoardView groups={[g("g-acc", PROBLEM)]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
      expect(screen.getByTestId("board-card-group-problem").textContent).toContain("组的问题：group-acceptance-failed:npm test。处理它：");
    } finally { await i18n.changeLanguage("en"); }
  });
});
