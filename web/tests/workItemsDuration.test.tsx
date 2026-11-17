// @vitest-environment jsdom
/**
 * Tester #331: the Work items table spent two of its seven columns on bare ids (`run` showed the current run's
 * `run-<uuid>`, `pending` the pending run's) while how long a task took had no column at all. The `run` column is now a
 * `duration` column and `pending` is gone; the run ids stay in the task's detail (its runs list) and in Results.
 */
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { RunViewV1, WorkItemViewV1 } from "../src/controlTypes.js";
import { config, run, view, workItem } from "./fixtures/board.js";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);
const used = (activeMs: number) => ({ tokens: 10, activeMs, attempts: 1, sessions: 1 });
/** `"clock"`: no `now` prop, so the view reads its own clock. */
const mount = (items: WorkItemViewV1[], runs: RunViewV1[], now: number | "clock" = NOW) =>
  render(<ControlGroupView view={view(items, runs)} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} now={now === "clock" ? undefined : now} />);
const table = () => screen.getByRole("table", { name: "Tasks" });
/** The duration cell of a task's row: the column under the "duration" header. */
const durationOf = (taskId: string): string => {
  const headers = within(table()).getAllByRole("columnheader").map((th) => th.textContent);
  const row = within(table()).getAllByRole("row").find((tr) => within(tr).queryByRole("button", { name: taskId }) !== null)!;
  return within(row).getAllByRole("cell")[headers.indexOf("duration")]!.textContent!;
};

describe("tester #331: the Work items table shows how long each task took, not run ids", () => {
  it("has a duration column in place of run and no pending column, and no bare run id in any cell", () => {
    mount([workItem({ taskId: "a", status: "completed", category: "done", currentRunId: "run-94047426", pendingRunId: "run-pending-1" })],
      [run({ runId: "run-94047426", taskId: "a", state: "landed", used: used(754_000), startedAt: NOW - 900_000, endedAt: NOW - 100_000 })]);
    // mutation: restore the run and pending headers -> red
    expect(within(table()).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["task", "status", "labels", "progress", "duration", "depends on"]);
    // mutation: restore either id cell -> red
    for (const cell of within(table()).getAllByRole("cell")) expect(cell.textContent).not.toMatch(/run-/);
  });

  it("reads a settled run's active time (used.activeMs, the run detail's own figure), not its wall-clock span", () => {
    // Wall clock here is 800s; activeMs is 754s -- the cell must show the latter.
    mount([workItem({ taskId: "a", status: "completed", category: "done", currentRunId: "run-a" })],
      [run({ runId: "run-a", taskId: "a", state: "landed", used: used(754_000), startedAt: NOW - 900_000, endedAt: NOW - 100_000 })]);
    // mutation: use endedAt - startedAt first -> "13m 20s", red
    expect(durationOf("a")).toBe("12m 34s");
  });

  it("falls back to the run's wall-clock span when no active time was booked, and shows — before any run", () => {
    mount([workItem({ taskId: "a", status: "completed", category: "done", currentRunId: "run-a" }), workItem({ taskId: "b", status: "draft", category: "idle" })],
      [run({ runId: "run-a", taskId: "a", state: "landed", used: used(0), startedAt: NOW - 3_725_000, endedAt: NOW })]);
    expect(durationOf("a")).toBe("1h 02m");
    // mutation: render "0s" for a task with no run -> red
    expect(durationOf("b")).toBe("—");
  });

  it("counts a running task from its current run's start to now, and moves while it runs", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(NOW);
    mount([workItem({ taskId: "a", status: "active", category: "running", currentRunId: "run-a" })],
      [run({ runId: "run-a", taskId: "a", state: "running", used: used(5_000), startedAt: NOW - 125_000, endedAt: null })], "clock");
    // mutation: read used.activeMs for a running run -> "5s", red
    expect(durationOf("a")).toBe("2m 05s");
    act(() => { vi.advanceTimersByTime(3_000); });
    // mutation: compute the running figure once, with no clock -> stays "2m 05s", red
    expect(durationOf("a")).toBe("2m 08s");
  });

  it("names the column and the figure in Chinese", async () => {
    await i18n.changeLanguage("zh");
    try {
      mount([workItem({ taskId: "a", status: "completed", category: "done", currentRunId: "run-a" })],
        [run({ runId: "run-a", taskId: "a", state: "landed", used: used(754_000) })]);
      const zhTable = screen.getByRole("table", { name: "任务" });
      const headers = within(zhTable).getAllByRole("columnheader").map((th) => th.textContent);
      expect(headers).toContain("耗时");
      const row = within(zhTable).getAllByRole("row").find((tr) => within(tr).queryByRole("button", { name: "a" }) !== null)!;
      expect(within(row).getAllByRole("cell")[headers.indexOf("耗时")]!.textContent).toBe("12 分 34 秒");
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
