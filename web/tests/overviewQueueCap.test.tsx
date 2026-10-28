import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Overview, OVERVIEW_DECISION_LIMIT, visibleQueue } from "../src/Overview.js";
import type { OverviewModel, OverviewQueueRow } from "../src/overviewModel.js";

const decision = (id: string): OverviewQueueRow => ({ key: `d-${id}`, kind: "decision-review", reason: `question ${id}`, owner: "Orca", ownerUnknown: false, ownerRequired: false, target: { kind: "decision", projectKey: "p", id }, priority: 1 }) as OverviewQueueRow;
const budget: OverviewQueueRow = { key: "b", kind: "budget-review", reason: "budget", owner: "Orca", ownerUnknown: false, ownerRequired: false, target: { kind: "group", groupId: "g" }, priority: 0 } as OverviewQueueRow;
const model = (queue: OverviewQueueRow[]): OverviewModel => ({ progress: [], queue, issues: [], sources: [], scopeUnavailable: false, complete: true });
const render = (queue: OverviewQueueRow[]): string => renderToStaticMarkup(<Overview model={model(queue)} onOpen={() => {}} onImport={() => {}} onRequirement={() => {}} />);

/** Taste refinement P1-4: Overview points at the decision queue; it does not copy all of it. */
describe("Overview decision rows (P1-4)", () => {
  it("shows every non-decision step and at most three decisions, in the model's order", () => {
    const v = visibleQueue([budget, decision("a"), decision("b"), decision("c"), decision("d"), decision("e")]);
    expect(v.rows.map((r) => r.key)).toEqual(["b", "d-a", "d-b", "d-c"]);
    expect(v.hiddenDecisions).toBe(2);
    expect(OVERVIEW_DECISION_LIMIT).toBe(3);
  });

  it("links to all decisions only when some are hidden (Review Focus 4)", () => {
    expect(render([decision("a"), decision("b"), decision("c")])).not.toContain('href="#decisions"');
    const html = render([decision("a"), decision("b"), decision("c"), decision("d")]);
    expect(html).toContain('href="#decisions"');
    expect(html).toContain("View all 4 decisions");
  });

  it("does not make the whole queue a live region", () => {
    expect(render([decision("a")])).not.toContain("aria-live");
  });

  it("aligns the two columns at the top and draws no card inside the Overview card", () => {
    // Ruling: human 「这次批准改写所有必要的判据」 (tester round 2026-10-28, controller session a9f9d6de; the `.overview-layout` rules became
    // utilities in Overview.tsx, so the criterion reads the rendered classes instead of styles.css). Utilities out-rank the
    // `.section-pane section[aria-label]` card rule and `.section-pane section section` fill, whatever their selectors.
    const html = render([decision("a")]);
    const layout = /<div class="([^"]*)"><section class="([^"]*)" aria-label="[^"]*"><h3>/.exec(html);
    expect(layout).not.toBeNull();
    // mutation: drop items-start from the grid -> the shorter column stretches to the taller one, red
    expect(layout![1]!.split(" ")).toEqual(expect.arrayContaining(["grid", "items-start"]));
    const columns = [...html.matchAll(/<section class="([^"]*)" aria-label="[^"]*"><h3>/g)].map((m) => m[1]!.split(" "));
    expect(columns).toHaveLength(2);
    // mutation: drop border-0 or shadow-none from the column -> a card inside the card, red
    for (const column of columns) expect(column).toEqual(expect.arrayContaining(["border-0", "shadow-none", "bg-transparent", "p-0", "m-0"]));
  });
});

/** Tester #25, #23: the queue is in priority order, so its first row is said to be the next step; an empty Overview says how to start. */
describe("Overview next step and empty state (tester #25, #23)", () => {
  it("marks only the first queue row as Next", () => {
    const html = render([budget, decision("a")]);
    expect(html.match(/class="overview-next[ "]/g)?.length).toBe(1);
    expect(html.indexOf("Next</span>")).toBeLessThan(html.indexOf("question a"));
    expect(html.indexOf("Next</span>")).toBeGreaterThan(-1);
    expect(render([])).not.toContain("overview-next");
  });

  it("with no active group, points at New requirement and Import plan", () => {
    expect(render([])).toContain("No active groups. Start one with New requirement or Import plan above.");
  });
});
