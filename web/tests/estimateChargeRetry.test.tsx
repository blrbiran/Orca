// @vitest-environment jsdom
/**
 * Spec 2026-10-27 single-call unknown usage (tester #62) §9 R1 (review S8): an estimate run blocked on unknown usage is
 * retried, in the group view's run retry, only by charging its remaining grant; a plain run retry there is refused by the
 * server (acknowledge-required). Fixtures as web/tests/driverRetry.test.tsx.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { Amount, ControlConfigV1, GroupViewV1, RunViewV1 } from "../src/controlTypes.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-09-25T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
const run = (over: Partial<RunViewV1>): RunViewV1 => ({
  runId: "run-a", taskId: "a", estimateId: null, generation: 1, state: "running", phase: "work", claimOrdinal: 1, providerAttemptOrdinal: 1,
  profile: { profileId: "all", profileHash: "b".repeat(64) }, used: amount(10), remaining: amount(90), failureCode: null, evidenceIds: [], ...over,
});
const view = (runs: RunViewV1[]): GroupViewV1 => ({
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 4,
  summary: { groupId: "g", repoId: "orca", state: "running", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1, plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship", successConditions: ["done"] },
  proposal: { state: "confirmed", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null }, profiles: {
    estimator: { profileId: "all", profileHash: "b".repeat(64) }, worker: { profileId: "all", profileHash: "b".repeat(64) },
    handoff: { profileId: "all", profileHash: "b".repeat(64) }, goalReview: { profileId: "all", profileHash: "b".repeat(64) } }, executionSnapshotHash: "c".repeat(64) },
  ledger: { groupLimit: amount(9_000_000), used: amount(10), committedRemaining: amount(3_000_000), explicitUnallocatedReserve: amount(5_999_990), budgetDeficit: amount(0), usageUnknown: false, unmeteredRuns: 0 },
  allocations: [], workItems: [], estimates: [], runs, checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
});

afterEach(cleanup);

describe("an estimate run blocked on unknown usage (§9 R1)", () => {
  it("offers the charge of its remaining grant, confirms, and sends the acknowledgement on the run", () => {
    const onCommand = vi.fn();
    const estimate = run({ runId: "run-e", taskId: null, estimateId: "est-1", phase: "estimate", state: "blocked", blockedReason: "estimate-usage-unknown:omp-stalled", remaining: amount(999_000) });
    render(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "runs", taskId: null, runId: null }} view={view([estimate])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    expect(screen.queryAllByRole("button", { name: /^Retry run/ })).toHaveLength(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Charge the call's grant (999,000 tokens) and retry" })[0]!);
    const confirm = screen.getByRole("group", { name: "Charge the call's grant (999,000 tokens) and retry" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Charge 999,000 tokens and retry" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "recovery-retry", groupId: "g", expectedRevision: 6, payload: { scope: "run", runId: "run-e", acknowledge: "charge-remaining-grant" } });
  });

  // Code review S1 and m1: an estimate a stop closed with its usage unknown (the server's settlement preview present and
  // unsettled) is offered the same charge; ccloop's lower bound is shown where the run carries one.
  it("offers the charge on an estimate a stop closed with its usage unknown, with the lower bound", () => {
    const onCommand = vi.fn();
    const preview = { generation: 1, highWater: 2, remaining: { work: amount(999_000), handoff: amount(0) }, allowed: false, refusalReason: "run-usage-not-settleable:current-failed-task", acknowledge: "charge-remaining-grant" as const };
    const estimate = run({ runId: "run-e", taskId: null, estimateId: "est-1", phase: "estimate", state: "settled-restartable", blockedReason: "estimate-usage-unknown:omp-stalled", remaining: amount(999_000), usageLowerBound: 4_321, unknownUsageSettlement: preview });
    render(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "runs", taskId: null, runId: null }} view={view([estimate])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    expect(document.body.textContent).toContain("At least 4,321 tokens were observed");
    fireEvent.click(screen.getAllByRole("button", { name: "Charge the call's grant (999,000 tokens) and retry" })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "Charge 999,000 tokens and retry" })[0]!);
    expect(onCommand).toHaveBeenCalledWith({ verb: "recovery-retry", groupId: "g", expectedRevision: 6, payload: { scope: "run", runId: "run-e", acknowledge: "charge-remaining-grant" } });
  });

  it("offers nothing on a settled estimate whose usage is known", () => {
    const estimate = run({ runId: "run-e", taskId: null, estimateId: "est-1", phase: "estimate", state: "settled-restartable", blockedReason: "estimate-usage-unknown:omp-stalled" });
    render(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "runs", taskId: null, runId: null }} view={view([estimate])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.queryAllByRole("button", { name: /Charge the call's grant/ })).toHaveLength(0);
  });

  it("keeps the plain run retry for an estimate blocked for another reason", () => {
    const onCommand = vi.fn();
    const estimate = run({ runId: "run-e", taskId: null, estimateId: "est-1", phase: "estimate", state: "blocked", blockedReason: "single-call-record-invalid" });
    render(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "runs", taskId: null, runId: null }} view={view([estimate])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    expect(screen.queryAllByRole("button", { name: /Charge the call's grant/ })).toHaveLength(0);
    fireEvent.click(screen.getAllByRole("button", { name: /^Retry run/ })[0]!);
    expect(onCommand).toHaveBeenCalledWith({ verb: "recovery-retry", groupId: "g", expectedRevision: 6, payload: { scope: "run", runId: "run-e" } });
  });
});
