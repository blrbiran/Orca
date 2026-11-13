// @vitest-environment jsdom
/**
 * Tester follow-up K (#284, #265): beside each split-draft hint a person may apply it -- one button drops the parallel
 * candidates' edges, one per implied path adds the file to the task's targets. Each sends requirement-draft-edit for the
 * draft the person is reading (its number and hash); the server re-validates the edited split as the next draft. A draft
 * that is not awaiting review shows the hint without the button.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { RequirementsPanel } from "../src/RequirementsPanel.js";
import type { DraftViewV1, RequirementViewV1 } from "../src/controlTypes.js";
import { config, requirementView, summaryWith } from "./fixtures/requirement.js";

afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });
const show = (view: RequirementViewV1, onCommand: (command: unknown) => void = () => {}): HTMLElement =>
  render(<RequirementsPanel config={config} summary={summaryWith(view)} views={{ [view.summary.groupId]: view }} selected={view.summary.groupId} agents={null} language="en"
    onSelect={() => {}} onCommand={onCommand} refusal={null} />).container;
const withHints = (change: Partial<DraftViewV1> = {}): RequirementViewV1 => {
  const view = requirementView("awaiting-review");
  return { ...view, drafts: view.drafts.map((draft) => ({ ...draft, parallelCandidates: [{ before: "exporter", after: "images" }],
    impliedPathsOutsideTargets: [{ taskId: "images", path: "README.md", writers: ["exporter"] }], ...change })) };
};

describe("applying a split draft's hint from the panel (tester follow-up K)", () => {
  it("each button sends requirement-draft-edit for the draft being read", async () => {
    await i18n.changeLanguage("en");
    const sent: unknown[] = [];
    const page = show(withHints(), (command) => sent.push(command));
    // mutation: drop the button beside the parallel note -> no such element, red
    fireEvent.click(page.querySelector("[data-apply-parallel]")!);
    // mutation: drop the button beside the implied-path note -> no such element, red
    const add = page.querySelector("[data-add-implied-path]")!;
    expect(add.textContent).toBe("Add README.md to images");
    fireEvent.click(add);
    expect(sent).toEqual([
      { verb: "requirement-draft-edit", groupId: "r", expectedRevision: 3, payload: { draftNo: 1, draftHash: "d".repeat(64), edit: { kind: "apply-parallel-candidates" } } },
      { verb: "requirement-draft-edit", groupId: "r", expectedRevision: 3, payload: { draftNo: 1, draftHash: "d".repeat(64), edit: { kind: "add-implied-path", taskId: "images", path: "README.md" } } },
    ]);
  });

  it("a draft not awaiting review keeps the hints and offers no button", async () => {
    // mutation: drop the awaiting-review test from mayEdit -> the buttons show, red
    const page = show(withHints({ state: "rejected" }));
    expect(page.querySelector("[data-parallel-candidates]")).not.toBeNull();
    expect(page.querySelector("[data-apply-parallel]")).toBeNull();
    expect(page.querySelector("[data-add-implied-path]")).toBeNull();
  });
});
