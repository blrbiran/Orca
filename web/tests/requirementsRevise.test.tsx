// @vitest-environment jsdom
/**
 * Flow engine spec §10.3 (Issue #76, W-76; plan Task 5's web panel): an earlier clarify round can be revised. The panel
 * numbers rounds by their place on the active chain ("Round 2, revised"), folds the rounds a revision superseded under
 * it, and lets the person edit an answered round on the chain -- sending it only after a dialog that says the revision
 * costs one clarify call. Nothing is revised once a split was accepted.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequirementsPanel } from "../src/RequirementsPanel.js";
import type { RequirementViewV1, RoundBodyV1 } from "../src/controlTypes.js";
import { config, requirementView, summaryWith } from "./fixtures/requirement.js";

afterEach(cleanup);
const mount = (view: RequirementViewV1, onCommand = vi.fn()) => {
  render(<RequirementsPanel config={config} summary={summaryWith(view)} views={{ r: view }} selected="r" agents={null} language="en" onSelect={() => {}} onCommand={onCommand} />);
  return onCommand;
};
const CLARIFY = (chain: number[]): NonNullable<RequirementViewV1["clarify"]> => ({
  classification: null, override: null, tier: "large", roundCap: 5, questions: 5, glossary: 5, adrs: 3, stoppedAtCap: false, chain,
});
/** Rounds 1-3 answered, and row 4 revising round 2: the chain is [1, 4]; rounds 2 and 3 are superseded. */
function revisedView(): RequirementViewV1 {
  const base = requirementView("answered");
  const one = base.rounds[0]!;
  const rows: RoundBodyV1[] = [1, 2, 3].map((roundNo) => ({ ...one, roundNo }));
  rows.push({ ...one, roundNo: 4, revises: 2, reason: "the format changed", answers: [{ id: "R1.Q1", kind: "text", text: "GFM" }, { id: "R1.Q2", kind: "recommended", text: "As links" }] });
  return { ...base, rounds: rows, clarify: CLARIFY([1, 4]) };
}
/** Three answered rounds, nothing revised yet. */
function threeRounds(): RequirementViewV1 {
  const base = requirementView("answered");
  return { ...base, rounds: [1, 2, 3].map((roundNo) => ({ ...base.rounds[0]!, roundNo })), clarify: CLARIFY([1, 2, 3]) };
}
const roundBox = (label: string) => screen.getByText(new RegExp(`^${label} · `)).closest("details")!;

describe("rounds by their place on the active chain (spec §10.3)", () => {
  it("numbers a revision by its chain position and folds the rounds it superseded under it", () => {
    mount(revisedView());
    const revision = roundBox("Round 2, revised");
    // mutation: number rounds by round_no instead of chain position -> no "Round 2, revised", red
    expect(revision.textContent).toContain("the format changed");
    // mutation: list superseded rounds as chain rounds -> a "Round 3 · " box exists, red
    expect(screen.queryByText(/^Round 3 · /)).toBeNull();
    expect(screen.queryByText(/^Round 4/)).toBeNull();
    const superseded = within(revision).getAllByText(/^Superseded round/).map((s) => s.closest("details")!);
    expect(superseded.map((d) => d.querySelector("summary")!.textContent)).toEqual(["Superseded round (stored as round 2) · answered", "Superseded round (stored as round 3) · answered"]);
    // Collapsed: the person opens them to read what was replaced.
    expect(superseded.every((d) => !d.open)).toBe(true);
    // Only rounds on the chain can be revised.
    for (const d of superseded) expect(within(d).queryByRole("button", { name: "Revise this round" })).toBeNull();
  });
});

describe("revising an answered round (spec §10.3: the dialog says it costs one clarify call)", () => {
  it("sends requirement-revise only after the person confirms the cost, with the edited answers, reason and exclusions", () => {
    const onCommand = mount(threeRounds());
    const first = roundBox("Round 1");
    fireEvent.click(within(first).getByRole("button", { name: "Revise this round" }));
    const form = within(first).getByRole("form", { name: "Revise round 1" });
    // Prefilled with the round's own answers: R1.Q2 was a text answer.
    expect((within(form).getByRole("textbox", { name: "R1.Q2: your own answer" }) as HTMLTextAreaElement).value).toBe("As relative links");
    fireEvent.change(within(form).getByRole("textbox", { name: "R1.Q2: your own answer" }), { target: { value: "Inline" } });
    fireEvent.change(within(form).getByRole("textbox", { name: "Why revise (optional)" }), { target: { value: "inline is simpler" } });
    // Later rounds on the chain are superseded; the person may keep their answers out of the next round.
    fireEvent.click(within(form).getByRole("checkbox", { name: "Do not carry round 3's answers forward" }));
    fireEvent.click(within(form).getByRole("button", { name: "Send revision" }));
    // mutation: send without the dialog -> called before the confirm, red
    expect(onCommand).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Revise round 1?" });
    expect(dialog.textContent).toContain("costs one clarify call");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revise and spend one call" }));
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand.mock.calls[0]![0]).toEqual({ verb: "requirement-revise", groupId: "r", expectedRevision: 3, payload: {
      roundNo: 1,
      answers: [{ id: "R1.Q1", kind: "recommended" }, { id: "R1.Q2", kind: "text", text: "Inline" }],
      glossaryDecisions: [{ id: "R1.G1", accept: true }], adrDecisions: [{ id: "R1.ADR1", accept: true }],
      reason: "inline is simpler", exclude: [3],
    } });
  });

  it("sends nothing when the person keeps the round as it is", () => {
    const onCommand = mount(threeRounds());
    const second = roundBox("Round 2");
    fireEvent.click(within(second).getByRole("button", { name: "Revise this round" }));
    fireEvent.click(within(second).getByRole("button", { name: "Send revision" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Keep the round" }));
    expect(onCommand).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers no revision once a split was accepted (requirement-already-accepted)", () => {
    const view = threeRounds();
    mount({ ...view, requirement: { ...view.requirement, acceptedDraftNo: 1 } });
    // mutation: offer revise after acceptance -> button found, red
    expect(screen.queryByRole("button", { name: "Revise this round" })).toBeNull();
  });
});
