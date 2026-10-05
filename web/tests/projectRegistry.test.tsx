// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import type { ControlConfigV1, ControlSummaryV1, RecoveryViewV1 } from "../src/controlTypes.js";

const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "alpha-11111111", displayName: "alpha" }], plans: [],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-09-29T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
const summary: ControlSummaryV1 = { schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq: 1, resetRequired: false, dispatchBlocked: false, groups: [] };
const recovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [] };
const METRICS = { report: { as_of: "2026-09-21T00:00:00.000Z", as_of_mode: "wall_clock", repos: [], correction_rate: { numerator_corrections_excluding_stale: 0, denominator_decisions: 0, rate_excluding_stale: null, corrections_total_including_stale: 0, by_decision_kind: [], buckets: [], caveats: [] }, repair_rate: { numerator_overturned: 0, denominator_corrections_including_stale: 0, rate: null, stale_only: { numerator_overturned: 0, denominator_corrections: 0, rate: null, known_bias: "" }, buckets: [], caveats: [] }, backlog: { open_corrections: 0, oldest_age_ms: null, oldest_correction_id: null, by_correction_kind: [] }, breakdown_by_correction_kind_including_stale: [], review_coverage: { available: false, reason: "none" }, unresolved_decisions: [], unkeyable_repos: [], malformed_lines: [] }, panel_review_coverage: { reviewed_high_tier: 0, high_tier_total: 0, rate: 0, caveat: "" } };
const FILE = (projects: Array<{ projectKey: string; name: string }>, extra: Record<string, unknown> = {}) => ({
  source: "file", editable: true, pendingRestart: [], fileError: null,
  projects: projects.map((p) => ({ ...p, path: `/r/${p.projectKey}`, controlRepoId: `${p.projectKey}-11111111` })), ...extra,
});
const row = { id: "d1", projectKey: "alpha", kind: "decision", scope: "local", status: "open", title: "One", summary: "Summary", decidedAt: "2026-09-21T00:00:00.000Z" };
const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let projectsAnswer: { status: number; body: unknown };
let projectsAfterAdd: unknown;
let projectsAfterRename: unknown;
let addAnswer: { status: number; body: unknown };
let renameAnswer: { status: number; body: unknown };
let projectReads: number;
let configReads: number;
let posts: Array<{ name: string; path: string }>;
let patches: Array<{ id: string; name: string }>;

beforeEach(() => {
  projectsAnswer = { status: 200, body: FILE([{ projectKey: "alpha", name: "Alpha" }]) };
  projectsAfterAdd = undefined; projectsAfterRename = undefined;
  addAnswer = { status: 201, body: { project: { projectKey: "beta-svc", name: "beta-svc" } } };
  renameAnswer = { status: 200, body: { project: { projectKey: "alpha", name: "Alpha Web" } } };
  projectReads = 0; configReads = 0; posts = []; patches = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === "/api/todo") return jsonResponse({ rows: [row] });
    if (url === "/api/metrics") return jsonResponse(METRICS);
    if (url === "/api/chains") return jsonResponse({ repos: [] });
    if (url === "/api/memory/status") return jsonResponse({ adapter: { id: "ccmem", capabilities: { search: true, get: true, recordCorrection: false } }, health: { status: "ok" }, repos: [{ projectKey: "alpha" }] });
    if (url.startsWith("/api/memory/list")) return jsonResponse({ projectKey: "alpha", query: "", page: { records: [], total: 0, truncated: false } });
    if (url === "/api/projects" && init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)) as { name: string; path: string });
      if (addAnswer.status < 300 && projectsAfterAdd !== undefined) projectsAnswer = { status: 200, body: projectsAfterAdd };
      return jsonResponse(addAnswer.body, addAnswer.status);
    }
    if (url.startsWith("/api/projects/") && init?.method === "PATCH") {
      const id = decodeURIComponent(url.slice("/api/projects/".length));
      patches.push({ id, ...(JSON.parse(String(init.body)) as { name: string }) });
      if (renameAnswer.status < 300 && projectsAfterRename !== undefined) projectsAnswer = { status: 200, body: projectsAfterRename };
      return jsonResponse(renameAnswer.body, renameAnswer.status);
    }
    if (url === "/api/projects") { projectReads += 1; return jsonResponse(projectsAnswer.body, projectsAnswer.status); }
    if (url === "/api/control/config") { configReads += 1; return jsonResponse(config); }
    if (url.startsWith("/api/control/summary")) return jsonResponse(summary);
    if (url === "/api/control/recovery") return jsonResponse(recovery);
    if (url.startsWith("/api/control/")) return jsonResponse({ error: { code: "route-not-found", message: "not served here", commandRevision: null, evidenceIds: [], retryable: false } }, 404);
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;
});

