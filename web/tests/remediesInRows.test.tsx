// @vitest-environment jsdom
/**
 * Feedback #56/#57 (and #39's remainder): retry, settlement and saved-result verification were offered only in the Runs
 * table and at the bottom of the task detail, while the overview jumps to the Problems region, which offered only "open
 * run". The same buttons, behind the same gates, are now offered in the Problems row and in the work item row -- and each
 * sends exactly the command its existing counterpart sends, so a person who finds it there is not handed a second,
 * subtly different action.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { TaskDetail } from "../src/TaskDetail.js";
import type { ControlAction } from "../src/controlApi.js";
import type { GroupViewV1, RunViewV1 } from "../src/controlTypes.js";
import { config, run, view, workItem } from "./fixtures/board.js";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

type Region = "problem" | "progress" | "runs";
const FAILED: Partial<RunViewV1> = { state: "blocked", blockedReason: "terminal:failed", outcome: "failed", stopReason: "Error: codex-result-invalid: /runs/r/attempt-1" };
const failedGroup = (over: Partial<RunViewV1> = {}): GroupViewV1 =>
  view([workItem({ taskId: "a", status: "blocked", currentRunId: "run-a", lineageRunIds: ["run-a"] })], [run({ ...FAILED, ...over })]);
const show = (v: GroupViewV1, region: Region, roles: ("owner" | "member")[] = ["owner"]) => {
  const onCommand = vi.fn<(action: ControlAction) => void>();
  render(<ControlGroupView focus={{ kind: "group", groupId: "g", region, taskId: null, runId: null }} view={v} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} roles={roles} />);
  return onCommand;
};
const problemRow = (runId = "run-a"): HTMLElement => document.querySelector<HTMLElement>(`[data-problem-run-id="${runId}"]`)!;
const workRow = (taskId = "a"): HTMLElement => within(screen.getByRole("tabpanel")).getByRole("button", { name: taskId }).closest("tr")!;
/** The command the Runs table's own button sends: the reference every new site is compared to. */
const runsTableCommand = (v: GroupViewV1, name: string): ControlAction => {
  const onCommand = show(v, "runs");
  fireEvent.click(within(screen.getByRole("tabpanel")).getByRole("button", { name }));
  cleanup();
  expect(onCommand).toHaveBeenCalledTimes(1);
  return onCommand.mock.calls[0]![0];
};

describe("Retry where the problem is shown (feedback #56/#57)", () => {
  it("offers the Runs table's Retry task in the Problems row, sending the same retry-task", () => {
    const reference = runsTableCommand(failedGroup(), "Retry task a");
    const onCommand = show(failedGroup(), "problem");
    fireEvent.click(within(problemRow()).getByRole("button", { name: "Retry task a" }));
    expect(onCommand.mock.calls).toEqual([[reference]]);
  });

  it("offers the Runs table's Retry task in the work item row, sending the same retry-task", () => {
    const reference = runsTableCommand(failedGroup(), "Retry task a");
    const onCommand = show(failedGroup(), "progress");
    fireEvent.click(within(workRow()).getByRole("button", { name: "Retry task a" }));
    expect(onCommand.mock.calls).toEqual([[reference]]);
  });

  it("offers the Runs table's Retry run for a driver-blocked run in both rows, sending the same recovery-retry", () => {
    const blocked = failedGroup({ state: "blocked", blockedReason: "out-of-bounds:x", outcome: "succeeded", stopReason: null });
    const reference = runsTableCommand(blocked, "Retry run a");
    let onCommand = show(blocked, "problem");
    fireEvent.click(within(problemRow()).getByRole("button", { name: "Retry run a" }));
    expect(onCommand.mock.calls).toEqual([[reference]]);
    cleanup();
    onCommand = show(blocked, "progress");
    fireEvent.click(within(workRow()).getByRole("button", { name: "Retry run a" }));
    expect(onCommand.mock.calls).toEqual([[reference]]);
  });

  it("offers no Retry in either row where the Runs table offers none (a stop intent, an archived group)", () => {
    const stopped: GroupViewV1 = { ...failedGroup(), stop: { mode: "handoff", state: "handoff-complete", frozenRunIds: [], acceptedAt: "2026-10-08T00:00:00.000Z", deadlineAt: null } };
    const archived: GroupViewV1 = { ...failedGroup(), summary: { ...failedGroup().summary, archived: true } };
    for (const v of [stopped, archived]) {
      show(v, "runs");
      expect(screen.queryAllByRole("button", { name: /^Retry (run|task)/ })).toHaveLength(0);
      cleanup();
      show(v, "problem");
      expect(within(problemRow()).queryAllByRole("button", { name: /^Retry (run|task)/ })).toHaveLength(0);
      cleanup();
      show(v, "progress");
      expect(within(workRow()).queryAllByRole("button", { name: /^Retry (run|task)/ })).toHaveLength(0);
      cleanup();
    }
  });

  it("keeps the raw reason beside the friendly explanation in both rows", () => {
    for (const [region, row] of [["problem", () => problemRow()], ["progress", () => workRow()]] as const) {
      show(failedGroup(), region);
      expect(within(row()).getByText(/did not answer in the required JSON format/)).toBeTruthy();
      expect(within(row()).getByText("Error: codex-result-invalid: /runs/r/attempt-1")).toBeTruthy();
      cleanup();
    }
  });
});

