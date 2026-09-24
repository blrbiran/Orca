// @vitest-environment jsdom
/**
 * Review finding (Task 10 round): a command id the browser is waiting on must
 * survive a lookup that could not conclude.
 *
 * Spec §9.2 says an unresolved id is retained across a reload and looked up
 * again; spec §4.1 makes `404 command-result-not-found` the one answer that
 * means "nothing durable happened, issue it again under a new id". Every other
 * answer -- a lost connection, a 5xx, a 401 -- leaves the outcome unknown, and
 * forgetting the id there is the dangerous direction: the person re-issues with
 * a fresh id while the ledger may already hold the first intent, which is a
 * second execution rather than a retry.
 *
 * Each `it` names the production line whose removal reddens it.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { UNCERTAIN_COMMANDS_KEY } from "../src/controlApi.js";
import type { Amount, ControlConfigV1, GroupViewV1, ControlSummaryV1, RecoveryViewV1 } from "../src/controlTypes.js";

const GROUP = "g";
const COMMAND = "cmd-lost";

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const provenance = () => ({
  tokens: { provenance: "human" as const, estimateId: null }, activeMs: { provenance: "human" as const, estimateId: null },
  attempts: { provenance: "human" as const, estimateId: null }, sessions: { provenance: "human" as const, estimateId: null },
});

const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a",
  repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{
    profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"],
    contextTokenizer: null, workMaxOutputTokens: 1000,
    declared: { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null },
    observed: { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null },
    observedAt: "2026-09-21T00:00:00.000Z", probeFailureCode: null,
  }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" },
  executionPort: "configured",  // Task 4b fixture: these criteria are not about the port.
  errorCatalog: [{ code: "command-result-not-found", status: 404 }],
};

const summary: ControlSummaryV1 = {
  schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq: 4, resetRequired: false, dispatchBlocked: false,
  groups: [{ groupId: GROUP, state: "running", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 }],
};

const emptyRecovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [] };

const groupView: GroupViewV1 = {
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 4, summary: summary.groups[0]!, graphVersion: 1,
  plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship web control", successConditions: ["panel serves"] },
  proposal: { state: "confirmed", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null }, profiles: {
    estimator: { profileId: "all", profileHash: "b".repeat(64) }, worker: { profileId: "all", profileHash: "b".repeat(64) },
    handoff: { profileId: "all", profileHash: "b".repeat(64) }, goalReview: { profileId: "all", profileHash: "b".repeat(64) } }, executionSnapshotHash: "c".repeat(64) },
  ledger: { groupLimit: amount(9_000_000), used: amount(1_000_000), committedRemaining: amount(3_000_000), explicitUnallocatedReserve: amount(5_000_000), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [{ ownerKind: "task", ownerId: "a", bucket: "work", state: "active", amount: amount(3_000_000), fieldProvenance: provenance() }],
  // Seam B (human ruling 2026-09-24, named under ruling 88): targetVersion is one positive safe integer from plan to wire.
  workItems: [{ taskId: "a", status: "active", dependencyTaskIds: [], targetVersion: 1, configHash: "d".repeat(64), originalContractHash: "e".repeat(64), derivedContractHash: "f".repeat(64), currentRunId: "run-a", pendingRunId: null, lineageRunIds: ["run-a"] }],
  estimates: [],
  runs: [{ runId: "run-a", taskId: "a", estimateId: null, generation: 1, state: "running", phase: "work", claimOrdinal: 1, providerAttemptOrdinal: 1, profile: { profileId: "all", profileHash: "b".repeat(64) }, used: amount(1_000_000), remaining: amount(2_000_000), failureCode: null, evidenceIds: ["ev-1"] }],
  checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [COMMAND],
};

const LOOKUP_PATH = `/api/control/groups/${GROUP}/commands/${COMMAND}`;

/** Held open until the test releases it, so the pending state is observable. */
interface Gate {
  release: (response: Response) => void;
  released: Promise<Response>;
}

