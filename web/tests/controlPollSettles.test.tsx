// @vitest-environment jsdom
/**
 * The page polls the summary every 2 s against a server that answers the way the real one does: a request without
 * `sinceChangeSeq` gets a complete summary with `resetRequired: true` (web-recoverable-control spec §3.2;
 * src/panel/controlViews.ts readControlSummary), and an incremental one lists every group that moved after N, so its
 * `changeSeq` may be many steps past N while a group is running. web/tests/controlRefetch.test.tsx answered a complete
 * read with `resetRequired: false`, which the real server never does; under the real answer every tick voided the
 * cache, unmounted the whole control panel and asked for everything again, so the person's open task and scroll
 * position were thrown away every 2 s. This criterion holds the page to the real server's answers: no complete read
 * once the polls are incremental,
 * the open group's nodes and open task kept across polls, and the open group re-read when the projection moves
 * past it.
 * jsdom has no layout, so the scroll jump itself is not measurable here: it follows from the panel being unmounted,
 * which is what this measures.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import type { Amount, ControlConfigV1, ControlSummaryV1, GroupSummaryV1, GroupViewV1, RecoveryViewV1 } from "../src/controlTypes.js";

// Fixtures copied verbatim from web/tests/controlRefetch.test.tsx.
const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-09-29T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
const recovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [] };
const groupSummary = (projectionSeq: number): GroupSummaryV1 => ({ groupId: "g", repoId: "orca", state: "running", commandRevision: 6, projectionSeq, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 });
const groupView = (seq: number): GroupViewV1 => ({
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: seq, summary: groupSummary(seq), graphVersion: 1,
  plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship", successConditions: ["done"] },
  proposal: { state: "confirmed", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null }, profiles: {
    estimator: { profileId: "all", profileHash: "b".repeat(64) }, worker: { profileId: "all", profileHash: "b".repeat(64) },
    handoff: { profileId: "all", profileHash: "b".repeat(64) }, goalReview: { profileId: "all", profileHash: "b".repeat(64) } }, executionSnapshotHash: "c".repeat(64) },
  ledger: { groupLimit: amount(9_000_000), used: amount(10), committedRemaining: amount(3_000_000), explicitUnallocatedReserve: amount(5_999_990), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [],
  workItems: [{ taskId: "a", status: "active", dependencyTaskIds: [], targetVersion: 1, configHash: "d".repeat(64), originalContractHash: "e".repeat(64), derivedContractHash: "f".repeat(64), currentRunId: null, pendingRunId: null, lineageRunIds: [], labels: [], labelsProvenance: "plan", labelsVersion: 0, progress: null }],
  estimates: [], runs: [], checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
});
const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const METRICS = { report: { as_of: "2026-09-21T00:00:00.000Z", as_of_mode: "wall_clock", repos: [], correction_rate: { numerator_corrections_excluding_stale: 0, denominator_decisions: 0, rate_excluding_stale: null, corrections_total_including_stale: 0, by_decision_kind: [], buckets: [], caveats: [] }, repair_rate: { numerator_overturned: 0, denominator_corrections_including_stale: 0, rate: null, stale_only: { numerator_overturned: 0, denominator_corrections: 0, rate: null, known_bias: "" }, buckets: [], caveats: [] }, backlog: { open_corrections: 0, oldest_age_ms: null, oldest_correction_id: null, by_correction_kind: [] }, breakdown_by_correction_kind_including_stale: [], review_coverage: { available: false, reason: "none" }, unresolved_decisions: [], unkeyable_repos: [], malformed_lines: [] }, panel_review_coverage: { reviewed_high_tier: 0, high_tier_total: 0, rate: 0, caveat: "" } };
const REFETCH = /projection refetch required/;

// The server: group g is running and moves three times between two polls, so every summary read finds it moved.
let seq: number;
let completeReads: number;
let incrementalReads: number;
let completeAfterIncremental: number;
let groupReads: number;
// How far the group read runs ahead of the last summary: a group that moved again after the summary was answered.
let groupLead: number;

function summaryAnswer(url: string): ControlSummaryV1 {
  seq += 3;
  const since = new URL(url, "http://panel.test").searchParams.get("sinceChangeSeq");
  if (since === null) {
    completeReads += 1;
    if (incrementalReads > 0) completeAfterIncremental += 1;
    return { schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq: seq, resetRequired: true, dispatchBlocked: false, groups: [groupSummary(seq)] };
  }
  incrementalReads += 1;
  const moved = seq > Number(since) ? [groupSummary(seq)] : [];
  return { schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq: seq, resetRequired: false, dispatchBlocked: false, groups: moved };
}

beforeEach(() => {
  seq = 4; completeReads = 0; incrementalReads = 0; completeAfterIncremental = 0; groupReads = 0; groupLead = 0;
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url === "/api/todo") return jsonResponse({ rows: [] });
    if (url === "/api/metrics") return jsonResponse(METRICS);
    if (url === "/api/chains") return jsonResponse({ repos: [] });
    if (url === "/api/control/config") return jsonResponse(config);
    if (url.startsWith("/api/control/summary")) return jsonResponse(summaryAnswer(url));
    if (url === "/api/control/recovery") return jsonResponse(recovery);
    if (url === "/api/control/groups/g") { groupReads += 1; return jsonResponse(groupView(seq + groupLead)); }
    // The agent reads, the workspace read and the preview are not what this criterion is about.
    if (url.startsWith("/api/control/")) return jsonResponse({ error: { code: "route-not-found", message: "not served here", commandRevision: null, evidenceIds: [], retryable: false } }, 404);
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;
});

afterEach(() => { cleanup(); window.sessionStorage.clear(); vi.restoreAllMocks(); });

describe("polling a server that answers like the real one settles", () => {
  it("keeps the open group and its open task on the page across polls, and re-reads it when it moves", async () => {
    render(<App />);
    const groupButton = await screen.findByRole("button", { name: /^g · running/ });
    fireEvent.click(groupButton);
    const region = await screen.findByRole("region", { name: "Control group g" });
    const taskButton = await screen.findByRole("button", { name: "a" });
    fireEvent.click(taskButton);
    expect(taskButton.getAttribute("aria-expanded")).toBe("true");
    const readsBefore = groupReads;

    // Anything that takes the group region off the page counts, however briefly it was gone.
    let regionRemoved = 0;
    const observer = new MutationObserver((records) => {
      for (const record of records) for (const node of record.removedNodes) if (node === region || node.contains(region)) regionRemoved += 1;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // Three more polls.
    await waitFor(() => expect(incrementalReads).toBeGreaterThanOrEqual(3), { timeout: 9_000 });
    observer.disconnect();

    // The first answer still voids the (empty) cache and the next tick re-reads everything once; after that the page
    // only ever asks for what moved.
    expect(completeReads).toBeLessThanOrEqual(2);
    expect(completeAfterIncremental).toBe(0);
    expect(regionRemoved).toBe(0);
    expect(region.isConnected).toBe(true);
    expect(screen.getByRole("region", { name: "Control group g" })).toBe(region);
    expect(screen.getByRole("button", { name: "a" })).toBe(taskButton);
    expect(taskButton.getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByText(REFETCH)).toBeNull();
    // The group moved on every poll, so it was read again -- about once per poll, not once per arriving body.
    expect(groupReads - readsBefore).toBeGreaterThanOrEqual(2);
    expect(groupReads - readsBefore).toBeLessThanOrEqual(incrementalReads + 1);
  }, 15_000);

  it("does not re-read a body that is newer than the summary listing it", async () => {
    // Re-reading whenever the two differ (rather than when the body is older) turns every arriving body into the
    // trigger for the next GET while the body is ahead: a request every few milliseconds until the next poll.
    groupLead = 1;
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^g · running/ }));
    await screen.findByRole("region", { name: "Control group g" });
    await waitFor(() => expect(incrementalReads).toBeGreaterThanOrEqual(2), { timeout: 7_000 });
    expect(groupReads).toBeGreaterThanOrEqual(2);
    expect(groupReads).toBeLessThanOrEqual(incrementalReads + 2);
  }, 12_000);
});
