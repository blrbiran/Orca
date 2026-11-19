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

  // Tester #343: criteria no change to files can meet -- Orca opened no fix; the panel names them and what answers each.
  it("names the criteria left to the person and what answers each", async () => {
    const left: RequirementReviewV1 = { ...notPassed, why: "not-fixable-by-work", problem: "requirement-review-not-passed:not-fixable-by-work",
      rounds: [{ ...notPassed.rounds[0]!, result: "not-met", leftToPerson: ["AC1", "AC2"], criteria: [
        { id: "AC1", verdict: "not-met", evidence: [{ path: "plan", line: null }], missing: "every task names files", fixableBy: "plan" },
        { id: "AC2", verdict: "not-met", evidence: [{ path: "b.txt", line: null }], missing: "pick one", fixableBy: "person" }] }] };
    const { panel } = show(left);
    // mutation: drop the left-to-person block -> null, red
    const box = panel.querySelector<HTMLElement>("[data-left-to-person]");
    expect(box).not.toBeNull();
    expect(box!.textContent).toContain("Left to you (no change to files can meet them): AC1 (plan), AC2 (your decision)");
    expect(box!.textContent).toContain("AC1: about the accepted plan -- ask for a new draft with orca requirement feedback g --text");
    expect(box!.textContent).toContain("AC2: only you can decide -- accept the work as it is, or review again with a note.");
    expect(within(panel).getByRole("button", { name: "Accept as it is" })).toBeTruthy();
    cleanup();
    // A round recorded before #343 (no leftToPerson) shows no such block.
    expect(show(notPassed).panel.querySelector("[data-left-to-person]")).toBeNull();
    cleanup();
    await i18n.changeLanguage("zh");
    expect(show(left).panel.querySelector("[data-left-to-person]")!.textContent).toContain("留给你处理（改文件无法满足）：AC1 (计划), AC2 (需你决定)");
  });

  // Tester #377: a not-met criterion red only because the group's base was red too passed relative; the panel says so.
  it("names each relative pass next to a passed review", async () => {
    const passed: RequirementReviewV1 = { state: "passed", autoFixRounds: 0, rounds: [{ ...notPassed.rounds[0]!, result: "passed", summary: "AC2 is red",
      relativePass: [{ criterionId: "AC2", command: "npm test", tipExits: ["1", "1"], baseExits: ["1", "1"] }] }] };
    const { panel } = show(passed);
    // mutation: drop the relative-pass block -> null, red
    const box = panel.querySelector<HTMLElement>("[data-relative-pass]");
    expect(box).not.toBeNull();
    expect(box!.textContent).toBe("AC2: relative pass -- npm test exited 1, 1 on this tip and 1, 1 at the group's base, so it was red before this group; not counted as not met.");
    cleanup();
    expect(show(notPassed).panel.querySelector("[data-relative-pass]")).toBeNull();
    cleanup();
    await i18n.changeLanguage("zh");
    expect(show(passed).panel.querySelector("[data-relative-pass]")!.textContent).toBe("AC2：相对通过——npm test 在本次结果上退出 1, 1，在任务组起点上退出 1, 1，任务组开始前就已失败；不计为未满足。");
  });

  it("none on an archived group or a passed review; zh words", async () => {
    expect(within(show(notPassed, true).panel).queryAllByRole("button")).toEqual([]);
    cleanup();
    expect(within(show({ ...notPassed, state: "passed", why: undefined, problem: undefined }).panel).queryAllByRole("button")).toEqual([]);
    cleanup();
    await i18n.changeLanguage("zh");
    expect(show(notPassed).panel.textContent).toContain("复核未通过");
  });

  // Tester #337: the review Orca does not run on a folder or multi-repository group is named in words a person without git
  // knows, not "no single tree". What counts as satisfied is unchanged (a not-run review still lets the group finish).
  it("a review not run on a folder or multi-repository group says why in plain words (#337)", async () => {
    const notRun: RequirementReviewV1 = { state: "not-run", why: "dir", rounds: [], autoFixRounds: 0 };
    const en = show(notRun).panel.textContent;
    expect(en).toContain("not reviewed (Orca cannot review folder or multi-repository groups yet)");
    expect(en).not.toContain("tree");
    cleanup();
    await i18n.changeLanguage("zh");
    const zh = show(notRun).panel.textContent;
    expect(zh).toContain("未复核（Orca 暂时还不能复核文件夹或多仓库的任务组）");
    expect(zh).not.toContain("代码树");
  });
});
