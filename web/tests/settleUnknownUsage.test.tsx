// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunActivity } from "../src/TaskDetail.js";
import i18n from "../src/i18n.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { controlCommandPath, commandEnvelope } from "../src/controlApi.js";
import { config, run, view } from "./usageRecoveryFixture.js";
import { workItem } from "./fixtures/board.js";
afterEach(cleanup);
const remaining = { work: { tokens: 91, activeMs: 920, attempts: 3, sessions: 4 }, handoff: { tokens: 51, activeMs: 520, attempts: 5, sessions: 6 } };
const failed = () => run({ state: "blocked", outcome: "failed", stopReason: "Error: codex-event-error", unknownUsageSettlement: { generation: 7, highWater: 2, remaining, allowed: true, refusalReason: null, acknowledge: "charge-remaining-grant" as const } });
const show = (roles: ("owner" | "member")[], r = failed()) => { const onCommand = vi.fn(); const result = render(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "runs", taskId: null, runId: null }} view={view([r])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} roles={roles} />); return { ...result, onCommand }; };
describe("owner conservative usage settlement", () => {
  it("requires explicit confirmation of all dimensions of both buckets and sends identity only", () => {
    const { onCommand } = show(["owner"]);
    fireEvent.click(screen.getByRole("button", { name: "Settle unknown usage" }));
    const confirm = screen.getByRole("button", { name: "Confirm irreversible settlement" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/not actual usage reported by the model/)).toBeTruthy();
    expect(screen.getByText(/cannot be undone/)).toBeTruthy();
    const table = screen.getByRole("table", { name: "Remaining grant to charge" });
    expect(within(table).getAllByRole("row").map(row => row.textContent)).toEqual(["BucketTokensActive time (ms)AttemptsSessions", "Work9192034", "Handoff5152056"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "I understand and approve this charge" }));
    fireEvent.click(confirm);
    expect(onCommand).toHaveBeenCalledExactlyOnceWith({ verb: "settle-unknown-usage", groupId: "g", expectedRevision: 6, payload: { taskId: "a", runId: "run-a", generation: 7, acknowledge: "charge-remaining-grant" } });
    const action = onCommand.mock.calls[0]![0];
    expect(controlCommandPath(action)).toBe("/api/control/groups/g/settle-unknown-usage");
    expect(commandEnvelope("intent", action)).toEqual({ commandId: "intent", expectedRevision: 6, payload: action.payload });
  });
  it.each([["member"], []] as ("owner" | "member")[][])("does not authorize a member or an absent account: %j", (role) => {
    show([role].filter(Boolean) as ("owner" | "member")[]);
    expect(screen.queryByRole("button", { name: "Settle unknown usage" })).toBeNull();
    expect(screen.getByText(/Contact an owner/)).toBeTruthy();
  });
  it("uses server refusal instead of claiming isolation proof and keeps failure visible", () => {
    const r = failed(); r.unknownUsageSettlement!.allowed = false; r.unknownUsageSettlement!.refusalReason = "run-stop-proof-required";
    show(["owner"], r);
    expect(screen.queryByRole("button", { name: "Settle unknown usage" })).toBeNull();
    expect(screen.getByText(/complete isolated stop proof/)).toBeTruthy();
    expect(within(screen.getByRole("tabpanel")).getByText(/reported an error/)).toBeTruthy();
  });
  it("drops confirmation when the server preview changes", () => {
    const { rerender, onCommand } = show(["owner"]);
    fireEvent.click(screen.getByRole("button", { name: "Settle unknown usage" }));
    fireEvent.click(screen.getByRole("checkbox"));
    const r = failed(); r.unknownUsageSettlement = { ...r.unknownUsageSettlement!, highWater: 3 };
    rerender(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "runs", taskId: null, runId: null }} view={view([r])} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} roles={["owner"]} />);
    expect(screen.queryByRole("button", { name: "Confirm irreversible settlement" })).toBeNull();
  });
});

