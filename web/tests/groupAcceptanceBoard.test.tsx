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

  // Ruling (2026-11-18 tester batch D review 2): the summary sends a failed acceptance with the group problem it yields
  // (controlViews.ts groupProblemOf); the card names the failing command once, on that line (M-e1). The acceptance note
  // stays for a summary with no group problem.
  it("the Board card names the failing command; a passed one says nothing", () => {
    render(<BoardView groups={[g(FAILED)]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.getByTestId("board-card-acceptance").textContent).toBe("Group acceptance failed: npm test");
    cleanup();
    const problem = { code: FAILED.problem!, why: "group-acceptance-failed", next: ["orca group recheck g", "orca group waive-acceptance g --note '<why>'"] };
    render(<BoardView groups={[{ ...g(FAILED), groupProblem: problem }]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.queryByTestId("board-card-acceptance")).toBeNull();
    expect(screen.getByTestId("board-card-group-problem").textContent).toContain("group-acceptance-failed:npm test");
    cleanup();
    render(<BoardView groups={[g({ ...FAILED, result: "passed", problem: undefined })]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.queryByTestId("board-card-acceptance")).toBeNull();
  });
  it("the Board shows comparison reasons, retry branches, and unavailable suite counts", () => {
    const acceptance: GroupAcceptanceV1 = { ...FAILED,
      identityComparisons: [{ command: "npm test || npm test", base: "b".repeat(40), setupDigest: "s".repeat(64), reporter: "node-test-tap-v1", baselineSource: "unavailable",
        tipAttempts: [
          { exit: "1", failureIdentityStatus: "ambiguous", reportedFailures: 1, blockCount: 1, tests: 79, tail: "malformed" },
          { exit: "0", reportedFailures: 0, blockCount: 1, tests: 79, tail: "green" },
        ], baseIdentities: [], tipIdentities: [], reason: "non-comparable" }],
      evidence: { cwd: null, head: "c".repeat(40), trackedFiles: 4, testFiles: 2, tests: 79, suiteTests: [79, 79], baselineTests: null,
        baselineCount: { state: "unavailable", tests: null, source: "base-suite" } },
    };
    const problem = { code: acceptance.problem!, why: "group-acceptance-failed", next: ["orca group recheck g"] };
    render(<BoardView groups={[{ ...g(acceptance), groupProblem: problem }]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    const details = screen.getAllByTestId("board-card-acceptance-diagnostics")[0]!.textContent ?? "";
    expect(details).toContain("The red output from npm test || npm test could not be compared with the base.");
    expect(details).toContain("npm test || npm test invocation exits: 1, 0");
    expect(details).toContain("Full-suite test count comparison is unavailable at the base.");
    expect(screen.getByTestId("board-card-group-problem").textContent).not.toContain("waive-acceptance");
  });
});
