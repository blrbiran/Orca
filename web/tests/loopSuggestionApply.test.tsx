// @vitest-environment jsdom
/**
 * W5 (human rulings H6, H14, H16; 2026-10-01): an estimate's suggestion for a loop task's work budget is applied in one
 * click, through set-task-loop -- per field, per row, and with "Apply all". "Apply all" over a loop task and a plain task
 * needs two commands; the page sends them one after the other by itself, the second at the commandRevision the first
 * one's success returned, and stops at the first refusal. No manual step, no retry.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { BudgetEditor } from "../src/BudgetEditor.js";
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
// Rewritten under human ruling H18 (2026-10-01) for panel i18n.
const LOOP_PLAN: LoopPlanViewV1 = {
  planId: "bugfix", planVersion: 1, chosenBy: "labels", chosenByLabel: "bug", amended: false, loopVersion: 2,
  inputs: { goal: "fix login", successCondition: "the login test passes", targetPaths: ["src/auth/**"], checks: ["npm test -- --run auth"], nonGoals: [], relevantDocs: [], protectedPaths: [], maxFilesTouched: null },
  maxFiles: 25, hasDiscipline: true,
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
const view = (stale = false): GroupViewV1 => ({
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 4,
  summary: { groupId: "g", repoId: "orca", state: "draft", commandRevision: 3, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
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
    { taskId: "a", status: "draft", dependencyTaskIds: [], targetVersion: 1, configHash: null, originalContractHash: "e".repeat(64), derivedContractHash: null, currentRunId: null, pendingRunId: null, lineageRunIds: [], loopPlan: LOOP_PLAN },
    { taskId: "c", status: "draft", dependencyTaskIds: [], targetVersion: 1, configHash: null, originalContractHash: "e".repeat(64), derivedContractHash: null, currentRunId: null, pendingRunId: null, lineageRunIds: [], loopPlan: null },
  ],
  estimates: [estimate(stale)], runs: [], checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
});
const model = { provenance: "model", estimateId: "est-1" } as const;
const loopAction = (work: { tokens: number; activeMs: number; attempts: number }, workProvenance: object, expectedRevision = 3) => ({
  verb: "set-task-loop", groupId: "g", taskId: "a", expectedRevision,
  payload: { baseLoopVersion: 2, plan: "bugfix", inputs: LOOP_PLAN.inputs, work, workProvenance },
});
const cEdit = {
  verb: "proposal-edit", groupId: "g", expectedRevision: 3,
  payload: { baseProposalVersion: 2, operations: [
    { target: { scope: "task", taskId: "c", allocation: "work", dimension: "tokens" }, value: 4_000, provenance: "model", estimateId: "est-1" },
    { target: { scope: "task", taskId: "c", allocation: "work", dimension: "activeMs" }, value: 40_000, provenance: "model", estimateId: "est-1" },
  ] },
};

afterEach(() => { cleanup(); window.sessionStorage.clear(); vi.restoreAllMocks(); });

describe("the budget editor applies a loop task's work suggestion through set-task-loop (W5)", () => {
  it("sends only the clicked dimension from a field button, and offers none where the suggestion already matches", () => {
    const onCommand = vi.fn();
    render(<BudgetEditor view={view()} config={config} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    fireEvent.click(screen.getByRole("button", { name: "use 4000 for a work tokens" }));
    expect(onCommand.mock.calls.map((call) => call[0])).toEqual([loopAction({ tokens: 4_000, activeMs: 30_000, attempts: 1 }, { tokens: model })]);
    expect(screen.getByRole("button", { name: "use 40000 for a work activeMs" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /for a work attempts/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /for a work sessions/ })).toBeNull();
  });

  it("keeps a row's control to its own row: the plain task's row sends its proposal-edit alone", () => {
    const onCommand = vi.fn(), onCommands = vi.fn();
    render(<BudgetEditor view={view()} config={config} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} onCommands={onCommands} />);
    fireEvent.click(screen.getByRole("button", { name: "Apply row c work" }));
    expect(onCommands).not.toHaveBeenCalled();
    expect(onCommand.mock.calls.map((call) => call[0])).toEqual([cEdit]);
  });

  it("hands Apply all's two commands over together, the proposal-edit first", () => {
    const onCommand = vi.fn(), onCommands = vi.fn();
    render(<BudgetEditor view={view()} config={config} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} onCommands={onCommands} />);
    fireEvent.click(screen.getByRole("button", { name: "Apply all suggestions" }));
    expect(onCommand).not.toHaveBeenCalled();
    expect(onCommands.mock.calls.map((call) => call[0])).toEqual([[cEdit, loopAction({ tokens: 4_000, activeMs: 40_000, attempts: 1 }, { tokens: model, activeMs: model })]]);
  });

  it("offers no loop suggestion from a stale estimate (W6: the server refuses it as estimate-stale)", () => {
    render(<BudgetEditor view={view(true)} config={config} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} onCommands={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Apply row a work" })).toBeNull();
    expect(screen.queryByRole("button", { name: /for a work / })).toBeNull();
  });
});

const summary: ControlSummaryV1 = { schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq: 4, resetRequired: false, dispatchBlocked: false, groups: [view().summary] };
const recovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [] };
const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const EDIT_ROUTE = "/api/control/groups/g/proposal/edit";
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
    if (url === "/api/projects") return jsonResponse({ projects: [{ projectKey: "orca", controlRepoId: "orca" }] });
    // Copied verbatim from web/tests/loopPlanDraft.test.tsx (the page reads the metrics on load).
    if (url === "/api/metrics") return jsonResponse({ report: { as_of: "2026-09-21T00:00:00.000Z", as_of_mode: "wall_clock", repos: [], correction_rate: { numerator_corrections_excluding_stale: 0, denominator_decisions: 0, rate_excluding_stale: null, corrections_total_including_stale: 0, by_decision_kind: [], buckets: [], caveats: [] }, repair_rate: { numerator_overturned: 0, denominator_corrections_including_stale: 0, rate: null, stale_only: { numerator_overturned: 0, denominator_corrections: 0, rate: null, known_bias: "" }, buckets: [], caveats: [] }, backlog: { open_corrections: 0, oldest_age_ms: null, oldest_correction_id: null, by_correction_kind: [] }, breakdown_by_correction_kind_including_stale: [], review_coverage: { available: false, reason: "none" }, unresolved_decisions: [], unkeyable_repos: [], malformed_lines: [] }, panel_review_coverage: { reviewed_high_tier: 0, high_tier_total: 0, rate: 0, caveat: "" } });
    if (url === "/api/chains") return jsonResponse({ repos: [] });
    if (url === "/api/control/config") return jsonResponse(config);
    if (url.startsWith("/api/control/summary")) return jsonResponse(summary);
    if (url === "/api/control/recovery") return jsonResponse(recovery);
    // The group read after each command answers the view as before: nothing but the success body carries the new revision.
    if (url === "/api/control/groups/g") return jsonResponse(view());
    if (method === "POST" && answers[url]?.length) {
      const next = answers[url]!.shift()!;
      return jsonResponse(next.body, next.status);
    }
    if (url.startsWith("/api/control/")) return jsonResponse({ error: { code: "route-not-found", message: "not served here", commandRevision: null, evidenceIds: [], retryable: false } }, 404);
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;
});

const posts = () => requests.filter((request) => request.method === "POST").map((request) => ({ url: request.url, body: request.body }));
/** Everything the page does after a command settles -- the group re-read -- has happened, and then a tick more. */
const settled = async (postCount: number): Promise<void> => {
  await waitFor(() => {
    const lastPost = requests.map((request) => request.method).lastIndexOf("POST");
    expect(posts()).toHaveLength(postCount);
    expect(requests.slice(lastPost + 1).some((request) => request.url === "/api/control/groups/g")).toBe(true);
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
};

describe("Apply all over a loop task and a plain task (W5, human ruling H16)", () => {
  it("sends the proposal-edit, then set-task-loop at the revision the first success returned, with no manual step", async () => {
    answers = {
      [EDIT_ROUTE]: [success("proposal-edit", 11, { kind: "proposal-edited", proposalVersion: 3 })],
      [LOOP_ROUTE]: [success("set-task-loop", 12, { kind: "task-loop-set", taskId: "a", loopVersion: 3, proposalVersion: 4 })],
    };
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^g · draft/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Apply all suggestions" }));
    await settled(2);
    expect(posts()).toEqual([
      { url: EDIT_ROUTE, body: expect.objectContaining({ expectedRevision: 3, payload: cEdit.payload }) },
      { url: LOOP_ROUTE, body: expect.objectContaining({ expectedRevision: 11, payload: loopAction({ tokens: 4_000, activeMs: 40_000, attempts: 1 }, { tokens: model, activeMs: model }).payload }) },
    ]);
  });

  it("stops at the first refusal and shows it; the set-task-loop is never sent", async () => {
    answers = {
      [EDIT_ROUTE]: [{ status: 409, body: { error: { code: "proposal-version-conflict", message: "proposal-version-conflict", commandRevision: 3, evidenceIds: [], retryable: false } } }],
      [LOOP_ROUTE]: [success("set-task-loop", 12, { kind: "task-loop-set", taskId: "a", loopVersion: 3, proposalVersion: 4 })],
    };
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^g · draft/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Apply all suggestions" }));
    await screen.findByText(/proposal-version-conflict/);
    await settled(1);
    expect(posts().map((post) => post.url)).toEqual([EDIT_ROUTE]);
  });
});
