// @vitest-environment jsdom
/**
 * Plan A final review finding 1 (labels and progress spec §4.2): a label draft carries the labelsVersion it started
 * from and is sent with that version, whatever the polls read since -- so a draft begun before someone else's change is
 * refused as labels-version-conflict (again and again) instead of overwriting that change. The page says the server
 * moved, shows what it holds now, and lets the person discard the draft.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
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
  ledger: { groupLimit: amount(9_000_000), used: amount(10), committedRemaining: amount(3_000_000), explicitUnallocatedReserve: amount(5_999_990), budgetDeficit: amount(0), usageUnknown: false },
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

describe("a label draft is sent with the labelsVersion it started from (final review finding 1)", () => {
  it("keeps the draft's base after a poll read someone else's v1, so every save is refused as a conflict and the draft stays", async () => {
    answers = [conflict, conflict];
    render(<App />);
    await openTaskA();
    fireEvent.click(screen.getByRole("button", { name: "Add system label" })); // the select starts on "feature"
    // Someone else sets the labels to v1 meanwhile. The page's next canonical read of the group picks that up (probe at
    // 7a91fc0: App re-reads the open group on its own well before the 2 s summary tick; the summary's gap would force it
    // too), so the draft below was started at v0 and the view under it now says v1.
    groupView = groupViewAt(6, ["security"], 1);
    summary = summaryAt(6);
    await screen.findByText("security", { selector: "td span.label" }, { timeout: 6_000 });
    // A re-read forced by a summary gap drops the cached view and the open detail with it; if so, open the task again.
    if (screen.queryByRole("region", { name: "Task a" }) === null) fireEvent.click(screen.getByRole("button", { name: "a" }));
    expect(screen.getByText(/labels changed since your draft \(v0 → v1\)/).textContent).toContain("now: security");
    expect(screen.getByRole("button", { name: "Remove feature" })).toBeTruthy();
    // An edit after the change keeps the base the draft started from.
    fireEvent.change(screen.getByRole("combobox", { name: "System label" }), { target: { value: "perf" } });
    fireEvent.click(screen.getByRole("button", { name: "Add system label" }));
    fireEvent.click(screen.getByRole("button", { name: "Save labels" }));
    await screen.findByText(/labels-version-conflict/);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(screen.getByText(/unsaved draft/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove feature" })).toBeTruthy();
    // After the conflict the page re-read the group (still v1); a second save still carries the draft's base.
    fireEvent.click(screen.getByRole("button", { name: "Save labels" }));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted.map((body) => body.payload)).toEqual([
      { labels: ["doc", "feature", "perf"], baseLabelsVersion: 0 },
      { labels: ["doc", "feature", "perf"], baseLabelsVersion: 0 },
    ]);
  }, 15_000);

  it("discards the draft on request and shows the server's labels again", async () => {
    render(<App />);
    await openTaskA();
    fireEvent.click(screen.getByRole("button", { name: "Add system label" }));
    expect(screen.getByText(/unsaved draft/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove feature" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    await waitFor(() => expect(screen.queryByText(/unsaved draft/)).toBeNull());
    expect(screen.queryByRole("button", { name: "Remove feature" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove doc" })).toBeTruthy();
    expect(posted).toEqual([]);
  });

  it("reads a draft in the earlier bare-array form, which has no base, as no draft", () => {
    render(<ControlGroupView view={groupViewAt(4, ["doc"], 0)} config={config} uncertain={[]} drafts={{ "labels:g:a": JSON.stringify(["feature"]) }} onDraft={vi.fn()} onCommand={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "a" }));
    expect(screen.queryByText(/unsaved draft/)).toBeNull();
    expect(screen.getByRole("button", { name: "Remove doc" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save labels" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
