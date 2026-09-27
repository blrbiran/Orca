import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NO_QUESTION } from "../src/DecisionList.js";
import { DecisionsView, HIDDEN_BY_FILTER, NOT_IN_LIST, NO_FILTER, filterRows } from "../src/DecisionsView.js";
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

  // Final review Important 1: a filter value whose last row was just reviewed away must stay
  // visible in its select, or the pane shows "any" over an empty list with no way to tell why.
  // REWRITTEN (human authorisation, session f8281a60): the option's text now carries the kind's
  // importance mark; only the expected text changed, the intent did not.
  it("keeps showing a filter value that no longer matches any row", () => {
    const html = renderToStaticMarkup(<DecisionsView rows={[rows[0]!]} filter={{ ...NO_FILTER, kind: "boundary" }} />);
    expect(html).toMatch(/<select name="filter-kind">[\s\S]*?<option value="boundary" selected="">🟠 boundary<\/option>[\s\S]*?<\/select>/);
    expect(html).toContain("No decision matches these filters.");
  });

  it("marks the selected row and renders the detail it is given", () => {
    const html = renderToStaticMarkup(
      <DecisionsView rows={rows} filter={NO_FILTER} selected={{ projectKey: "proj", id: "run/2" }} detail={<p>detail-slot</p>} />,
    );
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toContain("detail-slot");
    expect(html).not.toContain("Select a decision to read it.");
  });

  // Deferred final-review Minor (human go-ahead, session f8281a60): a detail whose row is not in the
  // list on the left must say why, or the person reads a decision the list no longer shows them.
  it("notes when the open decision is hidden by the filters, or no longer in the list at all", () => {
    const view = (id: string, filter = NO_FILTER): string =>
      renderToStaticMarkup(<DecisionsView rows={rows} filter={filter} selected={{ projectKey: "proj", id }} detail={<p>detail-slot</p>} />);
    expect(view("run/2", { ...NO_FILTER, kind: "interface" })).toContain(HIDDEN_BY_FILTER);
    expect(view("run/9")).toContain(NOT_IN_LIST);
    const shown = view("run/2");
    expect(shown).not.toContain(HIDDEN_BY_FILTER);
    expect(shown).not.toContain(NOT_IN_LIST);
    // App hands `null` while the detail is still loading: no detail on screen, so nothing to explain.
    const loading = renderToStaticMarkup(<DecisionsView rows={rows} filter={NO_FILTER} selected={{ projectKey: "proj", id: "run/9" }} detail={null} />);
    expect(loading).not.toContain(NOT_IN_LIST);
  });
});
describe("the kind filter (human ruling, session f8281a60)", () => {
  it("lists kinds most-important first, each option marked with its level", () => {
    const all = ["scheduling", "reconcile", "boundary", "abandon"].map((kind, i) => row({ id: `run/${i}`, kind: kind as DecisionListRow["kind"] }));
    const html = renderToStaticMarkup(<DecisionsView rows={all} filter={NO_FILTER} />);
    const select = /<select name="filter-kind">([\s\S]*?)<\/select>/.exec(html)![1]!;
    expect([...select.matchAll(/<option value="([^"]*)"(?: selected="")?>([^<]*)<\/option>/g)].map((m) => `${m[1]}|${m[2]}`)).toEqual([
      "|any", "reconcile|🔴 reconcile", "abandon|🔴 abandon", "boundary|🟠 boundary", "scheduling|🟡 scheduling",
    ]);
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
