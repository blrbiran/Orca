// @vitest-environment jsdom
/**
 * Review finding (Task 10 round): the evidence links could never authenticate.
 *
 * The panel's `/api/control/*` routes take the token from the `x-orca-token`
 * header (src/panel/api.ts's middleware, injected into the page as
 * `window.__ORCA_TOKEN__`). A bare `<a href="/api/control/runs/x/evidence">`
 * sends no header, so every one of these links answered 401 -- an evidence
 * feature unreachable from the only page meant to reach it.
 *
 * The criteria drive the two call sites that had the dead link, so they go red
 * the moment the page stops sending the header or stops offering a download.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { RecoveryView } from "../src/RecoveryView.js";
import type { Amount, ControlConfigV1, EvidenceManifestV1, GroupViewV1, RecoveryViewV1 } from "../src/controlTypes.js";

const TOKEN = "token-injected-by-staticFiles";
const RUN = "run-a";

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const provenance = {
  tokens: { provenance: "human" as const, estimateId: null }, activeMs: { provenance: "human" as const, estimateId: null },
  attempts: { provenance: "human" as const, estimateId: null }, sessions: { provenance: "human" as const, estimateId: null },
};

const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a",
  repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{
    profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task"],
    contextTokenizer: null, workMaxOutputTokens: 1000,
    declared: { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null },
    observed: { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null },
    observedAt: "2026-09-21T00:00:00.000Z", probeFailureCode: null,
  }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" },
  executionPort: "configured",  // Task 4b fixture: these criteria are not about the port.
  errorCatalog: [{ code: "unauthorized", status: 401 }],
};

const view: GroupViewV1 = {
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 4, graphVersion: 1,
  summary: { groupId: "g", state: "running", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 1 },
  plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship web control", successConditions: ["panel serves"] },
  proposal: { state: "confirmed", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null }, profiles: {
    estimator: { profileId: "all", profileHash: "b".repeat(64) }, worker: { profileId: "all", profileHash: "b".repeat(64) },
    handoff: { profileId: "all", profileHash: "b".repeat(64) }, goalReview: { profileId: "all", profileHash: "b".repeat(64) } }, executionSnapshotHash: "c".repeat(64) },
  ledger: { groupLimit: amount(9_000_000), used: amount(1_000_000), committedRemaining: amount(3_000_000), explicitUnallocatedReserve: amount(5_000_000), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [{ ownerKind: "task", ownerId: "a", bucket: "work", state: "active", amount: amount(3_000_000), fieldProvenance: provenance }],
  // Seam B (human ruling 2026-09-24, named under ruling 88): targetVersion is one positive safe integer from plan to wire.
  workItems: [{ taskId: "a", status: "active", dependencyTaskIds: [], targetVersion: 1, configHash: "d".repeat(64), originalContractHash: "e".repeat(64), derivedContractHash: "f".repeat(64), currentRunId: RUN, pendingRunId: null, lineageRunIds: [RUN] }],
  estimates: [],
  runs: [{ runId: RUN, taskId: "a", estimateId: null, generation: 1, state: "running", phase: "work", claimOrdinal: 1, providerAttemptOrdinal: 1, profile: { profileId: "all", profileHash: "b".repeat(64) }, used: amount(1_000_000), remaining: amount(2_000_000), failureCode: null, evidenceIds: ["ev-1"] }],
  checkpoints: [], handoffRequests: [], stop: null,
  recoveryBlockers: [{ scope: "run", code: "attempt-outcome-unknown", runId: RUN, evidenceIds: ["ev-1"] }],
  recentCommandIds: [],
};

const recovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [] };

const manifest: EvidenceManifestV1 = {
  schema: "orca-run-evidence-v1", runId: RUN,
  entries: [{ evidenceId: "ev-1", kind: "usage", sha256: "9".repeat(64), byteLength: 12, downloadUrl: `/api/control/runs/${RUN}/evidence/ev-1` }],
};

/** What the page put on the wire, and what the browser was offered. */
let requests: Array<{ url: string; headers: Record<string, string> }>;
let downloads: string[];
let answer: { status: number; body: unknown };

beforeEach(() => {
  requests = [];
  downloads = [];
  answer = { status: 200, body: manifest };
  window.__ORCA_TOKEN__ = TOKEN;
  URL.createObjectURL = vi.fn(() => "blob:evidence-manifest");
  URL.revokeObjectURL = vi.fn();
  // jsdom does not navigate, so the download anchor's click is recorded instead.
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement): void {
    downloads.push(this.getAttribute("download") ?? "");
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[key.toLowerCase()] = value;
    requests.push({ url: String(input), headers });
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});

afterEach(async () => {
  cleanup();
  // The deferred revoke has to run while the stubs are still installed.
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.restoreAllMocks();
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
  Reflect.deleteProperty(window, "__ORCA_TOKEN__");
});

function groupViewProps(): Parameters<typeof ControlGroupView>[0] {
  return { view, config, uncertain: [], drafts: {}, onDraft: vi.fn(), onCommand: vi.fn() };
}

/** Clicks the evidence control and waits for the download it promises. */
async function clickEvidence(name: RegExp): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name }));
  await vi.waitFor(async () => expect(downloads).toEqual([`evidence-${RUN}.json`]));
}

describe("evidence links", () => {
  it("asks for a run's manifest with the panel token and offers the answer as a download", async () => {
    render(<ControlGroupView {...groupViewProps()} />);
    await clickEvidence(/^evidence$/);

    expect(requests[0]!.url).toBe(`/api/control/runs/${RUN}/evidence`);
    // Load-bearing: without the header the panel answers 401, which is the whole defect.
    expect(requests[0]!.headers["x-orca-token"]).toBe(TOKEN);
    expect(downloads).toEqual([`evidence-${RUN}.json`]);
  });

  it("names the refusal instead of offering a download when the panel refuses", async () => {
    answer = { status: 401, body: { error: { code: "unauthorized", message: "A valid panel token is required.", commandRevision: null, evidenceIds: [], retryable: false } } };
    render(<ControlGroupView {...groupViewProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /^evidence$/ }));
    await vi.waitFor(async () => expect(requests).toHaveLength(1));

    expect((await screen.findByRole("alert")).textContent).toContain("unauthorized");
    expect(downloads).toEqual([]);
  });

  it("asks the same way for a blocked run's evidence", async () => {
    render(<RecoveryView recovery={recovery} group={view} onCommand={vi.fn()} />);
    await clickEvidence(/evidence/i);
    expect(requests[0]!.headers["x-orca-token"]).toBe(TOKEN);
    expect(downloads).toEqual([`evidence-${RUN}.json`]);
  });
});
