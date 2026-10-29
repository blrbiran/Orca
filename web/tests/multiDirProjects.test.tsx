// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { pickOption, shownText } from "./selectControl.js";
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
type Row = { projectKey: string; name: string } & Record<string, unknown>;
const FILE = (projects: Row[], extra: Record<string, unknown> = {}) => ({
  source: "file", editable: true, pendingRestart: [], fileError: null,
  projects: projects.map((p) => ({ path: `/r/${p.projectKey}`, controlRepoId: `${p.projectKey}-11111111`, ...p })), ...extra,
});
const row = { id: "d1", projectKey: "alpha", kind: "decision", scope: "local", status: "open", title: "One", summary: "Summary", decidedAt: "2026-09-21T00:00:00.000Z" };
const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const MULTI = { projectKey: "shop", name: "Shop", path: "/r/alpha", kind: "multi", controlRepoId: "shop-11111111", dirs: [{ projectKey: "alpha", kind: "repo" }, { projectKey: "beta", kind: "repo" }] };
const SINGLES: Row[] = [{ projectKey: "alpha", name: "Alpha" }, { projectKey: "beta", name: "Beta" }, { projectKey: "gamma", name: "Gamma" }];

let projectsAnswer: { status: number; body: unknown };
let projectsAfterAdd: unknown;
let projectsAfterPatch: unknown;
let addAnswer: { status: number; body: unknown };
let patchAnswer: { status: number; body: unknown };
let posts: Array<Record<string, unknown>>;
let patches: Array<{ id: string } & Record<string, unknown>>;

beforeEach(() => {
  projectsAnswer = { status: 200, body: FILE(SINGLES) };
  projectsAfterAdd = undefined; projectsAfterPatch = undefined;
  addAnswer = { status: 201, body: { project: MULTI } };
  patchAnswer = { status: 200, body: { project: MULTI } };
  posts = []; patches = [];
  window.localStorage.clear();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === "/api/todo") return jsonResponse({ rows: [row] });
    if (url === "/api/metrics") return jsonResponse(METRICS);
    if (url === "/api/chains") return jsonResponse({ repos: [] });
    if (url === "/api/memory/status") return jsonResponse({ adapter: { id: "ccmem", capabilities: { search: true, get: true, recordCorrection: false } }, health: { status: "ok" }, repos: [{ projectKey: "alpha" }] });
    if (url.startsWith("/api/memory/list")) return jsonResponse({ projectKey: "alpha", query: "", page: { records: [], total: 0, truncated: false } });
    if (url === "/api/projects" && init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      if (addAnswer.status < 300 && projectsAfterAdd !== undefined) projectsAnswer = { status: 200, body: projectsAfterAdd };
      return jsonResponse(addAnswer.body, addAnswer.status);
    }
    if (url.startsWith("/api/projects/") && init?.method === "PATCH") {
      const id = decodeURIComponent(url.slice("/api/projects/".length));
      patches.push({ id, ...(JSON.parse(String(init.body)) as Record<string, unknown>) });
      if (patchAnswer.status < 300 && projectsAfterPatch !== undefined) projectsAnswer = { status: 200, body: projectsAfterPatch };
      return jsonResponse(patchAnswer.body, patchAnswer.status);
    }
    if (url === "/api/projects") return jsonResponse(projectsAnswer.body, projectsAnswer.status);
    if (url === "/api/control/config") return jsonResponse(config);
    if (url.startsWith("/api/control/summary")) return jsonResponse(summary);
    if (url === "/api/control/recovery") return jsonResponse(recovery);
    if (url.startsWith("/api/control/")) return jsonResponse({ error: { code: "route-not-found", message: "not served here", commandRevision: null, evidenceIds: [], retryable: false } }, 404);
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;
});

afterEach(() => { cleanup(); window.sessionStorage.clear(); window.localStorage.clear(); });

const openCreate = async (): Promise<HTMLElement> => {
  fireEvent.click(await screen.findByRole("button", { name: "Group several projects" }));
  return screen.getByRole("form", { name: "Group several projects" });
};
// Ruling: human 「这次批准改写所有必要的判据」 (session b999cc81): the member is chosen in the "Project to add" picker by keyboard.
const choose = async (form: HTMLElement, name: string): Promise<void> => {
  await pickOption(within(form).getByRole("combobox", { name: "Project to add" }), name);
  fireEvent.click(within(form).getByRole("button", { name: "Add to group" }));
};

