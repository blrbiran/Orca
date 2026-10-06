// @vitest-environment jsdom
/**
 * Panel i18n spec §6.5: everything visible goes through t. A test-only pseudo-locale wraps the fixed text of every value
 * as ⟦…⟧ and leaves each {{placeholder}} and <tag> outside the markers (the zh bundle is swapped for the wrapped English
 * values; drafter finding F15), so a value interpolated into a translated string stays visible once the markers are
 * stripped: an enum passed raw instead of through enumText is seen (Task 11 review I1). Every area -- nav and shell footer,
 * decisions, chains, task control (loop card and budget table included), agents, metrics, memory, recovery, error page -- is
 * rendered with a fixture; after every ⟦…⟧ is stripped from the text and from the text attributes, no English value of at
 * least 4 characters that differs from its Chinese value may remain, and no fixed fragment of at least 4 characters of a
 * templated value that its Chinese value does not contain. The same fixtures in real Chinese show a named Chinese string
 * per area. Fixture data never equals such a value: if this criterion names a fixture string, change the fixture's data,
 * not the rule.
 *
 * What this criterion cannot see, by construction: values under 4 characters (n/a, any, By, run, ok, low, the separators)
 * -- a substring rule for them would hit fixture ids such as run/1 -- which are the per-area i18n tests' job; branches no
 * fixture renders (App's own loading / not-loaded / unavailable lines, EvidenceLink's refusal), which only the scan
 * backstop (tests/panel/scanPanelText.test.ts) covers, and only against literals; and attributes other than aria-label,
 * title, placeholder and label (none is set through t today).
 */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSelectionEditor } from "../src/AgentSelectionEditor.js";
import { AgentSettings } from "../src/AgentSettings.js";
import { footerLines, retryNotice } from "../src/App.js";
import { bannersFor } from "../src/chainBanner.js";
import { ChainBanners, ChainPanel } from "../src/ChainPanel.js";
import { ControlPanel } from "../src/ControlPanel.js";
import type {
  AgentPreferencesViewV1, AgentSelectionPreviewV1, AgentsViewV1, Amount, ControlConfigV1, ControlSummaryV1, FrozenSlotV1, GroupViewV1,
  LoopPlanViewV1, RecoveryViewV1, RepositoryWorkspaceV1, WorkItemViewV1,
} from "../src/controlTypes.js";
import { DecisionDetail } from "../src/DecisionDetail.js";
import { DecisionsView, NO_FILTER } from "../src/DecisionsView.js";
import { ErrorPage } from "../src/ErrorPage.js";
import i18n, { enumText } from "../src/i18n.js";
import { en } from "../src/locales/en.js";
import { zh } from "../src/locales/zh.js";
import { loopDraftKey } from "../src/LoopPlanCard.js";
import { MemoryView } from "../src/MemoryView.js";
import type { MemoryRecord } from "../src/memoryTypes.js";
import { MetricsView } from "../src/MetricsView.js";
import { Refusal } from "../src/Refusal.js";
import { Shell } from "../src/Shell.js";
import { TaskDetail, labelsDraftKey } from "../src/TaskDetail.js";
import type { ChainRepoView, DecisionListRow, MetricsReport, PanelCoverage } from "../src/types.js";

type Tree = { readonly [key: string]: string | Tree };
function flatten(node: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(node)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof value === "string") out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}
/** A value's fixed text and its {{placeholders}} / <tags>, alternating: odd indexes are the placeholders and tags. */
const parts = (value: string): string[] => value.split(/(\{\{[^}]*\}\}|<\/?[a-z0-9]+>)/);
const wrapValue = (value: string): string => parts(value).map((part, index) => (index % 2 === 1 || part === "" ? part : `⟦${part}⟧`)).join("");
const wrap = (node: Tree): Tree => Object.fromEntries(Object.entries(node).map(([key, value]) => [key, typeof value === "string" ? wrapValue(value) : wrap(value)]));
const EN = flatten(en as unknown as Tree);
const ZH = flatten(zh as unknown as Tree);
const WHOLE = Object.entries(EN).filter(([key, value]) => value.length >= 4 && !value.includes("{{") && value !== ZH[key]);
const FRAGMENTS = Object.entries(EN).filter(([, value]) => value.includes("{{")).flatMap(([key, value]) =>
  parts(value).filter((part, index) => index % 2 === 0).map((part) => part.trim()).filter((part) => part.length >= 4 && !ZH[key]!.includes(part))
    .map((part): [string, string] => [`${key} (fixed part)`, part]));
