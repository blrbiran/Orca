// @vitest-environment jsdom
/**
 * Session 3ba26002. Tester #362: a data file the requirement names, listed as a task's target path, is shown as a note
 * (the requirement view's runtimeDataPaths). Dogfood finding (3): a draft Orca re-drafted after the person's feedback that
 * reports no conflict about it says so (the view's feedbackAfterRedraft), with what the handed-back draft had reported.
 * Both in en and zh; both are notes, not hand-back reasons.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { RequirementsPanel } from "../src/RequirementsPanel.js";
import type { RequirementViewV1 } from "../src/controlTypes.js";
import { config, requirementView, summaryWith } from "./fixtures/requirement.js";

afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });
const show = (view: RequirementViewV1): HTMLElement =>
  render(<RequirementsPanel config={config} summary={summaryWith(view)} views={{ [view.summary.groupId]: view }} selected={view.summary.groupId} agents={null} language="en"
    onSelect={() => {}} onCommand={() => {}} refusal={null} />).container;
type Extra = Partial<Pick<RequirementViewV1["drafts"][number], "runtimeDataPaths" | "feedbackAfterRedraft">>;
const withDraft = (extra: Extra): RequirementViewV1 => {
  const view = requirementView("awaiting-review");
  return { ...view, drafts: view.drafts.map((draft) => ({ ...draft, ...extra })) };
};
const CARRY = { feedbackDraftNo: 2, feedback: "Drop the test file.", redrafts: [3], conflictsBefore: ["AC2", "R1.ADR1"] };

describe("the split draft's runtime-data note (#362)", () => {
  it("names the task and the file in English and in Chinese, and nothing without an entry", async () => {
    // mutation: drop the note from DraftReview -> no such element, red
    const en = show(withDraft({ runtimeDataPaths: [{ taskId: "incident-cli", path: ".orca/incidents.json" }] })).querySelectorAll("[data-runtime-data-path]");
    expect(en).toHaveLength(1);
    // Review M7 (session 3ba26002): "if that is where the program keeps its data".
    expect(en[0]!.textContent).toBe("incident-cli lists .orca/incidents.json, a data file the requirement names, as a target path. If that is where the program keeps its data (not seed data the requirement asks to commit), send feedback to drop it.");
    cleanup();
    await i18n.changeLanguage("zh");
    expect(show(withDraft({ runtimeDataPaths: [{ taskId: "incident-cli", path: ".orca/incidents.json" }] })).querySelector("[data-runtime-data-path]")?.textContent)
      .toBe("incident-cli 把需求提到的数据文件 .orca/incidents.json 列为目标路径。如果这是程序存放数据的位置（而不是需求要求提交的种子数据），请发反馈把它去掉。");
    cleanup();
    expect(show(withDraft({ runtimeDataPaths: [] })).querySelector("[data-runtime-data-path]")).toBeNull();
  });

  it("names a multi-directory entry's file with its directory key (multi split instruction version 6)", () => {
    // mutation: render entry.path alone -> "lists .app/items.json", red
    expect(show(withDraft({ runtimeDataPaths: [{ taskId: "both", dir: "alpha", path: ".app/items.json" }] })).querySelector("[data-runtime-data-path]")?.textContent)
      .toBe("both lists alpha:.app/items.json, a data file the requirement names, as a target path. If that is where the program keeps its data (not seed data the requirement asks to commit), send feedback to drop it.");
  });
});

describe("the split draft's note after a re-draft that left the feedback unreported (dogfood finding 3)", () => {
  it("says the draft came from Orca's re-draft, quotes the feedback and what was reported before, in English and in Chinese", async () => {
    const draftNo = requirementView("awaiting-review").drafts.at(-1)!.draftNo;
    // mutation: drop the note from DraftReview -> null, red
    expect(show(withDraft({ feedbackAfterRedraft: CARRY })).querySelector("[data-feedback-after-redraft]")?.textContent)
      // Review M4 (session 3ba26002): the first re-drafted draft answered the feedback; "re-drafted", not "handed back".
      .toBe(`This draft came from Orca re-drafting draft 3, which answered your feedback on draft 2 ("Drop the test file."). Draft ${draftNo} reports no conflict with that feedback: check that it still follows it, and send the feedback again if it does not. The re-drafted draft had reported that following it breaks AC2, R1.ADR1.`);
    cleanup();
    await i18n.changeLanguage("zh");
    expect(show(withDraft({ feedbackAfterRedraft: { ...CARRY, conflictsBefore: [] } })).querySelector("[data-feedback-after-redraft]")?.textContent)
      .toBe(`这一稿来自 Orca 对第 3 稿的重新拆分（那一稿是按你对第 2 稿的反馈「Drop the test file.」写的）。第 ${draftNo} 稿没有报告与该反馈的冲突：请检查它是否仍按反馈来做，如果没有，请再发一次反馈。`);
    cleanup();
    expect(show(withDraft({})).querySelector("[data-feedback-after-redraft]")).toBeNull();
  });
});
