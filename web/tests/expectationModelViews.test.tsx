// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../src/i18n.js";
import { editedOperations, hardCapKey } from "../src/BudgetEditor.js";
import { budgetFieldKey } from "../../src/control/budgetSuggestions.js";
import { budgetWaiting } from "../src/ControlGroupView.js";
import { UsagePause } from "../src/UsagePause.js";
import type { GroupViewV1, WorkItemViewV1 } from "../src/controlTypes.js";
import { workItem } from "./fixtures/board.js";

/**
 * Tester follow-up G spec §2.3-§2.5, §10.3 (Part B, O6), the Web half. A task over its expectation shows an amber hint and
 * nothing to press; a task at its pause line offers Continue (with an optional note) and Stop, which send
 * usage-pause-decide exactly; a task at the group cap names the top-up; the budget editor's Hard cap switch adds
 * `hard: true` to that task's work tokens, only in an expectation-model group. Named mutations, each seen red: show the
 * hint for a hard-capped task (no expectation) -> "over its expectation" red; send the note on Stop -> "Stop sends" red;
 * drop the expectationModel gate on the switch -> "a legacy group" red.
 */
afterEach(cleanup);
const NONE = { hardCapTokens: null, overExpectation: null, usagePause: null, usageStopped: null, groupCapStop: null };
const show = (state: NonNullable<WorkItemViewV1["budgetState"]>) => {
  const onCommand = vi.fn();
  render(<UsagePause groupId="g" revision={7} item={workItem({ taskId: "a", status: "blocked", budgetState: state })} onCommand={onCommand} archived={false} />);
  return onCommand;
};

describe("a task's budget state (spec §2.4, §2.5)", () => {
  it("over its expectation: an amber hint, nothing to press", () => {
    show({ ...NONE, overExpectation: { at: 1, usedTokens: 3_200_000, expectationTokens: 1_000_000 } });
    const hint = screen.getByTestId("budget-over-expectation");
    expect(hint.getAttribute("data-tone")).toBe("warn");
    expect(hint.textContent).toContain("×3.2");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a hard-capped task names its cap and has no hint", () => {
    show({ ...NONE, hardCapTokens: 400_000 });
    expect(screen.getByTestId("budget-hard-cap").textContent).toContain("no pause line");
    expect(screen.queryByTestId("budget-over-expectation")).toBeNull();
  });

  it("Continue sends the decision and the note; Stop sends the decision alone", () => {
    const onCommand = show({ ...NONE, usagePause: { line: 10_000_000, multiple: 1, usedTokens: 10_400_000, expectationTokens: 1_000_000, runId: "run-a", at: 1 } });
    const waiting = screen.getByRole("group", { name: "Waiting for a decision" });
    expect(waiting.textContent).toContain("×10.4");
    fireEvent.change(within(waiting).getByRole("textbox"), { target: { value: "finish the parser" } });
    fireEvent.click(within(waiting).getByRole("button", { name: "Continue" }));
    fireEvent.click(within(waiting).getByRole("button", { name: "Stop task" }));
    expect(onCommand.mock.calls.map(call => call[0])).toEqual([
      { verb: "usage-pause-decide", groupId: "g", taskId: "a", expectedRevision: 7, payload: { decision: "continue", note: { text: "finish the parser", scope: "next-attempt" } } },
      { verb: "usage-pause-decide", groupId: "g", taskId: "a", expectedRevision: 7, payload: { decision: "stop" } },
    ]);
  });

  it("at the group cap: says to raise the limit; the Problems list holds paused and capped tasks only", () => {
    show({ ...NONE, groupCapStop: { runId: "run-a", at: 1, observedTokens: 2_900_000 } });
    expect(screen.getByTestId("budget-group-cap").textContent).toContain("Raise the group's token limit");
    const items = [workItem({ taskId: "a", budgetState: { ...NONE, groupCapStop: { runId: "r", at: 1, observedTokens: 1 } } }), workItem({ taskId: "b", budgetState: { ...NONE, overExpectation: { at: 1, usedTokens: 2, expectationTokens: 1 } } }), workItem({ taskId: "c" })];
    expect(budgetWaiting({ workItems: items }).map(item => item.taskId)).toEqual(["a"]);
  });
});

describe("the Hard cap switch (spec §10.3)", () => {
  const groupView = (expectationModel: boolean): GroupViewV1 => ({
    summary: { groupId: "g", commandRevision: 3 }, plan: { planHash: "h" }, ledger: { groupLimit: { tokens: 20_000_000, activeMs: 1, attempts: 1, sessions: 1 } },
    proposal: { state: "editable", proposalVersion: 2 }, workItems: [workItem({ taskId: "a" })], estimates: [],
    allocations: [{ ownerKind: "task", ownerId: "a", bucket: "work", state: "draft-encumbered", amount: { tokens: null, activeMs: 1, attempts: 1, sessions: 1 }, fieldProvenance: {} }],
    ...(expectationModel ? { expectationModel: true as const } : {}),
  }) as unknown as GroupViewV1;
  const drafts = { [budgetFieldKey("g", { scope: "task", taskId: "a", allocation: "work", dimension: "tokens" })]: "400000", [hardCapKey("g", "a")]: "1" };
  it("adds hard: true to the task's work tokens in an expectation-model group", () => {
    const ops = editedOperations(groupView(true), drafts);
    expect(ops).toEqual([{ target: { scope: "task", taskId: "a", allocation: "work", dimension: "tokens" }, value: 400_000, provenance: "human", hard: true }]);
  });
  it("a legacy group never sends it", () => {
    expect(editedOperations(groupView(false), drafts)).toEqual([{ target: { scope: "task", taskId: "a", allocation: "work", dimension: "tokens" }, value: 400_000, provenance: "human" }]);
  });
});
