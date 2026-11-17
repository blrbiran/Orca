// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n.js";
import { RequirementReviewPanel } from "../src/RequirementReviewPanel.js";
import type { RequirementReviewV1 } from "../src/controlTypes.js";

/**
 * Tester follow-up G spec §3.3, §3.5, the Web half: the requirement review lists each criterion with its verdict and
 * evidence (or what is missing); a review that did not pass offers fix, re-run and accept, each sending exactly its
 * server payload; a blank note cannot be sent; an archived group offers nothing.
 */
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });
const notPassed: RequirementReviewV1 = { state: "not-passed", why: "cannot-judge", problem: "requirement-review-not-passed:cannot-judge", autoFixRounds: 0,
  rounds: [{ roundNo: 1, tip: "a".repeat(40), runId: "run-r", at: 1, result: "cannot-judge", summary: "AC2 hinges on an image",
    criteria: [{ id: "AC1", verdict: "met", evidence: [{ path: "a.txt", line: 3 }], missing: null }, { id: "AC2", verdict: "not-met", evidence: [{ path: "b.txt", line: null }], missing: "the world line" }] }] };
const show = (review: RequirementReviewV1, archived = false) => {
  const onCommand = vi.fn();
  const r = render(<RequirementReviewPanel groupId="g" review={review} archived={archived} revision={7} onCommand={onCommand} />);
  return { ...r, onCommand, panel: r.container.querySelector<HTMLElement>("[data-requirement-review]")! };
};

describe("the requirement review panel (tester follow-up G §3.3)", () => {
  it("lists each criterion with its verdict and evidence, and the problem code", () => {
    const { panel } = show(notPassed);
    expect(panel.textContent).toContain("requirement-review-not-passed:cannot-judge");
    expect(panel.querySelectorAll("li")[0]!.textContent).toContain("met (a.txt:3)");
    expect(panel.querySelectorAll("li")[1]!.textContent).toContain("not met — the world line (b.txt)");
  });

  it("the three actions post the right verbs and payloads; a blank note cannot be sent", () => {
    const { panel, onCommand } = show(notPassed);
    fireEvent.click(within(panel).getByRole("button", { name: "Fix in this group" }));
    const send = within(panel).getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(within(panel).getByLabelText(/What the fix task should do/), { target: { value: "add the world line" } });
    fireEvent.click(send);
    expect(onCommand).toHaveBeenLastCalledWith({ verb: "review-fix", groupId: "g", expectedRevision: 7, payload: { goal: "add the world line" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Review again" }));
    fireEvent.change(within(panel).getByLabelText(/Note/), { target: { value: "look at b.txt" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Send" }));
    expect(onCommand).toHaveBeenLastCalledWith({ verb: "review-rerun", groupId: "g", expectedRevision: 7, payload: { note: "look at b.txt" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Accept as it is" }));
    fireEvent.change(within(panel).getByLabelText(/Note/), { target: { value: "fine as is" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Send" }));
    expect(onCommand).toHaveBeenLastCalledWith({ verb: "review-accept", groupId: "g", expectedRevision: 7, payload: { note: "fine as is" } });
  });

  // Tester #340: a reported check conflict is three facts a person decides on, shown one per line, not a sentence.
  it("shows a check conflict as the criterion, the check and the person's restriction", async () => {
    const conflict: RequirementReviewV1 = { ...notPassed, why: "check-conflict", problem: "requirement-review-not-passed:check-conflict",
      rounds: [{ ...notPassed.rounds[0]!, result: "not-met", checkConflict: { criterionId: "AC2", requiredCheck: "npm test", because: "the person said: only add" } }] };
    const { panel } = show(conflict);
    // mutation: drop the conflict list -> no such element, red
    const list = within(panel).getByRole("list", { name: "Check conflict" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Criterion: AC2", "Required check: npm test", "Why they conflict: the person said: only add"]);
    expect(panel.textContent).toContain("decide which one gives way");
    cleanup();
    await i18n.changeLanguage("zh");
    const zh = show(conflict).panel;
    expect(within(within(zh).getByRole("list", { name: "检查冲突" })).getAllByRole("listitem")[1]!.textContent).toBe("必需检查：npm test");
  });

  it("none on an archived group or a passed review; zh words", async () => {
    expect(within(show(notPassed, true).panel).queryAllByRole("button")).toEqual([]);
    cleanup();
    expect(within(show({ ...notPassed, state: "passed", why: undefined, problem: undefined }).panel).queryAllByRole("button")).toEqual([]);
    cleanup();
    await i18n.changeLanguage("zh");
    expect(show(notPassed).panel.textContent).toContain("复核未通过");
  });
});
