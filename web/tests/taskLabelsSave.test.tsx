// @vitest-environment jsdom
/**
 * Tester #114 over the real page: a label change is saved at once with the labelsVersion on screen, so a change from a
 * stale view is refused as labels-version-conflict instead of overwriting someone else's, the refusal is shown by its
 * code, and the chips stay what the server holds -- no chip appears that the server did not accept.
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
const groupSummary = { groupId: "g", repoId: "orca", state: "running", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 } as const;
const summaryAt = (changeSeq: number): ControlSummaryV1 => ({
  schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq, resetRequired: false, dispatchBlocked: false, groups: [groupSummary],
});
const recovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [] };
const groupViewAt = (changeSeq: number, labels: string[], labelsVersion: number): GroupViewV1 => ({
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq, summary: groupSummary, graphVersion: 1,
  plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship", successConditions: ["done"] },
  proposal: { state: "confirmed", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null }, profiles: {
    estimator: { profileId: "all", profileHash: "b".repeat(64) }, worker: { profileId: "all", profileHash: "b".repeat(64) },
    handoff: { profileId: "all", profileHash: "b".repeat(64) }, goalReview: { profileId: "all", profileHash: "b".repeat(64) } }, executionSnapshotHash: "c".repeat(64) },
  ledger: { groupLimit: amount(9_000_000), used: amount(10), committedRemaining: amount(3_000_000), explicitUnallocatedReserve: amount(5_999_990), budgetDeficit: amount(0), usageUnknown: false, unmeteredRuns: 0 },
  allocations: [],
  workItems: [{ taskId: "a", status: "active", dependencyTaskIds: [], targetVersion: 1, configHash: "d".repeat(64), originalContractHash: "e".repeat(64), derivedContractHash: "f".repeat(64), currentRunId: null, pendingRunId: null, lineageRunIds: [], labels, labelsProvenance: labelsVersion === 0 ? "plan" : "operator", labelsVersion, progress: null }],
  estimates: [], runs: [], checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
});
const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const LABELS = "/api/control/groups/g/tasks/a/labels";
const conflict = { status: 409, body: { error: { code: "labels-version-conflict", message: "labels-version-conflict", commandRevision: 6, evidenceIds: [], retryable: false } } };

let summary: ControlSummaryV1;
let groupView: GroupViewV1;
let answers: Array<{ status: number; body: unknown }>;
let posted: Array<{ payload: unknown }>;

beforeEach(() => {
  summary = summaryAt(4); groupView = groupViewAt(4, ["doc"], 0); answers = []; posted = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === "/api/todo") return jsonResponse({ rows: [] });
    if (url === "/api/projects") return jsonResponse({ projects: [{ projectKey: "orca", controlRepoId: "orca" }] });
    // Copied verbatim from web/tests/controlCommandRecovery.test.tsx:100 (the page reads the metrics on load).
    if (url === "/api/metrics") return jsonResponse({ report: { as_of: "2026-09-21T00:00:00.000Z", as_of_mode: "wall_clock", repos: [], correction_rate: { numerator_corrections_excluding_stale: 0, denominator_decisions: 0, rate_excluding_stale: null, corrections_total_including_stale: 0, by_decision_kind: [], buckets: [], caveats: [] }, repair_rate: { numerator_overturned: 0, denominator_corrections_including_stale: 0, rate: null, stale_only: { numerator_overturned: 0, denominator_corrections: 0, rate: null, known_bias: "" }, buckets: [], caveats: [] }, backlog: { open_corrections: 0, oldest_age_ms: null, oldest_correction_id: null, by_correction_kind: [] }, breakdown_by_correction_kind_including_stale: [], review_coverage: { available: false, reason: "none" }, unresolved_decisions: [], unkeyable_repos: [], malformed_lines: [] }, panel_review_coverage: { reviewed_high_tier: 0, high_tier_total: 0, rate: 0, caveat: "" } });
    if (url === "/api/chains") return jsonResponse({ repos: [] });
    if (url === "/api/control/config") return jsonResponse(config);
    if (url.startsWith("/api/control/summary")) return jsonResponse(summary);
    if (url === "/api/control/recovery") return jsonResponse(recovery);
    if (url === "/api/control/groups/g") return jsonResponse(groupView);
    if (url === LABELS && init?.method === "POST") {
      posted.push(JSON.parse(String(init.body)) as { payload: unknown });
      const next = answers.shift()!;
      return jsonResponse(next.body, next.status);
    }
    // The agent reads, the workspace read and the preview are not what this criterion is about.
    if (url.startsWith("/api/control/")) return jsonResponse({ error: { code: "route-not-found", message: "not served here", commandRevision: null, evidenceIds: [], retryable: false } }, 404);
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;
});

afterEach(() => { cleanup(); window.sessionStorage.clear(); vi.restoreAllMocks(); });

const openTaskA = async (): Promise<void> => {
  fireEvent.click(await screen.findByRole("button", { name: /^g · running/ }));
  fireEvent.click(await screen.findByRole("button", { name: "a" }));
};

const add = (word: string): void => {
  const field = screen.getByRole("combobox", { name: "Add label" });
  fireEvent.change(field, { target: { value: word } });
  fireEvent.keyDown(field, { key: "Enter" });
};
const task = () => within(screen.getByRole("region", { name: "Task a" }));

describe("a label change goes straight to the server (tester #114)", () => {
  it("shows a refusal by its code and no chip the server did not accept, then shows the chip once the server holds it", async () => {
    const success = { status: 200, body: { schema: "orca-command-success-v1", commandId: "x", actorId: "operator", verb: "set-task-labels", target: { kind: "task", groupId: "g", taskId: "a" }, commandRevision: 7, projectionSeq: 5, effectivePayloadHash: "1".repeat(64), authorityCommandHash: "2".repeat(64), result: { kind: "task-labels-set", taskId: "a", labelsVersion: 1 } } };
    answers = [{ status: 422, body: { error: { code: "labels-invalid", message: "labels-invalid:count:17", commandRevision: 6, evidenceIds: [], retryable: false } } }, success];
    render(<App />);
    await openTaskA();
    add("feature");
    await screen.findByText(/labels-invalid/);
    expect(task().queryByRole("button", { name: "Remove feature" })).toBeNull();
    expect(task().getByRole("button", { name: "Remove doc" })).toBeTruthy();
    groupView = groupViewAt(6, ["doc", "feature"], 1); summary = summaryAt(6);
    add("feature");
    await screen.findByRole("button", { name: "Remove feature" }, { timeout: 6_000 });
    expect(posted.map((body) => body.payload)).toEqual([
      { labels: ["doc", "feature"], baseLabelsVersion: 0 },
      { labels: ["doc", "feature"], baseLabelsVersion: 0 },
    ]);
  }, 15_000);

  it("sends the version on screen, so the view a poll just read is the one a change is based on", async () => {
    answers = [conflict];
    render(<App />);
    await openTaskA();
    groupView = groupViewAt(6, ["security"], 1); summary = summaryAt(6);
    await screen.findByText("security", { selector: "td span.label" }, { timeout: 6_000 });
    // A re-read forced by a summary gap drops the cached view and the open detail with it; if so, open the task again.
    if (screen.queryByRole("region", { name: "Task a" }) === null) fireEvent.click(screen.getByRole("button", { name: "a" }));
    fireEvent.click(task().getByRole("button", { name: "Remove security" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    await screen.findByText(/labels-version-conflict/);
    expect(posted[0]!.payload).toEqual({ labels: [], baseLabelsVersion: 1 });
    expect(task().getByRole("button", { name: "Remove security" })).toBeTruthy();
  }, 15_000);
});