const CHECKED = [...WHOLE, ...FRAGMENTS];
const strip = (text: string): string => {
  let out = text;
  for (;;) {
    const next = out.replace(/⟦[^⟦⟧]*⟧/g, "");
    if (next === out) return out;
    out = next;
  }
};
function leftovers(root: HTMLElement): string[] {
  const attributes = [...root.querySelectorAll("*")].flatMap((element) => ["aria-label", "title", "placeholder", "label"].map((name) => element.getAttribute(name) ?? ""));
  const visible = [root.textContent ?? "", ...attributes].map(strip).join("\n");
  return CHECKED.filter(([, value]) => visible.includes(value)).map(([key, value]) => `${key}: ${value}`);
}
// The store keeps the bundle it was given by reference, and a deep addResourceBundle merges into it: merging the wrapped
// values would overwrite the imported zh object itself. So the bundle is swapped whole, always for a fresh copy.
function setZhBundle(bundle: Tree): void {
  i18n.removeResourceBundle("zh", "translation");
  i18n.addResourceBundle("zh", "translation", bundle);
}
async function usePseudo(): Promise<void> {
  setZhBundle(wrap(en as unknown as Tree));
  await i18n.changeLanguage("zh");
}
async function useChinese(): Promise<void> {
  setZhBundle(structuredClone(zh) as unknown as Tree);
  await i18n.changeLanguage("zh");
}
afterEach(() => {
  cleanup();
  setZhBundle(structuredClone(zh) as unknown as Tree);
  vi.unstubAllGlobals(); // the memory area's fetch stub must not outlive it
});

