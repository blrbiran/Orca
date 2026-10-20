// @vitest-environment jsdom
/**
 * Agent version auto-refresh spec 2026-10-20 §3.3 (human ruling, session 308b874c: 「不用看版本号变化，静默更新就行」):
 * the Agents page shows the versions the installed CLIs answer now, not the ones the table recorded at the last
 * upgrade. So the page's first agents read is preceded by one version refresh (a CSRF-carrying POST: it spawns the
 * CLIs and writes the table), coming back to the page does not probe again (one probe per installation per load),
 * a refusal of the refresh never keeps the table from showing, and the owner can refresh again by hand.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { AccountContext } from "../src/AuthGate.js";
import type { Me } from "../src/auth.js";
import type { AgentPreferencesViewV1, AgentsViewV1, ControlConfigV1, ControlSummaryV1, RecoveryViewV1 } from "../src/controlTypes.js";

const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }], plans: [],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-09-26T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
const summary: ControlSummaryV1 = { schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq: 0, resetRequired: false, dispatchBlocked: false, groups: [] };
const recovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [] };
const agents: AgentsViewV1 = {
  schema: "orca-agents-view-v1",
  installations: [{ id: "codex", kind: "codex", defaults: { model: "gpt-6-sol", contextWindow: "agent-default" }, contextOptions: ["agent-default"], version: "0.155.1" }],
};
const preferences: AgentPreferencesViewV1 = { schema: "orca-agent-preferences-v1", operatorId: "operator-1", revision: 1, preferences: { defaultAgent: "codex", perAgent: {} } };
const owner: Me = { user: { id: "u1", name: "olga", roles: ["owner"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };
const modelsView = (...names: string[]): AgentModelsViewV1 => ({
  schema: "orca-agent-models-v1", installation: "codex", kind: "codex", source: "probe", observedAt: "2026-10-16T00:00:00.000Z",
  models: names.map((model) => ({ model, contextWindowTokens: 272000, maxOutputTokens: null, singleCallExecution: "v1-soft" })),
});
const REPORT = { as_of: "2026-09-26T00:00:00.000Z", as_of_mode: "wall_clock", repos: [], correction_rate: { numerator_corrections_excluding_stale: 0, denominator_decisions: 0, rate_excluding_stale: null, corrections_total_including_stale: 0, by_decision_kind: [], buckets: [], caveats: [] }, repair_rate: { numerator_overturned: 0, denominator_corrections_including_stale: 0, rate: null, stale_only: { numerator_overturned: 0, denominator_corrections: 0, rate: null, known_bias: "" }, buckets: [], caveats: [] }, backlog: { open_corrections: 0, oldest_age_ms: null, oldest_correction_id: null, by_correction_kind: [] }, breakdown_by_correction_kind_including_stale: [], review_coverage: { available: false, reason: "none" }, unresolved_decisions: [], unkeyable_repos: [], malformed_lines: [] };
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });


/** The agents and refresh requests in the order the page sent them. */
let sent: string[];
let refreshStatus: number;

beforeEach(() => {
  sent = [];
  refreshStatus = 200;
  let recorded = "0.155.1";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === "/api/todo") return json({ rows: [] });
    if (url === "/api/projects") return json({ projects: [{ projectKey: "orca", controlRepoId: "orca" }] });
    if (url === "/api/metrics") return json({ report: REPORT, panel_review_coverage: { reviewed_high_tier: 0, high_tier_total: 0, rate: 0, caveat: "" } });
    if (url === "/api/chains") return json({ repos: [] });
    if (url === "/api/control/config") return json(config);
    if (url.startsWith("/api/control/summary")) return json(summary);
    if (url === "/api/control/recovery") return json(recovery);
    if (url === "/api/control/repositories/orca/workspace") return json({ schema: "orca-repository-workspace-v1", repoId: "orca", workspaceMode: "worktree", revision: 0 });
    if (url === "/api/control/agents/refresh-versions") {
      sent.push(`${init?.method ?? "GET"} refresh ${new Headers(init?.headers).get("x-orca-csrf")}`);
      if (refreshStatus !== 200) return json({ error: { code: "owner-required", message: "An owner account is required." } }, refreshStatus);
      // The server recorded the installed CLI's version in the table.
      recorded = recorded === "0.155.1" ? "0.156.0" : "0.157.0";
      return json({ schema: "orca-agent-version-refresh-v1", rows: [{ id: "codex", recorded: "0.155.1", observed: recorded, outcome: "updated" }] });
    }
    if (url === "/api/control/agents") {
      sent.push("GET agents");
      return json({ ...agents, installations: agents.installations.map((row) => ({ ...row, version: recorded })) });
    }
    if (url === "/api/control/operator/agent-preferences") return json(preferences);
    return json({ error: { code: "not-found", message: url } }, 404);
  }) as typeof fetch;
});

afterEach(() => { cleanup(); window.sessionStorage.clear(); vi.restoreAllMocks(); document.cookie = "orca_csrf=; max-age=0"; });

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 100));

describe("the Agents page's version refresh (agent version auto-refresh spec §3.3)", () => {
  it("refreshes the versions before its first agents read, shows the new number, and does not probe again on return", async () => {
    document.cookie = "orca_csrf=token-1";
    render(<AccountContext.Provider value={owner}><App /></AccountContext.Provider>);
    await screen.findByText("0.156.0");
    expect(sent.slice(0, 2)).toEqual(["POST refresh token-1", "GET agents"]);
    fireEvent.focus(window);
    await waitFor(() => expect(sent.filter((entry) => entry === "GET agents").length).toBeGreaterThanOrEqual(2));
    await settle();
    expect(sent.filter((entry) => entry.includes("refresh"))).toHaveLength(1);
  });

  it("still shows the table when the refresh is refused", async () => {
    refreshStatus = 403;
    render(<App />);
    await screen.findByText("0.155.1");
    expect(sent.slice(0, 2)).toEqual(["POST refresh null", "GET agents"]);
  });

  it("refreshes again from the Refresh versions button and re-reads the table", async () => {
    render(<AccountContext.Provider value={owner}><App /></AccountContext.Provider>);
    await screen.findByText("0.156.0");
    fireEvent.click(await screen.findByRole("button", { name: "Refresh versions" }));
    await screen.findByText("0.157.0");
    expect(sent.filter((entry) => entry.includes("refresh"))).toHaveLength(2);
  });
});
