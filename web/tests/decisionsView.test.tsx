import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NO_QUESTION } from "../src/DecisionList.js";
import { DecisionsView, NO_FILTER, filterRows } from "../src/DecisionsView.js";
import { DecisionDetail, CORRECT_NOTE, AGREE_HELP } from "../src/DecisionDetail.js";
import type { DecisionListRow } from "../src/types.js";

const row = (over: Partial<DecisionListRow>): DecisionListRow => ({
  projectKey: "proj", id: "run/1", at: "2026-09-01T00:00:00.000Z", kind: "interface", scope: "repo", verdict: "ok", question: "q", ...over,
});
const rows = [
  row({ id: "run/1", kind: "interface", question: "first question" }),
  row({ id: "run/2", kind: "boundary", scope: "cross-repo", question: null }),
  row({ id: "run/3", projectKey: "other", kind: "interface" }),
];

/**
 * Carries the intent of the deleted panelHome criterion (task 8 ruling K5, rewritten under ruling U2
 * and authorised as U4 in session a50f4d80): the first screen is the work a person owes, so the
 * Decisions pane shows the to-do heading and the rows; sections.ts makes it the default section.
 */
describe("DecisionsView (rulings U1, U2; K5's intent)", () => {
  it("shows the to-do heading, every row's id and question, and N of M", () => {
    const html = renderToStaticMarkup(<DecisionsView rows={rows} filter={NO_FILTER} />);
    expect(html).toContain("Unreviewed high-tier decisions");
    for (const r of rows) expect(html).toContain(r.id);
    expect(html).toContain("first question");
    expect(html).toMatch(/data-testid="decision-count"[^>]*>3 of 3</);
  });

  it("shows the placeholder for a null question, and the row stays a button (Review Focus 4)", () => {
    const html = renderToStaticMarkup(<DecisionsView rows={[rows[1]!]} filter={NO_FILTER} />);
    expect(html).toContain(NO_QUESTION);
    expect(html).toMatch(/<li><button type="button"/);
  });

  it("filters by kind, scope and repository, each empty value meaning any", () => {
    expect(filterRows(rows, NO_FILTER).map((r) => r.id)).toEqual(["run/1", "run/2", "run/3"]);
    expect(filterRows(rows, { ...NO_FILTER, kind: "interface" }).map((r) => r.id)).toEqual(["run/1", "run/3"]);
    expect(filterRows(rows, { ...NO_FILTER, scope: "cross-repo" }).map((r) => r.id)).toEqual(["run/2"]);
    expect(filterRows(rows, { ...NO_FILTER, projectKey: "other" }).map((r) => r.id)).toEqual(["run/3"]);
  });

  it("says nothing is left to review when the list is empty (Review Focus 2)", () => {
    const html = renderToStaticMarkup(<DecisionsView rows={[]} filter={NO_FILTER} />);
    expect(html).toContain("Nothing to review.");
    expect(html).toContain("Select a decision to read it.");
  });

  it("says the filters match nothing, with 0 of M (Review Focus 3)", () => {
    const html = renderToStaticMarkup(<DecisionsView rows={rows} filter={{ ...NO_FILTER, kind: "abandon" }} />);
    expect(html).toContain("No decision matches these filters.");
    expect(html).toMatch(/data-testid="decision-count"[^>]*>0 of 3</);
  });

  it("marks the selected row and renders the detail it is given", () => {
    const html = renderToStaticMarkup(
      <DecisionsView rows={rows} filter={NO_FILTER} selected={{ projectKey: "proj", id: "run/2" }} detail={<p>detail-slot</p>} />,
    );
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toContain("detail-slot");
    expect(html).not.toContain("Select a decision to read it.");
  });
});
describe("DecisionDetail's action copy (spec §5.2)", () => {
  it("says what Agree records and that Correct does not edit the ledger", () => {
    const html = renderToStaticMarkup(
      <DecisionDetail decision={{ id: "run/1", question: "q", chose: "c", because: "b", alternatives: [] }} />,
    );
    expect(html).toContain(AGREE_HELP);
    expect(html).toContain("it does not edit the ledger");
    expect(html).toContain(CORRECT_NOTE);
  });
});