// ---- fixtures (data strings chosen to collide with no checked English value) ----
const amount = (tokens: number): Amount => ({ tokens, activeMs: 14_400_000, attempts: 3, sessions: 3 });
const human = { provenance: "human", estimateId: null } as const;
const provenance = { tokens: human, activeMs: human, attempts: human, sessions: human };
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "phase-end", handoffExecution: null, contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "e-1", repositories: [{ repoId: "orca", displayName: "Repo X" }], plans: [{ planId: "p-demo", repoId: "orca", displayName: "Demo P" }],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-10-01T00:00:00.000Z", probeFailureCode: null }],
  defaults: null, executionPort: "unconfigured", errorCatalog: [],
};
const LOOP: LoopPlanViewV1 = {
  planId: "bugfix", planVersion: 2, chosenBy: "labels", chosenByLabel: "bug", amended: true, loopVersion: 1,
  inputs: { goal: "g-1", successCondition: "s-1", targetPaths: ["src/a/**", "src/b/**"], checks: ["npm test"], nonGoals: [], relevantDocs: [], protectedPaths: ["docs/**"], maxFilesTouched: null },
  maxFiles: Number.MAX_SAFE_INTEGER, hasDiscipline: true,
};
const base = (taskId: string): WorkItemViewV1 => ({
  taskId, status: "held", dependencyTaskIds: [], targetVersion: 1, configHash: null, originalContractHash: "e".repeat(64), derivedContractHash: null,
  currentRunId: "r1", pendingRunId: null, lineageRunIds: [], labels: ["bug"], labelsProvenance: "operator", labelsVersion: 1,
  progress: { runId: "r1", step: "execute", attempt: { current: 1, max: 3 }, tokens: { used: 50, grant: 200 }, lastTransitionAt: "2026-10-01T00:00:00.000Z" },
});
const itemA: WorkItemViewV1 = { ...base("a"), status: "draft", loopPlan: LOOP, objective: { goal: "g-1", successCondition: "s-1" } };
const itemB: WorkItemViewV1 = { ...base("b"), loopPlan: null, objective: { goal: "g-2", successCondition: "s-2" } };
const view: GroupViewV1 = {
  schema: "orca-control-group-v1", epoch: "e-1", changeSeq: 4,
  summary: { groupId: "g", repoId: "orca", state: "ready", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: true, recoveryBlockerCount: 1 },
  graphVersion: 1, plan: { repoId: "orca", planId: "p-demo", planHash: "a".repeat(64), goal: "goal-x", successConditions: ["s-3"] },
  proposal: { state: "editable", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
  ledger: { groupLimit: amount(9_000_000), used: amount(0), committedRemaining: amount(3_000_000), explicitUnallocatedReserve: amount(6_000_000), budgetDeficit: amount(5), usageUnknown: true },
  allocations: [
    { ownerKind: "task", ownerId: "a", bucket: "work", state: "draft-encumbered", amount: amount(3_000_000), fieldProvenance: provenance },
    { ownerKind: "task", ownerId: "b", bucket: "work", state: "draft-encumbered", amount: amount(3_000_000), fieldProvenance: { ...provenance, tokens: { provenance: "model", estimateId: "est-1" } } },
  ],
  workItems: [itemA, itemB],
  estimates: [{
    estimateId: "est-1", estimateVersion: 1, state: "ready", profile: { profileId: "all", profileHash: "b".repeat(64) }, mode: "soft", requestHash: null, outputHash: null, reasonCode: null,
    output: { schema: "budget-estimate-v1", planHash: "a".repeat(64), tasks: [{ taskId: "b", complexity: "M", confidence: "high", work: amount(2_000_000), handoff: amount(0), rationale: "r-x", assumptions: ["a-x"] }], goalReviewReserve: amount(0), groupRationale: "gr-x" },
  }],
  runs: [{ runId: "r1", taskId: "b", estimateId: null, generation: 1, state: "blocked", phase: "work", claimOrdinal: 1, providerAttemptOrdinal: 2, profile: { profileId: "all", profileHash: "b".repeat(64) }, used: amount(10), remaining: amount(20), failureCode: null, blockedReason: "why-1", evidenceIds: ["e1"] }],
  checkpoints: [],
  handoffRequests: [{ requestId: "h1", runId: "r1", state: "collecting", deadlineAt: "2026-10-02T00:00:00.000Z", phaseAttemptOrdinal: 1, failureCode: null, evidenceIds: [] }],
  stop: { mode: "pause", state: "paused", frozenRunIds: ["r1"], acceptedAt: "2026-10-01T00:00:00.000Z", deadlineAt: null },
  recoveryBlockers: [{ scope: "run", code: "code-1", runId: "r1", evidenceIds: ["e1"] }], recentCommandIds: ["c2"],
};
const summary: ControlSummaryV1 = { schema: "orca-control-summary-v1", epoch: "e-1", changeSeq: 4, resetRequired: true, dispatchBlocked: true, groups: [{ ...view.summary, completion: { done: 0, total: 2 }, stopState: "paused" }] };
const recovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "e-1", dispatchBlocked: true, blockers: [{ scope: "global", groupId: "", runId: null, code: "code-2", evidenceIds: [] }] };
const workspace: RepositoryWorkspaceV1 = { schema: "orca-repository-workspace-v1", repoId: "orca", workspaceMode: "clone", revision: 1 };
const agents: AgentsViewV1 = { schema: "orca-agents-view-v1", installations: [{ id: "codex", kind: "codex", defaults: { model: "gpt-x", contextWindow: "agent-default" }, contextOptions: ["agent-default", 1_000_000], version: "1.0" }] };
const preferences: AgentPreferencesViewV1 = { schema: "orca-agent-preferences-v1", operatorId: "op-1", revision: 3, preferences: { defaultAgent: "codex", perAgent: {} } };
const frozen: FrozenSlotV1 = { partial: {}, provenance: { agent: "operator", model: "descriptor", contextWindow: "group-plan" }, selection: { agent: "codex", model: "gpt-x", contextWindow: 1_000_000 }, configHash: "c".repeat(64), timeoutMs: 1_000, killGraceMs: 5_000, capabilities: { ...capability, contextObservation: "realtime" } };
const preview: AgentSelectionPreviewV1 = {
  schema: "orca-agent-selection-preview-v1", groupId: "g", proposalVersion: 2, groupOverrides: {}, taskOverrides: {},
  planLayers: { group: { worker: { agent: "codex", model: "gpt-5x" } }, tasks: {} },
  slots: [{ key: "task:a", slot: "worker", taskId: "a", outcome: { kind: "resolved", frozen } }, { key: "reconcile", slot: "reconcile", taskId: null, outcome: { kind: "unavailable", code: "u-1" } }],
  selectionsHash: null,
};
const ROW: DecisionListRow = { projectKey: "github.com/x/y", id: "run/1", at: "2026-09-16T00:00:00.000Z", kind: "boundary", scope: "cross-repo", verdict: "downgraded", question: null };
const stopped: ChainRepoView = { repoKey: "acme-beta", defaultSessionTimeoutMin: null, problem: null, chain: { chainId: "chain-2", goal: "g-4", by: "amy", via: "cli", startedAt: "2026-10-01T00:00:00.000Z", state: "stopped", holderGone: false, sessionsDone: 2, costUsd: null, stop: { reason: "r-1", category: "anomaly", at: "2026-10-01T01:00:00.000Z", awaitingHuman: ["h-1"], detail: null } } };
const running: ChainRepoView = { repoKey: "acme-alpha", defaultSessionTimeoutMin: 30, problem: null, chain: { ...stopped.chain!, chainId: "chain-1", state: "running", stop: null, costUsd: 1.5 } };
const metricsReport: MetricsReport = {
  as_of: "2026-10-01T00:00:00.000Z", as_of_mode: "wall_clock", repos: [],
  correction_rate: { numerator_corrections_excluding_stale: 1, denominator_decisions: 2, rate_excluding_stale: 0.5, corrections_total_including_stale: 1, by_decision_kind: [], buckets: [], caveats: ["x-1", "x-2"], caveatCodes: ["no-review-coverage", "unresolved-decisions"] },
  repair_rate: { numerator_overturned: 0, denominator_corrections_including_stale: 1, rate: null, stale_only: { numerator_overturned: 0, denominator_corrections: 0, rate: null, known_bias: "x-3", knownBiasCode: "stale-bias" }, buckets: [], caveats: ["x-4"], caveatCodes: ["no-review-coverage"] },
  backlog: { open_corrections: 0, oldest_age_ms: null, oldest_correction_id: null, by_correction_kind: [] }, breakdown_by_correction_kind_including_stale: [],
  review_coverage: { available: false, reason: "x-5", reasonCode: "no-review-coverage" }, excluded_as_future: 1, unresolved_decisions: [], unkeyable_repos: [], malformed_lines: [],
};
const coverage: PanelCoverage = { reviewed_high_tier: 0, high_tier_total: 0, rate: null, caveat: "x-6", caveatCode: "reviewed-is-deliberate" };
const loopDraft = JSON.stringify({ base: 0, plan: "bugfix", text: { goal: "g-1", successCondition: "s-1", targetPaths: "src/a/**", checks: "npm test", nonGoals: "", relevantDocs: "", protectedPaths: "", maxFilesTouched: "", tokens: "3000500", activeMs: "14400000", attempts: "3" } });
const drafts = { [loopDraftKey("g", "a")]: loopDraft, [labelsDraftKey("g", "b")]: JSON.stringify({ base: 0, labels: ["bug", "perf"] }) };
const noop = vi.fn();
// MemoryView reads its data itself (plan D8), so its fixture is the panel's answers; `settle` waits for the list and opens
// the one record, so the list, its caveats and the whole detail are on screen when the area is checked.
const MEMORY: MemoryRecord = {
  ref: "41", scope: "global", projectKey: null, kind: "k-1", content: "m-1", tags: ["t-1"], pinned: true, source: "s-4", trust: 0.5,
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z",
};
const realFetch = globalThis.fetch;
function stubMemoryFetch(): void {
  const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url === "/api/memory/status") return json({ adapter: { id: "ccmem", capabilities: { search: true, get: true, recordCorrection: false } }, health: { status: "ok" }, repos: [{ projectKey: "mk-1" }, { projectKey: "mk-2" }] });
    if (url.startsWith("/api/memory/list")) return json({ projectKey: "mk-1", query: "", page: { records: [MEMORY], total: 9, truncated: true } });
    if (url.startsWith("/api/memory/item")) return json({ record: MEMORY });
    throw new Error(`unexpected request ${url}`);
  });
}
async function openMemory(container: HTMLElement): Promise<void> {
  await waitFor(() => expect(container.querySelector(".memory-row")).not.toBeNull());
  fireEvent.click(container.querySelector(".memory-row")!);
  await waitFor(() => expect(container.querySelector("[data-testid='memory-content']")).not.toBeNull());
}