describe("grouping several projects", () => {
  it("D1: the form titles itself, hints at the primary, orders with up/down arrows and posts dirs", async () => {
    // Ruling: human 「这次批准改写所有必要的判据」 (session b999cc81): members are chosen in the "Project to add" picker, in the order the dirs post
    render(<App />);
    const form = await openCreate();
    expect(within(form).getByText("The first is the primary: it keeps the group's decisions.")).toBeTruthy();
    const save = within(form).getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await choose(form, "Beta");
    expect(save.disabled).toBe(true);
    await choose(form, "Alpha");
    expect(save.disabled).toBe(true);
    fireEvent.click(within(form).getByRole("button", { name: "Move up Alpha" }));
    fireEvent.change(within(form).getByRole("textbox", { name: "Name" }), { target: { value: "Shop" } });
    expect(save.disabled).toBe(false);
    projectsAfterAdd = FILE([...SINGLES, MULTI], { multiDirProjects: [{ id: "shop", name: "Shop", dirs: ["alpha", "beta"] }] });
    fireEvent.click(save);
    await waitFor(() => expect(posts).toEqual([{ name: "Shop", dirs: ["alpha", "beta"] }]));
    // Ruling: human 「这次批准改写所有必要的判据」 (session b999cc81): the new multi project becomes the sidebar's choice, shown with its member count
    await screen.findByRole("combobox", { name: "Project" });
    await waitFor(() => expect(shownText(screen.getByRole("combobox", { name: "Project" }))).toBe("Shop (2 projects)"));
  });

  it("D2: a multi row shows its member count; it can be renamed and its order edited", async () => {
    projectsAnswer = { status: 200, body: FILE([...SINGLES, MULTI], { multiDirProjects: [{ id: "shop", name: "Shop", dirs: ["alpha", "beta"] }] }) };
    render(<App />);
    // Ruling: human 「这次批准改写所有必要的判据」 (session b999cc81): the multi row is offered with its member count and chosen in the sidebar picker
    const select = await screen.findByRole("combobox", { name: "Project" });
    await pickOption(select, "Shop (2 projects)");
    expect(shownText(screen.getByRole("combobox", { name: "Project" }))).toBe("Shop (2 projects)");

    fireEvent.click(screen.getByRole("button", { name: "Rename project" }));
    const rename = screen.getByRole("form", { name: "Rename project" });
    const name = within(rename).getByRole("textbox", { name: "Name" }) as HTMLInputElement;
    expect(name.value).toBe("Shop");
    fireEvent.change(name, { target: { value: "Shop Two" } });
    patchAnswer = { status: 200, body: { project: { ...MULTI, name: "Shop Two" } } };
    projectsAfterPatch = FILE([...SINGLES, { ...MULTI, name: "Shop Two" }], { multiDirProjects: [{ id: "shop", name: "Shop Two", dirs: ["alpha", "beta"] }] });
    fireEvent.click(within(rename).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patches).toEqual([{ id: "shop", name: "Shop Two" }]));

    fireEvent.click(screen.getByRole("button", { name: "Edit order" }));
    const edit = screen.getByRole("form", { name: "Edit order" });
    expect(within(edit).getByRole("button", { name: "Move up Beta" })).toBeTruthy();
    expect(within(edit).getByRole("button", { name: "Move down Alpha" })).toBeTruthy();
    fireEvent.click(within(edit).getByRole("button", { name: "Move down Alpha" }));
    patchAnswer = { status: 200, body: { project: { ...MULTI, dirs: [{ projectKey: "beta", kind: "repo" }, { projectKey: "alpha", kind: "repo" }], path: "/r/beta" } } };
    projectsAfterPatch = FILE([...SINGLES, { ...MULTI, name: "Shop Two", path: "/r/beta", dirs: [{ projectKey: "beta", kind: "repo" }, { projectKey: "alpha", kind: "repo" }] }], { multiDirProjects: [{ id: "shop", name: "Shop Two", dirs: ["beta", "alpha"] }] });
    fireEvent.click(within(edit).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patches).toEqual([{ id: "shop", name: "Shop Two" }, { id: "shop", dirs: ["beta", "alpha"] }]));
  });

  it("D3: the downgrade notice is shown once, the first time a multi project is created", async () => {
    // Ruling: human 「这次批准改写所有必要的判据」 (session b999cc81): members are chosen in the "Project to add" picker, in the order the dirs post
    render(<App />);
    const first = await openCreate();
    expect(within(first).getByRole("note").textContent).toMatch(/older Orca/);
    await choose(first, "Alpha");
    await choose(first, "Beta");
    fireEvent.change(within(first).getByRole("textbox", { name: "Name" }), { target: { value: "Shop" } });
    projectsAfterAdd = FILE([...SINGLES, MULTI], { multiDirProjects: [{ id: "shop", name: "Shop", dirs: ["alpha", "beta"] }] });
    fireEvent.click(within(first).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(window.localStorage.getItem("orca.multiDirDowngradeNotice")).toBe("1"));
    const second = await openCreate();
    expect(within(second).queryByRole("note")).toBeNull();
  });

  it("D4: edit order keeps the existing switcher and rename working for single projects", async () => {
    render(<App />);
    await screen.findByRole("combobox", { name: "Project" });
    expect((screen.getByRole("button", { name: "Edit order" }) as HTMLButtonElement).disabled).toBe(true);
    // Ruling: human 「这次批准改写所有必要的判据」 (session b999cc81): the sidebar picker still shows and switches single projects
    const select = screen.getByRole("combobox", { name: "Project" });
    expect(shownText(select)).toBe("Alpha");
    await pickOption(select, "Beta");
    expect(shownText(screen.getByRole("combobox", { name: "Project" }))).toBe("Beta");
  });
});
