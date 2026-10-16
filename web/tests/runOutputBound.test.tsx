// @vitest-environment jsdom
/**
 * Spec 2026-10-15 §6.2, criterion 5 (R2): an agent that cannot cap a call's output may go over the bound it was sent; the
 * result is used as normal and the call row says by how much. The sentence is kind-neutral (plan issue 11) and never calls
 * the call bounded or capped (the wording rule). Controller ruling (Task 12): it shows wherever single-call runs are
 * listed -- the runs table too, so a call that COMPLETED over its bound (never a problem run) still shows the line.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { RunOutputBound } from "../src/RunOutputBound.js";
import type { Amount, ControlConfigV1, GroupViewV1, RunViewV1 } from "../src/controlTypes.js";

const EN = "This agent cannot cap a call's output; this call went 100 tokens over its declared bound.";
const ZH = "该 agent 无法限制单次调用的输出；这次调用比声明的上限多用了 100 个 token。";
const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-10-16T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
// A completed estimate call: settled, no failure, no block -- so it is not in the problem-runs list.
const run = (over: Partial<RunViewV1>): RunViewV1 => ({
  runId: "run-e", taskId: null, estimateId: "e1", generation: 1, state: "settled-restartable", phase: "estimate", claimOrdinal: null, providerAttemptOrdinal: 1,
  profile: { profileId: "all", profileHash: "b".repeat(64) }, used: amount(64_200), remaining: amount(0), failureCode: null, blockedReason: null, evidenceIds: [],
  outputBound: 64000, outputBoundExceededBy: 100, ...over,
});
const view = (runs: RunViewV1[]): GroupViewV1 => ({
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 4,
  summary: { groupId: "g", repoId: "orca", state: "running", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1, plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship", successConditions: ["done"] },
  proposal: { state: "confirmed", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null }, profiles: {
    estimator: { profileId: "all", profileHash: "b".repeat(64) }, worker: { profileId: "all", profileHash: "b".repeat(64) },
    handoff: { profileId: "all", profileHash: "b".repeat(64) }, goalReview: { profileId: "all", profileHash: "b".repeat(64) } }, executionSnapshotHash: "c".repeat(64) },
  ledger: { groupLimit: amount(9_000_000), used: amount(64_200), committedRemaining: amount(0), explicitUnallocatedReserve: amount(0), budgetDeficit: amount(0), usageUnknown: false, unmeteredRuns: 0 },
  allocations: [], workItems: [], estimates: [], runs, checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
});

afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

describe("a single call's output overrun (spec §6.2)", () => {
  it("says by how much the call went over, in English and in Chinese", async () => {
    await i18n.changeLanguage("en");
    const { unmount } = render(<RunOutputBound run={run({})} />);
    expect(screen.getByRole("note").textContent).toBe(EN);
    unmount();
    await i18n.changeLanguage("zh");
    render(<RunOutputBound run={run({})} />);
    expect(screen.getByRole("note").textContent).toBe(ZH);
  });

  it("renders nothing for a call that stayed within its bound", () => {
    const { container } = render(<RunOutputBound run={run({ outputBoundExceededBy: undefined })} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows on a completed call's row in the runs table, and only there for that call", () => {
    const { container } = render(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "runs", taskId: null, runId: null }} view={view([run({}), run({ runId: "run-f", estimateId: "e2", outputBoundExceededBy: undefined })])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    const over = container.querySelector<HTMLElement>('tr[data-run-id="run-e"]')!, within_ = container.querySelector<HTMLElement>('tr[data-run-id="run-f"]')!;
    expect([within(over).queryAllByText(EN).length, within(within_).queryAllByText(EN).length, container.querySelector('[data-problem-run-id="run-e"]')]).toEqual([1, 0, null]);
  });

  it("shows on the call's line in the problem-runs list too", () => {
    const { container } = render(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "problem", taskId: null, runId: null }} view={view([run({ state: "blocked", blockedReason: "terminal:failed" })])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    const problem = container.querySelector<HTMLElement>('[data-problem-run-id="run-e"]')!;
    expect(within(problem).queryAllByText(EN).length).toBe(1);
  });
});
