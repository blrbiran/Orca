// @vitest-environment jsdom
/**
 * N1 spec §11.2, DR25: App wires the Requirements section. A clarifying group has no group view, so after a requirement
 * command App reads the requirement view, never GET /api/control/groups/:id; an open that succeeded selects the new
 * requirement; an open that was refused made no group, so nothing is read for it and its refusal stays on screen.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import type { ControlSummaryV1, RecoveryViewV1 } from "../src/controlTypes.js";
import { config, requirementView, summaryWith } from "./fixtures/requirement.js";

const metrics = { report: { as_of: "2026-09-21T00:00:00.000Z", as_of_mode: "wall_clock", repos: [], correction_rate: { numerator_corrections_excluding_stale: 0, denominator_decisions: 0, rate_excluding_stale: null, corrections_total_including_stale: 0, by_decision_kind: [], buckets: [], caveats: [] }, repair_rate: { numerator_overturned: 0, denominator_corrections_including_stale: 0, rate: null, stale_only: { numerator_overturned: 0, denominator_corrections: 0, rate: null, known_bias: "" }, buckets: [], caveats: [] }, backlog: { open_corrections: 0, oldest_age_ms: null, oldest_correction_id: null, by_correction_kind: [] }, breakdown_by_correction_kind_including_stale: [], review_coverage: { available: false, reason: "none" }, unresolved_decisions: [], unkeyable_repos: [], malformed_lines: [] }, panel_review_coverage: { reviewed_high_tier: 0, high_tier_total: 0, rate: 0, caveat: "" } };
const recovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "e-1", dispatchBlocked: false, blockers: [] };
const summary: ControlSummaryV1 = summaryWith(requirementView("awaiting-answers"));

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** Every request the page made, as "METHOD url", in order. */
let requests: string[];
let openAnswer: { status: number; body: unknown };
let shownView: ReturnType<typeof requirementView>;

beforeEach(() => {
  requests = [];
  openAnswer = { status: 201, body: { schema: "orca-command-success-v1" } };
  shownView = requirementView("awaiting-answers");
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push(`${method} ${url}`);
    if (url === "/api/todo") return json({ rows: [] });
    if (url === "/api/metrics") return json(metrics);
    if (url === "/api/chains") return json({ repos: [] });
    if (url === "/api/control/config") return json(config);
    if (url.startsWith("/api/control/summary")) return json(summary);
    if (url === "/api/control/recovery") return json(recovery);
    if (url === "/api/control/agents") return json({ schema: "orca-agents-view-v1", installations: [] });
    if (url === "/api/control/operator/agent-preferences") return json({ schema: "orca-agent-preferences-v1", operatorId: "op", revision: 0, preferences: { perAgent: {} } });
    if (url === "/api/control/repositories/repo/workspace") return json({ schema: "orca-repository-workspace-v1", repoId: "repo", workspaceMode: "worktree", revision: 0 });
    if (/^\/api\/control\/groups\/[^/]+\/requirement$/.test(url)) return json(shownView);
    if (method === "POST" && url === "/api/control/requirements") return json(openAnswer.body, openAnswer.status);
    if (method === "POST" && /^\/api\/control\/groups\/r\/requirement\/(answer|accept)$/.test(url)) return json({ schema: "orca-command-success-v1", commandRevision: 4 });
    return json({ error: { code: "group-not-found", message: url } }, 404);
  }) as typeof fetch;
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

const requirementList = async () => within(await screen.findByRole("navigation", { name: "Requirement list" }));

describe("App and the Requirements section (N1 spec §11.2, DR25)", () => {
  it("reads the requirement view after a requirement command, never the group view a clarifying group does not have", async () => {
    render(<App />);
    fireEvent.click(await (await requirementList()).findByRole("button", { name: /^r · clarifying/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Accept all recommended" }));
    await waitFor(() => {
      const after = requests.slice(requests.indexOf("POST /api/control/groups/r/requirement/answer") + 1);
      expect(requests).toContain("POST /api/control/groups/r/requirement/answer");
      expect(after).toContain("GET /api/control/groups/r/requirement");
    });
    expect(requests).not.toContain("GET /api/control/groups/r");
  });

  it("opens the requirement it just created", async () => {
    render(<App />);
    const form = await screen.findByRole("form", { name: "New requirement" });
    fireEvent.change(within(form).getByRole("textbox", { name: "Idea" }), { target: { value: "Let people print a page." } });
    fireEvent.click(within(form).getByRole("button", { name: "Start clarifying" }));
    expect(await screen.findByRole("article", { name: "markdown-export" })).toBeTruthy();
    expect(requests.filter((request) => /^GET \/api\/control\/groups\/requirement-[^/]+\/requirement$/.test(request))).toHaveLength(1);
  });

  it("reads nothing for an open that was refused, and keeps its refusal on screen", async () => {
    openAnswer = { status: 422, body: { error: { code: "idea-too-large", message: "idea-too-large", commandRevision: null } } };
    render(<App />);
    const form = await screen.findByRole("form", { name: "New requirement" });
    fireEvent.change(within(form).getByRole("textbox", { name: "Idea" }), { target: { value: "Let people print a page." } });
    fireEvent.click(within(form).getByRole("button", { name: "Start clarifying" }));
    const section = within(screen.getByRole("region", { name: "Requirements" }));
    expect((await section.findByRole("alert")).textContent).toMatch(/^idea-too-large · /);
    expect(requests.filter((request) => /^GET \/api\/control\/groups\/requirement-/.test(request))).toEqual([]);
  });

  it("reads Task control's group view once a split is accepted, for the group is operated from there on", async () => {
    shownView = requirementView("awaiting-review");
    render(<App />);
    fireEvent.click(await (await requirementList()).findByRole("button", { name: /^r · clarifying/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Accept this split" }));
    await waitFor(() => expect(requests.slice(requests.indexOf("POST /api/control/groups/r/requirement/accept") + 1)).toContain("GET /api/control/groups/r"));
    expect(requests).toContain("POST /api/control/groups/r/requirement/accept");
  });

  it("re-reads the open requirement on the summary poll that lists it", async () => {
    render(<App />);
    fireEvent.click(await (await requirementList()).findByRole("button", { name: /^r · clarifying/ }));
    await waitFor(() => expect(requests).toContain("GET /api/control/groups/r/requirement"));
    const before = requests.filter((request) => request === "GET /api/control/groups/r/requirement").length;
    // The next 2 s poll answers a summary that lists r again.
    await waitFor(() => expect(requests.filter((request) => request === "GET /api/control/groups/r/requirement").length).toBeGreaterThan(before), { timeout: 4_000 });
  });
});
