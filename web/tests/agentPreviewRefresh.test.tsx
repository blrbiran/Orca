// @vitest-environment jsdom
/**
 * Wave 3 review I-3 (plan T15): the preview a confirm carries is the server's resolution at one moment. The
 * server re-resolves at confirm time, so when the installation table or ccloop's answer moved, the confirm is
 * refused with `agent-selection-changed` -- and a page that keeps offering the old hash could then never
 * confirm without a reload. `App` owns the reads, so these criteria drive `App` against a fake panel; the
 * last describe covers the rest of App's agent wiring (the preferences command and what it hands the view).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import type {
  AgentPreferencesViewV1, AgentSelectionPreviewV1, AgentsViewV1, Amount, ControlConfigV1, ControlSummaryV1, GroupViewV1, RecoveryViewV1,
} from "../src/controlTypes.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-09-26T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
const summary: ControlSummaryV1 = {
  schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq: 4, resetRequired: false, dispatchBlocked: false,
  groups: [{ groupId: "g", state: "draft", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 }],
};
const recovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [] };
const group: GroupViewV1 = {
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 4, summary: summary.groups[0]!, graphVersion: 1,
  plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship", successConditions: ["done"] },
  proposal: { state: "editable", proposalVersion: 3, planHash: "a".repeat(64), budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
  ledger: { groupLimit: amount(9_000_000), used: amount(0), committedRemaining: amount(0), explicitUnallocatedReserve: amount(9_000_000), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [],
  workItems: [{ taskId: "a", status: "draft", dependencyTaskIds: [], targetVersion: 1, configHash: null, originalContractHash: "e".repeat(64), derivedContractHash: null, currentRunId: null, pendingRunId: null, lineageRunIds: [] }],
  estimates: [], runs: [], checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
};
const agents: AgentsViewV1 = {
  schema: "orca-agents-view-v1",
  installations: [{ id: "claude", kind: "claude", defaults: { model: "claude-opus-5-5", contextWindow: "agent-default" }, contextOptions: ["agent-default", 1_000_000], version: "2.1.282" }],
};
const preferences: AgentPreferencesViewV1 = { schema: "orca-agent-preferences-v1", operatorId: "operator-1", revision: 1, preferences: { defaultAgent: "claude", perAgent: {} } };
const FIRST = "1".repeat(64);
const SECOND = "2".repeat(64);
const resolved = { kind: "resolved", frozen: {
  selection: { agent: "claude", model: "claude-opus-5-5", contextWindow: "agent-default" }, configHash: "e".repeat(64), timeoutMs: 1, killGraceMs: 1,
  capabilities: capability, partial: {}, provenance: { agent: "operator", model: "descriptor", contextWindow: "descriptor" },
} } as const;
const preview = (selectionsHash: string | null, unavailable = false): AgentSelectionPreviewV1 => ({
  schema: "orca-agent-selection-preview-v1", groupId: "g", proposalVersion: 3, groupOverrides: {}, taskOverrides: { a: null },
  slots: [
    { key: "reconcile", slot: "reconcile", taskId: null, outcome: resolved },
    { key: "task:a", slot: "worker", taskId: "a", outcome: unavailable ? { kind: "unavailable", code: "control-peer-exit" } : resolved },
  ],
  selectionsHash,
});
const PREVIEW_PATH = "/api/control/groups/g/agent-preview";
const CONFIRM_PATH = "/api/control/groups/g/confirm";

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const REPORT = { as_of: "2026-09-26T00:00:00.000Z", as_of_mode: "wall_clock", repos: [], correction_rate: { numerator_corrections_excluding_stale: 0, denominator_decisions: 0, rate_excluding_stale: null, corrections_total_including_stale: 0, by_decision_kind: [], buckets: [], caveats: [] }, repair_rate: { numerator_overturned: 0, denominator_corrections_including_stale: 0, rate: null, stale_only: { numerator_overturned: 0, denominator_corrections: 0, rate: null, known_bias: "" }, buckets: [], caveats: [] }, backlog: { open_corrections: 0, oldest_age_ms: null, oldest_correction_id: null, by_correction_kind: [] }, breakdown_by_correction_kind_including_stale: [], review_coverage: { available: false, reason: "none" }, unresolved_decisions: [], unkeyable_repos: [], malformed_lines: [] };

/** The answers the fake panel gives, in order, to the preview reads and to the confirms. */
let previewAnswers: Array<() => Response | Promise<Response>>;
let confirmAnswers: Array<() => Response>;
let previewReads: number;
let confirmedHashes: string[];
let preferenceReads: number;
let preferencePosts: unknown[];

