// @vitest-environment jsdom
/**
 * Tester #265: a split draft whose task's success condition names a file only another task may write is shown with a
 * note per entry (the requirement view's impliedPathsOutsideTargets), in en and zh, beside the draft's layers -- a hint,
 * not a hand-back reason.
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
const withEntries = (entries: Array<{ taskId: string; path: string; writers: string[] }> | undefined): RequirementViewV1 => {
  const view = requirementView("awaiting-review");
  return { ...view, drafts: view.drafts.map((draft) => (entries === undefined ? draft : { ...draft, impliedPathsOutsideTargets: entries })) };
};

describe("the split draft's implied-path note (#265)", () => {
  it("names the task, the file and its writer in English and in Chinese", async () => {
    await i18n.changeLanguage("en");
    // mutation: drop the note from DraftReview -> no such element, red
    const en = show(withEntries([{ taskId: "cli", path: "README.md", writers: ["docs"] }])).querySelectorAll("[data-implied-path]");
    expect(en).toHaveLength(1);
    expect(en[0]!.textContent).toContain("cli's success condition names README.md, which only docs may write (implied-path-outside-targets)");
    cleanup();
    await i18n.changeLanguage("zh");
    const zh = show(withEntries([{ taskId: "cli", path: "README.md", writers: ["docs"] }])).querySelector("[data-implied-path]");
    expect(zh?.textContent).toContain("cli 的完成条件提到了 README.md，但只有 docs 可以写它");
  });

  it("shows nothing for a draft with no entries, or one the server gave none", async () => {
    expect(show(withEntries([])).querySelector("[data-implied-path]")).toBeNull();
    cleanup();
    expect(show(withEntries(undefined)).querySelector("[data-implied-path]")).toBeNull();
  });
});