const AREAS: Array<{ name: string; chinese: string; element: () => JSX.Element; settle?: (container: HTMLElement) => Promise<void> }> = [
  { name: "nav and shell footer", chinese: "决策", element: () => (
    <Shell active="decisions" badges={{ unreviewed: 1, chainRunning: true, controlAlert: true }} footer={footerLines(summary)} theme="system" language="zh"><p>pane</p></Shell>
  ) },
  { name: "decisions", chinese: "未评审的高层级决策", element: () => (
    <DecisionsView rows={[ROW]} filter={NO_FILTER} selected={{ projectKey: "github.com/x/y", id: "run/9" }}
      detail={<DecisionDetail decision={{ id: "run/9", question: "q-1", chose: "c-1", because: "b-1", alternatives: [{ option: "o-1", why_not: "w-1" }] }} />} />
  ) },
  { name: "chains", chinese: "还没有链。", element: () => (
    <>
      <ChainBanners banners={bannersFor([stopped], new Set())} />
      <ChainPanel repos={[running, stopped, { repoKey: "acme-gamma", defaultSessionTimeoutMin: null, chain: null, problem: null }]} banners={[]} outcome={{ kind: "started", chainId: "chain-1" }} />
    </>
  ) },
  { name: "task control, recovery, budget table", chinese: "工作项", element: () => (
    <ControlPanel config={config} summary={summary} recovery={recovery} groups={{ g: view }} selected="g" drafts={drafts} uncertain={[{ groupId: "g", commandId: "c1" }]}
      refusal={{ status: 409, code: "revision-conflict", message: "m-1", commandRevision: 7 }} refetchRequired onSelect={noop} onDraft={noop} onCommand={noop}
      workspace={workspace} onWorkspaceMode={noop} />
  ) },
  { name: "task detail and loop card", chinese: "手写契约", element: () => (
    <>
      <TaskDetail view={view} item={itemA} drafts={drafts} onDraft={noop} onCommand={noop} />
      <TaskDetail view={view} item={itemB} drafts={drafts} onDraft={noop} onCommand={noop} />
    </>
  ) },
  { name: "agents", chinese: "保存 agent 偏好", element: () => (
    <>
      <AgentSettings agents={agents} preferences={preferences} drafts={{}} onDraft={noop} onSave={noop} />
      <AgentSelectionEditor view={view} agents={agents} preview={preview} preferences={preferences.preferences} drafts={{}} onDraft={noop} onCommand={noop}
        onReread={noop} retryNotice={retryNotice({ state: "stopped" })} />
      <AgentSelectionEditor view={{ ...view, proposal: { ...view.proposal, state: "confirmed" } }} agents={agents} preview={null} drafts={{}} onDraft={noop} onCommand={noop} />
    </>
  ) },
  { name: "metrics", chinese: "纠正率", element: () => <MetricsView report={metricsReport} coverage={coverage} /> },
  { name: "memory", chinese: "项目键", element: () => { stubMemoryFetch(); return <MemoryView active />; }, settle: openMemory },
  { name: "error page and refusal", chinese: "orca 面板加载失败", element: () => (
    <>
      <ErrorPage failure={{ status: 409, code: "corrections-store-busy", message: "m-2" }} />
      <Refusal refusal={{ status: 409, code: "decision-not-found", message: "m-3", retry_field: "again" }} />
    </>
  ) },
];