beforeEach(() => {
  previewReads = 0;
  confirmedHashes = [];
  preferenceReads = 0;
  preferencePosts = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === "/api/todo") return json({ rows: [] });
    if (url === "/api/metrics") return json({ report: REPORT, panel_review_coverage: { reviewed_high_tier: 0, high_tier_total: 0, rate: 0, caveat: "" } });
    if (url === "/api/chains") return json({ repos: [] });
    if (url === "/api/control/config") return json(config);
    if (url.startsWith("/api/control/summary")) return json(summary);
    if (url === "/api/control/recovery") return json(recovery);
    if (url === "/api/control/repositories/orca/workspace") return json({ schema: "orca-repository-workspace-v1", repoId: "orca", workspaceMode: "worktree", revision: 0 });
    if (url === "/api/control/groups/g") return json(group);
    if (url === "/api/control/agents") return json(agents);
    if (url === "/api/control/operator/agent-preferences" && init?.method === "POST") {
      preferencePosts.push(JSON.parse(String(init.body)));
      return json({ error: { code: "revision-conflict", message: "stale", commandRevision: 2, evidenceIds: [], retryable: false } }, 409);
    }
    if (url === "/api/control/operator/agent-preferences") {
      preferenceReads += 1;
      // After a save the server is at the next revision (another tab may have saved, too).
      return json(preferenceReads === 1 ? preferences : { ...preferences, revision: 2 });
    }
    if (url === PREVIEW_PATH) {
      previewReads += 1;
      const answer = previewAnswers.shift();
      if (answer === undefined) throw new Error("a preview read nobody expected");
      return answer();
    }
    if (url === CONFIRM_PATH && init?.method === "POST") {
      confirmedHashes.push((JSON.parse(String(init.body)) as { payload: { selectionsHash: string } }).payload.selectionsHash);
      return confirmAnswers.shift()!();
    }
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  window.sessionStorage.clear();
});

