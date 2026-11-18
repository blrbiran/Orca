// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../src/i18n.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { controlCommandPath } from "../src/controlApi.js";
import type { PreexistingFailureV1 } from "../src/controlTypes.js";
import { config, view } from "./usageRecoveryFixture.js";

/**
 * Pre-existing failures spec L2 (#341), the Web half: a check already red before a task changed anything is one row in the
 * group's Problems region -- each reporting task with what it chose, or Orca's red run at the base -- and an owner answers
 * it: allow the fix, judge it relative to the base, or edit the requirement, which is recorded and then opens the group's
 * requirement (no editor of its own). An unanswered row counts on the Problems tab. Named mutations (each seen red, Rule
 * 9) are written beside the assertion they turn red.
 */
afterEach(cleanup);
const ROW: PreexistingFailureV1 = {
  command: "npm test", sources: ["agent", "base-check"], answer: null,
  reportedBy: [{ taskId: "a", runId: "run-a", chose: "edited README" }, { taskId: "b", runId: "run-b", chose: "" }],
  baseCheck: { taskId: "c", runId: "run-c", at: 5 },
};
const show = (roles: ("owner" | "member")[], rows: PreexistingFailureV1[] | null = [ROW]) => {
  const onCommand = vi.fn(), onSourceRequirement = vi.fn();
  render(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "problem", taskId: null, runId: null }}
    view={{ ...view([]), ...(rows === null ? {} : { preexistingFailures: rows }) }}
    config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} roles={roles} refusal={null} onSourceRequirement={onSourceRequirement} />);
  return { onCommand, onSourceRequirement };
};
const row = () => document.querySelector('[data-problem-preexisting-failure="npm test"]') as HTMLElement;

describe("a pre-existing failure in Problems (spec L2)", () => {
  it("names the check, every reporting task with what it chose, and Orca's red run at the base", () => {
    show(["member"]);
    const text = row().textContent ?? "";
    expect(text).toContain("npm test was already failing before the work");
    expect(text).toContain("Reported by task a: npm test already failed before its change; its choice: edited README");
    expect(text).toContain("Reported by task b: npm test already failed before its change; its choice: (it said nothing)");
    // mutation: drop the base-check line -> red
    expect(text).toContain("Orca ran npm test at the group's base after task c failed it: red there too.");
    // A member sees the row but not the answers (an owner's act, as a waiver).
    // mutation: offer the answers to every role -> red
    expect(within(row()).queryAllByRole("button")).toEqual([]);
  });

  it("an owner's answer sends exactly {command, answer} to the group's preexisting-failure route", () => {
    const { onCommand, onSourceRequirement } = show(["owner"]);
    fireEvent.click(within(row()).getByRole("button", { name: "Judge it relative to the base" }));
    expect(onCommand.mock.calls).toEqual([[{ verb: "answer-preexisting-failure", groupId: "g", expectedRevision: 6, payload: { command: "npm test", answer: "relative" } }]]);
    expect(controlCommandPath(onCommand.mock.calls[0]![0])).toBe("/api/control/groups/g/preexisting-failure");
    expect(onSourceRequirement).not.toHaveBeenCalled();
  });

  it("Edit the requirement is recorded too, then opens the group's requirement (the existing place it is changed)", () => {
    const { onCommand, onSourceRequirement } = show(["owner"]);
    fireEvent.click(within(row()).getByRole("button", { name: "Edit the requirement" }));
    expect(onCommand.mock.calls).toEqual([[{ verb: "answer-preexisting-failure", groupId: "g", expectedRevision: 6, payload: { command: "npm test", answer: "edit-requirement" } }]]);
    // mutation: drop the requirement route on edit-requirement -> not called, red
    expect(onSourceRequirement.mock.calls).toEqual([["g"]]);
  });

  it("an answered row says the answer and who gave it, and no longer counts on the Problems tab", () => {
    show(["owner"], [{ ...ROW, answer: "allow-fix", answered: { by: "user:owner", at: 9 } }]);
    expect(row().textContent).toContain("Answered: Allow the fix (by user:owner).");
    expect(within(row()).getByRole("button", { name: "Allow the fix" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("tab", { name: /Problems/ }).textContent).not.toMatch(/\d/);
  });

  it("an unanswered row counts on the Problems tab", () => {
    show(["owner"]);
    // mutation: leave unanswered rows out of the problem count -> no count, red
    expect(screen.getByRole("tab", { name: /Problems/ }).textContent).toContain("1");
  });

  it("a view without rows shows none", () => {
    show(["owner"], null);
    expect(document.querySelector("[data-problem-preexisting-failure]")).toBeNull();
  });
});