afterEach(() => { cleanup(); window.sessionStorage.clear(); window.localStorage.clear(); });

describe("project registry control", () => {
  it("P1: one project shows the control with its name; Add and Rename are offered", async () => {
    projectsAnswer = { status: 200, body: FILE([{ projectKey: "alpha", name: "Alpha App" }]) };
    render(<App />);
    const select = await screen.findByRole("combobox", { name: "Project" }) as HTMLSelectElement;
    expect(select.value).toBe("alpha");
    expect(within(select).getByRole("option", { name: "Alpha App" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add project" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rename project" })).toBeTruthy();
  });

  it("P2: zero projects says so and offers Add", async () => {
    projectsAnswer = { status: 200, body: FILE([]) };
    render(<App />);
    expect(await screen.findByText("No project yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add project" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Project" })).toBeNull();
  });

  it("P3: adding posts path and name, re-reads, and selects the new project", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Add project" }));
    const form = screen.getByRole("form", { name: "Add project" });
    fireEvent.change(within(form).getByRole("textbox", { name: "Path" }), { target: { value: "/r/beta-svc" } });
    addAnswer = { status: 201, body: { project: { projectKey: "beta-svc", name: "beta-svc", path: "/r/beta-svc", controlRepoId: "beta-svc-22222222" } } };
    projectsAfterAdd = FILE([{ projectKey: "alpha", name: "Alpha" }, { projectKey: "beta-svc", name: "beta-svc" }]);
    const configReadsBefore = configReads;
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts).toEqual([{ name: "beta-svc", path: "/r/beta-svc" }]));
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Project" }) as HTMLSelectElement).value).toBe("beta-svc"));
    expect(configReads).toBeGreaterThan(configReadsBefore);
  });

  it("P4: a refused add shows the refusal and keeps the form", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Add project" }));
    const form = screen.getByRole("form", { name: "Add project" });
    fireEvent.change(within(form).getByRole("textbox", { name: "Path" }), { target: { value: "/nope" } });
    addAnswer = { status: 422, body: { code: "project-path-missing", message: "/nope is not an existing directory" } };
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    expect(await within(form).findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("/nope is not an existing directory"));
  });

  it("P5: rename patches the current project and the new name shows, the selection unchanged", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Rename project" }));
    const form = screen.getByRole("form", { name: "Rename project" });
    const input = within(form).getByRole("textbox", { name: "Name" }) as HTMLInputElement;
    expect(input.value).toBe("Alpha");
    fireEvent.change(input, { target: { value: "Alpha Web" } });
    renameAnswer = { status: 200, body: { project: { projectKey: "alpha", name: "Alpha Web", path: "/r/alpha", controlRepoId: "alpha-11111111" } } };
    projectsAfterRename = FILE([{ projectKey: "alpha", name: "Alpha Web" }]);
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patches).toEqual([{ id: "alpha", name: "Alpha Web" }]));
    const select = await screen.findByRole("combobox", { name: "Project" }) as HTMLSelectElement;
    await waitFor(() => expect(within(select).getByRole("option", { name: "Alpha Web" })).toBeTruthy());
    expect(select.value).toBe("alpha");
  });

  it("P6: command-line projects disable Add and Rename and say why", async () => {
    projectsAnswer = { status: 200, body: { ...FILE([{ projectKey: "alpha", name: "alpha" }]), source: "command-line", editable: false } };
    render(<App />);
    const add = await screen.findByRole("button", { name: "Add project" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Rename project" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/come from the command line/)).toBeTruthy();
  });

  it("P7: the window regaining focus re-reads the project list", async () => {
    render(<App />);
    await screen.findByRole("combobox", { name: "Project" });
    const before = projectReads;
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(projectReads).toBe(before + 1));
  });

  it("P8: a file error is an alert; a pending removal warns that its groups cannot continue", async () => {
    projectsAnswer = { status: 200, body: FILE([{ projectKey: "alpha", name: "Alpha" }], { fileError: "not JSON: x", pendingRestart: ["removed:alpha"] }) };
    render(<App />);
    expect(await screen.findByText(/not JSON: x/)).toBeTruthy();
    expect(screen.getByText(/removed:alpha/)).toBeTruthy();
    expect(screen.getByText(/cannot continue/)).toBeTruthy();
  });

  it("P9: Decisions rows show the project's name", async () => {
    projectsAnswer = { status: 200, body: FILE([{ projectKey: "alpha", name: "Alpha App" }]) };
    window.location.hash = "#decisions";
    render(<App />);
    await waitFor(() => expect(document.querySelector(".field-projectKey")?.textContent).toBe("Alpha App"));
    window.location.hash = "";
  });
});
