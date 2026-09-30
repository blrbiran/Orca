### Task 7: The task control and recovery areas

**Files:**
- Modify: `web/src/ControlPanel.tsx` (all text except the refusal line `:167-173`, Task 10), `web/src/ControlGroupView.tsx` (all text; the chip is Task 3's), `web/src/TaskDetail.tsx`, `web/src/RecoveryView.tsx`, `web/src/EvidenceLink.tsx`, `web/src/WorkspaceModeSelector.tsx`, `web/src/App.tsx:654`
- Modify: `web/src/locales/en.ts`, `web/src/locales/zh.ts` (`control`, `recovery`; enum families `groupState`, `stopMode`, `stopState`, `workStatus`, `runPhase`, `runState`, `requestState`, `estimateState`, `budgetMode`, `blockerScope`, `progressStep`)
- Create: `web/tests/controlI18n.test.tsx`

**Interfaces:** `progressText(progress)`, `LabelChips`, `EvidenceList`, `EvidenceLink({ runId, label? })` keep their signatures (`web/tests/taskLabels.test.tsx` reads `progressText` unchanged, F10).

**Enum families** (English = the value; Records over the unions of `web/src/controlTypes.ts`):

| Family (union) | 中文 |
|---|---|
| `groupState` (`GroupSummaryV1["state"]`) | draft 草稿 · ready 就绪 · running 运行中 · review 待评审 · done 已完成 · blocked 已阻塞 |
| `stopMode` (`NonNullable<GroupSummaryV1["stopMode"]>`) | pause 暂停 · shutdown 关停 · handoff 交接 |
| `stopState` (`NonNullable<GroupSummaryV1["stopState"]>`) | paused 已暂停 · handoff-pending 交接待处理 · handoff-partial 交接部分完成 · handoff-unresolved 交接未决 · handoff-complete 交接完成 |
| `workStatus` (`WorkItemViewV1["status"]`) | draft 草稿 · ready 就绪 · starting 启动中 · start-unknown 启动情况未知 · active 进行中 · held 已挂起 · continuing 续跑中 · completed 已完成 · blocked 已阻塞 |
| `runPhase` (`RunViewV1["phase"]`) | estimate 估算 · work 工作 · handoff 交接 |
| `runState` (`RunViewV1["state"]`) | starting 启动中 · unknown 未知 · attempt-unknown 尝试情况未知 · attempt-proof-invalid 尝试证明无效 · running 运行中 · failed-before-provider 未到提供方即失败 · settled-recoverable 已结算（可恢复） · settled-restartable 已结算（可重启） · settled-unrecoverable 已结算（不可恢复） · collected 已收集 · landed 已合入 · reconciling 协调中 · blocked 已阻塞 |
| `requestState` (`HandoffRequestViewV1["state"]`) | request-pending 请求待处理 · latched 已锁定 · collecting 收集中 · settled-recoverable 已结算（可恢复） · settled-restartable 已结算（可重启） · settled-unrecoverable 已结算（不可恢复） · outcome-unknown 结果未知 |
| `estimateState` (`EstimateViewV1["state"]`) | queued 排队中 · running 运行中 · start-unknown 启动情况未知 · ready 就绪 · failed 失败 · interrupted 已中断 · blocked-capability 能力不足、已阻塞 · input-too-large 输入过大 |
| `budgetMode` (`EstimateViewV1["mode"]`, also the proposal's and the config's mode) | strict 严格 · soft 宽松 |
| `blockerScope` (`RecoveryViewV1["blockers"][number]["scope"]`) | global 全局 · group 组 · run 运行 |
| `progressStep` (`NonNullable<WorkItemProgressV1["step"]>`) | queued 排队中 · plan 计划 · execute 执行 · verify 验证 · succeeded 已成功 · blocked_waiting_human 等人处理 · exhausted 已耗尽 · cancelled 已取消 · failed 失败 |

**Keys** (the full English and Chinese objects are in Step 3; the site of each key):

| Key | Site (today) | Key | Site (today) |
|---|---|---|---|
| `control.unavailable` | `App.tsx:654` | `control.group.th.*` (7) | `ControlGroupView.tsx:121` |
| `control.title` | `ControlPanel.tsx:105,106` | `control.group.runs` | `:143` |
| `control.summaryLine` | `:107-110` | `control.group.runsTh.*` (7) | `:146` |
| `control.noPort` | `:118-121` | `control.group.attempt` | `:157` |
| `control.resetRequired` / `refetchRequired` / `dispatchBlockedRecovery` | `:123-125` | `control.group.retryRun` | `:165` |
| `control.groupsNav` / `noGroups` | `:131-132` | `control.group.handoffRequests` / `handoffLine` / `handoffEvidence` | `:183,187-188` |
| `control.groupDone` / `groupBlockers` | `:136,138` | `control.group.estimates` / `estimateLine` | `:197,201-202` |
| `control.reading` | `:160` | `control.group.waiting` | `:211` |
| `control.outcomeUnknown` | `:164` | `control.group.dispatch` / `start` / `pause` / `handoffStop` / `resume` | `:214-225` |
| `control.import.*` (7) | `:59-92` | `control.group.continueSelected` / `continueTask` / `resumeNoContinuation` / `retryRecovery` / `recent` | `:233,247,259,267,270` |
| `control.group.region` / `heading` | `ControlGroupView.tsx:82,84` | `control.task.*` | `TaskDetail.tsx:130-163` |
| `control.group.claimBlocked` / `planLine` / `stop` | `:86,88,92-93` | `control.progress.*` | `TaskDetail.tsx:37-47` |
| `control.group.workItems` / `filterRegion` / `filterLegend` | `:107,109,110` | `control.evidence.*` | `TaskDetail.tsx:82-89`, `EvidenceLink.tsx:25-26` |
| `common.none` / `common.na` | `ControlGroupView.tsx:92,93,134-136,157,188,270`, `TaskDetail.tsx:23,164` | `control.workspace.*` | `WorkspaceModeSelector.tsx:12-26` |
| `recovery.*` | `RecoveryView.tsx:22-50` | | |

- [ ] **Step 1: Write the failing criterion** — `web/tests/controlI18n.test.tsx`:

```tsx
// @vitest-environment jsdom
/**
 * Panel i18n spec §3.3, §3.5, §5: the task control and recovery areas in Chinese -- the control summary and its alerts,
 * the import form, the group list, one group (heading, stop, work items, runs, handoff requests, estimates, dispatch
 * buttons), a task's detail with its progress and label draft, recovery blockers, the workspace mode; every enum value
 * in words. Ids, hashes, codes and dates stay as sent.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n.js";
import { ControlPanel } from "../src/ControlPanel.js";
import { TaskDetail, labelsDraftKey } from "../src/TaskDetail.js";
import type { Amount, ControlConfigV1, ControlSummaryV1, GroupViewV1, RecoveryViewV1, RepositoryWorkspaceV1, RunViewV1, WorkItemViewV1 } from "../src/controlTypes.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: 1_000, attempts: 3, sessions: 3 });
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "realtime", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Repo X" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo P" }],
  profiles: [{ profileId: "p1", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-10-01T00:00:00.000Z", probeFailureCode: null }],
  defaults: null, executionPort: "unconfigured", errorCatalog: [],
};
const run: RunViewV1 = {
  runId: "r1", taskId: "a", estimateId: null, generation: 1, state: "blocked", phase: "work", claimOrdinal: null, providerAttemptOrdinal: 2,
  profile: { profileId: "p1", profileHash: "b".repeat(64) }, used: amount(10), remaining: amount(20), failureCode: null, blockedReason: "why-1", evidenceIds: ["e1"],
};
const item: WorkItemViewV1 = {
  taskId: "a", status: "held", dependencyTaskIds: [], targetVersion: 1, configHash: null, originalContractHash: "e".repeat(64), derivedContractHash: null,
  currentRunId: "r1", pendingRunId: null, lineageRunIds: ["r1"], labels: ["bug"], labelsProvenance: "operator", labelsVersion: 1,
  progress: { runId: "r1", step: "blocked_waiting_human", attempt: null, tokens: { used: 5, grant: 0 }, lastTransitionAt: "2026-10-01T00:00:00.000Z" },
};
const view: GroupViewV1 = {
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 4,
  summary: { groupId: "g", state: "running", commandRevision: 6, projectionSeq: 4, stopMode: "pause", stopState: "paused", claimBlocked: true, recoveryBlockerCount: 1 },
  graphVersion: 1, plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "goal-x", successConditions: ["s-1"] },
  proposal: { state: "confirmed", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
  ledger: { groupLimit: amount(100), used: amount(10), committedRemaining: amount(20), explicitUnallocatedReserve: amount(70), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [], workItems: [item],
  estimates: [{ estimateId: "est-1", estimateVersion: 1, state: "interrupted", profile: { profileId: "p1", profileHash: "b".repeat(64) }, mode: "strict", requestHash: null, outputHash: null, output: null, reasonCode: null }],
  runs: [run], checkpoints: [],
  handoffRequests: [{ requestId: "h1", runId: "r1", state: "outcome-unknown", deadlineAt: "2026-10-02T00:00:00.000Z", phaseAttemptOrdinal: 1, failureCode: null, evidenceIds: [] }],
  stop: { mode: "pause", state: "paused", frozenRunIds: [], acceptedAt: null, deadlineAt: null },
  recoveryBlockers: [{ scope: "run", code: "code-1", runId: "r1", evidenceIds: [] }], recentCommandIds: [],
};
const summary: ControlSummaryV1 = {
  schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq: 4, resetRequired: true, dispatchBlocked: true,
  groups: [{ ...view.summary, completion: { done: 0, total: 1 } }],
};
const recovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: true, blockers: [{ scope: "global", groupId: "", runId: null, code: "code-2", evidenceIds: [] }] };
const workspace: RepositoryWorkspaceV1 = { schema: "orca-repository-workspace-v1", repoId: "orca", workspaceMode: "worktree", revision: 1 };

afterEach(cleanup);

describe("the task control and recovery areas in Chinese", () => {
  it("shows the control summary, one group, recovery and the workspace mode in Chinese", async () => {
    await i18n.changeLanguage("zh");
    const { container } = render(
      <ControlPanel config={config} summary={summary} recovery={recovery} groups={{ g: view }} selected="g" drafts={{}} uncertain={[{ groupId: "g", commandId: "c1" }]}
        refusal={null} refetchRequired onSelect={vi.fn()} onDraft={vi.fn()} onCommand={vi.fn()} workspace={workspace} onWorkspaceMode={vi.fn()} />,
    );
    const text = container.textContent ?? "";
    for (const expected of [
      "纪元 epoch-a · 投影 4 · 派发已阻断", "未配置执行端口 · ", "服务端要求重置 · ", "需要重新拉取投影 · ", "派发已阻断 · 必须先观察到恢复",
      "这个面板没有配置估算 profile", "g · 运行中 · 已完成 0/1 · 已暂停 · 1 个阻塞项",
      "g · 运行中 · 版本 6 · 投影 4", "认领已阻断 · ", "goal-x · 计划 aaaaaaaaaaaa · 图 v1", "停止 暂停 已暂停 · 受理于 不适用 · 截止 无 · 0 个冻结的运行：无",
      "工作项", "依赖", "已挂起", "等人处理 · 尝试次数未知 · token 5 / 0", "已阻塞 — why-1 · 第 2 次尝试（认领序号 不适用）", "重试运行 a",
      "交接请求", "h1 · 运行 r1 · 结果未知 · 截止 2026-10-02T00:00:00.000Z · 证据 无", "est-1 · v1 · 已中断 · 严格 · profile p1 bbbbbbbbbbbb",
      "等待台账回答：c1", "派发", "恢复派发", "重试 g 的恢复", "最近的命令：无", "命令结果未知，正在查询：c1 (g)",
      "全局 · 所有组 · code-2", "运行 · g · 运行 r1 · code-1", "运行证据", "重试恢复",
      "orca 里新的运行使用git worktree（设置版本 1）。已开始的运行保持原样。", "git worktree（默认）", "私有克隆",
    ]) expect(text, expected).toContain(expected);
    expect(screen.getAllByRole("button", { name: "证据" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("region", { name: "控制组 g" })).toBeTruthy();
  });

  it("shows a task's detail, its progress and its label draft in Chinese", async () => {
    await i18n.changeLanguage("zh");
    const drafts = { [labelsDraftKey("g", "a")]: JSON.stringify({ base: 0, labels: ["bug", "perf"] }) };
    const text = render(<TaskDetail view={view} item={item} drafts={drafts} onDraft={vi.fn()} onCommand={vi.fn()} />).container.textContent ?? "";
    for (const expected of [
      "任务 a", "标签来自操作者 · 版本 1 · 未保存的草稿", "你开始草稿后标签已变（v0 → v1） · 现在：", "移除 perf", "添加系统标签", "添加自定义标签",
      "保存标签", "丢弃草稿", "恢复计划里的标签", "进度：等人处理 · 尝试次数未知 · token 5 / 0 · 上次变化 2026-10-01T00:00:00.000Z",
      "a 的运行", "r1 · 工作 · 已阻塞", "列出 r1 的证据",
    ]) expect(text, expected).toContain(expected);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
(cd web && ../node_modules/.bin/vitest run tests/controlI18n.test.tsx) > "$SCRATCH/t7-red.txt" 2>&1; echo rc=$?
```
Expected `rc=1`, both tests red.

- [ ] **Step 3: Implement**

`web/src/locales/en.ts`: add to the type import from `../controlTypes.js` (create it if absent): `EstimateViewV1, GroupSummaryV1, HandoffRequestViewV1, RecoveryViewV1, RunViewV1, WorkItemProgressV1, WorkItemViewV1`, and before `export const en`:
```ts
const groupState = { draft: "draft", ready: "ready", running: "running", review: "review", done: "done", blocked: "blocked" } as const satisfies Record<GroupSummaryV1["state"], string>;
const stopMode = { pause: "pause", shutdown: "shutdown", handoff: "handoff" } as const satisfies Record<NonNullable<GroupSummaryV1["stopMode"]>, string>;
const stopState = {
  paused: "paused", "handoff-pending": "handoff-pending", "handoff-partial": "handoff-partial", "handoff-unresolved": "handoff-unresolved", "handoff-complete": "handoff-complete",
} as const satisfies Record<NonNullable<GroupSummaryV1["stopState"]>, string>;
const workStatus = {
  draft: "draft", ready: "ready", starting: "starting", "start-unknown": "start-unknown", active: "active", held: "held", continuing: "continuing", completed: "completed", blocked: "blocked",
} as const satisfies Record<WorkItemViewV1["status"], string>;
const runPhase = { estimate: "estimate", work: "work", handoff: "handoff" } as const satisfies Record<RunViewV1["phase"], string>;
const runState = {
  starting: "starting", unknown: "unknown", "attempt-unknown": "attempt-unknown", "attempt-proof-invalid": "attempt-proof-invalid", running: "running",
  "failed-before-provider": "failed-before-provider", "settled-recoverable": "settled-recoverable", "settled-restartable": "settled-restartable",
  "settled-unrecoverable": "settled-unrecoverable", collected: "collected", landed: "landed", reconciling: "reconciling", blocked: "blocked",
} as const satisfies Record<RunViewV1["state"], string>;
const requestState = {
  "request-pending": "request-pending", latched: "latched", collecting: "collecting", "settled-recoverable": "settled-recoverable",
  "settled-restartable": "settled-restartable", "settled-unrecoverable": "settled-unrecoverable", "outcome-unknown": "outcome-unknown",
} as const satisfies Record<HandoffRequestViewV1["state"], string>;
const estimateState = {
  queued: "queued", running: "running", "start-unknown": "start-unknown", ready: "ready", failed: "failed", interrupted: "interrupted",
  "blocked-capability": "blocked-capability", "input-too-large": "input-too-large",
} as const satisfies Record<EstimateViewV1["state"], string>;
const budgetMode = { strict: "strict", soft: "soft" } as const satisfies Record<EstimateViewV1["mode"], string>;
const blockerScope = { global: "global", group: "group", run: "run" } as const satisfies Record<RecoveryViewV1["blockers"][number]["scope"], string>;
const progressStep = {
  queued: "queued", plan: "plan", execute: "execute", verify: "verify", succeeded: "succeeded", blocked_waiting_human: "blocked_waiting_human",
  exhausted: "exhausted", cancelled: "cancelled", failed: "failed",
} as const satisfies Record<NonNullable<WorkItemProgressV1["step"]>, string>;
```
In `en`, after `chains`:
```ts
  control: {
    unavailable: "The task control plane is not available on this panel.",
    title: "Task control",
    summaryLine: "epoch {{epoch}} · projection {{seq}} · {{dispatch}}",
    noPort: "no execution port configured · this panel serves recovery and evidence, and refuses to start work · set ORCA_CCLOOP_BIN and ORCA_AGENTS_TABLE and restart it",
    resetRequired: "server reset required · this page must re-read before it trusts any cached view",
    refetchRequired: "projection refetch required · re-reading the open groups",
    dispatchBlockedRecovery: "dispatch blocked · recovery must be observed",
    groupsNav: "Control groups",
    noGroups: "No control groups yet.",
    groupDone: " · {{done}}/{{total}} done",
    groupBlockers: " · {{n}} blocker(s)",
    reading: "Reading {{groupId}}…",
    outcomeUnknown: "Command outcome unknown, being looked up: {{commands}}",
    import: {
      region: "Import plan",
      title: "Import a plan",
      noEstimator: "No estimator profile is configured for this panel, so a plan cannot be imported. Restart it with --estimator-profile and --estimate-mode.",
      noRepository: "No trusted repository and plan are configured for this panel.",
      summary: "{{repository}} · {{plan}} · estimate mode {{mode}}",
      notConfigured: "not configured",
      button: "Import plan",
    },
    group: {
      region: "Control group {{groupId}}",
      heading: "{{groupId}} · {{state}} · revision {{revision}} · projection {{projection}}",
      claimBlocked: "claim blocked · new runs are not being started",
      planLine: "{{goal}} · plan {{hash}} · graph v{{graphVersion}}",
      stop: "stop {{mode}} {{state}} · accepted {{accepted}} · deadline {{deadline}} · {{n}} frozen run(s): {{runs}}",
      workItems: "Work items",
      filterRegion: "Filter work items by label",
      filterLegend: "labels (any of)",
      th: { task: "task", status: "status", labels: "labels", progress: "progress", run: "run", pending: "pending", dependsOn: "depends on" },
      runs: "Runs",
      runsTh: { run: "run", phase: "phase", state: "state", profile: "profile", used: "used", remaining: "remaining", evidence: "evidence" },
      attempt: " · attempt {{attempt}} of claim {{claim}}",
      retryRun: "Retry run {{id}}",
      handoffRequests: "Handoff requests",
      handoffLine: "{{requestId}} · run {{runId}} · {{state}} · deadline {{deadline}}",
      handoffEvidence: " · evidence {{ids}}",
      estimates: "Estimates",
      estimateLine: "{{estimateId}} · v{{version}} · {{state}} · {{mode}} profile {{profileId}} {{hash}}",
      waiting: "Waiting for the ledger to answer: {{commands}}",
      dispatch: "Dispatch",
      start: "Start",
      pause: "Pause dispatch",
      handoffStop: "Handoff stop",
      resume: "Resume dispatch",
      continueSelected: "Continue selected tasks ({{n}})",
      continueTask: "Continue task {{taskId}}",
      resumeNoContinuation: "Resume (no continuation)",
      retryRecovery: "Retry recovery for {{groupId}}",
      recent: "Recent commands: {{commands}}",
    },
    task: {
      region: "Task {{taskId}}",
      labelsFrom: "labels from {{source}} · version {{version}}",
      labelSource: { plan: "plan", operator: "operator" },
      unsavedDraft: " · unsaved draft",
      labelsChanged: "labels changed since your draft (v{{base}} → v{{current}}) · now: ",
      labelsOf: "Labels of {{taskId}}",
      remove: "Remove {{label}}",
      systemLabel: "System label",
      addSystem: "Add system label",
      customLabel: "Custom label",
      addCustom: "Add custom label",
      save: "Save labels",
      discard: "Discard draft",
      restore: "Restore plan labels",
      progress: "progress: {{progress}}",
      lastTransition: " · last transition {{at}}",
      runsOf: "Runs of {{taskId}}",
    },
    progress: {
      noRun: "no run",
      notReported: "not reported yet",
      attemptUnknown: "attempt unknown",
      attempt: "attempt {{current}}/{{max}}",
      tokensUnknown: "tokens unknown",
      tokensOfZero: "tokens {{used}} of 0",
      tokensPercent: "tokens {{percent}}% (reported at phase end)",
      line: "{{step}} · {{attempt}} · {{tokens}}",
    },
    evidence: {
      button: "evidence",
      refused: "evidence refused · {{code}}",
      list: "List evidence of {{runId}}",
      none: " no evidence",
      region: "Evidence of {{runId}}",
      entry: "{{id}} · {{kind}} · {{bytes}} bytes",
      download: "Download {{id}}",
    },
    workspace: {
      region: "Workspace mode",
      line: "New runs in {{repoId}} use {{mode}} (setting revision {{revision}}). Runs already started keep theirs.",
      aWorktree: "a git worktree",
      aClone: "a private clone",
      worktreeOption: "git worktree (default)",
      cloneOption: "private clone",
    },
  },
  recovery: {
    title: "Recovery",
    none: "No recovery blockers.",
    retry: "Retry recovery",
    dispatchBlocked: "dispatch blocked · the panel will not start new runs until recovery is observed",
    allGroups: "all groups",
    run: " · run {{runId}}",
    evidence: " · evidence {{ids}}",
    runEvidence: "run evidence",
  },
```
and in `enums` add `groupState, stopMode, stopState, workStatus, runPhase, runState, requestState, estimateState, budgetMode, blockerScope, progressStep`.

`web/src/locales/zh.ts`, after `chains`:
```ts
  control: {
    unavailable: "这个面板上没有任务控制面。",
    title: "任务控制",
    summaryLine: "纪元 {{epoch}} · 投影 {{seq}} · {{dispatch}}",
    noPort: "未配置执行端口 · 这个面板提供恢复和证据，但拒绝开始工作 · 设置 ORCA_CCLOOP_BIN 和 ORCA_AGENTS_TABLE 后重启它",
    resetRequired: "服务端要求重置 · 本页必须重新读取，才能信任任何缓存的视图",
    refetchRequired: "需要重新拉取投影 · 正在重新读取打开的组",
    dispatchBlockedRecovery: "派发已阻断 · 必须先观察到恢复",
    groupsNav: "控制组",
    noGroups: "还没有控制组。",
    groupDone: " · 已完成 {{done}}/{{total}}",
    groupBlockers: " · {{n}} 个阻塞项",
    reading: "正在读取 {{groupId}}…",
    outcomeUnknown: "命令结果未知，正在查询：{{commands}}",
    import: {
      region: "导入计划",
      title: "导入一个计划",
      noEstimator: "这个面板没有配置估算 profile，所以不能导入计划。请带上 --estimator-profile 和 --estimate-mode 重启它。",
      noRepository: "这个面板没有配置受信任的仓库和计划。",
      summary: "{{repository}} · {{plan}} · 估算模式 {{mode}}",
      notConfigured: "未配置",
      button: "导入计划",
    },
    group: {
      region: "控制组 {{groupId}}",
      heading: "{{groupId}} · {{state}} · 版本 {{revision}} · 投影 {{projection}}",
      claimBlocked: "认领已阻断 · 不再启动新的运行",
      planLine: "{{goal}} · 计划 {{hash}} · 图 v{{graphVersion}}",
      stop: "停止 {{mode}} {{state}} · 受理于 {{accepted}} · 截止 {{deadline}} · {{n}} 个冻结的运行：{{runs}}",
      workItems: "工作项",
      filterRegion: "按标签筛选工作项",
      filterLegend: "标签（任一）",
      th: { task: "任务", status: "状态", labels: "标签", progress: "进度", run: "运行", pending: "待定", dependsOn: "依赖" },
      runs: "运行",
      runsTh: { run: "运行", phase: "阶段", state: "状态", profile: "配置", used: "已用", remaining: "剩余", evidence: "证据" },
      attempt: " · 第 {{attempt}} 次尝试（认领序号 {{claim}}）",
      retryRun: "重试运行 {{id}}",
      handoffRequests: "交接请求",
      handoffLine: "{{requestId}} · 运行 {{runId}} · {{state}} · 截止 {{deadline}}",
      handoffEvidence: " · 证据 {{ids}}",
      estimates: "估算",
      estimateLine: "{{estimateId}} · v{{version}} · {{state}} · {{mode}} · profile {{profileId}} {{hash}}",
      waiting: "等待台账回答：{{commands}}",
      dispatch: "派发",
      start: "开跑",
      pause: "暂停派发",
      handoffStop: "交接停止",
      resume: "恢复派发",
      continueSelected: "继续选中的任务（{{n}}）",
      continueTask: "继续任务 {{taskId}}",
      resumeNoContinuation: "恢复（不续跑）",
      retryRecovery: "重试 {{groupId}} 的恢复",
      recent: "最近的命令：{{commands}}",
    },
    task: {
      region: "任务 {{taskId}}",
      labelsFrom: "标签来自{{source}} · 版本 {{version}}",
      labelSource: { plan: "计划", operator: "操作者" },
      unsavedDraft: " · 未保存的草稿",
      labelsChanged: "你开始草稿后标签已变（v{{base}} → v{{current}}） · 现在：",
      labelsOf: "{{taskId}} 的标签",
      remove: "移除 {{label}}",
      systemLabel: "系统标签",
      addSystem: "添加系统标签",
      customLabel: "自定义标签",
      addCustom: "添加自定义标签",
      save: "保存标签",
      discard: "丢弃草稿",
      restore: "恢复计划里的标签",
      progress: "进度：{{progress}}",
      lastTransition: " · 上次变化 {{at}}",
      runsOf: "{{taskId}} 的运行",
    },
    progress: {
      noRun: "没有运行",
      notReported: "尚未上报",
      attemptUnknown: "尝试次数未知",
      attempt: "尝试 {{current}}/{{max}}",
      tokensUnknown: "token 未知",
      tokensOfZero: "token {{used}} / 0",
      tokensPercent: "token {{percent}}%（阶段结束时上报）",
      line: "{{step}} · {{attempt}} · {{tokens}}",
    },
    evidence: {
      button: "证据",
      refused: "证据被拒 · {{code}}",
      list: "列出 {{runId}} 的证据",
      none: " 没有证据",
      region: "{{runId}} 的证据",
      entry: "{{id}} · {{kind}} · {{bytes}} 字节",
      download: "下载 {{id}}",
    },
    workspace: {
      region: "工作区模式",
      line: "{{repoId}} 里新的运行使用{{mode}}（设置版本 {{revision}}）。已开始的运行保持原样。",
      aWorktree: "git worktree",
      aClone: "私有克隆",
      worktreeOption: "git worktree（默认）",
      cloneOption: "私有克隆",
    },
  },
  recovery: {
    title: "恢复",
    none: "没有恢复阻塞项。",
    retry: "重试恢复",
    dispatchBlocked: "派发已阻断 · 在观察到恢复之前，面板不会启动新的运行",
    allGroups: "所有组",
    run: " · 运行 {{runId}}",
    evidence: " · 证据 {{ids}}",
    runEvidence: "运行证据",
  },
```
and in `enums`:
```ts
    groupState: { draft: "草稿", ready: "就绪", running: "运行中", review: "待评审", done: "已完成", blocked: "已阻塞" },
    stopMode: { pause: "暂停", shutdown: "关停", handoff: "交接" },
    stopState: { paused: "已暂停", "handoff-pending": "交接待处理", "handoff-partial": "交接部分完成", "handoff-unresolved": "交接未决", "handoff-complete": "交接完成" },
    workStatus: { draft: "草稿", ready: "就绪", starting: "启动中", "start-unknown": "启动情况未知", active: "进行中", held: "已挂起", continuing: "续跑中", completed: "已完成", blocked: "已阻塞" },
    runPhase: { estimate: "估算", work: "工作", handoff: "交接" },
    runState: {
      starting: "启动中", unknown: "未知", "attempt-unknown": "尝试情况未知", "attempt-proof-invalid": "尝试证明无效", running: "运行中",
      "failed-before-provider": "未到提供方即失败", "settled-recoverable": "已结算（可恢复）", "settled-restartable": "已结算（可重启）",
      "settled-unrecoverable": "已结算（不可恢复）", collected: "已收集", landed: "已合入", reconciling: "协调中", blocked: "已阻塞",
    },
    requestState: {
      "request-pending": "请求待处理", latched: "已锁定", collecting: "收集中", "settled-recoverable": "已结算（可恢复）",
      "settled-restartable": "已结算（可重启）", "settled-unrecoverable": "已结算（不可恢复）", "outcome-unknown": "结果未知",
    },
    estimateState: { queued: "排队中", running: "运行中", "start-unknown": "启动情况未知", ready: "就绪", failed: "失败", interrupted: "已中断", "blocked-capability": "能力不足、已阻塞", "input-too-large": "输入过大" },
    budgetMode: { strict: "严格", soft: "宽松" },
    blockerScope: { global: "全局", group: "组", run: "运行" },
    progressStep: { queued: "排队中", plan: "计划", execute: "执行", verify: "验证", succeeded: "已成功", blocked_waiting_human: "等人处理", exhausted: "已耗尽", cancelled: "已取消", failed: "失败" },
```

`web/src/ControlPanel.tsx`:
- imports: `import { useTranslation } from "react-i18next";`, `import { enumText } from "./i18n.js";`
- `ImportForm`: first body line `const { t } = useTranslation();`; `aria-label="Import plan"` → `aria-label={t("control.import.region")}`; `<h3>Import a plan</h3>` → `<h3>{t("control.import.title")}</h3>`; the two notes → `{t("control.import.noEstimator")}` and `{t("control.import.noRepository")}`; the summary paragraph's content → `{t("control.import.summary", { repository: repository.displayName, plan: plan.displayName, mode: props.config.defaults === null ? t("control.import.notConfigured") : enumText("budgetMode", props.config.defaults.estimateMode) })}`; button text `Import plan` → `{t("control.import.button")}`.
- `ControlPanel`: first body line `const { t } = useTranslation();`; `aria-label="Task control"` → `aria-label={t("control.title")}`; `<h2>Task control</h2>` → `<h2>{t("control.title")}</h2>`; the summary paragraph's content (lines 108-109) → `{t("control.summaryLine", { epoch: summary.epoch, seq: summary.changeSeq, dispatch: t(summary.dispatchBlocked ? "common.dispatchBlocked" : "common.dispatchLive") })}`; the four alerts' contents → `{t("control.noPort")}`, `{t("control.resetRequired")}`, `{t("control.refetchRequired")}`, `{t("control.dispatchBlockedRecovery")}`; `aria-label="Control groups"` → `aria-label={t("control.groupsNav")}`; `No control groups yet.` → `{t("control.noGroups")}`; the group button (lines 135-138) →
  ```tsx
            {group.groupId} · {enumText("groupState", group.state)}
            {group.completion !== undefined ? t("control.groupDone", { done: group.completion.done, total: group.completion.total }) : ""}
            {group.stopState !== null ? ` · ${enumText("stopState", group.stopState)}` : ""}
            {group.recoveryBlockerCount > 0 ? t("control.groupBlockers", { n: group.recoveryBlockerCount }) : ""}
  ```
  `Reading {selected}…` → `{t("control.reading", { groupId: selected })}`; `Command outcome unknown, being looked up: {…}` → `{t("control.outcomeUnknown", { commands: waiting.map((command) => `${command.commandId} (${command.groupId})`).join(", ") })}`.

`web/src/ControlGroupView.tsx`:
- imports: `import { useTranslation } from "react-i18next";`, `import { enumText } from "./i18n.js";`
- body: after `const { view, config, uncertain, drafts, onDraft, onCommand } = props;` add `const { t } = useTranslation();`
- replacements (today → becomes):

| Line | Today | Becomes |
|---|---|---|
| 82 | ``aria-label={`Control group ${groupId}`}`` | `aria-label={t("control.group.region", { groupId })}` |
| 84 | `{groupId} · {view.summary.state} · revision {revision} · projection {view.summary.projectionSeq}` | `{t("control.group.heading", { groupId, state: enumText("groupState", view.summary.state), revision, projection: view.summary.projectionSeq })}` |
| 86 | `claim blocked · new runs are not being started` | `{t("control.group.claimBlocked")}` |
| 88 | `{view.plan.goal} · plan {short(view.plan.planHash)} · graph v{view.graphVersion}` | `{t("control.group.planLine", { goal: view.plan.goal, hash: short(view.plan.planHash), graphVersion: view.graphVersion })}` |
| 92-93 | `stop {view.stop.mode} {view.stop.state} · accepted … {view.stop.frozenRunIds.join(", ") \|\| "none"}` | `{t("control.group.stop", { mode: enumText("stopMode", view.stop.mode), state: enumText("stopState", view.stop.state), accepted: view.stop.acceptedAt ?? t("common.na"), deadline: view.stop.deadlineAt ?? t("common.none"), n: view.stop.frozenRunIds.length, runs: view.stop.frozenRunIds.join(", ") \|\| t("common.none") })}` |
| 107 | `<h3>Work items</h3>` | `<h3>{t("control.group.workItems")}</h3>` |
| 109 | `aria-label="Filter work items by label"` | `aria-label={t("control.group.filterRegion")}` |
| 110 | `<legend>labels (any of)</legend>` | `<legend>{t("control.group.filterLegend")}</legend>` |
| 121 | `<th>task</th>…<th>depends on</th>` | `<th>{t("control.group.th.task")}</th><th>{t("control.group.th.status")}</th><th>{t("control.group.th.labels")}</th><th>{t("control.group.th.progress")}</th><th>{t("control.group.th.run")}</th><th>{t("control.group.th.pending")}</th><th>{t("control.group.th.dependsOn")}</th>` |
| 131 | `<td>{item.status}</td>` | `<td>{enumText("workStatus", item.status)}</td>` |
| 134 | `{item.currentRunId ?? "none"}` | `{item.currentRunId ?? t("common.none")}` |
| 135 | `{item.pendingRunId ?? "none"}` | `{item.pendingRunId ?? t("common.none")}` |
| 136 | `{item.dependencyTaskIds.join(", ") \|\| "none"}` | `{item.dependencyTaskIds.join(", ") \|\| t("common.none")}` |
| 143 | `<h3>Runs</h3>` | `<h3>{t("control.group.runs")}</h3>` |
| 146 | `<th>run</th>…<th>evidence</th>` | the seven `<th>{t("control.group.runsTh.<run\|phase\|state\|profile\|used\|remaining\|evidence>")}</th>` in that order |
| 152 | `<td>{run.phase}</td>` | `<td>{enumText("runPhase", run.phase)}</td>` |
| 154 | `{run.state}` | `{enumText("runState", run.state)}` |
| 157 | ``{` · attempt ${run.providerAttemptOrdinal} of claim ${run.claimOrdinal ?? "n/a"}`}`` | `{t("control.group.attempt", { attempt: run.providerAttemptOrdinal, claim: run.claimOrdinal ?? t("common.na") })}` |
| 165 | `Retry run {run.taskId ?? run.runId}` | `{t("control.group.retryRun", { id: run.taskId ?? run.runId })}` |
| 183 | `<h3>Handoff requests</h3>` | `<h3>{t("control.group.handoffRequests")}</h3>` |
| 187 | `{request.requestId} · run {request.runId} · {request.state} · deadline {request.deadlineAt}` | `{t("control.group.handoffLine", { requestId: request.requestId, runId: request.runId, state: enumText("requestState", request.state), deadline: request.deadlineAt })}` |
| 188 | `… · evidence {request.evidenceIds.join(", ") \|\| "none"}` (after the failure-code expression) | `{t("control.group.handoffEvidence", { ids: request.evidenceIds.join(", ") \|\| t("common.none") })}` |
| 197 | `<h3>Estimates</h3>` | `<h3>{t("control.group.estimates")}</h3>` |
| 201-202 | `{estimate.estimateId} · v{estimate.estimateVersion} · {estimate.state} · {estimate.mode} profile{" "}` / `{estimate.profile.profileId} {short(estimate.profile.profileHash)}` | `{t("control.group.estimateLine", { estimateId: estimate.estimateId, version: estimate.estimateVersion, state: enumText("estimateState", estimate.state), mode: enumText("budgetMode", estimate.mode), profileId: estimate.profile.profileId, hash: short(estimate.profile.profileHash) })}` (the `reasonCode` line after it is unchanged) |
| 211 | `Waiting for the ledger to answer: {…}` | `{t("control.group.waiting", { commands: uncertain.map((command) => command.commandId).join(", ") })}` |
| 214 | `<h3>Dispatch</h3>` | `<h3>{t("control.group.dispatch")}</h3>` |
| 216 | `>Start</button>` | `>{t("control.group.start")}</button>` |
| 220 | `>Pause dispatch</button>` | `>{t("control.group.pause")}</button>` |
| 221 | `>Handoff stop</button>` | `>{t("control.group.handoffStop")}</button>` |
| 225 | `>Resume dispatch</button>` | `>{t("control.group.resume")}</button>` |
| 233 | `Continue selected tasks ({continuable.length})` | `{t("control.group.continueSelected", { n: continuable.length })}` |
| 247 | `Continue task {run.taskId}` | `{t("control.group.continueTask", { taskId: String(run.taskId) })}` |
| 259 | `Resume (no continuation)` | `{t("control.group.resumeNoContinuation")}` |
| 267 | `Retry recovery for {groupId}` | `{t("control.group.retryRecovery", { groupId })}` |
| 270 | `<p>Recent commands: {view.recentCommandIds.join(", ") \|\| "none"}</p>` | `<p>{t("control.group.recent", { commands: view.recentCommandIds.join(", ") \|\| t("common.none") })}</p>` |

`web/src/TaskDetail.tsx`:
- imports: `import { useTranslation } from "react-i18next";`, `import i18n, { enumText } from "./i18n.js";`
- `LabelChips`: first body line `const { t } = useTranslation();`; `return <>none</>;` → `return <>{t("common.none")}</>;`
- doc of `progressText` (lines 33-36): `(finding F10: the panel speaks English)` → `(panel i18n spec §3.3: in the reader's language)`; body:
```ts
export function progressText(progress: WorkItemProgressV1 | null | undefined): string {
  if (progress === undefined || progress === null) return i18n.t("control.progress.noRun");
  const step = progress.step === null ? i18n.t("control.progress.notReported") : enumText("progressStep", progress.step);
  const attempt = progress.attempt === null
    ? i18n.t("control.progress.attemptUnknown")
    : i18n.t("control.progress.attempt", { current: progress.attempt.current, max: progress.attempt.max });
  const tokens = progress.tokens === null
    ? i18n.t("control.progress.tokensUnknown")
    : progress.tokens.grant === 0
      ? i18n.t("control.progress.tokensOfZero", { used: progress.tokens.used })
      : i18n.t("control.progress.tokensPercent", { percent: Math.floor((progress.tokens.used * 100) / progress.tokens.grant) });
  return i18n.t("control.progress.line", { step, attempt, tokens });
}
```
- `EvidenceList`: first body line `const { t } = useTranslation();`; `List evidence of {props.runId}` → `{t("control.evidence.list", { runId: props.runId })}`; ``{`evidence refused · ${refusal}`}`` → `{t("control.evidence.refused", { code: refusal })}`; `<span> no evidence</span>` → `<span>{t("control.evidence.none")}</span>`; ``aria-label={`Evidence of ${props.runId}`}`` → `aria-label={t("control.evidence.region", { runId: props.runId })}`; `{entry.evidenceId} · {entry.kind} · {entry.byteLength} bytes{" "}` → `{t("control.evidence.entry", { id: entry.evidenceId, kind: entry.kind, bytes: entry.byteLength })}{" "}`; `Download {entry.evidenceId}` → `{t("control.evidence.download", { id: entry.evidenceId })}`.
- `TaskDetail`: after `const { view, item, drafts, onDraft, onCommand } = props;` add `const { t } = useTranslation();`; ``aria-label={`Task ${item.taskId}`}`` → `aria-label={t("control.task.region", { taskId: item.taskId })}`; `<h4>Task {item.taskId}</h4>` → `<h4>{t("control.task.region", { taskId: item.taskId })}</h4>`; lines 133-134 → `{t("control.task.labelsFrom", { source: t(`control.task.labelSource.${item.labelsProvenance ?? "plan"}`), version: item.labelsVersion ?? 0 })}` and `{draft !== null ? t("control.task.unsavedDraft") : ""}`; line 138 → `{t("control.task.labelsChanged", { base: draft.base, current })}<LabelChips labels={item.labels} />`; ``aria-label={`Labels of ${item.taskId}`}`` → `aria-label={t("control.task.labelsOf", { taskId: item.taskId })}`; `Remove {label}` → `{t("control.task.remove", { label })}`; `aria-label="System label"` → `aria-label={t("control.task.systemLabel")}`; `Add system label` → `{t("control.task.addSystem")}`; `aria-label="Custom label"` → `aria-label={t("control.task.customLabel")}`; `Add custom label` → `{t("control.task.addCustom")}`; `Save labels` → `{t("control.task.save")}`; `Discard draft` → `{t("control.task.discard")}`; `Restore plan labels` → `{t("control.task.restore")}`; lines 159-160 → `{t("control.task.progress", { progress: progressText(item.progress) })}` and ``{item.progress?.lastTransitionAt ? t("control.task.lastTransition", { at: item.progress.lastTransitionAt }) : ""}``; `<h5>Runs of {item.taskId}</h5>` → `<h5>{t("control.task.runsOf", { taskId: item.taskId })}</h5>`; `<p>none</p>` → `<p>{t("common.none")}</p>`; `{run.runId} · {run.phase} · {run.state} <EvidenceList …/>` → `{run.runId} · {enumText("runPhase", run.phase)} · {enumText("runState", run.state)} <EvidenceList runId={run.runId} />`.

`web/src/RecoveryView.tsx`: imports `import { useTranslation } from "react-i18next";`, `import { enumText } from "./i18n.js";`; first body line `const { t } = useTranslation();`; both `aria-label="Recovery"` → `aria-label={t("recovery.title")}`; `No recovery blockers.` → `{t("recovery.none")}`; button `Retry recovery` → `{t("recovery.retry")}`; `<h3>Recovery</h3>` → `<h3>{t("recovery.title")}</h3>`; the alert → `{t("recovery.dispatchBlocked")}`; lines 36-38 →
```tsx
            {enumText("blockerScope", blocker.scope)} · {blocker.groupId === "" ? t("recovery.allGroups") : blocker.groupId}
            {blocker.runId !== null ? t("recovery.run", { runId: blocker.runId }) : ""} · {blocker.code}
            {blocker.evidenceIds.length > 0 ? t("recovery.evidence", { ids: blocker.evidenceIds.join(", ") }) : ""}
```
lines 45-47 the same with `{group?.summary.groupId}` in place of the group-id expression; `label="run evidence"` → `label={t("recovery.runEvidence")}`.

`web/src/EvidenceLink.tsx`: imports `import { useTranslation } from "react-i18next";`; first body line `const { t } = useTranslation();`; `{props.label ?? "evidence"}` → `{props.label ?? t("control.evidence.button")}`; ``{`evidence refused · ${refusal}`}`` → `{t("control.evidence.refused", { code: refusal })}`.

`web/src/WorkspaceModeSelector.tsx`: import `import { useTranslation } from "react-i18next";`; first body line `const { t } = useTranslation();`; `aria-label="Workspace mode"` → `aria-label={t("control.workspace.region")}`; `<h3>Workspace mode</h3>` → `<h3>{t("control.workspace.region")}</h3>`; the paragraph's content → `{t("control.workspace.line", { repoId: workspace.repoId, mode: t(workspace.workspaceMode === "worktree" ? "control.workspace.aWorktree" : "control.workspace.aClone"), revision: workspace.revision })}`; `{mode === "worktree" ? "git worktree (default)" : "private clone"}` → `{t(mode === "worktree" ? "control.workspace.worktreeOption" : "control.workspace.cloneOption")}`.

`web/src/App.tsx:654`: `<p className="empty">The task control plane is not available on this panel.</p>` → `<p className="empty">{t("control.unavailable")}</p>`.

- [ ] **Step 4: Run, expect PASS**

```bash
(cd web && ../node_modules/.bin/vitest run tests/controlI18n.test.tsx) > "$SCRATCH/t7-green.txt" 2>&1; echo rc=$?
npm run check --workspace web > "$SCRATCH/t7-web-check.txt" 2>&1; echo rc=$?
```
Expected both `rc=0`; every existing control criterion (`controlPanel`, `controlKeys`, `taskLabels*`, `evidenceLink`, `workspaceMode`, `handoffResume`, `driverRetry`, `controlPortBanner`, `controlRefetch`, `controlCommandRecovery`, …) unmodified and green.

- [ ] **Step 5: Mutations** (`$SCRATCH/mut-t7`; criterion `(cd "$M/web" && ../node_modules/.bin/vitest run tests/controlI18n.test.tsx)`)
  - MT7-1 work status raw: `enumText("workStatus", item.status)` → `item.status`. Red: `… > shows the control summary …` (`已挂起`).
  - MT7-2 step raw: in `progressText`, `enumText("progressStep", progress.step)` → `progress.step`. Red: both tests (`等人处理 · …`).
  - MT7-3 all groups literal: `t("recovery.allGroups")` → `"all groups"`. Red: `… > shows the control summary …`.
  - MT7-4 workspace phrase literal: `t(workspace.workspaceMode === "worktree" ? … : …)` → `workspace.workspaceMode === "worktree" ? "a git worktree" : "a private clone"`. Red: same test.
  - MT7-5 evidence button literal: `props.label ?? t("control.evidence.button")` → `props.label ?? "evidence"`. Red: same test (`getAllByRole("button", { name: "证据" })`).
  - MT7-6 stop state raw in the group list: `` ` · ${enumText("stopState", group.stopState)}` `` → `` ` · ${group.stopState}` ``. Red: same test.
  - MT7-7 label source raw: `t(`control.task.labelSource.${…}`)` → `item.labelsProvenance ?? "plan"`. Red: `… > shows a task's detail …`.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add web/src/ControlPanel.tsx web/src/ControlGroupView.tsx web/src/TaskDetail.tsx web/src/RecoveryView.tsx web/src/EvidenceLink.tsx web/src/WorkspaceModeSelector.tsx web/src/App.tsx web/src/locales/en.ts web/src/locales/zh.ts web/tests/controlI18n.test.tsx
/usr/bin/git commit -F - <<'MSG'
feat(web): translate the task control and recovery areas

The control summary and its alerts, the import form, the group list, one
group's work items, runs, handoff requests, estimates and dispatch buttons, a
task's detail, recovery blockers and the workspace mode read in the chosen
language. Group, stop, work, run, request, estimate, blocker and progress
states are enum families in words; ids, hashes, codes and dates stay as sent.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GCbsgLfqFPgpeG3gTbBkbh
MSG
```

---