describe("everything visible goes through t (spec §6.5)", () => {
  it("checks a real set of English values, the fixed parts of templated ones included", () => {
    expect(WHOLE.length).toBeGreaterThan(300);
    expect(FRAGMENTS.length).toBeGreaterThan(120);
  });

  it.each(AREAS)("$name: no English value is left once the pseudo-locale's ⟦…⟧ are stripped", async ({ element, settle }) => {
    await usePseudo();
    const { container } = render(element());
    await settle?.(container);
    expect(container.textContent).toContain("⟦");
    expect(leftovers(container)).toEqual([]);
  });

  it.each(AREAS)("$name: the same fixture in Chinese shows $chinese", async ({ element, chinese, settle }) => {
    await useChinese();
    const { container } = render(element());
    await settle?.(container);
    expect(container.textContent).toContain(chinese);
  });

  // Runs after both it.each above, so the memory area has stubbed fetch twice by now: a later area must see the real one.
  it("leaves fetch as it found it once the memory area is done", () => {
    expect(globalThis.fetch).toBe(realFetch);
  });
});

/**
 * Carried from Task 3's review: what a person typed into a loop plan is shown as typed, in both languages. i18next only
 * interpolates it (escapeValue false, and a value is never interpolated or nested again -- skipOnVariables), so a goal
 * holding {{…}}, $t(…) or markup reaches the screen byte for byte and never becomes an element. Group ids, the card's
 * other value (the Trans git line), are ids (idSchema: [a-zA-Z0-9][a-zA-Z0-9_.-]*) and cannot hold any of these.
 */