const remaining = { work: { tokens: 91, activeMs: 920, attempts: 3, sessions: 4 }, handoff: { tokens: 51, activeMs: 520, attempts: 5, sessions: 6 } };
const unknownUsage = (allowed: boolean): Partial<RunViewV1> => ({
  stopReason: "Error: codex-event-error",
  unknownUsageSettlement: { generation: 7, highWater: 2, remaining, allowed, refusalReason: null, acknowledge: "charge-remaining-grant" as const },
});
const settle = (scope: HTMLElement): void => {
  fireEvent.click(within(scope).getByRole("button", { name: "Settle unknown usage" }));
  fireEvent.click(within(scope).getByRole("checkbox", { name: "I understand and approve this charge" }));
  fireEvent.click(within(scope).getByRole("button", { name: "Confirm irreversible settlement" }));
};

describe("Settle unknown usage where the problem is shown (feedback #56/#57)", () => {
  it("offers the Runs table's settlement in both rows, sending the same settle-unknown-usage", () => {
    const v = failedGroup(unknownUsage(true));
    const runsCommand = show(v, "runs");
    settle(screen.getByRole("tabpanel"));
    cleanup();
    expect(runsCommand).toHaveBeenCalledTimes(1);
    const reference = runsCommand.mock.calls[0]![0];
    expect(reference.verb).toBe("settle-unknown-usage");
    let onCommand = show(v, "problem");
    settle(problemRow());
    expect(onCommand.mock.calls).toEqual([[reference]]);
    cleanup();
    onCommand = show(v, "progress");
    settle(workRow());
    expect(onCommand.mock.calls).toEqual([[reference]]);
  });

  it("offers no settlement in either row where the Runs table offers none (a member, a refused settlement)", () => {
    for (const [v, roles] of [[failedGroup(unknownUsage(true)), ["member"]], [failedGroup(unknownUsage(false)), ["owner"]]] as const) {
      show(v, "runs", [...roles]);
      expect(screen.queryByRole("button", { name: "Settle unknown usage" })).toBeNull();
      cleanup();
      show(v, "problem", [...roles]);
      expect(within(problemRow()).queryByRole("button", { name: "Settle unknown usage" })).toBeNull();
      cleanup();
      show(v, "progress", [...roles]);
      expect(within(workRow()).queryByRole("button", { name: "Settle unknown usage" })).toBeNull();
      cleanup();
    }
  });
});

const recoveryOf = { sourceRunId: "run-a", sourceAttempt: 1, capsuleHash: "a".repeat(64), snapshotHash: "b".repeat(64), normalizedExecutionHash: "c".repeat(64) };
const eligible = (): void => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/saved-result-eligibility")
    ? new Response(JSON.stringify({ status: "eligible", recoveryOf }), { status: 200, headers: { "content-type": "application/json" } })
    : new Response("", { status: 404 })));
};

describe("Verify saved results where the problem is shown (feedback #56/#57)", () => {
  it("offers the task detail's verification in both rows, sending the same verify-saved-result", async () => {
    eligible();
    const v = failedGroup();
    const detailCommand = vi.fn<(action: ControlAction) => void>();
    render(<TaskDetail view={v} item={v.workItems[0]!} drafts={{}} onDraft={vi.fn()} onCommand={detailCommand} />);
    fireEvent.click(await screen.findByRole("button", { name: "Verify saved results" }));
    cleanup();
    expect(detailCommand).toHaveBeenCalledTimes(1);
    const reference = detailCommand.mock.calls[0]![0];
    expect(reference.verb).toBe("verify-saved-result");
    let onCommand = show(v, "problem");
    fireEvent.click(await within(problemRow()).findByRole("button", { name: "Verify saved results" }));
    expect(onCommand.mock.calls).toEqual([[reference]]);
    cleanup();
    onCommand = show(v, "progress");
    fireEvent.click(await within(workRow()).findByRole("button", { name: "Verify saved results" }));
    expect(onCommand.mock.calls).toEqual([[reference]]);
  });

  it("offers no verification in either row where the task detail offers none (a succeeded run)", async () => {
    eligible();
    const v = failedGroup({ state: "blocked", blockedReason: "out-of-bounds:x", outcome: "succeeded", stopReason: null });
    render(<TaskDetail view={v} item={v.workItems[0]!} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    await screen.findByText("Runs of a");
    expect(screen.queryByRole("button", { name: "Verify saved results" })).toBeNull();
    cleanup();
    show(v, "problem");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(within(problemRow()).queryByRole("button", { name: "Verify saved results" })).toBeNull();
    cleanup();
    show(v, "progress");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(within(workRow()).queryByRole("button", { name: "Verify saved results" })).toBeNull();
    expect(vi.mocked(fetch).mock.calls.filter(([input]) => String(input).endsWith("/saved-result-eligibility"))).toHaveLength(0);
  });
});
