// @vitest-environment jsdom
/**
 * Tester follow-up E §5 (#241): a group whose final tree failed its acceptance is not done though every task is, so the
 * group list and the Board say it needs you, and its card names the failing command.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardView } from "../src/BoardView.js";
import type { GroupAcceptanceV1, GroupSummaryV1 } from "../src/controlTypes.js";
import { boardColumn, groupCategory, needsAttention } from "../src/groupCategory.js";

afterEach(cleanup);

const FAILED: GroupAcceptanceV1 = { tip: "c".repeat(40), result: "failed", commands: [{ command: "npm test", exit: "1", ms: 5 }], at: 1, problem: "group-acceptance-failed:npm test" };
const g = (acceptance?: GroupAcceptanceV1): GroupSummaryV1 => ({
  groupId: "g", repoId: "r", state: "review", commandRevision: 7, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0,
  completion: { done: 2, total: 2 }, counts: { idle: 0, running: 0, waiting: 0, blocked: 0, done: 2 }, executionPending: false,
  ...(acceptance === undefined ? {} : { acceptance }),
});

describe("a failed group acceptance needs you (tester follow-up E §5)", () => {
  it("every task done but the acceptance failed: attention, the needs-you column; passed or waived: done", () => {
    expect(needsAttention(g(FAILED))).toBe(true);
    expect(groupCategory(g(FAILED))).toBe("attention");
    expect(boardColumn(g(FAILED))).toBe("needs-you");
    for (const result of ["passed", "waived", "not-needed"] as const) {
      expect(needsAttention(g({ ...FAILED, result, problem: undefined })), result).toBe(false);
      expect(boardColumn(g({ ...FAILED, result, problem: undefined })), result).toBe("done");
    }
  });

  it("the Board card names the failing command; a passed one says nothing", () => {
    render(<BoardView groups={[g(FAILED)]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.getByTestId("board-card-acceptance").textContent).toBe("Group acceptance failed: npm test");
    cleanup();
    render(<BoardView groups={[g({ ...FAILED, result: "passed", problem: undefined })]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.queryByTestId("board-card-acceptance")).toBeNull();
  });
});
