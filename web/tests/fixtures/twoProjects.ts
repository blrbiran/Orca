/**
 * Project filtering (docs/superpowers/specs/2026-10-06-panel-project-filtering-design.md): two registered projects,
 * alpha and beta, and ONE fake panel that every App-rendering criterion of that plan shares.
 *
 *   ALPHA / BETA       the two repoIds; TWO_PROJECTS maps project keys "alpha" / "beta" to them.
 *   twoConfig          control config holding both repositories (one plan each).
 *   groupSummary       one group summary; planGroupView turns it into the GroupViewV1 Task control opens.
 *   decisionRow        one to-do row of a project.
 *   installFakePanel   replaces globalThis.fetch with a fake of every route App reads, and returns the FakePanel whose
 *                      fields a test mutates between reads (summary, groupViews, projects, ...). Unknown URLs answer
 *                      404 `route-not-found`; nothing throws. Every request is logged as "METHOD url" in `requests`.
 *
 * Mutable answers: `projects`, `summary`, `recovery`, `todo`, `groupViews`, `requirementViews`, `workspaces`
 * (`delayMs` holds one repository's workspace read), `decisions` (key = rowKey({projectKey, id})).
 * POSTs are recorded in `posts` and answered by `onPost`, which a test replaces to hold or refuse one.
 * Nothing here touches the network, ~/.orca or any real data (Rule 17).
 */
import { rowKey } from "../../src/DecisionList.js";
import type { Decision } from "../../src/DecisionDetail.js";
import type { ControlConfigV1, ControlSummaryV1, GroupSummaryV1, GroupViewV1, RecoveryViewV1, RequirementViewV1 } from "../../src/controlTypes.js";
import type { DecisionListRow } from "../../src/types.js";
import { view } from "./board.js";

export const ALPHA = "alpha-11111111";
export const BETA = "beta-22222222";

const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
export const twoConfig: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a",
  repositories: [{ repoId: ALPHA, displayName: "alpha" }, { repoId: BETA, displayName: "beta" }],
  plans: [
    { planId: "pa", repoId: ALPHA, displayName: "Alpha plan" },
    { planId: "pb", repoId: BETA, displayName: "Beta plan" },
  ],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-09-29T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};

export const TWO_PROJECTS = [
  { projectKey: "alpha", name: "Alpha", controlRepoId: ALPHA, editable: true },
  { projectKey: "beta", name: "Beta", controlRepoId: BETA, editable: true },
];

export function groupSummary(groupId: string, repoId: string, over: Partial<GroupSummaryV1> = {}): GroupSummaryV1 {
  return { groupId, repoId, state: "running", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0, ...over };
}

/** The group view Task control opens for `summary`: board.ts's empty view, with this summary and this repository. */
export function planGroupView(summary: GroupSummaryV1): GroupViewV1 {
  const base = view([]);
  return { ...base, summary, plan: { ...base.plan, repoId: summary.repoId } };
}

export function decisionRow(projectKey: string, id: string, over: Partial<DecisionListRow> = {}): DecisionListRow {
  return { projectKey, id, at: "2026-09-16T00:00:00.000Z", kind: "interface", scope: "repo", verdict: "ok", question: null, ...over };
}

const METRICS = { report: { as_of: "2026-09-21T00:00:00.000Z", as_of_mode: "wall_clock", repos: [], correction_rate: { numerator_corrections_excluding_stale: 0, denominator_decisions: 0, rate_excluding_stale: null, corrections_total_including_stale: 0, by_decision_kind: [], buckets: [], caveats: [] }, repair_rate: { numerator_overturned: 0, denominator_corrections_including_stale: 0, rate: null, stale_only: { numerator_overturned: 0, denominator_corrections: 0, rate: null, known_bias: "" }, buckets: [], caveats: [] }, backlog: { open_corrections: 0, oldest_age_ms: null, oldest_correction_id: null, by_correction_kind: [] }, breakdown_by_correction_kind_including_stale: [], review_coverage: { available: false, reason: "none" }, unresolved_decisions: [], unkeyable_repos: [], malformed_lines: [] }, panel_review_coverage: { reviewed_high_tier: 0, high_tier_total: 0, rate: 0, caveat: "" } };

