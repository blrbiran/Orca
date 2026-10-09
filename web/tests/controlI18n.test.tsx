// @vitest-environment jsdom
/**
 * Panel i18n spec §3.3, §3.5, §5: the task control and recovery areas in Chinese -- the control summary and its alerts,
 * the import form, the group list, one group (heading, stop, work items, runs, handoff requests, estimates, dispatch
 * buttons), a task's detail with its progress and label draft, recovery blockers, the workspace mode; every enum value
 * in words. Ids, hashes, codes and dates stay as sent.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n.js";
import { App } from "../src/App.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { ControlPanel } from "../src/ControlPanel.js";
import { EvidenceLink } from "../src/EvidenceLink.js";
import { RecoveryView } from "../src/RecoveryView.js";
import { WorkspaceModeSelector } from "../src/WorkspaceModeSelector.js";
import { EvidenceList, TaskDetail, labelsDraftKey, progressText } from "../src/TaskDetail.js";
import type { MetricsReport } from "../src/types.js";
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
  summary: { groupId: "g", repoId: "orca", state: "running", commandRevision: 6, projectionSeq: 4, stopMode: "pause", stopState: "paused", claimBlocked: true, recoveryBlockerCount: 1 },
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

/** The texts of every `th` on the page, in order, so one table's header row can be matched as a run of cells. */
const headerCells = (root: HTMLElement): string => [...root.querySelectorAll("th")].map((cell) => cell.textContent).join("|");
/** The first body row of the table whose header row reads `header`, cell by cell. */
const firstRow = (root: HTMLElement, header: string): string[] => {
  const table = [...root.querySelectorAll("table")].find((candidate) => headerCells(candidate) === header);
  return [...(table?.querySelector("tbody tr")?.querySelectorAll("td") ?? [])].map((cell) => cell.textContent ?? "");
};
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("the rest of the control area's branches in Chinese", () => {
  it("shows the import form, an empty group list, a group being read and no recovery blockers in Chinese", async () => {
    await i18n.changeLanguage("zh");
    const ready: ControlConfigV1 = { ...config, executionPort: "configured", defaults: { estimatorProfileId: "p1", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" } };
    const { container } = render(
      <ControlPanel config={ready} summary={{ ...summary, resetRequired: false, dispatchBlocked: false, groups: [] }} recovery={{ ...recovery, dispatchBlocked: false, blockers: [] }}
        groups={{}} selected="zz" drafts={{}} uncertain={[]} refusal={null} refetchRequired={false} onSelect={vi.fn()} onDraft={vi.fn()} onCommand={vi.fn()} />,
    );
    const panel = screen.getByRole("region", { name: "任务控制" });
    expect(within(panel).getByRole("heading", { level: 2 }).textContent).toBe("任务控制");
    expect(container.textContent).toContain("纪元 epoch-a · 投影 4 · 派发正常");
    const importForm = screen.getByRole("region", { name: "导入计划" });
    expect(within(importForm).getByRole("heading", { level: 3 }).textContent).toBe("导入一个计划");
    expect(within(importForm).getByText("Repo X · Demo P · 估算模式 宽松")).toBeTruthy();
    expect(within(importForm).getByRole("button").textContent).toBe("导入计划");
    expect(within(screen.getByRole("navigation", { name: "控制组" })).getByText("还没有控制组。")).toBeTruthy();
    expect(screen.getByText("正在读取 zz…")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "恢复" })).getByText("没有恢复阻塞项。")).toBeTruthy();
    cleanup();

    render(
      <ControlPanel config={{ ...ready, repositories: [] }} summary={summary} recovery={recovery} groups={{}} selected={null} drafts={{}} uncertain={[]}
        refusal={null} refetchRequired={false} onSelect={vi.fn()} onDraft={vi.fn()} onCommand={vi.fn()} />,
    );
    expect(screen.getByRole("note").textContent).toBe("这个面板没有配置受信任的仓库和计划。");
  });

  it("names every table column, the label filter and each dispatch button in Chinese", async () => {
    await i18n.changeLanguage("zh");
    const fresh: WorkItemViewV1 = { ...item, status: "ready", currentRunId: null, pendingRunId: null, dependencyTaskIds: [], progress: undefined };
    const readyView: GroupViewV1 = {
      ...view, summary: { ...view.summary, state: "ready", stopMode: null, stopState: null, claimBlocked: false }, stop: null, workItems: [fresh], runs: [{ ...run, state: "running", blockedReason: null }],
    };
    const props = { config, uncertain: [], drafts: {}, onDraft: vi.fn(), onCommand: vi.fn() };
    const { container } = render(<ControlGroupView view={readyView} {...props} />);
    expect(firstRow(container, "任务|状态|标签|进度|运行|待定|依赖")).toEqual(["a", "就绪", "bug", "没有运行", "无", "无", "无"]);
    expect(firstRow(container, "运行|阶段|状态|配置|已用|剩余|证据").slice(0, 3)).toEqual(["a", "工作", "运行中 · 第 2 次尝试（认领序号 不适用）"]);
    const filter = screen.getByRole("group", { name: "按标签筛选工作项" });
    expect(filter.querySelector("legend")!.textContent).toBe("标签（任一）");
    expect(screen.getByRole("heading", { name: "估算" })).toBeTruthy();
    for (const name of ["开跑", "暂停派发", "交接停止"]) expect(screen.getByRole("button", { name }), name).toBeTruthy();
    for (const name of ["运行", "派发"]) expect(screen.getByRole("heading", { level: 3, name }), name).toBeTruthy();
    cleanup();

    render(<ControlGroupView view={view} {...props} />);
    expect(screen.getByRole("button", { name: "恢复派发" })).toBeTruthy();
    cleanup();

    const handoff = { ...view.summary, stopMode: "handoff" as const, stopState: "handoff-complete" as const };
    const held: RunViewV1 = { ...run, state: "settled-recoverable", blockedReason: null, continuable: true };
    render(<ControlGroupView view={{ ...view, summary: handoff, runs: [held], checkpoints: [{ checkpointId: "cp1", taskId: "a", runId: "r1", state: "complete", snapshotHash: null, evidenceIds: [] }] }} {...props} />);
    expect(screen.getByRole("button", { name: "继续选中的任务（1）" })).toBeTruthy();
    cleanup();

    // Issue-fixes ruling (Part C flag 2): a single task's continuation is offered only once the group has no stop intent.
    render(<ControlGroupView view={{ ...view, summary: { ...view.summary, stopMode: null, stopState: null }, stop: null, runs: [held], checkpoints: [{ checkpointId: "cp1", taskId: "a", runId: "r1", state: "complete", snapshotHash: null, evidenceIds: [] }] }} {...props} />);
    expect(screen.getByRole("button", { name: "继续任务 a" })).toBeTruthy();
    cleanup();

    render(<ControlGroupView view={{ ...view, summary: handoff, runs: [{ ...held, continuable: false }] }} {...props} />);
    expect(screen.getByRole("button", { name: "恢复（不续跑）" })).toBeTruthy();
  });

  it("shows a task with plan labels, no progress and no runs, and every progress wording, in Chinese", async () => {
    await i18n.changeLanguage("zh");
    const bare: WorkItemViewV1 = { ...item, labels: [], labelsProvenance: undefined, labelsVersion: undefined, progress: undefined };
    const drafts = { [labelsDraftKey("g", "a")]: JSON.stringify({ base: 1, labels: [] }) };
    const { container } = render(<TaskDetail view={{ ...view, runs: [] }} item={bare} drafts={drafts} onDraft={vi.fn()} onCommand={vi.fn()} />);
    const text = container.textContent ?? "";
    for (const expected of ["标签来自计划 · 版本 0 · 未保存的草稿", "你开始草稿后标签已变（v1 → v0） · 现在：无", "进度：没有运行"]) expect(text, expected).toContain(expected);
    expect(screen.getByRole("region", { name: "任务 a" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "a 的标签" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "系统标签" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "自定义标签" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 5, name: "a 的运行" }).nextElementSibling!.textContent).toBe("无");

    expect(progressText({ runId: "r1", step: null, attempt: { current: 2, max: 5 }, tokens: null, lastTransitionAt: null })).toBe("尚未上报 · 尝试 2/5 · token 未知");
    expect(progressText({ runId: "r1", step: "verify", attempt: null, tokens: { used: 5, grant: 20 }, lastTransitionAt: null })).toBe("验证 · 尝试次数未知 · token 25%（阶段结束时上报）");
  });

  it("shows recovery blockers with their evidence, a group blocker and the workspace's clone mode in Chinese", async () => {
    await i18n.changeLanguage("zh");
    const blocked: RecoveryViewV1 = {
      ...recovery, blockers: [{ scope: "group", groupId: "g2", runId: null, code: "c3", evidenceIds: ["e9"] }, { scope: "run", groupId: "g2", runId: "r7", code: "c4", evidenceIds: [] }],
    };
    const groupView: GroupViewV1 = { ...view, recoveryBlockers: [{ scope: "run", code: "c5", runId: "r1", evidenceIds: ["e5"] }] };
    const { container } = render(<RecoveryView recovery={blocked} group={groupView} onCommand={vi.fn()} />);
    const items = [...container.querySelectorAll("li")].map((li) => li.textContent);
    expect(items[0]).toBe("组 · g2 · c3 · 证据 e9重试恢复");
    expect(items[1]).toBe("运行 · g2 · 运行 r7 · c4重试恢复");
    expect(items[2]).toBe("运行 · g · 运行 r1 · c5 · 证据 e5运行证据重试恢复");
    expect(within(screen.getByRole("region", { name: "恢复" })).getByRole("heading", { level: 3 }).textContent).toBe("恢复");
    expect(screen.getByRole("alert").textContent).toBe("派发已阻断 · 在观察到恢复之前，面板不会启动新的运行");
    cleanup();

    render(<WorkspaceModeSelector workspace={{ ...workspace, workspaceMode: "clone" }} onChange={vi.fn()} />);
    const section = screen.getByRole("region", { name: "工作区模式" });
    expect(within(section).getByRole("heading", { level: 3 }).textContent).toBe("工作区模式");
    expect(section.querySelector("p")!.textContent).toBe("orca 里新的运行使用私有克隆（设置版本 1）。已开始的运行保持原样。");
  });

  it("lists, downloads and refuses evidence in Chinese", async () => {
    await i18n.changeLanguage("zh");
    const realFetch = globalThis.fetch;
    let answers: Response[] = [];
    globalThis.fetch = (async () => answers.shift()!) as typeof fetch;
    try {
      const refused = { error: { code: "evidence-gone", message: "gone", commandRevision: null, evidenceIds: [], retryable: false } };
      answers = [json(refused, 404)];
      render(<EvidenceLink runId="r1" />);
      fireEvent.click(screen.getByRole("button", { name: "证据" }));
      expect((await screen.findByRole("alert")).textContent).toBe("证据被拒 · evidence-gone");
      cleanup();

      const entry = { evidenceId: "e1", kind: "usage", sha256: "9".repeat(64), byteLength: 12, downloadUrl: "/api/control/runs/r1/evidence/e1" };
      answers = [json({ schema: "orca-run-evidence-v1", runId: "r1", entries: [entry] }), json(refused, 404)];
      render(<EvidenceList runId="r1" />);
      fireEvent.click(screen.getByRole("button", { name: "列出 r1 的证据" }));
      const list = await screen.findByRole("list", { name: "r1 的证据" });
      expect(list.querySelector("li")!.textContent).toBe("e1 · usage · 12 字节 下载 e1");
      fireEvent.click(within(list).getByRole("button", { name: "下载 e1" }));
      expect((await screen.findByRole("alert")).textContent).toBe("证据被拒 · evidence-gone");
      cleanup();

      answers = [json({ schema: "orca-run-evidence-v1", runId: "r1", entries: [] })];
      const { container } = render(<EvidenceList runId="r1" />);
      fireEvent.click(screen.getByRole("button", { name: "列出 r1 的证据" }));
      await waitFor(() => expect(container.querySelector("span")?.textContent).toBe(" 没有证据"));
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("says the task control plane is unavailable in Chinese", async () => {
    await i18n.changeLanguage("zh");
    const realFetch = globalThis.fetch;
    const report = {
      as_of: "2026-10-01T00:00:00.000Z", as_of_mode: "wall_clock", repos: [],
      correction_rate: { numerator_corrections_excluding_stale: 0, denominator_decisions: 0, rate_excluding_stale: null, corrections_total_including_stale: 0, by_decision_kind: [], buckets: [], caveats: [] },
      repair_rate: { numerator_overturned: 0, denominator_corrections_including_stale: 0, rate: null, stale_only: { numerator_overturned: 0, denominator_corrections: 0, rate: null, known_bias: "" }, buckets: [], caveats: [] },
      backlog: { open_corrections: 0, oldest_age_ms: null, oldest_correction_id: null, by_correction_kind: [] },
      breakdown_by_correction_kind_including_stale: [], review_coverage: { available: false, reason: "none yet" },
      excluded_as_future: 0, unresolved_decisions: [], unkeyable_repos: [], malformed_lines: [],
    } as unknown as MetricsReport;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/todo")) return json({ rows: [] });
      if (url.startsWith("/api/metrics")) return json({ report, panel_review_coverage: { reviewed_high_tier: 0, high_tier_total: 0, rate: null, caveat: "c" } });
      return json({ error: { code: "not-here", message: "no", commandRevision: null, evidenceIds: [], retryable: false } }, 404);
    }) as typeof fetch;
    try {
      render(<App />);
      expect((await screen.findByText("这个面板上没有任务控制面。")).className).toBe("empty");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
