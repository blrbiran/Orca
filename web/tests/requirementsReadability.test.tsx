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
    // Issue 96 (rewritten under 0e13a9b7's ruling; was: the body keeps "### R1.ADR1 One output" as text): a section's
    // markdown subset is rendered, so the ADR heading is a heading without its hashes.
    const decisions = within(region).getByRole("region", { name: "Decisions" });
    expect(within(decisions).getByRole("heading", { level: 6 }).textContent).toBe("R1.ADR1 One output");
    expect(decisions.textContent).not.toContain("###");
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

describe("the New requirement form (tester #36)", () => {
  // With many requirements listed the form was below all of them; starting one is the page's first action, so the form
  // comes before the first listed requirement.
  it("is above the list of requirements", () => {
    show(requirementView("awaiting-answers"));
    const nav = screen.getByRole("navigation", { name: "Requirement list" });
    const form = within(nav).getByRole("form", { name: "New requirement" });
    const firstListed = within(nav).getAllByRole("button").find((button) => button.getAttribute("aria-current") !== null)!;
    expect(form.compareDocumentPosition(firstListed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("the next step under the heading (tester #27, #33, #34)", () => {
  // The state was spread over the alert, the open round, Consensus at the end of the rounds and the drafts below; one
  // line under the heading names the single next step and jumps to where it is done.
  const next = (): string => screen.getByTestId("requirement-next").textContent ?? "";
  it.each([
    ["awaiting-answers", "Next: answer round 1. Go there"],
    ["answered", "Next: say \"We agree\", or ask for one more round. Go there"],
    ["awaiting-review", "Next: review split draft 1: send it back or accept it. Go there"],
  ] as const)("for %s is %s", (state, line) => {
    show(requirementView(state));
    expect(next()).toBe(line);
  });

  it("goes to preparation once a split is accepted, with no jump (the button sits right under it)", () => {
    const base = requirementView("awaiting-review");
    show({ ...base, summary: { ...base.summary, state: "draft" }, requirement: { ...base.requirement, acceptedDraftNo: 1 }, drafts: base.drafts.map((d) => ({ ...d, state: "accepted" as const })) });
    expect(next()).toBe("Next: go to task preparation.");
  });

  it("names Retry first when a step failed", () => {
    show(requirementView("failed"));
    expect(next()).toBe("Next: a step stopped or failed; retry it. Go there");
  });

  it("jumps to the region where the step is done", () => {
    show(requirementView("awaiting-answers"));
    within(screen.getByTestId("requirement-next")).getByRole("button", { name: "Go there" }).click();
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Rounds" }));
  });
});

describe("the split draft's table (tester #31)", () => {
  // Eight columns crowded out the ones a review is decided by; four stay, and the rest of each task folds under its title.
  it("shows task, title, depends on and checks, and folds the paths, labels and traces under the title", () => {
    show(requirementView("awaiting-review"));
    const region = screen.getByRole("region", { name: "Split draft 1" });
    expect(within(region).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Task", "Title", "Depends on", "Checks"]);
    const more = region.querySelector<HTMLDetailsElement>('details[data-task-more="exporter"]')!;
    expect(more.open).toBe(false);
    expect([...more.querySelectorAll("dt")].map((dt) => dt.textContent)).toEqual(["Target paths", "Labels", "Traces"]);
    expect([...more.querySelectorAll("dd")].map((dd) => dd.textContent)).toEqual(["src/export.ts, answer.txt", "feature", "AC1"]);
  });
});

describe("the requirement's budget line (tester #35)", () => {
  // A person should see the limit coming before a call is refused for budget: from 80% of a finite limit it warns.
  const at = (used: number, limit: number | null): string | null => {
    const base = requirementView("awaiting-answers");
    show({ ...base, ledger: { ...base.ledger, used: { ...base.ledger.used, tokens: used }, limit: { ...base.ledger.limit, tokens: limit } } });
    const tone = screen.getByTestId("requirement-budget").getAttribute("data-tone");
    cleanup();
    return tone;
  };
  it("warns from 80% of a finite limit, and never for an unlimited one", () => {
    expect(at(799_999, 1_000_000)).toBeNull();
    expect(at(800_000, 1_000_000)).toBe("warn");
    expect(at(5_000_000, null)).toBeNull();
  });
});

describe("the requirement document (tester #32)", () => {
  // Before consensus the document is a stub at the page's bottom; it folds then, and is open once there is consensus.
  const fold = (): HTMLDetailsElement => screen.getByRole("region", { name: "Requirement document" }).querySelector("details.requirement-document")!;
  it("is folded before consensus and open after it", () => {
    show(requirementView("awaiting-answers"));
    expect(fold().open).toBe(false);
    cleanup();
    show(requirementView("awaiting-review"));
    expect(fold().open).toBe(true);
  });
});

describe("the original idea folds once a round is answered (tester #28)", () => {
  // While the first round is open the idea is what is being clarified; after an answer the understanding leads, so the
  // idea folds -- with its start in the summary, so a round can still be read against it (#74).
  it("is open while no round is answered, folded with its start in the summary after one", () => {
    show(withIdea(requirementView("awaiting-answers"), "Let people take a note out as Markdown.\nKeep the images as links."));
    expect(screen.getByRole("region", { name: "Original idea" }).querySelector("details")).toBeNull();
    cleanup();
    show(withIdea(requirementView("answered"), "Let people take a note out as Markdown.\nKeep the images as links."));
    const fold = screen.getByRole("region", { name: "Original idea" }).querySelector<HTMLDetailsElement>("details.requirement-idea")!;
    expect(fold.open).toBe(false);
    expect(fold.querySelector("summary")!.textContent).toBe("Original idea Let people take a note out as Markdown. Keep the images as links.");
  });
});

describe("the requirement list's name prefers the short title (tester #1)", () => {
  // The id requirement-… is the group's key and stays; what a person reads is the name, the same one the cards show.
  it("names a requirement by the clarify round's short title when there is one, the id still the title attribute", () => {
    const button = listWith({ goal: "Let people take a note out as Markdown." }, { slug: "markdown-export", title: "Export notes as Markdown" });
    expect(button.textContent).toBe("Export notes as Markdown · clarifying");
    expect(button.getAttribute("title")).toBe("requirement-1e36e0a6");
  });
});
