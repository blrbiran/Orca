// @vitest-environment jsdom
/**
 * Tester #173 / #224 / #266 (follow-up L; human, round K: "at confirm, use the median actual spend of this repo's past
 * tasks as a reference, computed by code, and show the estimate/history ratio"): the budget editor, where the estimate is
 * read before confirm, shows the group view's `estimateHistory` as a note -- the same numbers the CLI prints.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BudgetEditor } from "../src/BudgetEditor.js";
import i18n from "../src/i18n.js";
import type { Amount, ControlConfigV1, EstimateHistoryV1, GroupViewV1 } from "../src/controlTypes.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 2, sessions: 1 });
const human = { provenance: "human", estimateId: null } as const;
const provenance = { tokens: human, activeMs: human, attempts: human, sessions: human };
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "realtime", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{ profileId: "est", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-10-01T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "est", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
const PLAN = "a".repeat(64);
const view = (estimateHistory?: EstimateHistoryV1): GroupViewV1 => ({
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 1,
  summary: { groupId: "g", repoId: "orca", state: "draft", commandRevision: 3, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1,
  plan: { repoId: "orca", planId: "plan-demo", planHash: PLAN, goal: "Ship", successConditions: ["passes"] },
  proposal: { state: "editable", proposalVersion: 2, planHash: PLAN, budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
  ledger: { groupLimit: amount(90_000), used: amount(0), committedRemaining: amount(4_300), explicitUnallocatedReserve: amount(6_000), budgetDeficit: amount(0), usageUnknown: false, unmeteredRuns: 0 },
  allocations: [{ ownerKind: "task", ownerId: "c", bucket: "work", state: "draft-encumbered", amount: amount(3_000), fieldProvenance: provenance }],
  workItems: [{ taskId: "c", status: "draft", dependencyTaskIds: [], targetVersion: 1, configHash: null, originalContractHash: "e".repeat(64), derivedContractHash: null, currentRunId: null, pendingRunId: null, lineageRunIds: [], loopPlan: null }],
  estimates: [], runs: [], checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
  ...(estimateHistory === undefined ? {} : { estimateHistory }),
});
const HISTORY: EstimateHistoryV1 = { medianTokens: 2_100_000, sampleCount: 14, minimumSample: 3, tasks: [
  { taskId: "c", estimateTokens: 28_000, ratio: 0.013 }, { taskId: "d", estimateTokens: null, ratio: null },
] };
const show = (history?: EstimateHistoryV1) => render(<BudgetEditor view={view(history)} config={config} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);

afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

describe("this repository's history in the budget editor (#173/#224/#266)", () => {
  it("names the median and each task's estimate as a multiple of it, as a neutral note", () => {
    show(HISTORY);
    const note = screen.getByTestId("budget-history");
    // mutation L-web-note: the note not rendered -> getByTestId throws, red
    expect(note.getAttribute("role")).toBe("note");
    expect(note.hasAttribute("data-tone")).toBe(false);
    expect(note.textContent).toBe("Finished tasks of other groups in this repository used a median of 2.1M tokens each (n=14, every run of a task)."
      + "Task c: estimate 28K tokens, 0.013× that median.Task d: not estimated.");
  });

  it("says when there are too few finished tasks, with no number", () => {
    show({ medianTokens: null, sampleCount: 2, minimumSample: 3, tasks: [{ taskId: "c", estimateTokens: 28_000, ratio: null }] });
    // mutation L-web-toofew: the median sentence for a null median -> red
    expect(screen.getByTestId("budget-history").textContent).toBe("Too few finished tasks in this repository to compare the estimates with (2; at least 3 needed).");
  });

  it("speaks Chinese too", async () => {
    await i18n.changeLanguage("zh");
    show(HISTORY);
    expect(screen.getByTestId("budget-history").textContent).toContain("中位数");
  });

  it("shows nothing when the view has none (a confirmed proposal, an older panel)", () => {
    show();
    expect(screen.queryByTestId("budget-history")).toBeNull();
  });
});
