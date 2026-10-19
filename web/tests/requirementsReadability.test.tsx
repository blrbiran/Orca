// @vitest-environment jsdom
/**
 * Issue convergence W1 (2026-10-19, issues #73-#79): the Requirements page reads as the person wrote and as the server
 * counts. The idea stays on screen in every state (#74), the list names each requirement by its slug or its idea, not by
 * a generated id (#75, #78), token figures are short and the in-flight grant says what it is (#79), the document reads as
 * sections (#77), and a refused agent selection or ccloop failure explains ccloop's code with its detail (#73).
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { RequirementsPanel } from "../src/RequirementsPanel.js";
import type { ControlRefusal } from "../src/controlState.js";
import type { ControlSummaryV1, GroupSummaryV1, RequirementViewV1 } from "../src/controlTypes.js";
import { config, requirementView, summaryWith } from "./fixtures/requirement.js";
import type { RequirementFixtureState } from "./fixtures/requirement.js";

afterEach(cleanup);
const show = (view: RequirementViewV1, refusal: ControlRefusal | null = null, summary: ControlSummaryV1 = summaryWith(view)): HTMLElement =>
  render(<RequirementsPanel config={config} summary={summary} views={{ [view.summary.groupId]: view }} selected={view.summary.groupId} agents={null} language="en"
    onSelect={() => {}} onCommand={() => {}} refusal={refusal} />).container;
const withIdea = (view: RequirementViewV1, idea: string): RequirementViewV1 => ({ ...view, requirement: { ...view.requirement, idea } });

describe("the requirement's own idea (#74)", () => {
  const STATES: RequirementFixtureState[] = ["awaiting-answers", "answered", "awaiting-review", "failed"];
  it("is shown as written, line breaks kept, above the rounds, in every state", () => {
    const idea = "Let people take a note out as Markdown.\nKeep the images as links.";
    for (const state of STATES) {
      show(withIdea(requirementView(state), idea));
      const region = screen.getByRole("region", { name: "Original idea" });
      expect(within(region).getByRole("heading", { name: "Original idea" })).toBeTruthy();
      const text = region.querySelector(".requirement-text");
      expect(text?.textContent, state).toBe(idea);
      const rounds = screen.getByRole("region", { name: "Rounds" });
      expect(region.compareDocumentPosition(rounds) & Node.DOCUMENT_POSITION_FOLLOWING, state).toBeTruthy();
      cleanup();
    }
  });
});

describe("the requirement document (#77)", () => {
  const documentRegion = () => screen.getByRole("region", { name: "Requirement document" });
  it("is split into sections at its ## headings, each heading and body as text", () => {
    const view = requirementView("answered");
    show({ ...view, document: "# markdown-export\n\nPeople can export.\n\n## Statement\n\nA note <b>exports</b>.\n\n## Decisions\n\n### R1.ADR1 One output\n\nEach note alone.\n" });
    const region = documentRegion();
    expect(within(region).getAllByRole("heading", { level: 5 }).map((h) => h.textContent)).toEqual(["Statement", "Decisions"]);
    expect(region.querySelector("pre")).toBeNull();
    expect(region.textContent).not.toMatch(/(^|\n)## /);
    expect(within(region).getByRole("region", { name: "Statement" }).textContent).toContain("A note <b>exports</b>.");
    expect(region.querySelector("b")).toBeNull();
    expect(region.textContent).toContain("# markdown-export");
    expect(within(region).getByRole("region", { name: "Decisions" }).textContent).toContain("### R1.ADR1 One output");
  });

  it("stays one preformatted block when it has no ## heading", () => {
    const view = requirementView("answered");
    show(view);
    expect(documentRegion().querySelector("pre")?.textContent).toBe(view.document);
  });
});
