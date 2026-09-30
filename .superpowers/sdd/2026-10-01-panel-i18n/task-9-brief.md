### Task 9: The agents area and the retry notice

**Files:**
- Modify: `web/src/AgentFields.tsx` (`contextLabel` :9; `SelectionFields` :125-176), `web/src/AgentSelectionEditor.tsx`, `web/src/AgentSettings.tsx`, `web/src/App.tsx:116-121` (`retryNotice`, now exported)
- Modify: `web/src/locales/en.ts`, `web/src/locales/zh.ts` (`agents`; enum families `agentSlot`, `selectionSource`)
- Create: `web/tests/agentsI18n.test.tsx`; Modify: `web/tests/i18nWidth.test.ts` (this round's file: two prefixes and two buttons added)

**Interfaces:** `contextLabel(value)` keeps its signature (translates at call time); `App.tsx` exports `retryNotice(retry)` (unchanged body shape, now keyed) for the criterion; the installation `kind` and `version`, the selection's agent and model stay as sent (F6).

**Enum families:**

| Family (union) | 中文 |
|---|---|
| `agentSlot` (`AgentSlotV1`) | worker 执行 · estimator 估算 · reconcile 协调 |
| `selectionSource` (`ProvenanceSourceV1`) | operator 操作者 · operator-estimator 操作者的估算槽 · operator-reconcile 操作者的协调槽 · group 组 · group-estimator 组的估算槽 · group-reconcile 组的协调槽 · task 任务 · operator-agent 操作者对该 agent 的默认 · descriptor agent 描述符 · group-plan 计划（组） · group-reconcile-plan 计划（组协调槽） · task-plan 计划（任务） |

- [ ] **Step 1: Write the failing criterion** — `web/tests/agentsI18n.test.tsx`:

```tsx
// @vitest-environment jsdom
/**
 * Panel i18n spec §3.3, §3.5, §5: the agents area in Chinese -- the settings page, the proposal's agent editor (slots in
 * words, where each field came from, a refused slot, the plan values a layer can ignore), the confirmed view, the read
 * failure and the retry notice. Agent ids, models, versions and codes stay as sent.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSelectionEditor } from "../src/AgentSelectionEditor.js";
import { AgentSettings } from "../src/AgentSettings.js";
import { retryNotice } from "../src/App.js";
import i18n from "../src/i18n.js";
import type { AgentPreferencesViewV1, AgentSelectionPreviewV1, AgentsViewV1, Amount, FrozenSlotV1, GroupViewV1 } from "../src/controlTypes.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: 1_000, attempts: 3, sessions: 3 });
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "realtime", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const agents: AgentsViewV1 = { schema: "orca-agents-view-v1", installations: [{ id: "codex", kind: "codex", defaults: { model: "gpt-x", contextWindow: "agent-default" }, contextOptions: ["agent-default", 1_000_000], version: "1.0" }] };
const preferences: AgentPreferencesViewV1 = { schema: "orca-agent-preferences-v1", operatorId: "op-1", revision: 3, preferences: { defaultAgent: "codex", perAgent: {} } };
const frozen: FrozenSlotV1 = {
  partial: {}, provenance: { agent: "operator", model: "descriptor", contextWindow: "group-plan" },
  selection: { agent: "codex", model: "gpt-x", contextWindow: 1_000_000 }, configHash: "c".repeat(64), timeoutMs: 1_000, killGraceMs: 5_000, capabilities: capability,
};
const preview: AgentSelectionPreviewV1 = {
  schema: "orca-agent-selection-preview-v1", groupId: "g", proposalVersion: 2, groupOverrides: {}, taskOverrides: {},
  planLayers: { group: { worker: { agent: "codex", model: "gpt-plan" } }, tasks: {} },
  slots: [
    { key: "task:a", slot: "worker", taskId: "a", outcome: { kind: "resolved", frozen } },
    { key: "reconcile", slot: "reconcile", taskId: null, outcome: { kind: "rejected", code: "agent-installation-missing" } },
  ],
  selectionsHash: null,
};
const view = (state: "editable" | "confirmed"): GroupViewV1 => ({
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 4,
  summary: { groupId: "g", state: "draft", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1, plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "goal-x", successConditions: ["s-1"] },
  proposal: { state, proposalVersion: 2, planHash: "a".repeat(64), budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
  ledger: { groupLimit: amount(100), used: amount(0), committedRemaining: amount(0), explicitUnallocatedReserve: amount(100), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [],
  workItems: [{ taskId: "a", status: "draft", dependencyTaskIds: [], targetVersion: 1, configHash: null, originalContractHash: "e".repeat(64), derivedContractHash: null, currentRunId: null, pendingRunId: null, lineageRunIds: [] }],
  estimates: [], runs: [], checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
});
const textOf = (element: JSX.Element): string => render(element).container.textContent ?? "";

afterEach(cleanup);

describe("the agents area in Chinese", () => {
  it("shows the settings page in Chinese", async () => {
    await i18n.changeLanguage("zh");
    const text = textOf(<AgentSettings agents={agents} preferences={preferences} drafts={{}} onDraft={vi.fn()} onSave={vi.fn()} />);
    for (const expected of [
      "操作者 op-1 · 偏好版本 3。修改只影响之后确认的组；已确认的组保留它冻结的选择。", "安装", "默认模型", "默认上下文", "agent 默认",
      "默认 agent", "无（每个组都得自己选一个）", "codex 的默认值", "估算槽", "协调槽", "模型", "上下文", "继承", "保存 agent 偏好",
    ]) expect(text, expected).toContain(expected);
    cleanup();
    expect(textOf(<AgentSettings agents={{ ...agents, installations: [] }} preferences={preferences} drafts={{}} onDraft={vi.fn()} onSave={vi.fn()} />))
      .toContain("安装表里没有任何 agent。运行 orca agents init");
  });

  it("shows the proposal's agent editor, the confirmed view, the read failure and the retry notice in Chinese", async () => {
    await i18n.changeLanguage("zh");
    const editor = textOf(
      <AgentSelectionEditor view={view("editable")} agents={agents} preview={preview} preferences={preferences.preferences} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()}
        onReread={vi.fn()} retryNotice={retryNotice({ state: "waiting", attempt: 1, delayMs: 10_000 })} />,
    );
    for (const expected of [
      "agent · 提案 v2", "下面有一项选择没有解析成功；每个槽位都解析成功之前不提供确认。", "重新读取 agent 选择", "10 秒后重新读取（第 1/5 次重试）。",
      "组 执行", "设置组 执行 的 agent", "清除组 估算 的 agent", " 从下次重新估算起使用；", "忽略计划里的模型（gpt-plan）", "继承（计划：codex）",
      "这个任务自己的一层", "codex 来自操作者", "gpt-x 来自agent 描述符", "1000000 token 来自计划（组）", "被拒 · agent-installation-missing",
      "协调", "为任务 a 设置 agent", "清除任务 a 的 agent",
    ]) expect(editor, expected).toContain(expected);
    cleanup();
    const confirmed = textOf(<AgentSelectionEditor view={view("confirmed")} agents={agents} preview={null} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    for (const expected of ["agent（确认时已冻结）", "槽位", "未记录", "协调"]) expect(confirmed, expected).toContain(expected);
    cleanup();
    expect(textOf(<AgentSelectionEditor view={view("editable")} agents={null} preview={null} agentsFailure="control-port-unconfigured" drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />))
      .toContain("读不到 agent 选择 · control-port-unconfigured。没有它们就不提供确认。");
    cleanup();
    expect(textOf(<AgentSelectionEditor view={view("editable")} agents={agents} preview={null} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />)).toContain("正在解析 agent 选择…");
    expect(retryNotice({ state: "paused" })).toBe("页面隐藏期间暂停重试；回到页面后继续。");
    expect(retryNotice({ state: "stopped" })).toBe("重试 5 次后已停止；点「重新读取」会再问一次。");
  });
});
```
(`JSX` is the global React namespace type under the web tsconfig's `jsx: "react-jsx"`; if `tsc` asks for it, add `import type { JSX } from "react";` as the other components do.)

In `web/tests/i18nWidth.test.ts` (Task 8's file): add `"agents.th.", "agents.settings.th."` to `NARROW_PREFIXES`, `"agents.reread", "agents.settings.save"` to `BUTTONS`, and raise the guard to `toBeGreaterThanOrEqual(97)`.

- [ ] **Step 2: Run, expect FAIL**

```bash
(cd web && ../node_modules/.bin/vitest run tests/agentsI18n.test.tsx tests/i18nWidth.test.ts) > "$SCRATCH/t9-red.txt" 2>&1; echo rc=$?
```
Expected `rc=1`: `agentsI18n` fails to load (`retryNotice` is not exported); `i18nWidth` red (`agents.*` keys missing).

- [ ] **Step 3: Implement**

`web/src/locales/en.ts`: add `AgentSlotV1, ProvenanceSourceV1` to the `../controlTypes.js` type import and, before `export const en`:
```ts
const agentSlot = { worker: "worker", estimator: "estimator", reconcile: "reconcile" } as const satisfies Record<AgentSlotV1, string>;
const selectionSource = {
  operator: "operator", "operator-estimator": "operator-estimator", "operator-reconcile": "operator-reconcile", group: "group",
  "group-estimator": "group-estimator", "group-reconcile": "group-reconcile", task: "task", "operator-agent": "operator-agent", descriptor: "descriptor",
  "group-plan": "group-plan", "group-reconcile-plan": "group-reconcile-plan", "task-plan": "task-plan",
} as const satisfies Record<ProvenanceSourceV1, string>;
```
In `en`, after `budget`:
```ts
  agents: {
    retryWaiting: "Reading again in {{seconds}} s (retry {{attempt}}/{{total}}).",
    retryPaused: "Retrying is paused while the page is hidden; it resumes when you come back.",
    retryStopped: "Stopped after {{total}} retries; Re-read asks again.",
    contextDefault: "agent default",
    contextTokens: "{{value}} tokens",
    ignorePlan: "ignore the plan's {{field}} ({{value}})",
    field: { agent: "agent", model: "model", contextWindow: "contextWindow" },
    label: { agent: "agent", model: "model", context: "context" },
    inheritPlan: "inherit (plan: {{agent}})",
    inherit: "inherit",
    from: "from {{source}}",
    rejected: "rejected",
    unavailable: "unavailable for now, Re-read to ask again",
    region: "Agent selection",
    frozenTitle: "Agents (frozen at confirmation)",
    th: { slot: "slot", agent: "agent", model: "model", context: "context", ownLayer: "this task's own layer" },
    notRecorded: "not recorded",
    reread: "Re-read agent selections",
    title: "Agents",
    cannotRead: "Agent selections cannot be read · {{code}}. Confirm is not offered without them.",
    resolving: "Resolving agent selections…",
    proposalTitle: "Agents · proposal v{{version}}",
    staleResolution: "The resolution shown is for proposal v{{version}}; re-reading. Confirm waits for it.",
    unresolved: "A selection below did not resolve; confirm is not offered until every slot resolves.",
    groupSlot: "Group {{slot}}",
    setGroup: "Set group {{slot}} agent",
    clearGroup: "Clear group {{slot}} agent",
    estimatorNote: " Used from the next re-estimate on; like any proposal change it moves the proposal version.",
    taskLayer: "Task {{taskId}}",
    setTask: "Set agent for task {{taskId}}",
    clearTask: "Clear agent for task {{taskId}}",
    settings: {
      region: "Agents settings",
      operatorLine: "Operator {{operatorId}} · preferences revision {{revision}}. A change reaches groups confirmed after it; a confirmed group keeps the selection it froze.",
      noInstallations: "The installation table lists no agent. Run orca agents init, point ORCA_AGENTS_TABLE at the table it wrote (by default ~/.orca/agents.json) and restart the panel.",
      th: { installation: "installation", kind: "kind", version: "version", defaultModel: "default model", defaultContext: "default context" },
      defaultAgent: "Default agent",
      noDefault: "none (every group has to choose one)",
      perAgent: "{{agentId}} defaults",
      estimatorSlot: "Estimator slot",
      reconcileSlot: "Reconcile slot",
      save: "Save agent preferences",
    },
  },
```
and in `enums` add `agentSlot, selectionSource`.

`web/src/locales/zh.ts`, after `budget`:
```ts
  agents: {
    retryWaiting: "{{seconds}} 秒后重新读取（第 {{attempt}}/{{total}} 次重试）。",
    retryPaused: "页面隐藏期间暂停重试；回到页面后继续。",
    retryStopped: "重试 {{total}} 次后已停止；点「重新读取」会再问一次。",
    contextDefault: "agent 默认",
    contextTokens: "{{value}} token",
    ignorePlan: "忽略计划里的{{field}}（{{value}}）",
    field: { agent: "agent", model: "模型", contextWindow: "上下文窗口" },
    label: { agent: "agent", model: "模型", context: "上下文" },
    inheritPlan: "继承（计划：{{agent}}）",
    inherit: "继承",
    from: "来自{{source}}",
    rejected: "被拒",
    unavailable: "暂时不可用，点「重新读取」再问一次",
    region: "agent 选择",
    frozenTitle: "agent（确认时已冻结）",
    th: { slot: "槽位", agent: "agent", model: "模型", context: "上下文", ownLayer: "这个任务自己的一层" },
    notRecorded: "未记录",
    reread: "重新读取 agent 选择",
    title: "agent",
    cannotRead: "读不到 agent 选择 · {{code}}。没有它们就不提供确认。",
    resolving: "正在解析 agent 选择…",
    proposalTitle: "agent · 提案 v{{version}}",
    staleResolution: "显示的解析结果属于提案 v{{version}}；正在重新读取。确认会等它。",
    unresolved: "下面有一项选择没有解析成功；每个槽位都解析成功之前不提供确认。",
    groupSlot: "组 {{slot}}",
    setGroup: "设置组 {{slot}} 的 agent",
    clearGroup: "清除组 {{slot}} 的 agent",
    estimatorNote: " 从下次重新估算起使用；和任何提案修改一样，它会推进提案版本。",
    taskLayer: "任务 {{taskId}}",
    setTask: "为任务 {{taskId}} 设置 agent",
    clearTask: "清除任务 {{taskId}} 的 agent",
    settings: {
      region: "agent 设置",
      operatorLine: "操作者 {{operatorId}} · 偏好版本 {{revision}}。修改只影响之后确认的组；已确认的组保留它冻结的选择。",
      noInstallations: "安装表里没有任何 agent。运行 orca agents init，把 ORCA_AGENTS_TABLE 指向它写出的表（默认 ~/.orca/agents.json），然后重启面板。",
      th: { installation: "安装", kind: "类型", version: "版本", defaultModel: "默认模型", defaultContext: "默认上下文" },
      defaultAgent: "默认 agent",
      noDefault: "无（每个组都得自己选一个）",
      perAgent: "{{agentId}} 的默认值",
      estimatorSlot: "估算槽",
      reconcileSlot: "协调槽",
      save: "保存 agent 偏好",
    },
  },
```
and in `enums`:
```ts
    agentSlot: { worker: "执行", estimator: "估算", reconcile: "协调" },
    selectionSource: {
      operator: "操作者", "operator-estimator": "操作者的估算槽", "operator-reconcile": "操作者的协调槽", group: "组",
      "group-estimator": "组的估算槽", "group-reconcile": "组的协调槽", task: "任务", "operator-agent": "操作者对该 agent 的默认", descriptor: "agent 描述符",
      "group-plan": "计划（组）", "group-reconcile-plan": "计划（组协调槽）", "task-plan": "计划（任务）",
    },
```

`web/src/AgentFields.tsx`:
- imports: `import { useTranslation } from "react-i18next";`, `import i18n from "./i18n.js";`
- line 9 → `export const contextLabel = (value: ContextWindowV1): string => (value === "agent-default" ? i18n.t("agents.contextDefault") : i18n.t("agents.contextTokens", { value }));`
- `SelectionFields`: after `const { agents, prefix, drafts, onDraft } = props;` add `const { t } = useTranslation();`; in `maskBox`, `ignore the plan's {field} ({value})` → `{t("agents.ignorePlan", { field: t(`agents.field.${field}`), value })}`; the three label texts `agent`, `model`, `context` → `{t("agents.label.agent")}`, `{t("agents.label.model")}`, `{t("agents.label.context")}`; line 155's option text → `{props.planned?.agent !== undefined && !masked("agent") ? t("agents.inheritPlan", { agent: props.planned.agent }) : t("agents.inherit")}`; line 169 `<option value="">inherit</option>` → `<option value="">{t("agents.inherit")}</option>`.

`web/src/AgentSelectionEditor.tsx`:
- imports: `import { useTranslation } from "react-i18next";`, `import { enumText } from "./i18n.js";`
- `SelectionCells`: first body line `const { t } = useTranslation();`; each `<small>from {provenance.X}</small>` → `<small>{t("agents.from", { source: enumText("selectionSource", provenance.X) })}</small>` (X = `agent`, `model`, `contextWindow`).
- `FailedCell`: first body line `const { t } = useTranslation();`; `{outcome.kind === "rejected" ? "rejected" : "unavailable for now, Re-read to ask again"}` → `{outcome.kind === "rejected" ? t("agents.rejected") : t("agents.unavailable")}`.
- `AgentSelectionEditor`: after `const groupId = view.summary.groupId;` add `const { t } = useTranslation();`; every `aria-label="Agent selection"` (4) → `aria-label={t("agents.region")}`; `<h3>Agents (frozen at confirmation)</h3>` → `<h3>{t("agents.frozenTitle")}</h3>`; both header rows' `<th>slot</th><th>agent</th><th>model</th><th>context</th>` → `<th>{t("agents.th.slot")}</th><th>{t("agents.th.agent")}</th><th>{t("agents.th.model")}</th><th>{t("agents.th.context")}</th>` (the editable table adds `<th>{t("agents.th.ownLayer")}</th>` for `this task's own layer`); both `not recorded` → `{t("agents.notRecorded")}`; `<td>reconcile</td>` → `<td>{enumText("agentSlot", "reconcile")}</td>`; `Re-read agent selections` → `{t("agents.reread")}`; both `<h3>Agents</h3>` → `<h3>{t("agents.title")}</h3>`; the failure alert → `{t("agents.cannotRead", { code: props.agentsFailure })}`; `Resolving agent selections…` → `{t("agents.resolving")}`; `<h3>Agents · proposal v{…}</h3>` → `<h3>{t("agents.proposalTitle", { version: view.proposal.proposalVersion })}</h3>`; the stale notice → `{t("agents.staleResolution", { version: preview.proposalVersion })}`; the unresolved alert → `{t("agents.unresolved")}`; ``label={`Group ${slot}`}`` → `label={t("agents.groupSlot", { slot: enumText("agentSlot", slot) })}`; `Set group {slot} agent` → `{t("agents.setGroup", { slot: enumText("agentSlot", slot) })}`; `Clear group {slot} agent` → `{t("agents.clearGroup", { slot: enumText("agentSlot", slot) })}`; `<small> Used from the next re-estimate on; …</small>` → `<small>{t("agents.estimatorNote")}</small>`; `<td>{taskId ?? "reconcile"}</td>` → `<td>{taskId ?? enumText("agentSlot", "reconcile")}</td>`; ``label={`Task ${taskId}`}`` → `label={t("agents.taskLayer", { taskId: String(taskId) })}`; `Set agent for task {taskId}` → `{t("agents.setTask", { taskId: String(taskId) })}`; `Clear agent for task {taskId}` → `{t("agents.clearTask", { taskId: String(taskId) })}`.

`web/src/AgentSettings.tsx`:
- import `import { useTranslation } from "react-i18next";`
- `AgentSettings`: after `const { agents, preferences, drafts, onDraft } = props;` add `const { t } = useTranslation();`; `aria-label="Agents settings"` → `aria-label={t("agents.settings.region")}`; `<h3>Agents</h3>` → `<h3>{t("agents.title")}</h3>`; the operator paragraph's content → `{t("agents.settings.operatorLine", { operatorId: preferences.operatorId, revision: preferences.revision })}`; the note's content → `{t("agents.settings.noInstallations")}`; the header row → `<th>{t("agents.settings.th.installation")}</th><th>{t("agents.settings.th.kind")}</th><th>{t("agents.settings.th.version")}</th><th>{t("agents.settings.th.defaultModel")}</th><th>{t("agents.settings.th.defaultContext")}</th>`; `Default agent` → `{t("agents.settings.defaultAgent")}`; `<option value="">none (every group has to choose one)</option>` → `<option value="">{t("agents.settings.noDefault")}</option>`; ``label={`${row.id} defaults`}`` → `label={t("agents.settings.perAgent", { agentId: row.id })}`; `label="Estimator slot"` → `label={t("agents.settings.estimatorSlot")}`; `label="Reconcile slot"` → `label={t("agents.settings.reconcileSlot")}`; `Save agent preferences` → `{t("agents.settings.save")}`.

`web/src/App.tsx:116-121`:
```ts
/** Ruling review R17's notice, in the reader's language (panel i18n spec §3.3); exported for the criterion. */
export const retryNotice = (retry: RetryState): string | null => {
  if (retry === null) return null;
  if (retry.state === "waiting") return i18n.t("agents.retryWaiting", { seconds: retry.delayMs / 1000, attempt: retry.attempt, total: AGENT_RETRY_DELAYS_MS.length });
  if (retry.state === "paused") return i18n.t("agents.retryPaused");
  return i18n.t("agents.retryStopped", { total: AGENT_RETRY_DELAYS_MS.length });
};
```
and `type RetryState` (line 115) becomes `export type RetryState`.

- [ ] **Step 4: Run, expect PASS**

```bash
(cd web && ../node_modules/.bin/vitest run tests/agentsI18n.test.tsx tests/i18nWidth.test.ts tests/agentSelectionEditor.test.tsx tests/agentSettings.test.tsx tests/agentPreviewRefresh.test.tsx tests/confirmSelection.test.tsx) > "$SCRATCH/t9-green.txt" 2>&1; echo rc=$?
npm run check --workspace web > "$SCRATCH/t9-web-check.txt" 2>&1; echo rc=$?
```
Expected both `rc=0`.

- [ ] **Step 5: Mutations** (`$SCRATCH/mut-t9`)
  - MT9-1 context label literal: `i18n.t("agents.contextDefault")` → `"agent default"`. Red: `agentsI18n … > shows the settings page …` (`agent 默认`).
  - MT9-2 source raw: in `SelectionCells`, `enumText("selectionSource", provenance.agent)` → `provenance.agent`. Red: `… > shows the proposal's agent editor …` (`codex 来自操作者`).
  - MT9-3 slot raw: in the group legend, `enumText("agentSlot", slot)` → `slot`. Red: same test (`组 执行`).
  - MT9-4 retry notice literal: `i18n.t("agents.retryPaused")` → `"Retrying is paused while the page is hidden; it resumes when you come back."`. Red: same test.
  - MT9-5 refused slot literal: `t("agents.rejected")` → `"rejected"`. Red: same test.
  - MT9-6 width: `zh.agents.settings.th.installation` → `"安装表里的安装项名称"`. Red: `i18nWidth …`.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add web/src/AgentFields.tsx web/src/AgentSelectionEditor.tsx web/src/AgentSettings.tsx web/src/App.tsx web/src/locales/en.ts web/src/locales/zh.ts web/tests/agentsI18n.test.tsx web/tests/i18nWidth.test.ts
/usr/bin/git commit -F - <<'MSG'
feat(web): translate the agents area and the retry notice

The agents settings page, the proposal's agent editor, the confirmed view,
the read failure and the backoff notice read in the chosen language; slots
and selection sources are enum families in words, while agent ids, models,
versions and codes stay as sent.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GCbsgLfqFPgpeG3gTbBkbh
MSG
```

---

