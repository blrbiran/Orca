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
 *
 * REWRITTEN under ruling U1 -- see the comment on the first criterion.
 */
describe("DecisionList (task 8 ruling K6)", () => {
  // REWRITTEN (panel UI redesign spec §2/§6.1, human ruling U1, authorised as U4 in session
  // a50f4d80). The question now belongs on the row; the half of this criterion that still
  // matters is "the component never spreads the row", so a DIFFERENT extra field probes it.
  it("renders only the list fields, never an extra field on the row", () => {
    const row = {
      projectKey: "proj",
      id: "run/1",
      at: "2026-09-01T00:00:00.000Z",
      kind: "interface",
      scope: "repo",
      verdict: "ok",
      question: "the question text that now belongs on the row",
      because: "a reasoning value that must never leak into the list",
    } as unknown as DecisionListRow;

    const html = renderToStaticMarkup(<DecisionList rows={[row]} />);
    expect(html).toContain("run/1");
    expect(html).toContain("the question text that now belongs on the row");
    expect(html).not.toContain("a reasoning value that must never leak into the list");
  });

  // Deferred final-review Minor (human go-ahead, session f8281a60): spec §5.1 says the row's date is
  // the LOCAL short date, not the UTC one `at.slice(0, 10)` gave. Two zones on either side of UTC,
  // each picked so the UTC date and the local date differ.
  it("shows the date in the viewer's own time zone", () => {
    const before = process.env.TZ;
    const at = (tz: string, value: string): string => {
      process.env.TZ = tz;
      const row = { projectKey: "p", id: "r/1", at: value, kind: "interface", scope: "repo", verdict: "ok", question: "q" } as DecisionListRow;
      return renderToStaticMarkup(<DecisionList rows={[row]} />);
    };
    try {
      expect(at("Asia/Shanghai", "2026-09-01T20:00:00.000Z")).toContain(">2026-09-02</time>");
      expect(at("America/Los_Angeles", "2026-09-01T03:00:00.000Z")).toContain(">2026-08-31</time>");
    } finally {
      if (before === undefined) delete process.env.TZ; else process.env.TZ = before;
    }
  });

  // Human ruling (session f8281a60): the kind pill carries the kind's importance level, which
  // styles.css turns into the same coloured dot the filter's options show; an unknown kind gets none.
  it("marks the kind pill with its importance level", () => {
    const one = (kind: string): string =>
      renderToStaticMarkup(<DecisionList rows={[{ projectKey: "p", id: "r/1", at: "2026-09-01T00:00:00.000Z", kind, scope: "repo", verdict: "ok", question: "q" } as DecisionListRow]} />);
    expect(one("abandon")).toContain('<span class="pill field-kind" data-level="1">abandon</span>');
    expect(one("criteria")).toContain('<span class="pill field-kind" data-level="3">criteria</span>');
    expect(one("zzz-unknown")).toContain('<span class="pill field-kind">zzz-unknown</span>');
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