const TYPED = "{{goal}} $t(nav.decisions) <b>&amp;";
const typedPlan: LoopPlanViewV1 = {
  ...LOOP, amended: false,
  inputs: { ...LOOP.inputs, goal: TYPED, successCondition: TYPED, targetPaths: [TYPED, "src/b/**"], checks: [TYPED], protectedPaths: [TYPED] },
};
const typedItems: WorkItemViewV1[] = [
  { ...base("a"), status: "draft", loopPlan: typedPlan, objective: { goal: TYPED, successCondition: TYPED } },
  { ...base("b"), loopPlan: null, objective: { goal: TYPED, successCondition: TYPED } },
];
const TYPED_LINES = {
  en: {
    summaryRegion: "Plan summary a", handWrittenRegion: "Plan b",
    card: [`Goal: ${TYPED}`, `Done when: ${TYPED}`, `Only changes: ${TYPED}, src/b/**`, `Must not change: ${TYPED} (reported by the agent, not checked in git)`],
    handWritten: [`Goal: ${TYPED}`, `Done when: ${TYPED}`],
  },
  zh: {
    summaryRegion: "做法摘要 a", handWrittenRegion: "做法 b",
    card: [`目标：${TYPED}`, `完成条件：${TYPED}`, `只改：${TYPED}、src/b/**`, `不许改：${TYPED}（由 agent 自报，不是 git 检查）`],
    handWritten: [`目标：${TYPED}`, `完成条件：${TYPED}`],
  },
} as const;

