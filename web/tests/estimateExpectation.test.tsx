// @vitest-environment jsdom
/**
 * Budget defaults spec 2026-11-11 §7 items 1 and 4 (tester #224/#234/#238/#241/#162), the Web half: in a group with no
 * token limit the budget editor offers no estimate's task-work tokens as a ceiling and names the expectation instead; the
 * board card shows expected against used ("×3.2", or "unknown"). A finite group's editor still offers the ceiling.
 * Fixture as budgetTopUps.test.tsx's.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardView } from "../src/BoardView.js";
import { BudgetEditor } from "../src/BudgetEditor.js";
import { expectedText } from "../src/TaskDetail.js";
import type { Amount, BudgetAmount, CapabilityViewV1, ControlConfigV1, GroupSummaryV1, GroupViewV1 } from "../src/controlTypes.js";

afterEach(cleanup);
const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const budget = (tokens: number | null): BudgetAmount => ({ tokens, activeMs: 100_000, attempts: 1, sessions: 1 });
const human = { provenance: "human", estimateId: null } as const;
const provenance = { tokens: human, activeMs: human, attempts: human, sessions: human };
const PLAN = "a".repeat(64);
const DURABLE: CapabilityViewV1 = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "realtime", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null };
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: DURABLE, observed: DURABLE, observedAt: "2026-09-29T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
const WORK = { tokens: 1_500_000, activeMs: 7_000_000, attempts: 2, sessions: 1 };
const estimate = { estimateId: "est-1", estimateVersion: 1, state: "ready", profile: null, mode: "soft", requestHash: null, outputHash: "c".repeat(64), reasonCode: null, stale: false,
  output: { schema: "budget-estimate-v1", planHash: PLAN, groupRationale: "r", goalReviewReserve: amount(1),
    tasks: [{ taskId: "a", complexity: "M", confidence: "high", work: WORK, handoff: amount(300), rationale: "r", assumptions: [] }] } };

function view(groupTokens: number | null): GroupViewV1 {
  return {
    schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 1,
    summary: { groupId: "g", repoId: "orca", state: "draft", commandRevision: 3, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
    graphVersion: 1,
    plan: { repoId: "orca", planId: "plan-demo", planHash: PLAN, goal: "Ship", successConditions: ["passes"] },
    proposal: { state: "editable", proposalVersion: 2, planHash: PLAN, budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
    ledger: { groupLimit: budget(groupTokens), used: amount(0), committedRemaining: amount(3_300), explicitUnallocatedReserve: budget(groupTokens === null ? null : 6_000), budgetDeficit: amount(0), usageUnknown: false, unmeteredRuns: 0 },
    allocations: [
      { ownerKind: "task", ownerId: "a", bucket: "work", state: "draft-encumbered", amount: budget(groupTokens === null ? null : 3_000), fieldProvenance: provenance },
      { ownerKind: "task", ownerId: "a", bucket: "handoff", state: "draft-encumbered", amount: amount(300), fieldProvenance: provenance },
    ],
    workItems: [{ taskId: "a", status: "draft", dependencyTaskIds: [], targetVersion: 1, configHash: null, originalContractHash: "e".repeat(64), derivedContractHash: null, currentRunId: null, pendingRunId: null, lineageRunIds: [],
      // What the server derives in a group with no token limit (controlViews.ts deriveExpectations); absent in a finite one.
      ...(groupTokens === null ? { expected: { tokens: WORK.tokens, estimateId: "est-1", stale: false, usedTokens: 0 } } : {}) }],
    estimates: [estimate as never], runs: [], checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
  };
}
const useWorkTokens = () => screen.queryAllByRole("button").filter((button) => (button.getAttribute("aria-label") ?? "").startsWith(`use ${WORK.tokens} for a `));

describe("the budget editor in a group with no token limit (§7 items 1, 4)", () => {
  it("offers no estimate's task-work tokens as a ceiling and names the expectation", () => {
    render(<BudgetEditor view={view(null)} config={config} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    // mutation: drop the transform's null-limit guard -> "use 1500000 for a ..." is offered, red
    expect(useWorkTokens()).toEqual([]);
    // mutation: drop expectedCell -> no expected line, red
    expect(screen.getByTestId("budget-expected-a").textContent).toBe("expected 1.5M (not a limit: the group has no token limit)");
  });

  it("a finite group still offers the estimate's tokens as the ceiling, with no expected line", () => {
    render(<BudgetEditor view={view(90_000)} config={config} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(useWorkTokens().length).toBeGreaterThan(0);
    expect(screen.queryByTestId("budget-expected-a")).toBeNull();
  });
});

describe("the board card shows expected against used (§7 item 4)", () => {
  const g = (groupId: string, expectation?: { expectedTokens: number; usedTokens: number | null }): GroupSummaryV1 => ({
    groupId, repoId: "r", state: "running", commandRevision: 7, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0,
    completion: { done: 0, total: 1 }, counts: { idle: 0, running: 1, waiting: 0, blocked: 0, done: 0 }, executionPending: false,
    card: { budget: { usedTokens: 1, limitTokens: null }, pendingDecisions: 0, firstFailure: null, ...(expectation === undefined ? {} : { expectation }) },
  });
  it("×3.2 when the group used 3.2 times its expectation, unknown when its usage is unknown, nothing without one", () => {
    render(<BoardView groups={[g("over", { expectedTokens: 1_500_000, usedTokens: 4_800_000 }), g("lost", { expectedTokens: 1_500_000, usedTokens: null }), g("plain")]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    // mutation: drop the card's expectation line -> red
    expect(within(screen.getByTestId("board-card-over")).getByTestId("board-card-expectation").textContent).toBe("expected 1.5M tokens · used 4.8M (×3.2)");
    expect(within(screen.getByTestId("board-card-lost")).getByTestId("board-card-expectation").textContent).toBe("expected 1.5M tokens · used unknown");
    expect(within(screen.getByTestId("board-card-plain")).queryByTestId("board-card-expectation")).toBeNull();
  });

  it("the task row's text: just the expectation before any use, stale marked", () => {
    expect(expectedText({ tokens: 1_500_000, usedTokens: 0 })).toBe("expected 1.5M tokens");
    expect(expectedText({ tokens: 1_500_000, usedTokens: 0, stale: true })).toBe("expected 1.5M tokens (estimate stale)");
  });
});
