// @vitest-environment jsdom
/** Task 3: settings must keep the actual browser/operator/repository scopes. Fetch is the boundary only. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAN } from "./fixtures/board.js";
import { App } from "../src/App.js";
import { ALL_PROJECTS } from "../src/projectScope.js";
import { ALPHA, BETA, installFakePanel, groupSummary, planGroupView } from "./fixtures/twoProjects.js";
import type { FakePanel } from "./fixtures/twoProjects.js";
import type { AgentPreferencesViewV1 } from "../src/controlTypes.js";

const json = (body: unknown): Response => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
let panel: FakePanel;
let prefs: AgentPreferencesViewV1;
let preferenceCsrf: string | null;
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); window.location.hash = "global-settings";
  localStorage.setItem("orca.panel.agentsOpen", "1");
  document.cookie = "orca_csrf=settings-token";
  panel = installFakePanel(); preferenceCsrf = null;
  prefs = { schema: "orca-agent-preferences-v1", operatorId: "shared-panel-operator", revision: 7, preferences: { defaultAgent: "claude", perAgent: {} } };
  const fetchPanel = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url === "/api/control/operator/agent-preferences" && init?.method === "POST") preferenceCsrf = new Headers(init.headers).get("x-orca-csrf");
    if (init?.method !== "POST" && url === "/api/control/operator/agent-preferences") return json(prefs);
    if (url === "/api/control/agents") return json({ schema: "orca-agents-view-v1", installations: [{ id: "claude", kind: "claude", defaults: { model: "fixture-model", contextWindow: "agent-default" }, contextOptions: ["agent-default"], version: "fixture" }] });
    const integration = /^\/api\/control\/repositories\/([^/]+)\/integration$/.exec(url);
    if (integration && init?.method !== "POST") return json({ schema: "orca-repository-integration-v1", repoId: integration[1], revision: integration[1] === BETA ? 9 : 3, integration: { delivery: "keep" }, suggestedTarget: "main" });
    return fetchPanel(input, init);
  }) as typeof fetch;
});
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); sessionStorage.clear(); window.location.hash = ""; });
const project = (): HTMLSelectElement => screen.getByRole("combobox", { name: "Project" }) as HTMLSelectElement;
const globalRegion = (): HTMLElement => screen.getByRole("region", { name: "Global settings" });
const projectRegion = (): HTMLElement => screen.getByRole("region", { name: "Project settings" });
const settingsPick = (): HTMLSelectElement => screen.getByRole("combobox", { name: "Settings for project" }) as HTMLSelectElement;
async function open(section: string): Promise<void> { await act(async () => { window.location.hash = section; window.dispatchEvent(new Event("hashchange")); }); }

describe("settings scopes", () => {
  it("offers separate deep links with browser controls and shared Agent defaults only in global settings; import stays in Tasks", async () => {
    render(<App />);
    // Rewritten for ruling H6(b): one Settings page whose categories are the deep links; the old hash still opens it. Ruling: human approved rewriting all necessary criteria, Orca session 7753e97d, 2026-10-27
    await screen.findByRole("link", { name: "Settings" });
    const categories = screen.getByRole("navigation", { name: "Settings categories" });
    expect(within(categories).getByRole("link", { name: "This project" }).getAttribute("href")).toBe("#settings/project");
    expect(within(categories).getByRole("link", { name: "Appearance" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("aria-current")).toBe("page");
    expect(window.location.hash).toBe("#global-settings");
    await waitFor(() => expect(globalRegion().textContent).toContain("shared-panel-operator"));
    expect(within(globalRegion()).getByRole("combobox", { name: "Theme" })).toBeTruthy();
    expect(within(globalRegion()).getByRole("combobox", { name: "Language" })).toBeTruthy();
    expect(globalRegion().textContent).toContain("shared panel operator");
    expect(within(globalRegion()).queryByRole("region", { name: "Workspace mode" })).toBeNull();
    expect(within(globalRegion()).queryByRole("region", { name: "Integration" })).toBeNull();
    expect(screen.getByRole("navigation", { name: "Sections" }).querySelector('select[name="theme"]')).toBeNull();
    expect(project().value).toBe("alpha");
    const task = screen.getByRole("region", { name: "Task control" });
    expect(within(task).getByRole("button", { name: "Import plan" })).toBeTruthy();
    expect(within(task).queryByRole("button", { name: "Save agent preferences" })).toBeNull();
    expect(within(task).queryByRole("region", { name: "Workspace mode" })).toBeNull();
  });

  it("saves shared defaults with the read revision then displays the returned operator identity/revision without changing project", async () => {
    panel.onPost = async () => { prefs = { ...prefs, operatorId: "returned-panel-operator", revision: 8 }; return json({ schema: "orca-command-success-v1", commandRevision: 8 }); };
    render(<App />);
    await waitFor(() => expect(globalRegion().textContent).toContain("shared-panel-operator"));
    fireEvent.click(within(globalRegion()).getByRole("button", { name: "Save agent preferences" }));
    await waitFor(() => expect(globalRegion().textContent).toContain("returned-panel-operator"));
    expect(globalRegion().textContent).toContain("preferences revision 8");
    expect(panel.posts).toEqual([{ url: "/api/control/operator/agent-preferences", body: { commandId: expect.any(String), expectedRevision: 7, payload: { preferences: { defaultAgent: "claude", perAgent: {} } } } }]);
    expect(project().value).toBe("alpha");
    expect(preferenceCsrf).toBe("settings-token");
  });

  it("requires deliberate concrete selection after All and after an unresolved registry, never the prior repository", async () => {
    render(<App />);
    await screen.findByRole("combobox", { name: "Project" });
    await waitFor(() => expect(projectRegion().textContent).toContain(ALPHA));
    fireEvent.change(project(), { target: { value: ALL_PROJECTS } });
    await open("project-settings");
    // Ruling: human 「这次批准改写所有必要的判据」, Orca session 3cd8fb02, 2026-10-28 -- tester #69: the old "choose in the project picker" sentence is gone; under All the page's own select asks for a project.
    expect(settingsPick().value).toBe("");
    expect(projectRegion().textContent).not.toContain(ALPHA);
    expect(within(projectRegion()).queryByRole("radio")).toBeNull();
    expect(within(projectRegion()).queryByRole("button", { name: "Save integration" })).toBeNull();
    panel.projects = { status: 503, body: { code: "projects-unavailable" } };
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    // Ruling: human 「这次批准改写所有必要的判据」, Orca session 3cd8fb02, 2026-10-28 -- tester #69: an unread project list shows no project's settings and no select (was the old sentence).
    await waitFor(() => expect(screen.queryByRole("combobox", { name: "Settings for project" })).toBeNull());
    expect(projectRegion().textContent).not.toContain(ALPHA);
    expect(within(projectRegion()).queryByRole("radio")).toBeNull();
    expect(panel.posts).toEqual([]);
  });

  // Tester #69 (spec §24, session 3cd8fb02): "This project" had no way to pick a project, and under All projects said only
  // "choose in the project picker". Its own select is bound to the panel's one project scope: it shows the sidebar's
  // choice, a pick there switches every page, and under All it reads "Choose a project" with the settings hidden.
  it("picks the project on the page itself, bound to the sidebar's scope, and asks for one under All", async () => {
    render(<App />);
    await open("settings/project");
    await waitFor(() => expect(projectRegion().textContent).toContain(ALPHA));
    // mutation: drop the picker -> not found, red
    expect(settingsPick().value).toBe("alpha");
    expect([...settingsPick().options].map((o) => o.value)).toEqual(["alpha", "beta"]);
    expect(document.querySelector('[data-category="project"]')!.textContent).toContain("Changing it changes the project for every page.");
    // mutation: keep a page-local selection instead of the panel's scope -> the sidebar stays on alpha, red
    fireEvent.change(settingsPick(), { target: { value: "beta" } });
    await waitFor(() => expect(projectRegion().textContent).toContain(BETA));
    expect(project().value).toBe("beta");
    // The sidebar's All empties it: "Choose a project", the settings hidden, no old sentence.
    fireEvent.change(project(), { target: { value: ALL_PROJECTS } });
    await waitFor(() => expect(settingsPick().value).toBe(""));
    expect(settingsPick().selectedOptions[0]!.textContent).toBe("Choose a project");
    expect(within(projectRegion()).queryByRole("radio")).toBeNull();
    expect(projectRegion().textContent).not.toContain(BETA);
    expect(document.body.textContent).not.toContain("project picker");
    // A pick from the settings page leaves All for that project everywhere.
    fireEvent.change(settingsPick(), { target: { value: "alpha" } });
    await waitFor(() => expect(projectRegion().textContent).toContain(ALPHA));
    expect(project().value).toBe("alpha");
  });

  it("keeps preparation unresolved and a failed concrete registry from exposing prior settings", async () => {
    let release!: () => void;
    panel.holdProjects = new Promise<void>(resolve => { release = resolve; });
    render(<App />);
    // Ruling: human 「这次批准改写所有必要的判据」, Orca session 3cd8fb02, 2026-10-28 -- tester #69: while the list is unread no project is shown (was the old sentence).
    expect(projectRegion().textContent).not.toContain(ALPHA);
    expect(within(projectRegion()).queryByRole("radio")).toBeNull();
    await act(async () => { release(); });
    await waitFor(() => expect(projectRegion().textContent).toContain(ALPHA));
    panel.projects = { status: 503, body: { code: "projects-unavailable" } };
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    // Ruling: human 「这次批准改写所有必要的判据」, Orca session 3cd8fb02, 2026-10-28 -- tester #69: a failed list hides the prior project's settings (was the old sentence).
    await waitFor(() => expect(projectRegion().textContent).not.toContain(ALPHA));
    expect(within(projectRegion()).queryByRole("radio")).toBeNull();
    expect(within(projectRegion()).queryByRole("button", { name: "Save integration" })).toBeNull();
    expect(panel.posts).toEqual([]);
  });

  it("shows refused default changes in their current settings surface", async () => {
    panel.onPost = async () => new Response(JSON.stringify({ error: { code: "revision-conflict", message: "settings moved", commandRevision: 8, evidenceIds: [], retryable: false } }), { status: 409, headers: { "content-type": "application/json" } });
    render(<App />);
    await waitFor(() => expect(globalRegion().textContent).toContain("shared-panel-operator"));
    fireEvent.click(within(globalRegion()).getByRole("button", { name: "Save agent preferences" }));
    await waitFor(() => expect(within(globalRegion()).getByRole("alert").textContent).toContain("revision-conflict"));
    await open("project-settings");
    expect(within(projectRegion()).queryByRole("alert")).toBeNull();
    fireEvent.click(within(projectRegion()).getByRole("button", { name: "Save integration" }));
    await waitFor(() => expect(within(projectRegion()).getByRole("alert").textContent).toContain("revision-conflict"));
    fireEvent.click(within(projectRegion()).getByRole("radio", { name: "private clone" }));
    await waitFor(() => expect(panel.posts).toHaveLength(3));
    expect(within(projectRegion()).getByRole("alert").textContent).toContain("revision-conflict");
    expect(panel.posts.map(p => p.url)).toEqual(["/api/control/operator/agent-preferences", `/api/control/repositories/${ALPHA}/integration`, `/api/control/repositories/${ALPHA}/workspace-mode`]);
  });

  it("keeps late repository refusals with their target and a later success clears only that target", async () => {
    let answer!: (r: Response) => void;
    panel.onPost = async () => new Promise(resolve => { answer = resolve; });
    render(<App />);
    await open("project-settings");
    await waitFor(() => expect(projectRegion().textContent).toContain(ALPHA));
    fireEvent.click(within(projectRegion()).getByRole("button", { name: "Save integration" }));
    fireEvent.change(project(), { target: { value: "beta" } });
    await waitFor(() => expect(projectRegion().textContent).toContain(BETA));
    await act(async () => { answer(new Response(JSON.stringify({ error: { code: "revision-conflict", message: "alpha moved", commandRevision: 8, evidenceIds: [], retryable: false } }), { status: 409, headers: { "content-type": "application/json" } })); });
    expect(within(projectRegion()).queryByRole("alert")).toBeNull();
    fireEvent.change(project(), { target: { value: "alpha" } });
    await waitFor(() => expect(within(projectRegion()).getByRole("alert").textContent).toContain("revision-conflict"));
    panel.onPost = async () => json({ schema: "orca-command-success-v1", commandRevision: 9 });
    fireEvent.click(within(projectRegion()).getByRole("button", { name: "Save integration" }));
    await waitFor(() => expect(within(projectRegion()).queryByRole("alert")).toBeNull());
  });

  it("does not replace the newest settings answer with an earlier refusal", async () => {
    let answer!: (r: Response) => void;
    panel.onPost = async () => new Promise(resolve => { answer = resolve; });
    render(<App />);
    await waitFor(() => expect(globalRegion().textContent).toContain("shared-panel-operator"));
    fireEvent.click(within(globalRegion()).getByRole("button", { name: "Save agent preferences" }));
    panel.onPost = async () => json({ schema: "orca-command-success-v1", commandRevision: 8 });
    fireEvent.click(within(globalRegion()).getByRole("button", { name: "Save agent preferences" }));
    await waitFor(() => expect(panel.posts).toHaveLength(2));
    await act(async () => { answer(new Response(JSON.stringify({ error: { code: "revision-conflict", message: "old", commandRevision: 8, evidenceIds: [], retryable: false } }), { status: 409, headers: { "content-type": "application/json" } })); });
    expect(within(globalRegion()).queryByRole("alert")).toBeNull();
  });

  it("hides cached settings errors and rejects pending replies across control epochs", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    panel.onPost = async () => new Response(JSON.stringify({ error: { code: "revision-conflict", message: "old", commandRevision: 8, evidenceIds: [], retryable: false } }), { status: 409, headers: { "content-type": "application/json" } });
    render(<App />);
    await waitFor(() => expect(globalRegion().textContent).toContain("shared-panel-operator"));
    fireEvent.click(within(globalRegion()).getByRole("button", { name: "Save agent preferences" }));
    await waitFor(() => expect(within(globalRegion()).getByRole("alert").textContent).toContain("revision-conflict"));
    panel.summary = { ...panel.summary, epoch: "epoch-b", changeSeq: 2 }; panel.recovery = { ...panel.recovery, epoch: "epoch-b" };
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(within(globalRegion()).queryByRole("alert")).toBeNull();
    let answer!: (r: Response) => void;
    panel.onPost = async () => new Promise(resolve => { answer = resolve; });
    fireEvent.click(within(globalRegion()).getByRole("button", { name: "Save agent preferences" }));
    panel.summary = { ...panel.summary, epoch: "epoch-c", changeSeq: 3 }; panel.recovery = { ...panel.recovery, epoch: "epoch-c" };
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    await act(async () => { answer(new Response(JSON.stringify({ error: { code: "revision-conflict", message: "old", commandRevision: 8, evidenceIds: [], retryable: false } }), { status: 409, headers: { "content-type": "application/json" } })); });
    expect(within(globalRegion()).queryByRole("alert")).toBeNull();
  });

  it("shows an unknown settings outcome and clears it after the next known save without inventing a lookup", async () => {
    panel.onPost = async () => { throw new Error("lost settings answer"); };
    render(<App />);
    await waitFor(() => expect(globalRegion().textContent).toContain("shared-panel-operator"));
    fireEvent.click(within(globalRegion()).getByRole("button", { name: "Save agent preferences" }));
    await waitFor(() => expect(within(globalRegion()).getByRole("alert").textContent).toContain("http-unreachable"));
    expect(panel.requests.filter(r => r.includes("/commands/"))).toEqual([]);
    panel.onPost = async () => json({ schema: "orca-command-success-v1", commandRevision: 8 });
    fireEvent.click(within(globalRegion()).getByRole("button", { name: "Save agent preferences" }));
    await waitFor(() => expect(within(globalRegion()).queryByRole("alert")).toBeNull());
  });

  it("keeps unread defaults explicit and never exposes a save without their server reads", async () => {
    const fetchPanel = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url === "/api/control/agents" || /\/repositories\/[^/]+\/(workspace|integration)$/.test(url)) return new Response(JSON.stringify({ error: { code: "read-unavailable", message: "not read" } }), { status: 403 });
      return fetchPanel(input, init);
    }) as typeof fetch;
    render(<App />); await screen.findByRole("combobox", { name: "Project" });
    expect(globalRegion().textContent).toContain("Agent defaults have not been read");
    expect(within(globalRegion()).queryByRole("button", { name: "Save agent preferences" })).toBeNull();
    expect(projectRegion().textContent).toContain("Workspace settings have not been read");
    expect(projectRegion().textContent).toContain("Integration settings have not been read");
    expect(within(projectRegion()).queryByRole("radio")).toBeNull();
    expect(within(projectRegion()).queryByRole("button", { name: "Save integration" })).toBeNull();
    expect(panel.posts).toEqual([]);
  });

  it("saves workspace and integration only for the selected repository and its revisions", async () => {
    render(<App />);
    await screen.findByRole("combobox", { name: "Project" });
    fireEvent.change(project(), { target: { value: "beta" } });
    await open("project-settings");
    await waitFor(() => expect(projectRegion().textContent).toContain(BETA));
    fireEvent.click(within(projectRegion()).getByRole("radio", { name: "private clone" }));
    fireEvent.click(within(projectRegion()).getByRole("button", { name: "Save integration" }));
    await waitFor(() => expect(panel.posts).toHaveLength(2));
    expect(panel.posts).toEqual([
      { url: `/api/control/repositories/${BETA}/workspace-mode`, body: { commandId: expect.any(String), expectedRevision: 0, payload: { workspaceMode: "clone" } } },
      { url: `/api/control/repositories/${BETA}/integration`, body: { commandId: expect.any(String), expectedRevision: 9, payload: { integration: { delivery: "keep" } } } },
    ]);
  });

  it("default saves preserve the open confirmed group's frozen agents, skills, integration and config", async () => {
    const group = planGroupView(groupSummary("frozen", ALPHA));
    group.workItems = [{ taskId: "a", status: "ready", agent: { agent: "claude", model: "frozen-model", contextWindow: "agent-default" }, agentProvenance: { agent: "operator", model: "operator", contextWindow: "descriptor" }, loopPlan: { ...PLAN, skills: { profile: "frozen-profile" }, frozenSkillNames: ["frozen-skill"] }, dependencyTaskIds: [], targetVersion: 1, configHash: "d".repeat(64), originalContractHash: "e".repeat(64), derivedContractHash: "f".repeat(64), currentRunId: null, pendingRunId: null, lineageRunIds: [] }];
    group.integration = { scheme: { delivery: "local", trigger: "group", method: "merge", target: "frozen-target" }, schemeHash: "c".repeat(64), frozen: true, state: "idle", reason: null, lastIntegrated: null, integratedCommit: null, pr: null };
    panel.summary = { ...panel.summary, groups: [group.summary] }; panel.groupViews.frozen = group;
    render(<App />);
    await screen.findByRole("button", { name: /frozen/ });
    fireEvent.click(screen.getByRole("button", { name: /frozen/ }));
    await screen.findByRole("region", { name: "Control group frozen" });
    fireEvent.click(within(screen.getByRole("region", { name: "Control group frozen" })).getByRole("button", { name: "a" }));
    const before = screen.getByRole("region", { name: "Control group frozen" }).textContent;
    await open("global-settings");
    await waitFor(() => expect(globalRegion().textContent).toContain("shared-panel-operator"));
    fireEvent.change(globalRegion().querySelector('input[name="agents:per:claude:model"]')!, { target: { value: "new-default-model" } });
    fireEvent.click(within(globalRegion()).getByRole("button", { name: "Save agent preferences" }));
    await waitFor(() => expect(panel.posts).toHaveLength(1));
    await open("tasks");
    const after = screen.getByRole("region", { name: "Control group frozen" });
    expect(after.textContent).toBe(before);
    expect(after.textContent).toContain("frozen-model");
    expect(after.textContent).toContain("frozen-skill");
    expect(after.textContent).toContain("frozen-target");
    expect(after.textContent).not.toContain("new-default-model");
    expect(panel.posts.every(p => p.url === "/api/control/operator/agent-preferences")).toBe(true);
  });
});
