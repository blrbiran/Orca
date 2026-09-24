import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceModeSelector } from "../src/WorkspaceModeSelector.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { Amount, ControlConfigV1, GroupViewV1, RunViewV1 } from "../src/controlTypes.js";

// Execution driver spec §3.2 (the mode is changeable on the Web) and §2.3 (a blocked run shows why).
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
  summary: { groupId: "g", state: "ready", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1, plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship", successConditions: ["done"] },
  proposal: { state: "confirmed", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null }, profiles: {
    estimator: { profileId: "all", profileHash: "b".repeat(64) }, worker: { profileId: "all", profileHash: "b".repeat(64) },
    handoff: { profileId: "all", profileHash: "b".repeat(64) }, goalReview: { profileId: "all", profileHash: "b".repeat(64) } }, executionSnapshotHash: "c".repeat(64) },
  ledger: { groupLimit: amount(9_000_000), used: amount(10), committedRemaining: amount(3_000_000), explicitUnallocatedReserve: amount(5_999_990), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [], workItems: [], estimates: [], runs, checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
});
const renderGroup = (runs: RunViewV1[]) => renderToStaticMarkup(
  <ControlGroupView view={view(runs)} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />,
);

describe("workspace mode selector (execution driver §3.2)", () => {
  it("offers both modes with the current one checked, and says the change only reaches runs that start later", () => {
    const html = renderToStaticMarkup(<WorkspaceModeSelector workspace={{ schema: "orca-repository-workspace-v1", repoId: "orca", workspaceMode: "clone", revision: 3 }} onChange={vi.fn()} />);
    // Execution driver (task-10 implementer, evidence: node_modules/react-dom/cjs/react-dom-server-legacy.node.production.js's
    // "input" case unconditionally pushes checked/defaultChecked before value/defaultValue, regardless of JSX prop order --
    // confirmed with a standalone renderToStaticMarkup probe. The brief's regex ordered them the other way, which a real
    // React <input> can never produce; the attribute order below is corrected, the assertion's intent (clone checked,
    // worktree not) is unchanged.
    expect(html).toMatch(/<input[^>]*checked=""[^>]*value="clone"/);
    expect(html).not.toMatch(/<input[^>]*checked=""[^>]*value="worktree"/);
    expect(html).toContain("setting revision 3");
    expect(html).toContain("Runs already started keep theirs.");
  });
});

describe("a blocked run in the group view (execution driver §2.3)", () => {
  it("shows the reason next to the blocked state", () => {
    const html = renderGroup([run({ state: "blocked", blockedReason: "inspect-unknown" })]);
    expect(html).toContain("blocked — inspect-unknown");
  });

  it("shows no reason for a run that is not blocked, even from a view that omits the field", () => {
    const html = renderGroup([run({ state: "running" })]);
    expect(html).not.toContain("— undefined");
    expect(html).not.toContain("— null");
    expect(html).toContain("running");
  });
});
