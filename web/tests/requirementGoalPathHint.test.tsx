// @vitest-environment jsdom
/**
 * Tester #345: a path a split task's goal names that no task may write, and the split did not add (the base commit has
 * it, or its directory is missing), is shown with a note per entry (the requirement view's goalPathsOutsideTargets), in
 * en and zh -- a hint, not a hand-back reason.
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
const withEntries = (entries: Array<{ taskId: string; path: string }> | undefined): RequirementViewV1 => {
  const view = requirementView("awaiting-review");
  return { ...view, drafts: view.drafts.map((draft) => (entries === undefined ? draft : { ...draft, goalPathsOutsideTargets: entries })) };
};

describe("the split draft's goal-path note (#345)", () => {
  it("names the task and the file in English and in Chinese", async () => {
    await i18n.changeLanguage("en");
    // mutation: drop the note from DraftReview -> no such element, red
    const en = show(withEntries([{ taskId: "cli", path: "src/a.ts" }])).querySelectorAll("[data-goal-path]");
    expect(en).toHaveLength(1);
    expect(en[0]!.textContent).toContain("cli's goal names src/a.ts, which no task may write (goal-path-outside-targets)");
    cleanup();
    await i18n.changeLanguage("zh");
    const zh = show(withEntries([{ taskId: "cli", path: "src/a.ts" }])).querySelector("[data-goal-path]");
    expect(zh?.textContent).toContain("cli 的目标提到了 src/a.ts，但没有任何任务可以写它");
  });

  it("shows nothing for a draft with no entries, or one the server gave none", () => {
    expect(show(withEntries([])).querySelector("[data-goal-path]")).toBeNull();
    cleanup();
    expect(show(withEntries(undefined)).querySelector("[data-goal-path]")).toBeNull();
  });
});
