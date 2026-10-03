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

/** A task-a draft with every field as the plan has it, but these changed. */
const draftWith = (text: Record<string, string>) => {
  const parsed = JSON.parse(draft("3000000")) as { text: Record<string, string> };
  return JSON.stringify({ ...parsed, text: { ...parsed.text, ...text } });
};
const texts = (selector: string): Array<string | null> => [...document.querySelectorAll(selector)].map((node) => node.textContent);

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
    // Preflight P3: the table headers themselves, not a word the limit labels also render.
    expect(texts("thead th")).toEqual(["归属", "桶", "状态", "token", "活跃毫秒", "尝试次数", "会话数", "建议"]);
    const rowB = [...document.querySelectorAll("tbody tr")][1]!;
    expect([...rowB.querySelectorAll("td")].slice(0, 3).map((cell) => cell.textContent)).toEqual(["任务 b", "工作", "草稿占用"]);
    expect(texts("td small")).toEqual([...Array<string>(4).fill(" 在做法卡片里改"), "模型 est-1", "人", "人", "人"]);
    expect(texts("span.sr-only")).toEqual(["b 工作 token", "b 工作 活跃毫秒", "b 工作 尝试次数", "b 工作 会话数"]);
    expect(texts("fieldset label")).toEqual(["token", "活跃毫秒", "尝试次数", "会话数"]);
    expect(screen.getByRole("region", { name: "预算提案" })).toBeTruthy();
  });

  it("shows the budget editor's other states in Chinese: confirmed, frozen, no mode, deficit, stale, loop suggestions", async () => {
    await i18n.changeLanguage("zh");
    const executing = { ...capability, handoffExecution: "mechanical-in-run-v1" } as const;
    const bound = { profileId: "all", profileHash: "b".repeat(64) };
    const confirmed: GroupViewV1 = {
      ...view,
      proposal: { ...view.proposal, state: "confirmed", budgetMode: null, profiles: { estimator: bound, worker: bound, handoff: bound, goalReview: bound } },
      ledger: { ...view.ledger, budgetDeficit: amount(5), usageUnknown: true },
      allocations: [view.allocations[0]!, { ...view.allocations[1]!, fieldProvenance: { ...provenance, activeMs: { provenance: "complex-1m-default", estimateId: null }, attempts: { provenance: "system", estimateId: null } } }],
    };
    let text = render(<BudgetEditor view={confirmed} config={{ ...config, profiles: [{ ...config.profiles[0]!, observed: executing }] }} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />).container.textContent ?? "";
    for (const expected of [
      "提案 v2 · 已确认", "预算模式 未选择 · 观测到的约束方式 确认时已冻结",
      "profile all：交接控制 阶段结束时 · 交接执行 运行内机械交接 v1 · 绑定到它的工作不会被派发（claim-capability-unavailable）",
      "已用 0 · 已承诺 3000000 · 余量 6000000 · 缺口 5 · 用量未知",
    ]) expect(text, expected).toContain(expected);
    expect(texts("td small").slice(4)).toEqual(["人", "complex-1m 默认值", "系统", "人"]);
    cleanup();
    const stale: GroupViewV1 = { ...view, estimates: [{ ...view.estimates[0]!, stale: true }] };
    text = render(<BudgetEditor view={stale} config={{ ...config, profiles: [] }} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />).container.textContent ?? "";
    for (const expected of ["观测到的约束方式 未知", "这份估算早于一次做法修改；重新估算以更新建议"]) expect(text, expected).toContain(expected);
    cleanup();
    const estimate = view.estimates[0]!;
    const withLoop: GroupViewV1 = { ...view, estimates: [{ ...estimate, output: { ...estimate.output!, tasks: [...estimate.output!.tasks, { ...estimate.output!.tasks[0]!, taskId: "a", work: amount(4_000_000) }] } }] };
    render(<BudgetEditor view={withLoop} config={config} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.getByRole("button", { name: "对 a 工作 token 采用 4000000" }).textContent).toBe("采用 4000000");
  });

  it("shows the loop card, its change form and the consequence of a change in Chinese", async () => {
    await i18n.changeLanguage("zh");
    const a = view.workItems[0]!;
    const invalid = render(<LoopPlanCard view={view} item={a} drafts={{ [loopDraftKey("g", "a")]: draft("x") }} onDraft={vi.fn()} onCommand={vi.fn()} />).container.textContent ?? "";
    for (const expected of [
      "修 bug（先红后绿） · v2 · 按标签 `bug` 选择", "检查命令（1 条）", "预算：3000000 token · 活跃时间 14400000 ms · 最多尝试次数 3",
      "git 工作区：独立 worktree，合回 orca/g 分支，push 由人做", "skill 集：无", "你开始这份草稿后做法已变（v0 → v1）",
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
    expect(screen.getByRole("region", { name: "做法 b" })).toBeTruthy();
  });

  it("names every field of the change form, the plan summary and each frozen state in Chinese", async () => {
    await i18n.changeLanguage("zh");
    const a = view.workItems[0]!;
    const card = (over: { view?: GroupViewV1; item?: WorkItemViewV1; drafts?: Record<string, string> } = {}) =>
      render(<LoopPlanCard view={over.view ?? view} item={over.item ?? a} drafts={over.drafts ?? {}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    card();
    expect(screen.getByRole("list", { name: "做法摘要 a" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "修改做法" })).toBeTruthy();
    cleanup();
    expect(card({ item: { ...a, status: "active" } }).container.textContent).toContain("已开始，做法已冻结");
    cleanup();
    expect(card({ view: { ...view, summary: { ...view.summary, state: "running" } } }).container.textContent).toContain("组当前不接受修改，做法已冻结");
    cleanup();
    card({ drafts: { [loopDraftKey("g", "a")]: draftWith({ maxFilesTouched: "x" }) } });
    const form = screen.getByRole("form", { name: "修改做法 a" });
    expect([...form.querySelectorAll("label")].map((label) => label.childNodes[0]?.textContent)).toEqual([
      "做法", "目标", "完成条件", "只改（每行一个路径）", "检查命令（每行一条）", "不做的事（每行一条）", "相关文档（每行一个）",
      "不许改（每行一个路径）", "最多改几个文件（留空按默认）", "token 预算", "活跃时间（ms）", "最多尝试次数",
    ]);
    expect([...form.querySelectorAll("select, input, textarea")].map((box) => box.getAttribute("aria-label"))).toEqual([
      "做法", "目标", "完成条件", "只改（每行一个路径）", "检查命令（每行一条）", "不做的事（每行一条）", "相关文档（每行一个）",
      "不许改（每行一个路径）", "最多改几个文件（留空按默认）", "token 预算", "活跃时间（ms）", "最多尝试次数",
    ]);
    expect(screen.getByRole("alert").textContent).toBe("最多改几个文件要填正整数");
    cleanup();
    for (const [text, expected] of [
      [{ tokens: "2999500" }, "预算 -500 token，退回组余量；余量剩 6000500"],
      [{ activeMs: "14400001", attempts: "4" }, "预算 +1 ms 活跃时间，从组余量扣；余量剩 14399999；预算 +1 次尝试，从组余量扣；余量剩 2"],
      [{}, "预算不变"],
    ] as const) {
      card({ drafts: { [loopDraftKey("g", "a")]: draftWith(text) } });
      expect(screen.getByRole("button", { name: expected })).toBeTruthy();
      cleanup();
    }
    card({ drafts: { [loopDraftKey("g", "a")]: draftWith({ tokens: "9000001" }) } });
    expect(screen.getByRole("alert").textContent).toBe("组余量不够：token 还差 1");
  });

  it("names each plan in the plan picker in the chosen language (Task 3 review)", async () => {
    const options = (): Array<string | null> => {
      render(<LoopPlanCard view={view} item={view.workItems[0]!} drafts={{ [loopDraftKey("g", "a")]: draft("3000000") }} onDraft={vi.fn()} onCommand={vi.fn()} />);
      const names = texts("option");
      cleanup();
      return names;
    };
    expect(options()).toEqual(["Standard", "Bug fix (red first)", "Safe refactor", "Design / docs first", "Investigate only"]);
    await i18n.changeLanguage("zh");
    expect(options()).toEqual(["标准", "修 bug（先红后绿）", "安全重构", "先写设计／文档", "只调研不改代码"]);
  });
});
