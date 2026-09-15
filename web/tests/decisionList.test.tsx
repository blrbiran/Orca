import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DecisionList, rowKey } from "../src/DecisionList.js";
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

  /**
   * review finding I-1 / controller ruling R60. A fixed-separator join (the
   * earlier double-colon join) collides on exactly this pair: {projectKey:
   * "a::b", id: "c"} and {projectKey: "a", id: "b::c"} would produce the same
   * string. `rowKey` must tell them apart -- mutation K-8 (restore the
   * double-colon join) reddens this exact assertion, and only this one: it
   * is the only place in this file that constructs the colliding pair.
   *
   * The second half is a positive observation (task 6/7's own lesson, carried
   * here): a key generator that always returns something different would
   * also pass "the two keys differ" trivially, so this also pins that the
   * SAME row produces the SAME key twice.
   */
  it("gives two different keys to a pair that would collide under a fixed separator, and the same key twice to the same row", () => {
    const rowA: Pick<DecisionListRow, "projectKey" | "id"> = { projectKey: "a::b", id: "c" };
    const rowB: Pick<DecisionListRow, "projectKey" | "id"> = { projectKey: "a", id: "b::c" };
    expect(rowKey(rowA)).not.toBe(rowKey(rowB));
    expect(rowKey(rowA)).toBe(rowKey(rowA));
  });
});
