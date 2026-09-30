// @vitest-environment jsdom
/**
 * Ledger W7 ruling (2026-10-01): applying an estimate's loop suggestion keeps the task's open plan-card draft -- dropping
 * what the person typed, with no undo, is the failure P1's amendment named. The card then says the plan changed after
 * the draft began. The card's own submit still clears its draft (web/tests/loopPlanDraft.test.tsx pins that).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import type { Amount, ControlConfigV1, ControlSummaryV1, EstimateViewV1, GroupViewV1, LoopPlanViewV1, RecoveryViewV1 } from "../src/controlTypes.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const human = { provenance: "human", estimateId: null } as const;
const provenance = { tokens: human, activeMs: human, attempts: human, sessions: human };
const PLAN = "a".repeat(64);
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "realtime", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-10-01T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
const LOOP_PLAN: LoopPlanViewV1 = {
  planId: "bugfix", planVersion: 1, planName: "Bug fix (red first)", chosenBy: "labels", chosenByLabel: "bug", amended: false, loopVersion: 2,
  inputs: { goal: "fix login", successCondition: "the login test passes", targetPaths: ["src/auth/**"], checks: ["npm test -- --run auth"], nonGoals: [], relevantDocs: [], protectedPaths: [], maxFilesTouched: null },
  summary: ["Goal: fix login"],
};
// Task a (loop) and task c (plain) are both suggested 4000 work tokens / 40000 ms; attempts and sessions already match.
const estimate = (stale = false): EstimateViewV1 => ({
  estimateId: "est-1", estimateVersion: 1, state: "ready", profile: { profileId: "all", profileHash: "b".repeat(64) }, mode: "soft",
  requestHash: "c".repeat(64), outputHash: "d".repeat(64), reasonCode: null, stale,
  output: {
    schema: "budget-estimate-v1", planHash: PLAN, goalReviewReserve: amount(0), groupRationale: "two small changes",
    tasks: ["a", "c"].map((taskId) => ({ taskId, complexity: "M" as const, confidence: "high" as const, work: amount(4_000), handoff: amount(300), rationale: "small", assumptions: [] })),
  },
});
const view = (stale = false, loopVersion = 2): GroupViewV1 => ({
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 4,
  summary: { groupId: "g", state: "draft", commandRevision: 3, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1,
  plan: { repoId: "orca", planId: "plan-demo", planHash: PLAN, goal: "Ship", successConditions: ["passes"] },
  proposal: { state: "editable", proposalVersion: 2, planHash: PLAN, budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
  ledger: { groupLimit: amount(90_000), used: amount(0), committedRemaining: amount(6_600), explicitUnallocatedReserve: amount(6_000), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [
    { ownerKind: "task", ownerId: "a", bucket: "work", state: "draft-encumbered", amount: amount(3_000), fieldProvenance: provenance },
    { ownerKind: "task", ownerId: "a", bucket: "handoff", state: "draft-encumbered", amount: amount(300), fieldProvenance: provenance },
    { ownerKind: "task", ownerId: "c", bucket: "work", state: "draft-encumbered", amount: amount(3_000), fieldProvenance: provenance },
    { ownerKind: "task", ownerId: "c", bucket: "handoff", state: "draft-encumbered", amount: amount(300), fieldProvenance: provenance },
  ],
  workItems: [
    { taskId: "a", status: "draft", dependencyTaskIds: [], targetVersion: 1, configHash: null, originalContractHash: "e".repeat(64), derivedContractHash: null, currentRunId: null, pendingRunId: null, lineageRunIds: [], loopPlan: { ...LOOP_PLAN, loopVersion } },
    { taskId: "c", status: "draft", dependencyTaskIds: [], targetVersion: 1, configHash: null, originalContractHash: "e".repeat(64), derivedContractHash: null, currentRunId: null, pendingRunId: null, lineageRunIds: [], loopPlan: null },
  ],
  estimates: [estimate(stale)], runs: [], checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
});
afterEach(() => { cleanup(); window.sessionStorage.clear(); vi.restoreAllMocks(); });

const summary: ControlSummaryV1 = { schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq: 4, resetRequired: false, dispatchBlocked: false, groups: [view().summary] };
const recovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [] };
const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const LOOP_ROUTE = "/api/control/groups/g/tasks/a/loop";
const success = (verb: string, commandRevision: number, result: object) => ({
  status: 200, body: { schema: "orca-command-success-v1", commandId: "x", actorId: "operator", verb, target: { kind: "group", groupId: "g" }, commandRevision, projectionSeq: 5, effectivePayloadHash: "1".repeat(64), authorityCommandHash: "2".repeat(64), result },
});

let answers: Record<string, Array<{ status: number; body: unknown }>>;
let requests: Array<{ url: string; method: string; body: unknown }>;

beforeEach(() => {
  answers = {}; requests = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input), method = init?.method ?? "GET";
    requests.push({ url, method, body: init?.body === undefined ? null : JSON.parse(String(init.body)) });
    if (url === "/api/todo") return jsonResponse({ rows: [] });
    // Copied verbatim from web/tests/loopPlanDraft.test.tsx (the page reads the metrics on load).
    if (url === "/api/metrics") return jsonResponse({ report: { as_of: "2026-09-21T00:00:00.000Z", as_of_mode: "wall_clock", repos: [], correction_rate: { numerator_corrections_excluding_stale: 0, denominator_decisions: 0, rate_excluding_stale: null, corrections_total_including_stale: 0, by_decision_kind: [], buckets: [], caveats: [] }, repair_rate: { numerator_overturned: 0, denominator_corrections_including_stale: 0, rate: null, stale_only: { numerator_overturned: 0, denominator_corrections: 0, rate: null, known_bias: "" }, buckets: [], caveats: [] }, backlog: { open_corrections: 0, oldest_age_ms: null, oldest_correction_id: null, by_correction_kind: [] }, breakdown_by_correction_kind_including_stale: [], review_coverage: { available: false, reason: "none" }, unresolved_decisions: [], unkeyable_repos: [], malformed_lines: [] }, panel_review_coverage: { reviewed_high_tier: 0, high_tier_total: 0, rate: 0, caveat: "" } });
    if (url === "/api/chains") return jsonResponse({ repos: [] });
    if (url === "/api/control/config") return jsonResponse(config);
    if (url.startsWith("/api/control/summary")) return jsonResponse(summary);
    if (url === "/api/control/recovery") return jsonResponse(recovery);
    // The group read after each command answers the view as before: nothing but the success body carries the new revision.
    // After the set-task-loop succeeded, the group read shows the task's next loopVersion.
    if (url === "/api/control/groups/g") return jsonResponse(view(false, requests.some((request) => request.method === "POST") ? 3 : 2));
    if (method === "POST" && answers[url]?.length) {
      const next = answers[url]!.shift()!;
      return jsonResponse(next.body, next.status);
    }
    if (url.startsWith("/api/control/")) return jsonResponse({ error: { code: "route-not-found", message: "not served here", commandRevision: null, evidenceIds: [], retryable: false } }, 404);
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;
});

describe("applying a loop suggestion keeps the plan card's open draft (W7)", () => {
  it("keeps what the person typed and says the plan changed after the draft began", async () => {
    answers = { [LOOP_ROUTE]: [success("set-task-loop", 12, { kind: "task-loop-set", taskId: "a", loopVersion: 3, proposalVersion: 3 })] };
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^g · draft/ }));
    fireEvent.click(await screen.findByRole("button", { name: "a" }));
    const card = (): HTMLElement => screen.getByRole("region", { name: "Plan a" });
    fireEvent.click(within(card()).getByRole("button", { name: "Change plan" }));
    fireEvent.change(within(card()).getByRole("textbox", { name: "Goal" }), { target: { value: "fix login, typed" } });
    fireEvent.click(screen.getByRole("button", { name: "use 4000 for a work tokens" }));
    await waitFor(() => expect(within(card()).getByRole("status").textContent).toBe("The plan changed after you started this draft (v2 → v3)"));
    expect(requests.filter((request) => request.method === "POST").map((request) => request.url)).toEqual([LOOP_ROUTE]);
    expect((within(card()).getByRole("textbox", { name: "Goal" }) as HTMLInputElement).value).toBe("fix login, typed");
  });
});
