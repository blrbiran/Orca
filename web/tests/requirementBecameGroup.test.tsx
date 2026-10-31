// @vitest-environment jsdom
/**
 * Tester #80: after a split was accepted the steps ended with one button and no sign that anything was running. Once the
 * requirement has become a group the page says so and links to it; it does not move the person (no auto-jump).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequirementsPanel } from "../src/RequirementsPanel.js";
import type { RequirementViewV1 } from "../src/controlTypes.js";
import { config, requirementView, summaryWith } from "./fixtures/requirement.js";

afterEach(() => { cleanup(); window.location.hash = ""; });
const mount = (view: RequirementViewV1) => render(
  <RequirementsPanel config={config} summary={summaryWith(view)} views={{ [view.summary.groupId]: view }} selected={view.summary.groupId} agents={null} language="en" onSelect={vi.fn()} onCommand={vi.fn()} />,
);
const accepted = (over: Partial<RequirementViewV1["summary"]>): RequirementViewV1 => {
  const base = requirementView("answered");
  return { ...base, summary: { ...base.summary, ...over }, requirement: { ...base.requirement, acceptedDraftNo: 1 } };
};

describe("a requirement that became a group links to it (tester #80)", () => {
  // mutation: the line is removed -> the steps end with no sign of execution -> red
  it("links to the task group and leaves the route alone", () => {
    const view = accepted({ state: "ready" });
    mount(view);
    const link = screen.getByRole("link", { name: "Open the task group" });
    expect(link.getAttribute("href")).toBe(`#tasks/${view.summary.groupId}`);
    expect(window.location.hash).toBe("");
  });

  // mutation: the state test is dropped -> a link to a task group that does not exist yet -> red
  it("offers no link while the requirement is still clarifying", () => {
    mount(accepted({ state: "clarifying" }));
    expect(screen.queryByTestId("requirement-became-group")).toBeNull();
  });
});
