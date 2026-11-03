// @vitest-environment jsdom
/**
 * Spec 2026-11-03 soft-mode approximate usage (human ruling, session 43913afc): in a group with no token limit a call whose
 * usage the tool did not report is booked at its observed floor and the requirement goes on. The total then under-counts,
 * so the page says so instead of showing the number as reported.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequirementsPanel } from "../src/RequirementsPanel.js";
import type { ControlConfigV1, ControlSummaryV1, RequirementViewV1 } from "../src/controlTypes.js";
import { config, requirementView, summaryWith } from "./fixtures/requirement.js";

afterEach(() => cleanup());
const withApproximate = (n: number | undefined): RequirementViewV1 => {
  const view = requirementView("awaiting-answers");
  return { ...view, ledger: { ...view.ledger, ...(n === undefined ? {} : { approximateRuns: n }) } };
};
const mount = (view: RequirementViewV1) => render(<RequirementsPanel config={config as ControlConfigV1} summary={summaryWith(view) as ControlSummaryV1} views={{ r: view }} selected="r" agents={null} language="en" onSelect={() => {}} onCommand={vi.fn()} />);

describe("a requirement whose usage counts a booked floor", () => {
  // mutation: drop the note -> no requirement-usage-approximate -> red
  it("says the total is a floor and how many calls went unreported", () => {
    mount(withApproximate(2));
    expect(screen.getByTestId("requirement-usage-approximate").textContent).toBe("At least: the tool did not report the usage of 2 call(s); the total counts what was observed before they stopped.");
  });
  it("says nothing when every call's usage was reported, or the server predates the count", () => {
    mount(withApproximate(0));
    expect(screen.queryByTestId("requirement-usage-approximate")).toBeNull();
    cleanup();
    mount(withApproximate(undefined));
    expect(screen.queryByTestId("requirement-usage-approximate")).toBeNull();
  });
});
