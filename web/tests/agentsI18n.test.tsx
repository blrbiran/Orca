// @vitest-environment jsdom
/**
 * Panel i18n spec §3.3, §3.5, §5: the agents area in Chinese -- the settings page, the proposal's agent editor (slots in
 * words, where each field came from, a refused slot, the plan values a layer can ignore), the confirmed view, the read
 * failure and the retry notice. Agent ids, models, versions and codes stay as sent. Each translated site is pinned by
 * its own element's exact text, so a site that falls back to English turns its own assertion red.
 */
import { cleanup, render } from "@testing-library/react";
import type { JSX } from "react";
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
  planLayers: { group: { worker: { agent: "codex", model: "gpt-5x", contextWindow: 1_000_000 } }, tasks: {} },
  slots: [
    { key: "task:a", slot: "worker", taskId: "a", outcome: { kind: "resolved", frozen } },
    { key: "task:b", slot: "worker", taskId: "b", outcome: { kind: "unavailable", code: "ccloop-timeout" } },
    { key: "reconcile", slot: "reconcile", taskId: null, outcome: { kind: "rejected", code: "agent-installation-missing" } },
  ],
  selectionsHash: null,
};
const view = (state: "editable" | "confirmed"): GroupViewV1 => ({
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 4,
  summary: { groupId: "g", repoId: "orca", state: "draft", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1, plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "goal-x", successConditions: ["s-1"] },
  proposal: { state, proposalVersion: 2, planHash: "a".repeat(64), budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
  ledger: { groupLimit: amount(100), used: amount(0), committedRemaining: amount(0), explicitUnallocatedReserve: amount(100), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [],
  workItems: [{ taskId: "a", status: "draft", dependencyTaskIds: [], targetVersion: 1, configHash: null, originalContractHash: "e".repeat(64), derivedContractHash: null, currentRunId: null, pendingRunId: null, lineageRunIds: [] }],
  estimates: [], runs: [], checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
});
const textOf = (element: JSX.Element): string => render(element).container.textContent ?? "";

/** Each matching element's whole text, in document order. */
const texts = (root: ParentNode, selector: string): string[] => [...root.querySelectorAll(selector)].map((node) => node.textContent ?? "");
/** A label's own words: its text nodes only, without the control's options. */
const ownText = (node: Element): string => [...node.childNodes].filter((child) => child.nodeType === 3).map((child) => child.textContent).join("").trim();
const fieldset = (root: ParentNode, legend: string): Element => {
  const found = [...root.querySelectorAll("fieldset")].find((node) => node.querySelector("legend")?.textContent === legend);
  if (!found) throw new Error(`no fieldset ${legend}`);
  return found;
};
const firstOption = (root: Element, field: string): string => root.querySelector(`select[name$=":${field}"] option[value=""]`)?.textContent ?? "";
const firstCell = (root: ParentNode, slot: string): string[] => texts(root, `tr[data-slot="${slot}"] > td`);

afterEach(cleanup);

describe("the agents area in Chinese", () => {
  it("shows the settings page in Chinese", async () => {
    await i18n.changeLanguage("zh");
    const { container } = render(<AgentSettings agents={agents} preferences={preferences} drafts={{}} onDraft={vi.fn()} onSave={vi.fn()} />);
    const text = container.textContent ?? "";
    for (const expected of [
      "操作者 op-1 · 偏好版本 3。修改只影响之后确认的组；已确认的组保留它冻结的选择。", "安装", "默认模型", "默认上下文", "agent 默认",
      "默认 agent", "无（每个组都得自己选一个）", "codex 的默认值", "估算槽", "协调槽", "模型", "上下文", "继承", "保存 agent 偏好",
    ]) expect(text, expected).toContain(expected);
    // Each site by its own element.
    const section = container.querySelector("section")!;
    expect(section.getAttribute("aria-label")).toBe("agent 设置");
    expect(texts(container, "h3")).toEqual(["agent"]);
    expect(texts(container, "section > p")).toEqual(["操作者 op-1 · 偏好版本 3。修改只影响之后确认的组；已确认的组保留它冻结的选择。"]);
    expect(texts(container, "thead th")).toEqual(["安装", "类型", "版本", "默认模型", "默认上下文"]);
    expect(texts(container, "tbody td")).toEqual(["codex", "codex", "1.0", "gpt-x", "agent 默认"]);
    const defaultLabel = container.querySelector(`select[name="agents:default-agent"]`)!.closest("label")!;
    expect(ownText(defaultLabel)).toBe("默认 agent");
    expect(defaultLabel.querySelector(`option[value=""]`)?.textContent).toBe("无（每个组都得自己选一个）");
    expect(texts(container, "legend")).toEqual(["codex 的默认值", "估算槽", "协调槽"]);
    const estimator = fieldset(container, "估算槽");
    expect(estimator.getAttribute("aria-label")).toBe("估算槽");
    expect([...estimator.querySelectorAll("label")].map(ownText)).toEqual(["agent", "模型", "上下文"]);
    expect(firstOption(estimator, "agent")).toBe("继承");
    expect(firstOption(estimator, "context")).toBe("继承");
    expect(texts(estimator, `select[name$=":context"] option`)).toEqual(["继承", "agent 默认", "1000000 token"]);
    expect(texts(container, "button")).toEqual(["保存 agent 偏好"]);
    cleanup();
    const empty = render(<AgentSettings agents={{ ...agents, installations: [] }} preferences={preferences} drafts={{}} onDraft={vi.fn()} onSave={vi.fn()} />).container;
    expect(texts(empty, `p[role="note"]`)).toEqual(["安装表里没有任何 agent。运行 orca agents init，把 ORCA_AGENTS_TABLE 指向它写出的表（默认 ~/.orca/agents.json），然后重启面板。"]);
  });

  it("shows the proposal's agent editor, the confirmed view, the read failure and the retry notice in Chinese", async () => {
    await i18n.changeLanguage("zh");
    const { container } = render(
      <AgentSelectionEditor view={view("editable")} agents={agents} preview={preview} preferences={preferences.preferences} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()}
        onReread={vi.fn()} retryNotice={retryNotice({ state: "waiting", attempt: 1, delayMs: 10_000 })} />,
    );
    const editor = container.textContent ?? "";
    for (const expected of [
      "agent · 提案 v2", "下面有一项选择没有解析成功；每个槽位都解析成功之前不提供确认。", "重新读取 agent 选择", "10 秒后重新读取（第 1/5 次重试）。",
      "组 执行", "设置组 执行 的 agent", "清除组 估算 的 agent", " 从下次重新估算起使用；", "忽略计划里的模型（gpt-5x）", "继承（计划：codex）",
      "这个任务自己的一层", "codex 来自操作者", "gpt-x 来自agent 描述符", "1000000 token 来自计划（组）", "被拒 · agent-installation-missing",
      "协调", "为任务 a 设置 agent", "清除任务 a 的 agent",
    ]) expect(editor, expected).toContain(expected);
    // Each site by its own element (preflight P4: the legends and the fieldsets' names exactly).
    expect(container.querySelector("section")!.getAttribute("aria-label")).toBe("agent 选择");
    expect(texts(container, "h3")).toEqual(["agent · 提案 v2"]);
    expect(texts(container, `p[role="alert"]`)).toEqual(["下面有一项选择没有解析成功；每个槽位都解析成功之前不提供确认。"]);
    expect(texts(container, `p[data-retry]`)).toEqual(["10 秒后重新读取（第 1/5 次重试）。"]);
    expect(texts(container, "legend")).toEqual(["组 执行", "组 估算", "组 协调", "任务 a", "任务 b"]);
    expect([...container.querySelectorAll("fieldset")].map((node) => node.getAttribute("aria-label"))).toEqual(["组 执行", "组 估算", "组 协调", "任务 a", "任务 b"]);
    expect(texts(container, "button")).toEqual([
      "重新读取 agent 选择", "设置组 执行 的 agent", "清除组 执行 的 agent", "设置组 估算 的 agent", "清除组 估算 的 agent", "设置组 协调 的 agent", "清除组 协调 的 agent",
      "为任务 a 设置 agent", "清除任务 a 的 agent", "为任务 b 设置 agent", "清除任务 b 的 agent",
    ]);
    expect(texts(container, "small")).toContain(" 从下次重新估算起使用；和任何提案修改一样，它会推进提案版本。");
    const worker = fieldset(container, "组 执行");
    expect([...worker.querySelectorAll("label")].map(ownText)).toEqual(["agent", "忽略计划里的agent（codex）", "模型", "忽略计划里的模型（gpt-5x）", "上下文", "忽略计划里的上下文窗口（1000000 token）"]);
    expect(firstOption(worker, "agent")).toBe("继承（计划：codex）");
    expect(firstOption(worker, "context")).toBe("继承");
    expect(firstOption(fieldset(container, "组 估算"), "agent")).toBe("继承");
    expect(texts(container, "thead th")).toEqual(["槽位", "agent", "模型", "上下文", "这个任务自己的一层"]);
    expect(firstCell(container, "task:a").slice(0, 4)).toEqual(["a", "codex 来自操作者", "gpt-x 来自agent 描述符", "1000000 token 来自计划（组）"]);
    expect(firstCell(container, "task:b").slice(0, 2)).toEqual(["b", "暂时不可用，点「重新读取」再问一次 · ccloop-timeout"]);
    expect(firstCell(container, "reconcile")).toEqual(["协调", "被拒 · agent-installation-missing", ""]);
    cleanup();

    const stale = render(<AgentSelectionEditor view={view("editable")} agents={agents} preview={{ ...preview, proposalVersion: 1 }} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />).container;
    expect(texts(stale, `p[role="status"]`)).toEqual(["显示的解析结果属于提案 v1；正在重新读取。确认会等它。"]);
    cleanup();

    const confirmedRoot = render(<AgentSelectionEditor view={view("confirmed")} agents={agents} preview={null} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />).container;
    const confirmed = confirmedRoot.textContent ?? "";
    for (const expected of ["agent（确认时已冻结）", "槽位", "未记录", "协调"]) expect(confirmed, expected).toContain(expected);
    expect(confirmedRoot.querySelector("section")!.getAttribute("aria-label")).toBe("agent 选择");
    expect(texts(confirmedRoot, "h3")).toEqual(["agent（确认时已冻结）"]);
    expect(texts(confirmedRoot, "thead th")).toEqual(["槽位", "agent", "模型", "上下文"]);
    expect(firstCell(confirmedRoot, "task:a")).toEqual(["a", "未记录"]);
    expect(firstCell(confirmedRoot, "reconcile")).toEqual(["协调", "未记录"]);
    cleanup();

    const failed = render(<AgentSelectionEditor view={view("editable")} agents={null} preview={null} agentsFailure="control-port-unconfigured" drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />).container;
    expect(failed.textContent).toContain("读不到 agent 选择 · control-port-unconfigured。没有它们就不提供确认。");
    expect(failed.querySelector("section")!.getAttribute("aria-label")).toBe("agent 选择");
    expect(texts(failed, "h3")).toEqual(["agent"]);
    expect(texts(failed, `p[role="alert"]`)).toEqual(["读不到 agent 选择 · control-port-unconfigured。没有它们就不提供确认。"]);
    cleanup();

    const resolving = render(<AgentSelectionEditor view={view("editable")} agents={agents} preview={null} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />).container;
    expect(resolving.textContent).toContain("正在解析 agent 选择…");
    expect(resolving.querySelector("section")!.getAttribute("aria-label")).toBe("agent 选择");
    expect(texts(resolving, "h3")).toEqual(["agent"]);
    expect(texts(resolving, `p[role="status"]`)).toEqual(["正在解析 agent 选择…"]);

    expect(retryNotice({ state: "waiting", attempt: 1, delayMs: 10_000 })).toBe("10 秒后重新读取（第 1/5 次重试）。");
    expect(retryNotice({ state: "paused" })).toBe("页面隐藏期间暂停重试；回到页面后继续。");
    expect(retryNotice({ state: "stopped" })).toBe("重试 5 次后已停止；点「重新读取」会再问一次。");
    expect(retryNotice(null)).toBeNull();
  });

  it("keeps today's English text byte for byte", async () => {
    await i18n.changeLanguage("en");
    expect(retryNotice({ state: "waiting", attempt: 2, delayMs: 20_000 })).toBe("Reading again in 20 s (retry 2/5).");
    expect(retryNotice({ state: "paused" })).toBe("Retrying is paused while the page is hidden; it resumes when you come back.");
    expect(retryNotice({ state: "stopped" })).toBe("Stopped after 5 retries; Re-read asks again.");
  });
});
