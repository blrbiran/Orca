import { describe, expect, it } from "vitest";
import { classifyReviews } from "../../src/panel/compactClassify.js";
import type { LedgerView } from "../../src/panel/compactClassify.js";
import { computePanelCoverage, unreviewedHighTier } from "../../src/panel/coverage.js";
import type { DecisionObservation } from "../../src/metrics/types.js";
import type { ReviewRow } from "../../src/panel/reviewsStore.js";

const PK = "github.com/biran/target";

const line = (over: Partial<ReviewRow> = {}): string =>
  JSON.stringify({
    decisionId: "orca-dev-1/1",
    projectKey: PK,
    action: "reviewed",
    by: "amy",
    at: "2026-09-10T00:00:00.000Z",
    ...over,
  });

const judged = (top: string[], archived: string[] = []): Map<string, LedgerView> =>
  new Map([[PK, { judged: true, topLevelIds: new Set(top), archivedIds: new Set(archived) }]]);

const kinds = (text: string, views: Map<string, LedgerView>): string[] =>
  classifyReviews(text, views).lines.map((l) => l.cls.kind);

describe("classifyReviews (reviews compaction spec section 3.1)", () => {
  it("C1 keeps the first occurrence of a key byte for byte and drops the later ones", () => {
    // The two lines share (projectKey, decisionId, by, action) and differ only
    // in `at`, so the surviving bytes say WHICH one survived. Counting lines
    // alone would stay green under a keep-the-last mutation.
    const first = line({ at: "2026-09-10T00:00:00.000Z" });
    const later = line({ at: "2026-09-11T00:00:00.000Z" });
    const c = classifyReviews(`${first}\n${later}\n`, judged(["orca-dev-1/1"]));
    expect(c.lines.map((l) => l.cls.kind)).toEqual(["kept", "duplicate"]);
    expect(c.liveText).toBe(`${first}\n`);
  });

  it("C5 leaves an unreadable line where it was, byte for byte, never deduped or moved", () => {
    const a = line();
    const junk = '{"decisionId": "orca-dev-1/1", "proj';
    const dup = line({ at: "2026-09-12T00:00:00.000Z" });
    const c = classifyReviews(`${a}\n${junk}\n${dup}\n`, judged(["orca-dev-1/1"]));
    expect(c.lines.map((l) => l.cls.kind)).toEqual(["kept", "unreadable", "duplicate"]);
    expect(c.liveText).toBe(`${a}\n${junk}\n`);
  });

  it("C5 keeps a torn last line without inventing the newline it never had", () => {
    // A torn tail may be a row still being written. Compaction rewrites the
    // file, so it keeps those bytes exactly -- including the missing newline.
    const a = line();
    const torn = '{"decisionId":"orca-dev-1/2"';
    const c = classifyReviews(`${a}\n${torn}`, judged(["orca-dev-1/1"]));
    expect(c.liveText).toBe(`${a}\n${torn}`);
  });

  it("C6 keeps the surviving lines in their original order", () => {
    // Deliberately NOT sorted by decisionId, so a sort would show.
    const x = line({ decisionId: "orca-dev-1/2" });
    const y = line({ decisionId: "orca-dev-1/1" });
    const z = line({ decisionId: "orca-dev-1/3" });
    const c = classifyReviews(`${x}\n${y}\n${z}\n`, judged(["orca-dev-1/1", "orca-dev-1/2", "orca-dev-1/3"]));
    expect(c.liveText).toBe(`${x}\n${y}\n${z}\n`);
  });

  it("an orphan needs the archive: absent from the top level and present in the archive", () => {
    const row = line({ decisionId: "orca-dev-9/1" });
    const c = classifyReviews(`${row}\n`, judged([], ["orca-dev-9/1"]));
    expect(kinds(`${row}\n`, judged([], ["orca-dev-9/1"]))).toEqual(["orphan"]);
    expect(c.orphanLines).toEqual([row]);
    expect(c.liveText).toBe("");
  });

  it("a row whose decision is in neither place is not judged, and says why", () => {
    // spec R-E: a branch switch also takes an id off the top level. Only the
    // archive is evidence that the decision really left.
    const row = line({ decisionId: "orca-dev-9/1" });
    const c = classifyReviews(`${row}\n`, judged([], []));
    expect(c.lines[0]?.cls).toEqual({
      kind: "not-judged",
      reason: "decision-not-found",
      projectKey: PK,
      decisionId: "orca-dev-9/1",
    });
    expect(c.liveText).toBe(`${row}\n`);
  });

  it("an empty file classifies to nothing", () => {
    const c = classifyReviews("", judged([]));
    expect(c.lines).toEqual([]);
    expect(c.liveText).toBe("");
  });

  it("C15 compaction changes neither the coverage nor the to-do list when every repository is present", () => {
    const decisions: DecisionObservation[] = [
      { projectKey: PK, id: "orca-dev-1/1", at: "2026-01-01T00:00:00.000Z", kind: "interface", scope: "repo", verdict: "ok" },
      { projectKey: PK, id: "orca-dev-1/2", at: "2026-01-02T00:00:00.000Z", kind: "dependency", scope: "repo", verdict: "ok" },
      { projectKey: PK, id: "orca-dev-1/3", at: "2026-01-03T00:00:00.000Z", kind: "boundary", scope: "repo", verdict: "ok" },
    ];
    const text =
      [
        line({ decisionId: "orca-dev-1/1", action: "opened" }),
        line({ decisionId: "orca-dev-1/1", action: "reviewed" }),
        line({ decisionId: "orca-dev-1/1", action: "reviewed", at: "2026-09-12T00:00:00.000Z" }),
        line({ decisionId: "orca-dev-1/2", action: "opened" }),
        line({ decisionId: "orca-dev-8/1", action: "reviewed" }),
      ].join("\n") + "\n";
    const views = judged(["orca-dev-1/1", "orca-dev-1/2", "orca-dev-1/3"], ["orca-dev-8/1"]);
    const rowsOf = (t: string): ReviewRow[] =>
      t.split("\n").filter((l) => l.length > 0).map((l) => JSON.parse(l) as ReviewRow);

    const after = classifyReviews(text, views);
    // Positive control first: the fixture really compacts one duplicate and one
    // orphan, or the equalities below would compare a file with itself.
    expect(after.counts.duplicate + after.counts.orphan).toBe(2);
    expect(computePanelCoverage(decisions, rowsOf(after.liveText))).toEqual(
      computePanelCoverage(decisions, rowsOf(text)),
    );
    expect(unreviewedHighTier(decisions, rowsOf(after.liveText))).toEqual(unreviewedHighTier(decisions, rowsOf(text)));
    // A value, not only an equality: the reviewed decision is really off the list.
    expect(unreviewedHighTier(decisions, rowsOf(after.liveText)).map((d) => d.id)).toEqual([
      "orca-dev-1/2",
      "orca-dev-1/3",
    ]);
  });
});