const rereadButton = (): HTMLButtonElement => screen.getByRole("button", { name: "Re-read agent selections" }) as HTMLButtonElement;
/** Fake timers that still follow the wall clock, so testing-library's own waits keep working; `pass` jumps ahead. */
const pass = async (ms: number): Promise<void> => { await vi.advanceTimersByTimeAsync(ms); };
/** Real time for an answer the test just released to reach the page. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 100));
const confirmButton = (): HTMLButtonElement => screen.getByRole("button", { name: "Confirm budget" }) as HTMLButtonElement;

async function openGroup(): Promise<void> {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /^g · draft/ }));
  await screen.findByRole("button", { name: "Confirm budget" });
}

describe("App re-reads a group's agent preview when the one on screen can no longer be confirmed (wave 3 I-3)", () => {
  it("re-reads the preview once after a confirm refused with agent-selection-changed, and the next confirm carries the new hash", async () => {
    let release = (): void => {};
    const held = new Promise<Response>((resolve) => { release = () => resolve(json(preview(SECOND))); });
    previewAnswers = [() => json(preview(FIRST)), () => held];
    confirmAnswers = [
      () => json({ error: { code: "agent-selection-changed", message: "The agent selections changed since the preview.", commandRevision: 6, evidenceIds: [], retryable: false } }, 409),
      () => json({ error: { code: "revision-conflict", message: "stop here", commandRevision: 6, evidenceIds: [], retryable: false } }, 409),
    ];
    await openGroup();
    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    expect(previewReads).toBe(1);
    fireEvent.click(confirmButton());
    await waitFor(() => expect(previewReads).toBe(2));
    // While the new resolution is on its way, the refused one is gone: nothing can confirm on it again.
    expect(confirmButton().disabled).toBe(true);
    release();
    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    fireEvent.click(confirmButton());
    await waitFor(() => expect(confirmedHashes).toEqual([FIRST, SECOND]));
    expect(previewReads).toBe(2);
  });

  it("re-reads the preview after a read that did not conclude, and only then offers the confirm", async () => {
    previewAnswers = [() => json({ error: { code: "control-internal-error", message: "ccloop did not answer", commandRevision: null, evidenceIds: [], retryable: true } }, 500), () => json(preview(FIRST))];
    await openGroup();
    await waitFor(() => expect(previewReads).toBe(1));
    expect(confirmButton().disabled).toBe(true);
    await waitFor(() => expect(previewReads).toBe(2), { timeout: 5_000 });
    await waitFor(() => expect(confirmButton().disabled).toBe(false));
  }, 10_000);

  // Rewritten in T15 fix round 1 (controller ruling; this criterion was new in T15): an unavailable slot used to
  // be re-read every 2 s forever, and every read spawns ccloop. Now nothing re-reads it without the operator.
  it("does not re-read a preview in which a slot was unavailable for now until the operator asks, and then reads it once", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    previewAnswers = [() => json(preview(null, true)), () => json(preview(FIRST))];
    await openGroup();
    await screen.findByText(/unavailable for now/);
    expect(confirmButton().disabled).toBe(true);
    await pass(20_000);
    expect(previewReads).toBe(1);
    fireEvent.click(rereadButton());
    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    await pass(20_000);
    expect(previewReads).toBe(2);
  });

  it("retries a preview read that did not conclude exactly once, and then waits for the operator's Re-read", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const failed = () => json({ error: { code: "control-internal-error", message: "ccloop did not answer", commandRevision: null, evidenceIds: [], retryable: true } }, 500);
    previewAnswers = [failed, failed, () => json(preview(FIRST))];
    await openGroup();
    await waitFor(() => expect(previewReads).toBe(1));
    await pass(20_000);
    expect(previewReads).toBe(2);
    await pass(20_000);
    expect(previewReads).toBe(2);
    expect(confirmButton().disabled).toBe(true);
    fireEvent.click(rereadButton());
    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    expect(previewReads).toBe(3);
  });

  it("keeps the newer preview when the answer to an older read arrives after it", async () => {
    let release = (): void => {};
    const held = new Promise<Response>((resolve) => { release = () => resolve(json(preview(FIRST))); });
    previewAnswers = [() => held, () => json(preview(SECOND))];
    confirmAnswers = [() => json({ error: { code: "revision-conflict", message: "stop here", commandRevision: 6, evidenceIds: [], retryable: false } }, 409)];
    await openGroup();
    await waitFor(() => expect(previewReads).toBe(1));
    fireEvent.click(rereadButton());
    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    release();
    await settle();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(confirmedHashes).toEqual([SECOND]));
  });

  it("ignores a failure that answers an older read after a newer read concluded", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let fail = (): void => {};
    const held = new Promise<Response>((resolve) => { fail = () => resolve(json({ error: { code: "control-internal-error", message: "late", commandRevision: null, evidenceIds: [], retryable: true } }, 500)); });
    previewAnswers = [() => held, () => json(preview(SECOND))];
    await openGroup();
    await waitFor(() => expect(previewReads).toBe(1));
    fireEvent.click(rereadButton());
    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    fail();
    await settle();
    await pass(20_000);
    // Neither dropped nor retried: the late failure belongs to a read nobody is waiting for.
    expect(confirmButton().disabled).toBe(false);
    expect(previewReads).toBe(2);
  });
});

describe("App wires the operator's agent defaults (agent selection spec §6.8)", () => {
  it("saves the defaults as { preferences } under the revision read, reads them back, re-reads the open group's preview, and hands them to the proposal view", async () => {
    previewAnswers = [() => json(preview(FIRST)), () => json(preview(SECOND))];
    const { container } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^g · draft/ }));
    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    // The group worker layer names no agent, so its context offers what the operator's default (claude) can express.
    const options = [...container.querySelectorAll('select[name="g:agent:group:worker:context"] option')].map((option) => (option as HTMLOptionElement).value);
    expect(options).toEqual(["", "agent-default", "1000000"]);
    expect(previewReads).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Save agent preferences" }));
    // Review P5: the revision lives in the envelope only.
    await waitFor(() => expect(preferencePosts).toHaveLength(1));
    expect(preferencePosts[0]).toMatchObject({ expectedRevision: 1, payload: { preferences: { defaultAgent: "claude", perAgent: {} } } });
    expect(Object.keys((preferencePosts[0] as { payload: object }).payload)).toEqual(["preferences"]);
    await waitFor(() => expect(preferenceReads).toBe(2));
    // New preferences may resolve the group differently, so its preview is read again.
    await waitFor(() => expect(previewReads).toBe(2));
  });
});
