// @vitest-environment jsdom
/**
 * Issue #57: with a failed task open in the group view, `r` retries it -- the same retry-task the Runs table's and the
 * task detail's Retry task buttons send, and only where their gate (retryRunOpen) allows it. Like Decisions' j/k/a/c it
 * never fires while the person types, as a chord, from a hidden pane, or with no task open.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { ControlAction } from "../src/controlApi.js";
import type { GroupViewV1, RunViewV1 } from "../src/controlTypes.js";
import { config, run, view, workItem } from "./fixtures/board.js";
import i18n from "../src/i18n.js";

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

  // The open task's detail offers Retry task wherever retryRunOpen allows it -- a saved result's ordinary retry too, which
  // has no failure outcome -- so `r` follows that button, not only the Runs table's failed-run one.
  it("follows the task detail's Retry task for a saved result's ordinary retry", () => {
    const saved = view([workItem({ taskId: "a", status: "ready", currentRunId: "run-a", lineageRunIds: ["run-a"] })],
      [run({ state: "settled-restartable", outcome: null, savedResultOrdinaryRetry: true } as Partial<RunViewV1>)]);
    const onCommand = show(saved, "a");
    fireEvent.click(within(screen.getByRole("region", { name: "Task a" })).getByRole("button", { name: "Retry task a" }));
    expect(onCommand).toHaveBeenCalledTimes(1);
    press();
    expect(onCommand).toHaveBeenCalledTimes(2);
    expect(onCommand.mock.calls[1]![0]).toEqual(onCommand.mock.calls[0]![0]);
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

  // Handoff §4.2 item 7 (W2 review minor, session 3831d12f; done in session 3d229487): the key is shown where its button is,
  // on the open task's Retry task, and declared to assistive technology; the button the key does not press carries neither.
  it("shows r beside the open task's Retry task, and only there", async () => {
    show(failedGroup(), "a");
    const detail = screen.getByRole("region", { name: "Task a" });
    const button = within(detail).getByRole("button", { name: "Retry task a" });
    expect(button.getAttribute("aria-keyshortcuts")).toBe("r");
    const hint = button.nextElementSibling as HTMLElement | null;
    expect(hint?.className).toBe("kbd-hint");
    expect(hint?.textContent).toBe("Key: r");
    const elsewhere = screen.getAllByRole("button", { name: "Retry task a" }).filter((other) => !detail.contains(other));
    expect(elsewhere.length).toBeGreaterThan(0);
    for (const other of elsewhere) expect(other.hasAttribute("aria-keyshortcuts")).toBe(false);
    cleanup();
    await i18n.changeLanguage("zh");
    try {
      show(failedGroup(), "a");
      const zhButton = within(screen.getByRole("region", { name: "任务 a" })).getByRole("button", { name: "重试任务 a" });
      expect(zhButton.nextElementSibling?.textContent).toBe("快捷键：r");
    } finally { await i18n.changeLanguage("en"); }
  });

  it("never fires with focus on a control outside this group (an account-bar button, say)", () => {
    const onCommand = show(failedGroup(), "a");
    const outside = document.body.appendChild(document.createElement("button"));
    try { press({}, outside); } finally { outside.remove(); }
    expect(onCommand).not.toHaveBeenCalled();
    press({}, screen.getByRole("region", { name: "Task a" }));
    expect(onCommand, "focus inside the group still works").toHaveBeenCalledTimes(1);
  });
});
