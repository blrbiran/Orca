// @vitest-environment jsdom
/**
 * Spec 2026-10-15 §5 (R3, R4), Task 14 fix round 1 (review minors promoted, Orca session a852f96a, 2026-10-16): App owns
 * the model-list reads. Each read spawns ccloop, and the page re-reads the agents table whenever it comes back into view,
 * so (a) only the newest read of an installation may land -- an older answer arriving late never replaces a newer one;
 * (b) a background re-read never doubles a read already in flight, and never takes a list off the screen while it runs.
 * An owner's Refresh still forces a read. Driven against a fake panel whose model answers the test releases by hand.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { MODEL_READ_TIMEOUT_MS } from "../src/controlApi.js";
import { AccountContext } from "../src/AuthGate.js";
import type { Me } from "../src/auth.js";
import type { AgentModelsViewV1, AgentPreferencesViewV1, AgentsViewV1, ControlConfigV1, ControlSummaryV1, RecoveryViewV1 } from "../src/controlTypes.js";

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

/** Each models request, in the order the page sent it, held until the test answers it. */
let modelReads: Array<{ url: string; method: string; csrf: string | null; answer: (view: AgentModelsViewV1) => void }>;
let agentsReads: number;

beforeEach(() => {
  modelReads = [];
  agentsReads = 0;
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
    if (url === "/api/control/agents") { agentsReads += 1; return json(agents); }
    if (url === "/api/control/operator/agent-preferences") return json(preferences);
    if (url.startsWith("/api/control/agents/codex/models")) {
      const method = init?.method ?? "GET", csrf = new Headers(init?.headers).get("x-orca-csrf");
      return new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        modelReads.push({ url, method, csrf, answer: (view) => resolve(json(view)) });
      });
    }
    return json({ error: { code: "not-found", message: url } }, 404);
  }) as typeof fetch;
});

afterEach(() => { cleanup(); window.sessionStorage.clear(); vi.restoreAllMocks(); document.cookie = "orca_csrf=; max-age=0"; });

/** The model names the codex default's datalist offers now; null when no list is on screen. */
const listed = (): string[] | null => {
  const list = document.getElementById("agents:per:codex:models");
  return list === null ? null : [...list.querySelectorAll("option")].map((option) => option.value);
};
/** Real time for released answers (and the renders they cause) to reach the page. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 100));

describe("App's model-list reads (spec 2026-10-15 §5, Task 14 fix round 1)", () => {
  it("keeps the newest read's list when an older read answers after it", async () => {
    document.cookie = "orca_csrf=token-1";
    render(<AccountContext.Provider value={owner}><App /></AccountContext.Provider>);
    await waitFor(() => expect(modelReads).toHaveLength(1));
    // An owner's Refresh forces a read although the first is still in flight. (Every codex fieldset on the page -- the
    // default and the role slots that inherit it -- offers the button; they all refresh the same installation.)
    fireEvent.click((await screen.findAllByRole("button", { name: "Refresh models" }))[0]!);
    // Session 4de777f4 (human go-ahead on the deferred CSRF minor): a refresh is a POST that carries the CSRF header.
    await waitFor(() => expect(modelReads.map((read) => [read.method, read.url, read.csrf])).toEqual([
      ["GET", "/api/control/agents/codex/models", null], ["POST", "/api/control/agents/codex/models/refresh", "token-1"]]));
    modelReads[1]!.answer(modelsView("gpt-6-new"));
    await waitFor(() => expect(listed()).toEqual(["gpt-6-new"]));
    modelReads[0]!.answer(modelsView("gpt-6-old"));
    await settle();
    expect(listed()).toEqual(["gpt-6-new"]);
  });

  it("starts one background read per installation for two returns in a row", async () => {
    render(<App />);
    await waitFor(() => expect(modelReads).toHaveLength(1));
    modelReads[0]!.answer(modelsView("gpt-6-sol"));
    await waitFor(() => expect(listed()).toEqual(["gpt-6-sol"]));
    const before = agentsReads;
    fireEvent.focus(window);
    fireEvent.focus(window);
    await waitFor(() => expect(agentsReads).toBe(before + 2));
    await settle();
    expect(modelReads).toHaveLength(2);
  });

  it("keeps a read list on screen while a background re-read is pending", async () => {
    render(<App />);
    await waitFor(() => expect(modelReads).toHaveLength(1));
    modelReads[0]!.answer(modelsView("gpt-6-sol"));
    await waitFor(() => expect(listed()).toEqual(["gpt-6-sol"]));
    fireEvent.focus(window);
    await waitFor(() => expect(modelReads).toHaveLength(2));
    await settle();
    expect(listed()).toEqual(["gpt-6-sol"]);
    expect(screen.queryByText("Reading the model list…")).toBe(null);
    modelReads[1]!.answer(modelsView("gpt-6-sol", "gpt-6-luna"));
    await waitFor(() => expect(listed()).toEqual(["gpt-6-sol", "gpt-6-luna"]));
  });

  // Session 4de777f4 (deferred minor, human go-ahead): a read that never answers used to keep the in-flight mark set,
  // so every background re-read was skipped until an owner's Refresh. Each read is bounded; past the bound it fails,
  // the list shows as unavailable and the next background read goes out.
  it("releases a read that never answers at its bound, so the next background read goes out", async () => {
    const bounds: number[] = [];
    const fired: AbortController[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => { bounds.push(ms); const c = new AbortController(); fired.push(c); return c.signal; });
    render(<App />);
    await waitFor(() => expect(modelReads).toHaveLength(1));
    expect(bounds).toEqual([MODEL_READ_TIMEOUT_MS]);
    fireEvent.focus(window);
    await settle();
    expect(modelReads).toHaveLength(1);
    fired[0]!.abort(new DOMException("timed out", "TimeoutError"));
    await waitFor(() => expect(screen.getAllByText(/model list/i).length).toBeGreaterThan(0));
    fireEvent.focus(window);
    await waitFor(() => expect(modelReads).toHaveLength(2));
  });
});
