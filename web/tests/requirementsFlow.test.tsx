// @vitest-environment jsdom
/**
 * Tester round 2026-10-28, batch 4a (Requirements page): #106 the page's buttons stay on lines of their own and never
 * overlap, #76 the flow's step indicator and the Next note, #107 hand-back reasons carry their meaning beside the code.
 * jsdom applies no sheet, so the layout promises are pinned on the class strings that carry them.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { RequirementsPanel, explainSplitReason, flowSteps } from "../src/RequirementsPanel.js";
import type { ControlSummaryV1, RequirementViewV1 } from "../src/controlTypes.js";
import { config, requirementView, summaryWith } from "./fixtures/requirement.js";

afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });
const show = (view: RequirementViewV1, language: "en" | "zh" = "en"): HTMLElement =>
  render(<RequirementsPanel config={config} summary={summaryWith(view) as ControlSummaryV1} views={{ r: view }} selected="r" agents={null} language={language}
    onSelect={() => {}} onCommand={() => {}} />).container;
const withReasons = (reasons: string[]): RequirementViewV1 => {
  const base = requirementView("awaiting-review");
  return { ...base, drafts: [{ ...base.drafts[0]!, state: "failed", draftHash: null, reasons, layers: null, implicitEdges: null, reasonCode: "split-validation-exhausted" }] };
};

describe("hand-back reasons on a split draft (#107)", () => {
  it("shows a trace: reason with its meaning in English and in Chinese, the code kept", async () => {
    show(withReasons(["trace:T9:R1.G7"]));
    // mutation: render the bare reason again (drop explainSplitReason's result from the list item) -> red
    expect(screen.getByText(/^trace:T9:R1\.G7 · this id is neither an acceptance criterion's id/)).toBeTruthy();
    cleanup();
    await i18n.changeLanguage("zh");
    show(withReasons(["trace:T9:R1.G7"]), "zh");
    expect(screen.getByText(/^trace:T9:R1\.G7 · 这个编号既不是需求文档里某条验收标准的编号/)).toBeTruthy();
  });

  it("shows an expand: reason with the meaning of the refusal it names", () => {
    show(withReasons(["expand:T2:investigate-target"]));
    // mutation: key the expand meaning by the task id instead of the last part (the refusal) -> red
    expect(screen.getByText(/^expand:T2:investigate-target · an investigate task must name exactly one target path/)).toBeTruthy();
  });

  it("leaves a reason that carries its checker's own message, or an unknown one, as the code alone", () => {
    expect(explainSplitReason("graph:buildGraph: a cycle")).toBeNull();
    expect(explainSplitReason("import:other-item")).toBeNull();
    expect(explainSplitReason("expand:T1:not-a-refusal")).toBeNull();
    expect(explainSplitReason("untraced:AC2")).toMatch(/traces this acceptance criterion/);
  });
});

describe("the flow's step indicator (#76)", () => {
  const states = (view: RequirementViewV1): string => flowSteps(view).map((s) => `${s.stage}:${s.state}`).join(" ");
  it("moves from clarify rounds to consensus to split drafts to accepted to exported, from what the view already holds", () => {
    expect(states(requirementView("awaiting-answers"))).toBe("clarify:current consensus:ahead split:ahead accepted:ahead exported:ahead");
    expect(states(requirementView("answered"))).toBe("clarify:done consensus:current split:ahead accepted:ahead exported:ahead");
    const review = requirementView("awaiting-review");
    const agreed = { ...review, requirement: { ...review.requirement, consensus: { roundNo: 1 } } } as unknown as RequirementViewV1;
    expect(states(agreed)).toBe("clarify:done consensus:done split:current accepted:ahead exported:ahead");
    const accepted = { ...agreed, requirement: { ...agreed.requirement, acceptedDraftNo: 1, export: { ...agreed.requirement.export, state: "done" } } } as RequirementViewV1;
    expect(states(accepted)).toBe("clarify:done consensus:done split:done accepted:done exported:done");
  });

  it("is a list on the page with the current step marked", () => {
    show(requirementView("answered"));
    const list = screen.getByRole("list", { name: "Where this requirement is" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("data-step"))).toEqual(["clarify", "consensus", "split", "accepted", "exported"]);
    // mutation: drop aria-current from the current step -> red
    expect(items.filter((li) => li.getAttribute("aria-current") === "step").map((li) => li.getAttribute("data-step"))).toEqual(["consensus"]);
  });
});

describe("the Requirements page's buttons (#106) and Next note (#76)", () => {
  it("gives a listed requirement's button the room the card's own more-button sits in, so the two never overlap", () => {
    const view = requirementView("answered");
    render(<RequirementsPanel config={config} summary={summaryWith(view) as ControlSummaryV1} views={{ r: view }} selected="r" agents={null} language="en" onSelect={() => {}} onCommand={() => {}} />);
    const row = screen.getByRole("navigation", { name: "Requirement list" }).querySelector(".group-card-row")!;
    const open = [...row.querySelectorAll("button")].find((b) => b.getAttribute("aria-current") !== null)!;
    // mutation: delete pr-[48px] from the list button -> red
    expect(open.className).toContain("pr-[48px]");
    expect(open.className).toContain("flex-1");
  });

  it("puts the Next note's text and its button on one wrapping row, in the panel's note look", () => {
    show(requirementView("awaiting-answers"));
    const next = screen.getByTestId("requirement-next");
    // mutation: drop role="note" (the notes' padding, radius and well) -> red
    expect(next.getAttribute("role")).toBe("note");
    expect(next.className).toContain("flex-wrap");
    expect(within(next).getByRole("button", { name: "Go there" })).toBeTruthy();
  });
});