it("activity names conservative method and all charged dimensions rather than implying actual model usage", async () => {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ schema: "orca-run-activity-v1", runId: "run-a", entries: [{ seq: 1, groupId: "g", taskId: "a", runId: "run-a", at: 1234, kind: "usage-settled", body: { method: "remaining-grant", charged: remaining } }] })));
  try {
    render(<RunActivity runId="run-a" changeSeq={1} />);
    const line = (await screen.findByRole("listitem")).textContent!;
    expect(line).toContain("remaining grant (conservative accounting)");
    expect(line).toContain("Work: 91 tokens, 920 ms, 3 attempts, 4 sessions");
    expect(line).toContain("Handoff: 51 tokens, 520 ms, 5 attempts, 6 sessions");
  } finally { vi.unstubAllGlobals(); }
});
it("renders Chinese settlement and recovery guidance", async () => {
  await i18n.changeLanguage("zh");
  try { show(["owner"]); fireEvent.click(screen.getByRole("button", { name: "结清未知用量" })); expect(screen.getByText(/不是模型报告的实际用量/)).toBeTruthy(); expect(screen.getByRole("table", { name: "将记入的剩余额度" })).toBeTruthy(); }
  finally { await i18n.changeLanguage("en"); }
});

// Spec 2026-10-13-unmetered-usage-settlement-design.md §A.2–A.4: an unlimited run's unknown usage is released, and the
// unmetered work tokens are never shown as 0.
describe("owner unmetered release", () => {
  const unlimited = { work: { tokens: null, activeMs: 920, attempts: 3, sessions: 4 }, handoff: remaining.handoff };
  const releasable = () => run({ state: "blocked", outcome: "failed", stopReason: "Error: codex-exit-error", unknownUsageSettlement: { generation: 7, highWater: 2, remaining: unlimited, allowed: true, refusalReason: null, acknowledge: "release-unmetered" as const } });
  const released = () => run({ state: "blocked", outcome: "failed", stopReason: "Error: codex-exit-error", unknownUsageSettlement: { generation: 7, highWater: 2, remaining: { work: { ...unlimited.work, activeMs: 0, attempts: 0, sessions: 0 }, handoff: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 } }, allowed: false, refusalReason: "run-usage-settled", acknowledge: "release-unmetered" as const,
    settlement: { method: "owner-acknowledged-unmetered", charged: unlimited, principal: "user:owner", at: 1234, reservationDisposition: "committed" } as NonNullable<ReturnType<typeof run>["unknownUsageSettlement"]>["settlement"] } });
  it("offers only the release for an unlimited remainder, shows its tokens as not metered and sends release-unmetered", () => {
    const { onCommand } = show(["owner"], releasable());
    expect(screen.queryByRole("button", { name: "Settle unknown usage" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Release unknown usage unmetered" }));
    expect(screen.getByText("This run has no work token limit, so nothing can be charged for its unknown work tokens. Releasing records no work token number; the group's token totals become a lower bound. Every other limit is charged from the remaining grant. It cannot be undone and does not restart the task.")).toBeTruthy();
    const table = screen.getByRole("table", { name: "Remaining grant to charge" });
    expect(within(table).getAllByRole("row").map(row => row.textContent)).toEqual(["BucketTokensActive time (ms)AttemptsSessions", "Worknot metered92034", "Handoff5152056"]);
    const confirm = screen.getByRole("button", { name: "Confirm irreversible release" });
    fireEvent.click(screen.getByRole("checkbox", { name: "I understand and approve this release" }));
    fireEvent.click(confirm);
    expect(onCommand).toHaveBeenCalledExactlyOnceWith({ verb: "settle-unknown-usage", groupId: "g", expectedRevision: 6, payload: { taskId: "a", runId: "run-a", generation: 7, acknowledge: "release-unmetered" } });
  });
  it("names the unmetered release in the receipt and never shows its work tokens as 0", () => {
    show(["owner"], released());
    expect(screen.getByText("Settled by user:owner at 1970-01-01T00:00:01.234Z · released unmetered by owner")).toBeTruthy();
    expect(screen.getByText("Released unmetered. The failure remains; retry is a separate action after dispatch resumes and still requires budget.")).toBeTruthy();
    const table = screen.getByRole("table", { name: "Conservatively charged" });
    expect(within(table).getAllByRole("row").map(row => row.textContent)).toEqual(["BucketTokensActive time (ms)AttemptsSessions", "Worknot metered92034", "Handoff5152056"]);
  });
  it("renders the release in Chinese", async () => {
    await i18n.changeLanguage("zh");
    try {
      show(["owner"], releasable());
      fireEvent.click(screen.getByRole("button", { name: "不计量放行未知用量" }));
      expect(screen.getByText("此运行的工作 token 不设上限，未知的工作 token 无法按额度记入。放行不记入任何工作 token 数，组的 token 总数因此只是下限。其他各项上限照剩余额度记入。放行不能撤销，也不会重新运行任务。")).toBeTruthy();
      expect(within(screen.getByRole("table", { name: "将记入的剩余额度" })).getAllByRole("row")[1]!.textContent).toBe("工作不计量92034");
      expect(screen.getByRole("checkbox", { name: "我理解并同意此次放行" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "确认不可撤销的放行" })).toBeTruthy();
      cleanup(); show(["owner"], released());
      expect(screen.getByText("user:owner 于 1970-01-01T00:00:01.234Z 结清 · owner 不计量放行")).toBeTruthy();
      expect(screen.getByText("已不计量放行。失败原因保留；恢复调度后可另行重试，仍须有足够预算。")).toBeTruthy();
    } finally { await i18n.changeLanguage("en"); }
  });
  it("activity names the unmetered release and its unmetered work tokens", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ schema: "orca-run-activity-v1", runId: "run-a", entries: [{ seq: 1, groupId: "g", taskId: "a", runId: "run-a", at: 1234, kind: "usage-settled", body: { method: "owner-acknowledged-unmetered", charged: unlimited } }] })));
    try {
      render(<RunActivity runId="run-a" changeSeq={1} />);
      const line = (await screen.findByRole("listitem")).textContent!;
      expect(line).toContain("usage settled · released unmetered by owner · Work: tokens not metered, 920 ms, 3 attempts, 4 sessions · Handoff: 51 tokens, 520 ms, 5 attempts, 6 sessions");
      await i18n.changeLanguage("zh");
      cleanup(); render(<RunActivity runId="run-a" changeSeq={1} />);
      expect((await screen.findByRole("listitem")).textContent!).toContain("owner 不计量放行 · 工作：token 不计量，920 毫秒，3 次尝试，4 个会话 · 交接：51 token，520 毫秒，5 次尝试，6 个会话");
    } finally { await i18n.changeLanguage("en"); vi.unstubAllGlobals(); }
  });
  it("tells the budget reader the group's usage is incomplete", async () => {
    const shown = (count: number) => { const v = view([failed()]); v.ledger.unmeteredRuns = count; return render(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "preparation", taskId: null, runId: null }} view={v} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} roles={["owner"]} />); };
    shown(2); expect(document.body.textContent).toContain(" · usage incomplete: 2 run(s) released unmetered");
    cleanup(); shown(0); expect(document.body.textContent).not.toContain("usage incomplete");
    await i18n.changeLanguage("zh");
    try { cleanup(); shown(2); expect(document.body.textContent).toContain(" · 用量不完整：2 个运行被不计量放行"); } finally { await i18n.changeLanguage("en"); }
  });
});

