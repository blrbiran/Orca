### Task 11: Everything visible goes through `t`; enum completeness; nothing left for the scan; `zh.ts` ready for review

Spec §6.5, §3.5, §8 (the scan is the proof, §6.5 the backstop), §5 (the human reviews `zh.ts`).

**Files:**
- Create: `web/tests/i18nPseudo.test.tsx`
- Modify: `tests/panel/scanPanelText.test.ts` (this round's file, Task 1: one `describe` added)

- [ ] **Step 1: Write the criteria**

`web/tests/i18nPseudo.test.tsx`:

```tsx
// @vitest-environment jsdom
/**
 * Panel i18n spec §6.5: everything visible goes through t. A test-only pseudo-locale wraps every value as ⟦…⟧ (the zh
 * bundle is overwritten with the wrapped English values; drafter finding F15). Every area -- nav and shell footer,
 * decisions, chains, task control (loop card and budget table included), agents, metrics, recovery, error page -- is
 * rendered with a fixture; after every ⟦…⟧ is stripped from the text and from the text attributes, no English value of at
 * least 4 characters that has no {{ and differs from its Chinese value may remain. The same fixtures in real Chinese show
 * a named Chinese string per area. Fixture data never equals such a value: if this criterion names a fixture string,
 * change the fixture's data, not the rule.
 */
import { cleanup, render } from "@testing-library/react";
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
import i18n from "../src/i18n.js";
import { en } from "../src/locales/en.js";
import { zh } from "../src/locales/zh.js";
import { loopDraftKey } from "../src/LoopPlanCard.js";
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
const wrap = (node: Tree): Tree => Object.fromEntries(Object.entries(node).map(([key, value]) => [key, typeof value === "string" ? `⟦${value}⟧` : wrap(value)]));
const EN = flatten(en as unknown as Tree);
const ZH = flatten(zh as unknown as Tree);
const CHECKED = Object.entries(EN).filter(([key, value]) => value.length >= 4 && !value.includes("{{") && value !== ZH[key]);
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
async function usePseudo(): Promise<void> {
  i18n.addResourceBundle("zh", "translation", wrap(en as unknown as Tree), true, true);
  await i18n.changeLanguage("zh");
}
async function useChinese(): Promise<void> {
  i18n.addResourceBundle("zh", "translation", zh, true, true);
  await i18n.changeLanguage("zh");
}
afterEach(() => {
  cleanup();
  i18n.addResourceBundle("zh", "translation", zh, true, true);
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
  summary: { groupId: "g", state: "ready", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: true, recoveryBlockerCount: 1 },
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
  planLayers: { group: { worker: { agent: "codex", model: "gpt-plan" } }, tasks: {} },
  slots: [{ key: "task:a", slot: "worker", taskId: "a", outcome: { kind: "resolved", frozen } }, { key: "reconcile", slot: "reconcile", taskId: null, outcome: { kind: "unavailable", code: "u-1" } }],
  selectionsHash: null,
};
const ROW: DecisionListRow = { projectKey: "github.com/x/y", id: "run/1", at: "2026-09-16T00:00:00.000Z", kind: "boundary", scope: "cross-repo", verdict: "downgraded", question: null };
const stopped: ChainRepoView = { repoKey: "repo-two", defaultSessionTimeoutMin: null, problem: null, chain: { chainId: "chain-2", goal: "g-4", by: "amy", via: "cli", startedAt: "2026-10-01T00:00:00.000Z", state: "stopped", holderGone: false, sessionsDone: 2, costUsd: null, stop: { reason: "r-1", category: "anomaly", at: "2026-10-01T01:00:00.000Z", awaitingHuman: ["h-1"], detail: null } } };
const running: ChainRepoView = { repoKey: "repo-one", defaultSessionTimeoutMin: 30, problem: null, chain: { ...stopped.chain!, chainId: "chain-1", state: "running", stop: null, costUsd: 1.5 } };
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

const AREAS: Array<{ name: string; chinese: string; element: () => JSX.Element }> = [
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
      <ChainPanel repos={[running, stopped, { repoKey: "repo-three", defaultSessionTimeoutMin: null, chain: null, problem: null }]} banners={[]} outcome={{ kind: "started", chainId: "chain-1" }} />
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
  { name: "error page and refusal", chinese: "orca 面板加载失败", element: () => (
    <>
      <ErrorPage failure={{ status: 409, code: "unresolved-project-keys", message: "m-2" }} />
      <Refusal refusal={{ status: 409, code: "correction-already-recorded", message: "m-3", retry_field: "again" }} />
    </>
  ) },
];

describe("everything visible goes through t (spec §6.5)", () => {
  it("checks a real set of English values", () => {
    expect(CHECKED.length).toBeGreaterThan(300);
  });

  it.each(AREAS)("$name: no English value is left once the pseudo-locale's ⟦…⟧ are stripped", async ({ element }) => {
    await usePseudo();
    const { container } = render(element());
    expect(container.textContent).toContain("⟦");
    expect(leftovers(container)).toEqual([]);
  });

  it.each(AREAS)("$name: the same fixture in Chinese shows $chinese", async ({ element, chinese }) => {
    await useChinese();
    const { container } = render(element());
    expect(container.textContent).toContain(chinese);
  });
});
```

In `tests/panel/scanPanelText.test.ts` (Task 1's file) add:

```ts
/**
 * Panel i18n spec §6.5, §8 (drafter finding F18): once every area is converted, the scan finds nothing a person reads in
 * web/src but this allow-list -- the brand, two class names, the HTTP-method-and-path part of the web's own messages and
 * a developer error that is never rendered. A literal left in a branch no fixture renders is caught here, not by §6.5.
 */
const ALLOWED = [
  "web/src/Shell.tsx\tOrca",
  'web/src/TaskDetail.tsx\t"label label-custom"',
  'web/src/TaskDetail.tsx\t"label label-system"',
  "web/src/api.ts\t`GET ${path}`",
  "web/src/api.ts\t`POST ${path}`",
  "web/src/controlApi.ts\t`GET ${entry.downloadUrl}`",
  "web/src/controlApi.ts\t`GET ${entry.downloadUrl}`",
  "web/src/controlApi.ts\t`GET ${path}`",
  "web/src/controlApi.ts\t`GET ${path}`",
  "web/src/controlApi.ts\t`POST ${path}`",
  "web/src/controlApi.ts\t`POST ${path}`",
  'web/src/main.tsx\t"orca panel: #root is missing from index.html"',
];

describe("nothing left to translate (spec §6.5 backstop)", () => {
  it("leaves nothing in web/src for a person to read but the allow-list", () => {
    const run = spawnSync(process.execPath, [SCRIPT, "--ui", process.cwd()], { encoding: "utf8" });
    expect(run.status).toBe(0);
    const rows = run.stdout.split("\n").filter((line) => line !== "").map((line) => {
      const [, where, , text] = line.split("\t");
      return `${where!.replace(/:\d+$/, "")}\t${text}`;
    });
    expect(rows.sort()).toEqual([...ALLOWED].sort());
  });
});
```

- [ ] **Step 2: Run** — these criteria pass on a complete conversion; a red row names what Tasks 2–10 missed.

```bash
(cd web && ../node_modules/.bin/vitest run tests/i18nPseudo.test.tsx) > "$SCRATCH/t11-pseudo.txt" 2>&1; echo rc=$?
./node_modules/.bin/vitest run tests/panel/scanPanelText.test.ts > "$SCRATCH/t11-scan.txt" 2>&1; echo rc=$?
```
Expected both `rc=0`. If a leftover is a real UI string, convert it (key in both resources, the site through `t`) in the owning area's file and record it in the Task report; if it is fixture data, change the fixture's data string. A new allow-list row needs the controller's ruling (it is a string the panel will show untranslated).

- [ ] **Step 3: Enum completeness (spec §3.5) — seen red at compile time.** In a clone (`$SCRATCH/mut-t11`), add `| "archived"` to `GroupSummaryV1["state"]` in `web/src/controlTypes.ts:46`:
```bash
(cd "$M" && npm run check --workspace web) > "$SCRATCH/t11-enum-red.txt" 2>&1; echo rc=$?
```
Expected a non-zero `rc` with `web/src/locales/en.ts` named: `Property 'archived' is missing in type …` at `groupState`'s `satisfies`. Restore (`cat "$REPO/web/src/controlTypes.ts" > "$M/web/src/controlTypes.ts"`), confirm `cmp` clean and the check `rc=0`.

- [ ] **Step 4: Mutations** (`$SCRATCH/mut-t11`)
  - MT11-1 a render path reads the English constant: in `DecisionsView.tsx`, `t("decisions.notInList")` → `NOT_IN_LIST`. Red: `i18nPseudo … > decisions: no English value is left …` (`decisions.notInList: This decision is no longer in the list …`).
  - MT11-2 a literal left in a rendered branch: `<h3>{t("control.group.workItems")}</h3>` → `<h3>Work items</h3>`. Red: `i18nPseudo … > task control, recovery, budget table: …` and `scanPanelText … > leaves nothing … but the allow-list`.
  - MT11-3 a literal left in a branch no fixture renders: `{t("control.group.resumeNoContinuation")}` → `Resume (no continuation)`. Red: `scanPanelText … > leaves nothing …` only (predicted: `i18nPseudo` stays green — the fixture has no handoff stop — which is why the scan backstop exists).
  - MT11-4 a helper-built string bypasses t: in `footerLines`, the second element `i18n.t(summary.dispatchBlocked ? "common.dispatchBlocked" : "common.dispatchLive")` → `summary.dispatchBlocked ? "dispatch blocked" : "dispatch live"`. Red: `i18nPseudo … > nav and shell footer: …` (`common.dispatchBlocked: dispatch blocked`).
  - MT11-5 the pseudo-locale is vacuous: in `usePseudo`, delete the `addResourceBundle` line. Red: every `… no English value is left …` (`⟦` absent).

- [ ] **Step 5: `zh.ts` ready for the human's review (spec §5).** Dump every key with its English and Chinese value, and every `zhErrors` entry, for the controller to present:

```bash
./node_modules/.bin/tsx -e '
import("./web/src/locales/en.ts").then(async ({ en }) => {
  const { zh, zhErrors } = await import("./web/src/locales/zh.ts");
  const flat = (n, p = "") => Object.entries(n).flatMap(([k, v]) => typeof v === "string" ? [[p + k, v]] : flat(v, p + k + "."));
  const z = Object.fromEntries(flat(zh));
  const rows = flat(en).map(([k, v]) => `${k}\t${v}\t${z[k]}`);
  const errs = Object.entries(zhErrors).map(([k, v]) => `errors.${k}\t\t${v}`);
  process.stdout.write([...rows, ...errs].join("\n") + "\n");
});' > "$SCRATCH/zh-review.tsv" 2>&1; echo rc=$?
```
Expected `rc=0`; read the file whole and record its line count (keys + 172 error entries). The Task ends with `zh.ts` ready for review; the controller presents `zh-review.tsv` to the human at the end of the round, and any wording change the human asks for is a later commit to `zh.ts` only (the parity and width criteria re-run).

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add web/tests/i18nPseudo.test.tsx tests/panel/scanPanelText.test.ts
/usr/bin/git commit -F - <<'MSG'
test(web): pin that everything the panel shows goes through its resources

A pseudo-locale renders every area with a fixture and finds no English value
left once its markers are stripped; the same fixtures in Chinese show a named
Chinese string per area. The text-site scan finds nothing untranslated in
web/src but a named allow-list, which catches branches no fixture renders.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GCbsgLfqFPgpeG3gTbBkbh
MSG
```

---

