import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
    const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
    const at = css.indexOf(".overview-layout {");
    expect(css.slice(at, css.indexOf("}", at))).toContain("align-items: start");
    // Must out-rank `.section-pane section[aria-label]` (card) and `.section-pane section section` (inner bg).
    const inner = css.indexOf(".section-pane .overview-layout > section[aria-label] {");
    expect(inner).toBeGreaterThan(-1);
    const r = css.slice(inner, css.indexOf("}", inner));
    expect(r).toContain("border: 0");
    expect(r).toContain("box-shadow: none");
  });
});
