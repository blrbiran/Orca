// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { RunViewV1, WorkItemViewV1 } from "../src/controlTypes.js";
import { config, run, view } from "./usageRecoveryFixture.js";
import { workItem } from "./fixtures/board.js";

/**
 * Tester follow-up G spec §1.2, §1.4, §10.1, the Web half: a task completed with no change carries a "no change" marker
 * (a second time says so) and, on its run, who decided and why with "Revoke and re-run"; a task stopped as a provable no
 * change offers "Accept as no change" and "Revoke and re-run". Each sends exactly `{taskId, runId, note}`; a blank note
 * cannot be sent; an archived group shows no action. Open to every role (the server checks again).
 */
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });
const done = (over: Partial<WorkItemViewV1> = {}) => workItem({ taskId: "a", status: "completed", currentRunId: "run-a",
  noChangeCompletion: { runId: "run-a", ordinal: 1, decidedBy: "agent-verifier", at: 1, why: "base.txt already does it" }, ...over });
const settled = (over: Partial<RunViewV1> = {}) => run({ state: "settled-recoverable", outcome: "succeeded", blockedReason: null, ...over });
const show = (item: WorkItemViewV1, r: RunViewV1 = settled(), archived = false) => {
  const onCommand = vi.fn();
  const base = view([r]);
  const v = { ...base, workItems: [item], ...(archived ? { summary: { ...base.summary, archived: true } } : {}) };
  const result = render(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "progress", taskId: "a", runId: null }} view={v as never}
    config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} roles={["member"]} refusal={null} />);
  return { ...result, onCommand, task: document.querySelector<HTMLElement>('section[data-task-id="a"]')! };
};

describe("the no-change marker, record and its actions (tester follow-up G §1.2)", () => {
  it("a no-change task shows the marker, who decided and why, and Revoke and re-run sends exactly the payload", () => {
    const { task, onCommand } = show(done());
    expect(document.querySelector('[data-testid="no-change-a"]')?.textContent).toContain("no change");
    expect(within(task).getByText(/decided by agent-verifier/).textContent).toContain("base.txt already does it");
    fireEvent.click(within(task).getByRole("button", { name: "Revoke and re-run" }));
    const send = within(task).getByRole("button", { name: "Send" });
    // a blank note cannot be sent
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(task).getByLabelText("Note (at most 2048 bytes)"), { target: { value: "also update the README" } });
    fireEvent.click(send);
    expect(onCommand).toHaveBeenCalledWith({ verb: "reopen-task", groupId: "g", expectedRevision: expect.any(Number), payload: { taskId: "a", runId: "run-a", note: "also update the README" } });
  });

  it("the second time is said on the marker", () => {
    show(done({ noChangeCompletion: { runId: "run-a", ordinal: 2, decidedBy: "judge", at: 1, why: null } }));
    // mutation M6b: render the chip only for ordinal 1 -> red here
    expect(document.querySelector('[data-testid="no-change-a"]')?.textContent).toContain("time 2");
  });

  it("a task stopped as no-change-twice offers Accept as no change", () => {
    const { task, onCommand } = show(workItem({ taskId: "a", status: "blocked", currentRunId: "run-a" }), settled({ blockedReason: "no-change-twice" }));
    fireEvent.click(within(task).getByRole("button", { name: "Accept as no change" }));
    fireEvent.change(within(task).getByLabelText("Note (at most 2048 bytes)"), { target: { value: "nothing was missing" } });
    fireEvent.click(within(task).getByRole("button", { name: "Send" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "accept-no-change", groupId: "g", expectedRevision: expect.any(Number), payload: { taskId: "a", runId: "run-a", note: "nothing was missing" } });
    expect(within(task).getByRole("button", { name: "Revoke and re-run" })).toBeTruthy();
  });

  it("an archived group shows no action; zh shows zh words", async () => {
    const { task } = show(done(), settled(), true);
    expect(within(task).queryByRole("button", { name: "Revoke and re-run" })).toBeNull();
    cleanup();
    await i18n.changeLanguage("zh");
    show(done());
    expect(document.querySelector('[data-testid="no-change-a"]')?.textContent).toContain("无改动");
  });
});
