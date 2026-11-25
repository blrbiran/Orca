// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../src/i18n.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { controlCommandPath, type ControlAction } from "../src/controlApi.js";
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
  command: "npm test", sources: ["agent", "base-check"], answer: null, answerable: true,
  reportedBy: [{ taskId: "a", runId: "run-a", chose: "edited README" }, { taskId: "b", runId: "run-b", chose: "" }],
  baseCheck: { taskId: "c", runId: "run-c", at: 5 },
};
const show = (roles: ("owner" | "member")[], rows: PreexistingFailureV1[] | null = [ROW], answer: number | null = 7, region: "problem" | "results" = "problem") => {
  // The panel's sendControl answers the new revision on success, null on a refusal or an unknown outcome.
  const onCommand = vi.fn(async (_action: ControlAction) => answer), onSourceRequirement = vi.fn();
  render(<ControlGroupView focus={{ kind: "group", groupId: "g", region, taskId: null, runId: null }}
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

  it("Edit the requirement is recorded too, then opens the group's requirement (the existing place it is read)", async () => {
    const { onCommand, onSourceRequirement } = show(["owner"]);
    fireEvent.click(within(row()).getByRole("button", { name: "Edit the requirement" }));
    expect(onCommand.mock.calls).toEqual([[{ verb: "answer-preexisting-failure", groupId: "g", expectedRevision: 6, payload: { command: "npm test", answer: "edit-requirement" } }]]);
    // mutation: drop the requirement route on edit-requirement -> not called, red
    await waitFor(() => expect(onSourceRequirement.mock.calls).toEqual([["g"]]));
    // Fix round 1 (Task 2 review I-3): the button's explanation does not promise a change Orca cannot make.
    expect(within(row()).getByRole("button", { name: "Edit the requirement" }).getAttribute("title")).toContain("Orca cannot change an accepted requirement yet");
  });

  it("a refused answer does not navigate (Task 2 review minor 1)", async () => {
    const { onCommand, onSourceRequirement } = show(["owner"], [ROW], null);
    fireEvent.click(within(row()).getByRole("button", { name: "Edit the requirement" }));
    await waitFor(() => expect(onCommand).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    // mutation: navigate before the answer -> called, red
    expect(onSourceRequirement).not.toHaveBeenCalled();
  });

  it("a group with no requirement review shows the row for information only (Task 2 review I-1)", () => {
    show(["owner"], [{ ...ROW, answerable: false }]);
    // mutation: drop the answerable gate on the buttons -> three buttons, red
    expect(within(row()).queryAllByRole("button")).toEqual([]);
    expect(row().textContent).toContain("This group has no requirement review to tell, so there is nothing to answer: this is shown for information.");
    expect(row().textContent).not.toContain("recorded for the requirement review");
  });

  it("a finished group's row is recorded for a review rerun, and the answer stays available (#504)", () => {
    show(["owner"], [{ ...ROW, answerable: false, onlyRerunUsesIt: true }]);
    // mutation: keep the not-answerable wording for a finished group -> red
    expect(row().textContent).toContain("This group is done. The row is recorded; a review-rerun would use this answer.");
    expect(row().textContent).not.toContain("there is nothing to answer");
    // The manual answer operation stays: an owner still sees its three answers.
    expect(within(row()).getAllByRole("button")).toHaveLength(3);
    // Nothing waits: an unanswered recorded row does not count as a problem.
    expect(screen.getByRole("tab", { name: /Problems/ }).textContent).not.toMatch(/\d/);
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

  it("an unanswerable row never counts: nothing could clear it (final review Important)", () => {
    // A base-check row on a group with no requirement review (plan file, flow child, debug) has no buttons, so if it counted
    // the Problems tab and the Results conclusion would say a problem waits forever.
    // Opened on Results, so the conclusion card is mounted beside the tab row.
    show(["owner"], [{ ...ROW, answerable: false }], 7, "results");
    // mutation: count every unanswered row regardless of answerable -> "1" on the tab and in the conclusion, red
    // Both places measured in one assertion, so neither short-circuits the other (Rule 9).
    expect({
      tabCounts: /\d/.test(screen.getByRole("tab", { name: /Problems/ }).textContent ?? ""),
      conclusionWaits: (document.body.textContent ?? "").includes("problem to look at"),
    }).toEqual({ tabCounts: false, conclusionWaits: false });
  });

  it("a view without rows shows none", () => {
    show(["owner"], null);
    expect(document.querySelector("[data-problem-preexisting-failure]")).toBeNull();
  });
});
