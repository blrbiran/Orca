// @vitest-environment jsdom
/**
 * #351 addendum (spec docs/superpowers/specs/2026-11-18-split-feedback-conflicts-design.md): a draft whose split reports
 * that it does not meet the requirement as written shows those conflicts as a warning, in en and zh; a draft without
 * them shows nothing new. Code does not judge the conflicts, it only shows what the split said.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../src/i18n.js";
import { RequirementsPanel } from "../src/RequirementsPanel.js";
import type { ControlAction } from "../src/controlApi.js";
import type { RequirementViewV1 } from "../src/controlTypes.js";
import { config, requirementView, summaryWith } from "./fixtures/requirement.js";

afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });
const CONFLICTS = [
  { criterion: "AC4", feedback: "make sla-breach depend on sla-clock", why: "sla-breach and sla-clock no longer run concurrently" },
  { criterion: "AC2", why: "no task writes cli/" },
];
const show = (view: RequirementViewV1, onCommand: (action: ControlAction) => void = () => {}): HTMLElement =>
  render(<RequirementsPanel config={config} summary={summaryWith(view)} views={{ [view.summary.groupId]: view }} selected={view.summary.groupId} agents={null} language="en"
    onSelect={() => {}} onCommand={onCommand} refusal={null} />).container;
const withConflicts = (conflicts: typeof CONFLICTS | undefined): RequirementViewV1 => {
  const view = requirementView("awaiting-review");
  return { ...view, drafts: view.drafts.map((draft) => (conflicts === undefined || draft.output === null ? draft : { ...draft, output: { ...draft.output, requirementConflicts: conflicts } as typeof draft.output })) };
};

describe("the split draft's requirement conflicts (#351 addendum)", () => {
  it("lists each conflict, with the feedback quote when there is one, in English and in Chinese", async () => {
    await i18n.changeLanguage("en");
    // mutation: drop the alert from DraftReview -> no such element, red
    const en = show(withConflicts(CONFLICTS)).querySelector("[data-requirement-conflicts]");
    expect(en?.getAttribute("role")).toBe("alert");
    expect(en?.textContent).toContain("This draft does not meet the requirement as written (2)");
    const items = [...(en?.querySelectorAll("li") ?? [])].map((li) => li.textContent);
    expect(items).toEqual([
      "AC4: sla-breach and sla-clock no longer run concurrentlyCaused by your feedback: “make sla-breach depend on sla-clock”",
      "AC2: no task writes cli/",
    ]);
    cleanup();
    await i18n.changeLanguage("zh");
    const zh = show(withConflicts(CONFLICTS)).querySelector("[data-requirement-conflicts]");
    expect(zh?.textContent).toContain("这份草稿与需求原文不一致（2 处）");
    expect(zh?.textContent).toContain("AC4：sla-breach and sla-clock no longer run concurrently");
    expect(zh?.textContent).toContain("由你的反馈引起：“make sla-breach depend on sla-clock”");
  });

  it("shows nothing for a draft without the key", async () => {
    await i18n.changeLanguage("en");
    expect(show(withConflicts(undefined)).querySelector("[data-requirement-conflicts]")).toBeNull();
  });
});

// Spec D2 (the Issue 88 shape): accepting a draft with conflicts takes a deliberate second step; without them, one click.
describe("accepting a draft with requirement conflicts (#351 addendum)", () => {
  it("the first click opens a dialog listing the conflicts and sends nothing; Accept anyway sends the accept", async () => {
    await i18n.changeLanguage("en");
    const onCommand = vi.fn();
    const view = withConflicts(CONFLICTS);
    show(view, onCommand);
    fireEvent.click(screen.getByRole("button", { name: "Accept this split" }));
    // mutation: send on the first click -> red
    expect(onCommand).not.toHaveBeenCalled();
    let dialog = screen.getByRole("dialog", { name: "This draft does not meet the requirement as written (2)" });
    expect(within(dialog).getByText(/Orca does not check it/)).toBeTruthy();
    expect(dialog.textContent).toContain("AC4: sla-breach and sla-clock no longer run concurrently");
    expect(dialog.textContent).toContain("AC2: no task writes cli/");
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep discussing" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onCommand).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Accept this split" }));
    dialog = screen.getByRole("dialog", { name: "This draft does not meet the requirement as written (2)" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Accept anyway" }));
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand.mock.calls[0]![0]).toEqual({ verb: "requirement-draft-accept", groupId: view.summary.groupId, expectedRevision: view.summary.commandRevision,
      payload: { draftNo: 1, draftHash: "d".repeat(64) } });
  });

  it("a draft without conflicts is accepted with one click", async () => {
    await i18n.changeLanguage("en");
    const onCommand = vi.fn();
    show(withConflicts(undefined), onCommand);
    fireEvent.click(screen.getByRole("button", { name: "Accept this split" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand.mock.calls[0]![0]).toMatchObject({ verb: "requirement-draft-accept", payload: { draftNo: 1, draftHash: "d".repeat(64) } });
  });
});
