### Task 8: The budget editor and the rest of the loop card; the width proxy

**Files:**
- Modify: `web/src/BudgetEditor.tsx` (imports; `provenanceText` :41-44; render :240-431)
- Modify: `web/src/LoopPlanCard.tsx` (`FIELD_LABEL`/`BAD_BUDGET`/`BAD_FILE_CAP` :25-31; `payloadOf` :69,72; `consequenceOf` :85-96; `LoopPlanEditor` :106-147; `LoopPlanCard` :149-184)
- Modify: `web/src/locales/en.ts`, `web/src/locales/zh.ts` (`budget`; `loopPlan` additions; enum families `proposalState`, `ownerKind`, `bucket`, `allocationState`, `dimension`, `complexity`, `confidence`, `handoffControl`, `handoffExecution`, `budgetEnforcement`, `fieldProvenance`)
- Create: `web/tests/budgetI18n.test.tsx`, `web/tests/i18nWidth.test.ts`

**Interfaces:** `provenanceText(provenance)`, `consequenceOf(view, current, work)` keep their signatures (they translate at call time); `FIELD_LABEL`, `BAD_BUDGET`, `BAD_FILE_CAP` (module-private) become key lookups.

**Enum families:**

| Family (union) | 中文 |
|---|---|
| `proposalState` (`GroupViewV1["proposal"]["state"]`) | editable 可编辑 · confirmed 已确认 |
| `ownerKind` (`AllocationViewV1["ownerKind"]`) | estimate 估算 · task 任务 · goal-review 目标评审 · reserve 余量 |
| `bucket` (`AllocationViewV1["bucket"]`) | work 工作 · handoff 交接 · review 评审 · reserve 余量 |
| `allocationState` (`AllocationViewV1["state"]`) | draft-encumbered 草稿占用 · confirmed 已确认 · active 进行中 · held 已挂起 · continuing 续跑中 · terminal 已终结 · unknown 未知 |
| `dimension` (`AmountDimensionV1`) | tokens token · activeMs 活跃毫秒 · attempts 尝试次数 · sessions 会话数 |
| `complexity` (`BudgetEstimateV1["tasks"][number]["complexity"]`) | S S · M M · L L · XL XL |
| `confidence` (`BudgetEstimateV1["tasks"][number]["confidence"]`) | low 低 · medium 中 · high 高 |
| `handoffControl` (`CapabilityViewV1["handoffControl"]`) | durable 持久 · phase-end 阶段结束时 · unavailable 不可用 |
| `handoffExecution` (`NonNullable<CapabilityViewV1["handoffExecution"]>`) | mechanical-in-run-v1 运行内机械交接 v1 · model-assisted-v1 模型辅助交接 v1 |
| `budgetEnforcement` (`CapabilityViewV1["budgetEnforcement"]`) | bounded 有界 · soft 宽松 · unavailable 不可用 |
| `fieldProvenance` (`FieldProvenanceV1["provenance"]`) | complex-1m-default: English `complex-1m default` (today's text), 中文 `complex-1m 默认值` · model 模型 · human 人 · system 系统 |

- [ ] **Step 1: Write the failing criteria**

`web/tests/budgetI18n.test.tsx`:

```tsx
// @vitest-environment jsdom
/**
 * Panel i18n spec §3.3, §3.5, §5: the budget editor (its notes, table, suggestion buttons and their accessible names,
 * rationale, limit and ledger line) and the loop card (the read-only card, the change form with its labels, the draft
 * notice, the invalid-number message and the consequence of a change) in Chinese.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BudgetEditor } from "../src/BudgetEditor.js";
import i18n from "../src/i18n.js";
import { LoopPlanCard, loopDraftKey } from "../src/LoopPlanCard.js";
import type { Amount, ControlConfigV1, GroupViewV1, LoopPlanViewV1, WorkItemViewV1 } from "../src/controlTypes.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: 14_400_000, attempts: 3, sessions: 3 });
const human = { provenance: "human", estimateId: null } as const;
const provenance = { tokens: human, activeMs: human, attempts: human, sessions: human };
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "phase-end", handoffExecution: null, contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Repo X" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo P" }],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-10-01T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
const PLAN: LoopPlanViewV1 = {
  planId: "bugfix", planVersion: 2, chosenBy: "labels", chosenByLabel: "bug", amended: false, loopVersion: 1,
  inputs: { goal: "fix login", successCondition: "the login test passes", targetPaths: ["src/auth/**"], checks: ["npm test"], nonGoals: [], relevantDocs: [], protectedPaths: [], maxFilesTouched: null },
  maxFiles: Number.MAX_SAFE_INTEGER, hasDiscipline: true,
};
const item = (taskId: string, over: Partial<WorkItemViewV1> = {}): WorkItemViewV1 => ({
  taskId, status: "draft", dependencyTaskIds: [], targetVersion: 1, configHash: null, originalContractHash: "e".repeat(64), derivedContractHash: null,
  currentRunId: null, pendingRunId: null, lineageRunIds: [], labels: ["bug"], labelsProvenance: "plan", labelsVersion: 0, progress: null, ...over,
});
const view: GroupViewV1 = {
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 4,
  summary: { groupId: "g", state: "draft", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1, plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "goal-x", successConditions: ["s-1"] },
  proposal: { state: "editable", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
  ledger: { groupLimit: amount(9_000_000), used: amount(0), committedRemaining: amount(3_000_000), explicitUnallocatedReserve: amount(6_000_000), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [
    { ownerKind: "task", ownerId: "a", bucket: "work", state: "draft-encumbered", amount: amount(3_000_000), fieldProvenance: provenance },
    { ownerKind: "task", ownerId: "b", bucket: "work", state: "draft-encumbered", amount: amount(3_000_000), fieldProvenance: { ...provenance, tokens: { provenance: "model", estimateId: "est-1" } } },
  ],
  workItems: [item("a", { loopPlan: PLAN, objective: { goal: "fix login", successCondition: "the login test passes" } }), item("b", { loopPlan: null, objective: { goal: "ship", successCondition: "passes" } })],
  estimates: [{
    estimateId: "est-1", estimateVersion: 1, state: "ready", profile: { profileId: "all", profileHash: "b".repeat(64) }, mode: "soft", requestHash: null, outputHash: null, reasonCode: null,
    output: { schema: "budget-estimate-v1", planHash: "a".repeat(64), tasks: [{ taskId: "b", complexity: "M", confidence: "high", work: amount(2_000_000), handoff: amount(0), rationale: "rationale-x", assumptions: ["assumption-x"] }], goalReviewReserve: amount(0), groupRationale: "group-rationale-x" },
  }],
  runs: [], checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
};
const draft = (tokens: string) => JSON.stringify({ base: 0, plan: "bugfix", text: {
  goal: "fix login", successCondition: "the login test passes", targetPaths: "src/auth/**", checks: "npm test", nonGoals: "", relevantDocs: "", protectedPaths: "",
  maxFilesTouched: "", tokens, activeMs: "14400000", attempts: "3",
} });

afterEach(cleanup);

describe("the budget editor and the loop card in Chinese", () => {
  it("shows the budget editor in Chinese, suggestion buttons named in Chinese", async () => {
    await i18n.changeLanguage("zh");
    const text = render(<BudgetEditor view={view} config={config} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />).container.textContent ?? "";
    for (const expected of [
      "提案 v2 · 可编辑", "预算模式 宽松 · 观测到的约束方式 宽松 · 宽松：超支事后结算，不会被阻止", "上下文观测不可用 · 上下文水位线无法自动交接",
      "profile all：交接控制 阶段结束时 · 交接执行 无 · 绑定到它的工作不会被派发（claim-capability-unavailable）",
      "归属", "桶", "活跃毫秒", "会话数", "建议", "任务 a", "草稿占用", " 在做法卡片里改", "模型 est-1", "采用 2000000", "应用整行", "应用全部建议",
      "估算理由（est-1）", "b · M · 置信度 高 · rationale-x", "组上限", "设置上限", "上下文达到多少 token 时交接（留空则不设）",
      "已用 0 · 已承诺 3000000 · 余量 6000000", "保存提案", "重新估算", "确认要等这个提案版本的 agent 选择解析完成。", "确认预算",
    ]) expect(text, expected).toContain(expected);
    expect(screen.getByRole("button", { name: "对 b 工作 token 采用 2000000" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "应用整行 b 工作" })).toBeTruthy();
    expect(screen.getByLabelText(/^b 工作 token/)).toBeTruthy();
  });

  it("shows the loop card, its change form and the consequence of a change in Chinese", async () => {
    await i18n.changeLanguage("zh");
    const a = view.workItems[0]!;
    const invalid = render(<LoopPlanCard view={view} item={a} drafts={{ [loopDraftKey("g", "a")]: draft("x") }} onDraft={vi.fn()} onCommand={vi.fn()} />).container.textContent ?? "";
    for (const expected of [
      "修 bug（先红后绿） · v2 · 按标签 `bug` 选择", "检查命令（1 条）", "预算：3000000 token · 活跃时间 14400000 ms · 最多尝试次数 3",
      "git 工作区：独立 worktree，合回 orca/g 分支，push 由人做", "skill 集：暂不支持", "你开始这份草稿后做法已变（v0 → v1）",
      "做法", "目标", "只改（每行一个路径）", "最多改几个文件（留空按默认）", "token 预算", "预算要填正整数", "丢弃做法草稿",
    ]) expect(invalid, expected).toContain(expected);
    expect(screen.getByRole("region", { name: "做法 a" })).toBeTruthy();
    expect(screen.getByRole("form", { name: "修改做法 a" })).toBeTruthy();
    cleanup();
    render(<LoopPlanCard view={view} item={a} drafts={{ [loopDraftKey("g", "a")]: draft("3000500") }} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.getByRole("button", { name: "预算 +500 token，从组余量扣；余量剩 5999500" })).toBeTruthy();
    cleanup();
    const handWritten = render(<LoopPlanCard view={view} item={view.workItems[1]!} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />).container.textContent ?? "";
    for (const expected of ["手写契约", "目标：ship", "完成条件：passes"]) expect(handWritten, expected).toContain(expected);
  });
});
```

`web/tests/i18nWidth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { en } from "../src/locales/en.js";
import { zh } from "../src/locales/zh.js";

/**
 * Review Focus 5 (panel i18n plan): jsdom lays nothing out, so a width proxy pins that a Chinese value does not widen a
 * narrow table cell or a button: its display width (CJK and full-width forms count 2 columns) is at most the English
 * width + 2, for every table header, every in-table enum value and every button label listed here.
 */
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
const EN = flatten(en as unknown as Tree);
const ZH = flatten(zh as unknown as Tree);
const width = (text: string): number => [...text].reduce((n, ch) => n + (/[⺀-鿿　-〿＀-￯]/.test(ch) ? 2 : 1), 0);
const NARROW_PREFIXES = [
  "control.group.th.", "control.group.runsTh.", "budget.th.", "enums.workStatus.", "enums.runPhase.", "enums.runState.",
  "enums.allocationState.", "enums.bucket.", "enums.ownerKind.", "enums.dimension.",
];
const BUTTONS = [
  "control.group.start", "control.group.pause", "control.group.handoffStop", "control.group.resume", "control.group.resumeNoContinuation",
  "control.task.addSystem", "control.task.addCustom", "control.task.save", "control.task.discard", "control.task.restore",
  "budget.applyRow", "budget.applyAll", "budget.setLimit", "budget.save", "budget.reestimate", "budget.confirm",
  "loopPlan.changePlan", "loopPlan.discard", "chains.start", "chains.stop", "decisions.agree", "decisions.correct", "recovery.retry",
];

describe("Chinese in narrow places (Review Focus 5)", () => {
  it("keeps every table header, in-table enum value and button no wider in Chinese than in English + 2 columns", () => {
    const keys = [...Object.keys(EN).filter((key) => NARROW_PREFIXES.some((prefix) => key.startsWith(prefix))), ...BUTTONS];
    expect(keys.length).toBeGreaterThanOrEqual(85);
    for (const key of keys) {
      expect(EN[key], key).toBeDefined();
      expect(width(ZH[key]!), `${key}: ${EN[key]} → ${ZH[key]}`).toBeLessThanOrEqual(width(EN[key]!) + 2);
    }
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
(cd web && ../node_modules/.bin/vitest run tests/budgetI18n.test.tsx tests/i18nWidth.test.ts) > "$SCRATCH/t8-red.txt" 2>&1; echo rc=$?
```
Expected `rc=1`: both `budgetI18n` tests red; `i18nWidth` red (the `budget.*` keys do not exist yet: fewer than 85 keys, and `EN["budget.applyRow"]` undefined).

- [ ] **Step 3: Implement**

`web/src/locales/en.ts`: add to the `../controlTypes.js` type import `AllocationViewV1, AmountDimensionV1, BudgetEstimateV1, CapabilityViewV1, FieldProvenanceV1, GroupViewV1`, and before `export const en`:
```ts
const proposalState = { editable: "editable", confirmed: "confirmed" } as const satisfies Record<GroupViewV1["proposal"]["state"], string>;
const ownerKind = { estimate: "estimate", task: "task", "goal-review": "goal-review", reserve: "reserve" } as const satisfies Record<AllocationViewV1["ownerKind"], string>;
const bucket = { work: "work", handoff: "handoff", review: "review", reserve: "reserve" } as const satisfies Record<AllocationViewV1["bucket"], string>;
const allocationState = {
  "draft-encumbered": "draft-encumbered", confirmed: "confirmed", active: "active", held: "held", continuing: "continuing", terminal: "terminal", unknown: "unknown",
} as const satisfies Record<AllocationViewV1["state"], string>;
const dimension = { tokens: "tokens", activeMs: "activeMs", attempts: "attempts", sessions: "sessions" } as const satisfies Record<AmountDimensionV1, string>;
type EstimatedTask = BudgetEstimateV1["tasks"][number];
const complexity = { S: "S", M: "M", L: "L", XL: "XL" } as const satisfies Record<EstimatedTask["complexity"], string>;
const confidence = { low: "low", medium: "medium", high: "high" } as const satisfies Record<EstimatedTask["confidence"], string>;
const handoffControl = { durable: "durable", "phase-end": "phase-end", unavailable: "unavailable" } as const satisfies Record<CapabilityViewV1["handoffControl"], string>;
const handoffExecution = {
  "mechanical-in-run-v1": "mechanical-in-run-v1", "model-assisted-v1": "model-assisted-v1",
} as const satisfies Record<NonNullable<CapabilityViewV1["handoffExecution"]>, string>;
const budgetEnforcement = { bounded: "bounded", soft: "soft", unavailable: "unavailable" } as const satisfies Record<CapabilityViewV1["budgetEnforcement"], string>;
const fieldProvenance = {
  "complex-1m-default": "complex-1m default", model: "model", human: "human", system: "system",
} as const satisfies Record<FieldProvenanceV1["provenance"], string>;
```
In `en`, after `recovery`:
```ts
  budget: {
    region: "Budget proposal",
    heading: "Proposal v{{version}} · {{state}}",
    modeLine: "budget mode {{mode}} · observed enforcement {{enforcement}}",
    notChosen: "not chosen",
    frozenAtConfirmation: "frozen at confirmation",
    softNote: " · soft: an overrun is settled after the fact, not prevented",
    contextUnavailable: "context observation unavailable · the context watermark cannot hand off automatically",
    handoffBlocked: "profile {{profileId}}: handoff control {{control}} · handoff execution {{execution}} · work bound to it is not dispatched (claim-capability-unavailable)",
    th: { owner: "owner", bucket: "bucket", state: "state", suggestion: "suggestion" },
    changeInCard: " Change it in the plan card",
    useFor: "use {{value}} for {{owner}} {{bucket}} {{dimension}}",
    use: "use {{value}}",
    applyRowFor: "Apply row {{owner}} {{bucket}}",
    applyRow: "Apply row",
    staleEstimate: "This estimate predates a plan change; estimate again to update the suggestions",
    applyAll: "Apply all suggestions",
    rationale: "Estimate rationale ({{estimateId}})",
    rationaleLine: "{{taskId}} · {{complexity}} · confidence {{confidence}} · {{rationale}}",
    groupLimit: "Group limit",
    setLimit: "Set limit",
    handoffAt: "Hand off at context tokens (blank keeps it unset)",
    ledger: "used {{used}} · committed {{committed}} · reserve {{reserve}}",
    deficit: " · deficit {{deficit}}",
    usageUnknown: " · usage unknown",
    save: "Save proposal",
    reestimate: "Re-estimate",
    confirmWaits: "Confirm waits for this proposal version's agent selections to resolve.",
    confirm: "Confirm budget",
    provenanceModel: "model {{estimateId}}",
  },
```
In `en.loopPlan` (Task 3's object), after `summary`:
```ts
    region: "Plan {{taskId}}",
    handWritten: "Hand-written contract",
    summaryRegion: "Plan summary {{taskId}}",
    checkCommands: "Check commands ({{n}})",
    budgetLine: "Budget: {{tokens}} tokens · active time {{activeMs}} ms · max attempts {{attempts}}",
    git: "Git workspace: its own worktree, merged back into <code>orca/{{groupId}}</code>; pushing is done by a person",
    skills: "Skill set: not supported yet",
    started: "Started; the plan is frozen",
    notOpen: "The group is not open for changes; the plan is frozen",
    changePlan: "Change plan",
    changePlanFor: "Change plan {{taskId}}",
    draftBehind: "The plan changed after you started this draft (v{{base}} → v{{current}})",
    planLabel: "Plan",
    discard: "Discard plan draft",
    field: {
      goal: "Goal",
      successCondition: "Done when",
      targetPaths: "Only changes (one path per line)",
      checks: "Check commands (one per line)",
      nonGoals: "Non-goals (one per line)",
      relevantDocs: "Relevant docs (one per line)",
      protectedPaths: "Must not change (one path per line)",
      maxFilesTouched: "Max files changed (blank for default)",
      tokens: "Token budget",
      activeMs: "Active time (ms)",
      attempts: "Max attempts",
    },
    badBudget: "Budgets must be positive integers",
    badFileCap: "Max files changed must be a positive integer",
    unit: { tokens: "tokens", activeMs: "ms active time", attempts: "attempts" },
    budgetTaken: "Budget {{delta}} {{unit}}, taken from the group reserve; {{left}} left",
    budgetReturned: "Budget {{delta}} {{unit}}, returned to the group reserve; {{left}} left",
    partSeparator: "; ",
    shortfall: "Group reserve too small: {{dimension}} short by {{short}}",
    unchanged: "Budget unchanged",
```
and in `enums` add `proposalState, ownerKind, bucket, allocationState, dimension, complexity, confidence, handoffControl, handoffExecution, budgetEnforcement, fieldProvenance`.

`web/src/locales/zh.ts`, after `recovery`:
```ts
  budget: {
    region: "预算提案",
    heading: "提案 v{{version}} · {{state}}",
    modeLine: "预算模式 {{mode}} · 观测到的约束方式 {{enforcement}}",
    notChosen: "未选择",
    frozenAtConfirmation: "确认时已冻结",
    softNote: " · 宽松：超支事后结算，不会被阻止",
    contextUnavailable: "上下文观测不可用 · 上下文水位线无法自动交接",
    handoffBlocked: "profile {{profileId}}：交接控制 {{control}} · 交接执行 {{execution}} · 绑定到它的工作不会被派发（claim-capability-unavailable）",
    th: { owner: "归属", bucket: "桶", state: "状态", suggestion: "建议" },
    changeInCard: " 在做法卡片里改",
    useFor: "对 {{owner}} {{bucket}} {{dimension}} 采用 {{value}}",
    use: "采用 {{value}}",
    applyRowFor: "应用整行 {{owner}} {{bucket}}",
    applyRow: "应用整行",
    staleEstimate: "这份估算早于一次做法修改；重新估算以更新建议",
    applyAll: "应用全部建议",
    rationale: "估算理由（{{estimateId}}）",
    rationaleLine: "{{taskId}} · {{complexity}} · 置信度 {{confidence}} · {{rationale}}",
    groupLimit: "组上限",
    setLimit: "设置上限",
    handoffAt: "上下文达到多少 token 时交接（留空则不设）",
    ledger: "已用 {{used}} · 已承诺 {{committed}} · 余量 {{reserve}}",
    deficit: " · 缺口 {{deficit}}",
    usageUnknown: " · 用量未知",
    save: "保存提案",
    reestimate: "重新估算",
    confirmWaits: "确认要等这个提案版本的 agent 选择解析完成。",
    confirm: "确认预算",
    provenanceModel: "模型 {{estimateId}}",
  },
```
in `zh.loopPlan`, after `summary`:
```ts
    region: "做法 {{taskId}}",
    handWritten: "手写契约",
    summaryRegion: "做法摘要 {{taskId}}",
    checkCommands: "检查命令（{{n}} 条）",
    budgetLine: "预算：{{tokens}} token · 活跃时间 {{activeMs}} ms · 最多尝试次数 {{attempts}}",
    git: "git 工作区：独立 worktree，合回 <code>orca/{{groupId}}</code> 分支，push 由人做",
    skills: "skill 集：暂不支持",
    started: "已开始，做法已冻结",
    notOpen: "组当前不接受修改，做法已冻结",
    changePlan: "修改做法",
    changePlanFor: "修改做法 {{taskId}}",
    draftBehind: "你开始这份草稿后做法已变（v{{base}} → v{{current}}）",
    planLabel: "做法",
    discard: "丢弃做法草稿",
    field: {
      goal: "目标",
      successCondition: "完成条件",
      targetPaths: "只改（每行一个路径）",
      checks: "检查命令（每行一条）",
      nonGoals: "不做的事（每行一条）",
      relevantDocs: "相关文档（每行一个）",
      protectedPaths: "不许改（每行一个路径）",
      maxFilesTouched: "最多改几个文件（留空按默认）",
      tokens: "token 预算",
      activeMs: "活跃时间（ms）",
      attempts: "最多尝试次数",
    },
    badBudget: "预算要填正整数",
    badFileCap: "最多改几个文件要填正整数",
    unit: { tokens: "token", activeMs: "ms 活跃时间", attempts: "次尝试" },
    budgetTaken: "预算 {{delta}} {{unit}}，从组余量扣；余量剩 {{left}}",
    budgetReturned: "预算 {{delta}} {{unit}}，退回组余量；余量剩 {{left}}",
    partSeparator: "；",
    shortfall: "组余量不够：{{dimension}} 还差 {{short}}",
    unchanged: "预算不变",
```
and in `enums`:
```ts
    proposalState: { editable: "可编辑", confirmed: "已确认" },
    ownerKind: { estimate: "估算", task: "任务", "goal-review": "目标评审", reserve: "余量" },
    bucket: { work: "工作", handoff: "交接", review: "评审", reserve: "余量" },
    allocationState: { "draft-encumbered": "草稿占用", confirmed: "已确认", active: "进行中", held: "已挂起", continuing: "续跑中", terminal: "已终结", unknown: "未知" },
    dimension: { tokens: "token", activeMs: "活跃毫秒", attempts: "尝试次数", sessions: "会话数" },
    complexity: { S: "S", M: "M", L: "L", XL: "XL" },
    confidence: { low: "低", medium: "中", high: "高" },
    handoffControl: { durable: "持久", "phase-end": "阶段结束时", unavailable: "不可用" },
    handoffExecution: { "mechanical-in-run-v1": "运行内机械交接 v1", "model-assisted-v1": "模型辅助交接 v1" },
    budgetEnforcement: { bounded: "有界", soft: "宽松", unavailable: "不可用" },
    fieldProvenance: { "complex-1m-default": "complex-1m 默认值", model: "模型", human: "人", system: "系统" },
```

`web/src/BudgetEditor.tsx`:
- imports: `import { useTranslation } from "react-i18next";`, `import i18n, { enumText } from "./i18n.js";`
- `provenanceText` (lines 41-44):
```ts
export function provenanceText(provenance: FieldProvenanceV1): string {
  if (provenance.provenance === "model" && provenance.estimateId) return i18n.t("budget.provenanceModel", { estimateId: provenance.estimateId });
  return enumText("fieldProvenance", provenance.provenance);
}
```
- `BudgetEditor`: after `const { view, config, drafts, onDraft, onCommand } = props;` add `const { t } = useTranslation();`; lines 240-242 →
```ts
  const firstProfile = config.profiles[0];
  const observedEnforcement = view.proposal.profiles === null
    ? firstProfile === undefined ? t("common.unknown") : enumText("budgetEnforcement", firstProfile.observed.budgetEnforcement)
    : t("budget.frozenAtConfirmation");
```
- render replacements:

| Line | Today | Becomes |
|---|---|---|
| 313 | `aria-label="Budget proposal"` | `aria-label={t("budget.region")}` |
| 314 | `Proposal v{view.proposal.proposalVersion} · {view.proposal.state}` | `{t("budget.heading", { version: view.proposal.proposalVersion, state: enumText("proposalState", view.proposal.state) })}` |
| 316 | `budget mode {view.proposal.budgetMode ?? "not chosen"} · observed enforcement {observedEnforcement}` | `{t("budget.modeLine", { mode: view.proposal.budgetMode === null ? t("budget.notChosen") : enumText("budgetMode", view.proposal.budgetMode), enforcement: observedEnforcement })}` |
| 317 | `{view.proposal.budgetMode === "soft" ? " · soft: an overrun is settled after the fact, not prevented" : ""}` | `{view.proposal.budgetMode === "soft" ? t("budget.softNote") : ""}` |
| 320 | `context observation unavailable · …` | `{t("budget.contextUnavailable")}` |
| 324 | `profile {profile.profileId}: handoff control … (claim-capability-unavailable)` | `{t("budget.handoffBlocked", { profileId: profile.profileId, control: enumText("handoffControl", profile.observed.handoffControl), execution: profile.observed.handoffExecution === null ? t("common.none") : enumText("handoffExecution", profile.observed.handoffExecution) })}` |
| 329 | `<th>owner</th><th>bucket</th><th>state</th>{DIMENSIONS.map((dimension) => <th key={dimension}>{dimension}</th>)}{advice !== null && <th>suggestion</th>}` | `<th>{t("budget.th.owner")}</th><th>{t("budget.th.bucket")}</th><th>{t("budget.th.state")}</th>{DIMENSIONS.map((dimension) => <th key={dimension}>{enumText("dimension", dimension)}</th>)}{advice !== null && <th>{t("budget.th.suggestion")}</th>}` |
| 334 | `<td>{allocation.ownerKind} {allocation.ownerId}</td>` | `<td>{enumText("ownerKind", allocation.ownerKind)} {allocation.ownerId}</td>` |
| 335 | `<td>{allocation.bucket}</td>` | `<td>{enumText("bucket", allocation.bucket)}</td>` |
| 336 | `<td>{allocation.state}</td>` | `<td>{enumText("allocationState", allocation.state)}</td>` |
| 345 | `<small> Change it in the plan card</small>` | `<small>{t("budget.changeInCard")}</small>` |
| 347 | ``aria-label={`use ${loopValue} for ${allocation.ownerId} ${allocation.bucket} ${dimension}`}`` | `aria-label={t("budget.useFor", { value: loopValue, owner: allocation.ownerId, bucket: enumText("bucket", allocation.bucket), dimension: enumText("dimension", dimension) })}` |
| 348 | `>use {loopValue}</button>` | `>{t("budget.use", { value: loopValue })}</button>` |
| 358 | `{allocation.ownerId} {allocation.bucket} {dimension}` | `{allocation.ownerId} {enumText("bucket", allocation.bucket)} {enumText("dimension", dimension)}` |
| 368 | ``aria-label={`use ${fieldOperation.value} for ${allocation.ownerId} ${allocation.bucket} ${dimension}`}`` | `aria-label={t("budget.useFor", { value: fieldOperation.value, owner: allocation.ownerId, bucket: enumText("bucket", allocation.bucket), dimension: enumText("dimension", dimension) })}` |
| 369 | `>use {fieldOperation.value}</button>` | `>{t("budget.use", { value: fieldOperation.value })}</button>` |
| 378 | ``aria-label={`Apply row ${allocation.ownerId} ${allocation.bucket}`}`` … `>Apply row</button>` | `aria-label={t("budget.applyRowFor", { owner: allocation.ownerId, bucket: enumText("bucket", allocation.bucket) })}` … `>{t("budget.applyRow")}</button>` |
| 384 | `This estimate predates a plan change; …` | `{t("budget.staleEstimate")}` |
| 385 | `>Apply all suggestions</button>` | `>{t("budget.applyAll")}</button>` |
| 388 | `<summary>Estimate rationale ({advice.estimateId})</summary>` | `<summary>{t("budget.rationale", { estimateId: advice.estimateId })}</summary>` |
| 393 | `{task.taskId} · {task.complexity} · confidence {task.confidence} · {task.rationale}` | `{t("budget.rationaleLine", { taskId: task.taskId, complexity: enumText("complexity", task.complexity), confidence: enumText("confidence", task.confidence), rationale: task.rationale })}` |
| 401 | `<legend>Group limit</legend>` | `<legend>{t("budget.groupLimit")}</legend>` |
| 404 | `{dimension}` (the limit label's text) | `{enumText("dimension", dimension)}` |
| 412 | `>Set limit</button>` | `>{t("budget.setLimit")}</button>` |
| 415 | `Hand off at context tokens (blank keeps it unset)` | `{t("budget.handoffAt")}` |
| 423-425 | `used {…} · committed {…} · reserve {…}` / deficit / usage unknown | `{t("budget.ledger", { used: view.ledger.used.tokens, committed: view.ledger.committedRemaining.tokens, reserve: view.ledger.explicitUnallocatedReserve.tokens })}` / `{view.ledger.budgetDeficit.tokens > 0 ? t("budget.deficit", { deficit: view.ledger.budgetDeficit.tokens }) : ""}` / `{view.ledger.usageUnknown ? t("budget.usageUnknown") : ""}` |
| 427 | `>Save proposal</button>` | `>{t("budget.save")}</button>` |
| 428 | `>Re-estimate</button>` | `>{t("budget.reestimate")}</button>` |
| 429 | `Confirm waits for this proposal version's agent selections to resolve.` | `{t("budget.confirmWaits")}` |
| 430 | `>Confirm budget</button>` | `>{t("budget.confirm")}</button>` |

`web/src/LoopPlanCard.tsx`:
- import: `import { useTranslation } from "react-i18next";` → `import { Trans, useTranslation } from "react-i18next";`; add `enumText` to the `./i18n.js` import (`import i18n, { enumText } from "./i18n.js";`).
- lines 25-31 → 
```ts
const FIELD_KEY = {
  goal: "loopPlan.field.goal", successCondition: "loopPlan.field.successCondition", targetPaths: "loopPlan.field.targetPaths",
  checks: "loopPlan.field.checks", nonGoals: "loopPlan.field.nonGoals", relevantDocs: "loopPlan.field.relevantDocs",
  protectedPaths: "loopPlan.field.protectedPaths", maxFilesTouched: "loopPlan.field.maxFilesTouched", tokens: "loopPlan.field.tokens",
  activeMs: "loopPlan.field.activeMs", attempts: "loopPlan.field.attempts",
} as const satisfies Record<Field, string>;
```
- `payloadOf`: `return { invalid: BAD_BUDGET };` → `return { invalid: i18n.t("loopPlan.badBudget") };`; `return { invalid: BAD_FILE_CAP };` → `return { invalid: i18n.t("loopPlan.badFileCap") };`
- `consequenceOf` (lines 85-96):
```ts
export function consequenceOf(view: GroupViewV1, current: Amount, work: { tokens: number; activeMs: number; attempts: number }): { text: string; shortfall: string | null } {
  const reserve = view.ledger.explicitUnallocatedReserve;
  const parts: string[] = [];
  let shortfall: string | null = null;
  for (const dimension of ["tokens", "activeMs", "attempts"] as const) {
    const delta = work[dimension] - current[dimension];
    if (delta === 0) continue;
    const values = { delta: `${delta > 0 ? "+" : ""}${delta}`, unit: i18n.t(`loopPlan.unit.${dimension}`), left: reserve[dimension] - delta };
    parts.push(delta > 0 ? i18n.t("loopPlan.budgetTaken", values) : i18n.t("loopPlan.budgetReturned", values));
    if (delta > reserve[dimension] && shortfall === null) {
      shortfall = i18n.t("loopPlan.shortfall", { dimension: enumText("dimension", dimension), short: delta - reserve[dimension] });
    }
  }
  return { text: parts.length === 0 ? i18n.t("loopPlan.unchanged") : parts.join(i18n.t("loopPlan.partSeparator")), shortfall };
}
```
- `LoopPlanEditor`: first body line `const { t } = useTranslation();`; `<p>Started; the plan is frozen</p>` → `<p>{t("loopPlan.started")}</p>`; `<p>The group is not open for changes; the plan is frozen</p>` → `<p>{t("loopPlan.notOpen")}</p>`; `>Change plan</button>` → `>{t("loopPlan.changePlan")}</button>`; ``aria-label={`Change plan ${item.taskId}`}`` → `aria-label={t("loopPlan.changePlanFor", { taskId: item.taskId })}`; the draft notice → `{t("loopPlan.draftBehind", { base: draft.base, current: plan.loopVersion })}`; the `Plan` label text and `aria-label="Plan"` → `{t("loopPlan.planLabel")}` / `aria-label={t("loopPlan.planLabel")}`; `{FIELD_LABEL[field]}` and both `aria-label={FIELD_LABEL[field]}` → `{t(FIELD_KEY[field])}` / `aria-label={t(FIELD_KEY[field])}`; `>Discard plan draft</button>` → `>{t("loopPlan.discard")}</button>`.
- `LoopPlanCard`: the Task 3 line `useTranslation();` → `const { t } = useTranslation();`; both ``aria-label={`Plan ${item.taskId}`}`` → `aria-label={t("loopPlan.region", { taskId: item.taskId })}`; `<h5>Hand-written contract</h5>` → `<h5>{t("loopPlan.handWritten")}</h5>`; `<li>Goal: {item.objective.goal}</li>` → `<li>{t("loopPlan.summary.goal", { goal: item.objective.goal })}</li>`; `<li>Done when: {item.objective.successCondition}</li>` → `<li>{t("loopPlan.summary.doneWhen", { condition: item.objective.successCondition })}</li>`; ``aria-label={`Plan summary ${item.taskId}`}`` → `aria-label={t("loopPlan.summaryRegion", { taskId: item.taskId })}`; `<summary>Check commands ({plan.inputs.checks.length})</summary>` → `<summary>{t("loopPlan.checkCommands", { n: plan.inputs.checks.length })}</summary>`; the budget paragraph's content → `{t("loopPlan.budgetLine", { tokens: work.amount.tokens, activeMs: work.amount.activeMs, attempts: work.amount.attempts })}`; the Git paragraph → `<p><Trans i18nKey="loopPlan.git" values={{ groupId: view.summary.groupId }} components={{ code: <code /> }} /></p>`; `<p>Skill set: not supported yet</p>` → `<p>{t("loopPlan.skills")}</p>`.

- [ ] **Step 4: Run, expect PASS**

```bash
(cd web && ../node_modules/.bin/vitest run tests/budgetI18n.test.tsx tests/i18nWidth.test.ts tests/loopPlanCard.test.tsx tests/loopPlanEdit.test.tsx tests/loopPlanDraft.test.tsx tests/loopBudgetRows.test.tsx tests/budgetSuggestions.test.tsx tests/budgetHandoffCapability.test.tsx tests/estimateStale.test.tsx tests/loopSuggestionApply.test.tsx tests/loopSuggestionDraft.test.tsx) > "$SCRATCH/t8-green.txt" 2>&1; echo rc=$?
npm run check --workspace web > "$SCRATCH/t8-web-check.txt" 2>&1; echo rc=$?
```
Expected both `rc=0`.

- [ ] **Step 5: Mutations** (`$SCRATCH/mut-t8`)
  - MT8-1 dimension header raw: `<th key={dimension}>{enumText("dimension", dimension)}</th>` → `<th key={dimension}>{dimension}</th>`. Red: `budgetI18n … > shows the budget editor …` (`活跃毫秒`).
  - MT8-2 accessible name in English: the field button's `aria-label={t("budget.useFor", …)}` → ``aria-label={`use ${fieldOperation.value} for ${allocation.ownerId} ${allocation.bucket} ${dimension}`}``. Red: same test (`getByRole("button", { name: "对 b 工作 token 采用 2000000" })`).
  - MT8-3 provenance raw: `provenanceText` body → `return provenance.provenance;`. Red: `budgetI18n … > shows the budget editor …` (`模型 est-1`).
  - MT8-4 invalid message literal: `i18n.t("loopPlan.badBudget")` → `"Budgets must be positive integers"`. Red: `budgetI18n … > shows the loop card …`.
  - MT8-5 consequence literal unit: `unit: i18n.t(`loopPlan.unit.${dimension}`)` → `unit: dimension`. Red: same test (the button's name).
  - MT8-6 git line without Trans: the Git paragraph → `<p>{t("loopPlan.git", { groupId: view.summary.groupId })}</p>`. Red: same test (the text contains `<code>`), and `loopPlanCard … > shows the work budget and the two dimensions …`.
  - MT8-7 width: `zh.budget.applyAll` → `"把所有建议全部应用到这个提案上"`. Red: `i18nWidth … > keeps every table header …`.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add web/src/BudgetEditor.tsx web/src/LoopPlanCard.tsx web/src/locales/en.ts web/src/locales/zh.ts web/tests/budgetI18n.test.tsx web/tests/i18nWidth.test.ts
/usr/bin/git commit -F - <<'MSG'
feat(web): translate the budget editor and the loop plan card

The proposal's notes, table, suggestion buttons and their accessible names,
the estimate rationale, the limit and the ledger line, and the loop card's
read-only lines, change form, draft notice and consequence read in the chosen
language. A width proxy keeps Chinese no wider than English in table headers,
in-table enum values and buttons.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GCbsgLfqFPgpeG3gTbBkbh
MSG
```

---

