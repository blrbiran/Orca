// @vitest-environment jsdom
/**
 * Loop plans spec §4.2: a loop draft is the person's own data. The page keeps it through a refusal -- which it shows by
 * code, like any refusal -- and clears it only once the set-task-loop command succeeded.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import type { Amount, ControlConfigV1, ControlSummaryV1, GroupViewV1, RecoveryViewV1 } from "../src/controlTypes.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-09-29T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
const summary: ControlSummaryV1 = {
  schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq: 4, resetRequired: false, dispatchBlocked: false,
  groups: [{ groupId: "g", state: "running", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 }],
};
const recovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [] };
const groupView: GroupViewV1 = {
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 4, summary: summary.groups[0]!, graphVersion: 1,
  plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship", successConditions: ["done"] },
  proposal: { state: "confirmed", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null }, profiles: {
    estimator: { profileId: "all", profileHash: "b".repeat(64) }, worker: { profileId: "all", profileHash: "b".repeat(64) },
    handoff: { profileId: "all", profileHash: "b".repeat(64) }, goalReview: { profileId: "all", profileHash: "b".repeat(64) } }, executionSnapshotHash: "c".repeat(64) },
  ledger: { groupLimit: amount(9_000_000), used: amount(10), committedRemaining: amount(3_000_000), explicitUnallocatedReserve: amount(5_999_990), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [{ ownerKind: "task", ownerId: "a", bucket: "work", state: "confirmed", amount: { tokens: 3_000_000, activeMs: 14_400_000, attempts: 3, sessions: 3 }, fieldProvenance: { tokens: { provenance: "human", estimateId: null }, activeMs: { provenance: "human", estimateId: null }, attempts: { provenance: "human", estimateId: null }, sessions: { provenance: "human", estimateId: null } } }],
  workItems: [{ taskId: "a", status: "ready", dependencyTaskIds: [], targetVersion: 1, configHash: "d".repeat(64), originalContractHash: "e".repeat(64), derivedContractHash: "f".repeat(64), currentRunId: null, pendingRunId: null, lineageRunIds: [], labels: [], labelsProvenance: "plan", labelsVersion: 0, progress: null,
    objective: { goal: "fix login", successCondition: "the login test passes" },
    loopPlan: {
      planId: "bugfix", planVersion: 1, planName: "Bug fix (red first)", chosenBy: "labels", chosenByLabel: "bug", amended: false, loopVersion: 0,
      inputs: { goal: "fix login", successCondition: "the login test passes", targetPaths: ["src/auth/**"], checks: ["npm test -- --run auth"], nonGoals: [], relevantDocs: [], protectedPaths: [], maxFilesTouched: null },
      summary: ["Goal: fix login", "Done when: the login test passes", "Only changes: src/auth/**", "At most 25 files changed (reported by the agent)", "Acceptance: 1 check command, all must pass", "Write a failing test that reproduces the bug, then fix it (checked by a model, not proven mechanically)"],
    } }],
  estimates: [], runs: [], checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
};
const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const LOOP_ROUTE = "/api/control/groups/g/tasks/a/loop";

let answers: Array<{ status: number; body: unknown }>;
let posted: unknown[];

beforeEach(() => {
  answers = []; posted = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === "/api/todo") return jsonResponse({ rows: [] });
    // Copied verbatim from web/tests/controlCommandRecovery.test.tsx:100 (the page reads the metrics on load).
    if (url === "/api/metrics") return jsonResponse({ report: { as_of: "2026-09-21T00:00:00.000Z", as_of_mode: "wall_clock", repos: [], correction_rate: { numerator_corrections_excluding_stale: 0, denominator_decisions: 0, rate_excluding_stale: null, corrections_total_including_stale: 0, by_decision_kind: [], buckets: [], caveats: [] }, repair_rate: { numerator_overturned: 0, denominator_corrections_including_stale: 0, rate: null, stale_only: { numerator_overturned: 0, denominator_corrections: 0, rate: null, known_bias: "" }, buckets: [], caveats: [] }, backlog: { open_corrections: 0, oldest_age_ms: null, oldest_correction_id: null, by_correction_kind: [] }, breakdown_by_correction_kind_including_stale: [], review_coverage: { available: false, reason: "none" }, unresolved_decisions: [], unkeyable_repos: [], malformed_lines: [] }, panel_review_coverage: { reviewed_high_tier: 0, high_tier_total: 0, rate: 0, caveat: "" } });
    if (url === "/api/chains") return jsonResponse({ repos: [] });
    if (url === "/api/control/config") return jsonResponse(config);
    if (url.startsWith("/api/control/summary")) return jsonResponse(summary);
    if (url === "/api/control/recovery") return jsonResponse(recovery);
    if (url === "/api/control/groups/g") return jsonResponse(groupView);
    if (url === LOOP_ROUTE && init?.method === "POST") {
      posted.push(JSON.parse(String(init.body)));
      const next = answers.shift()!;
      return jsonResponse(next.body, next.status);
    }
    // The agent reads, the workspace read and the preview are not what this criterion is about.
    if (url.startsWith("/api/control/")) return jsonResponse({ error: { code: "route-not-found", message: "not served here", commandRevision: null, evidenceIds: [], retryable: false } }, 404);
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;
});

afterEach(() => { cleanup(); window.sessionStorage.clear(); vi.restoreAllMocks(); });

describe("the loop draft survives a refusal and is cleared by a success (spec §4.2)", () => {
  it("keeps the draft through a refusal, shows the refusal's code, and clears it once the command succeeded", async () => {
    answers = [
      { status: 422, body: { error: { code: "group-reserve-insufficient", message: "group-reserve-insufficient:tokens:1", commandRevision: 6, evidenceIds: [], retryable: false } } },
      { status: 200, body: { schema: "orca-command-success-v1", commandId: "x", actorId: "operator", verb: "set-task-loop", target: { kind: "task", groupId: "g", taskId: "a" }, commandRevision: 7, projectionSeq: 5, effectivePayloadHash: "1".repeat(64), authorityCommandHash: "2".repeat(64), result: { kind: "task-loop-set", taskId: "a", loopVersion: 1, proposalVersion: 2 } } },
    ];
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^g · running/ }));
    fireEvent.click(await screen.findByRole("button", { name: "a" }));
    // The import form has its own "Goal" box, so the card's fields are looked up inside the card.
    const card = (): HTMLElement => screen.getByRole("region", { name: "Plan a" });
    fireEvent.click(within(card()).getByRole("button", { name: "Change plan" }));
    fireEvent.change(within(card()).getByRole("textbox", { name: "Goal" }), { target: { value: "fix login, changed" } });
    fireEvent.click(within(card()).getByRole("button", { name: /^Budget/ }));
    await screen.findByText(/group-reserve-insufficient/);
    expect((within(card()).getByRole("textbox", { name: "Goal" }) as HTMLInputElement).value).toBe("fix login, changed");
    fireEvent.click(within(card()).getByRole("button", { name: /^Budget/ }));
    await waitFor(() => expect(within(card()).queryByRole("textbox", { name: "Goal" })).toBeNull());
    expect(posted).toEqual([
      expect.objectContaining({ expectedRevision: 6, payload: expect.objectContaining({ baseLoopVersion: 0, inputs: expect.objectContaining({ goal: "fix login, changed" }) }) }),
      expect.objectContaining({ expectedRevision: 6, payload: expect.objectContaining({ baseLoopVersion: 0 }) }),
    ]);
  });
});