function gate(): Gate {
  let release = (_response: Response): void => {};
  const released = new Promise<Response>((resolve) => {
    release = resolve;
  });
  return { release: release as (response: Response) => void, released };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Every control lookup the page asked for, so a claim can be made about attempts, not hopes. */
let lookups: string[];
let lookupGate: Gate;

beforeEach(() => {
  lookups = [];
  lookupGate = gate();
  window.sessionStorage.setItem(UNCERTAIN_COMMANDS_KEY, JSON.stringify([{ groupId: GROUP, commandId: COMMAND }]));
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url === "/api/todo") return jsonResponse({ rows: [] });
    if (url === "/api/metrics") return jsonResponse({ report: { as_of: "2026-09-21T00:00:00.000Z", as_of_mode: "wall_clock", repos: [], correction_rate: { numerator_corrections_excluding_stale: 0, denominator_decisions: 0, rate_excluding_stale: null, corrections_total_including_stale: 0, by_decision_kind: [], buckets: [], caveats: [] }, repair_rate: { numerator_overturned: 0, denominator_corrections_including_stale: 0, rate: null, stale_only: { numerator_overturned: 0, denominator_corrections: 0, rate: null, known_bias: "" }, buckets: [], caveats: [] }, backlog: { open_corrections: 0, oldest_age_ms: null, oldest_correction_id: null, by_correction_kind: [] }, breakdown_by_correction_kind_including_stale: [], review_coverage: { available: false, reason: "none" }, unresolved_decisions: [], unkeyable_repos: [], malformed_lines: [] }, panel_review_coverage: { reviewed_high_tier: 0, high_tier_total: 0, rate: 0, caveat: "" } });
    if (url === "/api/chains") return jsonResponse({ repos: [] });
    if (url === "/api/control/config") return jsonResponse(config);
    if (url.startsWith("/api/control/summary")) return jsonResponse(summary);
    if (url === "/api/control/recovery") return jsonResponse(emptyRecovery);
    if (url === `/api/control/groups/${GROUP}`) return jsonResponse(groupView);
    if (url === LOOKUP_PATH) {
      lookups.push(url);
      return await lookupGate.released;
    }
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

/** The line ControlPanel shows while an id is unresolved, or null once it is gone. */
function pendingLine(): HTMLElement | null {
  return screen.queryByText(/Command outcome unknown, being looked up/);
}

/** The ids sessionStorage still holds the page waiting on. */
function storedIds(): string[] {
  const raw = window.sessionStorage.getItem(UNCERTAIN_COMMANDS_KEY);
  const parsed: unknown = raw === null ? [] : JSON.parse(raw);
  return Array.isArray(parsed) ? (parsed as { commandId: string }[]).map((entry) => entry.commandId) : [];
}

/** Renders App and waits until the lookup for the reloaded id has been attempted. */
async function renderWaitingOnReloadedCommand(): Promise<void> {
  render(<App />);
  await screen.findByText(/Command outcome unknown, being looked up/);
  await waitFor(() => expect(lookups).toEqual([LOOKUP_PATH]));
}

describe("App's recovery of an uncertain command", () => {
  it("keeps the id when the lookup itself could not conclude", async () => {
    render(<App />);
    await waitFor(() => expect(lookups).toEqual([LOOKUP_PATH]));
    lookupGate.release(new Response(null, { status: 503 }));

    // The refusal the failed lookup surfaced, which is also the point the page has
    // settled: asserting the id survives before this would pass on a race.
    await screen.findByText(/http-503/);
    // Load-bearing: the id must still be there for the next tick to look up
    // again. It goes red when App erases a command whose lookup could not conclude.
    expect(pendingLine()).not.toBeNull();
    expect(storedIds()).toEqual([COMMAND]);
  });

  it("drops the id only when the server says no result was ever retained", async () => {
    await renderWaitingOnReloadedCommand();
    lookupGate.release(jsonResponse({ error: { code: "command-result-not-found", message: "No retained command result was found.", commandRevision: 6, evidenceIds: [], retryable: false } }, 404));

    await waitFor(() => expect(pendingLine()).toBeNull());
    expect(storedIds()).toEqual([]);
  });

  it("drops the id when the lookup returns the command's retained result", async () => {
    await renderWaitingOnReloadedCommand();
    lookupGate.release(jsonResponse({ schema: "orca-command-lookup-v1", originalStatus: 202, body: {
      schema: "orca-command-success-v1", commandId: COMMAND, actorId: "human", verb: "start", target: { kind: "group", groupId: GROUP },
      commandRevision: 7, projectionSeq: 5, effectivePayloadHash: "1".repeat(64), authorityCommandHash: "2".repeat(64),
      result: { kind: "scheduled", operation: "start", wakeId: "wake-1" },
    } }));

    await waitFor(() => expect(pendingLine()).toBeNull());
    expect(storedIds()).toEqual([]);
  });
});
