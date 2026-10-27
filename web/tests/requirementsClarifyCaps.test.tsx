// @vitest-environment jsdom
/**
 * Issues #83, #86, #87 (clarify caps spec 2026-10-21 §3.6): the requirement page shows what the person must act on and
 * folds the rest -- an answered recommendation once, marked; answered rounds as one line per question; the round
 * waiting on them in the warn tone -- says what the model is drafting and for how long, and shows the size code holds
 * clarification to with the two things the person can do about it (set the size, ask for one more round).
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequirementsPanel } from "../src/RequirementsPanel.js";
import type { RequirementViewV1 } from "../src/controlTypes.js";
import { config, requirementView, summaryWith } from "./fixtures/requirement.js";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const mount = (view: RequirementViewV1, onCommand = vi.fn()) => {
  render(<RequirementsPanel config={config} summary={summaryWith(view)} views={{ r: view }} selected="r" agents={null} language="en" onSelect={() => {}} onCommand={onCommand} />);
  return onCommand;
};
const CLARIFY: NonNullable<RequirementViewV1["clarify"]> = {
  classification: { scope: "small", scopeReason: "One exporter.", clarity: "clear", clarityReason: "The format is named." },
  override: null, tier: "small", roundCap: 1, questions: 3, glossary: 2, adrs: 1, stoppedAtCap: true, chain: [1],
};
const roundBox = (n: number) => screen.getByText(new RegExp(`^Round ${n} · `)).closest("details")!;

describe("the clarification rounds (#83)", () => {
  it("writes an answered round one line per question, a recommended answer once with its mark, folded by default", () => {
    mount(requirementView("answered"));
    const box = roundBox(1);
    expect(box.open).toBe(false);
    expect(box.getAttribute("data-tone")).toBeNull();
    const lines = [...box.querySelectorAll(":scope > ul > li")].map((li) => li.textContent);
    expect(lines).toEqual(["R1.Q1: CommonMark (recommended)", "R1.Q2: As relative links"]);
    // The recommendation is not repeated beside the answer that took it.
    expect(box.textContent).not.toContain("Recommended: CommonMark");
    expect(within(box).getByText("Questions, reasons and proposals").closest("details")!.open).toBe(false);
  });

  it("opens the round waiting on the person in the warn tone", () => {
    mount(requirementView("awaiting-answers"));
    const box = roundBox(1);
    expect(box.open).toBe(true);
    expect(box.getAttribute("data-tone")).toBe("warn");
    expect(within(box).getByRole("button", { name: "Send answers" })).toBeTruthy();
  });

  it("folds the glossary, decisions and open branches under one summary", () => {
    mount(requirementView("answered"));
    const more = screen.getByText("Glossary, decisions and open branches").closest("details")!;
    expect(more.open).toBe(false);
    expect(within(more).getByText("note: One page of text a person wrote.")).toBeTruthy();
  });
});

describe("what the model is drafting, and for how long (#87)", () => {
  const drafting = (view: RequirementViewV1) => ({ ...view, rounds: [...view.rounds, { ...view.rounds[0]!, roundNo: 2, state: "drafting" as const, result: null, answers: null }] });
  it("names the round, and the time since the command that asked for it", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(1_000_000 + 125_000));
    mount({ ...drafting(requirementView("answered")), draftingSince: 1_000_000 });
    expect(screen.getByRole("status").textContent).toContain("The model is drafting round 2's questions. Waiting 2 min 5 s.");
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole("status").textContent).toContain("Waiting 2 min 6 s.");
  });

  it("names the task split once consensus is reached, and leaves the time out when it is not known", () => {
    const view = requirementView("awaiting-review");
    mount({ ...view, drafts: [{ ...view.drafts[0]!, state: "drafting", output: null }], draftingSince: null });
    const status = screen.getAllByRole("status").find((p) => p.textContent?.includes("drafting"))!;
    expect(status.textContent).toContain("The model is drafting the task split (draft 1).");
    expect(status.textContent).not.toContain("Waiting");
  });
});

describe("the clarification size (#86)", () => {
  it("shows the model's judgement with its reasons and the caps, and sends the person's own size", () => {
    const onCommand = mount({ ...requirementView("awaiting-answers"), clarify: { ...CLARIFY, stoppedAtCap: false } });
    const size = screen.getByRole("region", { name: "Clarification size" });
    // Tester #37: "scope"/"clarity" read as the requirement's size and how clear it is. Ruling: human approved rewriting all necessary criteria, Orca session 7753e97d, 2026-10-27
    expect(size.textContent).toContain("The model judged: size small (One exporter.), how clear: clear (The format is named.)");
    expect(size.textContent).toContain("Limits: up to 1 rounds; per round at most 3 questions, 2 glossary entries and 1 decisions.");
    const set = within(size).getByRole("button", { name: "Set the size" }) as HTMLButtonElement;
    expect(set.disabled).toBe(true);
    fireEvent.change(within(size).getByRole("combobox", { name: "Size of the requirement" }), { target: { value: "large" } });
    fireEvent.click(set);
    expect(onCommand).toHaveBeenCalledWith({ verb: "requirement-classify", groupId: "r", expectedRevision: 3, payload: { scope: "large", clarity: "clear" } });
  });

  it("says an older requirement is unclassified, and shows no size before round 1 has answered", () => {
    mount({ ...requirementView("answered"), clarify: { ...CLARIFY, classification: null, tier: "large", roundCap: 3, questions: 5, glossary: 5, adrs: 3, stoppedAtCap: false } });
    expect(screen.getByRole("region", { name: "Clarification size" }).textContent).toContain("Not classified yet: held to the widest limits.");
    cleanup();
    const failed = requirementView("failed");
    mount({ ...failed, clarify: { ...CLARIFY, classification: null } });
    expect(screen.queryByRole("region", { name: "Clarification size" })).toBeNull();
  });

  it("says clarification stopped at the cap and asks for exactly the next round", () => {
    const onCommand = mount({ ...requirementView("answered"), clarify: CLARIFY });
    expect(screen.getByText(/Clarification stopped after round 1, the last this size allows\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clarify one more round" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "requirement-clarify-more", groupId: "r", expectedRevision: 3, payload: { roundNo: 1 } });
  });

  it("offers no more rounds while a round awaits answers or after consensus", () => {
    mount({ ...requirementView("awaiting-answers"), clarify: { ...CLARIFY, stoppedAtCap: false } });
    expect(screen.queryByRole("button", { name: "Clarify one more round" })).toBeNull();
    cleanup();
    mount({ ...requirementView("awaiting-review"), clarify: CLARIFY });
    expect(screen.queryByRole("button", { name: "Clarify one more round" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Set the size" })).toBeNull();
  });
});

describe("the clarification size in plain words (tester #37)", () => {
  // A person did not know what "scope"/"clarity" meant or when to set them: one line says what the size is for, and
  // setting one's own folds away, since the model's judgement is the default.
  it("says what the size is for, and folds setting one's own", () => {
    mount({ ...requirementView("awaiting-answers"), clarify: { ...CLARIFY, stoppedAtCap: false } });
    const size = screen.getByRole("region", { name: "Clarification size" });
    expect(within(size).getByRole("note").textContent).toBe("The size sets how many rounds and questions clarification may take. The model's judgement is used unless you set your own.");
    const fold = size.querySelector<HTMLDetailsElement>("details.requirement-set-size")!;
    expect(fold.open).toBe(false);
    expect(fold.querySelector("summary")!.textContent).toBe("Set your own size");
    expect(fold.contains(within(size).getByRole("button", { name: "Set the size" }))).toBe(true);
  });
});