// Spec 2026-10-13-unmetered-usage-settlement-design.md §B.1–B.2: where Retry is hidden for unknown usage, the way forward shows.
describe("the way forward for a failed task with unknown usage", () => {
  const inTask = (roles: ("owner" | "member")[]) => render(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "progress", taskId: "a", runId: null }} view={{ ...view([failed()]), workItems: [workItem({ taskId: "a", status: "blocked", currentRunId: "run-a" })] }} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} roles={roles} />);
  it("task detail shows the settlement entry instead of nothing", async () => {
    inTask(["owner"]);
    const task = document.querySelector<HTMLElement>('section[data-task-id="a"]')!;
    expect(within(task).queryByRole("button", { name: /Retry/ })).toBeNull();
    expect(within(task).getByText("This run has unknown usage.")).toBeTruthy();
    expect(within(task).getByRole("button", { name: "Settle unknown usage" })).toBeTruthy();
    await i18n.changeLanguage("zh");
    try { expect(within(task).getByText("此运行有未知用量。")).toBeTruthy(); expect(within(task).getByRole("button", { name: "结清未知用量" })).toBeTruthy(); }
    finally { await i18n.changeLanguage("en"); }
  });
  it("a stop-mode-conflict preview says to resume dispatch first, in en and zh", async () => {
    const r = failed(); r.unknownUsageSettlement!.allowed = false; r.unknownUsageSettlement!.refusalReason = "stop-mode-conflict";
    show(["owner"], r);
    expect(screen.getByText("The group's current stop does not allow this command. Leave the stop first (\"Resume dispatch\", or the resume offered after a handoff), then try again.")).toBeTruthy();
    await i18n.changeLanguage("zh");
    try { expect(screen.getByText("组当前的停止方式不允许这条命令。先解除停止（「恢复调度」，或交接后提供的恢复），再重试。")).toBeTruthy(); }
    finally { await i18n.changeLanguage("en"); }
  });
});
