// @vitest-environment jsdom
/**
 * Issue #57: with a failed task open in the group view, `r` retries it -- the same retry-task the Runs table's Retry
 * button sends, and only where that button's gate (retryRunOpen) allows it. Like Decisions' j/k/a/c it never fires while
 * the person types, as a chord, from a hidden pane, or with no task open.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { ControlAction } from "../src/controlApi.js";
import type { GroupViewV1, RunViewV1 } from "../src/controlTypes.js";
import { config, run, view, workItem } from "./fixtures/board.js";

afterEach(cleanup);
const FAILED: Partial<RunViewV1> = { state: "blocked", blockedReason: "terminal:failed", outcome: "failed", stopReason: "Error: codex-result-invalid: /runs/r/attempt-1" };
const failedGroup = (): GroupViewV1 =>
  view([workItem({ taskId: "a", status: "blocked", currentRunId: "run-a", lineageRunIds: ["run-a"] }), workItem({ taskId: "b" })], [run({ ...FAILED })]);
const show = (v: GroupViewV1, taskId: string | null, active = true) => {
  const onCommand = vi.fn<(action: ControlAction) => void>();
  render(<ControlGroupView active={active} focus={{ kind: "group", groupId: "g", region: taskId === null ? "runs" : "progress", taskId, runId: null }} view={v} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
  return onCommand;
};
const press = (init: KeyboardEventInit = {}, target: Element = document.body) => fireEvent.keyDown(target, { key: "r", ...init });

describe("r retries the open task (issue #57)", () => {
  it("sends exactly the Runs table's retry-task for the open task's run", () => {
    const reference = show(failedGroup(), null);
    fireEvent.click(within(screen.getByRole("tabpanel")).getByRole("button", { name: "Retry task a" }));
    expect(reference).toHaveBeenCalledTimes(1);
    const expected = reference.mock.calls[0]![0];
    cleanup();
    const onCommand = show(failedGroup(), "a");
    press();
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand.mock.calls[0]![0]).toEqual(expected);
  });

  it("does nothing with no task open, or with a task open whose run cannot be retried", () => {
    const onNone = show(failedGroup(), null); press();
    expect(onNone, "no task open").not.toHaveBeenCalled();
    cleanup();
    const onB = show(failedGroup(), "b"); press();
    expect(onB, "task b has no failed run").not.toHaveBeenCalled();
  });

  it("does nothing where retryRunOpen refuses (a stop intent)", () => {
    const stopped = failedGroup();
    stopped.stop = { mode: "pause", state: "paused", frozenRunIds: [], acceptedAt: null, deadlineAt: null } as GroupViewV1["stop"];
    stopped.summary.stopMode = "pause";
    const onCommand = show(stopped, "a"); press();
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("never fires while typing, as a chord, on a repeat, or from a hidden pane", () => {
    const onCommand = show(failedGroup(), "a");
    press({}, screen.getByRole("textbox", { name: "Custom label" }));
    press({ ctrlKey: true }); press({ metaKey: true }); press({ altKey: true }); press({ repeat: true });
    expect(onCommand).not.toHaveBeenCalled();
    cleanup();
    const hidden = show(failedGroup(), "a", false); press();
    expect(hidden).not.toHaveBeenCalled();
  });
});