describe("typed plan text is shown as typed (Task 3 review, carried)", () => {
  it.each(["en", "zh"] as const)("in %s, a goal with {{…}}, $t(…) and markup is neither interpolated, nested nor parsed", async (lang) => {
    if (lang === "zh") await useChinese();
    const { container } = render(
      <>
        {typedItems.map((item) => <TaskDetail key={item.taskId} view={{ ...view, workItems: typedItems }} item={item} drafts={{}} onDraft={noop} onCommand={noop} />)}
      </>,
    );
    const texts = (selector: string): string[] => [...container.querySelectorAll(selector)].map((element) => element.textContent ?? "");
    expect(texts(`ul[aria-label="${TYPED_LINES[lang].summaryRegion}"] > li`).slice(0, 4)).toEqual(TYPED_LINES[lang].card);
    expect(texts("details code")).toEqual([TYPED]);
    expect(texts(`section[aria-label="${TYPED_LINES[lang].handWrittenRegion}"] > ul > li`)).toEqual(TYPED_LINES[lang].handWritten);
  });
});

/**
 * Carried from Tasks 7 and 9's reviews (spec §3.5): many enum values are rendered by no fixture, so a Chinese value could
 * regress unseen. Every value of every family is read through enumText: in Chinese it is zh.ts's words and differs from
 * the English words (S/M/L/XL are the same letters in both, by design); in English it is en.ts's words.
 */
type Family = keyof typeof en.enums;
const FAMILIES = Object.keys(en.enums) as Family[];
const ENUM_VALUES = FAMILIES.flatMap((family) => Object.keys(en.enums[family]).map((value) => ({ family, value })));
const SAME_IN_CHINESE = ["complexity.S", "complexity.M", "complexity.L", "complexity.XL"];

describe("every enum value has its words in both languages (spec §3.5)", () => {
  it("reads every family", () => {
    // 33 with roundState, draftState and exportState (N1 Task 13, the same named rewrite: the Requirements section).
    expect(FAMILIES.length).toBe(33);
    // Now counts groupState.clarifying (N1 Task 4, controller ruling: a named rewrite; the count follows the catalogue).
    // And runPhase.single-call (N1 Task 12, the same named rewrite: a requirement's runs in the group view, DR26).
    // And roundState (5), draftState (7) and exportState (4): 148 + 16 (N1 Task 13, the same named rewrite).
    expect(ENUM_VALUES.length).toBe(164);
  });

  it("in Chinese shows zh.ts's words for every value, words that differ from the English ones", async () => {
    await useChinese();
    const wrong = ENUM_VALUES.flatMap(({ family, value }) => {
      const english = (en.enums[family] as Record<string, string>)[value]!;
      const chinese = (zh.enums[family] as Record<string, string>)[value]!;
      const shown = enumText(family, value);
      const problems: string[] = [];
      if (shown !== chinese) problems.push(`${family}.${value}: shows ${JSON.stringify(shown)}, zh.ts has ${JSON.stringify(chinese)}`);
      if ((chinese === english) !== SAME_IN_CHINESE.includes(`${family}.${value}`)) problems.push(`${family}.${value}: zh ${JSON.stringify(chinese)} vs en ${JSON.stringify(english)}`);
      return problems;
    });
    expect(wrong).toEqual([]);
  });

  it("in English shows en.ts's words for every value", () => {
    const wrong = ENUM_VALUES.filter(({ family, value }) => enumText(family, value) !== (en.enums[family] as Record<string, string>)[value]).map(({ family, value }) => `${family}.${value}`);
    expect(wrong).toEqual([]);
  });
});
