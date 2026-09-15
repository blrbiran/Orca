import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DecisionList } from "../src/DecisionList.js";
import type { DecisionListRow } from "../src/types.js";

/**
 * task 8 ruling K6. `row` carries an extra `question` value the way a real
 * `DecisionObservation` never would through this projection, but a server bug
 * (or a looser type somewhere upstream) could still hand the component an
 * object that has it. The criterion: that value never reaches the HTML, while
 * the row's own `id` (a real list field) does.
 */
describe("DecisionList (task 8 ruling K6)", () => {
  it("renders only the list fields, never an extra field on the row", () => {
    const row = {
      projectKey: "proj",
      id: "run/1",
      at: "2026-09-01T00:00:00.000Z",
      kind: "interface",
      scope: "repo",
      verdict: "ok",
      question: "a reasoning value that must never leak into the list",
    } as unknown as DecisionListRow;

    const html = renderToStaticMarkup(<DecisionList rows={[row]} />);
    expect(html).toContain("run/1");
    expect(html).not.toContain("a reasoning value that must never leak into the list");
  });
});
