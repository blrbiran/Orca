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

/** The list alone: one requirement group, its summary changed by `over`. */
function listWith(over: Partial<GroupSummaryV1>, requirement: Partial<NonNullable<GroupSummaryV1["requirement"]>> = {}): HTMLElement {
  const view = requirementView("awaiting-answers");
  const group: GroupSummaryV1 = { ...view.summary, groupId: "requirement-1e36e0a6", ...over, requirement: { ...view.summary.requirement!, ...requirement } };
  render(<RequirementsPanel config={config} summary={{ ...summaryWith(view), groups: [group] }} views={{}} selected={null} agents={null} language="en" onSelect={() => {}} onCommand={() => {}} />);
  return within(screen.getByRole("navigation", { name: "Requirement list" })).getAllByRole("button").find((b) => b.getAttribute("title") !== null || b.textContent!.includes("·"))!;
}

describe("the requirement list's names (#75, #78)", () => {
  it("names a requirement by its slug, with the group id only as the secondary title", () => {
    const button = listWith({ goal: "Let people take a note out as Markdown." }, { slug: "markdown-export" });
    expect(button.textContent).toBe("markdown-export · clarifying");
    expect(button.getAttribute("title")).toBe("requirement-1e36e0a6");
  });

  it("names a requirement without a slug by the first 60 characters of its idea on one line", () => {
    const idea = "Let people take a note out as Markdown,\nwith every image kept as a relative link beside it.";
    const button = listWith({ goal: idea }, { slug: null });
    const shown = button.textContent!.split(" · ")[0]!;
    expect(shown).toBe(`${Array.from(idea.replace(/\s+/g, " ")).slice(0, 60).join("")}…`);
    expect(button.textContent).not.toContain("requirement-1e36e0a6");
    expect(button.getAttribute("title")).toBe("requirement-1e36e0a6");
  });

  it("keeps a short idea whole, and the group id when neither slug nor idea is known (no title then)", () => {
    expect(listWith({ goal: "Print a page." }, { slug: null }).textContent).toBe("Print a page. · clarifying");
    cleanup();
    const bare = listWith({ goal: undefined }, { slug: undefined });
    expect(bare.textContent).toBe("requirement-1e36e0a6 · clarifying");
    expect(bare.getAttribute("title")).toBeNull();
    cleanup();
    // An idea of whitespace alone names nothing either.
    expect(listWith({ goal: " \n " }, { slug: null }).textContent).toBe("requirement-1e36e0a6 · clarifying");
  });
});

describe("the requirement's token figures (#79)", () => {
  const counted = (): RequirementViewV1 => {
    const view = requirementView("awaiting-answers");
    const amount = (tokens: number) => ({ tokens, activeMs: 0, attempts: 0, sessions: 0 });
    return { ...view, ledger: { limit: { tokens: null, activeMs: 0, attempts: 0, sessions: 0 }, used: amount(1_611_520), reserved: amount(1_000_000), usageUnknown: false } };
  };

  it("writes used, limit and the in-flight grant short, and says the grant is held by running calls", () => {
    const root = show(counted());
    expect(root.textContent).toContain("1.6M of Unlimited tokens used, 1M held by running calls");
    expect(root.textContent).not.toContain("1611520");
    const held = screen.getByTitle(/released when those calls settle/);
    expect(held.textContent).toContain("1M held by running calls");
  });

  // Issue #84 (human: 中文界面也统一用 K/M/B): was "已用 161.2 万 / 上限 不限 tokens，运行中占用 100 万".
  it("reads 运行中占用 in Chinese, with the same K/M/B magnitudes as English", async () => {
    await i18n.changeLanguage("zh");
    const root = show(counted());
    expect(root.textContent).toContain("已用 1.6M / 上限 不限 tokens，运行中占用 1M");
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

describe("a refused requirement action's detail (#73)", () => {
  it("explains the ccloop code behind a refused estimator selection", () => {
    show(requirementView("answered"), { status: 422, code: "agent-selection-rejected", message: "agent-selection-rejected:estimator:omp-model-catalog-unavailable", commandRevision: null });
    expect(screen.getByRole("alert").textContent).toContain("omp could not list its model catalog");
  });

  it("explains a ccloop failure by its code and keeps ccloop's detail", () => {
    show(requirementView("answered"), { status: 424, code: "ccloop-failed", message: "ccloop-failed:omp-model-catalog-unavailable: env: bun: No such file or directory", commandRevision: null });
    expect(screen.getByRole("alert").textContent).toContain("omp could not list its model catalog (env: bun: No such file or directory)");
  });
});
