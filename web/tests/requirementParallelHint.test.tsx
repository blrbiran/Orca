// @vitest-environment jsdom
/**
 * Tester #284: a split that chained independent tasks is shown with a short note naming the pairs code sees no reason to
 * order (the requirement view's parallelCandidates), in en and zh, so a person can send feedback without reading JSON.
 * The note is a hint: it sits beside the draft's layers, not among the hand-back reasons.
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
const withCandidates = (candidates: Array<{ before: string; after: string }> | undefined): RequirementViewV1 => {
  const view = requirementView("awaiting-review");
  return { ...view, drafts: view.drafts.map((draft) => (candidates === undefined ? draft : { ...draft, parallelCandidates: candidates })) };
};

describe("the split draft's parallel note (#284)", () => {
  it("names each pair in English and in Chinese", async () => {
    await i18n.changeLanguage("en");
    // mutation: drop the note from DraftReview -> no such element, red
    const en = show(withCandidates([{ before: "exporter", after: "images" }])).querySelector("[data-parallel-candidates]");
    expect(en?.textContent).toContain("These tasks could run in parallel: exporter ∥ images.");
    cleanup();
    await i18n.changeLanguage("zh");
    const zh = show(withCandidates([{ before: "exporter", after: "images" }])).querySelector("[data-parallel-candidates]");
    expect(zh?.textContent).toContain("这些任务可以并行：exporter ∥ images。");
  });

  it("shows nothing for a draft with no candidates, or one the server gave none", async () => {
    await i18n.changeLanguage("en");
    expect(show(withCandidates([])).querySelector("[data-parallel-candidates]")).toBeNull();
    cleanup();
    expect(show(withCandidates(undefined)).querySelector("[data-parallel-candidates]")).toBeNull();
  });
});