export interface FakePanel {
  projects: { status: number; body: unknown };
  /** While set, /api/projects does not answer until this promise settles (a test releases it to resolve the list late). */
  holdProjects: Promise<unknown> | null;
  /** Served for /api/control/config (tests mutate it; default twoConfig). */
  config: ControlConfigV1;
  /** Served for every /api/control/summary read (tests mutate it). */
  summary: ControlSummaryV1;
  recovery: RecoveryViewV1;
  todo: DecisionListRow[];
  groupViews: Record<string, GroupViewV1>;
  requirementViews: Record<string, RequirementViewV1>;
  workspaces: Record<string, { mode: "worktree" | "clone"; delayMs?: number }>;
  /** Key: rowKey({projectKey, id}). */
  decisions: Record<string, Decision>;
  /** "METHOD url", in order. */
  requests: string[];
  posts: Array<{ url: string; body: unknown }>;
  /** Answer one POST; default: control success {commandRevision: 1}, panel 200 {}. Tests replace it to hold or refuse. */
  onPost: (url: string, body: unknown) => Promise<Response>;
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const refusal = (status: number, code: string, message: string): Response =>
  json({ error: { code, message, commandRevision: null, evidenceIds: [], retryable: false } }, status);

export function installFakePanel(init: Partial<FakePanel> = {}): FakePanel {
  const panel: FakePanel = {
    projects: { status: 200, body: { projects: TWO_PROJECTS } },
    holdProjects: null,
    config: twoConfig,
    summary: { schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq: 1, resetRequired: false, dispatchBlocked: false, groups: [] },
    recovery: { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [] },
    todo: [], groupViews: {}, requirementViews: {}, workspaces: {}, decisions: {}, requests: [], posts: [],
    onPost: async (url) => (url.startsWith("/api/control/") ? json({ schema: "orca-command-success-v1", commandRevision: 1 }) : json({})),
    ...init,
  };
  globalThis.fetch = (async (input: RequestInfo | URL, request?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = request?.method ?? "GET";
    panel.requests.push(`${method} ${url}`);
    if (method === "POST") {
      let body: unknown = request?.body === undefined ? undefined : String(request.body);
      try { if (typeof body === "string") body = JSON.parse(body); } catch { /* a non-JSON body is recorded raw */ }
      panel.posts.push({ url, body });
      return panel.onPost(url, body);
    }
    if (url === "/api/todo") return json({ rows: panel.todo });
    if (url === "/api/metrics") return json(METRICS);
    if (url === "/api/chains") return json({ repos: [] });
    if (url === "/api/projects") {
      if (panel.holdProjects !== null) await panel.holdProjects;
      return json(panel.projects.body, panel.projects.status);
    }
    if (url === "/api/control/config") return json(panel.config);
    if (url.startsWith("/api/control/summary")) return json(panel.summary);
    if (url === "/api/control/recovery") return json(panel.recovery);
    if (url === "/api/control/agents") return json({ schema: "orca-agents-view-v1", installations: [] });
    if (url === "/api/control/operator/agent-preferences") return json({ schema: "orca-agent-preferences-v1", operatorId: "op", revision: 0, preferences: { perAgent: {} } });
    if (url === "/api/memory/status") return json({ adapter: { id: "ccmem", capabilities: { search: true, get: true, recordCorrection: false } }, health: { status: "ok" }, repos: ((panel.projects.body as { projects?: Array<{ projectKey: string }> }).projects ?? []).map((entry) => ({ projectKey: entry.projectKey })) });
    if (url.startsWith("/api/memory/list")) {
      const projectKey = new URL(url, "http://panel.test").searchParams.get("projectKey")!;
      return json({ projectKey, query: "", page: { records: [], total: 0, truncated: false } });
    }
    if (url.startsWith("/api/decision?")) {
      const params = new URL(url, "http://panel.test").searchParams;
      const found = panel.decisions[rowKey({ projectKey: params.get("projectKey") ?? "", id: params.get("decisionId") ?? "" })];
      return found === undefined ? refusal(404, "decision-not-found", url) : json({ decision: found });
    }
    const workspace = /^\/api\/control\/repositories\/([^/]+)\/workspace$/.exec(url);
    if (workspace) {
      const repoId = decodeURIComponent(workspace[1]!);
      const entry = panel.workspaces[repoId] ?? { mode: "worktree" as const };
      if (entry.delayMs !== undefined) await new Promise((resolve) => setTimeout(resolve, entry.delayMs));
      return json({ schema: "orca-repository-workspace-v1", repoId, workspaceMode: entry.mode, revision: 0 });
    }
    const requirement = /^\/api\/control\/groups\/([^/]+)\/requirement$/.exec(url);
    if (requirement) {
      const found = panel.requirementViews[decodeURIComponent(requirement[1]!)];
      return found === undefined ? refusal(404, "group-not-found", url) : json(found);
    }
    const group = /^\/api\/control\/groups\/([^/]+)$/.exec(url);
    if (group) {
      const found = panel.groupViews[decodeURIComponent(group[1]!)];
      return found === undefined ? refusal(404, "group-not-found", url) : json(found);
    }
    return refusal(404, "route-not-found", url);
  }) as typeof fetch;
  return panel;
}
