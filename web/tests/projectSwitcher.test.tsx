// @vitest-environment jsdom
/**
 * Project switcher spec (docs/superpowers/specs/2026-10-04-panel-project-switcher-design.md). One sidebar select
 * picks the project; Task control imports into that project's control repository with one of its own plans and
 * reads that repository's workspace mode, instead of always the first `--repo` and the first `--plan`. The choice is
 * this browser's, kept across a reload, and a page that cannot store it, or a panel with one project, behaves as
 * before.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { PROJECT_KEY } from "../src/project.js";
import type { ControlConfigV1, ControlSummaryV1, RecoveryViewV1 } from "../src/controlTypes.js";

// Fixtures copied from web/tests/controlPollSettles.test.tsx, with three repositories and their plans.
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a",
  repositories: [{ repoId: "alpha-11111111", displayName: "alpha" }, { repoId: "beta-22222222", displayName: "beta" }],
  plans: [
    { planId: "pa", repoId: "alpha-11111111", displayName: "Alpha plan" },
    { planId: "pb1", repoId: "beta-22222222", displayName: "Beta plan one" },
    { planId: "pb2", repoId: "beta-22222222", displayName: "Beta plan two" },
  ],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-09-29T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
const summary: ControlSummaryV1 = { schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq: 1, resetRequired: false, dispatchBlocked: false, groups: [] };
const recovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [] };
const METRICS = { report: { as_of: "2026-09-21T00:00:00.000Z", as_of_mode: "wall_clock", repos: [], correction_rate: { numerator_corrections_excluding_stale: 0, denominator_decisions: 0, rate_excluding_stale: null, corrections_total_including_stale: 0, by_decision_kind: [], buckets: [], caveats: [] }, repair_rate: { numerator_overturned: 0, denominator_corrections_including_stale: 0, rate: null, stale_only: { numerator_overturned: 0, denominator_corrections: 0, rate: null, known_bias: "" }, buckets: [], caveats: [] }, backlog: { open_corrections: 0, oldest_age_ms: null, oldest_correction_id: null, by_correction_kind: [] }, breakdown_by_correction_kind_including_stale: [], review_coverage: { available: false, reason: "none" }, unresolved_decisions: [], unkeyable_repos: [], malformed_lines: [] }, panel_review_coverage: { reviewed_high_tier: 0, high_tier_total: 0, rate: 0, caveat: "" } };
const PROJECTS = { projects: [
  { projectKey: "alpha", controlRepoId: "alpha-11111111" },
  { projectKey: "beta", controlRepoId: "beta-22222222" },
  // Discovered under --root, not given with --repo: the control plane does not hold it.
  { projectKey: "gamma", controlRepoId: null },
] };
const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let projectsAnswer: { status: number; body: unknown };
let imports: Array<{ repoId: string; planId: string }>;
let workspaceReads: string[];

beforeEach(() => {
  projectsAnswer = { status: 200, body: PROJECTS }; imports = []; workspaceReads = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === "/api/todo") return jsonResponse({ rows: [] });
    if (url === "/api/metrics") return jsonResponse(METRICS);
    if (url === "/api/chains") return jsonResponse({ repos: [] });
    if (url === "/api/projects") return jsonResponse(projectsAnswer.body, projectsAnswer.status);
    if (url === "/api/control/config") return jsonResponse(config);
    if (url.startsWith("/api/control/summary")) return jsonResponse(summary);
    if (url === "/api/control/recovery") return jsonResponse(recovery);
    const workspace = /^\/api\/control\/repositories\/([^/]+)\/workspace$/.exec(url);
    if (workspace) {
      workspaceReads.push(decodeURIComponent(workspace[1]!));
      return jsonResponse({ schema: "orca-repository-workspace-v1", repoId: decodeURIComponent(workspace[1]!), workspaceMode: "worktree", revision: 0 });
    }
    if (url === "/api/control/groups/import-plan" && init?.method === "POST") {
      const payload = (JSON.parse(String(init.body)) as { payload: { repoId: string; planId: string } }).payload;
      imports.push({ repoId: payload.repoId, planId: payload.planId });
      return jsonResponse({ error: { code: "route-not-found", message: "not served here", commandRevision: null, evidenceIds: [], retryable: false } }, 404);
    }
    if (url.startsWith("/api/control/")) return jsonResponse({ error: { code: "route-not-found", message: "not served here", commandRevision: null, evidenceIds: [], retryable: false } }, 404);
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;
});

afterEach(() => { cleanup(); window.sessionStorage.clear(); window.localStorage.clear(); vi.restoreAllMocks(); });

const projectSelect = (): HTMLSelectElement => screen.getByRole("combobox", { name: "Project" }) as HTMLSelectElement;
const importRegion = async (): Promise<HTMLElement> => screen.findByRole("region", { name: "Import plan" });

describe("the project switcher", () => {
  it("A: imports into the chosen project's repository with one of that repository's plans", async () => {
    render(<App />);
    await screen.findByRole("combobox", { name: "Project" });
    expect(projectSelect().value).toBe("alpha");
    fireEvent.click(within(await importRegion()).getByRole("button", { name: "Import plan" }));
    await waitFor(() => expect(imports).toHaveLength(1));
    expect(imports[0]).toEqual({ repoId: "alpha-11111111", planId: "pa" });

    fireEvent.change(projectSelect(), { target: { value: "beta" } });
    const region = await importRegion();
    const plan = within(region).getByRole("combobox", { name: "Plan" }) as HTMLSelectElement;
    expect(plan.value).toBe("pb1");
    fireEvent.change(plan, { target: { value: "pb2" } });
    fireEvent.click(within(region).getByRole("button", { name: "Import plan" }));
    await waitFor(() => expect(imports).toHaveLength(2));
    expect(imports[1]).toEqual({ repoId: "beta-22222222", planId: "pb2" });

    // Back to alpha and on to beta again: the plan is beta's first again, not the one chosen before.
    fireEvent.change(projectSelect(), { target: { value: "alpha" } });
    fireEvent.change(projectSelect(), { target: { value: "beta" } });
    expect((within(await importRegion()).getByRole("combobox", { name: "Plan" }) as HTMLSelectElement).value).toBe("pb1");
  });

  it("A2: says a project is not under task control instead of importing into another repository", async () => {
    render(<App />);
    await screen.findByRole("combobox", { name: "Project" });
    fireEvent.change(projectSelect(), { target: { value: "gamma" } });
    const region = await importRegion();
    expect(within(region).getByText(/not under task control/)).toBeTruthy();
    expect(within(region).queryByRole("button", { name: "Import plan" })).toBeNull();
  });

  it("B: reads the workspace mode of the chosen project's repository", async () => {
    render(<App />);
    await screen.findByRole("combobox", { name: "Project" });
    await waitFor(() => expect(workspaceReads).toContain("alpha-11111111"));
    fireEvent.change(projectSelect(), { target: { value: "beta" } });
    await waitFor(() => expect(workspaceReads.at(-1)).toBe("beta-22222222"));
  });

  it("D: keeps the choice across a reload, and falls back to the first project when the stored one is gone", async () => {
    const first = render(<App />);
    await screen.findByRole("combobox", { name: "Project" });
    fireEvent.change(projectSelect(), { target: { value: "beta" } });
    first.unmount();
    render(<App />);
    await waitFor(() => expect(projectSelect().value).toBe("beta"));
    cleanup();

    window.localStorage.setItem(PROJECT_KEY, "removed-since");
    render(<App />);
    await screen.findByRole("combobox", { name: "Project" });
    await waitFor(() => expect(projectSelect().value).toBe("alpha"));
  });

  it("D2: still renders and starts at the first project when the browser refuses storage", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    render(<App />);
    await screen.findByRole("combobox", { name: "Project" });
    expect(projectSelect().value).toBe("alpha");
    fireEvent.change(projectSelect(), { target: { value: "beta" } });
    expect(projectSelect().value).toBe("beta");
  });

  it("E: renders no project select when the panel has one project", async () => {
    projectsAnswer = { status: 200, body: { projects: [PROJECTS.projects[0]] } };
    render(<App />);
    await importRegion();
    await waitFor(() => expect(workspaceReads).toContain("alpha-11111111"));
    expect(screen.queryByRole("combobox", { name: "Project" })).toBeNull();
  });

  it("F: behaves as before when the project list cannot be read", async () => {
    projectsAnswer = { status: 500, body: { code: "boom", message: "boom" } };
    render(<App />);
    fireEvent.click(within(await importRegion()).getByRole("button", { name: "Import plan" }));
    await waitFor(() => expect(imports).toHaveLength(1));
    expect(imports[0]).toEqual({ repoId: "alpha-11111111", planId: "pa" });
    expect(screen.queryByRole("combobox", { name: "Project" })).toBeNull();
  });
});
