// @vitest-environment jsdom
/**
 * Tester #321 part C, the Web half: a task whose runs together cost a multiple of the group median (or ran past 30 minutes)
 * is a row in the group's Problems region and counted on its tab, and the task's detail says what it cost against what --
 * a notice, nothing to press. On its last attempt a running task's progress says one more failure ends the run. Named
 * mutations are at each assertion.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { progressText } from "../src/TaskDetail.js";
import type { GroupViewV1, WorkItemProgressV1 } from "../src/controlTypes.js";
import { config, run, view, workItem } from "./fixtures/board.js";

const NOW = Date.UTC(2026, 10, 16, 4, 0, 0);
const MIN = 60_000;
beforeEach(() => {
  globalThis.fetch = (async () => new Response("{}", { status: 404, headers: { "content-type": "application/json" } })) as typeof fetch;
});
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

const landed = (runId: string, taskId: string, tokens: number, minutes: number) =>
  run({ runId, taskId, state: "landed", startedAt: NOW - 200 * MIN, endedAt: NOW - 100 * MIN, used: { tokens, activeMs: minutes * MIN, attempts: 1, sessions: 1 } });
/** Three ordinary tasks of 1M tokens and 5 minutes, and x: two runs, 4M tokens, 10 minutes -- 4x the median tokens. */
const group = (xTokens: number): GroupViewV1 => view(
  ["a", "b", "c", "x"].map((taskId) => workItem({ taskId, status: "completed", category: "done", currentRunId: `run-${taskId}` })),
  [landed("run-a", "a", 1_000_000, 5), landed("run-b", "b", 1_000_000, 5), landed("run-c", "c", 1_000_000, 5),
    landed("run-x0", "x", xTokens / 2, 5), landed("run-x", "x", xTokens / 2, 5)],
);
const mount = (value: GroupViewV1) => render(<ControlGroupView view={value} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} now={NOW} />);
const problemsTab = (): HTMLElement => screen.getByRole("tab", { name: "Problems" });

describe("a task costing a multiple of its group (#321 C)", () => {
  it("is a Problems row, counted on the tab, and says it stopped nothing", async () => {
    mount(group(4_000_000));
    // mutation: drop `+ costOutliers.length` from the Problems hint -> no "1 to look at" -> red
    expect(problemsTab().textContent).toContain("1 to look at");
    await act(async () => { fireEvent.click(problemsTab()); });
    const panel = screen.getByRole("tabpanel", { name: "Problems" });
    // mutation: drop <CostOutlierRows> from the Problems region -> no row -> red
    const row = panel.querySelector('[data-cost-task-id="x"]');
    expect(row?.textContent).toBe("x costs more than its group (4.0× the median tokens): 2 runs · 10 min · 4M tokens. A notice only: nothing was paused or stopped.");
    expect(panel.querySelectorAll("[data-cost-task-id]")).toHaveLength(1);
  });

  it("is not a row below the multiple", async () => {
    mount(group(2_900_000));
    expect(problemsTab().textContent).not.toContain("to look at");
    await act(async () => { fireEvent.click(problemsTab()); });
    expect(screen.getByRole("tabpanel", { name: "Problems" }).querySelector("[data-cost-task-id]")).toBeNull();
  });

  it("says in the task's detail what it cost against what, and why it is flagged", async () => {
    mount(group(4_000_000));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "x" })); });
    // mutation: drop the `cost` prop ControlGroupView passes to TaskDetail -> no line -> red
    expect(screen.getByTestId("task-cost-x").textContent).toBe("Cost: 2 runs · 10 min · 4M tokens (group median over 3 finished other tasks: 1M tokens · 5 min)");
    expect(screen.getByTestId("task-cost-flagged-x").textContent).toContain("4.0× the median tokens");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "a" })); });
    expect(screen.getByTestId("task-cost-a").textContent).toContain("1 run · 5 min · 1M tokens");
    expect(screen.queryByTestId("task-cost-flagged-a")).toBeNull();
  });

  it("says there is no median with too few finished tasks, and that a running task's figures are so far", async () => {
    const two = view([workItem({ taskId: "a", status: "completed", category: "done" }), workItem({ taskId: "r", status: "active", category: "running", currentRunId: "run-r" })],
      [landed("run-a", "a", 1_000_000, 5), run({ runId: "run-r", taskId: "r", state: "running", startedAt: NOW - 3 * MIN, used: { tokens: 500_000, activeMs: 0, attempts: 1, sessions: 1 } })]);
    mount(two);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "r" })); });
    // mutation: drop the tooFew branch of costLineText -> a null median is read as one -> red
    // mutation: drop the soFar suffix -> red
    expect(screen.getByTestId("task-cost-r").textContent).toBe("Cost: 1 run · 3 min · 500K tokens so far (1 finished other tasks to compare with; 3 are needed for a median)");
  });

  it("speaks Chinese", async () => {
    await i18n.changeLanguage("zh");
    mount(group(4_000_000));
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "问题" })); });
    expect(within(screen.getByRole("tabpanel", { name: "问题" })).getByText(/x 花费高于同组（token 为中位数的 4\.0 倍）：2 次运行 · 10 分钟 · 4M token。仅为提示/)).toBeTruthy();
  });
});

describe("the attempt position (#321 C)", () => {
  const progress = (current: number, max: number, step: WorkItemProgressV1["step"]): WorkItemProgressV1 => ({ runId: "r", step, attempt: { current, max }, tokens: null, lastTransitionAt: null });
  it("says the last attempt of a run in progress is the last, and nothing otherwise", async () => {
    // mutation: drop the lastAttempt suffix -> red
    expect(progressText(progress(3, 3, "verify"))).toContain("attempt 3/3 (the last: one more failure ends this run)");
    expect(progressText(progress(2, 3, "verify"))).not.toContain("the last");
    // mutation: drop the in-progress step check -> a finished run's "3/3" says it -> red
    expect(progressText(progress(3, 3, "failed"))).not.toContain("the last");
    await i18n.changeLanguage("zh");
    expect(progressText(progress(3, 3, "execute"))).toContain("（最后一次：再失败这次运行就会结束）");
  });
});
